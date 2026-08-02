import type { Express } from "express";
import type { Server } from "http";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { storage } from "./storage";
import {
  taskSchema,
  insertBiSchema,
  updateBaseOrigemStatusSchema,
  updateBiInativoSchema,
  insertAutomacaoSchema,
  loginAnalistaSchema,
  insertAnalistaSchema,
  updateAnalistaSchema,
  transferDemandaSchema,
  insertSolicitanteSchema,
  slaConfigUpdateSchema,
  insertProjetoSchema,
  updateProjetoSchema,
  insertEtapaSchema,
  updateEtapaSchema,
  insertDisparoSchema,
  updateDisparoSchema,
  insertDisparoCanalSchema,
  insertDisparoTemplateSchema,
  disparoConfigSchema,
  insertRpaDisparoSchema,
  rpaConfigSchema,
  insertRpaCanalSchema,
  insertRpaTemplateSchema,
  insertReguaRotinaSchema,
  reguaConfigSchema,
} from "@shared/schema";
import { z } from "zod";
import { executeRpaDisparo } from "./rpa";
import { bqListDatasets, bqListTables, bqGetSchema, bqRunQuery, bqCountQuery, executeReguaRotina, startReguaScheduler, calcNextRun, sanitizeCredentialsJson } from "./regua";
import { getTickets, getTicketStats, getCategories, getChartData, getTimeMetrics, getTimelineTickets, getKanbanData, addTicketFollowup, updateTicketStatus, uploadDocumentToTicket, getTicketFollowups, updateTicketResponsible, getTicketDocuments, downloadDocument, testGlpiConnection, setGlpiRuntimeConfig, getTicketTimeline } from "./glpi";

// ===========================
// Disparo Scheduler (fires API calls at scheduled time)
// ===========================
function getBRDateTime(): string {
  const now = new Date();
  // Brazil time (UTC-3)
  const brOffset = -3 * 60;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const brMs = utcMs + brOffset * 60000;
  const br = new Date(brMs);
  const yyyy = br.getFullYear();
  const mm = String(br.getMonth() + 1).padStart(2, "0");
  const dd = String(br.getDate()).padStart(2, "0");
  const hh = String(br.getHours()).padStart(2, "0");
  const min = String(br.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

// ── getDbPool: acessível tanto em executeDisparo quanto em registerRoutes ──
async function getDbPool(databaseOverride?: string) {
  const { Pool } = await import("pg");
  const cfg = await storage.getDbConfig();
  if (!cfg.hasConfig) throw new Error("Banco de dados não configurado");
  return new Pool({
    host: cfg.host,
    port: cfg.port,
    database: databaseOverride || cfg.database,
    user: cfg.username,
    password: cfg.password,
    connectionTimeoutMillis: 8000,
    max: 3,
  });
}

async function executeDisparo(disparo: Awaited<ReturnType<typeof storage.getDisparoById>> & {}) {
  if (!disparo) return;
  const log = (msg: string) => {
    const ts = new Date().toLocaleTimeString("pt-BR");
    return `[${ts}] ${msg}`;
  };

  // ── Quality Gate ──────────────────────────────────────────────────────────
  // Block dispatch if phone number OR template quality is RED (baixa).
  // YELLOW (média) and GREEN (alta) are both acceptable.
  const qualityBlocked: string[] = [];

  if (disparo.canalId) {
    const phones = await storage.getAllMetaPhoneNumbers();
    const phone = phones.find(p => p.canalId === disparo.canalId);
    if (phone) {
      if (phone.qualityRating === "RED") {
        qualityBlocked.push(`Número ${phone.displayPhoneNumber} com qualidade BAIXA (${phone.qualityRating}) — disparo bloqueado`);
      }
    }
  }

  if (disparo.metaTemplateId) {
    const metaTpl = await storage.getMetaTemplateById(disparo.metaTemplateId);
    if (metaTpl) {
      if (metaTpl.qualityScore === "RED") {
        qualityBlocked.push(`Template "${metaTpl.name}" com qualidade BAIXA (${metaTpl.qualityScore}) — disparo bloqueado`);
      }
    }
  }

  if (qualityBlocked.length > 0) {
    const blockedLogs = [
      log(`⚠️ Disparo PULADO por qualidade insuficiente: ${disparo.nome}`),
      ...qualityBlocked.map(msg => log(`🚫 ${msg}`)),
      log("Este horário foi perdido. Os próximos horários agendados farão sua própria verificação."),
    ];
    await storage.updateDisparo(disparo.id, {
      status: "parado",
      iniciadoEm: Date.now(),
      concluidoEm: Date.now(),
      logs: blockedLogs,
    });
    console.log(`[Disparos] Quality gate bloqueou "${disparo.nome}": ${qualityBlocked.join("; ")}`);
    return;
  }
  // ── Fim Quality Gate ──────────────────────────────────────────────────────

  const logs: string[] = [log(`Iniciando disparo: ${disparo.nome}`)];

  await storage.updateDisparo(disparo.id, {
    status: "executando",
    iniciadoEm: Date.now(),
    logs: [...logs],
  });

  try {
    // Load global config (API URL + token)
    const globalConfig = await storage.getDisparoConfig();
    const apiUrl = globalConfig.apiUrl;
    const apiToken = globalConfig.apiToken;

    if (!apiUrl) {
      throw new Error("URL da API não configurada. Configure em Configuração → Disparos.");
    }
    if (!disparo.arquivoConteudo) {
      throw new Error("Nenhuma base de dados anexada a este disparo.");
    }

    // Load canal and template codes
    let canalCodigo: string | undefined;
    let templateCodigo: string | undefined;
    if (disparo.canalId) {
      const canal = await storage.getDisparoCanalById(disparo.canalId);
      canalCodigo = canal?.codigo;
      if (canal) logs.push(log(`Canal: ${canal.nome} (${canal.codigo})`));
    }
    if (disparo.metaTemplateId) {
      // Prefer MetaTemplate (synced from WhatsApp API) — name IS the template code
      const metaTpl = await storage.getMetaTemplateById(disparo.metaTemplateId);
      if (metaTpl) {
        templateCodigo = metaTpl.name;
        logs.push(log(`Template (Meta): ${metaTpl.name} [${metaTpl.status}]`));
      }
    } else if (disparo.templateId) {
      const template = await storage.getDisparoTemplateById(disparo.templateId);
      templateCodigo = template?.codigo;
      if (template) logs.push(log(`Template: ${template.nome} (${template.codigo})`));
    }

    // Count records for progress tracking (auto-detect separator: ; or ,)
    const lines = disparo.arquivoConteudo.split("\n").filter(l => l.trim().length > 0);
    const totalRegistros = Math.max(0, lines.length - 1);
    logs.push(log(`Base carregada: ${totalRegistros} registros. Enviando CSV para a API...`));
    await storage.updateDisparo(disparo.id, { logs: [...logs], totalRegistros });

    // Build multipart/form-data — send the full CSV file in one request
    // FormData and Blob are globals in Node.js 18+
    const formData = new FormData();

    // Attach the CSV file as a binary blob under the field "file"
    const csvBlob = new Blob([disparo.arquivoConteudo], { type: "text/csv" });
    const fileName = disparo.arquivoNome || "base.csv";
    formData.append("file", csvBlob, fileName);

    // Add canal, template and any extra params as form fields
    if (canalCodigo) formData.append("canal", canalCodigo);
    if (templateCodigo) formData.append("template", templateCodigo);
    if (disparo.parametrosExtras && Array.isArray(disparo.parametrosExtras)) {
      const validVars = disparo.parametrosExtras.filter(v => v.key.trim());
      for (const { key, value } of validVars) {
        formData.append(key.trim(), value);
      }
      if (validVars.length > 0) {
        logs.push(log(`Variáveis: ${validVars.map(v => `${v.key}=${v.value}`).join(", ")}`));
      }
    }

    logs.push(log(`Enviando para: ${apiUrl}`));
    await storage.updateDisparo(disparo.id, { logs: [...logs] });

    const headers: Record<string, string> = {};
    if (apiToken) headers["Authorization"] = `Bearer ${apiToken}`;

    const resp = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: formData,
      signal: AbortSignal.timeout(120000), // 2 min timeout for large files
    });

    const respText = await resp.text().catch(() => "");

    if (resp.ok) {
      logs.push(log(`Arquivo enviado com sucesso! HTTP ${resp.status}`));
      if (respText) logs.push(log(`Resposta da API: ${respText.slice(0, 500)}`));

      // ── Marcar registros COGNA como disparo_realizado = 1 ────────────────
      // Usa origemCogna como sinal de que é um disparo de Base COGNA,
      // mas atualiza pelos CPFs exatos do lote (evita marcar registros que não foram enviados).
      if (disparo.origemCogna && disparo.arquivoConteudo) {
        let pool: any;
        try {
          // Extrai CPFs do CSV que foi enviado neste lote
          const csvLines = disparo.arquivoConteudo.split("\n").map(l => l.trim()).filter(Boolean);
          const sep = csvLines[0]?.includes(";") ? ";" : ",";
          const headerCols = csvLines[0]?.split(sep).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, "")) ?? [];
          const cpfIdx = headerCols.indexOf("cpf");
          const cpfs = cpfIdx >= 0
            ? csvLines.slice(1).map(l => l.split(sep)[cpfIdx]?.replace(/^"|"$/g, "").trim()).filter(Boolean)
            : [];

          if (cpfs.length > 0) {
            pool = await getDbPool();
            const existsQ = await pool.query(`
              SELECT table_schema FROM information_schema.tables
              WHERE UPPER(table_schema) = 'COGNA_BRONZE'
                AND table_name = 'disparo_interno_cogna' LIMIT 1
            `);
            if (existsQ.rows.length > 0) {
              const schema = existsQ.rows[0].table_schema;
              const result = await pool.query(
                `UPDATE "${schema}".disparo_interno_cogna
                    SET disparo_realizado = 1
                  WHERE cpf = ANY($1)
                    AND disparo_realizado::int = 0`,
                [cpfs]
              );
              const count = result.rowCount ?? 0;
              logs.push(log(`✅ Banco atualizado: ${count} de ${cpfs.length} registro(s) marcados como disparo_realizado = 1`));
            }
          }
        } catch (dbErr: any) {
          logs.push(log(`⚠️ Não foi possível atualizar o banco: ${(dbErr as Error).message}`));
        } finally {
          if (pool) await pool.end().catch(() => {});
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      await storage.updateDisparo(disparo.id, {
        status: "concluido",
        processados: totalRegistros,
        erros: 0,
        concluidoEm: Date.now(),
        logs: [...logs],
      });
    } else {
      logs.push(log(`Erro ao enviar: HTTP ${resp.status}`));
      if (respText) logs.push(log(`Resposta da API: ${respText.slice(0, 500)}`));
      await storage.updateDisparo(disparo.id, {
        status: "erro",
        processados: 0,
        erros: 1,
        concluidoEm: Date.now(),
        logs: [...logs],
      });
    }
  } catch (err) {
    const logs2 = [`[${new Date().toLocaleTimeString("pt-BR")}] ERRO FATAL: ${(err as Error).message}`];
    await storage.updateDisparo(disparo.id, {
      status: "erro",
      processados: 0,
      erros: 1,
      concluidoEm: Date.now(),
      logs: logs2,
    });
  }
}

function startDisparoScheduler() {
  setInterval(async () => {
    try {
      const dataHora = getBRDateTime();
      const agendados = await storage.getDisparosAgendados(dataHora);
      for (const d of agendados) {
        console.log(`[Disparos] Iniciando disparo agendado: ${d.nome} (${d.horario})`);
        executeDisparo(d).catch(err => console.error("[Disparos] Erro:", err));
      }
    } catch (err) {
      console.error("[Disparos Scheduler] Erro:", err);
    }
  }, 30000); // Check every 30 seconds
  console.log("[Disparos] Scheduler iniciado (verifica a cada 30s)");
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // Load stored GLPI config on startup
  try {
    const glpiConfig = await storage.getGlpiConfig();
    if (glpiConfig.apiUrl && glpiConfig.appToken && glpiConfig.userToken) {
      setGlpiRuntimeConfig(glpiConfig);
      console.log("[GLPI] Loaded stored config:", glpiConfig.apiUrl);
    }
  } catch (e) {
    console.log("[GLPI] No stored config found, using environment variables");
  }

  // Start the Disparo scheduler
  startDisparoScheduler();

  // ===========================
  // Task Routes (Esteira de Demandas)
  // ===========================

  // Get all tasks for a specific date
  app.get("/api/tasks", async (req, res) => {
    try {
      const ymd = (req.query.ymd as string) || new Date().toISOString().split("T")[0];
      const tasks = await storage.getAllTasks(ymd);
      res.json(tasks);
    } catch (error) {
      console.error("Error getting tasks:", error);
      res.status(500).json({ error: "Failed to get tasks" });
    }
  });

  // Get task by ID
  app.get("/api/tasks/:id", async (req, res) => {
    try {
      const task = await storage.getTaskById(req.params.id);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      res.json(task);
    } catch (error) {
      console.error("Error getting task:", error);
      res.status(500).json({ error: "Failed to get task" });
    }
  });

  // Create a new task
  app.post("/api/tasks", async (req, res) => {
    try {
      const insertTaskSchema = taskSchema.omit({ id: true });
      const data = insertTaskSchema.parse(req.body);
      const task = await storage.createTask(data);
      res.status(201).json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error creating task:", error);
      res.status(500).json({ error: "Failed to create task" });
    }
  });

  // Update a task
  app.patch("/api/tasks/:id", async (req, res) => {
    try {
      const task = await storage.updateTask(req.params.id, req.body);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      res.json(task);
    } catch (error) {
      console.error("Error updating task:", error);
      res.status(500).json({ error: "Failed to update task" });
    }
  });

  // Delete a task
  app.delete("/api/tasks/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteTask(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Task not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting task:", error);
      res.status(500).json({ error: "Failed to delete task" });
    }
  });

  // Delete entire task series (for recurring tasks)
  app.delete("/api/tasks/:id/series", async (req, res) => {
    try {
      const deleted = await storage.deleteTaskSeries(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Task series not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting task series:", error);
      res.status(500).json({ error: "Failed to delete task series" });
    }
  });

  // ===========================
  // Ticket Routes (Dashboard GLPI - Real API)
  // ===========================

  // Get ticket statistics
  app.get("/api/tickets/stats", async (_req, res) => {
    try {
      const stats = await getTicketStats();
      res.json(stats);
    } catch (error) {
      console.error("Error getting ticket stats:", error);
      res.status(500).json({ error: "Failed to get ticket statistics" });
    }
  });

  // Get all tickets
  app.get("/api/tickets", async (req, res) => {
    try {
      const range = (req.query.range as string) || "0-9999";
      const tickets = await getTickets(range);
      res.json(tickets);
    } catch (error) {
      console.error("Error getting tickets:", error);
      res.status(500).json({ error: "Failed to get tickets" });
    }
  });

  // Get ticket categories
  app.get("/api/tickets/categories", async (_req, res) => {
    try {
      const categories = await getCategories();
      res.json(categories);
    } catch (error) {
      console.error("Error getting categories:", error);
      res.status(500).json({ error: "Failed to get categories" });
    }
  });

  // Get chart data (last 30 days)
  app.get("/api/tickets/chart", async (_req, res) => {
    try {
      const chartData = await getChartData();
      res.json(chartData);
    } catch (error) {
      console.error("Error getting chart data:", error);
      res.status(500).json({ error: "Failed to get chart data" });
    }
  });

  // Get time metrics
  app.get("/api/tickets/metrics", async (_req, res) => {
    try {
      const metrics = await getTimeMetrics();
      res.json(metrics);
    } catch (error) {
      console.error("Error getting time metrics:", error);
      res.status(500).json({ error: "Failed to get time metrics" });
    }
  });

  // Get timeline tickets
  app.get("/api/tickets/timeline", async (_req, res) => {
    try {
      const slaConfigs = await storage.getSlaConfig();
      const slaMap = new Map<number, number>();
      for (const cfg of slaConfigs) {
        slaMap.set(cfg.prioridadeCode, cfg.horasMaximas);
      }
      const timelineTickets = await getTimelineTickets(slaMap);
      res.json(timelineTickets);
    } catch (error) {
      console.error("Error getting timeline tickets:", error);
      res.status(500).json({ error: "Failed to get timeline tickets" });
    }
  });

  // Get kanban data
  app.get("/api/tickets/kanban", async (_req, res) => {
    try {
      const kanbanData = await getKanbanData();
      res.json(kanbanData);
    } catch (error) {
      console.error("Error getting kanban data:", error);
      res.status(500).json({ error: "Failed to get kanban data" });
    }
  });

  // Get ticket timeline (all events chronologically)
  app.get("/api/tickets/:id/timeline", async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const events = await getTicketTimeline(ticketId);
      res.json(events);
    } catch (error) {
      console.error("Error getting ticket timeline:", error);
      res.status(500).json({ error: "Failed to get ticket timeline" });
    }
  });

  // Get ticket followups
  app.get("/api/tickets/:id/followups", async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const followups = await getTicketFollowups(ticketId);
      res.json(followups);
    } catch (error) {
      console.error("Error getting ticket followups:", error);
      res.status(500).json({ error: "Failed to get followups" });
    }
  });

  // Add followup to ticket
  app.post("/api/tickets/:id/followups", async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const { content, isPrivate } = req.body;
      
      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "Content is required" });
      }

      const result = await addTicketFollowup({
        ticketId,
        content,
        isPrivate: isPrivate === true
      });
      res.json(result);
    } catch (error) {
      console.error("Error adding followup:", error);
      res.status(500).json({ error: "Failed to add followup" });
    }
  });

  // Update ticket status
  app.patch("/api/tickets/:id/status", async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const { status } = req.body;
      
      if (typeof status !== "number" || status < 1 || status > 6) {
        return res.status(400).json({ error: "Status must be a number between 1 and 6" });
      }

      const result = await updateTicketStatus({ ticketId, status });
      res.json(result);
    } catch (error) {
      console.error("Error updating ticket status:", error);
      res.status(500).json({ error: "Failed to update ticket status" });
    }
  });

  // Upload document to ticket
  app.post("/api/tickets/:id/documents", async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const { filename, base64Content } = req.body;
      
      if (!filename || !base64Content) {
        return res.status(400).json({ error: "Filename and base64Content are required" });
      }

      const result = await uploadDocumentToTicket({
        ticketId,
        filename,
        base64Content
      });
      res.json(result);
    } catch (error) {
      console.error("Error uploading document:", error);
      res.status(500).json({ error: "Failed to upload document" });
    }
  });

  // Get ticket documents/attachments
  app.get("/api/tickets/:id/documents", async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const documents = await getTicketDocuments(ticketId);
      res.json(documents);
    } catch (error) {
      console.error("Error getting ticket documents:", error);
      res.status(500).json({ error: "Failed to get ticket documents" });
    }
  });

  // Download a document from GLPI
  app.get("/api/documents/:id/download", async (req, res) => {
    try {
      const documentId = parseInt(req.params.id);
      const { content, filename, mime } = await downloadDocument(documentId);
      
      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader("Content-Length", content.length);
      res.send(content);
    } catch (error) {
      console.error("Error downloading document:", error);
      res.status(500).json({ error: "Failed to download document" });
    }
  });

  // Update ticket responsible (admin only)
  app.patch("/api/tickets/:id/responsible", async (req, res) => {
    try {
      // Check admin authorization via header
      const analistaId = req.headers["x-analista-id"] as string;
      if (!analistaId) {
        return res.status(401).json({ error: "Autenticação necessária" });
      }
      
      const analista = await storage.getAnalistaById(analistaId);
      if (!analista || analista.role !== "admin") {
        return res.status(403).json({ error: "Apenas administradores podem alterar o responsável" });
      }
      
      const ticketId = parseInt(req.params.id);
      const { responsibleName } = req.body;
      
      if (!responsibleName || typeof responsibleName !== "string") {
        return res.status(400).json({ error: "responsibleName is required" });
      }

      const result = await updateTicketResponsible({
        ticketId,
        responsibleName
      });
      res.json(result);
    } catch (error) {
      console.error("Error updating ticket responsible:", error);
      res.status(500).json({ error: "Failed to update ticket responsible" });
    }
  });

  // Get or auto-assign ticket responsible (local system)
  app.get("/api/tickets/:id/responsible", async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const responsible = await storage.getOrAssignTicketResponsible(ticketId);
      
      if (responsible.analistaId === "unassigned") {
        res.json({
          ticketId: responsible.ticketId,
          analistaId: "unassigned",
          analistaNome: "Não atribuído",
          assignedAt: responsible.assignedAt
        });
        return;
      }
      
      const analista = await storage.getAnalistaById(responsible.analistaId);
      res.json({
        ticketId: responsible.ticketId,
        analistaId: responsible.analistaId,
        analistaNome: analista?.nome || "Desconhecido",
        assignedAt: responsible.assignedAt
      });
    } catch (error: any) {
      console.error("Error getting ticket responsible:", error);
      res.status(500).json({ error: error.message || "Failed to get ticket responsible" });
    }
  });

  // Set ticket responsible manually (admin only)
  app.post("/api/tickets/:id/responsible", async (req, res) => {
    try {
      const analistaId = req.headers["x-analista-id"] as string;
      if (!analistaId) {
        return res.status(401).json({ error: "Autenticação necessária" });
      }
      
      const analista = await storage.getAnalistaById(analistaId);
      if (!analista || analista.role !== "admin") {
        return res.status(403).json({ error: "Apenas administradores podem alterar o responsável" });
      }
      
      const ticketId = parseInt(req.params.id);
      const { analistaId: targetAnalistaId } = req.body;
      
      if (!targetAnalistaId || typeof targetAnalistaId !== "string") {
        return res.status(400).json({ error: "analistaId is required" });
      }

      const responsible = await storage.setTicketResponsible(ticketId, targetAnalistaId);
      const targetAnalista = await storage.getAnalistaById(targetAnalistaId);
      res.json({
        ticketId: responsible.ticketId,
        analistaId: responsible.analistaId,
        analistaNome: targetAnalista?.nome || "Desconhecido",
        assignedAt: responsible.assignedAt
      });
    } catch (error) {
      console.error("Error setting ticket responsible:", error);
      res.status(500).json({ error: "Failed to set ticket responsible" });
    }
  });

  // Get all ticket responsibles
  app.get("/api/ticket-responsibles", async (_req, res) => {
    try {
      const responsibles = await storage.getAllTicketResponsibles();
      const result = await Promise.all(responsibles.map(async (r) => {
        const analista = await storage.getAnalistaById(r.analistaId);
        return {
          ticketId: r.ticketId,
          analistaId: r.analistaId,
          analistaNome: analista?.nome || "Desconhecido",
          assignedAt: r.assignedAt
        };
      }));
      res.json(result);
    } catch (error) {
      console.error("Error getting ticket responsibles:", error);
      res.status(500).json({ error: "Failed to get ticket responsibles" });
    }
  });

  // ===========================
  // BI Cadastro Routes
  // ===========================

  // Get all BIs with their bases
  app.get("/api/bis", async (_req, res) => {
    try {
      const bis = await storage.getAllBis();
      res.json(bis);
    } catch (error) {
      console.error("Error getting BIs:", error);
      res.status(500).json({ error: "Failed to get BIs" });
    }
  });

  // Get a single BI by ID
  app.get("/api/bis/:id", async (req, res) => {
    try {
      const bi = await storage.getBiById(req.params.id);
      if (!bi) {
        return res.status(404).json({ error: "BI not found" });
      }
      res.json(bi);
    } catch (error) {
      console.error("Error getting BI:", error);
      res.status(500).json({ error: "Failed to get BI" });
    }
  });

  // Create a new BI with bases
  app.post("/api/bis", async (req, res) => {
    try {
      const validationSchema = insertBiSchema.extend({
        bases: z.array(
          z.object({
            nomeFerramenta: z.string(),
            pastaOrigem: z.string(),
            temApi: z.boolean(),
          })
        ),
      });

      const data = validationSchema.parse(req.body);
      const { bases, ...biData } = data;

      const bi = await storage.createBi(biData, bases);
      res.status(201).json(bi);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error creating BI:", error);
      res.status(500).json({ error: "Failed to create BI" });
    }
  });

  // Update BI inativo status
  app.patch("/api/bis/:id/inativar", async (req, res) => {
    try {
      const data = updateBiInativoSchema.parse(req.body);
      const bi = await storage.updateBiInativo(req.params.id, data.inativo);

      if (!bi) {
        return res.status(404).json({ error: "BI not found" });
      }

      res.json(bi);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error updating BI:", error);
      res.status(500).json({ error: "Failed to update BI" });
    }
  });

  // Update base status
  app.patch("/api/bases/:id/status", async (req, res) => {
    try {
      const data = updateBaseOrigemStatusSchema.parse(req.body);
      const base = await storage.updateBaseStatus(
        req.params.id,
        data.status,
        data.observacao
      );

      if (!base) {
        return res.status(404).json({ error: "Base not found" });
      }

      res.json(base);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error updating base status:", error);
      res.status(500).json({ error: "Failed to update base status" });
    }
  });

  // Get canvas data
  app.get("/api/canvas", async (_req, res) => {
    try {
      const canvasData = await storage.getCanvasData();
      res.json(canvasData);
    } catch (error) {
      console.error("Error getting canvas data:", error);
      res.status(500).json({ error: "Failed to get canvas data" });
    }
  });

  // Save canvas data
  app.post("/api/canvas", async (req, res) => {
    try {
      const { nodes, edges } = req.body;

      if (!Array.isArray(nodes) || !Array.isArray(edges)) {
        return res.status(400).json({ error: "Invalid canvas data format" });
      }

      await storage.saveCanvasData(nodes, edges);
      res.json({ success: true });
    } catch (error) {
      console.error("Error saving canvas data:", error);
      res.status(500).json({ error: "Failed to save canvas data" });
    }
  });

  // ===========================
  // Automacao Routes
  // ===========================

  // Get all automacoes
  app.get("/api/automacoes", async (_req, res) => {
    try {
      const automacoes = await storage.getAllAutomacoes();
      res.json(automacoes);
    } catch (error) {
      console.error("Error getting automacoes:", error);
      res.status(500).json({ error: "Failed to get automacoes" });
    }
  });

  // Get automacao by ID
  app.get("/api/automacoes/:id", async (req, res) => {
    try {
      const automacao = await storage.getAutomacaoById(req.params.id);
      if (!automacao) {
        return res.status(404).json({ error: "Automacao not found" });
      }
      res.json(automacao);
    } catch (error) {
      console.error("Error getting automacao:", error);
      res.status(500).json({ error: "Failed to get automacao" });
    }
  });

  // Create a new automacao
  app.post("/api/automacoes", async (req, res) => {
    try {
      const data = insertAutomacaoSchema.parse(req.body);
      const automacao = await storage.createAutomacao(data);
      res.status(201).json(automacao);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error creating automacao:", error);
      res.status(500).json({ error: "Failed to create automacao" });
    }
  });

  // Delete automacao
  app.delete("/api/automacoes/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteAutomacao(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Automacao not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting automacao:", error);
      res.status(500).json({ error: "Failed to delete automacao" });
    }
  });

  // ===========================
  // Analista Routes (Login System)
  // ===========================

  // Get all active analistas (for login dropdown)
  app.get("/api/analistas", async (_req, res) => {
    try {
      const analistas = await storage.getAllAnalistas(false);
      // Return without passwords but include role and ativo for filtering
      const safeAnalistas = analistas.map(a => ({ 
        id: a.id, 
        nome: a.nome,
        role: a.role,
        ativo: a.ativo
      }));
      res.json(safeAnalistas);
    } catch (error) {
      console.error("Error getting analistas:", error);
      res.status(500).json({ error: "Failed to get analistas" });
    }
  });

  // Get all analistas including inactive (for admin management)
  app.get("/api/analistas/all", async (_req, res) => {
    try {
      const analistas = await storage.getAllAnalistas(true);
      // Return without passwords
      const safeAnalistas = analistas.map(a => ({ 
        id: a.id, 
        nome: a.nome, 
        role: a.role,
        ativo: a.ativo 
      }));
      res.json(safeAnalistas);
    } catch (error) {
      console.error("Error getting all analistas:", error);
      res.status(500).json({ error: "Failed to get analistas" });
    }
  });

  // Login analista
  app.post("/api/analistas/login", async (req, res) => {
    try {
      const { nome, senha } = loginAnalistaSchema.parse(req.body);
      const analista = await storage.validateAnalistaLogin(nome, senha);
      if (!analista) {
        return res.status(401).json({ error: "Nome ou senha incorretos" });
      }
      // Return safe analista data (without password) including role
      res.json({ id: analista.id, nome: analista.nome, role: analista.role });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error logging in:", error);
      res.status(500).json({ error: "Failed to login" });
    }
  });

  // Create new analista (admin only)
  app.post("/api/analistas", async (req, res) => {
    try {
      const data = insertAnalistaSchema.parse(req.body);
      
      // Check if nome already exists
      const existing = await storage.getAnalistaByNome(data.nome);
      if (existing) {
        return res.status(400).json({ error: "Já existe um analista com este nome" });
      }
      
      const analista = await storage.createAnalista(data);
      res.status(201).json({ 
        id: analista.id, 
        nome: analista.nome, 
        role: analista.role,
        ativo: analista.ativo 
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error creating analista:", error);
      res.status(500).json({ error: "Failed to create analista" });
    }
  });

  // Update analista (admin only)
  app.patch("/api/analistas/:id", async (req, res) => {
    try {
      const updates = updateAnalistaSchema.parse(req.body);
      
      // If updating nome, check if it already exists
      if (updates.nome) {
        const existing = await storage.getAnalistaByNome(updates.nome);
        if (existing && existing.id !== req.params.id) {
          return res.status(400).json({ error: "Já existe um analista com este nome" });
        }
      }
      
      const analista = await storage.updateAnalista(req.params.id, updates);
      if (!analista) {
        return res.status(404).json({ error: "Analista não encontrado" });
      }
      res.json({ 
        id: analista.id, 
        nome: analista.nome, 
        role: analista.role,
        ativo: analista.ativo 
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error updating analista:", error);
      res.status(500).json({ error: "Failed to update analista" });
    }
  });

  // Delete analista (admin only)
  app.delete("/api/analistas/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteAnalista(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Analista não encontrado" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting analista:", error);
      res.status(500).json({ error: "Failed to delete analista" });
    }
  });

  // Transfer demandas between analistas
  app.post("/api/demandas/transfer", async (req, res) => {
    try {
      const data = transferDemandaSchema.parse(req.body);
      const count = await storage.transferDemandas(
        data.deAnalistaId,
        data.paraAnalistaId,
        data.dataInicio,
        data.dataFim,
        data.taskId
      );
      res.json({ success: true, transferidas: count });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error transferring demandas:", error);
      res.status(500).json({ error: "Failed to transfer demandas" });
    }
  });

  // ===========================
  // Solicitante Routes
  // ===========================

  // Get all solicitantes
  app.get("/api/solicitantes", async (_req, res) => {
    try {
      const solicitantes = await storage.getAllSolicitantes();
      res.json(solicitantes);
    } catch (error) {
      console.error("Error getting solicitantes:", error);
      res.status(500).json({ error: "Failed to get solicitantes" });
    }
  });

  // Create a new solicitante
  app.post("/api/solicitantes", async (req, res) => {
    try {
      const data = insertSolicitanteSchema.parse(req.body);
      
      // Check if glpiUserId already exists
      const existing = await storage.getSolicitanteByGlpiId(data.glpiUserId);
      if (existing) {
        return res.status(400).json({ error: "ID do GLPI já cadastrado" });
      }
      
      const solicitante = await storage.createSolicitante(data);
      res.status(201).json(solicitante);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error creating solicitante:", error);
      res.status(500).json({ error: "Failed to create solicitante" });
    }
  });

  // Update a solicitante
  app.patch("/api/solicitantes/:id", async (req, res) => {
    try {
      const data = insertSolicitanteSchema.partial().parse(req.body);
      const solicitante = await storage.updateSolicitante(req.params.id, data);
      if (!solicitante) {
        return res.status(404).json({ error: "Solicitante não encontrado" });
      }
      res.json(solicitante);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error updating solicitante:", error);
      res.status(500).json({ error: "Failed to update solicitante" });
    }
  });

  // Delete a solicitante
  app.delete("/api/solicitantes/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteSolicitante(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Solicitante não encontrado" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting solicitante:", error);
      res.status(500).json({ error: "Failed to delete solicitante" });
    }
  });

  // ===========================
  // SLA Configuration Routes
  // ===========================
  
  // Get SLA configuration
  app.get("/api/sla-config", async (req, res) => {
    try {
      const config = await storage.getSlaConfig();
      res.json(config);
    } catch (error) {
      console.error("Error getting SLA config:", error);
      res.status(500).json({ error: "Failed to get SLA configuration" });
    }
  });

  // Update SLA configuration
  app.post("/api/sla-config", async (req, res) => {
    try {
      const data = slaConfigUpdateSchema.parse(req.body);
      const config = await storage.updateSlaConfig(data);
      res.json(config);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error updating SLA config:", error);
      res.status(500).json({ error: "Failed to update SLA configuration" });
    }
  });

  // ===========================
  // GLPI Configuration Routes
  // ===========================

  app.get("/api/glpi-config", async (_req, res) => {
    try {
      const config = await storage.getGlpiConfig();
      res.json({
        apiUrl: config.apiUrl || "",
        appToken: config.appToken ? "****" + config.appToken.slice(-4) : "",
        userToken: config.userToken ? "****" + config.userToken.slice(-4) : "",
        hasConfig: !!(config.apiUrl && config.appToken && config.userToken),
      });
    } catch (error) {
      console.error("Error getting GLPI config:", error);
      res.status(500).json({ error: "Failed to get GLPI configuration" });
    }
  });

  app.post("/api/glpi-config", async (req, res) => {
    try {
      const schema = z.object({
        apiUrl: z.string().min(1, "URL é obrigatória"),
        appToken: z.string().default(""),
        userToken: z.string().default(""),
      });
      const data = schema.parse(req.body);
      const existing = await storage.getGlpiConfig();
      const merged = {
        apiUrl: data.apiUrl,
        appToken: data.appToken || existing.appToken,
        userToken: data.userToken || existing.userToken,
      };
      if (!merged.appToken || !merged.userToken) {
        return res.status(400).json({ error: "App-Token e User-Token são obrigatórios" });
      }
      await storage.setGlpiConfig(merged);
      setGlpiRuntimeConfig(merged);
      res.json({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Dados inválidos" });
      }
      console.error("Error saving GLPI config:", error);
      res.status(500).json({ error: "Failed to save GLPI configuration" });
    }
  });

  app.post("/api/glpi-config/test", async (req, res) => {
    try {
      const schema = z.object({
        apiUrl: z.string().min(1),
        appToken: z.string().min(1),
        userToken: z.string().min(1),
      });
      const data = schema.parse(req.body);
      const result = await testGlpiConnection(data.apiUrl, data.appToken, data.userToken);
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: "Preencha todos os campos" });
      }
      console.error("Error testing GLPI connection:", error);
      res.status(500).json({ success: false, message: "Erro interno ao testar conexão" });
    }
  });

  // ===========================
  // Projeto Routes
  // ===========================

  app.get("/api/projetos", async (_req, res) => {
    try {
      const projetos = await storage.getAllProjetos();
      res.json(projetos);
    } catch (error) {
      console.error("Error fetching projetos:", error);
      res.status(500).json({ error: "Failed to fetch projetos" });
    }
  });

  app.get("/api/projetos/:id", async (req, res) => {
    try {
      const projeto = await storage.getProjetoById(req.params.id);
      if (!projeto) return res.status(404).json({ error: "Projeto não encontrado" });
      res.json(projeto);
    } catch (error) {
      console.error("Error fetching projeto:", error);
      res.status(500).json({ error: "Failed to fetch projeto" });
    }
  });

  app.post("/api/projetos", async (req, res) => {
    try {
      const data = insertProjetoSchema.parse(req.body);
      const projeto = await storage.createProjeto(data);
      res.status(201).json(projeto);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error creating projeto:", error);
      res.status(500).json({ error: "Failed to create projeto" });
    }
  });

  app.patch("/api/projetos/:id", async (req, res) => {
    try {
      const data = updateProjetoSchema.parse(req.body);
      const projeto = await storage.updateProjeto(req.params.id, data);
      if (!projeto) return res.status(404).json({ error: "Projeto não encontrado" });
      res.json(projeto);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error updating projeto:", error);
      res.status(500).json({ error: "Failed to update projeto" });
    }
  });

  app.delete("/api/projetos/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteProjeto(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Projeto não encontrado" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting projeto:", error);
      res.status(500).json({ error: "Failed to delete projeto" });
    }
  });

  // Etapa Routes
  app.post("/api/etapas", async (req, res) => {
    try {
      const data = insertEtapaSchema.parse(req.body);
      const etapa = await storage.createEtapa(data);
      res.status(201).json(etapa);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error creating etapa:", error);
      res.status(500).json({ error: "Failed to create etapa" });
    }
  });

  app.patch("/api/etapas/:id", async (req, res) => {
    try {
      const data = updateEtapaSchema.parse(req.body);
      const etapa = await storage.updateEtapa(req.params.id, data);
      if (!etapa) return res.status(404).json({ error: "Etapa não encontrada" });
      res.json(etapa);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error updating etapa:", error);
      res.status(500).json({ error: "Failed to update etapa" });
    }
  });

  app.delete("/api/etapas/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteEtapa(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Etapa não encontrada" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting etapa:", error);
      res.status(500).json({ error: "Failed to delete etapa" });
    }
  });

  // ===========================
  // Disparos Routes
  // ===========================

  // GET all disparos (optional ?data=YYYY-MM-DD filter)
  app.get("/api/disparos", async (req, res) => {
    try {
      const data = req.query.data as string | undefined;
      const disparos = await storage.getAllDisparos(data);
      // Return without file content for list view (save bandwidth)
      const safe = disparos.map(d => ({ ...d, arquivoConteudo: d.arquivoConteudo ? "[presente]" : undefined }));
      res.json(safe);
    } catch (error) {
      console.error("Error getting disparos:", error);
      res.status(500).json({ error: "Failed to get disparos" });
    }
  });

  // GET cronograma — MUST be before /:id to avoid route conflict
  app.get("/api/disparos/cronograma/:data", async (req, res) => {
    try {
      const { data } = req.params;
      const disparos = await storage.getAllDisparos(data);
      const cronograma: Record<string, typeof disparos> = {};
      for (const d of disparos) {
        const hora = d.horario.substring(0, 2) + ":00";
        if (!cronograma[hora]) cronograma[hora] = [];
        cronograma[hora].push({ ...d, arquivoConteudo: d.arquivoConteudo ? "[presente]" : undefined });
      }
      res.json({ data, cronograma });
    } catch (error) {
      res.status(500).json({ error: "Failed to get cronograma" });
    }
  });

  // GET single disparo by ID
  app.get("/api/disparos/:id", async (req, res) => {
    try {
      const disparo = await storage.getDisparoById(req.params.id);
      if (!disparo) return res.status(404).json({ error: "Disparo não encontrado" });
      // Safe version without full CSV content
      res.json({ ...disparo, arquivoConteudo: disparo.arquivoConteudo ? "[presente]" : undefined });
    } catch (error) {
      res.status(500).json({ error: "Failed to get disparo" });
    }
  });

  // GET disparo logs
  app.get("/api/disparos/:id/logs", async (req, res) => {
    try {
      const disparo = await storage.getDisparoById(req.params.id);
      if (!disparo) return res.status(404).json({ error: "Disparo não encontrado" });
      res.json({ logs: disparo.logs, status: disparo.status, processados: disparo.processados, erros: disparo.erros, totalRegistros: disparo.totalRegistros });
    } catch (error) {
      res.status(500).json({ error: "Failed to get logs" });
    }
  });

  // POST create disparo
  app.post("/api/disparos", async (req, res) => {
    try {
      const parsed = insertDisparoSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Dados inválidos", details: parsed.error.errors });
      }
      const disparo = await storage.createDisparo(parsed.data);
      res.status(201).json({ ...disparo, arquivoConteudo: disparo.arquivoConteudo ? "[presente]" : undefined });
    } catch (error) {
      console.error("Error creating disparo:", error);
      res.status(500).json({ error: "Failed to create disparo" });
    }
  });

  // PATCH update disparo (reschedule, edit)
  app.patch("/api/disparos/:id", async (req, res) => {
    try {
      const parsed = updateDisparoSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Dados inválidos", details: parsed.error.errors });
      }
      const disparo = await storage.updateDisparo(req.params.id, parsed.data);
      if (!disparo) return res.status(404).json({ error: "Disparo não encontrado" });
      res.json({ ...disparo, arquivoConteudo: disparo.arquivoConteudo ? "[presente]" : undefined });
    } catch (error) {
      console.error("Error updating disparo:", error);
      res.status(500).json({ error: "Failed to update disparo" });
    }
  });

  // POST stop a running disparo
  app.post("/api/disparos/:id/parar", async (req, res) => {
    try {
      const disparo = await storage.getDisparoById(req.params.id);
      if (!disparo) return res.status(404).json({ error: "Disparo não encontrado" });
      if (disparo.status !== "executando" && disparo.status !== "agendado") {
        return res.status(400).json({ error: "Disparo não pode ser parado no status atual" });
      }
      const updated = await storage.updateDisparo(req.params.id, { status: "parado" });
      res.json({ ...updated, arquivoConteudo: undefined });
    } catch (error) {
      res.status(500).json({ error: "Failed to stop disparo" });
    }
  });

  // POST reagendar (reset to agendado with new time)
  app.post("/api/disparos/:id/reagendar", async (req, res) => {
    try {
      const { horario, data } = req.body;
      if (!horario) return res.status(400).json({ error: "Horário é obrigatório" });
      const disparo = await storage.getDisparoById(req.params.id);
      if (!disparo) return res.status(404).json({ error: "Disparo não encontrado" });
      const updated = await storage.updateDisparo(req.params.id, {
        horario,
        ...(data ? { data } : {}),
        status: "agendado",
        processados: 0,
        erros: 0,
        logs: [],
        iniciadoEm: undefined,
        concluidoEm: undefined,
      });
      res.json({ ...updated, arquivoConteudo: undefined });
    } catch (error) {
      res.status(500).json({ error: "Failed to reagendar disparo" });
    }
  });

  // POST disparar agora (manual trigger)
  app.post("/api/disparos/:id/disparar", async (req, res) => {
    try {
      const disparo = await storage.getDisparoById(req.params.id);
      if (!disparo) return res.status(404).json({ error: "Disparo não encontrado" });
      if (disparo.status === "executando") {
        return res.status(400).json({ error: "Disparo já está em execução" });
      }
      // Reset and fire
      await storage.updateDisparo(disparo.id, { status: "agendado", processados: 0, erros: 0, logs: [], iniciadoEm: undefined, concluidoEm: undefined });
      const fresh = await storage.getDisparoById(disparo.id);
      executeDisparo(fresh!).catch(err => console.error("[Disparos] Erro ao executar manual:", err));
      res.json({ message: "Disparo iniciado" });
    } catch (error) {
      res.status(500).json({ error: "Failed to trigger disparo" });
    }
  });

  // DELETE disparo
  app.delete("/api/disparos/:id", async (req, res) => {
    try {
      const disparo = await storage.getDisparoById(req.params.id);
      if (!disparo) return res.status(404).json({ error: "Disparo não encontrado" });
      if (disparo.status === "executando") {
        return res.status(400).json({ error: "Não é possível excluir um disparo em execução. Pare primeiro." });
      }
      const deleted = await storage.deleteDisparo(req.params.id);
      res.json({ success: deleted });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete disparo" });
    }
  });

  // ===========================
  // Disparo Config Routes
  // ===========================

  app.get("/api/disparo-config", async (req, res) => {
    try {
      const config = await storage.getDisparoConfig();
      // Mask token for display
      const masked = {
        apiUrl: config.apiUrl,
        apiToken: config.apiToken ? `****${config.apiToken.slice(-4)}` : "",
        hasConfig: !!(config.apiUrl && config.apiToken),
      };
      res.json(masked);
    } catch (error) {
      res.status(500).json({ error: "Failed to get config" });
    }
  });

  app.post("/api/disparo-config", async (req, res) => {
    try {
      const parsed = disparoConfigSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Dados inválidos" });
      await storage.setDisparoConfig(parsed.data);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save config" });
    }
  });

  // ===========================
  // Disparo CSV Template Download
  // ===========================

  app.get("/api/disparo-template.csv", (_req, res) => {
    const cols = [
      "lista_nome","marca","origem","nome","telefone","cursointeresse","nivelescolaridade",
      "email","cursoatual","semestre","idcursodesejado","modalidade","modalidadeperiodo",
      "unidade","datacadastro","faculdade","cpf","curso","canaldeorigem","regional",
      "datadenascimento","datahorariosaidacaptar","datahorarioinscricao",
    ];
    const header = cols.join(";");
    const example = [
      "Captacao_FMU_Jan","FMU","portal","João Silva","11999998888","Administração","Superior Completo",
      "joao@email.com","","","","Presencial","Noturno","São Paulo","","FMU","12345678900",
      "Administração","whatsapp","SP","01/01/2000","","",
    ].join(";");
    const bom = "\uFEFF";
    const csv = bom + header + "\n" + example + "\n";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="template_disparo.csv"');
    res.send(csv);
  });

  // ===========================
  // Disparo Canal Routes
  // ===========================

  app.get("/api/disparo-canais", async (req, res) => {
    try {
      res.json(await storage.getAllDisparoCanais());
    } catch (error) {
      res.status(500).json({ error: "Failed to get canais" });
    }
  });

  app.post("/api/disparo-canais", async (req, res) => {
    try {
      const parsed = insertDisparoCanalSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Dados inválidos", details: parsed.error.errors });
      res.status(201).json(await storage.createDisparoCanal(parsed.data));
    } catch (error) {
      res.status(500).json({ error: "Failed to create canal" });
    }
  });

  app.delete("/api/disparo-canais/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteDisparoCanal(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Canal não encontrado" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete canal" });
    }
  });

  // ===========================
  // Disparo Template Routes
  // ===========================

  app.get("/api/disparo-templates", async (req, res) => {
    try {
      const canalId = req.query.canalId as string | undefined;
      res.json(await storage.getAllDisparoTemplates(canalId));
    } catch (error) {
      res.status(500).json({ error: "Failed to get templates" });
    }
  });

  app.post("/api/disparo-templates", async (req, res) => {
    try {
      const parsed = insertDisparoTemplateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Dados inválidos", details: parsed.error.errors });
      res.status(201).json(await storage.createDisparoTemplate(parsed.data));
    } catch (error) {
      res.status(500).json({ error: "Failed to create template" });
    }
  });

  app.delete("/api/disparo-templates/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteDisparoTemplate(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Template não encontrado" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete template" });
    }
  });

  // ===========================
  // RPA Config Routes
  // ===========================

  app.get("/api/rpa-config", async (req, res) => {
    try {
      const cfg = await storage.getRpaConfig();
      res.json({ url: cfg.url, email: cfg.email, senha: cfg.senha ? "****" : "" });
    } catch (error) {
      res.status(500).json({ error: "Failed to get RPA config" });
    }
  });

  app.post("/api/rpa-config", async (req, res) => {
    try {
      const parsed = rpaConfigSchema.partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Dados inválidos", details: parsed.error.errors });
      await storage.setRpaConfig(parsed.data);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save RPA config" });
    }
  });

  // ── RPA: proxy routes (ConnectaCX live data) ────────────────────────────
  async function getConnectaCxJwt(cfg: { url: string; email: string; senha: string }) {
    const r = await fetch(`${cfg.url}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: cfg.email, password: cfg.senha }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Login ConnectaCX falhou: HTTP ${r.status}`);
    const json = await r.json() as any;
    const token = json.token ?? json.access_token;
    if (!token) throw new Error("Token não encontrado na resposta do login");
    return token as string;
  }

  app.get("/api/rpa-channels", async (_req, res) => {
    try {
      const cfg = await storage.getRpaConfig();
      if (!cfg.url || !cfg.email || !cfg.senha)
        return res.status(400).json({ error: "RPA não configurado" });
      const jwt = await getConnectaCxJwt(cfg);
      const r = await fetch(`${cfg.url}/channel/?session=0&status=all`, {
        headers: { Authorization: `Bearer ${jwt}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) return res.status(502).json({ error: `ConnectaCX: HTTP ${r.status}` });
      const all = await r.json() as any[];
      // Retorna todos; filtra apenas canais inativos/desconectados com status explícito de offline
      const inactive = new Set(["DISCONNECTED", "BANNED", "DELETED", "ERROR"]);
      res.json(all.filter((c: any) => !inactive.has(String(c.status ?? "").toUpperCase())));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/rpa-templates-live/:channelId", async (req, res) => {
    try {
      const cfg = await storage.getRpaConfig();
      if (!cfg.url || !cfg.email || !cfg.senha)
        return res.status(400).json({ error: "RPA não configurado" });
      const jwt = await getConnectaCxJwt(cfg);

      const templates: any[] = [];
      const seen = new Set<string>();
      let after: string | null = null;
      let iters = 0;
      while (iters++ < 20) {
        const url = new URL(`${cfg.url}/omnichannel/templates/${req.params.channelId}`);
        if (after) url.searchParams.set("after", after);
        const r = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${jwt}` },
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) break;
        const body = await r.json() as any;
        const novos = (body.data ?? []).filter((t: any) => !seen.has(String(t.id)));
        if (!novos.length) break;
        novos.forEach((t: any) => seen.add(String(t.id)));
        templates.push(...novos);
        const next = body.paging?.cursors?.after;
        if (!next || next === after) break;
        after = next;
      }
      res.json(templates.filter((t: any) => t.status === "APPROVED"));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/rpa-queues", async (_req, res) => {
    try {
      const cfg = await storage.getRpaConfig();
      if (!cfg.url || !cfg.email || !cfg.senha)
        return res.status(400).json({ error: "RPA não configurado" });
      const jwt = await getConnectaCxJwt(cfg);
      const r = await fetch(`${cfg.url}/queue/?status=actives`, {
        headers: { Authorization: `Bearer ${jwt}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) return res.status(502).json({ error: `ConnectaCX: HTTP ${r.status}` });
      res.json(await r.json());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ===========================
  // RPA Disparo Routes
  // ===========================

  app.get("/api/rpa-disparos", async (req, res) => {
    try {
      const data = req.query.data as string | undefined;
      res.json(await storage.getAllRpaDisparos(data));
    } catch (error) {
      res.status(500).json({ error: "Failed to get RPA disparos" });
    }
  });

  app.post("/api/rpa-disparos", async (req, res) => {
    try {
      const parsed = insertRpaDisparoSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Dados inválidos", details: parsed.error.errors });
      const created = await storage.createRpaDisparo(parsed.data);
      res.status(201).json(created);
    } catch (error) {
      res.status(500).json({ error: "Failed to create RPA disparo" });
    }
  });

  app.delete("/api/rpa-disparos/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteRpaDisparo(req.params.id);
      if (!deleted) return res.status(404).json({ error: "RPA Disparo não encontrado" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete RPA disparo" });
    }
  });

  app.post("/api/rpa-disparos/:id/executar", async (req, res) => {
    try {
      const disparo = await storage.getRpaDisparoById(req.params.id);
      if (!disparo) return res.status(404).json({ error: "RPA Disparo não encontrado" });
      if (disparo.status === "em_andamento") return res.status(409).json({ error: "Disparo já está em execução" });
      res.json({ success: true, message: "Execução iniciada" });
      // Run asynchronously
      runRpaDisparo(disparo.id);
    } catch (error) {
      res.status(500).json({ error: "Failed to start RPA disparo" });
    }
  });

  // ── Proxy de acompanhamento de campanha ConnectaCX ──────────────────────────

  async function getConnectaJwt(): Promise<{ jwt: string; cfg: any }> {
    const cfg = await storage.getRpaConfig();
    if (!cfg.url || !cfg.email || !cfg.senha) throw new Error("RPA não configurado");
    const r = await fetch(`${cfg.url}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: cfg.email, password: cfg.senha }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Login falhou: HTTP ${r.status}`);
    const j = await r.json() as any;
    const jwt = j.token ?? j.access_token;
    if (!jwt) throw new Error("Token não encontrado");
    return { jwt, cfg };
  }

  // Vincula manualmente um campanhaId a um disparo (para disparos antigos)
  app.patch("/api/rpa-disparos/:id/campanha", async (req, res) => {
    try {
      const { campanhaId } = req.body;
      if (!campanhaId || isNaN(Number(campanhaId)))
        return res.status(400).json({ error: "campanhaId inválido" });
      const updated = await storage.updateRpaDisparo(req.params.id, { campanhaId: Number(campanhaId) });
      if (!updated) return res.status(404).json({ error: "Disparo não encontrado" });
      res.json({ success: true, campanhaId: Number(campanhaId) });
    } catch { res.status(500).json({ error: "Erro ao vincular campanha" }); }
  });

  app.get("/api/rpa-campanha/:campanhaId/status", async (req, res) => {
    try {
      const { jwt, cfg } = await getConnectaJwt();
      const r = await fetch(`${cfg.url}/campaigns/${req.params.campanhaId}`, {
        headers: { Authorization: `Bearer ${jwt}` },
        signal: AbortSignal.timeout(15000),
      });
      const data = await r.json();
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/rpa-campanha/:campanhaId/contatos", async (req, res) => {
    try {
      const { jwt, cfg } = await getConnectaJwt();
      const page = req.query.page ?? 1;
      const r = await fetch(
        `${cfg.url}/campaigns/${req.params.campanhaId}/contacts?campaignId=${req.params.campanhaId}&page=${page}`,
        { headers: { Authorization: `Bearer ${jwt}` }, signal: AbortSignal.timeout(15000) }
      );
      const data = await r.json();
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/rpa-campanha/:campanhaId/exportar", async (req, res) => {
    try {
      const { jwt, cfg } = await getConnectaJwt();
      const statuses: Record<string, string> = {
        waiting: "Na fila", sent: "Enviado", failed: "Falha",
        sent_failed: "Falha no envio", delivered: "Entregue",
        invalid_number: "Número inválido", read: "Lido",
        answered: "Respondido", chat_opened: "Já em chat", wrapped_up: "Concluído",
      };
      const params = new URLSearchParams({ download: "true" });
      for (const [k, v] of Object.entries(statuses)) params.append(`statuses_translates[${k}]`, v);
      const r = await fetch(
        `${cfg.url}/campaigns/${req.params.campanhaId}/contacts?${params}`,
        { headers: { Authorization: `Bearer ${jwt}` }, signal: AbortSignal.timeout(30000) }
      );
      const csv = await r.text();
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="campanha_${req.params.campanhaId}.csv"`);
      res.send(csv);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===========================
  // RPA Canal Routes
  // ===========================

  app.get("/api/rpa-canais", async (req, res) => {
    try { res.json(await storage.getAllRpaCanais()); }
    catch { res.status(500).json({ error: "Failed to get RPA canais" }); }
  });

  app.post("/api/rpa-canais", async (req, res) => {
    try {
      const parsed = insertRpaCanalSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Dados inválidos", details: parsed.error.errors });
      res.status(201).json(await storage.createRpaCanal(parsed.data));
    } catch { res.status(500).json({ error: "Failed to create RPA canal" }); }
  });

  app.delete("/api/rpa-canais/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteRpaCanal(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Canal não encontrado" });
      res.json({ success: true });
    } catch { res.status(500).json({ error: "Failed to delete RPA canal" }); }
  });

  // ===========================
  // RPA Template Routes
  // ===========================

  app.get("/api/rpa-templates", async (req, res) => {
    try {
      const canalId = req.query.canalId as string | undefined;
      res.json(await storage.getAllRpaTemplates(canalId));
    } catch { res.status(500).json({ error: "Failed to get RPA templates" }); }
  });

  app.post("/api/rpa-templates", async (req, res) => {
    try {
      const parsed = insertRpaTemplateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Dados inválidos", details: parsed.error.errors });
      res.status(201).json(await storage.createRpaTemplate(parsed.data));
    } catch { res.status(500).json({ error: "Failed to create RPA template" }); }
  });

  app.delete("/api/rpa-templates/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteRpaTemplate(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Template não encontrado" });
      res.json({ success: true });
    } catch { res.status(500).json({ error: "Failed to delete RPA template" }); }
  });

  // ===========================
  // RPA Scheduler
  // ===========================

  // ── Helpers de transformação de template ─────────────────────────────────
  // Remove acentos e normaliza para comparação de cabeçalhos CSV
  function normKey(s: string): string {
    return s.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[\s_\-]/g, "");
  }

  function buildCsvMapping(headers: string[]): Array<{ header: string; value: string }> {
    const nameKeys  = ["nome", "name", "contactname", "nomecompleto", "nomecontato"];
    const phoneKeys = ["telefone", "numero", "phone", "contactnumber", "fone", "celular", "whatsapp"];
    let extra = 1;
    return headers.map(h => {
      const hl = normKey(h);
      if (nameKeys.some(k => hl.includes(k)))  return { header: h, value: "contact_name" };
      if (phoneKeys.some(k => hl.includes(k))) return { header: h, value: "contact_number" };
      return { header: h, value: `extra_${extra++}` };
    });
  }

  // Transforma o template Meta para o formato de campanha ConnectaCX.
  // varMapping: { "1": "NomeColunaCsv", "2": "OutraColuna" } — mapeamento explícito do usuário.
  function transformTemplateForCampaign(
    raw: any,
    csvHeaders: string[],
    varMapping?: Record<string, string>
  ): object {
    const csvMap = buildCsvMapping(csvHeaders);
    // Monta lookup: header CSV → field ConnectaCX (contact_name → firstName internamente)
    const headerToField: Record<string, string> = {};
    for (const m of csvMap) {
      headerToField[m.header] = m.value === "contact_name" ? "firstName" : m.value;
    }

    const bodyComp    = (raw.components ?? []).find((c: any) => c.type === "BODY");
    const buttonsComp = (raw.components ?? []).find((c: any) => c.type === "BUTTONS");
    let bodyText: string = bodyComp?.text ?? "";

    const varNums = [...new Set((bodyText.match(/\{\{(\d+)\}\}/g) ?? []).map(m => parseInt(m.replace(/[{}]/g, ""))))].sort((a, b) => a - b);
    const parameters: any[] = [];

    // Extras = colunas que não são nome nem telefone (na ordem original)
    const extras = csvHeaders.filter(h => {
      const m = csvMap.find(mm => mm.header === h);
      return m && m.value !== "contact_name" && m.value !== "contact_number";
    });

    for (const n of varNums) {
      let fieldName: string;
      if (varMapping && varMapping[String(n)]) {
        // Mapeamento explícito do usuário
        const col = varMapping[String(n)];
        fieldName = headerToField[col] ?? col;
      } else {
        // Fallback automático: {{1}} → firstName, {{2}}+ → extras em ordem
        fieldName = n === 1 ? "firstName" : (headerToField[extras[n - 2]] ?? `extra_${n - 1}`);
      }
      bodyText = bodyText.split(`{{${n}}}`).join(`{{${fieldName}}}`);
      parameters.push({ type: "text", text: `{{${fieldName}}}` });
    }

    const payload: any = {
      name:       raw.name,
      language:   null,
      body:       bodyText,
      components: [{ type: "body", parameters }],
      category:   raw.category,
    };
    if (buttonsComp) payload.buttons = { buttons: buttonsComp.buttons };
    return payload;
  }

  // ── Execução de um RpaDisparo via REST ────────────────────────────────────
  async function runRpaDisparo(id: string) {
    const disparo = await storage.getRpaDisparoById(id);
    if (!disparo) return;

    const cfg = await storage.getRpaConfig();
    const rlog = (msg: string) => `[${new Date().toLocaleTimeString("pt-BR")}] ${msg}`;

    if (!cfg.url || !cfg.email || !cfg.senha) {
      await storage.updateRpaDisparo(id, {
        status: "erro",
        logs: [rlog("❌ RPA não configurado. Configure URL, e-mail e senha em Configuração.")],
        concluidoEm: Date.now(),
      });
      return;
    }

    // Quality gate — bloqueia se MetaTemplate com mesmo nome estiver RED
    if (disparo.templateNome) {
      const metaTemplates = await storage.getAllMetaTemplates();
      const matched = metaTemplates.find(t => t.name === disparo.templateNome);
      if (matched?.qualityScore === "RED") {
        await storage.updateRpaDisparo(id, {
          status: "erro",
          logs: [rlog(`⚠️ Template "${disparo.templateNome}" com qualidade BAIXA (RED) — disparo bloqueado.`)],
          iniciadoEm: Date.now(),
          concluidoEm: Date.now(),
        });
        return;
      }
    }

    const logs: string[] = [];
    await storage.updateRpaDisparo(id, { status: "em_andamento", iniciadoEm: Date.now(), logs: [] });

    try {
      // 1. Login
      logs.push(rlog(`🔐 Autenticando em ${cfg.url}…`));
      await storage.updateRpaDisparo(id, { logs: [...logs] });

      const loginResp = await fetch(`${cfg.url}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cfg.email, password: cfg.senha }),
        signal: AbortSignal.timeout(15000),
      });
      if (!loginResp.ok) throw new Error(`Login falhou: HTTP ${loginResp.status}`);
      const loginJson = await loginResp.json() as any;
      const jwt = loginJson.token ?? loginJson.access_token;
      if (!jwt) throw new Error("Token não encontrado na resposta do login");
      logs.push(rlog("✅ Autenticado"));

      // 2. Parse CSV
      if (!disparo.arquivoConteudo) throw new Error("Nenhum CSV anexado ao disparo");
      const csvLines = disparo.arquivoConteudo.split("\n").filter(l => l.trim());
      const sep = csvLines[0]?.includes(";") ? ";" : ",";
      const csvHeaders = csvLines[0]?.split(sep).map(h => h.trim().replace(/^"|"$/g, "")) ?? [];
      const totalRows = csvLines.length - 1;
      logs.push(rlog(`📋 CSV: ${totalRows} registro(s), ${csvHeaders.length} coluna(s)`));

      // 3. Build mapping + transform template
      const mapping = buildCsvMapping(csvHeaders);
      const templateRaw = JSON.parse(disparo.templateRaw ?? "{}");
      const templatePayload = transformTemplateForCampaign(templateRaw, csvHeaders, disparo.varMapping as Record<string, string> | undefined);
      logs.push(rlog(`📝 Template "${disparo.templateNome}" transformado`));
      await storage.updateRpaDisparo(id, { logs: [...logs] });

      // 4. Build multipart form
      const slug = `${disparo.nome.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${Date.now()}`.slice(0, 60);
      // ConnectaCX exige que init_timestamp seja no futuro.
      // Se o horário agendado já passou (ex.: reexecução manual), usamos now+2min.
      const scheduledTs = new Date(`${disparo.data}T${disparo.horario}:00`);
      const nowPlus2 = new Date(Date.now() + 2 * 60 * 1000);
      const initTs = scheduledTs > nowPlus2 ? scheduledTs.toISOString() : nowPlus2.toISOString();

      const formData = new FormData();
      formData.append("file", new Blob([disparo.arquivoConteudo], { type: "text/csv" }), disparo.arquivoNome ?? "base.csv");
      formData.append("mapping", JSON.stringify(mapping));
      formData.append("template", JSON.stringify(templatePayload));
      formData.append("channel", JSON.stringify({ id: disparo.canalExternalId }));
      formData.append("send_name", disparo.nome);
      formData.append("slug", slug);
      formData.append("message_type", "template");
      formData.append("type", "file");
      formData.append("open_ticket", "1");
      formData.append("send_avg_time", "10");
      formData.append("init_timestamp", initTs);
      formData.append("tags_operator", "and");
      formData.append("tags_mode", "all");
      if (disparo.filaExternalId) formData.append("queue", JSON.stringify({ id: disparo.filaExternalId }));

      logs.push(rlog(`🚀 Enviando campanha para ConnectaCX…`));
      await storage.updateRpaDisparo(id, { logs: [...logs] });

      // 5. POST /campaigns
      const campResp = await fetch(`${cfg.url}/campaigns?formData=true`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
        body: formData,
        signal: AbortSignal.timeout(120000),
      });
      const campText = await campResp.text().catch(() => "");
      if (!campResp.ok) throw new Error(`Campanha falhou: HTTP ${campResp.status} — ${campText.slice(0, 200)}`);

      logs.push(rlog(`✅ Campanha criada! HTTP ${campResp.status}`));
      // Extrai campanhaId pelo regex para não depender de JSON.parse completo
      let campanhaId: number | undefined;
      const idMatch = campText.match(/"id"\s*:\s*(\d+)/);
      if (idMatch) campanhaId = parseInt(idMatch[1], 10);
      if (campanhaId) logs.push(rlog(`🆔 Campanha ConnectaCX: #${campanhaId}`));
      else if (campText) logs.push(rlog(`Resposta: ${campText.slice(0, 200)}`));
      await storage.updateRpaDisparo(id, { status: "concluido", concluidoEm: Date.now(), campanhaId, logs: [...logs] });

    } catch (err: any) {
      logs.push(rlog(`❌ ERRO: ${err?.message ?? String(err)}`));
      await storage.updateRpaDisparo(id, { status: "erro", concluidoEm: Date.now(), logs: [...logs] });
    }
  }

  function startRpaScheduler() {
    setInterval(async () => {
      try {
        const brNow = getBRDateTime(); // YYYY-MM-DD HH:MM
        const [nowDate, nowTime] = brNow.split(" ");
        const agendados = await storage.getRpaDisparosAgendados();
        for (const d of agendados) {
          if (d.data === nowDate && d.horario <= nowTime) {
            console.log(`[RPA Scheduler] Disparando RPA: ${d.nome} (${d.id})`);
            runRpaDisparo(d.id);
          }
        }
      } catch (err) {
        console.error("[RPA Scheduler] Erro:", err);
      }
    }, 30000);
    console.log("[RPA] Scheduler iniciado (verifica a cada 30s)");
  }

  startRpaScheduler();

  // ===========================
  // Régua Automática — Config
  // ===========================

  // GET /api/regua-config — returns masked config (never expose credentialsJson)
  app.get("/api/regua-config", async (req, res) => {
    try {
      const cfg = await storage.getReguaConfig();
      res.json({
        projectId: cfg.projectId,
        dataset: cfg.dataset,
        discadorUrl: cfg.discadorUrl,
        discadorKey: cfg.discadorKey ? "****" + cfg.discadorKey.slice(-4) : "",
        configured: !!(cfg.credentialsJson && cfg.projectId),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/regua-config", async (req, res) => {
    try {
      const body = req.body;
      // Sanitize the credentials JSON to fix literal newlines in private_key
      // (common when copy-pasting from some sources)
      let credJson = body.credentialsJson ?? "";
      if (credJson) {
        credJson = sanitizeCredentialsJson(credJson);
      }
      await storage.setReguaConfig({
        projectId: body.projectId ?? "",
        dataset: body.dataset ?? "",
        credentialsJson: credJson,
        discadorKey: body.discadorKey ?? "",
        discadorUrl: body.discadorUrl ?? "",
      });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/regua-config/test", async (req, res) => {
    try {
      const cfg = await storage.getReguaConfig();
      if (!cfg.credentialsJson) return res.status(400).json({ error: "Credenciais BigQuery não configuradas." });
      const datasets = await bqListDatasets(cfg.credentialsJson);
      res.json({ ok: true, datasets });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ===========================
  // Régua — BigQuery exploration
  // ===========================

  app.get("/api/regua-datasets", async (req, res) => {
    try {
      const cfg = await storage.getReguaConfig();
      if (!cfg.credentialsJson) return res.status(400).json({ error: "Credenciais não configuradas." });
      const datasets = await bqListDatasets(cfg.credentialsJson);
      res.json(datasets);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/regua-tables", async (req, res) => {
    try {
      const dataset = String(req.query.dataset ?? "");
      if (!dataset) return res.status(400).json({ error: "dataset é obrigatório." });
      const cfg = await storage.getReguaConfig();
      if (!cfg.credentialsJson) return res.status(400).json({ error: "Credenciais não configuradas." });
      const tables = await bqListTables(cfg.credentialsJson, cfg.projectId, dataset);
      res.json(tables);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/regua-schema", async (req, res) => {
    try {
      const dataset = String(req.query.dataset ?? "");
      const table = String(req.query.table ?? "");
      if (!dataset || !table) return res.status(400).json({ error: "dataset e table são obrigatórios." });
      const cfg = await storage.getReguaConfig();
      if (!cfg.credentialsJson) return res.status(400).json({ error: "Credenciais não configuradas." });
      const schema = await bqGetSchema(cfg.credentialsJson, cfg.projectId, dataset, table);
      res.json(schema);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/regua-preview — run query with LIMIT 10 for preview
  app.get("/api/regua-preview", async (req, res) => {
    try {
      const dataset = String(req.query.dataset ?? "");
      const table = String(req.query.table ?? "");
      if (!dataset || !table) return res.status(400).json({ error: "dataset e table são obrigatórios." });
      const cfg = await storage.getReguaConfig();
      if (!cfg.credentialsJson) return res.status(400).json({ error: "Credenciais não configuradas." });
      const filtros = req.query.filtros ? JSON.parse(String(req.query.filtros)) : [];
      const [rows, total] = await Promise.all([
        bqRunQuery(cfg.credentialsJson, cfg.projectId, dataset, table, [], filtros, 10),
        bqCountQuery(cfg.credentialsJson, cfg.projectId, dataset, table, filtros),
      ]);
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      res.json({ columns, rows, total });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===========================
  // Régua — Rotinas CRUD
  // ===========================

  app.get("/api/regua-rotinas", async (req, res) => {
    try {
      const rotinas = await storage.getAllReguaRotinas();
      res.json(rotinas);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/regua-rotinas/:id", async (req, res) => {
    try {
      const rotina = await storage.getReguaRotinaById(req.params.id);
      if (!rotina) return res.status(404).json({ error: "Rotina não encontrada." });
      res.json(rotina);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/regua-rotinas", async (req, res) => {
    try {
      const parsed = insertReguaRotinaSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      const rotina = await storage.createReguaRotina(parsed.data);
      // Calculate first nextRun
      const next = calcNextRun(rotina);
      if (next) await storage.updateReguaRotina(rotina.id, { proximaExecucao: next });
      const updated = await storage.getReguaRotinaById(rotina.id);
      res.status(201).json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/regua-rotinas/:id", async (req, res) => {
    try {
      const updated = await storage.updateReguaRotina(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: "Rotina não encontrada." });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/regua-rotinas/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteReguaRotina(req.params.id);
      res.json({ deleted });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Manual execution
  app.post("/api/regua-rotinas/:id/executar", async (req, res) => {
    try {
      const rotina = await storage.getReguaRotinaById(req.params.id);
      if (!rotina) return res.status(404).json({ error: "Rotina não encontrada." });
      res.json({ started: true });
      // Run in background
      executeReguaRotina(rotina, storage).catch(e =>
        console.error(`[Régua] Erro manual na rotina ${rotina.nome}:`, e)
      );
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===========================
  // Régua — Logs
  // ===========================

  app.get("/api/regua-logs", async (req, res) => {
    try {
      const rotinaId = req.query.rotinaId as string | undefined;
      const limit = Number(req.query.limit ?? 100);
      const logs = await storage.getAllReguaLogs(rotinaId, limit);
      res.json(logs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  startReguaScheduler(storage);

  // ===========================
  // Python Scripts — Agent Config
  // ===========================

  app.get("/api/python-agent/download", (req, res) => {
    const agentPath = join(process.cwd(), "vm-agent", "agent.py");
    if (!existsSync(agentPath)) return res.status(404).json({ error: "agent.py não encontrado" });
    res.setHeader("Content-Disposition", 'attachment; filename="agent.py"');
    res.setHeader("Content-Type", "text/x-python");
    res.send(readFileSync(agentPath, "utf-8"));
  });

  app.get("/api/python-config", async (req, res) => {
    try {
      const cfg = await storage.getPythonAgentConfig();
      res.json({
        agentUrl: cfg.agentUrl,
        agentKey: cfg.agentKey ? `****${cfg.agentKey.slice(-4)}` : "",
        hasConfig: !!(cfg.agentUrl && cfg.agentKey),
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/python-config", async (req, res) => {
    try {
      const { agentUrl, agentKey } = req.body;
      await storage.setPythonAgentConfig({ agentUrl: agentUrl ?? "", agentKey: agentKey ?? "" });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/python-config/test", async (req, res) => {
    try {
      const cfg = await storage.getPythonAgentConfig();
      if (!cfg.agentUrl) return res.status(400).json({ error: "URL do agente não configurada." });
      const url = cfg.agentUrl.replace(/\/$/, "");
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
          "User-Agent": "ReplicationAgent/1.0",
        },
        body: JSON.stringify({ key: cfg.agentKey, script: "import sys, platform\nprint('ok')\nprint('Python:', sys.version.split()[0])\nprint('OS:', platform.system(), platform.release())" }),
        signal: AbortSignal.timeout(10000),
      });
      const text = await resp.text();
      if (resp.ok) {
        res.json({ ok: true, output: text.trim() });
      } else {
        res.status(400).json({ error: `Agente respondeu com status ${resp.status}: ${text}` });
      }
    } catch (e: any) { res.status(400).json({ error: `Não foi possível conectar ao agente: ${e.message}` }); }
  });

  // ===========================
  // Python Scripts — CRUD
  // ===========================

  // ── Python VM execution queue ────────────────────────────────
  let vmBusy = false;
  interface QueuedExec { scriptId: string; execId: string; scriptNome: string; origem: "manual" | "agendado"; enfileiradoEm: number; }
  const vmQueue: QueuedExec[] = [];

  // Cleanup stuck executions from a previous server run
  (async () => {
    try {
      const all = await storage.getAllPythonExecutions(undefined, 200);
      for (const exec of all) {
        if (exec.status === "executando" || exec.status === "aguardando") {
          await storage.updatePythonExecution(exec.id, {
            status: "erro",
            concluidoEm: Date.now(),
            logs: [...(exec.logs ?? []), "[ERRO] Execução interrompida pelo reinício do servidor."],
          });
        }
      }
    } catch {}
  })();

  // ── Helpers para janelaHorario ───────────────────────────────────────────
  function getWindowForDay(
    dow: number,
    janela: { inicio: string; fim: string; excecoes?: Array<{ dias: number[]; inicio: string; fim: string }> }
  ): { inicio: string; fim: string } | null {
    const exc = janela.excecoes?.find((e: any) => e.dias.includes(dow));
    if (exc) return (exc.inicio && exc.fim && exc.inicio < exc.fim) ? exc : null;
    return (janela.inicio && janela.fim && janela.inicio < janela.fim) ? { inicio: janela.inicio, fim: janela.fim } : null;
  }

  function applyJanelaToTimestamp(
    proposedTs: number,
    janela: { inicio: string; fim: string; excecoes?: Array<{ dias: number[]; inicio: string; fim: string }> },
    diasSemana?: number[]
  ): number | null {
    for (let offset = 0; offset < 8; offset++) {
      const d = new Date(proposedTs);
      if (offset > 0) { d.setDate(d.getDate() + offset); d.setHours(0, 0, 0, 0); }
      const dow = d.getDay();
      if (diasSemana && diasSemana.length > 0 && !diasSemana.includes(dow)) continue;
      const win = getWindowForDay(dow, janela);
      if (!win) continue;
      const base = new Date(d); base.setHours(0, 0, 0, 0);
      const [siH, siM] = win.inicio.split(":").map(Number);
      const [sfH, sfM] = win.fim.split(":").map(Number);
      const winStart = base.getTime() + (siH * 60 + siM) * 60_000;
      const winEnd   = base.getTime() + (sfH * 60 + sfM) * 60_000;
      if (offset === 0) {
        if (proposedTs >= winStart && proposedTs <= winEnd) return proposedTs;
        if (proposedTs < winStart) return winStart;
        // past window end → try next day
      } else {
        return winStart; // future day → snap to window start
      }
    }
    return null; // nenhum slot válido nos próximos 7 dias
  }

  function calcPythonNextRun(script: { agendamento?: any }): number | undefined {
    const ag = script.agendamento;
    if (!ag || ag.tipo === "nenhum" || ag.habilitado === false) return undefined;
    const now = new Date();

    // ── repetirCada: próxima execução = agora + intervalo ────────────────────
    // periodoMinutos === 0 significa indeterminado (roda para sempre)
    if (ag.repetirCada) {
      const { valor, unidade, periodoMinutos } = ag.repetirCada;
      const intervalMs = valor * (unidade === "horas" ? 3_600_000 : 60_000);
      let nextTs = Date.now() + intervalMs;
      if (ag.expiraEm && nextTs > new Date(ag.expiraEm).getTime()) return undefined;

      // janelaHorario tem prioridade sobre periodoMinutos
      if (ag.janelaHorario) {
        const adjusted = applyJanelaToTimestamp(nextTs, ag.janelaHorario, (ag.tipo === "semanal" || ag.tipo === "diario") ? ag.diasSemana : undefined);
        if (adjusted === null) return undefined;
        nextTs = adjusted;
        if (ag.expiraEm && nextTs > new Date(ag.expiraEm).getTime()) return undefined;
      } else if (periodoMinutos && periodoMinutos > 0 && ag.horario) {
        // Período finito sem janela: respeita janela baseada em horario + periodoMinutos
        const [hh, mm] = ag.horario.split(":").map(Number);
        const windowStart = new Date();
        windowStart.setHours(hh, mm, 0, 0);
        const windowEnd = windowStart.getTime() + periodoMinutos * 60_000;
        if (nextTs > windowEnd) {
          const tomorrow = new Date(windowStart);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const r = tomorrow.getTime();
          if (ag.expiraEm && r > new Date(ag.expiraEm).getTime()) return undefined;
          return ag.atrasoAleatorio ? r + Math.random() * ag.atrasoAleatorio * 60_000 : r;
        }
      }
      return ag.atrasoAleatorio ? nextTs + Math.random() * ag.atrasoAleatorio * 60_000 : nextTs;
    }

    // ── Lógica de schedule base (sem repetição intra-dia) ────────────────────
    if (ag.tipo === "uma_vez") {
      if (!ag.dataHoraUnica) return undefined;
      const t = new Date(ag.dataHoraUnica).getTime();
      return t > now.getTime() ? t : undefined;
    }
    if (ag.tipo === "diario" || ag.tipo === "semanal" || ag.tipo === "mensal") {
      if (!ag.horario) return undefined;
      const [hh, mm] = ag.horario.split(":").map(Number);
      if (ag.tipo === "semanal" && ag.diasSemana && ag.diasSemana.length > 0) {
        for (let d = 0; d < 7; d++) {
          const c = new Date();
          c.setDate(now.getDate() + d);
          c.setHours(hh, mm, 0, 0);
          if (c > now && ag.diasSemana.includes(c.getDay())) {
            const r = c.getTime();
            if (ag.expiraEm && r > new Date(ag.expiraEm).getTime()) return undefined;
            return ag.atrasoAleatorio ? r + Math.random() * ag.atrasoAleatorio * 60000 : r;
          }
        }
        return undefined;
      }
      if (ag.tipo === "mensal" && ag.diaMes) {
        const c = new Date(now.getFullYear(), now.getMonth(), ag.diaMes, hh, mm, 0, 0);
        if (c <= now) c.setMonth(c.getMonth() + 1);
        const r = c.getTime();
        if (ag.expiraEm && r > new Date(ag.expiraEm).getTime()) return undefined;
        return ag.atrasoAleatorio ? r + Math.random() * ag.atrasoAleatorio * 60000 : r;
      }
      // diario com filtro de dias da semana
      if (ag.tipo === "diario" && ag.diasSemana && ag.diasSemana.length > 0) {
        for (let d = 0; d < 7; d++) {
          const c = new Date();
          c.setDate(now.getDate() + d);
          c.setHours(hh, mm, 0, 0);
          if (c > now && ag.diasSemana.includes(c.getDay())) {
            const r = c.getTime();
            if (ag.expiraEm && r > new Date(ag.expiraEm).getTime()) return undefined;
            return ag.atrasoAleatorio ? r + Math.random() * ag.atrasoAleatorio * 60000 : r;
          }
        }
        return undefined;
      }
      const next = new Date();
      next.setHours(hh, mm, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      const r = next.getTime();
      if (ag.expiraEm && r > new Date(ag.expiraEm).getTime()) return undefined;
      return ag.atrasoAleatorio ? r + Math.random() * ag.atrasoAleatorio * 60000 : r;
    }
    return undefined;
  }

  async function runScriptOnVm(scriptId: string, execId: string) {
    const script = await storage.getPythonScriptById(scriptId);
    if (!script) { vmBusy = false; processNextInQueue(); return; }
    const cfg = await storage.getPythonAgentConfig();
    if (!cfg.agentUrl || !cfg.agentKey) {
      const e = await storage.getPythonExecutionById(execId);
      await storage.updatePythonExecution(execId, { status: "erro", concluidoEm: Date.now(), logs: [...(e?.logs ?? []), "[ERRO] Agente não configurado."] });
      await storage.updatePythonScript(scriptId, { ultimoStatus: "erro" });
      vmBusy = false; processNextInQueue(); return;
    }
    const args = script.argumentos?.trim() ?? "";
    const argsList = args ? args.split(/\s+/).map((a: string) => JSON.stringify(a)).join(", ") : "";
    // Strip surrounding quotes the user may have typed in the path field
    const cleanPath = script.caminhoVm.trim().replace(/^["']|["']$/g, "");
    const wrapperScript = [
      "import subprocess, sys, os",
      // Force UTF-8 in the child process environment (handles PyInstaller exes on Windows)
      "env = os.environ.copy()",
      "env['PYTHONIOENCODING'] = 'utf-8'",
      "env['PYTHONUTF8'] = '1'",
      "env['PYTHONLEGACYWINDOWSSTDIO'] = '0'",
      // Roda via "cmd /c" para que o Windows saiba como tratar qualquer tipo de
      // executável (.exe PyInstaller, .bat, .cmd, script com ícone .exe, etc.)
      // — resolve WinError 193 "not a valid Win32 application"
      `cmd = ["cmd", "/c", r"""${cleanPath}"""${argsList ? `, ${argsList}` : ""}]`,
      "proc = subprocess.run(cmd, capture_output=True, timeout=3600, env=env)",
      // Write bytes directly to stdout.buffer — bypasses the cp1252 text encoder on Windows
      "sys.stdout.buffer.write(proc.stdout or b'')",
      "sys.stdout.buffer.flush()",
      "if proc.stderr:",
      "    sys.stderr.buffer.write(proc.stderr)",
      "    sys.stderr.buffer.flush()",
      "sys.exit(proc.returncode)",
    ].join("\n");
    const agentUrl = cfg.agentUrl.replace(/\/$/, "");
    const startTime = Date.now();
    const POLL_INTERVAL_MS = 4000;          // 4s entre cada poll
    const TOTAL_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 horas máximo
    const FETCH_TIMEOUT_MS = 15000;         // 15s para cada requisição individual
    const MAX_404_RETRIES  = 3;             // tentativas antes de desistir em caso de 404

    const agentHeaders = {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      "User-Agent": "ReplicationAgent/1.0",
    };

    // Helpers para persistir logs sem sobrescrever o que já existe
    async function appendLog(...lines: string[]) {
      const cur = await storage.getPythonExecutionById(execId);
      await storage.updatePythonExecution(execId, { logs: [...(cur?.logs ?? []), ...lines] });
    }

    try {
      // ── (a) Disparar job — resposta imediata ─────────────────────────────
      const dispatchResp = await fetch(agentUrl, {
        method: "POST",
        headers: agentHeaders,
        body: JSON.stringify({ key: cfg.agentKey, script: wrapperScript }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!dispatchResp.ok) {
        const body = await dispatchResp.text().catch(() => "(sem body)");
        await appendLog(`[ERRO] Agente retornou HTTP ${dispatchResp.status}: ${body}`);
        await storage.updatePythonExecution(execId, { status: "erro", concluidoEm: Date.now() });
        await storage.updatePythonScript(scriptId, { ultimoStatus: "erro" });
        return;
      }
      const dispatch = await dispatchResp.json() as { job_id: string; status: string };
      const jobId = dispatch.job_id;
      const tsDispatch = new Date().toLocaleTimeString("pt-BR");
      await appendLog(`[${tsDispatch}] Job disparado — id: ${jobId}`);

      // ── (b) Loop de polling ───────────────────────────────────────────────
      let logsSeen = 0;      // índice acumulado de logs já recebidos
      let notFoundCount = 0; // contador de 404 consecutivos

      while (Date.now() - startTime < TOTAL_TIMEOUT_MS) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

        let pollResp: Response;
        try {
          pollResp = await fetch(
            `${agentUrl}/status/${jobId}?since=${logsSeen}`,
            { headers: agentHeaders, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
          );
        } catch (fetchErr: any) {
          // Erro de rede temporário — tenta na próxima iteração
          await appendLog(`[AVISO] Falha ao consultar status (tentando novamente): ${fetchErr.message}`);
          continue;
        }

        if (pollResp.status === 404) {
          notFoundCount++;
          if (notFoundCount >= MAX_404_RETRIES) {
            await appendLog(`[ERRO] Job ${jobId} não encontrado no agente após ${MAX_404_RETRIES} tentativas (404).`);
            await storage.updatePythonExecution(execId, { status: "erro", concluidoEm: Date.now() });
            await storage.updatePythonScript(scriptId, { ultimoStatus: "erro" });
            return;
          }
          continue;
        }
        notFoundCount = 0; // reset se voltou a responder

        if (!pollResp.ok) {
          const body = await pollResp.text().catch(() => "");
          await appendLog(`[AVISO] Status HTTP ${pollResp.status} no polling: ${body}`);
          continue;
        }

        const poll = await pollResp.json() as {
          job_id: string;
          status: "running" | "success" | "error";
          exit_code: number | null;
          log_total: number;
          logs: string[];
        };

        // Acumula logs novos recebidos neste poll
        if (poll.logs && poll.logs.length > 0) {
          const ts = new Date().toLocaleTimeString("pt-BR");
          const newLines = poll.logs.map((l: string) => `[${ts}] ${l}`);
          await appendLog(...newLines);
        }
        logsSeen = poll.log_total ?? logsSeen;

        // ── (c) Finalizado ────────────────────────────────────────────────
        if (poll.status === "success" || poll.status === "error") {
          const finalStatus: "concluido" | "erro" = poll.status === "success" ? "concluido" : "erro";
          const exitCode = poll.exit_code ?? (finalStatus === "concluido" ? 0 : 1);
          await storage.updatePythonExecution(execId, { status: finalStatus, exitCode, concluidoEm: Date.now() });
          await storage.updatePythonScript(scriptId, { ultimoStatus: finalStatus === "concluido" ? "sucesso" : "erro" });
          if (finalStatus === "concluido") {
            const dur = Date.now() - startTime;
            const prev = script.duracaoMediaMs;
            await storage.updatePythonScript(scriptId, { duracaoMediaMs: prev ? Math.round(prev * 0.7 + dur * 0.3) : dur });
          }
          return;
        }
        // status === "running" → continua polling
      }

      // Timeout total estourado
      await appendLog(`[ERRO] Timeout total de 2 horas atingido — execução encerrada.`);
      await storage.updatePythonExecution(execId, { status: "erro", concluidoEm: Date.now() });
      await storage.updatePythonScript(scriptId, { ultimoStatus: "erro" });

    } catch (err: any) {
      const ts = new Date().toLocaleTimeString("pt-BR");
      await appendLog(`[${ts}] [ERRO] ${err.message}`);
      await storage.updatePythonExecution(execId, { status: "erro", concluidoEm: Date.now() });
      await storage.updatePythonScript(scriptId, { ultimoStatus: "erro" });
    } finally {
      vmBusy = false;
      processNextInQueue();
    }
  }

  async function processNextInQueue() {
    if (vmBusy || vmQueue.length === 0) return;
    const next = vmQueue.shift()!;
    vmBusy = true;
    const execRec = await storage.getPythonExecutionById(next.execId);
    const ts = new Date().toLocaleTimeString("pt-BR");
    await storage.updatePythonExecution(next.execId, {
      status: "executando", iniciadoEm: Date.now(),
      logs: [...(execRec?.logs ?? []), `[${ts}] Saiu da fila — iniciando execução...`],
    });
    await storage.updatePythonScript(next.scriptId, { ultimoStatus: "executando", ultimaExecucao: Date.now() });
    runScriptOnVm(next.scriptId, next.execId);
  }

  async function detectAndAdjustConflict(horario: string, excludeId?: string): Promise<{ horario: string; conflito?: string }> {
    if (!horario) return { horario };
    const allScripts = await storage.getAllPythonScripts();
    let targetTime = horario;
    for (let attempt = 0; attempt < 24; attempt++) {
      const conflict = allScripts.find(s =>
        s.id !== excludeId && s.ativo &&
        s.agendamento?.tipo !== "nenhum" && s.agendamento?.habilitado !== false &&
        s.agendamento?.horario === targetTime
      );
      if (!conflict) return attempt === 0 ? { horario: targetTime } : { horario: targetTime, conflito: `Horário ajustado de ${horario} para ${targetTime} para evitar conflito com "${conflict?.nome ?? "outro script"}"` };
      const duracaoMins = Math.ceil((conflict.duracaoMediaMs ?? 5 * 60000) / 60000) + 2;
      const [h, m] = targetTime.split(":").map(Number);
      const totalMins = h * 60 + m + duracaoMins;
      targetTime = `${String(Math.floor(totalMins / 60) % 24).padStart(2, "0")}:${String(totalMins % 60).padStart(2, "0")}`;
    }
    return { horario: targetTime, conflito: `Horário ajustado de ${horario} para ${targetTime} para evitar conflitos` };
  }

  // ===========================
  // Python Scripts — CRUD
  // ===========================

  app.get("/api/python-scripts", async (req, res) => {
    try { res.json(await storage.getAllPythonScripts()); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/python-scripts", async (req, res) => {
    try {
      let payload = { ...req.body };
      let avisoConflito: string | undefined;
      if (payload.agendamento?.horario && payload.agendamento?.tipo !== "nenhum") {
        const { horario, conflito } = await detectAndAdjustConflict(payload.agendamento.horario);
        if (conflito) { payload.agendamento = { ...payload.agendamento, horario }; avisoConflito = conflito; }
      }
      const script = await storage.createPythonScript(payload);
      if (script.agendamento?.tipo !== "nenhum") {
        const next = calcPythonNextRun(script);
        if (next) await storage.updatePythonScript(script.id, { proximaExecucao: next });
      }
      res.json({ ...script, avisoConflito });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/python-scripts/:id", async (req, res) => {
    try {
      let payload = { ...req.body };
      let avisoConflito: string | undefined;
      if (payload.agendamento?.horario && payload.agendamento?.tipo !== "nenhum") {
        const { horario, conflito } = await detectAndAdjustConflict(payload.agendamento.horario, req.params.id);
        if (conflito) { payload.agendamento = { ...payload.agendamento, horario }; avisoConflito = conflito; }
      }
      const updated = await storage.updatePythonScript(req.params.id, payload);
      if (!updated) return res.status(404).json({ error: "Script não encontrado" });
      if (updated.agendamento?.tipo !== "nenhum") {
        const next = calcPythonNextRun(updated);
        if (next) await storage.updatePythonScript(updated.id, { proximaExecucao: next });
      }
      res.json({ ...updated, avisoConflito });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/python-scripts/:id", async (req, res) => {
    try {
      await storage.deletePythonScript(req.params.id);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ===========================
  // Python Scripts — Execute & Queue
  // ===========================

  app.get("/api/python-fila", (req, res) => {
    res.json({ vmBusy, fila: vmQueue.map((item, i) => ({ ...item, posicao: i + 1 })), total: vmQueue.length });
  });

  app.post("/api/python-scripts/:id/executar", async (req, res) => {
    try {
      const script = await storage.getPythonScriptById(req.params.id);
      if (!script) return res.status(404).json({ error: "Script não encontrado" });
      const cfg = await storage.getPythonAgentConfig();
      if (!cfg.agentUrl || !cfg.agentKey) return res.status(400).json({ error: "Agente não configurado. Configure a URL e chave do agente." });

      const origem: "manual" | "agendado" = req.body.origem ?? "manual";
      const posicaoFila = vmBusy ? vmQueue.length + 1 : 0;
      const ts = new Date().toLocaleTimeString("pt-BR");
      const exec = await storage.createPythonExecution({
        scriptId: script.id, scriptNome: script.nome, iniciadoEm: Date.now(),
        status: vmBusy ? "aguardando" : "executando",
        logs: vmBusy ? [`[${ts}] Na fila... posição ${posicaoFila}`] : [`[${ts}] Enviando para o agente...`],
        origem,
      });
      await storage.updatePythonScript(script.id, { ultimaExecucao: Date.now() });
      if (vmBusy) {
        vmQueue.push({ scriptId: script.id, execId: exec.id, scriptNome: script.nome, origem, enfileiradoEm: Date.now() });
        await storage.updatePythonScript(script.id, { ultimoStatus: "aguardando" });
        return res.json({ execucaoId: exec.id, filaPos: posicaoFila });
      }
      vmBusy = true;
      await storage.updatePythonScript(script.id, { ultimoStatus: "executando" });
      runScriptOnVm(script.id, exec.id);
      res.json({ execucaoId: exec.id, filaPos: 0 });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ===========================
  // Python Scripts — Executions
  // ===========================

  app.get("/api/python-execucoes", async (req, res) => {
    try {
      const scriptId = req.query.scriptId as string | undefined;
      const limit = Number(req.query.limit ?? 100);
      res.json(await storage.getAllPythonExecutions(scriptId, limit));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/python-execucoes/:id", async (req, res) => {
    try {
      const exec = await storage.getPythonExecutionById(req.params.id);
      if (!exec) return res.status(404).json({ error: "Execução não encontrada" });
      res.json(exec);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ===========================
  // Python Scripts — Scheduler
  // ===========================

  // ===========================
  // DB Explorer Routes
  // ===========================
  app.get("/api/db-config", async (_req, res) => {
    const cfg = await storage.getDbConfig();
    res.json({ host: cfg.host, port: cfg.port, database: cfg.database, username: cfg.username, hasConfig: cfg.hasConfig });
  });

  app.post("/api/db-config", async (req, res) => {
    const { host, port, database, username, password } = req.body;
    await storage.setDbConfig({ host, port: port ? Number(port) : undefined, database, username, password });
    res.json({ ok: true });
  });

  app.post("/api/db-test", async (_req, res) => {
    let pool: any;
    try {
      pool = await getDbPool();
      const result = await pool.query("SELECT version()");
      res.json({ ok: true, version: result.rows[0].version });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    } finally {
      if (pool) await pool.end().catch(() => {});
    }
  });

  app.get("/api/db-schemas", async (req, res) => {
    const dbOverride = req.query.database ? String(req.query.database) : undefined;
    let pool: any;
    try {
      pool = await getDbPool(dbOverride);
      const result = await pool.query(`
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast','pg_temp_1','pg_toast_temp_1')
          AND schema_name NOT LIKE 'pg_temp_%'
          AND schema_name NOT LIKE 'pg_toast_temp_%'
        ORDER BY schema_name
      `);
      res.json(result.rows.map((r: any) => r.schema_name));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    } finally {
      if (pool) await pool.end().catch(() => {});
    }
  });

  app.get("/api/db-schema-detail", async (req, res) => {
    const schema = String(req.query.schema || "public");
    const dbOverride = req.query.database ? String(req.query.database) : undefined;
    let pool: any;
    try {
      pool = await getDbPool(dbOverride);
      const [tables, matviews, views, stats] = await Promise.all([
        pool.query(
          `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
          [schema]
        ),
        pool.query(
          `SELECT matviewname as name, ispopulated, definition FROM pg_matviews WHERE schemaname = $1 ORDER BY matviewname`,
          [schema]
        ),
        pool.query(
          `SELECT table_name as name, view_definition as definition FROM information_schema.views WHERE table_schema = $1 ORDER BY table_name`,
          [schema]
        ),
        pool.query(
          `SELECT relname as table_name, n_live_tup as row_estimate FROM pg_stat_user_tables WHERE schemaname = $1`,
          [schema]
        ),
      ]);
      const rowMap: Record<string, number> = {};
      stats.rows.forEach((r: any) => { rowMap[r.table_name] = parseInt(r.row_estimate) || 0; });
      res.json({
        tables: tables.rows
          .filter((r: any) => r.table_type === "BASE TABLE")
          .map((r: any) => ({ name: r.table_name, rows: rowMap[r.table_name] ?? null })),
        matviews: matviews.rows.map((r: any) => ({ name: r.name, ispopulated: r.ispopulated, definition: r.definition })),
        views: views.rows.map((r: any) => ({ name: r.name, definition: r.definition })),
      });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    } finally {
      if (pool) await pool.end().catch(() => {});
    }
  });

  app.get("/api/db-table-columns", async (req, res) => {
    const schema = String(req.query.schema || "public");
    const table = String(req.query.table || "");
    const dbOverride = req.query.database ? String(req.query.database) : undefined;
    if (!table) return res.status(400).json({ error: "table required" });
    let pool: any;
    try {
      pool = await getDbPool(dbOverride);
      // First try information_schema (covers tables and regular views)
      const result = await pool.query(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [schema, table]
      );
      if (result.rows.length > 0) {
        return res.json(result.rows);
      }
      // Fallback: pg_attribute covers materialized views (not in information_schema)
      const mvResult = await pool.query(
        `SELECT a.attname AS column_name,
                pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
                CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
                pg_get_expr(d.adbin, d.adrelid) AS column_default
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE n.nspname = $1
           AND c.relname = $2
           AND a.attnum > 0
           AND NOT a.attisdropped
         ORDER BY a.attnum`,
        [schema, table]
      );
      res.json(mvResult.rows);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    } finally {
      if (pool) await pool.end().catch(() => {});
    }
  });

  app.get("/api/db-crons", async (req, res) => {
    const dbOverride = req.query.database ? String(req.query.database) : undefined;
    let pool: any;
    try {
      pool = await getDbPool(dbOverride);
      // Try cron.job (pg_cron extension)
      try {
        const jobs = await pool.query(`
          SELECT j.jobid, j.jobname, j.schedule, j.command, j.active,
                 r.start_time, r.end_time, r.status, r.return_message
          FROM cron.job j
          LEFT JOIN LATERAL (
            SELECT * FROM cron.job_run_details WHERE jobid = j.jobid ORDER BY start_time DESC LIMIT 1
          ) r ON true
          ORDER BY j.jobname
        `);
        res.json({ hasCron: true, jobs: jobs.rows });
      } catch {
        res.json({ hasCron: false, jobs: [] });
      }
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    } finally {
      if (pool) await pool.end().catch(() => {});
    }
  });

  app.get("/api/db-databases", async (_req, res) => {
    let pool: any;
    try {
      pool = await getDbPool();
      const result = await pool.query(
        `SELECT datname, pg_size_pretty(pg_database_size(datname)) as size
         FROM pg_database WHERE datistemplate = false ORDER BY datname`
      );
      res.json(result.rows);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    } finally {
      if (pool) await pool.end().catch(() => {});
    }
  });

  // Timestamp config — maps schema.table → column for last-update display
  app.get("/api/db-timestamp-config", async (req, res) => {
    const database = String(req.query.database || "");
    const config = await storage.getDbTimestampConfig(database);
    res.json(config);
  });

  app.post("/api/db-timestamp-config", async (req, res) => {
    const { database, key, column } = req.body;
    if (!database || !key) return res.status(400).json({ error: "database e key obrigatórios" });
    await storage.setDbTimestampConfig(database, key, column || null);
    res.json({ ok: true });
  });

  app.get("/api/db-custom-blocks", async (req, res) => {
    const database = String(req.query.database || "");
    const blocks = await storage.getDbCustomBlocks(database);
    res.json(blocks);
  });

  app.post("/api/db-custom-blocks", async (req, res) => {
    const { database, id, nome, tables } = req.body;
    if (!database || !nome || !Array.isArray(tables)) return res.status(400).json({ error: "database, nome e tables são obrigatórios" });
    const block = await storage.saveDbCustomBlock(database, { id, nome, tables });
    res.json(block);
  });

  app.delete("/api/db-custom-blocks/:id", async (req, res) => {
    const database = String(req.query.database || "");
    await storage.deleteDbCustomBlock(database, req.params.id);
    res.json({ ok: true });
  });

  // All tables+views+matviews with columns (for Config tab)
  app.get("/api/db-all-tables", async (req, res) => {
    const dbOverride = req.query.database ? String(req.query.database) : undefined;
    let pool: any;
    try {
      pool = await getDbPool(dbOverride);
      const EXCLUDED = `'pg_catalog','information_schema','pg_toast'`;
      const [tablesRes, columnsRes, mvColumnsRes] = await Promise.all([
        pool.query(`
          SELECT table_schema as schema, table_name as name, 'table' as kind
          FROM information_schema.tables
          WHERE table_schema NOT IN (${EXCLUDED}) AND table_type = 'BASE TABLE'
          UNION ALL
          SELECT schemaname, matviewname, 'matview'
          FROM pg_matviews WHERE schemaname NOT IN (${EXCLUDED})
          UNION ALL
          SELECT table_schema, table_name, 'view'
          FROM information_schema.views WHERE table_schema NOT IN (${EXCLUDED})
          ORDER BY 1, 2
        `),
        pool.query(`
          SELECT table_schema as schema, table_name, column_name, data_type
          FROM information_schema.columns
          WHERE table_schema NOT IN (${EXCLUDED})
          ORDER BY table_schema, table_name, ordinal_position
        `),
        pool.query(`
          SELECT n.nspname AS schema, c.relname AS table_name,
                 a.attname AS column_name,
                 pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'm'
            AND a.attnum > 0
            AND NOT a.attisdropped
            AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
          ORDER BY n.nspname, c.relname, a.attnum
        `),
      ]);
      const colMap: Record<string, { column_name: string; data_type: string }[]> = {};
      for (const row of columnsRes.rows) {
        const k = `${row.schema}.${row.table_name}`;
        if (!colMap[k]) colMap[k] = [];
        colMap[k].push({ column_name: row.column_name, data_type: row.data_type });
      }
      // Add matview columns (not present in information_schema)
      for (const row of mvColumnsRes.rows) {
        const k = `${row.schema}.${row.table_name}`;
        if (!colMap[k]) colMap[k] = [];
        colMap[k].push({ column_name: row.column_name, data_type: row.data_type });
      }
      res.json(tablesRes.rows.map((r: any) => ({
        schema: r.schema, name: r.name, kind: r.kind,
        columns: colMap[`${r.schema}.${r.name}`] || [],
      })));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    } finally {
      if (pool) await pool.end().catch(() => {});
    }
  });

  // Dependency tree for a materialized view (via pg_depend)
  app.get("/api/db-matview-deps", async (req, res) => {
    const dbOverride = req.query.database ? String(req.query.database) : undefined;
    const schema = String(req.query.schema || "public");
    const name = String(req.query.name || "");
    if (!name) return res.status(400).json({ error: "name obrigatório" });
    let pool: any;
    try {
      pool = await getDbPool(dbOverride);
      // Direct dependencies via pg_depend + pg_rewrite
      const result = await pool.query(`
        SELECT DISTINCT
          cl_ref.relname AS dep_name,
          n_ref.nspname  AS dep_schema,
          CASE cl_ref.relkind
            WHEN 'r' THEN 'table'
            WHEN 'm' THEN 'matview'
            WHEN 'v' THEN 'view'
            ELSE cl_ref.relkind::text
          END AS dep_kind
        FROM pg_depend d
        JOIN pg_rewrite r ON r.oid = d.objid
        JOIN pg_class cl ON cl.oid = r.ev_class
        JOIN pg_namespace n ON n.oid = cl.relnamespace
        JOIN pg_class cl_ref ON cl_ref.oid = d.refobjid
        JOIN pg_namespace n_ref ON n_ref.oid = cl_ref.relnamespace
        WHERE cl.relname = $1
          AND n.nspname = $2
          AND d.deptype = 'n'
          AND cl_ref.relkind IN ('r','m','v')
          AND cl_ref.relname <> $1
        ORDER BY dep_kind, dep_schema, dep_name
      `, [name, schema]);
      res.json({ deps: result.rows });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    } finally {
      if (pool) await pool.end().catch(() => {});
    }
  });

  // REFRESH MATERIALIZED VIEW
  app.post("/api/db-matview-refresh", async (req, res) => {
    const { database, schema, name } = req.body;
    if (!schema || !name) return res.status(400).json({ error: "schema e name obrigatórios" });
    let pool: any;
    try {
      pool = await getDbPool(database);
      try {
        await pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY "${schema.replace(/"/g,'')}"."${name.replace(/"/g,'')}"`);
      } catch {
        await pool.query(`REFRESH MATERIALIZED VIEW "${schema.replace(/"/g,'')}"."${name.replace(/"/g,'')}"`);
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    } finally {
      if (pool) await pool.end().catch(() => {});
    }
  });

  // Toggle pg_cron job active/inactive
  app.post("/api/db-cron-toggle", async (req, res) => {
    const { database, jobid, active } = req.body;
    if (jobid === undefined) return res.status(400).json({ error: "jobid obrigatório" });
    let pool: any;
    try {
      pool = await getDbPool(database);
      await pool.query(`UPDATE cron.job SET active = $1 WHERE jobid = $2`, [!!active, jobid]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    } finally {
      if (pool) await pool.end().catch(() => {});
    }
  });

  // Run a single pg_cron job immediately by executing its command
  app.post("/api/db-cron-run-now", async (req, res) => {
    const { database, jobid } = req.body;
    if (jobid === undefined) return res.status(400).json({ error: "jobid obrigatório" });
    let pool: any;
    try {
      pool = await getDbPool(database);
      const jobRes = await pool.query(`SELECT command FROM cron.job WHERE jobid = $1`, [jobid]);
      if (jobRes.rows.length === 0) return res.status(404).json({ error: "Job não encontrado" });
      const command = jobRes.rows[0].command;
      await pool.query(command);
      res.json({ ok: true, command });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    } finally {
      if (pool) await pool.end().catch(() => {});
    }
  });

  // Bulk last-update timestamps for a list of tables
  app.post("/api/db-bulk-lastupdates", async (req, res) => {
    const { database, items } = req.body as { database: string; items: { schema: string; table: string; column: string }[] };
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: "items obrigatório" });
    let pool: any;
    try {
      pool = await getDbPool(database);
      const results: Record<string, string | null> = {};
      await Promise.all(items.map(async ({ schema, table, column }) => {
        try {
          const r = await pool.query(
            `SELECT MAX("${column.replace(/"/g,'')}")::text AS v FROM "${schema.replace(/"/g,'')}"."${table.replace(/"/g,'')}"`
          );
          results[`${schema}.${table}`] = r.rows[0]?.v || null;
        } catch {
          results[`${schema}.${table}`] = null;
        }
      }));
      res.json(results);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    } finally {
      if (pool) await pool.end().catch(() => {});
    }
  });

  // Last update value for a configured column
  app.get("/api/db-table-lastupdate", async (req, res) => {
    const dbOverride = req.query.database ? String(req.query.database) : undefined;
    const schema = String(req.query.schema || "");
    const table = String(req.query.table || "");
    const column = String(req.query.column || "");
    if (!schema || !table || !column) return res.status(400).json({ error: "schema, table e column obrigatórios" });
    let pool: any;
    try {
      pool = await getDbPool(dbOverride);
      const result = await pool.query(
        `SELECT MAX("${column.replace(/"/g, '')}")::text AS last_update FROM "${schema.replace(/"/g, '')}"."${table.replace(/"/g, '')}"`
      );
      res.json({ lastUpdate: result.rows[0]?.last_update || null });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    } finally {
      if (pool) await pool.end().catch(() => {});
    }
  });

  // CSV export from a table with date + column filters
  app.get("/api/db-export-csv", async (req, res) => {
    const dbOverride = req.query.database ? String(req.query.database) : undefined;
    const schema = String(req.query.schema || "");
    const table = String(req.query.table || "");
    const dateColumn = String(req.query.dateColumn || "");
    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : null;
    const dateTo = req.query.dateTo ? String(req.query.dateTo) : null;
    const filterColumn = req.query.filterColumn ? String(req.query.filterColumn) : null;
    const filterValue = req.query.filterValue !== undefined ? String(req.query.filterValue) : null;

    if (!schema || !table || !dateColumn) {
      return res.status(400).json({ error: "schema, table e dateColumn obrigatórios" });
    }

    const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_\-]/g, "");
    const safeSchema = sanitize(schema);
    const safeTable = sanitize(table);
    const safeDateCol = sanitize(dateColumn);

    let pool: any;
    try {
      pool = await getDbPool(dbOverride);
      const params: any[] = [];
      const conditions: string[] = [];

      if (dateFrom) {
        params.push(dateFrom);
        conditions.push(`"${safeDateCol}" >= $${params.length}`);
      }
      if (dateTo) {
        params.push(dateTo);
        conditions.push(`"${safeDateCol}" <= $${params.length}`);
      }
      if (filterColumn && filterValue !== null && filterValue !== "") {
        const safeFilterCol = sanitize(filterColumn);
        params.push(`%${filterValue}%`);
        conditions.push(`"${safeFilterCol}"::text ILIKE $${params.length}`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sql = `SELECT * FROM "${safeSchema}"."${safeTable}" ${where} ORDER BY "${safeDateCol}" DESC LIMIT 100000`;
      const result = await pool.query(sql, params);

      const fmtDate = (d: Date): string => {
        const pad = (n: number) => String(n).padStart(2, "0");
        const dd = pad(d.getDate());
        const mm = pad(d.getMonth() + 1);
        const aa = String(d.getFullYear()).slice(-2);
        const hh = pad(d.getHours());
        const mi = pad(d.getMinutes());
        const ss = pad(d.getSeconds());
        return `${dd}/${mm}/${aa} ${hh}:${mi}:${ss}`;
      };

      // Matches ISO date strings: "2026-06-29" or "2026-06-29T00:00:00..." or "2026-06-29 00:00:00..."
      const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}:\d{2})?/;

      const escape = (val: any): string => {
        if (val === null || val === undefined) return "";
        let s: string;
        if (val instanceof Date) {
          s = fmtDate(val);
        } else if (typeof val === "string" && ISO_DATE_RE.test(val)) {
          const d = new Date(val);
          s = isNaN(d.getTime()) ? val : fmtDate(d);
        } else {
          s = String(val);
        }
        if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };

      const filename = `${safeTable}_${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

      const headers = result.fields.map((f: any) => escape(f.name)).join(",");
      const rows = result.rows.map((row: any) =>
        result.fields.map((f: any) => escape(row[f.name])).join(",")
      );
      res.send([headers, ...rows].join("\n"));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    } finally {
      if (pool) await pool.end().catch(() => {});
    }
  });

  // Server overview — connects to any reachable DB and returns server-level stats
  app.get("/api/db-server-overview", async (req, res) => {
    const { Pool } = await import("pg");
    const cfg = await storage.getDbConfig();
    if (!cfg.host || !cfg.username) {
      return res.status(400).json({ error: "Configure host e usuário primeiro" });
    }
    const candidates = [cfg.database, "postgres", "template1"].filter(Boolean);
    let pool: any;
    let connectedDb = "";
    let lastErr = "";
    for (const dbName of candidates) {
      try {
        pool = new Pool({
          host: cfg.host, port: cfg.port, database: dbName,
          user: cfg.username, password: cfg.password,
          connectionTimeoutMillis: 8000, max: 3,
        });
        await pool.query("SELECT 1");
        connectedDb = dbName;
        break;
      } catch (e: any) {
        lastErr = e.message;
        if (pool) { await pool.end().catch(() => {}); pool = null; }
      }
    }
    if (!pool) return res.status(400).json({ error: lastErr });
    try {
      const [versionRes, dbsRes, connRes, actRes, settingsRes] = await Promise.all([
        pool.query("SELECT version()"),
        pool.query(`
          SELECT d.datname,
                 pg_size_pretty(pg_database_size(d.datname)) AS size,
                 pg_database_size(d.datname) AS size_bytes,
                 r.rolname AS owner,
                 d.datcollate,
                 d.datconnlimit
          FROM pg_database d
          JOIN pg_roles r ON r.oid = d.datdba
          WHERE d.datistemplate = false
          ORDER BY pg_database_size(d.datname) DESC
        `),
        pool.query(`
          SELECT datname, count(*) AS connections
          FROM pg_stat_activity
          WHERE state IS NOT NULL
          GROUP BY datname
          ORDER BY connections DESC
        `),
        pool.query(`
          SELECT count(*) AS total,
                 count(*) FILTER (WHERE state = 'active') AS active,
                 count(*) FILTER (WHERE state = 'idle') AS idle,
                 count(*) FILTER (WHERE wait_event_type IS NOT NULL) AS waiting
          FROM pg_stat_activity
          WHERE pid <> pg_backend_pid()
        `),
        pool.query(`
          SELECT current_setting('max_connections') AS max_connections,
                 current_setting('server_version') AS server_version,
                 current_setting('data_directory') AS data_directory
        `),
      ]);
      const connMap: Record<string, number> = {};
      connRes.rows.forEach((r: any) => { connMap[r.datname] = parseInt(r.connections); });
      const dbs = dbsRes.rows.map((r: any) => ({
        name: r.datname,
        size: r.size,
        sizeBytes: parseInt(r.size_bytes),
        owner: r.owner,
        collate: r.datcollate,
        connLimit: r.datconnlimit === -1 ? null : r.datconnlimit,
        connections: connMap[r.datname] || 0,
      }));
      const totalSize = dbs.reduce((s, d) => s + d.sizeBytes, 0);
      res.json({
        connectedVia: connectedDb,
        version: versionRes.rows[0].version,
        serverVersion: settingsRes.rows[0].server_version,
        maxConnections: parseInt(settingsRes.rows[0].max_connections),
        dataDirectory: settingsRes.rows[0].data_directory,
        connections: actRes.rows[0],
        databases: dbs,
        totalSizeBytes: totalSize,
        totalSize: formatBytes(totalSize),
      });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    } finally {
      if (pool) await pool.end().catch(() => {});
    }
  });

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
  }

  // Discover: connect to "postgres" maintenance DB and list available databases
  app.post("/api/db-discover", async (req, res) => {
    const { Pool } = await import("pg");
    const cfg = await storage.getDbConfig();
    if (!cfg.host || !cfg.username) {
      return res.status(400).json({ error: "Configure host e usuário primeiro" });
    }
    const trialDbs = ["postgres", "template1"];
    let pool: any;
    let connected = false;
    let lastErr = "";
    for (const dbName of trialDbs) {
      try {
        pool = new Pool({
          host: cfg.host,
          port: cfg.port,
          database: dbName,
          user: cfg.username,
          password: req.body?.password || cfg.password,
          connectionTimeoutMillis: 8000,
          max: 1,
        });
        const result = await pool.query(
          `SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname`
        );
        await pool.end().catch(() => {});
        res.json({ databases: result.rows.map((r: any) => r.datname), connectedVia: dbName });
        connected = true;
        break;
      } catch (e: any) {
        lastErr = e.message;
        if (pool) await pool.end().catch(() => {});
        pool = null;
      }
    }
    if (!connected) {
      res.status(400).json({ error: lastErr });
    }
  });

  // ===========================
  // Power BI module
  // ===========================
  let pbiTokenCache: { token: string; expiresAt: number } | null = null;

  async function getPbiToken(): Promise<string> {
    if (pbiTokenCache && pbiTokenCache.expiresAt > Date.now() + 60_000) {
      return pbiTokenCache.token;
    }
    const cfg = await storage.getPbiConfig();
    if (!cfg.tenantId || !cfg.clientId || !cfg.clientSecret) {
      throw new Error("Power BI não configurado");
    }
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: "https://analysis.windows.net/powerbi/api/.default",
    });
    const resp = await fetch(
      `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() }
    );
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Falha na autenticação Azure: ${err}`);
    }
    const data: any = await resp.json();
    pbiTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 30) * 1000 };
    return pbiTokenCache.token;
  }

  app.get("/api/pbi-config", async (_req, res) => {
    const cfg = await storage.getPbiConfig();
    res.json({
      tenantId: cfg.tenantId,
      clientId: cfg.clientId,
      hasSecret: !!cfg.clientSecret,
      hasConfig: !!(cfg.tenantId && cfg.clientId && cfg.clientSecret),
    });
  });

  app.post("/api/pbi-config", async (req, res) => {
    const { tenantId, clientId, clientSecret } = req.body;
    await storage.setPbiConfig({ tenantId, clientId, clientSecret });
    pbiTokenCache = null;
    res.json({ ok: true });
  });

  app.get("/api/pbi-datasets", async (_req, res) => {
    res.json(await storage.getAllPbiDatasets());
  });

  app.post("/api/pbi-datasets", async (req, res) => {
    const { name, groupId, datasetId, operacao } = req.body;
    if (!name || !groupId || !datasetId) return res.status(400).json({ error: "name, groupId e datasetId obrigatórios" });
    res.json(await storage.createPbiDataset({ name, groupId, datasetId, operacao }));
  });

  app.patch("/api/pbi-datasets/:id", async (req, res) => {
    const updated = await storage.updatePbiDataset(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "Dataset não encontrado" });
    res.json(updated);
  });

  app.delete("/api/pbi-datasets/:id", async (req, res) => {
    res.json({ ok: await storage.deletePbiDataset(req.params.id) });
  });

  app.get("/api/pbi-operacoes", async (_req, res) => {
    res.json(await storage.getAllPbiOperacoes());
  });

  app.post("/api/pbi-operacoes", async (req, res) => {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name obrigatório" });
    res.json(await storage.createPbiOperacao(name.trim()));
  });

  app.delete("/api/pbi-operacoes/:id", async (req, res) => {
    res.json({ ok: await storage.deletePbiOperacao(req.params.id) });
  });

  // Fetch refresh status for all datasets
  app.get("/api/pbi-refresh-status", async (_req, res) => {
    try {
      const datasets = await storage.getAllPbiDatasets();
      if (datasets.length === 0) return res.json([]);
      const token = await getPbiToken();
      const results = await Promise.all(datasets.map(async (ds) => {
        try {
          const r = await fetch(
            `https://api.powerbi.com/v1.0/myorg/groups/${ds.groupId}/datasets/${ds.datasetId}/refreshes?$top=1`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!r.ok) {
            const errText = await r.text();
            return { ...ds, status: "Error", lastRefresh: null, errorMessage: `HTTP ${r.status}: ${errText}` };
          }
          const data: any = await r.json();
          const last = data.value?.[0] || null;
          if (last?.status === "Failed") console.log(`[PBI] ${ds.name} Failed — keys: ${JSON.stringify(Object.keys(last))} | sej: ${String(last.serviceExceptionJson).slice(0,300)}`);
          let errorMessage: string | null = null;
          let errorDetails: any = null;
          if (last?.serviceExceptionJson) {
            try {
              errorDetails = JSON.parse(last.serviceExceptionJson);
              // Structure: { error: { code, "pbi.error": { code, details: [...] } } }
              const pbiErr = errorDetails?.error?.["pbi.error"] || errorDetails?.error;
              const underlyingMsg = pbiErr?.details?.find(
                (d: any) => d.code === "DM_ErrorDetailNameCode_UnderlyingErrorMessage"
              )?.detail?.value;
              errorMessage = underlyingMsg || pbiErr?.code || errorDetails?.error?.code || "Erro desconhecido";
            } catch {
              errorMessage = last.serviceExceptionJson;
            }
          }
          // Fallback: Power BI sometimes exposes errorMessage directly on the refresh entry
          if (!errorMessage && last?.serviceExceptionJson === undefined && last?.errorMessage) {
            errorMessage = last.errorMessage;
          }
          return {
            ...ds,
            status: last?.status || "Unknown",
            lastRefresh: last?.endTime || last?.startTime || null,
            errorMessage,
            errorDetails,
            requestId: last?.requestId || null,
            refreshType: last?.refreshType || null,
            startTime: last?.startTime || null,
          };
        } catch (e: any) {
          return { ...ds, status: "Error", lastRefresh: null, errorMessage: e.message };
        }
      }));
      res.json(results);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Trigger manual refresh
  app.post("/api/pbi-refresh/:groupId/:datasetId", async (req, res) => {
    try {
      const token = await getPbiToken();
      const r = await fetch(
        `https://api.powerbi.com/v1.0/myorg/groups/${req.params.groupId}/datasets/${req.params.datasetId}/refreshes`,
        { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );
      if (r.status === 202) return res.json({ ok: true, message: "Atualização disparada com sucesso" });
      const errText = await r.text();
      res.status(r.status).json({ error: `HTTP ${r.status}: ${errText}` });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ===========================
  // PBI Agendamentos
  // ===========================
  app.get("/api/pbi-agendamentos", async (_req, res) => {
    res.json(await storage.getAllPbiAgendamentos());
  });
  app.post("/api/pbi-agendamentos", async (req, res) => {
    try {
      const { datasetId, horarios, diasSemana, tipo, ativo } = req.body;
      if (!datasetId || !horarios || !Array.isArray(horarios) || horarios.length === 0)
        return res.status(400).json({ error: "datasetId e horarios são obrigatórios" });
      const item = await storage.createPbiAgendamento({
        datasetId,
        horarios,
        diasSemana: diasSemana ?? [],
        tipo: tipo ?? "diario",
        ativo: ativo ?? true,
      });
      res.json(item);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch("/api/pbi-agendamentos/:id", async (req, res) => {
    try {
      const updated = await storage.updatePbiAgendamento(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: "Agendamento não encontrado" });
      res.json(updated);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.delete("/api/pbi-agendamentos/:id", async (req, res) => {
    await storage.deletePbiAgendamento(req.params.id);
    res.json({ success: true });
  });

  // PBI Refresh Logs
  app.get("/api/pbi-refresh-logs", async (_req, res) => {
    res.json(await storage.getAllPbiRefreshLogs());
  });
  app.delete("/api/pbi-refresh-logs", async (_req, res) => {
    await storage.clearPbiRefreshLogs();
    res.json({ success: true });
  });

  // ===========================
  // PBI Scheduler (1x por minuto)
  // ===========================
  (function startPbiScheduler() {
    setInterval(async () => {
      try {
        const agendamentos = await storage.getAllPbiAgendamentos();
        const ativos = agendamentos.filter(a => a.ativo);
        if (ativos.length === 0) return;

        const nowBr = new Date(Date.now() - 3 * 60 * 60 * 1000);
        const hhmm = `${String(nowBr.getUTCHours()).padStart(2, "0")}:${String(nowBr.getUTCMinutes()).padStart(2, "0")}`;
        const dowBr = nowBr.getUTCDay();

        const toRun = ativos.filter(a => {
          if (!a.horarios.includes(hhmm)) return false;
          if (a.tipo === "semanal" && a.diasSemana.length > 0 && !a.diasSemana.includes(dowBr)) return false;
          return true;
        });
        if (toRun.length === 0) return;

        const datasets = await storage.getAllPbiDatasets();
        let token: string;
        try { token = await getPbiToken(); } catch { return; }

        for (const ag of toRun) {
          const ds = datasets.find(d => d.id === ag.datasetId);
          if (!ds) continue;
          if (ds.gerenciadoPorAutoTarefa) continue; // gerenciado por Auto-Tarefa, pular
          console.log(`[PBI Scheduler] Disparando refresh de "${ds.name}" às ${hhmm}`);
          try {
            const r = await fetch(
              `https://api.powerbi.com/v1.0/myorg/groups/${ds.groupId}/datasets/${ds.datasetId}/refreshes`,
              { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
            );
            if (r.status === 202 || r.ok) {
              await storage.addPbiRefreshLog({ datasetId: ag.datasetId, datasetName: ds.name, horario: hhmm, timestamp: new Date().toISOString(), status: "success", triggeredBy: "scheduler" });
              console.log(`[PBI Scheduler] "${ds.name}" refresh disparado OK`);
            } else {
              const errText = await r.text();
              await storage.addPbiRefreshLog({ datasetId: ag.datasetId, datasetName: ds.name, horario: hhmm, timestamp: new Date().toISOString(), status: "error", errorMessage: `HTTP ${r.status}: ${errText.slice(0, 300)}`, triggeredBy: "scheduler" });
            }
          } catch (err: any) {
            await storage.addPbiRefreshLog({ datasetId: ag.datasetId, datasetName: ds.name, horario: hhmm, timestamp: new Date().toISOString(), status: "error", errorMessage: err.message, triggeredBy: "scheduler" });
          }
        }
      } catch {}
    }, 60_000);
    console.log("[PBI] Scheduler iniciado (verifica a cada 1min)");
  })();

  // ===========================

  (function startPythonScheduler() {
    setInterval(async () => {
      try {
        const scripts = await storage.getActivePythonScripts();
        const cfg = await storage.getPythonAgentConfig();
        if (!cfg.agentUrl || !cfg.agentKey) return;
        const now = Date.now();
        for (const script of scripts) {
          if (!script.agendamento || script.agendamento.tipo === "nenhum") continue;
          if (!script.agendamento.habilitado) continue;
          if (script.gerenciadoPorAutoTarefa) continue; // gerenciado por Auto-Tarefa, pular
          const next = script.proximaExecucao;
          if (!next || now < next) continue;
          // Prevent double-trigger: advance nextRun immediately
          const nextRun = calcPythonNextRun(script);
          await storage.updatePythonScript(script.id, { proximaExecucao: nextRun });
          const ts = new Date().toLocaleTimeString("pt-BR");
          const posicaoFila = vmBusy ? vmQueue.length + 1 : 0;
          const exec = await storage.createPythonExecution({
            scriptId: script.id, scriptNome: script.nome, iniciadoEm: Date.now(),
            status: vmBusy ? "aguardando" : "executando",
            logs: vmBusy ? [`[${ts}] Na fila (pos ${posicaoFila}) pelo agendador...`] : [`[${ts}] Iniciado pelo agendador...`],
            origem: "agendado",
          });
          await storage.updatePythonScript(script.id, { ultimaExecucao: Date.now() });
          if (vmBusy) {
            vmQueue.push({ scriptId: script.id, execId: exec.id, scriptNome: script.nome, origem: "agendado", enfileiradoEm: Date.now() });
            await storage.updatePythonScript(script.id, { ultimoStatus: "aguardando" });
          } else {
            vmBusy = true;
            await storage.updatePythonScript(script.id, { ultimoStatus: "executando" });
            runScriptOnVm(script.id, exec.id);
          }
        }
      } catch {}
    }, 30_000);
    console.log("[Python] Scheduler iniciado (verifica a cada 30s)");
  })();

  // ─── Auto Tarefas: executor ──────────────────────────────────────
  const runningAutoTarefas = new Set<string>();

  async function queryDbLastUpdate(schema: string, tabela: string, coluna: string): Promise<Date | null> {
    try {
      const pool = await getDbPool();
      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT MAX("${coluna}") as last_update FROM "${schema}"."${tabela}"`
        );
        const val = result.rows[0]?.last_update;
        return val ? new Date(val) : null;
      } finally {
        client.release();
      }
    } catch {
      return null;
    }
  }

  async function executeAutoTarefa(tarefaId: string) {
    if (runningAutoTarefas.has(tarefaId)) return;
    runningAutoTarefas.add(tarefaId);

    const ts = () => new Date().toLocaleTimeString("pt-BR");
    const ln = (msg: string) => `[${ts()}] ${msg}`;
    const appendLog = (line: string) => storage.appendAutoTarefaLog(tarefaId, line);
    const fail = async (line: string) => {
      await appendLog(line);
      await storage.updateAutoTarefa(tarefaId, { status: "erro", ultimoStatus: "erro" });
      setTimeout(async () => {
        const t = await storage.getAutoTarefaById(tarefaId);
        if (t?.status === "erro") await storage.updateAutoTarefa(tarefaId, { status: "idle" });
      }, 5 * 60_000);
    };

    try {
      const tarefa = await storage.getAutoTarefaById(tarefaId);
      if (!tarefa) return;

      const statusInicial = tarefa.pularVerificacaoBanco ? "aguardando_pbi" : "verificando_banco";
      await storage.updateAutoTarefa(tarefaId, {
        ultimaExecucao: Date.now(),
        status: statusInicial,
        logs: [ln("🚀 Auto-Tarefa iniciada")],
      });

      // ── Etapa 1: Banco de Dados ─────────────────────────────────
      if (!tarefa.pularVerificacaoBanco && tarefa.verificacaoBanco && tarefa.verificacaoBanco.length > 0) {
        await appendLog(ln("🔍 Verificando atualização do banco de dados..."));
        const agora = Date.now();
        for (const conf of tarefa.verificacaoBanco) {
          const lastUpdate = await queryDbLastUpdate(conf.schema, conf.tabela, conf.coluna);
          if (!lastUpdate) {
            await fail(ln(`❌ ${conf.schema}.${conf.tabela}: não foi possível consultar ou tabela vazia`));
            return;
          }
          const diffMin = Math.round((agora - lastUpdate.getTime()) / 60_000);
          if (diffMin > conf.toleranciaMinutos) {
            await fail(ln(`❌ ${conf.schema}.${conf.tabela}: atualizado há ${diffMin}min (tolerância: ${conf.toleranciaMinutos}min)`));
            return;
          }
          await appendLog(ln(`✅ ${conf.schema}.${conf.tabela}: atualizado há ${diffMin}min (ok)`));
        }
      }

      // ── Etapa 2: Power BI ───────────────────────────────────────
      if (tarefa.pbiDatasetId) {
        await storage.updateAutoTarefa(tarefaId, { status: "aguardando_pbi" });
        const datasets = await storage.getAllPbiDatasets();
        const ds = datasets.find(d => d.id === tarefa.pbiDatasetId);
        if (!ds) {
          await fail(ln("❌ Dataset Power BI não encontrado no cadastro"));
          return;
        }
        await appendLog(ln(`⚡ Disparando atualização de "${ds.name}"...`));

        let pbiToken: string;
        try { pbiToken = await getPbiToken(); } catch (e: any) {
          await fail(ln(`❌ Falha na autenticação PBI: ${e.message}`));
          return;
        }

        const refreshResp = await fetch(
          `https://api.powerbi.com/v1.0/myorg/groups/${ds.groupId}/datasets/${ds.datasetId}/refreshes`,
          { method: "POST", headers: { Authorization: `Bearer ${pbiToken}`, "Content-Type": "application/json" } }
        );
        if (!refreshResp.ok && refreshResp.status !== 202) {
          const errText = await refreshResp.text().catch(() => "");
          await fail(ln(`❌ PBI refresh falhou: HTTP ${refreshResp.status} ${errText.slice(0, 200)}`));
          return;
        }
        await appendLog(ln("⏳ Atualização disparada. Aguardando conclusão..."));

        const PBI_POLL_MS = 30_000;
        const PBI_MAX_MS = 2 * 60 * 60 * 1000;
        const pbiStart = Date.now();
        let pbiOk = false;

        while (Date.now() - pbiStart < PBI_MAX_MS) {
          await new Promise(r => setTimeout(r, PBI_POLL_MS));
          try {
            const tok = await getPbiToken();
            const histResp = await fetch(
              `https://api.powerbi.com/v1.0/myorg/groups/${ds.groupId}/datasets/${ds.datasetId}/refreshes?$top=1`,
              { headers: { Authorization: `Bearer ${tok}` } }
            );
            if (histResp.ok) {
              const hist = await histResp.json();
              const latest = hist?.value?.[0];
              if (latest) {
                const status = (latest.status as string || "").toLowerCase();
                await appendLog(ln(`   PBI status: ${latest.status}`));
                if (status === "completed") { pbiOk = true; break; }
                if (status === "failed") {
                  let errMsg = "desconhecido";
                  try { errMsg = JSON.parse(latest.serviceExceptionJson)?.errorCode || errMsg; } catch {}
                  await fail(ln(`❌ Power BI falhou: ${errMsg}`));
                  return;
                }
              }
            }
          } catch {}
        }

        if (!pbiOk) {
          await fail(ln("❌ Timeout aguardando Power BI (2h)"));
          return;
        }
        await appendLog(ln(`✅ "${ds.name}" atualizado com sucesso!`));
      }

      // ── Etapa 3: Automação ──────────────────────────────────────
      if (tarefa.automacaoId) {
        await storage.updateAutoTarefa(tarefaId, { status: "executando_automacao" });
        const script = await storage.getPythonScriptById(tarefa.automacaoId);
        if (!script) {
          await fail(ln("❌ Automação não encontrada no cadastro"));
          return;
        }
        await appendLog(ln(`⚙️ Iniciando automação "${script.nome}"...`));

        const execTs = new Date().toLocaleTimeString("pt-BR");
        const exec = await storage.createPythonExecution({
          scriptId: script.id, scriptNome: script.nome,
          iniciadoEm: Date.now(), status: "executando",
          logs: [`[${execTs}] Iniciado pelo Auto-Tarefa "${tarefa.nome}"...`],
          origem: "agendado",
        });
        await storage.updatePythonScript(script.id, { ultimaExecucao: Date.now(), ultimoStatus: "executando" });

        if (vmBusy) {
          const pos = vmQueue.length + 1;
          vmQueue.push({ scriptId: script.id, execId: exec.id, scriptNome: script.nome, origem: "agendado", enfileiradoEm: Date.now() });
          await storage.updatePythonScript(script.id, { ultimoStatus: "aguardando" });
          await appendLog(ln(`⏳ VM ocupada. Aguardando na fila (pos ${pos})...`));
          const MAX_WAIT_MS = 3 * 60 * 60 * 1000;
          const waitStart = Date.now();
          while (Date.now() - waitStart < MAX_WAIT_MS) {
            await new Promise(r => setTimeout(r, 15_000));
            const execRec = await storage.getPythonExecutionById(exec.id);
            if (!execRec) break;
            if (execRec.status === "concluido" || execRec.status === "erro" || execRec.status === "timeout") {
              if (execRec.status !== "concluido") {
                await fail(ln(`❌ Automação terminou com status: ${execRec.status}`));
                return;
              }
              break;
            }
          }
        } else {
          vmBusy = true;
          await runScriptOnVm(script.id, exec.id);
          const execRec = await storage.getPythonExecutionById(exec.id);
          if (execRec && execRec.status !== "concluido") {
            await fail(ln(`❌ Automação terminou com status: ${execRec.status}`));
            return;
          }
        }
        await appendLog(ln(`✅ Automação "${script.nome}" concluída!`));
      }

      // ── Concluído ───────────────────────────────────────────────
      await appendLog(ln("🎉 Auto-Tarefa concluída com sucesso!"));
      await storage.updateAutoTarefa(tarefaId, { status: "concluido", ultimoStatus: "sucesso" });
      setTimeout(async () => {
        const t = await storage.getAutoTarefaById(tarefaId);
        if (t?.status === "concluido") await storage.updateAutoTarefa(tarefaId, { status: "idle" });
      }, 5 * 60_000);

    } catch (e: any) {
      try {
        await storage.appendAutoTarefaLog(tarefaId, ln(`❌ Erro inesperado: ${e?.message || String(e)}`));
        await storage.updateAutoTarefa(tarefaId, { status: "erro", ultimoStatus: "erro" });
        setTimeout(async () => {
          const t = await storage.getAutoTarefaById(tarefaId);
          if (t?.status === "erro") await storage.updateAutoTarefa(tarefaId, { status: "idle" });
        }, 5 * 60_000);
      } catch {}
    } finally {
      runningAutoTarefas.delete(tarefaId);
    }
  }

  (function startAutoTarefaScheduler() {
    setInterval(async () => {
      try {
        const tarefas = await storage.getAllAutoTarefas();
        const now = Date.now();
        for (const tarefa of tarefas) {
          if (!tarefa.ativo) continue;
          if (!tarefa.agendamento || tarefa.agendamento.tipo === "nenhum") continue;
          if (!tarefa.agendamento.habilitado) continue;
          if (!tarefa.proximaExecucao || now < tarefa.proximaExecucao) continue;
          if (runningAutoTarefas.has(tarefa.id)) continue;
          // Advance next run immediately to prevent double-trigger
          const nextRun = calcPythonNextRun({ agendamento: tarefa.agendamento });
          await storage.updateAutoTarefa(tarefa.id, { proximaExecucao: nextRun });
          executeAutoTarefa(tarefa.id);
        }
      } catch {}
    }, 30_000);
    console.log("[AutoTarefa] Scheduler iniciado (verifica a cada 30s)");
  })();

  // ─── Auto Tarefas CRUD ───────────────────────────────────────────
  app.get("/api/auto-tarefas", async (_req, res) => {
    res.json(await storage.getAllAutoTarefas());
  });

  app.post("/api/auto-tarefas", async (req, res) => {
    try {
      const { nome, descricao, ativo, agendamento, verificacaoBanco, pbiDatasetId, automacaoId } = req.body;
      if (!nome) return res.status(400).json({ error: "nome é obrigatório" });
      const item = await storage.createAutoTarefa({
        nome, descricao: descricao ?? "", ativo: ativo ?? true,
        agendamento, verificacaoBanco: verificacaoBanco ?? [],
        pbiDatasetId, automacaoId,
      });
      // Calculate initial next run if scheduled
      if (agendamento && agendamento.tipo !== "nenhum" && agendamento.habilitado !== false) {
        const nextRun = calcPythonNextRun({ agendamento });
        await storage.updateAutoTarefa(item.id, { proximaExecucao: nextRun });
      }
      res.json(await storage.getAutoTarefaById(item.id));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.put("/api/auto-tarefas/:id", async (req, res) => {
    try {
      const { nome, descricao, ativo, agendamento, verificacaoBanco, pbiDatasetId, automacaoId } = req.body;
      const updates: any = { nome, descricao, ativo, agendamento, verificacaoBanco, pbiDatasetId, automacaoId };
      if (agendamento && agendamento.tipo !== "nenhum" && agendamento.habilitado !== false) {
        updates.proximaExecucao = calcPythonNextRun({ agendamento });
      } else {
        updates.proximaExecucao = undefined;
      }
      const updated = await storage.updateAutoTarefa(req.params.id, updates);
      if (!updated) return res.status(404).json({ error: "não encontrado" });
      res.json(updated);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/auto-tarefas/:id", async (req, res) => {
    await storage.deleteAutoTarefa(req.params.id);
    res.json({ ok: true });
  });

  app.post("/api/auto-tarefas/:id/run", async (req, res) => {
    const tarefa = await storage.getAutoTarefaById(req.params.id);
    if (!tarefa) return res.status(404).json({ error: "não encontrado" });
    if (runningAutoTarefas.has(req.params.id)) return res.status(409).json({ error: "já em execução" });
    executeAutoTarefa(req.params.id);
    res.json({ ok: true, message: "iniciado" });
  });

  // ─── DB Auto CRUD ───────────────────────────────────────────────
  app.get("/api/db-auto-configs", async (_req, res) => {
    res.json(await storage.getAllDbAutoConfigs());
  });
  app.post("/api/db-auto-configs", async (req, res) => {
    try {
      const item = await storage.createDbAutoConfig(req.body);
      res.json(item);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.put("/api/db-auto-configs/:id", async (req, res) => {
    const updated = await storage.updateDbAutoConfig(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "não encontrado" });
    res.json(updated);
  });
  app.delete("/api/db-auto-configs/:id", async (req, res) => {
    await storage.deleteDbAutoConfig(req.params.id);
    res.json({ ok: true });
  });

  app.get("/api/db-auto-monitors", async (_req, res) => {
    res.json(await storage.getAllDbAutoMonitors());
  });
  app.post("/api/db-auto-monitors", async (req, res) => {
    try {
      const item = await storage.createDbAutoMonitor({
        ...req.body,
        ultimoStatus: "unknown",
      });
      res.json(item);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.put("/api/db-auto-monitors/:id", async (req, res) => {
    const updated = await storage.updateDbAutoMonitor(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "não encontrado" });
    res.json(updated);
  });
  app.delete("/api/db-auto-monitors/:id", async (req, res) => {
    await storage.deleteDbAutoMonitor(req.params.id);
    res.json({ ok: true });
  });

  app.get("/api/db-auto-logs", async (_req, res) => {
    res.json(await storage.getAllDbAutoLogs());
  });
  app.delete("/api/db-auto-logs", async (_req, res) => {
    await storage.clearDbAutoLogs();
    res.json({ ok: true });
  });

  // Manual trigger for a specific monitor
  app.post("/api/db-auto-run-now/:id", async (req, res) => {
    const config = (await storage.getAllDbAutoConfigs()).find(c => c.id === req.params.id);
    if (!config) return res.status(404).json({ error: "monitor não encontrado" });
    const tableKey = `${config.schema}.${config.table}`;
    await storage.updateDbAutoConfig(config.id, { ultimoStatus: "running_fix" });
    await storage.addDbAutoLog({ configId: config.id, tableKey, timestamp: new Date().toISOString(), tipo: "fix_triggered", mensagem: `Execução manual disparada para ${tableKey}` });
    runDbAutoFix(config).catch(() => {});
    res.json({ ok: true });
  });

  // ─── DB Auto Watchdog ───────────────────────────────────────────
  async function runDbAutoFix(config: any) {
    const tableKey = `${config.schema}.${config.table}`;
    const start = Date.now();
    try {
      if (!config.exeUrl) {
        await storage.updateDbAutoConfig(config.id, { ultimoStatus: "error", ultimoErro: "URL do EXE não configurada." });
        await storage.addDbAutoLog({ configId: config.id, tableKey, timestamp: new Date().toISOString(), tipo: "fix_error", mensagem: "URL do EXE não configurada", duracao: Date.now() - start });
        return;
      }
      const resp = await fetch(config.exeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ database: config.database, schema: config.schema, table: config.table, timestamp_column: config.timestampColumn }),
        signal: AbortSignal.timeout(330_000),
      });
      const responseText = await resp.text().catch(() => "");
      const success = resp.ok;
      await storage.updateDbAutoConfig(config.id, {
        ultimoStatus: success ? "ok" : "error",
        ultimoErro: success ? undefined : `HTTP ${resp.status}: ${responseText.slice(0, 200)}`,
        ultimaVerificacao: new Date().toISOString(),
      });
      await storage.addDbAutoLog({
        configId: config.id, tableKey,
        timestamp: new Date().toISOString(),
        tipo: success ? "fix_ok" : "fix_error",
        mensagem: success ? `EXE executado com sucesso (${Math.round((Date.now()-start)/1000)}s)` : `Erro HTTP ${resp.status}: ${responseText.slice(0, 200)}`,
        duracao: Date.now() - start,
      });
    } catch (e: any) {
      await storage.updateDbAutoConfig(config.id, { ultimoStatus: "error", ultimoErro: e.message });
      await storage.addDbAutoLog({ configId: config.id, tableKey, timestamp: new Date().toISOString(), tipo: "fix_error", mensagem: `Erro ao chamar EXE: ${e.message}`, duracao: Date.now() - start });
    }
  }

  (async () => {
    setInterval(async () => {
      try {
        const configs = await storage.getAllDbAutoConfigs();
        for (const config of configs) {
          if (!config.ativo || config.ultimoStatus === "running_fix") continue;
          if (!config.table || !config.timestampColumn) continue;
          const tableKey = `${config.schema}.${config.table}`;
          const intervalMs = (config.limiarMinutos || 120) * 60 * 1000;
          let pool: any;
          try {
            pool = await getDbPool(config.database);
            const r = await pool.query(
              `SELECT MAX("${config.timestampColumn.replace(/"/g,'')}")::text AS v FROM "${config.schema.replace(/"/g,'')}"."${config.table.replace(/"/g,'')}"`
            );
            const lastUpdate = r.rows[0]?.v || null;
            const now = new Date();
            const checkTs = now.toISOString();
            await pool.end().catch(() => {}); pool = null;

            const lastUpdateMs = lastUpdate ? new Date(lastUpdate.includes("+") || lastUpdate.toUpperCase().endsWith("Z") ? lastUpdate.replace(" ","T") : lastUpdate.replace(" ","T")+"-03:00").getTime() : 0;
            const staleMs = now.getTime() - lastUpdateMs;
            const isStale = lastUpdateMs === 0 || staleMs > intervalMs;

            await storage.updateDbAutoConfig(config.id, {
              ultimaVerificacao: checkTs,
              ultimaAtualizacaoTabela: lastUpdate || undefined,
              ultimoStatus: isStale ? "stale" : "ok",
              ultimoErro: isStale ? `${Math.round(staleMs/60000)} min sem atualização` : undefined,
            });
            await storage.addDbAutoLog({
              configId: config.id, tableKey, timestamp: checkTs,
              tipo: isStale ? "check_stale" : "check_ok",
              mensagem: isStale
                ? `Tabela DESATUALIZADA — ${Math.round(staleMs/60000)}min sem atualizar (limiar: ${config.limiarMinutos}min)`
                : `OK — última atualização ${Math.round(staleMs/60000)} min atrás`,
            });

            if (isStale && config.exeUrl) {
              await storage.addDbAutoLog({ configId: config.id, tableKey, timestamp: new Date().toISOString(), tipo: "fix_triggered", mensagem: `Disparando EXE: ${config.exeUrl}` });
              await storage.updateDbAutoConfig(config.id, { ultimoStatus: "running_fix" });
              runDbAutoFix(config).catch(() => {});
            }
          } catch (e: any) {
            await storage.updateDbAutoConfig(config.id, { ultimoStatus: "error", ultimoErro: e.message, ultimaVerificacao: new Date().toISOString() });
          } finally {
            if (pool) await pool.end().catch(() => {});
          }
        }
      } catch {}
    }, 5 * 60 * 1000);
    console.log("[DbAuto] Watchdog iniciado (verifica a cada 5min)");
  })();

  // ===========================
  // Gestão Meta Routes
  // ===========================

  // --- WABAs ---
  app.get("/api/meta/wabas", async (_req, res) => {
    // Auto-registra WABAs para números que ainda não têm entrada na lista
    const phones = await storage.getAllMetaPhoneNumbers();
    const existing = await storage.getAllMetaWabas();
    const existingMetaIds = new Set(existing.map(w => w.wabaId));
    for (const p of phones) {
      if (p.wabaId && !existingMetaIds.has(p.wabaId)) {
        await storage.upsertMetaWabaByMetaId(p.wabaId);
        existingMetaIds.add(p.wabaId);
      }
    }
    res.json(await storage.getAllMetaWabas());
  });

  // --- Operações ---
  app.get("/api/meta/operacoes", async (_req, res) => {
    res.json(await storage.getAllMetaOperacoes());
  });
  app.post("/api/meta/operacoes", async (req, res) => {
    const { nome } = req.body;
    if (!nome || typeof nome !== "string") return res.status(400).json({ error: "nome required" });
    res.status(201).json(await storage.createMetaOperacao(nome.trim()));
  });
  app.delete("/api/meta/operacoes/:id", async (req, res) => {
    const ok = await storage.deleteMetaOperacao(req.params.id);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  });

  // --- Global Bearer Token (never returned to frontend) ---
  app.get("/api/meta/global-token", async (_req, res) => {
    const t = await storage.getMetaGlobalToken();
    res.json({ configured: t.length > 0 });
  });
  app.post("/api/meta/global-token", async (req, res) => {
    const { token } = req.body;
    if (!token || typeof token !== "string") return res.status(400).json({ error: "token required" });
    await storage.setMetaGlobalToken(token.trim());
    res.json({ configured: true });
  });

  // --- Lookup WABA phones (uses global token, does NOT save to storage) ---
  app.post("/api/meta/lookup-waba", async (req, res) => {
    const { wabaId } = req.body;
    if (!wabaId) return res.status(400).json({ error: "wabaId required" });
    const token = await storage.getMetaGlobalToken();
    if (!token) return res.status(400).json({ error: "Bearer token não configurado. Configure primeiro na aba Configuração." });
    try {
      const url = `https://graph.facebook.com/v19.0/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier,status&access_token=${token}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const json = await resp.json() as any;
      if (!resp.ok) return res.status(502).json({ error: json?.error?.message || "Erro na Meta API" });
      res.json({ phones: json.data || [] });
    } catch (err: any) {
      res.status(502).json({ error: err.message || "Falha ao consultar a Meta" });
    }
  });

  // --- Phone Numbers ---
  app.get("/api/meta/phone-numbers", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await storage.getAllMetaPhoneNumbers());
  });
  app.post("/api/meta/phone-numbers", async (req, res) => {
    const { phoneId, displayPhoneNumber, verifiedName, qualityRating, messagingLimitTier, status, wabaId, operacaoId } = req.body;
    if (!phoneId) return res.status(400).json({ error: "phoneId required" });
    // Auto-registra o WABA no mapa de apelidos se ainda não existir
    if (wabaId) await storage.upsertMetaWabaByMetaId(String(wabaId));
    const phone = await storage.upsertMetaPhoneNumber({
      phoneId,
      displayPhoneNumber: displayPhoneNumber || phoneId,
      verifiedName: verifiedName || "",
      qualityRating: qualityRating || "UNKNOWN",
      messagingLimitTier: messagingLimitTier || "",
      status: status || "CONNECTED",
      wabaId: wabaId || undefined,
      operacaoId: operacaoId || undefined,
    });
    res.status(201).json(phone);
  });

  app.patch("/api/meta/wabas/:id/apelido", async (req, res) => {
    const { apelido } = req.body;
    if (!apelido || typeof apelido !== "string") return res.status(400).json({ error: "apelido required" });
    const updated = await storage.updateMetaWabaApelido(req.params.id, apelido.trim());
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });
  app.patch("/api/meta/phone-numbers/:id/operacao", async (req, res) => {
    const { operacaoId } = req.body;
    const updated = await storage.updateMetaPhoneOperacao(req.params.id, operacaoId || undefined);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });
  app.patch("/api/meta/phone-numbers/:id/canal", async (req, res) => {
    const { canalId } = req.body;
    const updated = await storage.updateMetaPhoneCanal(req.params.id, canalId || undefined);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });
  app.delete("/api/meta/phone-numbers/:id", async (req, res) => {
    const ok = await storage.deleteMetaPhoneNumber(req.params.id);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  });

  // --- Templates ---
  app.get("/api/meta/templates", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await storage.getAllMetaTemplates());
  });
  app.patch("/api/meta/templates/:id/operacao", async (req, res) => {
    const { operacaoId } = req.body;
    const updated = await storage.updateMetaTemplateOperacao(req.params.id, operacaoId || undefined);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });
  app.delete("/api/meta/templates/:id", async (req, res) => {
    const ok = await storage.deleteMetaTemplate(req.params.id);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  });

  // --- Proxy: Fetch phone numbers from Meta Graph API ---
  app.post("/api/meta/fetch-numbers/:wabaId", async (req, res) => {
    const waba = await storage.getMetaWabaWithToken(req.params.wabaId);
    if (!waba) return res.status(404).json({ error: "WABA not found" });
    try {
      const url = `https://graph.facebook.com/v19.0/${waba.wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier,status&access_token=${waba.token}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const json = await resp.json() as any;
      if (!resp.ok) return res.status(502).json({ error: json?.error?.message || "Meta API error" });
      const phones = (json.data || []) as any[];
      // Upsert into storage
      const saved = await Promise.all(phones.map((p: any) =>
        storage.upsertMetaPhoneNumber({
          phoneId: p.id,
          displayPhoneNumber: p.display_phone_number,
          verifiedName: p.verified_name || "",
          qualityRating: (p.quality_rating || "UNKNOWN") as any,
          messagingLimitTier: p.messaging_limit_tier || "",
          status: (p.status || "CONNECTED") as any,
          wabaId: waba.id,
        })
      ));
      await storage.updateMetaWabaLastSync(waba.id);
      res.json({ phones: saved });
    } catch (err: any) {
      res.status(502).json({ error: err.message || "Failed to fetch from Meta" });
    }
  });

  // --- Proxy: Fetch templates for a single Meta WABA ID using global token ---
  app.post("/api/meta/fetch-templates/:metaWabaId", async (req, res) => {
    const token = await storage.getMetaGlobalToken();
    if (!token) return res.status(400).json({ error: "Token global não configurado" });
    const metaWabaId = req.params.metaWabaId;
    try {
      const url = `https://graph.facebook.com/v20.0/${metaWabaId}/message_templates?fields=id,name,status,category,language,quality_score,components&limit=200&access_token=${token}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const json = await resp.json() as any;
      if (!resp.ok) return res.status(502).json({ error: json?.error?.message || "Meta API error" });
      const templates = (json.data || []) as any[];
      const saved = await Promise.all(templates.map((t: any) => {
        const bodyComp = (t.components || []).find((c: any) => c.type === "BODY");
        return storage.upsertMetaTemplate({
          templateId: t.id,
          name: t.name,
          status: (t.status || "PENDING") as any,
          category: (t.category || "MARKETING") as any,
          language: t.language || "pt_BR",
          qualityScore: (t.quality_score?.score || "UNKNOWN") as any,
          wabaId: metaWabaId,
          bodyText: bodyComp?.text ?? undefined,
        });
      }));
      res.json({ count: saved.length, templates: saved });
    } catch (err: any) {
      res.status(502).json({ error: err.message || "Failed to fetch from Meta" });
    }
  });

  // ── COGNA: listar origens disponíveis na base ────────────────────────────────
  app.get("/api/cogna/origens", async (_req, res) => {
    let pool: any;
    try {
      pool = await getDbPool();

      // verifica se a tabela existe (sem sensibilidade a maiúsculas/minúsculas no schema)
      const existsQ = await pool.query(`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE UPPER(table_schema) = 'COGNA_BRONZE'
          AND table_name = 'disparo_interno_cogna'
        LIMIT 1
      `);
      if (existsQ.rows.length === 0) {
        return res.json({ origens: [], diagnostico: "tabela_nao_existe" });
      }

      const schema = existsQ.rows[0].table_schema; // nome real do schema (ex: "COGNA_BRONZE" ou "cogna_bronze")

      // conta total de linhas
      const totalQ = await pool.query(
        `SELECT COUNT(*) AS total FROM "${schema}".disparo_interno_cogna`
      );
      const totalRows = Number(totalQ.rows[0].total);
      if (totalRows === 0) {
        return res.json({ origens: [], diagnostico: "tabela_vazia" });
      }

      // busca origens com coluna disparo_realizado como inteiro ou booleano
      const r = await pool.query(`
        SELECT origem,
               COUNT(*)                                              AS total,
               COUNT(*) FILTER (WHERE disparo_realizado::int = 0)   AS pendentes
        FROM "${schema}".disparo_interno_cogna
        WHERE origem IS NOT NULL AND TRIM(origem) <> ''
        GROUP BY origem
        ORDER BY pendentes DESC, origem
      `);

      if (r.rows.length === 0) {
        return res.json({ origens: [], diagnostico: "sem_origem", totalRows });
      }

      res.json({
        origens: r.rows.map((row: any) => ({
          origem:    row.origem,
          total:     Number(row.total),
          pendentes: Number(row.pendentes),
        })),
        diagnostico: "ok",
        totalRows,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Erro ao buscar origens" });
    } finally {
      if (pool) await pool.end().catch(() => {});
    }
  });

  // ── COGNA: gerar CSV de uma origem (disparo_realizado = 0) ────────────────────
  app.get("/api/cogna/rows-csv", async (req, res) => {
    const origem = String(req.query.origem ?? "").trim();
    if (!origem) return res.status(400).json({ error: "Parâmetro 'origem' obrigatório" });
    const limite = req.query.limite ? Math.max(1, parseInt(String(req.query.limite))) : null;

    // data_disparo: aceita YYYY-MM-DD (do frontend) e formata como DD/MM/YYYY para lista_nome
    const dataParam = String(req.query.data ?? "").trim();
    let dataFormatada = "";
    if (dataParam) {
      const parts = dataParam.split("-"); // YYYY-MM-DD
      if (parts.length === 3) dataFormatada = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    if (!dataFormatada) {
      // fallback: data atual no Brasil (UTC-3)
      const now = new Date(Date.now() - 3 * 3600 * 1000);
      const dd = String(now.getUTCDate()).padStart(2, "0");
      const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
      const yyyy = now.getUTCFullYear();
      dataFormatada = `${dd}/${mm}/${yyyy}`;
    }
    let pool: any;
    try {
      pool = await getDbPool();

      // resolve schema real
      const existsQ = await pool.query(`
        SELECT table_schema FROM information_schema.tables
        WHERE UPPER(table_schema) = 'COGNA_BRONZE' AND table_name = 'disparo_interno_cogna' LIMIT 1
      `);
      const schema = existsQ.rows[0]?.table_schema ?? "COGNA_BRONZE";

      const r = await pool.query(
        `SELECT cpf, telefone, nome, curso, unidade, canal_origem, modalidade, nivel_escolaridade, origem
         FROM "${schema}".disparo_interno_cogna
         WHERE origem = $1 AND disparo_realizado::int = 0
         ORDER BY cpf
         ${limite ? `LIMIT ${limite}` : ""}`,
        [origem]);

      // Monta CSV com separador ponto e vírgula
      // Header alinhado com DISPARO_COLUNAS_OBRIGATORIAS + colunas extras da COGNA
      const header = "telefone;nome;cpf;canaldeorigem;curso;unidade;origem;lista_nome;modalidade;nivelescolaridade";
      const lines = [header];
      for (const row of r.rows) {
        const esc = (v: unknown) => {
          const s = String(v ?? "").replace(/"/g, '""');
          return s.includes(";") ? `"${s}"` : s;
        };
        lines.push([
          esc(row.telefone),
          esc(row.nome),
          esc(row.cpf),
          esc(row.canal_origem),
          esc(row.curso),
          esc(row.unidade),
          esc(row.origem),
          esc(`${row.origem}&${dataFormatada}`), // lista_nome = origem&DD/MM/AAAA
          esc(row.modalidade),
          esc(row.nivel_escolaridade),
        ].join(";"));
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.send(lines.join("\n"));
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Erro ao gerar CSV" });
    } finally {
      if (pool) await pool.end().catch(() => {});
    }
  });

  // ── COGNA: upload de base para discador ─────────────────────────────────────
  app.post("/api/cogna/upload-base", async (req, res) => {
    const { rows } = req.body as {
      rows: Array<{
        cpf?: string; telefone?: string; nome?: string; unidade?: string;
        canal_origem?: string; curso?: string; modalidade?: string;
        nivel_escolaridade?: string; origem?: string;
        disparo_realizado?: boolean;
      }>
    };
    if (!Array.isArray(rows) || rows.length === 0)
      return res.status(400).json({ error: "Nenhuma linha enviada" });

    let pool: any;
    try {
      pool = await getDbPool();

      // garante que schema/tabela existem
      await pool.query(`CREATE SCHEMA IF NOT EXISTS "COGNA_BRONZE"`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "COGNA_BRONZE".disparo_interno_cogna (
          cpf                 VARCHAR(11),
          telefone            VARCHAR(20),
          nome                VARCHAR(200),
          unidade             VARCHAR(100),
          canal_origem        VARCHAR(50),
          curso               VARCHAR(100),
          modalidade          VARCHAR(50),
          nivel_escolaridade  VARCHAR(50),
          origem              VARCHAR(50),
          disparo_realizado   INTEGER
        )
      `);
      // migra tabela existente: adiciona nome e curso se não existirem
      await pool.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema='COGNA_BRONZE' AND table_name='disparo_interno_cogna' AND column_name='nome')
          THEN ALTER TABLE "COGNA_BRONZE".disparo_interno_cogna ADD COLUMN nome VARCHAR(200); END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema='COGNA_BRONZE' AND table_name='disparo_interno_cogna' AND column_name='curso')
          THEN ALTER TABLE "COGNA_BRONZE".disparo_interno_cogna ADD COLUMN curso VARCHAR(100); END IF;
        END $$
      `);
      // migra tabela existente de BOOLEAN para INTEGER (idempotente)
      await pool.query(`
        DO $$ BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'COGNA_BRONZE'
               AND table_name   = 'disparo_interno_cogna'
               AND column_name  = 'disparo_realizado'
               AND data_type    = 'boolean'
          ) THEN
            ALTER TABLE "COGNA_BRONZE".disparo_interno_cogna
              ALTER COLUMN disparo_realizado TYPE INTEGER USING (disparo_realizado::int);
          END IF;
        END $$
      `);
      // chave única (origem, cpf, telefone) — idempotente
      await pool.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE c.conname = 'uq_disparo_cogna_origem_cpf_tel'
              AND n.nspname = 'COGNA_BRONZE'
          ) THEN
            ALTER TABLE "COGNA_BRONZE".disparo_interno_cogna
            ADD CONSTRAINT uq_disparo_cogna_origem_cpf_tel
            UNIQUE (origem, cpf, telefone);
          END IF;
        END $$
      `);

      let inserted = 0;
      let errors   = 0;

      // insere em lotes de 200 dentro de uma transação
      const BATCH = 200;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const values: unknown[] = [];
        const placeholders = chunk.map((row, idx) => {
          const base = idx * 10;
          values.push(
            row.cpf               ?? null,
            row.telefone          ?? null,
            row.nome              ?? null,
            row.unidade           ?? null,
            row.canal_origem      ?? null,
            row.curso             ?? null,
            row.modalidade        ?? null,
            row.nivel_escolaridade ?? null,
            row.origem            ?? null,
            row.disparo_realizado ?? false,
          );
          return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10})`;
        });

        try {
          const result = await pool.query(
            `INSERT INTO "COGNA_BRONZE".disparo_interno_cogna
             (cpf, telefone, nome, unidade, canal_origem, curso, modalidade, nivel_escolaridade, origem, disparo_realizado)
             VALUES ${placeholders.join(",")}
             ON CONFLICT (origem, cpf, telefone) DO UPDATE SET
               nome               = COALESCE(EXCLUDED.nome, disparo_interno_cogna.nome),
               unidade            = EXCLUDED.unidade,
               canal_origem       = EXCLUDED.canal_origem,
               curso              = COALESCE(EXCLUDED.curso, disparo_interno_cogna.curso),
               modalidade         = EXCLUDED.modalidade,
               nivel_escolaridade = EXCLUDED.nivel_escolaridade
             RETURNING 1`,
            values,
          );
          inserted += result.rows.length; // RETURNING conta inserts + updates corretamente
        } catch {
          errors += chunk.length;
        }
      }

      res.json({ inserted, errors });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Erro ao inserir dados" });
    } finally {
      if (pool) await pool.end().catch(() => {});
    }
  });

  // ── GET conversation analytics (dados já buscados pelo sync) ───────────────
  app.get("/api/meta/conversation-analytics", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await storage.getAllMetaConversationAnalytics());
  });

  // ── helper: busca conversation analytics de uma WABA (últimos 7 dias) ──────
  async function fetchConversationAnalyticsWaba(
    wabaId: string,
    token: string,
  ): Promise<number[]> {
    const nowTs       = Math.floor(Date.now() / 1000);
    const dayMs       = 86400;
    const todayMidnight = nowTs - (nowTs % dayMs);
    const startTs     = todayMidnight - 6 * dayMs;

    const field = `conversation_analytics`
      + `.start(${startTs})`
      + `.end(${nowTs})`
      + `.granularity(DAILY)`
      + `.phone_numbers([])`
      + `.conversation_types(["REGULAR"])`
      + `.conversation_directions(["BUSINESS_INITIATED"])`
      + `.dimensions(["conversation_direction"])`;

    const url = `https://graph.facebook.com/v20.0/${wabaId}`
      + `?fields=${encodeURIComponent(field)}`
      + `&access_token=${token}`;

    const daily7d = Array(7).fill(0) as number[];
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return daily7d;
      const json = await resp.json() as any;
      const dataPoints: any[] = json?.conversation_analytics?.data?.[0]?.data_points ?? [];
      for (const pt of dataPoints) {
        const dayIndex = Math.round((pt.start - startTs) / dayMs);
        if (dayIndex >= 0 && dayIndex < 7) {
          daily7d[dayIndex] += (pt.conversation ?? 0);
        }
      }
    } catch { /* mantém zeros */ }
    return daily7d;
  }

  // ── helper: busca analytics de templates de uma WABA (últimos 7 dias) ──────
  async function fetchWabaAnalytics(
    wabaId: string,
    token: string,
    templateIds: string[],
  ): Promise<Record<string, number[]>> {
    if (templateIds.length === 0) return {};

    const nowTs      = Math.floor(Date.now() / 1000);
    const dayMs      = 86400;
    const todayMidnight = nowTs - (nowTs % dayMs);
    const startTs    = todayMidnight - 6 * dayMs; // índice 0 = há 6 dias

    // mapa: templateId → [day0..day6]  (contagem SENT por dia)
    const map: Record<string, number[]> = {};

    const processPoint = (point: any) => {
      if (!point?.template_id) return;
      const tid = String(point.template_id);
      if (!map[tid]) map[tid] = Array(7).fill(0);
      const dayIndex = Math.round((point.start - startTs) / dayMs);
      if (dayIndex >= 0 && dayIndex < 7) {
        map[tid][dayIndex] += (point.sent || 0);
      }
    };

    // Meta permite até ~10 template_ids por chamada — busca em lotes
    const BATCH = 10;
    for (let i = 0; i < templateIds.length; i += BATCH) {
      const batch = templateIds.slice(i, i + BATCH);
      const idsParam = encodeURIComponent(JSON.stringify(batch));
      const url = `https://graph.facebook.com/v19.0/${wabaId}/template_analytics`
        + `?start=${startTs}&end=${nowTs}`
        + `&granularity=DAILY`
        + `&metric_types=${encodeURIComponent('["SENT","DELIVERED","READ"]')}`
        + `&template_ids=${idsParam}`
        + `&access_token=${token}`;

      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) continue; // falha de lote → mantém zeros, não aborta tudo

      const json = await resp.json() as any;
      const rawData = json?.data || [];

      for (const entry of rawData) {
        if (Array.isArray(entry?.data_points)) {
          // formato A: data_points[] com template_id em cada ponto
          for (const pt of entry.data_points) processPoint(pt);
        } else if (entry?.template_id) {
          // formato B: entry representa um template, data_points aninhados
          const pts = Array.isArray(entry.data_points) ? entry.data_points : [entry];
          for (const pt of pts) processPoint({ ...pt, template_id: entry.template_id });
        }
      }
    }
    return map;
  }

  // --- Proxy: Fetch templates + analytics para todos os WABAs dos números cadastrados ---
  app.post("/api/meta/fetch-templates-all", async (req, res) => {
    const token = await storage.getMetaGlobalToken();
    if (!token) return res.status(400).json({ error: "Token global não configurado" });
    const phones = await storage.getAllMetaPhoneNumbers();
    if (phones.length === 0) return res.status(400).json({ error: "Nenhum número cadastrado — adicione ao menos um número primeiro" });

    // monta mapa wabaId → operacaoId a partir dos telefones já cadastrados
    const wabaOperacaoMap: Record<string, string | undefined> = {};
    for (const p of phones) {
      if (p.wabaId && !(p.wabaId in wabaOperacaoMap)) {
        wabaOperacaoMap[p.wabaId] = p.operacaoId;
      }
    }
    const wabaIds = Object.keys(wabaOperacaoMap);

    const results: { wabaId: string; operacao?: string; count: number; disparosTotal: number; error?: string }[] = [];

    for (const wabaId of wabaIds) {
      const operacaoId = wabaOperacaoMap[wabaId];
      try {
        // 1. busca metadados dos templates
        const tplUrl = `https://graph.facebook.com/v20.0/${wabaId}/message_templates`
          + `?fields=id,name,status,category,language,quality_score,components&limit=200&access_token=${token}`;
        const tplResp = await fetch(tplUrl, { signal: AbortSignal.timeout(15000) });
        const tplJson = await tplResp.json() as any;
        if (!tplResp.ok) {
          results.push({ wabaId, count: 0, disparosTotal: 0, error: tplJson?.error?.message || "Meta API error" });
          continue;
        }
        const templates = (tplJson.data || []) as any[];

        // 2. busca analytics (últimos 7 dias) — falha silenciosa: apenas deixa zeros
        const templateIds = templates.map((t: any) => String(t.id));
        const [analyticsMap, convDaily7d] = await Promise.all([
          fetchWabaAnalytics(wabaId, token, templateIds).catch(() => ({} as Record<string, number[]>)),
          fetchConversationAnalyticsWaba(wabaId, token).catch(() => Array(7).fill(0) as number[]),
        ]);

        // salva conversation analytics para exposição via GET
        await storage.setMetaConversationAnalytics(wabaId, convDaily7d);

        // 3. salva templates com métricas
        await Promise.all(templates.map((t: any) => {
          const history: number[] = analyticsMap[String(t.id)] ?? Array(7).fill(0);
          const disparo7d = history.reduce((s: number, v: number) => s + v, 0);
          const bodyComp = (t.components || []).find((c: any) => c.type === "BODY");
          return storage.upsertMetaTemplate({
            templateId:        t.id,
            name:              t.name,
            status:            (t.status || "PENDING") as any,
            category:          (t.category || "MARKETING") as any,
            language:          t.language || "pt_BR",
            qualityScore:      (t.quality_score?.score || "UNKNOWN") as any,
            wabaId,
            operacaoId,
            bodyText:          bodyComp?.text ?? undefined,
            disparo7d,
            disparo7dHistory:  history,
          });
        }));

        const disparosTotal = templates.reduce((s: number, t: any) => {
          const h = analyticsMap[String(t.id)] ?? [];
          return s + h.reduce((a: number, b: number) => a + b, 0);
        }, 0);

        results.push({ wabaId, operacao: operacaoId, count: templates.length, disparosTotal });
      } catch (err: any) {
        results.push({ wabaId, count: 0, disparosTotal: 0, error: err.message });
      }
    }

    const total = results.reduce((s, r) => s + r.count, 0);
    const totalDisparos = results.reduce((s, r) => s + r.disparosTotal, 0);
    res.json({ total, totalDisparos, results });
  });

  // ── Scheduler: qualidade dos números (a cada 10 min) ──────────────────────
  (async () => {
    const runPhoneQualitySync = async () => {
      const token = await storage.getMetaGlobalToken();
      if (!token) return; // token não configurado — pula silenciosamente

      const phones = await storage.getAllMetaPhoneNumbers();
      const wabaIds = [...new Set(phones.map(p => p.wabaId).filter(Boolean))] as string[];
      if (wabaIds.length === 0) return;

      let updated = 0;
      for (const wabaId of wabaIds) {
        try {
          const url = `https://graph.facebook.com/v20.0/${wabaId}/phone_numbers`
            + `?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier,status`
            + `&access_token=${token}`;
          const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
          if (!resp.ok) continue;
          const json = await resp.json() as any;
          for (const p of (json.data || []) as any[]) {
            // preserva operacaoId, canalId, wabaId do storage — apenas atualiza campos de qualidade
            const existing = phones.find(x => x.phoneId === p.id);
            await storage.upsertMetaPhoneNumber({
              phoneId:            p.id,
              displayPhoneNumber: p.display_phone_number || existing?.displayPhoneNumber || p.id,
              verifiedName:       p.verified_name || existing?.verifiedName || "",
              qualityRating:      p.quality_rating  || "UNKNOWN",
              messagingLimitTier: p.messaging_limit_tier || "",
              status:             p.status || "CONNECTED",
              wabaId,
              operacaoId:         existing?.operacaoId,
              canalId:            existing?.canalId,
            });
            updated++;
          }
        } catch { /* falha de um WABA não interrompe os demais */ }
      }
      if (updated > 0) {
        console.log(`[MetaQuality] Sync automático: ${updated} número(s) atualizado(s) de ${wabaIds.length} WABA(s)`);
      }
    };

    // roda imediatamente no boot (após 30s para dar tempo ao servidor subir) e depois a cada 10min
    setTimeout(() => runPhoneQualitySync().catch(() => {}), 30_000);
    setInterval(() => runPhoneQualitySync().catch(() => {}), 10 * 60 * 1000);
    console.log("[MetaQuality] Scheduler iniciado (qualidade a cada 10min)");
  })();

  // ── Scheduler: conversation analytics (a cada 6h) ─────────────────────────
  (async () => {
    const runConvAnalyticsSync = async () => {
      const token = await storage.getMetaGlobalToken();
      if (!token) return;

      const phones = await storage.getAllMetaPhoneNumbers();
      const wabaIds = [...new Set(phones.map(p => p.wabaId).filter(Boolean))] as string[];
      if (wabaIds.length === 0) return;

      let synced = 0;
      for (const wabaId of wabaIds) {
        try {
          const daily7d = await fetchConversationAnalyticsWaba(wabaId, token);
          await storage.setMetaConversationAnalytics(wabaId, daily7d);
          synced++;
        } catch { /* falha silenciosa por WABA */ }
      }
      if (synced > 0) {
        console.log(`[MetaConv] Sync automático: analytics de ${synced} WABA(s) atualizadas`);
      }
    };

    // roda 1 min após o boot (depois do quality sync) e depois a cada 6h
    setTimeout(() => runConvAnalyticsSync().catch(() => {}), 60_000);
    setInterval(() => runConvAnalyticsSync().catch(() => {}), 6 * 60 * 60 * 1000);
    console.log("[MetaConv] Scheduler iniciado (conversation analytics a cada 6h)");
  })();

  return httpServer;
}

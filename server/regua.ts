/**
 * Régua Automática — BigQuery query engine + discador API + scheduler
 */
import { BigQuery } from "@google-cloud/bigquery";
import type { IStorage } from "./storage";
import type { ReguaRotina, ReguaLog } from "@shared/schema";

// Tracks in-progress rotina IDs to prevent concurrent runs (scheduler + manual)
const runningRotinas = new Set<string>();

// ─────────────────────────────────────────────────────────────
// Phone normalization
// ─────────────────────────────────────────────────────────────

/**
 * Normalizes a raw phone string to the format: DDD (2 digits) + 9 + 8 digits = 11 digits total.
 * - Strips all non-digit characters
 * - Removes country code 55 if present (leaving 11 digits)
 * - Inserts mobile 9 after DDD if only 10 digits remain
 * Returns the normalized digit-only string (or original stripped digits if unrecognized format).
 */
export function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  // Remove country code 55 → 13 or 12 digits become 11 or 10
  if ((digits.length === 13 || digits.length === 12) && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  // Insert mobile 9 after DDD if 10 digits (old format without 9)
  if (digits.length === 10) {
    digits = digits.slice(0, 2) + "9" + digits.slice(2);
  }
  return digits;
}

// ─────────────────────────────────────────────────────────────
// BigQuery helpers
// ─────────────────────────────────────────────────────────────

/**
 * Service account JSONs copied from some sources have literal newlines (\n)
 * inside the private_key string value, which is invalid JSON.
 * This function sanitizes the raw string before parsing.
 */
export function sanitizeCredentialsJson(raw: string): string {
  // Fast-path: already valid
  try { JSON.parse(raw); return raw; } catch {}

  // Replace real newlines ONLY inside the private_key string value.
  // Strategy: find the private_key value between quotes, escape any
  // bare newlines that appear before the closing quote.
  let fixed = raw.replace(
    /"private_key"\s*:\s*"([\s\S]*?)"\s*(?=[,}])/,
    (_match, keyValue: string) => {
      const escaped = keyValue.replace(/\r\n/g, "\\n").replace(/\n/g, "\\n").replace(/\r/g, "\\n");
      return `"private_key": "${escaped}"`;
    }
  );

  // Second attempt: if the whole JSON still has bare newlines outside strings,
  // remove structural newlines while keeping string content intact.
  try { JSON.parse(fixed); return fixed; } catch {}

  // Last resort: strip ALL bare newlines (safe for minified JSON files)
  fixed = raw.replace(/\r?\n/g, "\\n");
  return fixed;
}

function buildBqClient(credentialsJson: string): BigQuery {
  const credentials = JSON.parse(sanitizeCredentialsJson(credentialsJson));
  return new BigQuery({
    projectId: credentials.project_id,
    credentials,
  });
}

/** Reads the dataset metadata to discover the region (location) where it is stored. */
async function getDatasetLocation(bq: BigQuery, projectId: string, dataset: string): Promise<string> {
  try {
    const ds = bq.dataset(dataset, { projectId });
    const [meta] = await ds.getMetadata();
    return (meta as any).location ?? "southamerica-east1";
  } catch {
    return "southamerica-east1";
  }
}

export async function bqListDatasets(credentialsJson: string): Promise<string[]> {
  const bq = buildBqClient(credentialsJson);
  const [datasets] = await bq.getDatasets();
  return datasets.map((d: any) => d.id as string).filter(Boolean);
}

export async function bqListTables(credentialsJson: string, projectId: string, dataset: string): Promise<string[]> {
  const bq = buildBqClient(credentialsJson);
  const ds = bq.dataset(dataset, { projectId });
  const [tables] = await ds.getTables();
  return tables.map((t: any) => t.id as string).filter(Boolean);
}

export async function bqGetSchema(
  credentialsJson: string,
  projectId: string,
  dataset: string,
  table: string
): Promise<Array<{ name: string; type: string; mode: string }>> {
  const bq = buildBqClient(credentialsJson);
  const ds = bq.dataset(dataset, { projectId });
  const tb = ds.table(table);
  const [metadata] = await tb.getMetadata();
  const fields = metadata.schema?.fields ?? [];
  return fields.map((f: any) => ({
    name: f.name,
    type: f.type,
    mode: f.mode ?? "NULLABLE",
  }));
}

/**
 * Resolves dynamic date tokens in filter values before building SQL.
 *
 * Supported tokens (case-insensitive):
 *   D-0  → today          (YYYY-MM-DD, Brazil time UTC-3)
 *   D-1  → yesterday
 *   D-2  → 2 days ago
 *   D+1  → tomorrow
 *   D+N  → N days from today
 *
 * Any other value is returned unchanged.
 */
export function resolveDynamicDate(value: string): string {
  const match = value.trim().match(/^[Dd]([+-]\d+)$/);
  if (!match) return value;
  const offset = parseInt(match[1], 10);
  // Use Brazil time (UTC-3) to determine "today"
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000);
  now.setUTCDate(now.getUTCDate() + offset);
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Converts BigQuery special value objects (BigQueryTimestamp, BigQueryDate, etc.)
 * to plain strings/numbers so JSON.stringify doesn't produce "[object Object]".
 */
function flattenBqRow(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) {
      out[k] = null;
    } else if (typeof v === "object" && "value" in v) {
      // BigQueryTimestamp / BigQueryDate / BigQueryDatetime / BigQueryInt
      out[k] = (v as any).value;
    } else if (typeof v === "bigint") {
      out[k] = v.toString();
    } else if (Array.isArray(v)) {
      out[k] = JSON.stringify(v);
    } else if (typeof v === "object") {
      out[k] = JSON.stringify(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Builds a SQL WHERE clause from filters, resolving dynamic date tokens (D-1, D+0, etc.).
 * Returns empty string when no valid filters exist.
 */
function buildWhereSql(filtros: Array<{ coluna: string; operador: string; valor: string }>): string {
  const clauses = filtros
    .filter(f => f.coluna && f.operador)
    .map(f => {
      if (f.operador === "IS NULL" || f.operador === "IS NOT NULL") {
        return `\`${f.coluna}\` ${f.operador}`;
      }

      // Detect dynamic date token BEFORE resolving (e.g. D-1, D-0, D+1)
      const isDynamicDate = /^[Dd][+-]\d+$/.test(f.valor.trim());

      // Resolve dynamic date tokens in the value
      const resolvedValor = resolveDynamicDate(f.valor);

      // When using a dynamic date (D-N), wrap the column in DATE() so that
      // TIMESTAMP/DATETIME fields compare correctly against a plain date string.
      // e.g. DATE(`tickettracking_finishedat`) = '2026-03-18'
      const colSql = isDynamicDate ? `DATE(\`${f.coluna}\`)` : `\`${f.coluna}\``;

      if (f.operador === "IN" || f.operador === "NOT IN") {
        const vals = resolvedValor.split(",").map(v => `'${v.trim().replace(/'/g, "\\'")}'`).join(", ");
        return `${colSql} ${f.operador} (${vals})`;
      }
      if (f.operador === "LIKE") {
        return `${colSql} LIKE '${resolvedValor.replace(/'/g, "\\'")}'`;
      }
      // Numeric check — if the resolved value is a date string it won't be numeric → quoted
      const numeric = !isNaN(Number(resolvedValor)) && resolvedValor.trim() !== "";
      const valSql = numeric ? resolvedValor : `'${resolvedValor.replace(/'/g, "\\'")}'`;
      return `${colSql} ${f.operador} ${valSql}`;
    });
  return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
}

export async function bqRunQuery(
  credentialsJson: string,
  projectId: string,
  dataset: string,
  table: string,
  columns: string[],
  filtros: Array<{ coluna: string; operador: string; valor: string }>,
  limit = 10000
): Promise<Record<string, any>[]> {
  const bq = buildBqClient(credentialsJson);

  const colsSql = columns.length > 0
    ? columns.map(c => `\`${c}\``).join(", ")
    : "*";

  const whereSql = buildWhereSql(filtros);
  const sql = `SELECT ${colsSql} FROM \`${projectId}.${dataset}.${table}\` ${whereSql} LIMIT ${limit}`;

  const location = await getDatasetLocation(bq, projectId, dataset);
  const [rows] = await bq.query({ query: sql, location });
  return (rows as Record<string, any>[]).map(flattenBqRow);
}

/**
 * Returns COUNT(*) with the same filters — for the total rows badge in the UI preview.
 */
export async function bqCountQuery(
  credentialsJson: string,
  projectId: string,
  dataset: string,
  table: string,
  filtros: Array<{ coluna: string; operador: string; valor: string }>
): Promise<number> {
  const bq = buildBqClient(credentialsJson);
  const whereSql = buildWhereSql(filtros);
  const sql = `SELECT COUNT(*) as total FROM \`${projectId}.${dataset}.${table}\` ${whereSql}`;
  const location = await getDatasetLocation(bq, projectId, dataset);
  const [rows] = await bq.query({ query: sql, location });
  const row = (rows as any[])[0];
  // COUNT(*) returns BigInt-like object in some clients
  const raw = row?.total;
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === "object" && "value" in raw) return Number(raw.value);
  return Number(raw);
}

// ─────────────────────────────────────────────────────────────
// Discador API
// ─────────────────────────────────────────────────────────────

const OPERACOES = { 1: "Ativa (Kroton)", 12: "Pós Graduação", 14: "Singularidades" } as const;

function classifyNetworkError(e: any): string {
  const cause = e?.cause as any;
  const code = cause?.code ?? e?.code ?? "";
  const causeMsg = String(cause?.message ?? cause ?? "");
  if (code === "ENOTFOUND" || causeMsg.includes("ENOTFOUND") || causeMsg.includes("getaddrinfo"))
    return `Host não encontrado (DNS): ${cause?.hostname ?? (e?.cause?.hostname ?? "")}`;
  if (code === "ECONNREFUSED" || causeMsg.includes("ECONNREFUSED"))
    return "Conexão recusada pelo servidor";
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || causeMsg.includes("ETIMEDOUT") || e?.name === "AbortError")
    return "Timeout de conexão (servidor não respondeu em 30s)";
  if (code === "ECONNRESET" || causeMsg.includes("ECONNRESET"))
    return "Conexão interrompida pelo servidor";
  if (code) return `Erro de rede [${code}]: ${causeMsg.slice(0, 80)}`;
  // Fallback: include cause string for debugging
  const detail = causeMsg || (e?.message ?? "desconhecido");
  return `Falha de rede: ${detail.slice(0, 100)}`;
}

async function sendToDiscador(
  discadorUrl: string,
  discadorKey: string,
  payload: Record<string, any>
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${discadorUrl.replace(/\/$/, "")}/?k=${discadorKey}&m=contatos&a=adicionar`;
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(payload)) {
    if (v !== null && v !== undefined && v !== "") form.append(k, String(v));
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000); // 30s — same as Python reference
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: controller.signal,
    });
    const body = await resp.text();
    return { ok: resp.ok, status: resp.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

// ─────────────────────────────────────────────────────────────
// Scheduler helpers
// ─────────────────────────────────────────────────────────────

function nowBR(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}

export function calcNextRun(rotina: ReguaRotina): number | undefined {
  const { agendamento } = rotina;
  const now = nowBR();

  if (agendamento.tipo === "uma_vez") {
    if (!agendamento.dataHoraUnica) return undefined;
    const [datePart, timePart] = agendamento.dataHoraUnica.split(" ");
    const [y, m, d] = datePart.split("-").map(Number);
    const [hh, mm] = (timePart ?? "00:00").split(":").map(Number);
    return new Date(y, m - 1, d, hh, mm, 0).getTime();
  }

  if (agendamento.tipo === "todo_dia") {
    const [hh, mm] = (agendamento.horario ?? "08:00").split(":").map(Number);
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0);
    if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
    return t.getTime();
  }

  if (agendamento.tipo === "toda_hora") {
    const t = new Date(now.getTime());
    t.setMinutes(0, 0, 0);
    t.setHours(t.getHours() + 1);
    return t.getTime();
  }

  if (agendamento.tipo === "a_cada_x_horas") {
    const h = agendamento.intervalo ?? 1;
    return now.getTime() + h * 3600 * 1000;
  }

  if (agendamento.tipo === "a_cada_x_dias") {
    const d = agendamento.intervalo ?? 1;
    const [hh, mm] = (agendamento.horario ?? "08:00").split(":").map(Number);
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, hh, mm, 0);
    return t.getTime();
  }

  if (agendamento.tipo === "semanal") {
    const dias = agendamento.diasSemana ?? [1];
    const [hh, mm] = (agendamento.horario ?? "08:00").split(":").map(Number);
    for (let offset = 1; offset <= 7; offset++) {
      const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hh, mm, 0);
      if (dias.includes(t.getDay())) return t.getTime();
    }
  }

  return undefined;
}

// ─────────────────────────────────────────────────────────────
// Execute one routine
// ─────────────────────────────────────────────────────────────

export function isRotinaRunning(id: string): boolean {
  return runningRotinas.has(id);
}

export async function executeReguaRotina(
  rotina: ReguaRotina,
  storage: IStorage
): Promise<void> {
  // Prevent concurrent executions of the same routine
  if (runningRotinas.has(rotina.id)) {
    console.warn(`[Régua] Rotina ${rotina.nome} já está em execução — ignorando disparo duplicado.`);
    return;
  }
  runningRotinas.add(rotina.id);

  try {
    await _executeReguaRotina(rotina, storage);
  } finally {
    runningRotinas.delete(rotina.id);
  }
}

async function _executeReguaRotina(
  rotina: ReguaRotina,
  storage: IStorage
): Promise<void> {
  const config = await storage.getReguaConfig();
  if (!config.credentialsJson) {
    throw new Error("BigQuery não configurado — insira as credenciais em Configurações.");
  }

  const logEntry = await storage.createReguaLog({
    rotinaId: rotina.id,
    rotinaNome: rotina.nome,
    iniciadoEm: Date.now(),
    status: "em_andamento",
    totalRegistros: 0,
    enviadosOk: 0,
    duplicados: 0,
    erros: 0,
    mensagens: [`[${new Date().toLocaleTimeString("pt-BR")}] Iniciando rotina "${rotina.nome}"...`],
  });

  const log = (msg: string) => {
    const line = `[${new Date().toLocaleTimeString("pt-BR")}] ${msg}`;
    console.log(`[Régua][${rotina.nome}] ${msg}`);
    logEntry.mensagens.push(line);
    storage.updateReguaLog(logEntry.id, { mensagens: [...logEntry.mensagens] });
  };

  try {
    const columns = rotina.mapeamento.map(m => m.colunaBq).filter(Boolean);
    log(`Consultando BigQuery: ${config.projectId}.${rotina.dataset}.${rotina.tabela}`);
    if (rotina.filtros.length > 0) {
      log(`Filtros ativos: ${rotina.filtros.map(f => `${f.coluna} ${f.operador} ${f.valor}`).join(", ")}`);
    }

    const rows = await bqRunQuery(
      config.credentialsJson,
      config.projectId,
      rotina.dataset,
      rotina.tabela,
      columns,
      rotina.filtros,
      10000
    );

    log(`✔ ${rows.length} registro(s) retornados do BigQuery.`);
    logEntry.totalRegistros = rows.length;

    let enviadosOk = 0;
    let duplicados = 0;
    let erros = 0;
    let consecutiveNetworkErrors = 0;
    const MAX_CONSECUTIVE_NETWORK_ERRORS = 3;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // Build API payload — mirrors the Python reference script exactly
      const payload: Record<string, any> = {
        operacao_id:    rotina.operacaoId,
        lista_id:       rotina.listaId,           // numeric list ID (ex: 5341)
        campanha_id:    rotina.campanhaId ?? undefined, // avoids ELR03 error
        chamada_retorno: -1,
      };
      // Remove undefined fields
      if (payload.campanha_id === undefined) delete payload.campanha_id;

      for (const m of rotina.mapeamento) {
        if (m.colunaBq && m.campoApi) {
          const val = row[m.colunaBq];
          payload[m.campoApi] = val !== null && val !== undefined ? String(val) : "";
        }
      }

      // Normalize phone field → DDD + 9 + 8 digits (strip 55, insert 9 if needed)
      if (payload.contato_telefone_1) {
        payload.contato_telefone_1 = normalizePhone(String(payload.contato_telefone_1));
      }

      // Deduplication check (use already-normalized phone from payload)
      const phone = payload.contato_telefone_1 ? String(payload.contato_telefone_1) : "";
      if (phone) {
        if (storage.isPhoneDuplicate(rotina.operacaoId, rotina.listaId, phone)) {
          duplicados++;
          if (duplicados <= 5) log(`  ⚠ [${i + 1}] Telefone duplicado ignorado: ${phone}`);
          continue;
        }
      }

      // Required field checks
      if (!payload.contato_codigo || !payload.contato_nome || !payload.contato_telefone_1) {
        erros++;
        if (erros <= 5) log(`  ✘ [${i + 1}] Registro ignorado — campo obrigatório vazio (codigo/nome/telefone)`);
        continue;
      }

      try {
        const result = await sendToDiscador(config.discadorUrl, config.discadorKey, payload);
        if (result.ok) {
          consecutiveNetworkErrors = 0;
          enviadosOk++;
          if (phone) storage.registerSentPhone(rotina.operacaoId, rotina.listaId, phone);
          if (enviadosOk <= 3 || enviadosOk % 100 === 0) {
            log(`  ✔ [${i + 1}] Enviado: ${payload.contato_nome} / ${payload.contato_telefone_1}`);
          }
        } else {
          consecutiveNetworkErrors = 0;
          erros++;
          if (erros <= 5) log(`  ✘ [${i + 1}] Erro HTTP ${result.status}: ${result.body.slice(0, 100)}`);
        }
      } catch (e: any) {
        erros++;
        consecutiveNetworkErrors++;
        const reason = classifyNetworkError(e);
        if (erros <= 5) log(`  ✘ [${i + 1}] Erro ao enviar: ${reason}`);
        if (consecutiveNetworkErrors >= MAX_CONSECUTIVE_NETWORK_ERRORS) {
          const remaining = rows.length - i - 1;
          log(`⛔ Abortando: ${MAX_CONSECUTIVE_NETWORK_ERRORS} falhas de rede consecutivas.`);
          log(`   Causa: ${reason}`);
          log(`   Verifique se a URL do discador está correta e acessível: ${config.discadorUrl}`);
          log(`   Os ${remaining} registros restantes não foram processados.`);
          erros += remaining;
          break;
        }
      }

      // Throttle: small pause every 50 records
      if ((i + 1) % 50 === 0) await new Promise(r => setTimeout(r, 200));
    }

    log(`${"─".repeat(40)}`);
    log(`✅ Concluído — Total: ${rows.length} | Enviados: ${enviadosOk} | Duplicados: ${duplicados} | Erros: ${erros}`);
    log(`Telefones únicos na lista ID ${rotina.listaId}: ${storage.getRegisteredPhonesCount(rotina.operacaoId, rotina.listaId)}`);

    await storage.updateReguaLog(logEntry.id, {
      status: "concluido",
      concluidoEm: Date.now(),
      totalRegistros: rows.length,
      enviadosOk,
      duplicados,
      erros,
      mensagens: [...logEntry.mensagens],
    });

    // Schedule next run
    const next = calcNextRun(rotina);
    if (rotina.agendamento.tipo === "uma_vez") {
      await storage.updateReguaRotina(rotina.id, {
        status: "concluido",
        ultimaExecucao: Date.now(),
        proximaExecucao: undefined,
      });
    } else {
      await storage.updateReguaRotina(rotina.id, {
        ultimaExecucao: Date.now(),
        proximaExecucao: next,
      });
    }
  } catch (err: any) {
    log(`❌ ERRO FATAL: ${err?.message ?? String(err)}`);
    await storage.updateReguaLog(logEntry.id, {
      status: "erro",
      concluidoEm: Date.now(),
      mensagens: [...logEntry.mensagens],
    });
    await storage.updateReguaRotina(rotina.id, {
      status: "erro",
      ultimaExecucao: Date.now(),
    });
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// Scheduler (called from routes.ts)
// ─────────────────────────────────────────────────────────────

export function startReguaScheduler(storage: IStorage) {
  setInterval(async () => {
    try {
      const rotinas = await storage.getActiveReguaRotinas();
      const now = Date.now();
      for (const rotina of rotinas) {
        if (runningRotinas.has(rotina.id)) continue;
        if (!rotina.proximaExecucao) continue;
        if (rotina.proximaExecucao > now) continue;

        console.log(`[Régua Scheduler] Disparando rotina: ${rotina.nome} (${rotina.id})`);
        // executeReguaRotina already manages runningRotinas internally
        executeReguaRotina(rotina, storage)
          .catch(e => console.error(`[Régua] Erro na rotina ${rotina.nome}:`, e));
      }
    } catch (err) {
      console.error("[Régua Scheduler] Erro:", err);
    }
  }, 30000);
  console.log("[Régua] Scheduler iniciado (verifica a cada 30s)");
}

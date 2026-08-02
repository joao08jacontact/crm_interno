// GLPI API Integration Service

let storedGlpiConfig: { apiUrl: string; appToken: string; userToken: string } | null = null;

export function setGlpiRuntimeConfig(config: { apiUrl: string; appToken: string; userToken: string }) {
  storedGlpiConfig = config;
  cachedSessionToken = null;
}

export function getGlpiRuntimeConfig() {
  return storedGlpiConfig;
}

function getGlpiBaseUrl(): string {
  if (storedGlpiConfig?.apiUrl) return storedGlpiConfig.apiUrl;
  return process.env.GLPI_API_URL || "https://chamados.jacontactcenter.com.br/apirest.php";
}

function getGlpiAppToken(): string | undefined {
  return storedGlpiConfig?.appToken || process.env.GLPI_APP_TOKEN;
}

function getGlpiUserToken(): string | undefined {
  return storedGlpiConfig?.userToken || process.env.GLPI_USER_TOKEN;
}

function normalizeGLPIDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    // GLPI dates are in local Brazil time (UTC-3), so we parse them as local and keep them as ISO
    // The dateStr format is "YYYY-MM-DD HH:MM:SS" in Brazil time
    const date = new Date(dateStr.replace(" ", "T") + "-03:00");
    return date.toISOString();
  } catch {
    return null;
  }
}

interface GLPITicketRaw {
  id: number;
  name: string;
  content: string;
  status: number;
  urgency: number;
  impact: number;
  priority: number;
  itilcategories_id: number;
  date: string;
  date_mod: string;
  closedate: string | null;
  solvedate: string | null;
  users_id_recipient: number;
  type: number;
}

interface GLPICategoryRaw {
  id: number;
  name: string;
  completename: string;
}

export interface GLPITicket {
  id: number;
  titulo: string;
  descricao: string;
  status: string;
  statusCode: number;
  prioridade: string;
  prioridadeCode: number;
  categoria: string;
  categoriaId: number;
  dataCriacao: string;
  dataModificacao: string;
  dataFechamento: string | null;
  tipo: string;
  operacao: string | null;
  solicitanteId: number;
}

export interface GLPIStats {
  total: number;
  novos: number;
  emProcessamento: number;
  pendentes: number;
  resolvidos: number;
  fechados: number;
}

// GLPI Status mapping
const STATUS_MAP: Record<number, string> = {
  1: "Novo",
  2: "Em Processamento (atribuído)",
  3: "Em Processamento (planejado)",
  4: "Pendente",
  5: "Resolvido",
  6: "Fechado"
};

// Priority mapping
const PRIORITY_MAP: Record<number, string> = {
  1: "Muito Baixa",
  2: "Baixa",
  3: "Média",
  4: "Alta",
  5: "Muito Alta",
  6: "Crítica"
};

// Type mapping
const TYPE_MAP: Record<number, string> = {
  1: "Incidente",
  2: "Requisição"
};

// Decode HTML entities
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#60;/g, "<")
    .replace(/&#62;/g, ">")
    .replace(/&#38;/g, "&")
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .trim();
}

function extractOperacaoFromContent(content: string): string | null {
  const decoded = decodeHtmlEntities(content);
  const match = decoded.match(/Operação\s*(?:Origem|Destino)?\s*:\s*([^\n]+)/i);
  if (match) {
    let operacao = match[1].trim();
    operacao = operacao.replace(/&nbsp;/gi, " ").replace(/\s+/g, " ");
    // Stop at "Dados da Ação" or numbered fields like "5)"
    operacao = operacao.split(/\s*Dados\s*da\s*Ação/i)[0];
    operacao = operacao.split(/\s*\d+\s*\)/)[0];
    return operacao.trim() || null;
  }
  return null;
}

let cachedSessionToken: string | null = null;

async function initGLPISession(): Promise<string> {
  const appToken = getGlpiAppToken();
  const userToken = getGlpiUserToken();

  if (!appToken || !userToken) {
    throw new Error("GLPI_APP_TOKEN and GLPI_USER_TOKEN must be configured");
  }

  console.log("[GLPI] Requesting new session token via initSession...");
  const response = await fetch(`${getGlpiBaseUrl()}/initSession`, {
    method: "GET",
    headers: {
      "App-Token": appToken,
      "Authorization": `user_token ${userToken}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GLPI initSession error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as { session_token: string };
  cachedSessionToken = data.session_token;
  console.log("[GLPI] Session token obtained successfully");
  return cachedSessionToken;
}

async function getSessionToken(): Promise<string> {
  if (cachedSessionToken) return cachedSessionToken;
  return initGLPISession();
}

async function fetchGLPI<T>(endpoint: string, isRetry = false): Promise<T> {
  const appToken = getGlpiAppToken();
  const sessionToken = await getSessionToken();

  if (!appToken) {
    throw new Error("GLPI_APP_TOKEN not configured");
  }

  const response = await fetch(`${getGlpiBaseUrl()}${endpoint}`, {
    headers: {
      "App-Token": appToken,
      "Session-Token": sessionToken,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401 && !isRetry) {
      console.log("[GLPI] Session expired, refreshing token...");
      cachedSessionToken = null;
      return fetchGLPI<T>(endpoint, true);
    }
    throw new Error(`GLPI API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

let categoriesCache: Map<number, string> = new Map();

export async function loadCategories(): Promise<void> {
  try {
    const categories = await fetchGLPI<GLPICategoryRaw[]>(
      "/ITILCategory/?range=0-9999&sort=name&order=ASC"
    );
    categoriesCache = new Map(categories.map(c => [c.id, c.completename || c.name]));
  } catch (error) {
    console.error("Failed to load GLPI categories:", error);
  }
}

export async function getTickets(range: string = "0-199"): Promise<GLPITicket[]> {
  try {
    // Load categories if not cached
    if (categoriesCache.size === 0) {
      await loadCategories();
    }

    const rawTickets = await fetchGLPI<GLPITicketRaw[]>(`/Ticket/?range=${range}`);

    return rawTickets.map(ticket => ({
      id: ticket.id,
      titulo: ticket.name,
      descricao: decodeHtmlEntities(ticket.content),
      status: STATUS_MAP[ticket.status] || "Desconhecido",
      statusCode: ticket.status,
      prioridade: PRIORITY_MAP[ticket.priority] || "Média",
      prioridadeCode: ticket.priority,
      categoria: categoriesCache.get(ticket.itilcategories_id) || "Sem categoria",
      categoriaId: ticket.itilcategories_id,
      dataCriacao: normalizeGLPIDate(ticket.date) || ticket.date,
      dataModificacao: normalizeGLPIDate(ticket.date_mod) || ticket.date_mod,
      dataFechamento: normalizeGLPIDate(ticket.closedate),
      tipo: TYPE_MAP[ticket.type] || "Incidente",
      operacao: extractOperacaoFromContent(ticket.content),
      solicitanteId: ticket.users_id_recipient
    }));
  } catch (error) {
    console.error("Failed to fetch GLPI tickets:", error);
    throw error;
  }
}

export async function getTicketStats(): Promise<GLPIStats> {
  try {
    const tickets = await getTickets("0-9999");
    
    return {
      total: tickets.length,
      novos: tickets.filter(t => t.statusCode === 1).length,
      emProcessamento: tickets.filter(t => t.statusCode === 2 || t.statusCode === 3).length,
      pendentes: tickets.filter(t => t.statusCode === 4).length,
      resolvidos: tickets.filter(t => t.statusCode === 5).length,
      fechados: tickets.filter(t => t.statusCode === 6).length
    };
  } catch (error) {
    console.error("Failed to get GLPI stats:", error);
    throw error;
  }
}

export async function getCategories(): Promise<{ id: number; name: string }[]> {
  if (categoriesCache.size === 0) {
    await loadCategories();
  }
  return Array.from(categoriesCache.entries()).map(([id, name]) => ({ id, name }));
}

// Chart data for last 30 days
export interface ChartDataPoint {
  date: string;
  abertos: number;
  fechados: number;
}

export async function getChartData(): Promise<ChartDataPoint[]> {
  try {
    const tickets = await getTickets("0-9999");
    const now = new Date();
    const last30Days: ChartDataPoint[] = [];

    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];
      const displayDate = `${date.getDate().toString().padStart(2, "0")}/${(date.getMonth() + 1).toString().padStart(2, "0")}`;

      const abertos = tickets.filter(t => t.dataCriacao.startsWith(dateStr)).length;
      const fechados = tickets.filter(t => t.dataFechamento?.startsWith(dateStr)).length;

      last30Days.push({ date: displayDate, abertos, fechados });
    }

    return last30Days;
  } catch (error) {
    console.error("Failed to get chart data:", error);
    throw error;
  }
}

// Time metrics
export interface TimeMetrics {
  tempoMedioFechamento: string;
  tempoMedioResolucao: string;
  tempoAtePrimeiroAtendimento: string;
  tempoMedioEspera: string;
}

function formatDuration(ms: number): string {
  if (ms <= 0 || isNaN(ms)) return "00:00:00";
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((ms % (1000 * 60)) / 1000);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export async function getTimeMetrics(): Promise<TimeMetrics> {
  try {
    const tickets = await getTickets("0-9999");
    const now = Date.now();

    // Tempo até fechamento: dataCriacao -> dataFechamento (tickets with closedate)
    const closedTickets = tickets.filter(t => t.dataFechamento);
    let totalClosingTime = 0;
    closedTickets.forEach(t => {
      const created = new Date(t.dataCriacao).getTime();
      const closed = new Date(t.dataFechamento!).getTime();
      if (closed > created) {
        totalClosingTime += closed - created;
      }
    });
    const avgClosingTime = closedTickets.length > 0 ? totalClosingTime / closedTickets.length : 0;

    // Tempo até resolução: dataCriacao -> dataModificacao para tickets resolvidos (status 5)
    // Isso é uma aproximação pois o GLPI não expõe solvedate na API padrão
    const resolvedTickets = tickets.filter(t => t.statusCode === 5);
    let totalResolutionTime = 0;
    resolvedTickets.forEach(t => {
      const created = new Date(t.dataCriacao).getTime();
      const modified = new Date(t.dataModificacao).getTime();
      if (modified > created) {
        totalResolutionTime += modified - created;
      }
    });
    const avgResolutionTime = resolvedTickets.length > 0 ? totalResolutionTime / resolvedTickets.length : 0;

    // Tempo até primeiro atendimento: tempo médio que tickets ficaram no status "Novo" (1)
    // Estimado como diferença entre criação e primeira modificação para tickets que já saíram do status Novo
    const attendedTickets = tickets.filter(t => t.statusCode >= 2 && t.statusCode <= 6);
    let totalFirstResponseTime = 0;
    let validResponseCount = 0;
    attendedTickets.forEach(t => {
      const created = new Date(t.dataCriacao).getTime();
      const modified = new Date(t.dataModificacao).getTime();
      const diff = modified - created;
      // Considerar apenas se a diferença for positiva e razoável (menos que 30 dias)
      if (diff > 0 && diff < 30 * 24 * 60 * 60 * 1000) {
        totalFirstResponseTime += diff;
        validResponseCount++;
      }
    });
    const avgFirstResponseTime = validResponseCount > 0 ? totalFirstResponseTime / validResponseCount : 0;

    // Tempo médio em espera: quanto tempo tickets pendentes (status 4) estão esperando
    // Calculado como (agora - dataModificacao) para todos os tickets pendentes
    const pendingTickets = tickets.filter(t => t.statusCode === 4);
    let totalWaitTime = 0;
    pendingTickets.forEach(t => {
      const modified = new Date(t.dataModificacao).getTime();
      const waitTime = now - modified;
      if (waitTime > 0) {
        totalWaitTime += waitTime;
      }
    });
    const avgWaitTime = pendingTickets.length > 0 ? totalWaitTime / pendingTickets.length : 0;

    return {
      tempoMedioFechamento: formatDuration(avgClosingTime),
      tempoMedioResolucao: formatDuration(avgResolutionTime),
      tempoAtePrimeiroAtendimento: formatDuration(avgFirstResponseTime),
      tempoMedioEspera: formatDuration(avgWaitTime)
    };
  } catch (error) {
    console.error("Failed to get time metrics:", error);
    throw error;
  }
}

// Default SLA hours - used only as fallback when storage config is not available
const DEFAULT_SLA_HOURS: Record<number, number> = {
  1: 7 * 24,
  2: 5 * 24,
  3: 3 * 24,
  4: 12,
  5: 4,
  6: 2
};

export interface TimelineTicket {
  id: number;
  titulo: string;
  status: string;
  statusCode: number;
  prioridade: string;
  prioridadeCode: number;
  categoria: string;
  dataInicio: string;
  dataFim: string;
  dataCriacao: string;
  dataModificacao: string;
}

function calculateDataFim(dataCriacao: string, prioridadeCode: number, slaHours: number): string {
  const startDate = new Date(dataCriacao);
  const endDate = new Date(startDate.getTime() + slaHours * 60 * 60 * 1000);
  return endDate.toISOString();
}

// Extract prazo de entrega from ticket description
function extractPrazoEntrega(descricao: string): string | null {
  // Match patterns like "Prazo de Entrega : 2026-01-28 10:00" or "7) Prazo de Entrega : 2026-01-28 10:00"
  const prazoMatch = descricao.match(/Prazo de Entrega\s*:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/i);
  if (prazoMatch && prazoMatch[1]) {
    try {
      const prazoDate = new Date(prazoMatch[1].replace(' ', 'T') + ':00');
      if (!isNaN(prazoDate.getTime())) {
        return prazoDate.toISOString();
      }
    } catch {
      return null;
    }
  }
  return null;
}

export async function getTimelineTickets(slaConfigMap?: Map<number, number>): Promise<TimelineTicket[]> {
  try {
    const tickets = await getTickets("0-9999");
    
    // Filter to show only recent tickets (last 90 days) and not closed
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const filteredTickets = tickets.filter(ticket => {
      const ticketDate = new Date(ticket.dataCriacao).getTime();
      // Include open tickets or tickets created in the last 90 days
      return ticket.statusCode < 6 || ticketDate > ninetyDaysAgo;
    });

    return filteredTickets.map(ticket => {
      const prazoFromDesc = extractPrazoEntrega(ticket.descricao);
      const slaHours = slaConfigMap?.get(ticket.prioridadeCode) ?? DEFAULT_SLA_HOURS[ticket.prioridadeCode] ?? 72;
      const slaCalculated = calculateDataFim(ticket.dataCriacao, ticket.prioridadeCode, slaHours);
      
      // Use prazo from description only if it's after the creation date; otherwise use SLA calculation
      let dataFim = slaCalculated;
      if (prazoFromDesc) {
        const prazoDate = new Date(prazoFromDesc).getTime();
        const criacaoDate = new Date(ticket.dataCriacao).getTime();
        if (prazoDate > criacaoDate) {
          dataFim = prazoFromDesc;
        }
      }
      
      return {
        id: ticket.id,
        titulo: ticket.titulo,
        status: ticket.status,
        statusCode: ticket.statusCode,
        prioridade: ticket.prioridade,
        prioridadeCode: ticket.prioridadeCode,
        categoria: ticket.categoria,
        dataInicio: ticket.dataCriacao,
        dataFim,
        dataCriacao: ticket.dataCriacao,
        dataModificacao: ticket.dataModificacao,
        operacao: ticket.operacao,
        solicitanteId: ticket.solicitanteId
      };
    });
  } catch (error) {
    console.error("Failed to get timeline tickets:", error);
    throw error;
  }
}

// Kanban data
export interface KanbanColumn {
  id: string;
  title: string;
  tickets: GLPITicket[];
  count: number;
}

export interface KanbanData {
  columns: KanbanColumn[];
}

export async function getKanbanData(): Promise<KanbanData> {
  try {
    const tickets = await getTickets("0-9999");
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;

    // Filter to show same tickets as Timeline (last 90 days or open)
    const filteredTickets = tickets.filter(ticket => {
      const ticketDate = new Date(ticket.dataCriacao).getTime();
      return ticket.statusCode < 6 || ticketDate > ninetyDaysAgo;
    });

    // Aguardando Atendimento: Novo (1)
    const aguardando = filteredTickets.filter(t => t.statusCode === 1);

    // Em Atendimento: Em Processamento (2 ou 3)
    const emAtendimento = filteredTickets.filter(t => t.statusCode === 2 || t.statusCode === 3);

    // Pendente: status 4
    const pendentes = filteredTickets.filter(t => t.statusCode === 4);

    // Separar pendentes por tempo (usando dataModificacao como proxy)
    const pendenteMais24h = pendentes.filter(t => {
      const modTime = new Date(t.dataModificacao).getTime();
      return (now - modTime) > twentyFourHours;
    });

    const pendenteMenos24h = pendentes.filter(t => {
      const modTime = new Date(t.dataModificacao).getTime();
      return (now - modTime) <= twentyFourHours;
    });

    // Solucionado: Resolvido (5)
    const solucionado = filteredTickets.filter(t => t.statusCode === 5);

    return {
      columns: [
        { id: "aguardando", title: "Aguardando Atendimento", tickets: aguardando, count: aguardando.length },
        { id: "em-atendimento", title: "Em Atendimento", tickets: emAtendimento, count: emAtendimento.length },
        { id: "pendente-mais-24h", title: "Pendente +24h", tickets: pendenteMais24h, count: pendenteMais24h.length },
        { id: "pendente-menos-24h", title: "Pendente -24h", tickets: pendenteMenos24h, count: pendenteMenos24h.length },
        { id: "solucionado", title: "Solucionado", tickets: solucionado, count: solucionado.length }
      ]
    };
  } catch (error) {
    console.error("Failed to get kanban data:", error);
    throw error;
  }
}

// ===========================
// GLPI Write Operations
// ===========================

async function postGLPI<T>(endpoint: string, data: object, isRetry = false): Promise<T> {
  const appToken = getGlpiAppToken();
  const sessionToken = await getSessionToken();

  if (!appToken) {
    throw new Error("GLPI_APP_TOKEN not configured");
  }

  const response = await fetch(`${getGlpiBaseUrl()}${endpoint}`, {
    method: "POST",
    headers: {
      "App-Token": appToken,
      "Session-Token": sessionToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401 && !isRetry) {
      console.log("[GLPI] Session expired on POST, refreshing token...");
      cachedSessionToken = null;
      return postGLPI<T>(endpoint, data, true);
    }
    throw new Error(`GLPI API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

async function putGLPI<T>(endpoint: string, data: object, isRetry = false): Promise<T> {
  const appToken = getGlpiAppToken();
  const sessionToken = await getSessionToken();

  if (!appToken) {
    throw new Error("GLPI_APP_TOKEN not configured");
  }

  const response = await fetch(`${getGlpiBaseUrl()}${endpoint}`, {
    method: "PUT",
    headers: {
      "App-Token": appToken,
      "Session-Token": sessionToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401 && !isRetry) {
      console.log("[GLPI] Session expired on PUT, refreshing token...");
      cachedSessionToken = null;
      return putGLPI<T>(endpoint, data, true);
    }
    throw new Error(`GLPI API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// Add a follow-up (acompanhamento) to a ticket
export interface AddFollowupInput {
  ticketId: number;
  content: string;
  isPrivate?: boolean;
}

export interface AddFollowupResult {
  id: number;
  message: string;
}

export async function addTicketFollowup(input: AddFollowupInput): Promise<AddFollowupResult> {
  try {
    const result = await postGLPI<{ id: number; message: string } | [{ id: number; message: string }]>("/TicketFollowup", {
      input: {
        tickets_id: input.ticketId,
        content: input.content,
        is_private: input.isPrivate ? 1 : 0
      }
    });
    
    const item = Array.isArray(result) ? result[0] : result;
    return { id: item.id, message: item.message || "Acompanhamento adicionado com sucesso" };
  } catch (error) {
    console.error("Failed to add followup:", error);
    throw error;
  }
}

// Update ticket status
export interface UpdateTicketStatusInput {
  ticketId: number;
  status: number; // 1=Novo, 2=Em Processamento (atribuído), 3=Em Processamento (planejado), 4=Pendente, 5=Resolvido, 6=Fechado
}

export interface UpdateTicketStatusResult {
  success: boolean;
  message: string;
}

export async function updateTicketStatus(input: UpdateTicketStatusInput): Promise<UpdateTicketStatusResult> {
  try {
    await putGLPI(`/Ticket/${input.ticketId}`, {
      input: {
        status: input.status
      }
    });
    
    return { success: true, message: `Status atualizado para ${STATUS_MAP[input.status] || "Desconhecido"}` };
  } catch (error) {
    console.error("Failed to update ticket status:", error);
    throw error;
  }
}

// Upload document and link to ticket
export interface UploadDocumentInput {
  ticketId: number;
  filename: string;
  base64Content: string;
}

export interface UploadDocumentResult {
  id: number;
  message: string;
}

export async function uploadDocumentToTicket(input: UploadDocumentInput): Promise<UploadDocumentResult> {
  const appToken = getGlpiAppToken();
  const sessionToken = await getSessionToken();

  if (!appToken || !sessionToken) {
    throw new Error("GLPI tokens not configured");
  }

  try {
    const fileBuffer = Buffer.from(input.base64Content, "base64");

    const boundary = `----FormBoundary${Date.now()}`;
    const manifest = JSON.stringify({
      input: {
        name: input.filename,
        _filename: [input.filename],
      }
    });

    const parts: Buffer[] = [];

    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="uploadManifest"\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      manifest + `\r\n`
    ));

    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="filename[]"; filename="${input.filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`
    ));
    parts.push(fileBuffer);
    parts.push(Buffer.from(`\r\n`));

    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const uploadResponse = await fetch(`${getGlpiBaseUrl()}/Document`, {
      method: "POST",
      headers: {
        "App-Token": appToken,
        "Session-Token": sessionToken,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!uploadResponse.ok) {
      const errText = await uploadResponse.text();
      throw new Error(`GLPI upload error: ${uploadResponse.status} - ${errText}`);
    }

    const docResult: any = await uploadResponse.json();
    const documentId = docResult.id;

    await postGLPI("/Document_Item", {
      input: {
        documents_id: documentId,
        items_id: input.ticketId,
        itemtype: "Ticket"
      }
    });

    return { id: documentId, message: "Documento anexado com sucesso" };
  } catch (error) {
    console.error("Failed to upload document:", error);
    throw error;
  }
}

// Get ticket followups
export interface TicketFollowup {
  id: number;
  content: string;
  date_creation: string;
  users_id: number;
  is_private: boolean;
}

export async function getTicketFollowups(ticketId: number): Promise<TicketFollowup[]> {
  try {
    const result = await fetchGLPI<any[]>(`/Ticket/${ticketId}/ITILFollowup`);
    return result.map(f => ({
      id: f.id,
      content: decodeHtmlEntities(f.content || ""),
      date_creation: normalizeGLPIDate(f.date_creation) || f.date_creation,
      users_id: f.users_id,
      is_private: f.is_private === 1
    }));
  } catch (error) {
    console.error("Failed to get ticket followups:", error);
    return [];
  }
}

// Get ticket timeline (followups + logs for a chronological view)
export interface TicketTimelineEvent {
  id: number;
  type: "creation" | "followup" | "solution" | "status_change" | "assignment";
  content: string;
  date: string;
  userId: number;
  isPrivate: boolean;
}

export async function getTicketTimeline(ticketId: number): Promise<TicketTimelineEvent[]> {
  const events: TicketTimelineEvent[] = [];
  
  try {
    // 1. Get followups
    const followups = await getTicketFollowups(ticketId);
    for (const f of followups) {
      events.push({
        id: f.id,
        type: "followup",
        content: f.content,
        date: f.date_creation,
        userId: f.users_id,
        isPrivate: f.is_private,
      });
    }
  } catch (e) {
    console.error("Failed to get followups for timeline:", e);
  }
  
  try {
    // 2. Get solutions (ITILSolution)
    const solutions = await fetchGLPI<any[]>(`/Ticket/${ticketId}/ITILSolution`);
    if (Array.isArray(solutions)) {
      for (const s of solutions) {
        events.push({
          id: s.id,
          type: "solution",
          content: decodeHtmlEntities(s.content || "Solução adicionada"),
          date: normalizeGLPIDate(s.date_creation) || s.date_creation,
          userId: s.users_id || 0,
          isPrivate: false,
        });
      }
    }
  } catch (e) {
    // Solutions might not exist, that's ok
  }
  
  try {
    // 3. Get ticket tasks (TicketTask)
    const tasks = await fetchGLPI<any[]>(`/Ticket/${ticketId}/TicketTask`);
    if (Array.isArray(tasks)) {
      for (const t of tasks) {
        events.push({
          id: t.id,
          type: "assignment",
          content: decodeHtmlEntities(t.content || "Tarefa atribuída"),
          date: normalizeGLPIDate(t.date_creation || t.date) || t.date_creation || t.date,
          userId: t.users_id || t.users_id_tech || 0,
          isPrivate: t.is_private === 1,
        });
      }
    }
  } catch (e) {
    // Tasks might not exist
  }
  
  // Sort by date ascending
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  return events;
}

// Update ticket responsible (operacao field - user assigned)
export interface UpdateTicketResponsibleInput {
  ticketId: number;
  responsibleName: string;
}

export interface UpdateTicketResponsibleResult {
  success: boolean;
  message: string;
}

export async function updateTicketResponsible(input: UpdateTicketResponsibleInput): Promise<UpdateTicketResponsibleResult> {
  try {
    // First, get the current ticket to get its content
    const tickets = await fetchGLPI<GLPITicketRaw[]>(`/Ticket/${input.ticketId}`);
    const ticket = Array.isArray(tickets) ? tickets[0] : tickets;
    
    if (!ticket) {
      throw new Error("Ticket not found");
    }
    
    // Update the content to include the new responsible
    let newContent = ticket.content || "";
    
    // Check if there's already an "Operação" field and replace it
    const operacaoRegex = /Operação\s*(?:Origem|Destino)?\s*:\s*[^\n]*/i;
    if (operacaoRegex.test(newContent)) {
      newContent = newContent.replace(operacaoRegex, `Operação: ${input.responsibleName}`);
    } else {
      // Add the Operação field at the beginning
      newContent = `Operação: ${input.responsibleName}\n\n${newContent}`;
    }
    
    // Update the ticket content
    await putGLPI(`/Ticket/${input.ticketId}`, {
      input: {
        content: newContent
      }
    });
    
    // Also add a followup to record the change
    await postGLPI(`/Ticket/${input.ticketId}/ITILFollowup`, {
      input: {
        content: `Responsável alterado para: ${input.responsibleName}`,
        is_private: 0
      }
    });
    
    return { success: true, message: `Responsável alterado para ${input.responsibleName}` };
  } catch (error) {
    console.error("Failed to update ticket responsible:", error);
    throw error;
  }
}

// Get ticket documents/attachments
export interface TicketDocument {
  id: number;
  name: string;
  filename: string;
  mime: string;
  date_creation: string;
}

export async function getTicketDocuments(ticketId: number): Promise<TicketDocument[]> {
  try {
    // Get document items linked to ticket
    const docItems = await fetchGLPI<any[]>(`/Ticket/${ticketId}/Document_Item`);
    
    if (!docItems || docItems.length === 0) {
      return [];
    }

    // Fetch each document's details
    const documents: TicketDocument[] = [];
    for (const item of docItems) {
      try {
        const doc = await fetchGLPI<any>(`/Document/${item.documents_id}`);
        documents.push({
          id: doc.id,
          name: doc.name || "Sem nome",
          filename: doc.filename || "",
          mime: doc.mime || "application/octet-stream",
          date_creation: normalizeGLPIDate(doc.date_creation) || doc.date_creation
        });
      } catch {
        // Skip documents that can't be fetched
      }
    }
    
    return documents;
  } catch (error) {
    console.error("Failed to get ticket documents:", error);
    return [];
  }
}

// Download document content from GLPI
export async function downloadDocument(documentId: number): Promise<{ content: Buffer; filename: string; mime: string }> {
  const appToken = getGlpiAppToken();
  const sessionToken = await getSessionToken();

  if (!appToken || !sessionToken) {
    throw new Error("GLPI tokens not configured");
  }

  try {
    // First get document details
    const doc = await fetchGLPI<any>(`/Document/${documentId}`);
    const filename = doc.filename || `document_${documentId}`;
    const mime = doc.mime || "application/octet-stream";

    // Download the document content
    const response = await fetch(`${getGlpiBaseUrl()}/Document/${documentId}`, {
      method: "GET",
      headers: {
        "App-Token": appToken,
        "Session-Token": sessionToken,
        "Accept": "application/octet-stream"
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to download document: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const content = Buffer.from(arrayBuffer);

    return { content, filename, mime };
  } catch (error) {
    console.error("Failed to download document:", error);
    throw error;
  }
}

export async function testGlpiConnection(apiUrl: string, appToken: string, userToken: string): Promise<{ success: boolean; message: string; sessionToken?: string }> {
  try {
    const response = await fetch(`${apiUrl}/initSession`, {
      method: "GET",
      headers: {
        "App-Token": appToken,
        "Authorization": `user_token ${userToken}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      let message = `Erro HTTP ${response.status}`;
      if (errorText.includes("ERROR_WRONG_APP_TOKEN_PARAMETER")) {
        message = "App-Token inválido ou API REST não habilitada no GLPI. Verifique em Configurar > Geral > API.";
      } else if (errorText.includes("ERROR_GLPI_LOGIN")) {
        message = "User-Token inválido ou usuário sem permissão. Verifique o token do usuário no GLPI.";
      } else {
        message = `Erro: ${errorText}`;
      }
      return { success: false, message };
    }

    const data = await response.json() as { session_token: string };

    try {
      await fetch(`${apiUrl}/killSession`, {
        method: "GET",
        headers: {
          "App-Token": appToken,
          "Session-Token": data.session_token,
        }
      });
    } catch {}

    return { success: true, message: "Conexão estabelecida com sucesso!", sessionToken: data.session_token };
  } catch (error: any) {
    if (error.code === "ENOTFOUND" || error.cause?.code === "ENOTFOUND") {
      return { success: false, message: "URL não encontrada. Verifique se o endereço está correto." };
    }
    return { success: false, message: `Erro de conexão: ${error.message}` };
  }
}

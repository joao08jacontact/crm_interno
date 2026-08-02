import fs from "fs";
import {
  type User,
  type InsertUser,
  type Task,
  type InsertTask,
  type Bi,
  type InsertBi,
  type BaseOrigem,
  type CanvasNode,
  type InsertCanvasNode,
  type CanvasEdge,
  type InsertCanvasEdge,
  type BiWithBases,
  type Automacao,
  type InsertAutomacao,
  type Analista,
  type InsertAnalista,
  type UpdateAnalista,
  type Solicitante,
  type InsertSolicitante,
  type TicketResponsible,
  type SlaConfig,
  type Projeto,
  type InsertProjeto,
  type UpdateProjeto,
  type Etapa,
  type InsertEtapa,
  type UpdateEtapa,
  type ProjetoWithEtapas,
  type Disparo,
  type InsertDisparo,
  type UpdateDisparo,
  type DisparoCanal,
  type InsertDisparoCanal,
  type DisparoTemplate,
  type InsertDisparoTemplate,
  type DisparoConfig,
  type RpaConfig,
  type RpaDisparo,
  type InsertRpaDisparo,
  type UpdateRpaDisparo,
  type RpaCanal,
  type InsertRpaCanal,
  type RpaTemplate,
  type InsertRpaTemplate,
  type ReguaConfig,
  type ReguaRotina,
  type InsertReguaRotina,
  type ReguaLog,
  type PythonAgentConfig,
  type PythonScript,
  type InsertPythonScript,
  type PythonExecution,
  type PythonQueueItem,
  DEFAULT_SLA_CONFIG,
  type MetaWaba,
  type MetaWabaWithToken,
  type MetaOperacao,
  type MetaPhoneNumber,
  type MetaTemplate,
  type MetaConversationAnalytics,
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Task operations (Esteira de Demandas)
  getAllTasks(ymd: string): Promise<Task[]>;
  getTaskById(id: string): Promise<Task | undefined>;
  createTask(task: InsertTask): Promise<Task>;
  updateTask(id: string, updates: Partial<Task>): Promise<Task | undefined>;
  deleteTask(id: string): Promise<boolean>;
  deleteTaskSeries(id: string): Promise<boolean>;


  // BI operations
  getAllBis(): Promise<BiWithBases[]>;
  getBiById(id: string): Promise<BiWithBases | undefined>;
  createBi(
    bi: InsertBi,
    bases: Array<{ nomeFerramenta: string; pastaOrigem: string; temApi: boolean }>
  ): Promise<Bi>;
  updateBiStatus(id: string, status: string): Promise<Bi | undefined>;
  updateBiInativo(id: string, inativo: boolean): Promise<Bi | undefined>;

  // Base operations
  getBasesByBiId(biId: string): Promise<BaseOrigem[]>;
  updateBaseStatus(
    id: string,
    status: string,
    observacao?: string
  ): Promise<BaseOrigem | undefined>;

  // Canvas operations
  getCanvasData(): Promise<{ nodes: CanvasNode[]; edges: CanvasEdge[] }>;
  saveCanvasData(
    nodes: InsertCanvasNode[],
    edges: InsertCanvasEdge[]
  ): Promise<void>;

  // Automacao operations
  getAllAutomacoes(): Promise<Automacao[]>;
  getAutomacaoById(id: string): Promise<Automacao | undefined>;
  createAutomacao(automacao: InsertAutomacao): Promise<Automacao>;
  deleteAutomacao(id: string): Promise<boolean>;

  // Analista operations
  getAllAnalistas(includeInactive?: boolean): Promise<Analista[]>;
  getAnalistaById(id: string): Promise<Analista | undefined>;
  getAnalistaByNome(nome: string): Promise<Analista | undefined>;
  validateAnalistaLogin(nome: string, senha: string): Promise<Analista | null>;
  createAnalista(analista: InsertAnalista): Promise<Analista>;
  updateAnalista(id: string, updates: UpdateAnalista): Promise<Analista | undefined>;
  deleteAnalista(id: string): Promise<boolean>;
  
  // Transfer demandas operations
  transferDemandas(deAnalistaId: string, paraAnalistaId: string, dataInicio: string, dataFim?: string, taskId?: string): Promise<number>;
  
  // Solicitante operations
  getAllSolicitantes(): Promise<Solicitante[]>;
  getSolicitanteById(id: string): Promise<Solicitante | undefined>;
  getSolicitanteByGlpiId(glpiUserId: number): Promise<Solicitante | undefined>;
  createSolicitante(solicitante: InsertSolicitante): Promise<Solicitante>;
  updateSolicitante(id: string, updates: Partial<InsertSolicitante>): Promise<Solicitante | undefined>;
  deleteSolicitante(id: string): Promise<boolean>;
  
  // Ticket Responsible operations
  getTicketResponsible(ticketId: number): Promise<TicketResponsible | undefined>;
  setTicketResponsible(ticketId: number, analistaId: string): Promise<TicketResponsible>;
  getOrAssignTicketResponsible(ticketId: number): Promise<TicketResponsible>;
  getAllTicketResponsibles(): Promise<TicketResponsible[]>;
  
  // SLA Configuration operations
  getSlaConfig(): Promise<SlaConfig[]>;
  updateSlaConfig(configs: SlaConfig[]): Promise<SlaConfig[]>;
  getSlaHorasForPrioridade(prioridadeCode: number): Promise<number>;

  // GLPI Configuration operations
  getGlpiConfig(): Promise<{ apiUrl: string; appToken: string; userToken: string }>;
  setGlpiConfig(config: { apiUrl: string; appToken: string; userToken: string }): Promise<void>;

  // Projeto operations
  getAllProjetos(): Promise<ProjetoWithEtapas[]>;
  getProjetoById(id: string): Promise<ProjetoWithEtapas | undefined>;
  createProjeto(projeto: InsertProjeto): Promise<Projeto>;
  updateProjeto(id: string, updates: UpdateProjeto): Promise<Projeto | undefined>;
  deleteProjeto(id: string): Promise<boolean>;

  // Etapa operations
  createEtapa(etapa: InsertEtapa): Promise<Etapa>;
  updateEtapa(id: string, updates: UpdateEtapa): Promise<Etapa | undefined>;
  deleteEtapa(id: string): Promise<boolean>;

  // Disparo operations
  getAllDisparos(data?: string): Promise<Disparo[]>;
  getDisparoById(id: string): Promise<Disparo | undefined>;
  createDisparo(disparo: InsertDisparo): Promise<Disparo>;
  updateDisparo(id: string, updates: UpdateDisparo): Promise<Disparo | undefined>;
  deleteDisparo(id: string): Promise<boolean>;
  getDisparosAgendados(dataHoraAtual: string): Promise<Disparo[]>;

  // Disparo Canal operations
  getAllDisparoCanais(): Promise<DisparoCanal[]>;
  getDisparoCanalById(id: string): Promise<DisparoCanal | undefined>;
  createDisparoCanal(canal: InsertDisparoCanal): Promise<DisparoCanal>;
  deleteDisparoCanal(id: string): Promise<boolean>;

  // Disparo Template operations
  getAllDisparoTemplates(canalId?: string): Promise<DisparoTemplate[]>;
  getDisparoTemplateById(id: string): Promise<DisparoTemplate | undefined>;
  createDisparoTemplate(template: InsertDisparoTemplate): Promise<DisparoTemplate>;
  deleteDisparoTemplate(id: string): Promise<boolean>;

  // Disparo global config
  getDisparoConfig(): Promise<DisparoConfig>;
  setDisparoConfig(config: DisparoConfig): Promise<void>;

  // RPA Config
  getRpaConfig(): Promise<RpaConfig>;
  setRpaConfig(config: Partial<RpaConfig>): Promise<void>;

  // RPA Disparos
  getAllRpaDisparos(data?: string): Promise<RpaDisparo[]>;
  getRpaDisparoById(id: string): Promise<RpaDisparo | undefined>;
  createRpaDisparo(disparo: InsertRpaDisparo): Promise<RpaDisparo>;
  updateRpaDisparo(id: string, updates: UpdateRpaDisparo): Promise<RpaDisparo | undefined>;
  deleteRpaDisparo(id: string): Promise<boolean>;
  getRpaDisparosAgendados(): Promise<RpaDisparo[]>;

  // RPA Canais
  getAllRpaCanais(): Promise<RpaCanal[]>;
  createRpaCanal(canal: InsertRpaCanal): Promise<RpaCanal>;
  deleteRpaCanal(id: string): Promise<boolean>;

  // RPA Templates
  getAllRpaTemplates(canalId?: string): Promise<RpaTemplate[]>;
  getRpaTemplateById(id: string): Promise<RpaTemplate | undefined>;
  createRpaTemplate(template: InsertRpaTemplate): Promise<RpaTemplate>;
  deleteRpaTemplate(id: string): Promise<boolean>;

  // Régua Automática — Config
  getReguaConfig(): Promise<ReguaConfig>;
  setReguaConfig(config: Partial<ReguaConfig>): Promise<void>;

  // Régua Automática — Rotinas
  getAllReguaRotinas(): Promise<ReguaRotina[]>;
  getReguaRotinaById(id: string): Promise<ReguaRotina | undefined>;
  createReguaRotina(rotina: InsertReguaRotina): Promise<ReguaRotina>;
  updateReguaRotina(id: string, updates: Partial<ReguaRotina>): Promise<ReguaRotina | undefined>;
  deleteReguaRotina(id: string): Promise<boolean>;
  getActiveReguaRotinas(): Promise<ReguaRotina[]>;

  // Régua Automática — Logs
  getAllReguaLogs(rotinaId?: string, limit?: number): Promise<ReguaLog[]>;
  getReguaLogById(id: string): Promise<ReguaLog | undefined>;
  createReguaLog(log: Omit<ReguaLog, "id">): Promise<ReguaLog>;
  updateReguaLog(id: string, updates: Partial<ReguaLog>): Promise<ReguaLog | undefined>;

  // Régua — Deduplication
  isPhoneDuplicate(operacaoId: number, listaId: number, phone: string): boolean;
  registerSentPhone(operacaoId: number, listaId: number, phone: string): void;
  getRegisteredPhonesCount(operacaoId: number, listaId: number): number;

  // Python Scripts — Config
  getPythonAgentConfig(): Promise<PythonAgentConfig>;
  setPythonAgentConfig(config: Partial<PythonAgentConfig>): Promise<void>;

  // Python Scripts — Scripts
  getAllPythonScripts(): Promise<PythonScript[]>;
  getPythonScriptById(id: string): Promise<PythonScript | undefined>;
  createPythonScript(script: InsertPythonScript): Promise<PythonScript>;
  updatePythonScript(id: string, updates: Partial<PythonScript>): Promise<PythonScript | undefined>;
  deletePythonScript(id: string): Promise<boolean>;
  getActivePythonScripts(): Promise<PythonScript[]>;

  // Python Scripts — Executions
  getAllPythonExecutions(scriptId?: string, limit?: number): Promise<PythonExecution[]>;
  getPythonExecutionById(id: string): Promise<PythonExecution | undefined>;
  createPythonExecution(exec: Omit<PythonExecution, "id">): Promise<PythonExecution>;
  updatePythonExecution(id: string, updates: Partial<PythonExecution>): Promise<PythonExecution | undefined>;

  // DB Config
  getDbConfig(): Promise<{ host: string; port: number; database: string; username: string; password: string; hasConfig: boolean }>;
  setDbConfig(config: Partial<{ host: string; port: number; database: string; username: string; password: string }>): Promise<void>;

  // DB Timestamp Config
  getDbTimestampConfig(database: string): Promise<Record<string, string>>;
  setDbTimestampConfig(database: string, key: string, column: string | null): Promise<void>;

  // DB Custom Blocks
  getDbCustomBlocks(database: string): Promise<DbCustomBlock[]>;
  saveDbCustomBlock(database: string, block: Omit<DbCustomBlock, "id" | "database"> & { id?: string }): Promise<DbCustomBlock>;
  deleteDbCustomBlock(database: string, id: string): Promise<void>;

  // Power BI
  getPbiConfig(): Promise<{ tenantId: string; clientId: string; clientSecret: string }>;
  setPbiConfig(config: Partial<{ tenantId: string; clientId: string; clientSecret: string }>): Promise<void>;
  getAllPbiDatasets(): Promise<{ id: string; name: string; groupId: string; datasetId: string; operacao?: string; gerenciadoPorAutoTarefa?: boolean }[]>;
  createPbiDataset(dataset: { name: string; groupId: string; datasetId: string; operacao?: string }): Promise<{ id: string; name: string; groupId: string; datasetId: string; operacao?: string; gerenciadoPorAutoTarefa?: boolean }>;
  updatePbiDataset(id: string, updates: Partial<{ name: string; groupId: string; datasetId: string; operacao?: string; gerenciadoPorAutoTarefa?: boolean }>): Promise<{ id: string; name: string; groupId: string; datasetId: string; operacao?: string; gerenciadoPorAutoTarefa?: boolean } | undefined>;
  deletePbiDataset(id: string): Promise<boolean>;
  getAllPbiOperacoes(): Promise<{ id: string; name: string }[]>;
  createPbiOperacao(name: string): Promise<{ id: string; name: string }>;
  deletePbiOperacao(id: string): Promise<boolean>;
  // PBI Agendamentos
  getAllPbiAgendamentos(): Promise<PbiAgendamento[]>;
  createPbiAgendamento(a: Omit<PbiAgendamento, 'id'>): Promise<PbiAgendamento>;
  updatePbiAgendamento(id: string, updates: Partial<PbiAgendamento>): Promise<PbiAgendamento | undefined>;
  deletePbiAgendamento(id: string): Promise<boolean>;
  // PBI Refresh Logs
  getAllPbiRefreshLogs(): Promise<PbiRefreshLog[]>;
  addPbiRefreshLog(log: Omit<PbiRefreshLog, 'id'>): Promise<PbiRefreshLog>;
  clearPbiRefreshLogs(): Promise<void>;
  // DB Auto (Automação Banco)
  getAllDbAutoConfigs(): Promise<DbAutoConfig[]>;
  createDbAutoConfig(c: Omit<DbAutoConfig, 'id' | 'criadoEm'>): Promise<DbAutoConfig>;
  updateDbAutoConfig(id: string, updates: Partial<DbAutoConfig>): Promise<DbAutoConfig | undefined>;
  deleteDbAutoConfig(id: string): Promise<boolean>;
  getAllDbAutoMonitors(): Promise<DbAutoMonitor[]>;
  createDbAutoMonitor(m: Omit<DbAutoMonitor, 'id'>): Promise<DbAutoMonitor>;
  updateDbAutoMonitor(id: string, updates: Partial<DbAutoMonitor>): Promise<DbAutoMonitor | undefined>;
  deleteDbAutoMonitor(id: string): Promise<boolean>;
  getAllDbAutoLogs(): Promise<DbAutoLog[]>;
  addDbAutoLog(log: Omit<DbAutoLog, 'id'>): Promise<DbAutoLog>;
  clearDbAutoLogs(): Promise<void>;
  // Auto Tarefas
  getAllAutoTarefas(): Promise<AutoTarefa[]>;
  getAutoTarefaById(id: string): Promise<AutoTarefa | undefined>;
  createAutoTarefa(t: Omit<AutoTarefa, 'id' | 'criadoEm' | 'status' | 'ultimaExecucao' | 'proximaExecucao' | 'ultimoStatus' | 'logs'>): Promise<AutoTarefa>;
  updateAutoTarefa(id: string, updates: Partial<AutoTarefa>): Promise<AutoTarefa | undefined>;
  deleteAutoTarefa(id: string): Promise<boolean>;
  appendAutoTarefaLog(id: string, line: string): Promise<void>;

  // Gestão Meta
  getMetaGlobalToken(): Promise<string>;
  setMetaGlobalToken(token: string): Promise<void>;
  getAllMetaWabas(): Promise<MetaWaba[]>;
  getMetaWabaWithToken(id: string): Promise<MetaWabaWithToken | undefined>;
  createMetaWaba(waba: Omit<MetaWabaWithToken, 'id' | 'lastSync'>): Promise<MetaWaba>;
  updateMetaWabaLastSync(id: string): Promise<void>;
  deleteMetaWaba(id: string): Promise<boolean>;
  getAllMetaOperacoes(): Promise<MetaOperacao[]>;
  createMetaOperacao(nome: string): Promise<MetaOperacao>;
  deleteMetaOperacao(id: string): Promise<boolean>;
  getAllMetaPhoneNumbers(): Promise<MetaPhoneNumber[]>;
  upsertMetaPhoneNumber(phone: Omit<MetaPhoneNumber, 'id'> & { id?: string }): Promise<MetaPhoneNumber>;
  updateMetaPhoneOperacao(id: string, operacaoId: string | undefined): Promise<MetaPhoneNumber | undefined>;
  deleteMetaPhoneNumber(id: string): Promise<boolean>;
  getAllMetaTemplates(): Promise<MetaTemplate[]>;
  upsertMetaTemplate(tpl: Omit<MetaTemplate, 'id'> & { id?: string }): Promise<MetaTemplate>;
  updateMetaTemplateOperacao(id: string, operacaoId: string | undefined): Promise<MetaTemplate | undefined>;
  deleteMetaTemplate(id: string): Promise<boolean>;
  getAllMetaConversationAnalytics(): Promise<MetaConversationAnalytics[]>;
  setMetaConversationAnalytics(wabaId: string, daily7d: number[]): Promise<void>;
  /** Cria ou actualiza o registro de WABA pelo Meta WABA ID (sem token) */
  upsertMetaWabaByMetaId(metaWabaId: string, apelido?: string): Promise<MetaWaba>;
  /** Renomeia um WABA pelo UUID interno */
  updateMetaWabaApelido(id: string, apelido: string): Promise<MetaWaba | undefined>;
}

export interface PbiAgendamento {
  id: string;
  datasetId: string;
  horarios: string[];
  diasSemana: number[];
  tipo: "diario" | "semanal";
  ativo: boolean;
}

export interface PbiRefreshLog {
  id: string;
  datasetId: string;
  datasetName: string;
  horario: string;
  timestamp: string;
  status: "success" | "error";
  errorMessage?: string;
  triggeredBy: "scheduler" | "manual";
}

export interface DbCustomBlock {
  id: string;
  database: string;
  nome: string;
  tables: string[]; // "schema.table" strings
}

export interface DbAutoConfig {
  id: string;
  nome: string;
  database: string;
  schema: string;
  table: string;
  timestampColumn: string;
  limiarMinutos: number;
  exeUrl: string;
  ativo: boolean;
  criadoEm: string;
  ultimoStatus: "ok" | "stale" | "running_fix" | "error" | "unknown";
  ultimaVerificacao?: string;
  ultimaAtualizacaoTabela?: string;
  ultimoErro?: string;
}

export interface DbAutoMonitor {
  id: string;
  configId: string;
  schema: string;
  table: string;
  timestampColumn: string;
  intervaloMinutos: number;
  ativo: boolean;
  ultimoStatus: "ok" | "stale" | "running_fix" | "error" | "unknown";
  ultimaVerificacao?: string;
  ultimaAtualizacaoTabela?: string;
  ultimoErro?: string;
}

export interface DbAutoLog {
  id: string;
  configId: string;
  monitorId?: string;
  tableKey: string;
  timestamp: string;
  tipo: "check_ok" | "check_stale" | "fix_triggered" | "fix_ok" | "fix_error";
  mensagem: string;
  duracao?: number;
}

export interface AutoTarefa {
  id: string;
  nome: string;
  descricao: string;
  ativo: boolean;
  agendamento?: any;
  pularVerificacaoBanco?: boolean;
  verificacaoBanco: Array<{ dbNome?: string; schema: string; tabela: string; coluna: string; toleranciaMinutos: number }>;
  pbiDatasetId?: string;
  automacaoId?: string;
  status: "idle" | "verificando_banco" | "aguardando_pbi" | "executando_automacao" | "concluido" | "erro";
  ultimaExecucao?: number;
  proximaExecucao?: number;
  ultimoStatus: "sucesso" | "erro" | "nunca";
  logs: string[];
  criadoEm: number;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private tasks: Map<string, Task>;
  private taskExceptions: Map<string, Set<string>>; // seriesId -> Set of excluded dates (YYYY-MM-DD)
  private bis: Map<string, Bi>;
  private bases: Map<string, BaseOrigem>;
  private canvasNodes: Map<string, CanvasNode>;
  private canvasEdges: Map<string, CanvasEdge>;
  private automacoes: Map<string, Automacao>;
  private analistas: Map<string, Analista>;
  private solicitantes: Map<string, Solicitante>;
  private ticketResponsibles: Map<number, TicketResponsible>;
  private slaConfig: Map<number, number>;
  private glpiConfig: { apiUrl: string; appToken: string; userToken: string };
  private projetos: Map<string, Projeto>;
  private etapas: Map<string, Etapa>;
  private disparos: Map<string, Disparo>;
  private disparoCanais: Map<string, DisparoCanal>;
  private disparoTemplates: Map<string, DisparoTemplate>;
  private disparoConfig: DisparoConfig;
  private rpaConfig: RpaConfig;
  private rpaDisparos: Map<string, RpaDisparo>;
  private rpaCanais: Map<string, RpaCanal>;
  private rpaTemplates: Map<string, RpaTemplate>;
  private reguaConfig: ReguaConfig;
  private reguaRotinas: Map<string, ReguaRotina>;
  private reguaLogs: Map<string, ReguaLog>;
  private reguaSentPhones: Map<string, Set<string>>; // key="${operacaoId}_${listaId}"
  private roundRobinIndex: number;
  private pythonAgentConfig: PythonAgentConfig;
  private pythonScripts: Map<string, PythonScript>;
  private pythonExecutions: Map<string, PythonExecution>;
  private dbConfig: { host: string; port: number; database: string; username: string; password: string };
  private dbTimestampConfigs: Map<string, Record<string, string>>;
  private pbiConfig: { tenantId: string; clientId: string; clientSecret: string };
  private pbiDatasets: Map<string, { id: string; name: string; groupId: string; datasetId: string; operacao?: string; gerenciadoPorAutoTarefa?: boolean }>;
  private autoTarefas: Map<string, AutoTarefa>;
  private pbiOperacoes: Map<string, { id: string; name: string }>;
  private pbiAgendamentos: Map<string, PbiAgendamento>;
  private pbiRefreshLogs: PbiRefreshLog[];
  private dbAutoConfigs: Map<string, DbAutoConfig>;
  private dbAutoMonitors: Map<string, DbAutoMonitor>;
  private dbAutoLogs: DbAutoLog[];
  private dbCustomBlocks: Map<string, DbCustomBlock[]>; // key = database
  private metaWabas: Map<string, MetaWabaWithToken>;
  private metaOperacoes: Map<string, MetaOperacao>;
  private metaGlobalToken: string;
  private metaPhoneNumbers: Map<string, MetaPhoneNumber>;
  private metaTemplates: Map<string, MetaTemplate>;
  private metaConversationAnalytics: Map<string, MetaConversationAnalytics>; // keyed by wabaId
  private readonly APP_STATE_FILE = "./app-state.json";
  private readonly PBI_PERSIST_FILE = "./pbi-state.json";
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.users = new Map();
    this.tasks = new Map();
    this.taskExceptions = new Map();
    this.bis = new Map();
    this.bases = new Map();
    this.canvasNodes = new Map();
    this.canvasEdges = new Map();
    this.automacoes = new Map();
    this.analistas = new Map();
    this.solicitantes = new Map();
    this.ticketResponsibles = new Map();
    this.slaConfig = new Map();
    this.glpiConfig = { apiUrl: "", appToken: "", userToken: "" };
    this.projetos = new Map();
    this.etapas = new Map();
    this.disparos = new Map();
    this.disparoCanais = new Map();
    this.disparoTemplates = new Map();
    this.disparoConfig = { apiUrl: "", apiToken: "" };
    this.rpaConfig = { url: "", email: "", senha: "" };
    this.rpaDisparos = new Map();
    this.rpaCanais = new Map();
    this.rpaTemplates = new Map();
    this.reguaConfig = { projectId: "", dataset: "", credentialsJson: "", discadorKey: "84vpdL1Pz4HLsVufp9PmwmrrGcWxUrxW", discadorUrl: "https://kroton-crm.ibridge.net.br/api/v2/" };
    this.reguaRotinas = new Map();
    this.reguaLogs = new Map();
    this.reguaSentPhones = new Map();
    this.roundRobinIndex = 0;
    this.pythonAgentConfig = { agentUrl: "", agentKey: "" };
    this.pythonScripts = new Map();
    this.pythonExecutions = new Map();
    this.dbConfig = { host: "", port: 5433, database: "", username: "", password: "" };
    this.dbTimestampConfigs = new Map();
    this.pbiConfig = { tenantId: "", clientId: "", clientSecret: "" };
    this.pbiDatasets = new Map();
    this.pbiOperacoes = new Map();
    this.pbiAgendamentos = new Map();
    this.pbiRefreshLogs = [];
    this.dbAutoConfigs = new Map();
    this.dbAutoMonitors = new Map();
    this.dbAutoLogs = [];
    this.dbCustomBlocks = new Map();
    this.autoTarefas = new Map();
    this.metaGlobalToken = "";
    this.metaWabas = new Map();
    this.metaOperacoes = new Map();
    this.metaPhoneNumbers = new Map();
    this.metaTemplates = new Map();
    this.metaConversationAnalytics = new Map();

    // Initialize default SLA config (may be overwritten by loadAppState)
    Object.entries(DEFAULT_SLA_CONFIG).forEach(([code, horas]) => {
      this.slaConfig.set(Number(code), horas);
    });

    // Load persisted state (this may override the defaults above)
    this.loadAppState();

    // Create default admin only if no analistas were loaded
    if (this.analistas.size === 0) {
      const adminId = "admin-default";
      this.analistas.set(adminId, {
        id: adminId,
        nome: "admin",
        senha: "admin123",
        role: "admin" as const,
        ativo: true,
      });
    }

    // Save on process termination
    process.on("SIGTERM", () => { this.saveAppState(); });
    process.on("SIGINT", () => { this.saveAppState(); });
    process.on("beforeExit", () => { this.saveAppState(); });

    // Auto-save every 60 seconds so configs survive crashes/forced restarts
    setInterval(() => { this.saveAppState(); }, 60_000).unref();
  }

  // User operations
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  // Helper to parse date string as Brazil time (UTC-3) and get day of week
  private parseDateBR(ymd: string): { date: Date; dayOfWeek: number } {
    // Parse as Brazil timezone (UTC-3) to ensure consistent day-of-week calculation
    const [year, month, day] = ymd.split('-').map(Number);
    // Create date at noon Brazil time to avoid DST edge cases
    const date = new Date(Date.UTC(year, month - 1, day, 15, 0, 0)); // 15:00 UTC = 12:00 Brazil
    // Calculate day of week in Brazil time (the date part is what matters)
    const dayOfWeek = new Date(year, month - 1, day).getDay();
    return { date, dayOfWeek };
  }

  // Task operations
  async getAllTasks(ymd: string): Promise<Task[]> {
    const { date: requestedDate, dayOfWeek: requestedDayOfWeek } = this.parseDateBR(ymd);
    
    const result: Task[] = [];
    const allTasks = Array.from(this.tasks.values());
    
    // Track which series have overrides for this date
    const overriddenSeries = new Set<string>();
    
    // First pass: collect exact date matches and track overrides
    for (const task of allTasks) {
      if (task.ymd === ymd) {
        result.push(task);
        // If this is an override of a recurring task, track it
        if (task.seriesId) {
          overriddenSeries.add(task.seriesId);
        }
      }
    }
    
    // Second pass: add recurring tasks (unless overridden or excepted)
    for (const task of allTasks) {
      // Skip if this series has an override for this date
      if (overriddenSeries.has(task.id)) {
        continue;
      }
      
      // Check if this date is in the exception list for this task
      const exceptions = this.taskExceptions.get(task.id);
      if (exceptions && exceptions.has(ymd)) {
        continue;
      }
      
      // Include daily recurring tasks that were created on or before this date
      if (task.recKind === 'daily' && task.ymd !== ymd) {
        const { date: taskDate } = this.parseDateBR(task.ymd);
        if (requestedDate >= taskDate) {
          result.push({ ...task, ymd, id: `${task.id}_${ymd}`, concluida: false });
        }
        continue;
      }
      
      // Include weekly recurring tasks that match the day of week
      if (task.recKind === 'weekly' && task.ymd !== ymd) {
        const { date: taskDate, dayOfWeek: taskDayOfWeek } = this.parseDateBR(task.ymd);
        const targetWeekDay = task.weekDay ?? taskDayOfWeek;
        if (requestedDate >= taskDate && requestedDayOfWeek === targetWeekDay) {
          result.push({ ...task, ymd, id: `${task.id}_${ymd}`, concluida: false });
        }
      }
    }
    
    return result.sort((a, b) => a.inicio.localeCompare(b.inicio));
  }

  // Extract original task ID from virtual ID (format: originalId_YYYY-MM-DD)
  private extractOriginalId(id: string): { originalId: string; virtualDate?: string } {
    const match = id.match(/^(.+)_(\d{4}-\d{2}-\d{2})$/);
    if (match) {
      return { originalId: match[1], virtualDate: match[2] };
    }
    return { originalId: id };
  }

  async getTaskById(id: string): Promise<Task | undefined> {
    // Check for virtual ID first
    const { originalId, virtualDate } = this.extractOriginalId(id);
    const task = this.tasks.get(originalId);
    
    if (task && virtualDate) {
      // Return the task with the virtual date
      return { ...task, id, ymd: virtualDate };
    }
    
    return task;
  }

  async createTask(insertTask: InsertTask): Promise<Task> {
    const id = randomUUID();
    const task: Task = { ...insertTask, id };
    this.tasks.set(id, task);
    this.scheduleSave();
    return task;
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task | undefined> {
    const { originalId, virtualDate } = this.extractOriginalId(id);
    const task = this.tasks.get(originalId);
    if (!task) return undefined;

    if (updates.concluida === true && !task.concluida) {
      updates.completedAt = Date.now();
    } else if (updates.concluida === false) {
      updates.completedAt = undefined;
    }

    // If updating a virtual instance of a recurring task
    if (virtualDate && (task.recKind === 'daily' || task.recKind === 'weekly')) {
      // Create a new non-recurring instance for this specific date
      const newId = randomUUID();
      const newTask: Task = {
        ...task,
        ...updates,
        id: newId,
        ymd: virtualDate,
        recKind: 'once', // This instance is not recurring
        seriesId: task.id, // Keep reference to original series
      };
      this.tasks.set(newId, newTask);
      this.scheduleSave();
      return newTask;
    }

    const updatedTask: Task = { ...task, ...updates };
    this.tasks.set(originalId, updatedTask);
    this.scheduleSave();
    return updatedTask;
  }

  async deleteTask(id: string): Promise<boolean> {
    const { originalId, virtualDate } = this.extractOriginalId(id);
    const task = this.tasks.get(originalId);
    
    if (!task) return false;
    
    // If deleting a virtual instance of a recurring task, add to exceptions
    if (virtualDate && (task.recKind === 'daily' || task.recKind === 'weekly')) {
      // Add this date to the exception list for this task series
      let exceptions = this.taskExceptions.get(originalId);
      if (!exceptions) {
        exceptions = new Set();
        this.taskExceptions.set(originalId, exceptions);
      }
      exceptions.add(virtualDate);
      this.scheduleSave();
      return true;
    }
    
    // Also delete any exceptions for this task
    this.taskExceptions.delete(originalId);
    const ok = this.tasks.delete(originalId);
    this.scheduleSave();
    return ok;
  }

  async deleteTaskSeries(id: string): Promise<boolean> {
    const { originalId } = this.extractOriginalId(id);
    const task = this.tasks.get(originalId);
    
    if (!task) return false;
    
    // Delete the task and all its exceptions
    this.taskExceptions.delete(originalId);
    const ok = this.tasks.delete(originalId);
    this.scheduleSave();
    return ok;
  }

  // BI operations
  async getAllBis(): Promise<BiWithBases[]> {
    const allBis = Array.from(this.bis.values());
    const bisWithBases: BiWithBases[] = [];

    for (const bi of allBis) {
      const bases = await this.getBasesByBiId(bi.id);
      bisWithBases.push({ ...bi, bases });
    }

    return bisWithBases.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getBiById(id: string): Promise<BiWithBases | undefined> {
    const bi = this.bis.get(id);
    if (!bi) return undefined;

    const bases = await this.getBasesByBiId(id);
    return { ...bi, bases };
  }

  async createBi(
    insertBi: InsertBi,
    insertBases: Array<{ nomeFerramenta: string; pastaOrigem: string; temApi: boolean }>
  ): Promise<Bi> {
    const id = randomUUID();
    const bi: Bi = {
      ...insertBi,
      id,
      status: "em_aberto",
      inativo: false,
      createdAt: new Date(),
    };

    this.bis.set(id, bi);

    // Create bases
    for (const insertBase of insertBases) {
      const baseId = randomUUID();
      const base: BaseOrigem = {
        id: baseId,
        biId: id,
        nomeFerramenta: insertBase.nomeFerramenta,
        pastaOrigem: insertBase.pastaOrigem,
        temApi: insertBase.temApi,
        status: "aguardando",
        observacao: null,
      };
      this.bases.set(baseId, base);
    }

    this.scheduleSave();
    return bi;
  }

  async updateBiStatus(id: string, status: string): Promise<Bi | undefined> {
    const bi = this.bis.get(id);
    if (!bi) return undefined;

    const updatedBi: Bi = { ...bi, status };
    this.bis.set(id, updatedBi);
    this.scheduleSave();
    return updatedBi;
  }

  async updateBiInativo(id: string, inativo: boolean): Promise<Bi | undefined> {
    const bi = this.bis.get(id);
    if (!bi) return undefined;

    const updatedBi: Bi = { ...bi, inativo };
    this.bis.set(id, updatedBi);
    this.scheduleSave();
    return updatedBi;
  }

  // Base operations
  async getBasesByBiId(biId: string): Promise<BaseOrigem[]> {
    return Array.from(this.bases.values()).filter(
      (base) => base.biId === biId
    );
  }

  async updateBaseStatus(
    id: string,
    status: string,
    observacao?: string
  ): Promise<BaseOrigem | undefined> {
    const base = this.bases.get(id);
    if (!base) return undefined;

    const updatedBase: BaseOrigem = {
      ...base,
      status,
      observacao: observacao !== undefined ? observacao : base.observacao,
    };
    this.bases.set(id, updatedBase);

    // Check if all bases of this BI are completed
    const allBases = await this.getBasesByBiId(base.biId);
    const allCompleted = allBases.every((b) => b.status === "concluido");

    if (allCompleted) {
      await this.updateBiStatus(base.biId, "concluido");
    }

    this.scheduleSave();
    return updatedBase;
  }

  // Canvas operations
  async getCanvasData(): Promise<{ nodes: CanvasNode[]; edges: CanvasEdge[] }> {
    return {
      nodes: Array.from(this.canvasNodes.values()),
      edges: Array.from(this.canvasEdges.values()),
    };
  }

  async saveCanvasData(
    nodes: InsertCanvasNode[],
    edges: InsertCanvasEdge[]
  ): Promise<void> {
    this.canvasNodes.clear();
    this.canvasEdges.clear();

    for (const node of nodes) {
      const canvasNode: CanvasNode = {
        id: node.id,
        type: node.type || "default",
        positionX: node.positionX,
        positionY: node.positionY,
        data: node.data,
        width: node.width || null,
        height: node.height || null,
      };
      this.canvasNodes.set(node.id, canvasNode);
    }

    for (const edge of edges) {
      const canvasEdge: CanvasEdge = {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type || "smoothstep",
        animated: edge.animated || false,
      };
      this.canvasEdges.set(edge.id, canvasEdge);
    }
    this.scheduleSave();
  }

  // Automacao operations
  async getAllAutomacoes(): Promise<Automacao[]> {
    return Array.from(this.automacoes.values()).sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  async getAutomacaoById(id: string): Promise<Automacao | undefined> {
    return this.automacoes.get(id);
  }

  async createAutomacao(insertAutomacao: InsertAutomacao): Promise<Automacao> {
    const id = randomUUID();
    const automacao: Automacao = {
      id,
      nomeIntegracao: insertAutomacao.nomeIntegracao,
      recorrencia: insertAutomacao.recorrencia,
      dataHora: insertAutomacao.dataHora,
      repetirUmaHora: insertAutomacao.repetirUmaHora ?? false,
      nomeExecutavel: insertAutomacao.nomeExecutavel,
      pastaFimAtualizacao: insertAutomacao.pastaFimAtualizacao,
      createdAt: new Date(),
    };
    this.automacoes.set(id, automacao);
    this.scheduleSave();
    return automacao;
  }

  async deleteAutomacao(id: string): Promise<boolean> {
    const ok = this.automacoes.delete(id);
    this.scheduleSave();
    return ok;
  }

  // Analista operations
  async getAllAnalistas(includeInactive: boolean = false): Promise<Analista[]> {
    const all = Array.from(this.analistas.values());
    return includeInactive ? all : all.filter(a => a.ativo);
  }

  async getAnalistaById(id: string): Promise<Analista | undefined> {
    return this.analistas.get(id);
  }

  async getAnalistaByNome(nome: string): Promise<Analista | undefined> {
    return Array.from(this.analistas.values()).find(
      a => a.nome.toLowerCase() === nome.toLowerCase()
    );
  }

  async validateAnalistaLogin(nome: string, senha: string): Promise<Analista | null> {
    const analista = await this.getAnalistaByNome(nome);
    if (!analista || !analista.ativo) return null;
    if (analista.senha !== senha) return null;
    return analista;
  }

  async createAnalista(insertAnalista: InsertAnalista): Promise<Analista> {
    const id = randomUUID();
    const analista: Analista = {
      id,
      nome: insertAnalista.nome,
      senha: insertAnalista.senha,
      role: insertAnalista.role ?? "analista",
      ativo: insertAnalista.ativo ?? true,
    };
    this.analistas.set(id, analista);
    this.scheduleSave();
    return analista;
  }

  async updateAnalista(id: string, updates: UpdateAnalista): Promise<Analista | undefined> {
    const analista = this.analistas.get(id);
    if (!analista) return undefined;

    const updatedAnalista: Analista = { ...analista, ...updates };
    this.analistas.set(id, updatedAnalista);
    this.scheduleSave();
    return updatedAnalista;
  }

  async deleteAnalista(id: string): Promise<boolean> {
    const ok = this.analistas.delete(id);
    this.scheduleSave();
    return ok;
  }

  // Transfer demandas operations
  async transferDemandas(
    deAnalistaId: string,
    paraAnalistaId: string,
    dataInicio: string,
    dataFim?: string,
    taskId?: string
  ): Promise<number> {
    const deAnalista = await this.getAnalistaById(deAnalistaId);
    const paraAnalista = await this.getAnalistaById(paraAnalistaId);
    
    if (!deAnalista || !paraAnalista) return 0;

    let count = 0;
    const endDate = dataFim || dataInicio;

    if (taskId) {
      const task = this.tasks.get(taskId);
      if (task && task.responsavel === deAnalista.nome) {
        task.responsavel = paraAnalista.nome;
        count = 1;
      }
    } else {
      const tasksArray = Array.from(this.tasks.entries());
      for (const [, task] of tasksArray) {
        if (task.responsavel === deAnalista.nome && task.ymd >= dataInicio && task.ymd <= endDate) {
          task.responsavel = paraAnalista.nome;
          count++;
        }
      }
    }

    if (count > 0) this.scheduleSave();
    return count;
  }

  // Solicitante operations
  async getAllSolicitantes(): Promise<Solicitante[]> {
    return Array.from(this.solicitantes.values());
  }

  async getSolicitanteById(id: string): Promise<Solicitante | undefined> {
    return this.solicitantes.get(id);
  }

  async getSolicitanteByGlpiId(glpiUserId: number): Promise<Solicitante | undefined> {
    return Array.from(this.solicitantes.values()).find(s => s.glpiUserId === glpiUserId);
  }

  async createSolicitante(insertSolicitante: InsertSolicitante): Promise<Solicitante> {
    const id = randomUUID();
    const solicitante: Solicitante = { ...insertSolicitante, id };
    this.solicitantes.set(id, solicitante);
    this.scheduleSave();
    return solicitante;
  }

  async updateSolicitante(id: string, updates: Partial<InsertSolicitante>): Promise<Solicitante | undefined> {
    const solicitante = this.solicitantes.get(id);
    if (!solicitante) return undefined;

    const updated: Solicitante = { ...solicitante, ...updates };
    this.solicitantes.set(id, updated);
    this.scheduleSave();
    return updated;
  }

  async deleteSolicitante(id: string): Promise<boolean> {
    const ok = this.solicitantes.delete(id);
    this.scheduleSave();
    return ok;
  }

  // Ticket Responsible operations
  async getTicketResponsible(ticketId: number): Promise<TicketResponsible | undefined> {
    return this.ticketResponsibles.get(ticketId);
  }

  async setTicketResponsible(ticketId: number, analistaId: string): Promise<TicketResponsible> {
    const responsible: TicketResponsible = {
      ticketId,
      analistaId,
      assignedAt: new Date().toISOString(),
    };
    this.ticketResponsibles.set(ticketId, responsible);
    this.scheduleSave();
    return responsible;
  }

  async getOrAssignTicketResponsible(ticketId: number): Promise<TicketResponsible> {
    // Check if already assigned (but not if unassigned - try to reassign)
    const existing = this.ticketResponsibles.get(ticketId);
    if (existing && existing.analistaId !== "unassigned") {
      return existing;
    }

    // Get active Control Desk or Analista TI for round-robin assignment (prioritize Control Desk)
    let assignableAnalysts = Array.from(this.analistas.values())
      .filter(a => a.role === "control_desk" && a.ativo)
      .sort((a, b) => a.nome.localeCompare(b.nome));

    // If no Control Desk, try Analista TI
    if (assignableAnalysts.length === 0) {
      assignableAnalysts = Array.from(this.analistas.values())
        .filter(a => a.role === "analista_ti" && a.ativo)
        .sort((a, b) => a.nome.localeCompare(b.nome));
    }

    // If still none, return unassigned
    if (assignableAnalysts.length === 0) {
      const responsible: TicketResponsible = {
        ticketId,
        analistaId: "unassigned",
        assignedAt: new Date().toISOString(),
      };
      this.ticketResponsibles.set(ticketId, responsible);
      this.scheduleSave();
      return responsible;
    }

    // Round-robin assignment
    const selectedAnalista = assignableAnalysts[this.roundRobinIndex % assignableAnalysts.length];
    this.roundRobinIndex++;

    const responsible: TicketResponsible = {
      ticketId,
      analistaId: selectedAnalista.id,
      assignedAt: new Date().toISOString(),
    };
    this.ticketResponsibles.set(ticketId, responsible);
    this.scheduleSave();
    return responsible;
  }

  async getAllTicketResponsibles(): Promise<TicketResponsible[]> {
    return Array.from(this.ticketResponsibles.values());
  }
  
  // SLA Configuration operations
  async getSlaConfig(): Promise<SlaConfig[]> {
    return Array.from(this.slaConfig.entries()).map(([prioridadeCode, horasMaximas]) => ({
      prioridadeCode,
      horasMaximas,
    })).sort((a, b) => a.prioridadeCode - b.prioridadeCode);
  }

  async updateSlaConfig(configs: SlaConfig[]): Promise<SlaConfig[]> {
    for (const config of configs) {
      this.slaConfig.set(config.prioridadeCode, config.horasMaximas);
    }
    this.scheduleSave();
    return this.getSlaConfig();
  }

  async getSlaHorasForPrioridade(prioridadeCode: number): Promise<number> {
    return this.slaConfig.get(prioridadeCode) || DEFAULT_SLA_CONFIG[prioridadeCode] || 24;
  }

  // GLPI Configuration operations
  async getGlpiConfig(): Promise<{ apiUrl: string; appToken: string; userToken: string }> {
    return { ...this.glpiConfig };
  }

  async setGlpiConfig(config: { apiUrl: string; appToken: string; userToken: string }): Promise<void> {
    this.glpiConfig = { ...config };
    this.scheduleSave();
  }

  // Projeto operations
  private getEtapasByProjetoId(projetoId: string): Etapa[] {
    return Array.from(this.etapas.values())
      .filter(e => e.projetoId === projetoId)
      .sort((a, b) => a.ordem - b.ordem);
  }

  private recalculateProgresso(projetoId: string): void {
    const etapas = this.getEtapasByProjetoId(projetoId);
    if (etapas.length === 0) {
      const projeto = this.projetos.get(projetoId);
      if (projeto) projeto.progresso = 0;
      return;
    }
    const concluidas = etapas.filter(e => e.status === "concluida").length;
    const progresso = Math.round((concluidas / etapas.length) * 100);
    const projeto = this.projetos.get(projetoId);
    if (projeto) projeto.progresso = progresso;
  }

  async getAllProjetos(): Promise<ProjetoWithEtapas[]> {
    return Array.from(this.projetos.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(p => ({
        ...p,
        etapas: this.getEtapasByProjetoId(p.id),
      }));
  }

  async getProjetoById(id: string): Promise<ProjetoWithEtapas | undefined> {
    const projeto = this.projetos.get(id);
    if (!projeto) return undefined;
    return {
      ...projeto,
      etapas: this.getEtapasByProjetoId(id),
    };
  }

  async createProjeto(insertProjeto: InsertProjeto): Promise<Projeto> {
    const id = randomUUID();
    const projeto: Projeto = {
      ...insertProjeto,
      id,
      progresso: 0,
      createdAt: Date.now(),
    };
    this.projetos.set(id, projeto);
    this.scheduleSave();
    return projeto;
  }

  async updateProjeto(id: string, updates: UpdateProjeto): Promise<Projeto | undefined> {
    const projeto = this.projetos.get(id);
    if (!projeto) return undefined;
    // Auto-fill dataConclusaoReal when status becomes concluido
    if (updates.status === "concluido" && !projeto.dataConclusaoReal && !updates.dataConclusaoReal) {
      updates = { ...updates, dataConclusaoReal: new Date().toISOString().split("T")[0] };
    }
    const updated: Projeto = { ...projeto, ...updates };
    this.projetos.set(id, updated);
    this.scheduleSave();
    return updated;
  }

  async deleteProjeto(id: string): Promise<boolean> {
    const existed = this.projetos.delete(id);
    if (existed) {
      const etapaIds = Array.from(this.etapas.entries())
        .filter(([, e]) => e.projetoId === id)
        .map(([eId]) => eId);
      etapaIds.forEach(eId => this.etapas.delete(eId));
      this.scheduleSave();
    }
    return existed;
  }

  // Etapa operations
  async createEtapa(insertEtapa: InsertEtapa): Promise<Etapa> {
    const id = randomUUID();
    const existingEtapas = this.getEtapasByProjetoId(insertEtapa.projetoId);
    const etapa: Etapa = {
      ...insertEtapa,
      id,
      ordem: insertEtapa.ordem ?? existingEtapas.length,
    };
    this.etapas.set(id, etapa);
    this.recalculateProgresso(insertEtapa.projetoId);
    this.scheduleSave();
    return etapa;
  }

  async updateEtapa(id: string, updates: UpdateEtapa): Promise<Etapa | undefined> {
    const etapa = this.etapas.get(id);
    if (!etapa) return undefined;
    // Auto-fill dataInicioReal when status becomes em_andamento
    if (updates.status === "em_andamento" && !etapa.dataInicioReal && !updates.dataInicioReal) {
      updates = { ...updates, dataInicioReal: new Date().toISOString().split("T")[0] };
    }
    // Auto-fill dataConclusaoReal when status becomes concluida
    if (updates.status === "concluida" && !updates.dataConclusaoReal) {
      updates = { ...updates, dataConclusaoReal: new Date().toISOString().split("T")[0] };
    }
    const updated: Etapa = { ...etapa, ...updates };
    this.etapas.set(id, updated);
    this.recalculateProgresso(etapa.projetoId);
    this.scheduleSave();
    return updated;
  }

  async deleteEtapa(id: string): Promise<boolean> {
    const etapa = this.etapas.get(id);
    if (!etapa) return false;
    const projetoId = etapa.projetoId;
    this.etapas.delete(id);
    this.recalculateProgresso(projetoId);
    this.scheduleSave();
    return true;
  }

  // Disparo operations
  async getAllDisparos(data?: string): Promise<Disparo[]> {
    const all = Array.from(this.disparos.values());
    if (data) {
      return all.filter(d => d.data === data).sort((a, b) => a.horario.localeCompare(b.horario));
    }
    return all.sort((a, b) => {
      const dateCompare = a.data.localeCompare(b.data);
      if (dateCompare !== 0) return dateCompare;
      return a.horario.localeCompare(b.horario);
    });
  }

  async getDisparoById(id: string): Promise<Disparo | undefined> {
    return this.disparos.get(id);
  }

  async createDisparo(insertDisparo: InsertDisparo): Promise<Disparo> {
    const id = randomUUID();
    // Parse CSV to count total records
    let totalRegistros = 0;
    if (insertDisparo.arquivoConteudo) {
      const lines = insertDisparo.arquivoConteudo.split("\n").filter(l => l.trim().length > 0);
      totalRegistros = Math.max(0, lines.length - 1); // subtract header row
    }
    const disparo: Disparo = {
      ...insertDisparo,
      id,
      status: "agendado",
      totalRegistros,
      processados: 0,
      erros: 0,
      logs: [],
      criadoEm: Date.now(),
    };
    this.disparos.set(id, disparo);
    this.scheduleSave();
    return disparo;
  }

  async updateDisparo(id: string, updates: UpdateDisparo): Promise<Disparo | undefined> {
    const disparo = this.disparos.get(id);
    if (!disparo) return undefined;
    const updated: Disparo = { ...disparo, ...updates };
    this.disparos.set(id, updated);
    this.scheduleSave();
    return updated;
  }

  async deleteDisparo(id: string): Promise<boolean> {
    const ok = this.disparos.delete(id);
    this.scheduleSave();
    return ok;
  }

  async getDisparosAgendados(dataHoraAtual: string): Promise<Disparo[]> {
    // dataHoraAtual format: "YYYY-MM-DD HH:MM"
    const [data, horario] = dataHoraAtual.split(" ");
    return Array.from(this.disparos.values()).filter(
      d => d.data === data && d.horario === horario && d.status === "agendado"
    );
  }

  // Disparo Canal
  async getAllDisparoCanais(): Promise<DisparoCanal[]> {
    return Array.from(this.disparoCanais.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }

  async getDisparoCanalById(id: string): Promise<DisparoCanal | undefined> {
    return this.disparoCanais.get(id);
  }

  async createDisparoCanal(canal: InsertDisparoCanal): Promise<DisparoCanal> {
    const id = randomUUID();
    const obj: DisparoCanal = { ...canal, id, criadoEm: Date.now() };
    this.disparoCanais.set(id, obj);
    this.scheduleSave();
    return obj;
  }

  async deleteDisparoCanal(id: string): Promise<boolean> {
    const ok = this.disparoCanais.delete(id);
    this.scheduleSave();
    return ok;
  }

  // Disparo Template
  async getAllDisparoTemplates(canalId?: string): Promise<DisparoTemplate[]> {
    const all = Array.from(this.disparoTemplates.values()).sort((a, b) => a.nome.localeCompare(b.nome));
    if (canalId) return all.filter(t => t.canalId === canalId);
    return all;
  }

  async getDisparoTemplateById(id: string): Promise<DisparoTemplate | undefined> {
    return this.disparoTemplates.get(id);
  }

  async createDisparoTemplate(template: InsertDisparoTemplate): Promise<DisparoTemplate> {
    const id = randomUUID();
    const obj: DisparoTemplate = { ...template, id, criadoEm: Date.now() };
    this.disparoTemplates.set(id, obj);
    this.scheduleSave();
    return obj;
  }

  async deleteDisparoTemplate(id: string): Promise<boolean> {
    const ok = this.disparoTemplates.delete(id);
    this.scheduleSave();
    return ok;
  }

  // Disparo Config
  async getDisparoConfig(): Promise<DisparoConfig> {
    return { ...this.disparoConfig };
  }

  async setDisparoConfig(config: DisparoConfig): Promise<void> {
    if (config.apiUrl !== undefined) this.disparoConfig.apiUrl = config.apiUrl;
    if (config.apiToken !== undefined) this.disparoConfig.apiToken = config.apiToken;
    this.scheduleSave();
  }

  // RPA Config
  async getRpaConfig(): Promise<RpaConfig> {
    return { ...this.rpaConfig };
  }

  async setRpaConfig(config: Partial<RpaConfig>): Promise<void> {
    if (config.url !== undefined) this.rpaConfig.url = config.url;
    if (config.email !== undefined) this.rpaConfig.email = config.email;
    if (config.senha !== undefined) this.rpaConfig.senha = config.senha;
    this.scheduleSave();
  }

  // RPA Disparos
  async getAllRpaDisparos(data?: string): Promise<RpaDisparo[]> {
    const all = Array.from(this.rpaDisparos.values());
    if (data) return all.filter(d => d.data === data);
    return all.sort((a, b) => b.criadoEm - a.criadoEm);
  }

  async getRpaDisparoById(id: string): Promise<RpaDisparo | undefined> {
    return this.rpaDisparos.get(id);
  }

  async createRpaDisparo(disparo: InsertRpaDisparo): Promise<RpaDisparo> {
    const id = randomUUID();
    const obj: RpaDisparo = { ...disparo, id, status: "agendado", logs: [], criadoEm: Date.now() };
    this.rpaDisparos.set(id, obj);
    this.scheduleSave();
    return obj;
  }

  async updateRpaDisparo(id: string, updates: UpdateRpaDisparo): Promise<RpaDisparo | undefined> {
    const existing = this.rpaDisparos.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.rpaDisparos.set(id, updated);
    this.scheduleSave();
    return updated;
  }

  async deleteRpaDisparo(id: string): Promise<boolean> {
    const ok = this.rpaDisparos.delete(id);
    this.scheduleSave();
    return ok;
  }

  async getRpaDisparosAgendados(): Promise<RpaDisparo[]> {
    return Array.from(this.rpaDisparos.values()).filter(d => d.status === "agendado");
  }

  // RPA Canais
  async getAllRpaCanais(): Promise<RpaCanal[]> {
    return Array.from(this.rpaCanais.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }

  async createRpaCanal(canal: InsertRpaCanal): Promise<RpaCanal> {
    const id = randomUUID();
    const obj: RpaCanal = { ...canal, id, criadoEm: Date.now() };
    this.rpaCanais.set(id, obj);
    this.scheduleSave();
    return obj;
  }

  async deleteRpaCanal(id: string): Promise<boolean> {
    // Also delete templates belonging to this canal
    Array.from(this.rpaTemplates.entries()).forEach(([tid, t]) => {
      if (t.canalId === id) this.rpaTemplates.delete(tid);
    });
    const ok = this.rpaCanais.delete(id);
    this.scheduleSave();
    return ok;
  }

  // RPA Templates
  async getAllRpaTemplates(canalId?: string): Promise<RpaTemplate[]> {
    const all = Array.from(this.rpaTemplates.values());
    if (canalId) return all.filter(t => t.canalId === canalId).sort((a, b) => a.nome.localeCompare(b.nome));
    return all.sort((a, b) => a.nome.localeCompare(b.nome));
  }

  async getRpaTemplateById(id: string): Promise<RpaTemplate | undefined> {
    return this.rpaTemplates.get(id);
  }

  async createRpaTemplate(template: InsertRpaTemplate): Promise<RpaTemplate> {
    const id = randomUUID();
    const obj: RpaTemplate = { ...template, id, criadoEm: Date.now() };
    this.rpaTemplates.set(id, obj);
    this.scheduleSave();
    return obj;
  }

  async deleteRpaTemplate(id: string): Promise<boolean> {
    const ok = this.rpaTemplates.delete(id);
    this.scheduleSave();
    return ok;
  }

  // ─── Régua Automática ───────────────────────────────────────

  async getReguaConfig(): Promise<ReguaConfig> {
    return { ...this.reguaConfig };
  }

  async setReguaConfig(config: Partial<ReguaConfig>): Promise<void> {
    if (config.projectId !== undefined) this.reguaConfig.projectId = config.projectId;
    if (config.dataset !== undefined) this.reguaConfig.dataset = config.dataset;
    if (config.credentialsJson !== undefined && config.credentialsJson !== "") this.reguaConfig.credentialsJson = config.credentialsJson;
    if (config.discadorKey !== undefined && config.discadorKey !== "") this.reguaConfig.discadorKey = config.discadorKey;
    if (config.discadorUrl !== undefined && config.discadorUrl !== "") this.reguaConfig.discadorUrl = config.discadorUrl;
    this.scheduleSave();
  }

  async getAllReguaRotinas(): Promise<ReguaRotina[]> {
    return Array.from(this.reguaRotinas.values()).sort((a, b) => b.criadoEm - a.criadoEm);
  }

  async getReguaRotinaById(id: string): Promise<ReguaRotina | undefined> {
    return this.reguaRotinas.get(id);
  }

  async createReguaRotina(rotina: InsertReguaRotina): Promise<ReguaRotina> {
    const id = randomUUID();
    const obj: ReguaRotina = { ...rotina, id, criadoEm: Date.now() };
    this.reguaRotinas.set(id, obj);
    this.scheduleSave();
    return obj;
  }

  async updateReguaRotina(id: string, updates: Partial<ReguaRotina>): Promise<ReguaRotina | undefined> {
    const existing = this.reguaRotinas.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.reguaRotinas.set(id, updated);
    this.scheduleSave();
    return updated;
  }

  async deleteReguaRotina(id: string): Promise<boolean> {
    const ok = this.reguaRotinas.delete(id);
    this.scheduleSave();
    return ok;
  }

  async getActiveReguaRotinas(): Promise<ReguaRotina[]> {
    return Array.from(this.reguaRotinas.values()).filter(r => r.status === "ativo");
  }

  async getAllReguaLogs(rotinaId?: string, limit = 200): Promise<ReguaLog[]> {
    let all = Array.from(this.reguaLogs.values()).sort((a, b) => b.iniciadoEm - a.iniciadoEm);
    if (rotinaId) all = all.filter(l => l.rotinaId === rotinaId);
    return all.slice(0, limit);
  }

  async getReguaLogById(id: string): Promise<ReguaLog | undefined> {
    return this.reguaLogs.get(id);
  }

  async createReguaLog(log: Omit<ReguaLog, "id">): Promise<ReguaLog> {
    const id = randomUUID();
    const obj: ReguaLog = { ...log, id };
    this.reguaLogs.set(id, obj);
    this.scheduleSave();
    return obj;
  }

  async updateReguaLog(id: string, updates: Partial<ReguaLog>): Promise<ReguaLog | undefined> {
    const existing = this.reguaLogs.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.reguaLogs.set(id, updated);
    this.scheduleSave();
    return updated;
  }

  // ─────────────────────────────────────────────────────────────
  // Python Scripts
  // ─────────────────────────────────────────────────────────────

  async getPythonAgentConfig(): Promise<PythonAgentConfig> {
    return { ...this.pythonAgentConfig };
  }

  async setPythonAgentConfig(config: Partial<PythonAgentConfig>): Promise<void> {
    if (config.agentUrl !== undefined) this.pythonAgentConfig.agentUrl = config.agentUrl;
    if (config.agentKey !== undefined && config.agentKey !== "") this.pythonAgentConfig.agentKey = config.agentKey;
    this.scheduleSave();
  }

  async getAllPythonScripts(): Promise<PythonScript[]> {
    return Array.from(this.pythonScripts.values()).sort((a, b) => b.criadoEm - a.criadoEm);
  }

  async getPythonScriptById(id: string): Promise<PythonScript | undefined> {
    return this.pythonScripts.get(id);
  }

  async createPythonScript(script: InsertPythonScript): Promise<PythonScript> {
    const newScript: PythonScript = {
      ...script,
      id: randomUUID(),
      criadoEm: Date.now(),
      ultimoStatus: "nunca",
    };
    this.pythonScripts.set(newScript.id, newScript);
    this.scheduleSave();
    return newScript;
  }

  async updatePythonScript(id: string, updates: Partial<PythonScript>): Promise<PythonScript | undefined> {
    const existing = this.pythonScripts.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.pythonScripts.set(id, updated);
    this.scheduleSave();
    return updated;
  }

  async deletePythonScript(id: string): Promise<boolean> {
    const ok = this.pythonScripts.delete(id);
    this.scheduleSave();
    return ok;
  }

  async getActivePythonScripts(): Promise<PythonScript[]> {
    return Array.from(this.pythonScripts.values()).filter(s => s.ativo);
  }

  async getAllPythonExecutions(scriptId?: string, limit = 200): Promise<PythonExecution[]> {
    let execs = Array.from(this.pythonExecutions.values())
      .sort((a, b) => b.iniciadoEm - a.iniciadoEm);
    if (scriptId) execs = execs.filter(e => e.scriptId === scriptId);
    return execs.slice(0, limit);
  }

  async getPythonExecutionById(id: string): Promise<PythonExecution | undefined> {
    return this.pythonExecutions.get(id);
  }

  async createPythonExecution(exec: Omit<PythonExecution, "id">): Promise<PythonExecution> {
    const newExec: PythonExecution = { ...exec, id: randomUUID() };
    this.pythonExecutions.set(newExec.id, newExec);
    // Keep only last 500 executions
    const all = Array.from(this.pythonExecutions.values()).sort((a, b) => a.iniciadoEm - b.iniciadoEm);
    if (all.length > 500) all.slice(0, all.length - 500).forEach(e => this.pythonExecutions.delete(e.id));
    this.scheduleSave();
    return newExec;
  }

  async updatePythonExecution(id: string, updates: Partial<PythonExecution>): Promise<PythonExecution | undefined> {
    const existing = this.pythonExecutions.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.pythonExecutions.set(id, updated);
    this.scheduleSave();
    return updated;
  }

  async getDbConfig(): Promise<{ host: string; port: number; database: string; username: string; password: string; hasConfig: boolean }> {
    const cfg = { ...this.dbConfig };
    return { ...cfg, hasConfig: !!(cfg.host && cfg.database && cfg.username) };
  }

  async setDbConfig(config: Partial<{ host: string; port: number; database: string; username: string; password: string }>): Promise<void> {
    if (config.host !== undefined) this.dbConfig.host = config.host;
    if (config.port !== undefined) this.dbConfig.port = config.port;
    if (config.database !== undefined) this.dbConfig.database = config.database;
    if (config.username !== undefined) this.dbConfig.username = config.username;
    if (config.password !== undefined && config.password !== "") this.dbConfig.password = config.password;
    this.scheduleSave();
  }

  async getDbTimestampConfig(database: string): Promise<Record<string, string>> {
    return { ...(this.dbTimestampConfigs.get(database) || {}) };
  }

  async setDbTimestampConfig(database: string, key: string, column: string | null): Promise<void> {
    const current = this.dbTimestampConfigs.get(database) || {};
    if (column === null || column === "") {
      delete current[key];
    } else {
      current[key] = column;
    }
    this.dbTimestampConfigs.set(database, current);
    this.scheduleSave();
  }

  async getDbCustomBlocks(database: string): Promise<DbCustomBlock[]> {
    return (this.dbCustomBlocks.get(database) || []).filter(b => b.database === database);
  }

  async saveDbCustomBlock(database: string, block: Omit<DbCustomBlock, "id" | "database"> & { id?: string }): Promise<DbCustomBlock> {
    const list = this.dbCustomBlocks.get(database) || [];
    if (block.id) {
      const idx = list.findIndex(b => b.id === block.id);
      const updated: DbCustomBlock = { id: block.id, database, nome: block.nome, tables: block.tables };
      if (idx >= 0) list[idx] = updated; else list.push(updated);
      this.dbCustomBlocks.set(database, list);
      this.scheduleSave();
      return updated;
    } else {
      const newBlock: DbCustomBlock = { id: crypto.randomUUID(), database, nome: block.nome, tables: block.tables };
      list.push(newBlock);
      this.dbCustomBlocks.set(database, list);
      this.scheduleSave();
      return newBlock;
    }
  }

  async deleteDbCustomBlock(database: string, id: string): Promise<void> {
    const list = (this.dbCustomBlocks.get(database) || []).filter(b => b.id !== id);
    this.dbCustomBlocks.set(database, list);
    this.scheduleSave();
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveAppState();
      this.saveTimer = null;
    }, 500);
  }

  private saveAppState() {
    try {
      const state = {
        tasks: Array.from(this.tasks.values()),
        taskExceptions: Array.from(this.taskExceptions.entries()).map(([k, v]) => [k, Array.from(v)]),
        bis: Array.from(this.bis.values()),
        bases: Array.from(this.bases.values()),
        canvasNodes: Array.from(this.canvasNodes.values()),
        canvasEdges: Array.from(this.canvasEdges.values()),
        automacoes: Array.from(this.automacoes.values()),
        analistas: Array.from(this.analistas.values()),
        solicitantes: Array.from(this.solicitantes.values()),
        ticketResponsibles: Array.from(this.ticketResponsibles.entries()),
        slaConfig: Array.from(this.slaConfig.entries()),
        glpiConfig: this.glpiConfig,
        projetos: Array.from(this.projetos.values()),
        etapas: Array.from(this.etapas.values()),
        disparos: Array.from(this.disparos.values()),
        disparoCanais: Array.from(this.disparoCanais.values()),
        disparoTemplates: Array.from(this.disparoTemplates.values()),
        disparoConfig: this.disparoConfig,
        rpaConfig: this.rpaConfig,
        rpaDisparos: Array.from(this.rpaDisparos.values()),
        rpaCanais: Array.from(this.rpaCanais.values()),
        rpaTemplates: Array.from(this.rpaTemplates.values()),
        reguaConfig: this.reguaConfig,
        reguaRotinas: Array.from(this.reguaRotinas.values()),
        reguaLogs: Array.from(this.reguaLogs.values()),
        pythonAgentConfig: this.pythonAgentConfig,
        pythonScripts: Array.from(this.pythonScripts.values()),
        pythonExecutions: Array.from(this.pythonExecutions.values()),
        dbConfig: this.dbConfig,
        dbTimestampConfigs: Array.from(this.dbTimestampConfigs.entries()),
        pbiConfig: this.pbiConfig,
        pbiDatasets: Array.from(this.pbiDatasets.values()),
        pbiOperacoes: Array.from(this.pbiOperacoes.values()),
        pbiAgendamentos: Array.from(this.pbiAgendamentos.values()),
        pbiRefreshLogs: this.pbiRefreshLogs,
        dbAutoConfigs: Array.from(this.dbAutoConfigs.values()),
        dbAutoMonitors: Array.from(this.dbAutoMonitors.values()),
        dbAutoLogs: this.dbAutoLogs,
        dbCustomBlocks: Array.from(this.dbCustomBlocks.entries()),
        autoTarefas: Array.from(this.autoTarefas.values()),
        metaGlobalToken: this.metaGlobalToken,
        metaWabas: Array.from(this.metaWabas.values()),
        metaOperacoes: Array.from(this.metaOperacoes.values()),
        metaPhoneNumbers: Array.from(this.metaPhoneNumbers.values()),
        metaTemplates: Array.from(this.metaTemplates.values()),
        metaConversationAnalytics: Array.from(this.metaConversationAnalytics.values()),
      };
      fs.writeFileSync(this.APP_STATE_FILE, JSON.stringify(state), "utf-8");
    } catch (err) {
      console.error("[Storage] Failed to save app state:", err);
    }
  }

  private loadAppState() {
    try {
      // Migrate from old pbi-state.json if app-state.json doesn't exist yet
      if (!fs.existsSync(this.APP_STATE_FILE) && fs.existsSync(this.PBI_PERSIST_FILE)) {
        const raw = JSON.parse(fs.readFileSync(this.PBI_PERSIST_FILE, "utf-8"));
        if (raw.config) this.pbiConfig = raw.config;
        if (raw.datasets) for (const ds of raw.datasets) this.pbiDatasets.set(ds.id, ds);
        if (raw.operacoes) for (const op of raw.operacoes) this.pbiOperacoes.set(op.id, op);
        return;
      }
      if (!fs.existsSync(this.APP_STATE_FILE)) return;
      const state = JSON.parse(fs.readFileSync(this.APP_STATE_FILE, "utf-8"));

      if (state.tasks) for (const t of state.tasks) this.tasks.set(t.id, t);
      if (state.taskExceptions) {
        for (const [k, v] of state.taskExceptions) this.taskExceptions.set(k, new Set(v as string[]));
      }
      if (state.bis) for (const b of state.bis) this.bis.set(b.id, { ...b, createdAt: new Date(b.createdAt) });
      if (state.bases) for (const b of state.bases) this.bases.set(b.id, b);
      if (state.canvasNodes) for (const n of state.canvasNodes) this.canvasNodes.set(n.id, n);
      if (state.canvasEdges) for (const e of state.canvasEdges) this.canvasEdges.set(e.id, e);
      if (state.automacoes) for (const a of state.automacoes) this.automacoes.set(a.id, { ...a, createdAt: new Date(a.createdAt) });
      if (state.analistas) for (const a of state.analistas) this.analistas.set(a.id, a);
      if (state.solicitantes) for (const s of state.solicitantes) this.solicitantes.set(s.id, s);
      if (state.ticketResponsibles) for (const [k, v] of state.ticketResponsibles) this.ticketResponsibles.set(Number(k), v);
      if (state.slaConfig) for (const [k, v] of state.slaConfig) this.slaConfig.set(Number(k), v);
      if (state.glpiConfig) this.glpiConfig = state.glpiConfig;
      if (state.projetos) for (const p of state.projetos) this.projetos.set(p.id, p);
      if (state.etapas) for (const e of state.etapas) this.etapas.set(e.id, e);
      if (state.disparos) for (const d of state.disparos) this.disparos.set(d.id, d);
      if (state.disparoCanais) for (const c of state.disparoCanais) this.disparoCanais.set(c.id, c);
      if (state.disparoTemplates) for (const t of state.disparoTemplates) this.disparoTemplates.set(t.id, t);
      if (state.disparoConfig) this.disparoConfig = state.disparoConfig;
      if (state.rpaConfig) this.rpaConfig = state.rpaConfig;
      if (state.rpaDisparos) for (const d of state.rpaDisparos) this.rpaDisparos.set(d.id, d);
      if (state.rpaCanais) for (const c of state.rpaCanais) this.rpaCanais.set(c.id, c);
      if (state.rpaTemplates) for (const t of state.rpaTemplates) this.rpaTemplates.set(t.id, t);
      if (state.reguaConfig) this.reguaConfig = state.reguaConfig;
      if (state.reguaRotinas) for (const r of state.reguaRotinas) this.reguaRotinas.set(r.id, r);
      if (state.reguaLogs) for (const l of state.reguaLogs) this.reguaLogs.set(l.id, l);
      if (state.pythonAgentConfig) this.pythonAgentConfig = state.pythonAgentConfig;
      if (state.pythonScripts) for (const s of state.pythonScripts) this.pythonScripts.set(s.id, s);
      if (state.pythonExecutions) for (const e of state.pythonExecutions) this.pythonExecutions.set(e.id, e);
      if (state.dbConfig) this.dbConfig = state.dbConfig;
      if (state.dbTimestampConfigs) for (const [k, v] of state.dbTimestampConfigs) this.dbTimestampConfigs.set(k, v);
      if (state.pbiConfig) this.pbiConfig = state.pbiConfig;
      if (state.pbiDatasets) for (const ds of state.pbiDatasets) this.pbiDatasets.set(ds.id, ds);
      if (state.pbiOperacoes) for (const op of state.pbiOperacoes) this.pbiOperacoes.set(op.id, op);
      if (state.pbiAgendamentos) for (const a of state.pbiAgendamentos) this.pbiAgendamentos.set(a.id, a);
      if (state.pbiRefreshLogs) this.pbiRefreshLogs = state.pbiRefreshLogs;
      if (state.dbAutoConfigs) for (const c of state.dbAutoConfigs) this.dbAutoConfigs.set(c.id, c);
      if (state.dbAutoMonitors) for (const m of state.dbAutoMonitors) this.dbAutoMonitors.set(m.id, m);
      if (state.dbCustomBlocks) for (const [k, v] of state.dbCustomBlocks) this.dbCustomBlocks.set(k, v);
      if (state.dbAutoLogs) this.dbAutoLogs = state.dbAutoLogs;
      if (state.autoTarefas) for (const t of state.autoTarefas) this.autoTarefas.set(t.id, t);
      if (state.metaGlobalToken) this.metaGlobalToken = state.metaGlobalToken;
      if (state.metaWabas) for (const w of state.metaWabas) this.metaWabas.set(w.id, w);
      if (state.metaOperacoes) for (const o of state.metaOperacoes) this.metaOperacoes.set(o.id, o);
      if (state.metaPhoneNumbers) for (const p of state.metaPhoneNumbers) this.metaPhoneNumbers.set(p.id, p);
      if (state.metaTemplates) for (const t of state.metaTemplates) this.metaTemplates.set(t.id, t);
      if (state.metaConversationAnalytics) for (const c of state.metaConversationAnalytics) this.metaConversationAnalytics.set(c.wabaId, c);
    } catch (err) {
      console.error("[Storage] Failed to load app state:", err);
    }
  }

  async getPbiConfig() { return { ...this.pbiConfig }; }
  async setPbiConfig(config: Partial<{ tenantId: string; clientId: string; clientSecret: string }>) {
    if (config.tenantId !== undefined) this.pbiConfig.tenantId = config.tenantId;
    if (config.clientId !== undefined) this.pbiConfig.clientId = config.clientId;
    if (config.clientSecret !== undefined && config.clientSecret !== "") this.pbiConfig.clientSecret = config.clientSecret;
    this.scheduleSave();
  }
  async getAllPbiDatasets() { return Array.from(this.pbiDatasets.values()); }
  async createPbiDataset(dataset: { name: string; groupId: string; datasetId: string }) {
    const newDs = { ...dataset, id: randomUUID() };
    this.pbiDatasets.set(newDs.id, newDs);
    this.scheduleSave();
    return newDs;
  }
  async updatePbiDataset(id: string, updates: Partial<{ name: string; groupId: string; datasetId: string }>) {
    const existing = this.pbiDatasets.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.pbiDatasets.set(id, updated);
    this.scheduleSave();
    return updated;
  }
  async deletePbiDataset(id: string) {
    const ok = this.pbiDatasets.delete(id);
    this.scheduleSave();
    return ok;
  }
  async getAllPbiOperacoes() { return Array.from(this.pbiOperacoes.values()); }
  async createPbiOperacao(name: string) {
    const op = { id: randomUUID(), name };
    this.pbiOperacoes.set(op.id, op);
    this.scheduleSave();
    return op;
  }
  async deletePbiOperacao(id: string) {
    const ok = this.pbiOperacoes.delete(id);
    this.scheduleSave();
    return ok;
  }

  async getAllPbiAgendamentos() { return Array.from(this.pbiAgendamentos.values()); }
  async createPbiAgendamento(a: Omit<PbiAgendamento, 'id'>) {
    const item: PbiAgendamento = { ...a, id: randomUUID() };
    this.pbiAgendamentos.set(item.id, item);
    this.scheduleSave();
    return item;
  }
  async updatePbiAgendamento(id: string, updates: Partial<PbiAgendamento>) {
    const existing = this.pbiAgendamentos.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.pbiAgendamentos.set(id, updated);
    this.scheduleSave();
    return updated;
  }
  async deletePbiAgendamento(id: string) {
    const ok = this.pbiAgendamentos.delete(id);
    this.scheduleSave();
    return ok;
  }
  async getAllPbiRefreshLogs() { return [...this.pbiRefreshLogs]; }
  async addPbiRefreshLog(log: Omit<PbiRefreshLog, 'id'>) {
    const item: PbiRefreshLog = { ...log, id: randomUUID() };
    this.pbiRefreshLogs.unshift(item);
    if (this.pbiRefreshLogs.length > 500) this.pbiRefreshLogs = this.pbiRefreshLogs.slice(0, 500);
    this.scheduleSave();
    return item;
  }
  async clearPbiRefreshLogs() {
    this.pbiRefreshLogs = [];
    this.scheduleSave();
  }

  // DB Auto (Automação Banco)
  async getAllDbAutoConfigs() { return Array.from(this.dbAutoConfigs.values()); }
  async createDbAutoConfig(c: Omit<DbAutoConfig, 'id' | 'criadoEm'>) {
    const item: DbAutoConfig = { ...c, id: randomUUID(), criadoEm: new Date().toISOString() };
    this.dbAutoConfigs.set(item.id, item);
    this.scheduleSave();
    return item;
  }
  async updateDbAutoConfig(id: string, updates: Partial<DbAutoConfig>) {
    const existing = this.dbAutoConfigs.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.dbAutoConfigs.set(id, updated);
    this.scheduleSave();
    return updated;
  }
  async deleteDbAutoConfig(id: string) {
    const ok = this.dbAutoConfigs.delete(id);
    // Delete associated monitors
    for (const [mid, m] of this.dbAutoMonitors) {
      if (m.configId === id) this.dbAutoMonitors.delete(mid);
    }
    this.scheduleSave();
    return ok;
  }
  async getAllDbAutoMonitors() { return Array.from(this.dbAutoMonitors.values()); }
  async createDbAutoMonitor(m: Omit<DbAutoMonitor, 'id'>) {
    const item: DbAutoMonitor = { ...m, id: randomUUID() };
    this.dbAutoMonitors.set(item.id, item);
    this.scheduleSave();
    return item;
  }
  async updateDbAutoMonitor(id: string, updates: Partial<DbAutoMonitor>) {
    const existing = this.dbAutoMonitors.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.dbAutoMonitors.set(id, updated);
    this.scheduleSave();
    return updated;
  }
  async deleteDbAutoMonitor(id: string) {
    const ok = this.dbAutoMonitors.delete(id);
    this.scheduleSave();
    return ok;
  }
  async getAllDbAutoLogs() { return [...this.dbAutoLogs]; }
  async addDbAutoLog(log: Omit<DbAutoLog, 'id'>) {
    const item: DbAutoLog = { ...log, id: randomUUID() };
    this.dbAutoLogs.unshift(item);
    if (this.dbAutoLogs.length > 1000) this.dbAutoLogs = this.dbAutoLogs.slice(0, 1000);
    this.scheduleSave();
    return item;
  }
  async clearDbAutoLogs() {
    this.dbAutoLogs = [];
    this.scheduleSave();
  }

  isPhoneDuplicate(operacaoId: number, listaId: number, phone: string): boolean {
    const key = `${operacaoId}_${listaId}`;
    return this.reguaSentPhones.get(key)?.has(phone) ?? false;
  }

  registerSentPhone(operacaoId: number, listaId: number, phone: string): void {
    const key = `${operacaoId}_${listaId}`;
    if (!this.reguaSentPhones.has(key)) this.reguaSentPhones.set(key, new Set());
    this.reguaSentPhones.get(key)!.add(phone);
  }

  getRegisteredPhonesCount(operacaoId: number, listaId: number): number {
    const key = `${operacaoId}_${listaId}`;
    return this.reguaSentPhones.get(key)?.size ?? 0;
  }

  // ─── Auto Tarefas ───────────────────────────────────────────────
  async getAllAutoTarefas() { return Array.from(this.autoTarefas.values()); }
  async getAutoTarefaById(id: string) { return this.autoTarefas.get(id); }
  async createAutoTarefa(t: Omit<AutoTarefa, 'id' | 'criadoEm' | 'status' | 'ultimaExecucao' | 'proximaExecucao' | 'ultimoStatus' | 'logs'>) {
    const item: AutoTarefa = { ...t, id: randomUUID(), criadoEm: Date.now(), status: "idle", ultimoStatus: "nunca", logs: [] };
    this.autoTarefas.set(item.id, item);
    this.scheduleSave();
    return item;
  }
  async updateAutoTarefa(id: string, updates: Partial<AutoTarefa>) {
    const existing = this.autoTarefas.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.autoTarefas.set(id, updated);
    this.scheduleSave();
    return updated;
  }
  async deleteAutoTarefa(id: string) {
    const ok = this.autoTarefas.delete(id);
    this.scheduleSave();
    return ok;
  }
  async appendAutoTarefaLog(id: string, line: string) {
    const existing = this.autoTarefas.get(id);
    if (!existing) return;
    const logs = [...(existing.logs ?? []), line].slice(-200);
    this.autoTarefas.set(id, { ...existing, logs });
    this.scheduleSave();
  }

  // ─── Gestão Meta ────────────────────────────────────────────────────────────
  async getAllMetaWabas(): Promise<MetaWaba[]> {
    return Array.from(this.metaWabas.values()).map(({ token: _t, ...w }) => w);
  }
  async getMetaWabaWithToken(id: string): Promise<MetaWabaWithToken | undefined> {
    return this.metaWabas.get(id);
  }
  async createMetaWaba(waba: Omit<MetaWabaWithToken, 'id' | 'lastSync'>): Promise<MetaWaba> {
    const item: MetaWabaWithToken = { ...waba, id: randomUUID() };
    this.metaWabas.set(item.id, item);
    this.scheduleSave();
    const { token: _t, ...pub } = item;
    return pub;
  }
  async updateMetaWabaLastSync(id: string): Promise<void> {
    const w = this.metaWabas.get(id);
    if (w) { this.metaWabas.set(id, { ...w, lastSync: new Date().toISOString() }); this.scheduleSave(); }
  }
  async deleteMetaWaba(id: string): Promise<boolean> {
    const ok = this.metaWabas.delete(id);
    // orphan related phones/templates (keep them, just lose the wabaId link)
    this.scheduleSave();
    return ok;
  }
  async getAllMetaOperacoes(): Promise<MetaOperacao[]> {
    return Array.from(this.metaOperacoes.values());
  }
  async createMetaOperacao(nome: string): Promise<MetaOperacao> {
    const item: MetaOperacao = { id: randomUUID(), nome };
    this.metaOperacoes.set(item.id, item);
    this.scheduleSave();
    return item;
  }
  async deleteMetaOperacao(id: string): Promise<boolean> {
    const ok = this.metaOperacoes.delete(id);
    // un-assign phones and templates that used this operacao
    for (const [pid, p] of this.metaPhoneNumbers) {
      if (p.operacaoId === id) this.metaPhoneNumbers.set(pid, { ...p, operacaoId: undefined });
    }
    for (const [tid, t] of this.metaTemplates) {
      if (t.operacaoId === id) this.metaTemplates.set(tid, { ...t, operacaoId: undefined });
    }
    this.scheduleSave();
    return ok;
  }
  async getMetaGlobalToken(): Promise<string> {
    return this.metaGlobalToken;
  }
  async setMetaGlobalToken(token: string): Promise<void> {
    this.metaGlobalToken = token;
    this.scheduleSave();
  }
  async getAllMetaPhoneNumbers(): Promise<MetaPhoneNumber[]> {
    return Array.from(this.metaPhoneNumbers.values());
  }
  async upsertMetaPhoneNumber(phone: Omit<MetaPhoneNumber, 'id'> & { id?: string }): Promise<MetaPhoneNumber> {
    const existing = Array.from(this.metaPhoneNumbers.values()).find(
      p => p.phoneId === phone.phoneId
    );
    const item: MetaPhoneNumber = {
      ...phone,
      id: existing?.id ?? phone.id ?? randomUUID(),
      operacaoId: phone.operacaoId ?? existing?.operacaoId,
      canalId: phone.canalId ?? existing?.canalId,
    };
    this.metaPhoneNumbers.set(item.id, item);
    this.scheduleSave();
    return item;
  }
  async updateMetaPhoneOperacao(id: string, operacaoId: string | undefined): Promise<MetaPhoneNumber | undefined> {
    const existing = this.metaPhoneNumbers.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, operacaoId };
    this.metaPhoneNumbers.set(id, updated);
    this.scheduleSave();
    return updated;
  }
  async updateMetaPhoneCanal(id: string, canalId: string | undefined): Promise<MetaPhoneNumber | undefined> {
    const existing = this.metaPhoneNumbers.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, canalId };
    this.metaPhoneNumbers.set(id, updated);
    this.scheduleSave();
    return updated;
  }
  async deleteMetaPhoneNumber(id: string): Promise<boolean> {
    const ok = this.metaPhoneNumbers.delete(id);
    this.scheduleSave();
    return ok;
  }
  async getAllMetaTemplates(): Promise<MetaTemplate[]> {
    return Array.from(this.metaTemplates.values());
  }
  async getMetaTemplateById(id: string): Promise<MetaTemplate | undefined> {
    return this.metaTemplates.get(id);
  }
  async upsertMetaTemplate(tpl: Omit<MetaTemplate, 'id'> & { id?: string }): Promise<MetaTemplate> {
    const existing = Array.from(this.metaTemplates.values()).find(
      t => t.templateId === tpl.templateId && t.wabaId === tpl.wabaId
    );
    const item: MetaTemplate = {
      ...tpl,
      id: existing?.id ?? tpl.id ?? randomUUID(),
      operacaoId: existing?.operacaoId ?? tpl.operacaoId,
      bodyText: tpl.bodyText ?? existing?.bodyText, // preserve existing body if sync didn't return it
    };
    this.metaTemplates.set(item.id, item);
    this.scheduleSave();
    return item;
  }
  async updateMetaTemplateOperacao(id: string, operacaoId: string | undefined): Promise<MetaTemplate | undefined> {
    const existing = this.metaTemplates.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, operacaoId };
    this.metaTemplates.set(id, updated);
    this.scheduleSave();
    return updated;
  }
  async deleteMetaTemplate(id: string): Promise<boolean> {
    const ok = this.metaTemplates.delete(id);
    this.scheduleSave();
    return ok;
  }

  async getAllMetaConversationAnalytics(): Promise<MetaConversationAnalytics[]> {
    return Array.from(this.metaConversationAnalytics.values());
  }

  async setMetaConversationAnalytics(wabaId: string, daily7d: number[]): Promise<void> {
    this.metaConversationAnalytics.set(wabaId, { wabaId, daily7d, updatedAt: new Date().toISOString() });
    this.scheduleSave();
  }

  async upsertMetaWabaByMetaId(metaWabaId: string, apelido?: string): Promise<MetaWaba> {
    const existing = Array.from(this.metaWabas.values()).find(w => w.wabaId === metaWabaId);
    if (existing) {
      if (apelido !== undefined && apelido !== existing.apelido) {
        const updated = { ...existing, apelido };
        this.metaWabas.set(existing.id, updated);
        this.scheduleSave();
        const { token: _t, ...pub } = updated;
        return pub;
      }
      const { token: _t, ...pub } = existing;
      return pub;
    }
    const item: MetaWabaWithToken = {
      id: randomUUID(),
      wabaId: metaWabaId,
      apelido: apelido || metaWabaId,
      token: "",
    };
    this.metaWabas.set(item.id, item);
    this.scheduleSave();
    const { token: _t, ...pub } = item;
    return pub;
  }

  async updateMetaWabaApelido(id: string, apelido: string): Promise<MetaWaba | undefined> {
    const existing = this.metaWabas.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, apelido };
    this.metaWabas.set(id, updated);
    this.scheduleSave();
    const { token: _t, ...pub } = updated;
    return pub;
  }
}


export const storage = new MemStorage();

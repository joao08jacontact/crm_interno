import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ===========================
// Analistas (Login e Hierarquia)
// ===========================
export type AnalistaRole = "admin" | "control_desk" | "analista_ti";

export const ANALISTA_ROLES = {
  admin: "Admin",
  control_desk: "Control Desk",
  analista_ti: "Analista de TI",
} as const;

export const analistaSchema = z.object({
  id: z.string(),
  nome: z.string().min(1, "Nome é obrigatório"),
  senha: z.string().min(4, "Senha deve ter pelo menos 4 caracteres"),
  role: z.enum(["admin", "control_desk", "analista_ti"]).default("analista_ti"),
  ativo: z.boolean().default(true),
});

export type Analista = z.infer<typeof analistaSchema>;

export const insertAnalistaSchema = analistaSchema.omit({ id: true });
export type InsertAnalista = z.infer<typeof insertAnalistaSchema>;

export const updateAnalistaSchema = analistaSchema.partial().omit({ id: true });
export type UpdateAnalista = z.infer<typeof updateAnalistaSchema>;

export const loginAnalistaSchema = z.object({
  nome: z.string().min(1),
  senha: z.string().min(1),
});

// Esquema para transferência de demandas
export const transferDemandaSchema = z.object({
  deAnalistaId: z.string(),
  paraAnalistaId: z.string(),
  dataInicio: z.string(), // YYYY-MM-DD
  dataFim: z.string().optional(), // YYYY-MM-DD, se não informado usa apenas dataInicio
  taskId: z.string().optional(), // se informado, transfere apenas essa demanda
});

// ===========================
// User Schema (Optional for future auth)
// ===========================
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ===========================
// Esteira de Demandas Types
// ===========================
export type RecKind = "once" | "daily" | "weekly";

export const taskSchema = z.object({
  id: z.string(),
  titulo: z.string().min(1, "Título é obrigatório"),
  inicio: z.string(), // HH:MM
  fim: z.string(), // HH:MM
  concluida: z.boolean(),
  completedAt: z.number().optional(), // timestamp when task was completed
  responsavel: z.string(),
  operacao: z.string(),
  ymd: z.string(), // YYYY-MM-DD
  seriesId: z.string().optional(),
  recKind: z.enum(["once", "daily", "weekly"]).optional(),
  weekDay: z.number().min(0).max(6).optional(), // 0=Sunday, 1=Monday, etc. (for weekly recurrence)
  createdAt: z.number(),
});

export type Task = z.infer<typeof taskSchema>;

export const insertTaskSchema = taskSchema.omit({ id: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;

// Dias da semana em português
export const DIAS_SEMANA = [
  "Domingo",
  "Segunda-feira", 
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;

// Constantes para Esteira de Demandas
export const RESPONSAVEIS = ["Bárbara Arruda", "Gabriel Bion", "Luciano Miranda"];

export const OPERACOES = [
  "FMU",
  "INSPIRALI",
  "COGNA",
  "SINGULARIDADES",
  "PÓS COGNA",
  "UFEM",
  "TELECOM",
  "FGTS",
  "DIROMA",
  "ESTÁCIO",
];

// ===========================
// Solicitantes (Cadastro de IDs do GLPI)
// ===========================

export const solicitanteSchema = z.object({
  id: z.string(),
  nome: z.string().min(1, "Nome é obrigatório"),
  operacao: z.string().min(1, "Operação é obrigatória"),
  glpiUserId: z.number().min(1, "ID do GLPI é obrigatório"),
});

export type Solicitante = z.infer<typeof solicitanteSchema>;

export const insertSolicitanteSchema = solicitanteSchema.omit({ id: true });
export type InsertSolicitante = z.infer<typeof insertSolicitanteSchema>;

// ===========================
// Dashboard GLPI Types (Real API)
// ===========================

export const glpiTicketSchema = z.object({
  id: z.number(),
  titulo: z.string(),
  descricao: z.string(),
  status: z.string(),
  statusCode: z.number(),
  prioridade: z.string(),
  prioridadeCode: z.number(),
  categoria: z.string(),
  categoriaId: z.number(),
  dataCriacao: z.string(),
  dataModificacao: z.string(),
  dataFechamento: z.string().nullable(),
  tipo: z.string(),
  operacao: z.string().nullable(),
  solicitanteId: z.number(),
});

export type GlpiTicket = z.infer<typeof glpiTicketSchema>;

export const ticketStatsSchema = z.object({
  total: z.number(),
  novos: z.number(),
  emProcessamento: z.number(),
  pendentes: z.number(),
  resolvidos: z.number(),
  fechados: z.number(),
});

export type TicketStats = z.infer<typeof ticketStatsSchema>;

// GLPI Status mapping
export const GLPI_STATUS: Record<number, string> = {
  1: "Novo",
  2: "Em Processamento",
  3: "Pendente",
  4: "Resolvido",
  5: "Fechado",
  6: "Cancelado",
};

// GLPI Priority mapping (6 níveis conforme API GLPI)
export const GLPI_PRIORITY: Record<number, string> = {
  1: "Muito Baixa",
  2: "Baixa",
  3: "Média",
  4: "Alta",
  5: "Muito Alta",
  6: "Crítica",
};

// GLPI Type mapping
export const GLPI_TYPE: Record<number, string> = {
  1: "Incidente",
  2: "Requisição",
};

// Status colors for badges
export const STATUS_COLORS: Record<number, string> = {
  1: "bg-blue-500",
  2: "bg-yellow-500",
  3: "bg-orange-500",
  4: "bg-green-500",
  5: "bg-gray-500",
  6: "bg-red-500",
};

// Priority colors (4 níveis)
export const PRIORITY_COLORS: Record<number, string> = {
  1: "bg-blue-400",    // Baixa
  2: "bg-yellow-500",  // Média
  3: "bg-orange-500",  // Alta
  4: "bg-red-600",     // Crítica
};

// ===========================
// BI Cadastro Module
// ===========================

export const bis = pgTable("bis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  nome: text("nome").notNull(),
  dataInicio: text("data_inicio").notNull(),
  dataFinal: text("data_final").notNull(),
  responsavel: text("responsavel").notNull(),
  operacao: text("operacao").notNull(),
  status: text("status").notNull().default("em_aberto"),
  inativo: boolean("inativo").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const basesOrigem = pgTable("bases_origem", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  biId: varchar("bi_id").notNull(),
  nomeFerramenta: text("nome_ferramenta").notNull(),
  pastaOrigem: text("pasta_origem").notNull(),
  temApi: boolean("tem_api").notNull().default(false),
  status: text("status").notNull().default("aguardando"),
  observacao: text("observacao"),
});

export const canvasNodes = pgTable("canvas_nodes", {
  id: varchar("id").primaryKey(),
  type: text("type").notNull().default("default"),
  positionX: text("position_x").notNull(),
  positionY: text("position_y").notNull(),
  data: text("data").notNull(),
  width: text("width"),
  height: text("height"),
});

export const canvasEdges = pgTable("canvas_edges", {
  id: varchar("id").primaryKey(),
  source: text("source").notNull(),
  target: text("target").notNull(),
  type: text("type").notNull().default("smoothstep"),
  animated: boolean("animated").notNull().default(false),
});

export const insertBiSchema = createInsertSchema(bis).omit({
  id: true,
  status: true,
  inativo: true,
  createdAt: true,
});

export const insertBaseOrigemSchema = createInsertSchema(basesOrigem).omit({
  id: true,
});

export const insertCanvasNodeSchema = createInsertSchema(canvasNodes);
export const insertCanvasEdgeSchema = createInsertSchema(canvasEdges);

export const updateBaseOrigemStatusSchema = z.object({
  status: z.enum(["aguardando", "em_andamento", "pendente", "concluido"]),
  observacao: z.string().optional(),
});

export const updateBiInativoSchema = z.object({
  inativo: z.boolean(),
});

export type InsertBi = z.infer<typeof insertBiSchema>;
export type Bi = typeof bis.$inferSelect;

export type InsertBaseOrigem = z.infer<typeof insertBaseOrigemSchema>;
export type BaseOrigem = typeof basesOrigem.$inferSelect;

export type InsertCanvasNode = z.infer<typeof insertCanvasNodeSchema>;
export type CanvasNode = typeof canvasNodes.$inferSelect;

export type InsertCanvasEdge = z.infer<typeof insertCanvasEdgeSchema>;
export type CanvasEdge = typeof canvasEdges.$inferSelect;

export type BiWithBases = Bi & {
  bases: BaseOrigem[];
};

// BI Status mapping
export const BI_STATUS: Record<string, string> = {
  em_aberto: "Em Aberto",
  concluido: "Concluído",
};

export const BASE_STATUS: Record<string, string> = {
  aguardando: "Aguardando",
  em_andamento: "Em Andamento",
  pendente: "Pendente",
  concluido: "Concluído",
};

export const BASE_STATUS_COLORS: Record<string, string> = {
  aguardando: "bg-gray-500",
  em_andamento: "bg-blue-500",
  pendente: "bg-orange-500",
  concluido: "bg-green-500",
};

// ===========================
// Automação Module
// ===========================

export const RECORRENCIAS = [
  "Uma vez",
  "Diário",
  "Semanal",
  "Mensalmente",
] as const;

export const automacoes = pgTable("automacoes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  nomeIntegracao: text("nome_integracao").notNull(),
  recorrencia: text("recorrencia").notNull(),
  dataHora: text("data_hora").notNull(),
  repetirUmaHora: boolean("repetir_uma_hora").notNull().default(false),
  nomeExecutavel: text("nome_executavel").notNull(),
  pastaFimAtualizacao: text("pasta_fim_atualizacao").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAutomacaoSchema = createInsertSchema(automacoes).omit({
  id: true,
  createdAt: true,
});

export type InsertAutomacao = z.infer<typeof insertAutomacaoSchema>;
export type Automacao = typeof automacoes.$inferSelect;

// ===========================
// Ticket Responsible Assignment (Local)
// ===========================
export const ticketResponsibleSchema = z.object({
  ticketId: z.number(),
  analistaId: z.string(),
  assignedAt: z.string(),
});

export type TicketResponsible = z.infer<typeof ticketResponsibleSchema>;

// ===========================
// SLA Configuration
// ===========================
export const slaConfigSchema = z.object({
  prioridadeCode: z.number().min(1).max(6),
  horasMaximas: z.number().min(1),
});

export type SlaConfig = z.infer<typeof slaConfigSchema>;

export const slaConfigUpdateSchema = z.array(slaConfigSchema);

// Default SLA values (in hours) - 6 níveis conforme API GLPI
export const DEFAULT_SLA_CONFIG: Record<number, number> = {
  1: 168, // Muito Baixa - 7 dias (168 horas)
  2: 120, // Baixa - 5 dias (120 horas)
  3: 48,  // Média - 2 dias (48 horas)
  4: 12,  // Alta - 12 horas
  5: 4,   // Muito Alta - 4 horas
  6: 2,   // Crítica - 2 horas (imediato)
};

// ===========================
// Gestão Meta Module
// ===========================

export type MetaQualityRating = "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
export type MetaPhoneStatus = "CONNECTED" | "FLAGGED" | "RESTRICTED";
export type MetaTemplateStatus = "APPROVED" | "REJECTED" | "PENDING" | "PAUSED" | "DISABLED";
export type MetaTemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export interface MetaWaba {
  id: string;           // internal UUID
  wabaId: string;       // Meta WABA ID
  apelido: string;
  lastSync?: string;    // ISO datetime
}

export interface MetaWabaWithToken extends MetaWaba {
  token: string;        // never sent to frontend
}

export interface MetaOperacao {
  id: string;
  nome: string;
}

export interface MetaPhoneNumber {
  id: string;           // internal UUID
  phoneId: string;      // Meta's phone_number ID
  displayPhoneNumber: string;
  verifiedName: string;
  qualityRating: MetaQualityRating;
  messagingLimitTier: string;
  status: MetaPhoneStatus;
  wabaId?: string;      // Meta WABA ID (for reference)
  operacaoId?: string;  // internal MetaOperacao.id
  canalId?: string;     // linked DisparoCanal.id
}

export interface MetaTemplate {
  id: string;           // internal UUID
  templateId: string;   // Meta's template ID
  name: string;
  status: MetaTemplateStatus;
  category: MetaTemplateCategory;
  language: string;
  qualityScore: MetaQualityRating;
  wabaId: string;       // internal MetaWaba.id
  operacaoId?: string;  // internal MetaOperacao.id
  bodyText?: string;    // BODY component text (may contain {{N}} placeholders)
  disparo7d?: number;
  /** 7 valores: índice 0 = 6 dias atrás, índice 6 = hoje */
  disparo7dHistory?: number[];
}

// ── Tier de mensagens (messaging_limit_tier) ─────────────────────────────
export const TIER_ORDER = ["TIER_250", "TIER_2K", "TIER_10K", "TIER_100K", "UNLIMITED"] as const;
export type MetaTier = typeof TIER_ORDER[number];

export const TIER_LIMITS: Record<string, number> = {
  TIER_250:   250,
  TIER_2K:    2000,
  TIER_10K:   10000,
  TIER_100K:  100000,
  UNLIMITED:  Infinity,
};

export const TIER_LABELS: Record<string, string> = {
  TIER_250:   "250",
  TIER_2K:    "2.000",
  TIER_10K:   "10.000",
  TIER_100K:  "100.000",
  UNLIMITED:  "Ilimitado",
};

export interface MetaConversationAnalytics {
  wabaId: string;       // Meta WABA ID
  daily7d: number[];    // 7 valores: índice 0 = 6 dias atrás, índice 6 = hoje
  updatedAt: string;    // ISO datetime
}

export const META_QUALITY_COLORS: Record<MetaQualityRating, string> = {
  GREEN:   "#34D399",
  YELLOW:  "#FBBF24",
  RED:     "#F87171",
  UNKNOWN: "#64748B",
};

export const META_QUALITY_LABELS: Record<MetaQualityRating, string> = {
  GREEN:   "Alta",
  YELLOW:  "Média",
  RED:     "Baixa",
  UNKNOWN: "Desconhecida",
};

export const META_TEMPLATE_STATUS_LABELS: Record<MetaTemplateStatus, string> = {
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
  PENDING:  "Pendente",
  PAUSED:   "Pausado",
  DISABLED: "Desabilitado",
};

export const META_TEMPLATE_CATEGORY_LABELS: Record<MetaTemplateCategory, string> = {
  MARKETING:      "Marketing",
  UTILITY:        "Utilidade",
  AUTHENTICATION: "Autenticação",
};

// ===========================
// Projetos Module
// ===========================

export type ProjetoStatus = "planejamento" | "em_andamento" | "bloqueado" | "em_revisao" | "pausado" | "concluido" | "cancelado";

export const PROJETO_STATUS: Record<ProjetoStatus, string> = {
  planejamento: "Planejamento",
  em_andamento: "Em Andamento",
  bloqueado: "Bloqueado",
  em_revisao: "Em Revisão",
  pausado: "Pausado",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

export const PROJETO_STATUS_COLORS: Record<ProjetoStatus, string> = {
  planejamento: "bg-blue-400",
  em_andamento: "bg-yellow-500",
  bloqueado: "bg-red-500",
  em_revisao: "bg-purple-500",
  pausado: "bg-orange-500",
  concluido: "bg-green-500",
  cancelado: "bg-slate-500",
};

export type ProjetoPrioridade = "alta" | "media" | "baixa";

export const PROJETO_PRIORIDADE: Record<ProjetoPrioridade, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

export const PROJETO_PRIORIDADE_COLORS: Record<ProjetoPrioridade, string> = {
  alta: "bg-red-500",
  media: "bg-yellow-500",
  baixa: "bg-green-500",
};

export type EtapaStatus = "pendente" | "em_andamento" | "bloqueado" | "em_revisao" | "concluida";

export const ETAPA_STATUS: Record<EtapaStatus, string> = {
  pendente: "Não Iniciado",
  em_andamento: "Em Andamento",
  bloqueado: "Bloqueado",
  em_revisao: "Em Revisão",
  concluida: "Concluída",
};

export const projetoSchema = z.object({
  id: z.string(),
  nome: z.string().min(1, "Nome é obrigatório"),
  descricao: z.string().default(""),
  responsavel: z.string().default(""),
  operacao: z.string().min(1, "Operação é obrigatória"),
  status: z.enum(["planejamento", "em_andamento", "bloqueado", "em_revisao", "pausado", "concluido", "cancelado"]).default("planejamento"),
  dataInicio: z.string(),
  dataPrevisao: z.string(),
  progresso: z.number().min(0).max(100).default(0),
  createdAt: z.number(),
  // Fase 1
  sprint: z.string().optional(),
  prioridade: z.enum(["alta", "media", "baixa"]).optional(),
  // Fase 2
  escopo: z.string().optional(),
  contexto: z.string().optional(),
  foraDeEscopo: z.string().optional(),
  tags: z.array(z.string()).optional(),
  dataConclusaoReal: z.string().optional(),
});

export type Projeto = z.infer<typeof projetoSchema>;

export const insertProjetoSchema = projetoSchema.omit({ id: true, progresso: true, createdAt: true });
export type InsertProjeto = z.infer<typeof insertProjetoSchema>;

export const updateProjetoSchema = projetoSchema.partial().omit({ id: true, createdAt: true });
export type UpdateProjeto = z.infer<typeof updateProjetoSchema>;

export const etapaSchema = z.object({
  id: z.string(),
  projetoId: z.string(),
  nome: z.string().min(1, "Nome da etapa é obrigatório"),
  descricao: z.string().default(""),
  responsavel: z.string().default(""),
  status: z.enum(["pendente", "em_andamento", "bloqueado", "em_revisao", "concluida"]).default("pendente"),
  ordem: z.number().default(0),
  dataPrevista: z.string().optional(),
  // Fase 1
  estimativa: z.number().optional(),
  // Fase 2
  dataInicioReal: z.string().optional(),
  dataConclusaoReal: z.string().optional(),
  observacao: z.string().optional(),
});

export type Etapa = z.infer<typeof etapaSchema>;

export const insertEtapaSchema = etapaSchema.omit({ id: true });
export type InsertEtapa = z.infer<typeof insertEtapaSchema>;

export const updateEtapaSchema = etapaSchema.partial().omit({ id: true, projetoId: true });
export type UpdateEtapa = z.infer<typeof updateEtapaSchema>;

export type ProjetoWithEtapas = Projeto & {
  etapas: Etapa[];
};

// ===========================
// Disparos (Campaign Scheduler)
// ===========================

export type DisparoStatus = "agendado" | "executando" | "concluido" | "parado" | "erro";

export const DISPARO_STATUS: Record<DisparoStatus, string> = {
  agendado: "Agendado",
  executando: "Executando",
  concluido: "Concluído",
  parado: "Parado",
  erro: "Erro",
};

// Required columns that MUST exist in the uploaded base CSV
export const DISPARO_COLUNAS_OBRIGATORIAS = [
  { campo: "telefone",      descricao: "Número do telefone com DDD",      exemplo: "11999998888" },
  { campo: "nome",          descricao: "Nome completo do destinatário",   exemplo: "João Silva" },
  { campo: "cpf",           descricao: "CPF (somente números)",           exemplo: "12345678900" },
  { campo: "canaldeorigem", descricao: "Canal de origem do lead",         exemplo: "whatsapp" },
  { campo: "curso",         descricao: "Curso de interesse",              exemplo: "Administração" },
  { campo: "unidade",       descricao: "Unidade/campus",                  exemplo: "São Paulo" },
  { campo: "origem",        descricao: "Origem do lead",                  exemplo: "portal" },
  { campo: "lista_nome",    descricao: "Nome da lista/campanha",          exemplo: "Captacao_FMU_Jan" },
  { campo: "modalidade",    descricao: "Modalidade do curso",             exemplo: "Presencial" },
];

// All columns that appear in the CSV template (superset — for template download)
export const DISPARO_TEMPLATE_COLUNAS = [
  "lista_nome","marca","origem","nome","telefone","cursointeresse","nivelescolaridade",
  "email","cursoatual","semestre","idcursodesejado","modalidade","modalidadeperiodo",
  "unidade","datacadastro","faculdade","cpf","curso","canaldeorigem","regional",
  "datadenascimento","datahorariosaidacaptar","datahorarioinscricao",
];

// ---- Canal (channel type: whatsapp, sms, email, etc.) ----
export const disparoCanalSchema = z.object({
  id: z.string(),
  nome: z.string().min(1, "Nome é obrigatório"),
  codigo: z.string().min(1, "Código é obrigatório"), // identifier sent to API e.g. "whatsapp"
  descricao: z.string().default(""),
  criadoEm: z.number(),
});
export type DisparoCanal = z.infer<typeof disparoCanalSchema>;
export const insertDisparoCanalSchema = disparoCanalSchema.omit({ id: true, criadoEm: true });
export type InsertDisparoCanal = z.infer<typeof insertDisparoCanalSchema>;

// ---- Template (message template) ----
export const disparoTemplateSchema = z.object({
  id: z.string(),
  nome: z.string().min(1, "Nome é obrigatório"),
  codigo: z.string().min(1, "Código do template é obrigatório"), // identifier sent to API
  canalId: z.string(), // linked canal
  descricao: z.string().default(""),
  corpo: z.string().default(""), // message body with {{N}} placeholders
  criadoEm: z.number(),
});
export type DisparoTemplate = z.infer<typeof disparoTemplateSchema>;
export const insertDisparoTemplateSchema = disparoTemplateSchema.omit({ id: true, criadoEm: true });
export type InsertDisparoTemplate = z.infer<typeof insertDisparoTemplateSchema>;

// ---- Global config (API URL + token shared by all disparos) ----
export const disparoConfigSchema = z.object({
  apiUrl: z.string().default(""),
  apiToken: z.string().default(""),
});
export type DisparoConfig = z.infer<typeof disparoConfigSchema>;

// ---- Disparo ----
export const disparoSchema = z.object({
  id: z.string(),
  nome: z.string().min(1, "Nome é obrigatório"),
  descricao: z.string().default(""),
  horario: z.string(), // HH:MM
  data: z.string(), // YYYY-MM-DD
  status: z.enum(["agendado", "executando", "concluido", "parado", "erro"]).default("agendado"),
  // Canal & Template (selected from lists)
  canalId: z.string().optional(),
  templateId: z.string().optional(),       // legacy: DisparoTemplate.id
  metaTemplateId: z.string().optional(),   // MetaTemplate.id (synced from WhatsApp API)
  // Base file info
  arquivoNome: z.string().optional(),
  arquivoConteudo: z.string().optional(), // CSV content as string
  origemCogna: z.string().optional(),    // se veio da Base COGNA, guarda o valor de "origem"
  totalRegistros: z.number().default(0),
  processados: z.number().default(0),
  erros: z.number().default(0),
  // Extra params per disparo (beyond canal/template)
  parametrosExtras: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
  // Execution logs
  logs: z.array(z.string()).default([]),
  // Timestamps
  criadoEm: z.number(),
  iniciadoEm: z.number().optional(),
  concluidoEm: z.number().optional(),
});

export type Disparo = z.infer<typeof disparoSchema>;

export const insertDisparoSchema = disparoSchema.omit({ id: true, criadoEm: true, status: true, processados: true, erros: true, logs: true });
export type InsertDisparo = z.infer<typeof insertDisparoSchema>;

export const updateDisparoSchema = disparoSchema.partial().omit({ id: true, criadoEm: true });
export type UpdateDisparo = z.infer<typeof updateDisparoSchema>;

// ===========================
// RPA Config (ConnectaCX credentials)
// ===========================
export const rpaConfigSchema = z.object({
  url: z.string().default(""),
  email: z.string().default(""),
  senha: z.string().default(""),
});
export type RpaConfig = z.infer<typeof rpaConfigSchema>;

// ===========================
// RPA Disparo (ConnectaCX REST API)
// ===========================
export const rpaDisparoSchema = z.object({
  id: z.string(),
  nome: z.string(),
  data: z.string(),    // YYYY-MM-DD
  horario: z.string(), // HH:MM (este slot)
  status: z.enum(["agendado", "em_andamento", "concluido", "erro"]).default("agendado"),

  // Canal (da API ConnectaCX)
  canalExternalId: z.number(),
  canalNome: z.string(),

  // Template (raw do GET /omnichannel/templates/{channelId})
  templateExternalId: z.string(),   // id Meta
  templateNome: z.string(),          // nome do template — usado p/ cruzar qualidade no Gestão Meta
  templateRaw: z.string(),           // JSON completo para transformação no envio

  // Fila (opcional)
  filaExternalId: z.number().optional(),
  filaNome: z.string().optional(),

  // Operação (opcional)
  operacaoId: z.string().optional(),

  // CSV (já fatiado para este slot)
  arquivoNome: z.string().optional(),
  arquivoConteudo: z.string().optional(),
  totalRegistros: z.number().default(0),

  // Mapeamento de variáveis: { "1": "colunaCsv", "2": "outraColuna" }
  varMapping: z.record(z.string(), z.string()).optional(),

  // Execução
  logs: z.array(z.string()).default([]),
  criadoEm: z.number(),
  iniciadoEm: z.number().optional(),
  concluidoEm: z.number().optional(),

  // ID da campanha criada no ConnectaCX (retornado no POST /campaigns)
  campanhaId: z.number().optional(),
});
export type RpaDisparo = z.infer<typeof rpaDisparoSchema>;

export const insertRpaDisparoSchema = rpaDisparoSchema.omit({ id: true, criadoEm: true, status: true, logs: true });
export type InsertRpaDisparo = z.infer<typeof insertRpaDisparoSchema>;

export const updateRpaDisparoSchema = rpaDisparoSchema.partial().omit({ id: true, criadoEm: true });
export type UpdateRpaDisparo = z.infer<typeof updateRpaDisparoSchema>;

// ===========================
// RPA Canal / Template — mantidos para compatibilidade com dados existentes
// ===========================
export const rpaCanalSchema = z.object({
  id: z.string(),
  nome: z.string().min(1),
  criadoEm: z.number(),
});
export type RpaCanal = z.infer<typeof rpaCanalSchema>;
export const insertRpaCanalSchema = rpaCanalSchema.omit({ id: true, criadoEm: true });
export type InsertRpaCanal = z.infer<typeof insertRpaCanalSchema>;

export const rpaTemplateSchema = z.object({
  id: z.string(),
  canalId: z.string(),
  nome: z.string().min(1),
  variaveis: z.array(z.string()).default([]),
  criadoEm: z.number(),
});
export type RpaTemplate = z.infer<typeof rpaTemplateSchema>;
export const insertRpaTemplateSchema = rpaTemplateSchema.omit({ id: true, criadoEm: true });
export type InsertRpaTemplate = z.infer<typeof insertRpaTemplateSchema>;

// ===========================
// Régua Automática — BigQuery config (stored server-side only)
// ===========================
export const reguaConfigSchema = z.object({
  projectId: z.string().default(""),
  dataset: z.string().default(""),
  credentialsJson: z.string().default(""), // full service account JSON
  discadorKey: z.string().default("84vpdL1Pz4HLsVufp9PmwmrrGcWxUrxW"),
  discadorUrl: z.string().default("https://kroton-crm.ibridge.net.br/api/v2/"),
});
export type ReguaConfig = z.infer<typeof reguaConfigSchema>;

// ===========================
// Scheduler config
// ===========================
export const reguaAgendamentoSchema = z.object({
  tipo: z.enum(["uma_vez", "todo_dia", "toda_hora", "a_cada_x_horas", "a_cada_x_dias", "semanal"]),
  horario: z.string().optional(),        // HH:MM
  diasSemana: z.array(z.number()).optional(), // 0=Dom..6=Sáb
  intervalo: z.number().optional(),      // X for a_cada_x_horas/dias
  dataHoraUnica: z.string().optional(),  // YYYY-MM-DD HH:MM for uma_vez
});
export type ReguaAgendamento = z.infer<typeof reguaAgendamentoSchema>;

// Python-specific scheduling schema (Windows Task Scheduler style)
export const pythonAgendamentoSchema = z.object({
  tipo: z.enum(["nenhum", "uma_vez", "diario", "semanal", "mensal"]),
  horario: z.string().optional(),                     // HH:MM
  diasSemana: z.array(z.number()).optional(),         // 0=Dom..6=Sáb
  diaMes: z.number().optional(),                      // 1-31
  dataHoraUnica: z.string().optional(),               // YYYY-MM-DDTHH:MM
  repetirCada: z.object({
    valor: z.number(),
    unidade: z.enum(["minutos", "horas"]),
    periodoMinutos: z.number().optional(), // 0 = indeterminado
  }).optional(),
  janelaHorario: z.object({
    inicio: z.string(),           // HH:MM – início da janela padrão
    fim: z.string(),              // HH:MM – fim da janela padrão
    excecoes: z.array(z.object({
      dias: z.array(z.number()),  // dias da semana (0=Dom..6=Sáb)
      inicio: z.string(),         // HH:MM
      fim: z.string(),            // HH:MM
    })).optional(),
  }).optional(),
  atrasoAleatorio: z.number().optional(),             // minutes
  interromperApos: z.number().optional(),             // minutes
  expiraEm: z.string().optional(),                    // ISO date string
  habilitado: z.boolean().default(true),
});
export type PythonAgendamento = z.infer<typeof pythonAgendamentoSchema>;

// ===========================
// Column mapping & filters
// ===========================
export const reguaMapeamentoSchema = z.object({
  campoApi: z.string(),   // e.g. "contato_nome" or "contato_telefone_1"
  colunaBq: z.string(),   // BQ column name
  isCustom: z.boolean().default(false), // true = user-defined extra field
});
export type ReguaMapeamento = z.infer<typeof reguaMapeamentoSchema>;

export const reguaFiltroSchema = z.object({
  coluna: z.string(),
  operador: z.enum(["=", "!=", ">", "<", ">=", "<=", "LIKE", "IN", "NOT IN", "IS NULL", "IS NOT NULL"]),
  valor: z.string(),
});
export type ReguaFiltro = z.infer<typeof reguaFiltroSchema>;

// ===========================
// Rotina
// ===========================
export const reguaRotinaSchema = z.object({
  id: z.string(),
  nome: z.string(),
  operacaoId: z.number(),   // 1=Ativa, 12=Pós, 14=Singularidades
  listaId: z.number(),      // Numeric list ID in ibridge (ex: 5341)
  campanhaId: z.number().optional(), // Optional campaign ID to avoid ELR03 error
  dataset: z.string(),
  tabela: z.string(),
  mapeamento: z.array(reguaMapeamentoSchema).default([]),
  filtros: z.array(reguaFiltroSchema).default([]),
  agendamento: reguaAgendamentoSchema,
  status: z.enum(["ativo", "pausado", "concluido", "erro"]).default("ativo"),
  proximaExecucao: z.number().optional(),
  ultimaExecucao: z.number().optional(),
  criadoEm: z.number(),
});
export type ReguaRotina = z.infer<typeof reguaRotinaSchema>;
export const insertReguaRotinaSchema = reguaRotinaSchema.omit({ id: true, criadoEm: true, proximaExecucao: true, ultimaExecucao: true });
export type InsertReguaRotina = z.infer<typeof insertReguaRotinaSchema>;

// ===========================
// Execution Log
// ===========================
// ===========================
// Python Scripts Module
// ===========================

export const pythonAgentConfigSchema = z.object({
  agentUrl: z.string().default(""),   // http://IP:8765
  agentKey: z.string().default(""),   // API key sent as X-Api-Key header
});
export type PythonAgentConfig = z.infer<typeof pythonAgentConfigSchema>;

export const pythonScriptSchema = z.object({
  id: z.string(),
  nome: z.string(),
  descricao: z.string().default(""),
  caminhoVm: z.string(),
  argumentos: z.string().default(""),
  tags: z.array(z.string()).default([]),
  agendamento: pythonAgendamentoSchema.optional(),
  ativo: z.boolean().default(true),
  gerenciadoPorAutoTarefa: z.boolean().default(false),
  criadoEm: z.number(),
  ultimaExecucao: z.number().optional(),
  proximaExecucao: z.number().optional(),
  ultimoStatus: z.enum(["sucesso", "erro", "executando", "aguardando", "nunca"]).default("nunca"),
  duracaoMediaMs: z.number().optional(), // learned average duration
});
export type PythonScript = z.infer<typeof pythonScriptSchema>;
export const insertPythonScriptSchema = pythonScriptSchema.omit({ id: true, criadoEm: true, ultimaExecucao: true, proximaExecucao: true, ultimoStatus: true, duracaoMediaMs: true });
export type InsertPythonScript = z.infer<typeof insertPythonScriptSchema>;

export const pythonExecutionSchema = z.object({
  id: z.string(),
  scriptId: z.string(),
  scriptNome: z.string(),
  agentJobId: z.string().optional(),
  iniciadoEm: z.number(),
  concluidoEm: z.number().optional(),
  status: z.enum(["aguardando", "executando", "concluido", "erro", "timeout"]),
  exitCode: z.number().optional(),
  logs: z.array(z.string()).default([]),
  origem: z.enum(["manual", "agendado"]).default("manual"),
});
export type PythonExecution = z.infer<typeof pythonExecutionSchema>;

export const pythonQueueItemSchema = z.object({
  scriptId: z.string(),
  execId: z.string(),
  scriptNome: z.string(),
  enfileiradoEm: z.number(),
  origem: z.enum(["manual", "agendado"]),
  posicao: z.number(),
});
export type PythonQueueItem = z.infer<typeof pythonQueueItemSchema>;

export const reguaLogSchema = z.object({
  id: z.string(),
  rotinaId: z.string(),
  rotinaNome: z.string(),
  iniciadoEm: z.number(),
  concluidoEm: z.number().optional(),
  status: z.enum(["em_andamento", "concluido", "erro"]),
  totalRegistros: z.number().default(0),
  enviadosOk: z.number().default(0),
  duplicados: z.number().default(0),
  erros: z.number().default(0),
  mensagens: z.array(z.string()).default([]),
});
export type ReguaLog = z.infer<typeof reguaLogSchema>;

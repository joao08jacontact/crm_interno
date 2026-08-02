import { useState, useRef, useCallback } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Zap, Plus, Trash2, Play, Clock, CheckCircle2, XCircle, Loader2,
  ChevronDown, ChevronUp, AlertCircle, RefreshCw, Calendar,
  Table2, Filter, GitMerge, Shuffle, PauseCircle, PlayCircle,
  Columns, Info, X, ArrowRight, Eye,
} from "lucide-react";
import type { ReguaRotina, ReguaLog, ReguaMapeamento, ReguaFiltro, ReguaAgendamento } from "@shared/schema";

// ─── Constants ───────────────────────────────────────────────

const OPERACOES = [
  { id: 1, label: "Ativa (Kroton)" },
  { id: 12, label: "Pós Graduação" },
  { id: 14, label: "Singularidades" },
];

const REQUIRED_API_FIELDS: Array<{ campo: string; label: string; required: boolean }> = [
  { campo: "contato_codigo", label: "Código (CPF/ID)", required: true },
  { campo: "contato_nome", label: "Nome", required: true },
  { campo: "contato_telefone_1", label: "Telefone 1", required: true },
  { campo: "contato_cpf", label: "CPF", required: false },
  { campo: "contato_telefone_2", label: "Telefone 2", required: false },
  { campo: "contato_telefone_3", label: "Telefone 3", required: false },
  { campo: "contato_curso", label: "Curso", required: false },
  { campo: "contato_campus", label: "Campus", required: false },
  { campo: "contato_nome_acao", label: "Nome da Ação", required: false },
];

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const STATUS_COLORS: Record<string, string> = {
  ativo: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  pausado: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  concluido: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  erro: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  em_andamento: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

function fmtTs(ts?: number) {
  if (!ts) return "—";
  return format(new Date(ts), "dd/MM/yy HH:mm", { locale: ptBR });
}

function fmtAgendamento(a: ReguaAgendamento): string {
  if (a.tipo === "uma_vez") return `Uma vez em ${a.dataHoraUnica ?? "—"}`;
  if (a.tipo === "todo_dia") return `Todo dia às ${a.horario ?? "—"}`;
  if (a.tipo === "toda_hora") return `A cada hora`;
  if (a.tipo === "a_cada_x_horas") return `A cada ${a.intervalo ?? "?"} hora(s)`;
  if (a.tipo === "a_cada_x_dias") return `A cada ${a.intervalo ?? "?"} dia(s) às ${a.horario ?? "—"}`;
  if (a.tipo === "semanal") {
    const dias = (a.diasSemana ?? []).map(d => DIAS_SEMANA[d]).join(", ");
    return `Semanal (${dias}) às ${a.horario ?? "—"}`;
  }
  return a.tipo;
}

// ─── Scheduler Step ──────────────────────────────────────────

function SchedulerStep({ value, onChange }: {
  value: ReguaAgendamento;
  onChange: (v: ReguaAgendamento) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Tipo de agendamento</Label>
        <Select value={value.tipo} onValueChange={tipo => onChange({ ...value, tipo: tipo as any })}>
          <SelectTrigger data-testid="select-agendamento-tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="uma_vez">Uma vez</SelectItem>
            <SelectItem value="todo_dia">Todo dia</SelectItem>
            <SelectItem value="toda_hora">A cada hora</SelectItem>
            <SelectItem value="a_cada_x_horas">A cada X horas</SelectItem>
            <SelectItem value="a_cada_x_dias">A cada X dias</SelectItem>
            <SelectItem value="semanal">Semanal (dias da semana)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {value.tipo === "uma_vez" && (
        <div className="space-y-1">
          <Label>Data e hora</Label>
          <Input
            type="datetime-local"
            value={value.dataHoraUnica?.replace(" ", "T") ?? ""}
            onChange={e => onChange({ ...value, dataHoraUnica: e.target.value.replace("T", " ") })}
            data-testid="input-data-hora-unica"
          />
        </div>
      )}

      {(value.tipo === "todo_dia" || value.tipo === "semanal" || value.tipo === "a_cada_x_dias") && (
        <div className="space-y-1">
          <Label>Horário de execução</Label>
          <Input
            type="time"
            value={value.horario ?? ""}
            onChange={e => onChange({ ...value, horario: e.target.value })}
            data-testid="input-horario-agendamento"
          />
        </div>
      )}

      {(value.tipo === "a_cada_x_horas" || value.tipo === "a_cada_x_dias") && (
        <div className="space-y-1">
          <Label>{value.tipo === "a_cada_x_horas" ? "Intervalo (horas)" : "Intervalo (dias)"}</Label>
          <Input
            type="number"
            min={1}
            value={value.intervalo ?? 1}
            onChange={e => onChange({ ...value, intervalo: Number(e.target.value) })}
            data-testid="input-intervalo-agendamento"
          />
        </div>
      )}

      {value.tipo === "semanal" && (
        <div className="space-y-2">
          <Label>Dias da semana</Label>
          <div className="flex gap-2 flex-wrap">
            {DIAS_SEMANA.map((d, i) => {
              const selected = (value.diasSemana ?? []).includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    const dias = value.diasSemana ?? [];
                    onChange({
                      ...value,
                      diasSemana: selected ? dias.filter(x => x !== i) : [...dias, i],
                    });
                  }}
                  className={`w-10 h-10 rounded-md text-xs font-medium border transition-colors
                    ${selected ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
                  data-testid={`dia-semana-${i}`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="p-3 bg-muted/30 rounded text-xs text-muted-foreground">
        <strong>Resumo:</strong> {fmtAgendamento(value)}
      </div>
    </div>
  );
}

// ─── Create Rotina Wizard ─────────────────────────────────────

const STEPS = ["Geral", "Tabela & Filtros", "Mapeamento de Colunas", "Agendamento"] as const;

interface CreateRotinaWizardProps {
  open: boolean;
  onClose: () => void;
}

function CreateRotinaWizard({ open, onClose }: CreateRotinaWizardProps) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);

  // Step 0 — Geral
  const [nome, setNome] = useState("");
  const [operacaoId, setOperacaoId] = useState<number>(1);
  const [listaId, setListaId] = useState<number | "">("");
  const [campanhaId, setCampanhaId] = useState<number | "">("");

  // Step 1 — Tabela & Filtros
  const [dataset, setDataset] = useState("");
  const [tabela, setTabela] = useState("");
  const [filtros, setFiltros] = useState<ReguaFiltro[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);

  // Preview table
  const [previewData, setPreviewData] = useState<{ columns: string[]; rows: Record<string, any>[]; total: number } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  async function fetchPreview() {
    if (!dataset || !tabela) return;
    setPreviewLoading(true);
    setPreviewError("");
    setPreviewData(null);
    try {
      const filtrosParam = encodeURIComponent(JSON.stringify(filtros));
      const res = await fetch(`/api/regua-preview?dataset=${dataset}&table=${tabela}&filtros=${filtrosParam}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Erro ao buscar preview");
      setPreviewData(j);
    } catch (e: any) {
      setPreviewError(e.message);
    } finally {
      setPreviewLoading(false);
    }
  }

  // Step 2 — Mapping (drag & drop)
  const [mapeamento, setMapeamento] = useState<ReguaMapeamento[]>([]);
  const [customFieldNome, setCustomFieldNome] = useState("");
  const [draggedCol, setDraggedCol] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);

  // Step 3 — Scheduler
  const [agendamento, setAgendamento] = useState<ReguaAgendamento>({ tipo: "todo_dia", horario: "08:00" });

  const { data: datasetsData = [] } = useQuery<string[]>({
    queryKey: ["/api/regua-datasets"],
    enabled: open,
    retry: false,
  });

  const { data: tables = [], isLoading: tablesLoading } = useQuery<string[]>({
    queryKey: ["/api/regua-tables", dataset],
    queryFn: async () => {
      const res = await fetch(`/api/regua-tables?dataset=${dataset}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      return j;
    },
    enabled: !!dataset,
  });

  const { data: bqSchema = [] } = useQuery<Array<{ name: string; type: string; mode: string }>>({
    queryKey: ["/api/regua-schema", dataset, tabela],
    queryFn: async () => {
      const res = await fetch(`/api/regua-schema?dataset=${dataset}&table=${tabela}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      return j;
    },
    enabled: !!dataset && !!tabela,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("POST", "/api/regua-rotinas", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/regua-rotinas"] });
      toast({ title: "Rotina criada e agendada!" });
      handleClose();
    },
    onError: (e: any) => toast({ title: `Erro: ${e.message}`, variant: "destructive" }),
  });

  function handleClose() {
    onClose();
    setStep(0);
    setNome(""); setOperacaoId(1); setListaId(""); setCampanhaId("");
    setDataset(""); setTabela(""); setFiltros([]);
    setMapeamento([]); setCustomFieldNome("");
    setAgendamento({ tipo: "todo_dia", horario: "08:00" });
  }

  function validateStep(): string | null {
    if (step === 0) {
      if (!nome.trim()) return "Informe o nome da rotina.";
      if (!listaId) return "Informe o ID da lista no discador (número).";
    }
    if (step === 1) {
      if (!dataset) return "Selecione o dataset.";
      if (!tabela) return "Selecione a tabela.";
    }
    if (step === 2) {
      const required = ["contato_codigo", "contato_nome", "contato_telefone_1"];
      for (const r of required) {
        if (!mapeamento.find(m => m.campoApi === r && m.colunaBq)) {
          return `Campo obrigatório não mapeado: ${r}`;
        }
      }
    }
    return null;
  }

  function nextStep() {
    const err = validateStep();
    if (err) { toast({ title: err, variant: "destructive" }); return; }
    if (step < STEPS.length - 1) setStep(s => s + 1);
  }

  function prevStep() {
    if (step > 0) setStep(s => s - 1);
  }

  function handleSubmit() {
    const err = validateStep();
    if (err) { toast({ title: err, variant: "destructive" }); return; }
    createMutation.mutate({
      nome, operacaoId,
      listaId: Number(listaId),
      campanhaId: campanhaId !== "" ? Number(campanhaId) : undefined,
      dataset, tabela,
      mapeamento, filtros, agendamento, status: "ativo",
    });
  }

  // Drag & drop mapping
  function onDropOnField(campoApi: string) {
    if (!draggedCol) return;
    setMapeamento(prev => {
      const existing = prev.filter(m => m.campoApi !== campoApi);
      return [...existing, { campoApi, colunaBq: draggedCol, isCustom: false }];
    });
    setDraggedCol(null);
    setDragTarget(null);
  }

  function removeMapeamento(campoApi: string) {
    setMapeamento(prev => prev.filter(m => m.campoApi !== campoApi));
  }

  function addCustomField() {
    if (!customFieldNome.trim()) return;
    const campoApi = customFieldNome.startsWith("contato_")
      ? customFieldNome.trim()
      : `contato_${customFieldNome.trim()}`;
    if (mapeamento.find(m => m.campoApi === campoApi)) {
      toast({ title: "Campo já existe no mapeamento.", variant: "destructive" });
      return;
    }
    setMapeamento(prev => [...prev, { campoApi, colunaBq: "", isCustom: true }]);
    setCustomFieldNome("");
  }

  const allApiFields = [
    ...REQUIRED_API_FIELDS,
    ...mapeamento.filter(m => m.isCustom).map(m => ({
      campo: m.campoApi,
      label: m.campoApi.replace("contato_", ""),
      required: false,
    })),
  ];

  function addFiltro() {
    setFiltros(prev => [...prev, { coluna: "", operador: "=", valor: "" }]);
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-[95vw] w-[1100px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Nova Rotina Automática
          </DialogTitle>
          {/* Progress steps */}
          <div className="flex items-center gap-1 mt-3">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-1 flex-1">
                <div
                  className={`flex-1 flex items-center justify-center px-2 py-1 rounded text-xs font-medium transition-colors ${
                    i === step ? "bg-primary text-primary-foreground" :
                    i < step ? "bg-primary/30 text-primary" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {i + 1}. {s}
                </div>
                {i < STEPS.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />}
              </div>
            ))}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 pr-1">
          {/* ── Step 0: Geral ── */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Nome da rotina</Label>
                <Input
                  placeholder="Ex: Envio Leads FMU Manhã"
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                  data-testid="input-rotina-nome"
                />
              </div>
              <div className="space-y-1">
                <Label>Operação do discador</Label>
                <Select value={String(operacaoId)} onValueChange={v => setOperacaoId(Number(v))}>
                  <SelectTrigger data-testid="select-operacao-id">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPERACOES.map(o => (
                      <SelectItem key={o.id} value={String(o.id)}>{o.id} — {o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>
                    ID da lista no discador <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="number"
                    placeholder="Ex: 5341"
                    value={listaId}
                    onChange={e => setListaId(e.target.value === "" ? "" : Number(e.target.value))}
                    data-testid="input-lista-id"
                  />
                  <p className="text-xs text-muted-foreground">
                    Número inteiro da lista no ibridge. Deduplicação por telefone ativa por lista.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label>
                    ID da campanha <span className="text-xs text-muted-foreground">(opcional, evita erro ELR03)</span>
                  </Label>
                  <Input
                    type="number"
                    placeholder="Ex: 247"
                    value={campanhaId}
                    onChange={e => setCampanhaId(e.target.value === "" ? "" : Number(e.target.value))}
                    data-testid="input-campanha-id"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Step 1: Tabela & Filtros ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Dataset BigQuery</Label>
                  {datasetsData.length > 0 ? (
                    <SearchableSelect
                      value={dataset}
                      onValueChange={v => { setDataset(v); setTabela(""); }}
                      options={datasetsData.map(d => ({ value: d, label: d }))}
                      placeholder="Selecione o dataset"
                      searchPlaceholder="Pesquisar dataset..."
                      data-testid="select-dataset"
                    />
                  ) : (
                    <Input
                      placeholder="ex: jacontactcenter"
                      value={dataset}
                      onChange={e => { setDataset(e.target.value); setTabela(""); }}
                      data-testid="input-dataset"
                    />
                  )}
                </div>

                <div className="space-y-1">
                  <Label>Tabela</Label>
                  {dataset && tables.length > 0 ? (
                    <SearchableSelect
                      value={tabela}
                      onValueChange={setTabela}
                      options={tables.map(t => ({ value: t, label: t }))}
                      placeholder={tablesLoading ? "Carregando..." : "Selecione a tabela"}
                      searchPlaceholder="Pesquisar tabela..."
                      data-testid="select-tabela"
                    />
                  ) : (
                    <Input
                      placeholder="ex: disparo_contatos"
                      value={tabela}
                      onChange={e => setTabela(e.target.value)}
                      data-testid="input-tabela"
                    />
                  )}
                </div>
              </div>

              {bqSchema.length > 0 && (
                <div className="p-3 border rounded bg-muted/20">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">
                    Colunas da tabela <code>{tabela}</code> ({bqSchema.length}):
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {bqSchema.map(c => (
                      <Badge key={c.name} variant="outline" className="text-xs">
                        {c.name} <span className="text-muted-foreground ml-1">{c.type}</span>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Filtros WHERE</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addFiltro} data-testid="button-add-filtro">
                    <Plus className="h-3 w-3 mr-1" />
                    Adicionar filtro
                  </Button>
                </div>
                {filtros.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">Sem filtros — todos os registros serão incluídos</p>
                )}
                {filtros.map((f, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-center">
                    {bqSchema.length > 0 ? (
                      <SearchableSelect
                        value={f.coluna}
                        onValueChange={v => setFiltros(prev => prev.map((x, j) => j === i ? { ...x, coluna: v } : x))}
                        options={bqSchema.map(c => ({ value: c.name, label: c.name, description: c.type }))}
                        placeholder="Coluna"
                        searchPlaceholder="Pesquisar coluna..."
                        triggerClassName="text-xs h-9"
                      />
                    ) : (
                      <Input placeholder="Coluna" value={f.coluna} onChange={e => setFiltros(prev => prev.map((x, j) => j === i ? { ...x, coluna: e.target.value } : x))} className="text-xs" />
                    )}
                    <Select value={f.operador} onValueChange={v => setFiltros(prev => prev.map((x, j) => j === i ? { ...x, operador: v as any } : x))}>
                      <SelectTrigger className="w-28 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["=", "!=", ">", "<", ">=", "<=", "LIKE", "IN", "NOT IN", "IS NULL", "IS NOT NULL"].map(op => (
                          <SelectItem key={op} value={op}>{op}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Input
                          placeholder="Valor ou D-1"
                          value={f.valor}
                          onChange={e => setFiltros(prev => prev.map((x, j) => j === i ? { ...x, valor: e.target.value } : x))}
                          className={`text-xs ${/^[Dd][+-]\d+$/.test(f.valor.trim()) ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30 font-mono" : ""}`}
                          disabled={f.operador === "IS NULL" || f.operador === "IS NOT NULL"}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs text-xs">
                        <p className="font-semibold mb-1">Variáveis de data dinâmica:</p>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
                          <span>D-0</span><span className="font-sans text-muted-foreground">= hoje</span>
                          <span>D-1</span><span className="font-sans text-muted-foreground">= ontem</span>
                          <span>D-2</span><span className="font-sans text-muted-foreground">= anteontem</span>
                          <span>D+1</span><span className="font-sans text-muted-foreground">= amanhã</span>
                        </div>
                        <p className="mt-1 text-muted-foreground">São substituídas pela data real (YYYY-MM-DD) ao executar a rotina.</p>
                      </TooltipContent>
                    </Tooltip>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                      onClick={() => setFiltros(prev => prev.filter((_, j) => j !== i))}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* ── Preview ── */}
              {tabela && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <p className="text-sm font-medium">Pré-visualização dos dados</p>
                      {previewData && (
                        <Badge variant="secondary" className="text-xs">
                          {previewData.total.toLocaleString("pt-BR")} linha{previewData.total !== 1 ? "s" : ""} no total
                        </Badge>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={fetchPreview}
                      disabled={previewLoading}
                      data-testid="button-preview"
                    >
                      {previewLoading
                        ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Consultando...</>
                        : <><Eye className="h-3.5 w-3.5 mr-1.5" />Pré-visualizar (10 linhas)</>
                      }
                    </Button>
                  </div>

                  {previewError && (
                    <div className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-3 py-2">
                      {previewError}
                    </div>
                  )}

                  {previewData && previewData.rows.length > 0 && (
                    <div className="rounded border overflow-auto max-h-80">
                      <table className="w-full text-xs min-w-max">
                        <thead className="bg-muted sticky top-0 z-10">
                          <tr>
                            {previewData.columns.map(col => (
                              <th key={col} className="px-2 py-1.5 text-left font-semibold whitespace-nowrap border-b border-r last:border-r-0">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewData.rows.map((row, ri) => (
                            <tr key={ri} className={ri % 2 === 0 ? "bg-background" : "bg-muted/30"}>
                              {previewData.columns.map(col => (
                                <td key={col} className="px-2 py-1 whitespace-nowrap border-r last:border-r-0 max-w-[200px] truncate" title={String(row[col] ?? "")}>
                                  {row[col] === null || row[col] === undefined
                                    ? <span className="text-muted-foreground italic">null</span>
                                    : String(row[col])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {previewData && previewData.rows.length === 0 && (
                    <p className="text-xs text-muted-foreground italic text-center py-3">
                      Nenhum registro encontrado com os filtros aplicados.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Mapeamento ── */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Arraste uma coluna do BigQuery (esquerda) e solte no campo do discador correspondente (direita).
              </p>
              <div className="grid grid-cols-2 gap-4">
                {/* Left: BQ columns */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Colunas BigQuery ({bqSchema.length})
                  </p>
                  <ScrollArea className="h-72 rounded border p-2">
                    <div className="space-y-1">
                      {bqSchema.map(col => {
                        const isMapped = mapeamento.some(m => m.colunaBq === col.name);
                        return (
                          <div
                            key={col.name}
                            draggable
                            onDragStart={() => setDraggedCol(col.name)}
                            onDragEnd={() => setDraggedCol(null)}
                            className={`flex items-center justify-between px-2 py-1.5 rounded border text-xs cursor-grab active:cursor-grabbing transition-all
                              ${isMapped ? "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800" : "bg-background hover:bg-muted/50"}
                              ${draggedCol === col.name ? "opacity-50 scale-95" : ""}`}
                            data-testid={`col-bq-${col.name}`}
                          >
                            <span className="font-mono">{col.name}</span>
                            <span className="text-muted-foreground ml-2">{col.type}</span>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>

                {/* Right: API fields (drop targets) */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Campos do Discador
                  </p>
                  <ScrollArea className="h-72 rounded border p-2">
                    <div className="space-y-1.5">
                      {allApiFields.map(field => {
                        const mapped = mapeamento.find(m => m.campoApi === field.campo);
                        const isTarget = dragTarget === field.campo;
                        return (
                          <div
                            key={field.campo}
                            onDragOver={e => { e.preventDefault(); setDragTarget(field.campo); }}
                            onDragLeave={() => setDragTarget(null)}
                            onDrop={() => onDropOnField(field.campo)}
                            className={`flex items-center justify-between px-2 py-1.5 rounded border text-xs transition-all
                              ${isTarget ? "border-primary bg-primary/5 scale-[1.02]" : "border-dashed border-muted-foreground/30"}
                              ${mapped ? "border-solid border-green-300 bg-green-50 dark:bg-green-900/20" : ""}`}
                            data-testid={`field-api-${field.campo}`}
                          >
                            <div className="flex items-center gap-1 min-w-0">
                              {field.required && (
                                <span className="text-red-500 shrink-0">*</span>
                              )}
                              <span className="font-medium truncate">{field.label}</span>
                              <span className="text-muted-foreground truncate font-mono">({field.campo})</span>
                            </div>
                            {mapped ? (
                              <div className="flex items-center gap-1 shrink-0">
                                <Badge variant="secondary" className="text-xs max-w-[100px] truncate">
                                  {mapped.colunaBq}
                                </Badge>
                                <button
                                  type="button"
                                  onClick={() => removeMapeamento(field.campo)}
                                  className="text-muted-foreground hover:text-destructive"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-[10px] shrink-0 italic">soltar aqui</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              </div>

              {/* Also allow direct select (easier on non-drag devices) */}
              <div className="space-y-2">
                <Separator />
                <p className="text-xs font-semibold text-muted-foreground">Mapeamento direto por seleção</p>
                {REQUIRED_API_FIELDS.map(field => (
                  <div key={field.campo} className="grid grid-cols-2 gap-2 items-center">
                    <Label className="text-xs">
                      {field.required && <span className="text-red-500 mr-1">*</span>}
                      {field.label}
                    </Label>
                    <SearchableSelect
                      value={mapeamento.find(m => m.campoApi === field.campo)?.colunaBq ?? ""}
                      onValueChange={v => {
                        if (!v || v === "__none__") { removeMapeamento(field.campo); return; }
                        setMapeamento(prev => {
                          const filtered = prev.filter(m => m.campoApi !== field.campo);
                          return [...filtered, { campoApi: field.campo, colunaBq: v, isCustom: false }];
                        });
                      }}
                      options={[
                        { value: "__none__", label: "— sem mapeamento —" },
                        ...bqSchema.map(c => ({ value: c.name, label: c.name, description: c.type })),
                      ]}
                      placeholder="— sem mapeamento —"
                      searchPlaceholder="Pesquisar coluna..."
                      triggerClassName="text-xs h-8"
                    />
                  </div>
                ))}
              </div>

              {/* Custom extra field */}
              <div className="flex gap-2 items-end">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Campo extra personalizado (prefixo contato_ adicionado automaticamente)</Label>
                  <Input
                    placeholder="ex: unidade → contato_unidade"
                    value={customFieldNome}
                    onChange={e => setCustomFieldNome(e.target.value)}
                    className="text-xs h-8"
                    data-testid="input-custom-field"
                  />
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addCustomField} data-testid="button-add-custom-field">
                  <Plus className="h-3 w-3 mr-1" />
                  Adicionar
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 3: Agendamento ── */}
          {step === 3 && (
            <SchedulerStep value={agendamento} onChange={setAgendamento} />
          )}
        </div>

        <DialogFooter className="gap-2">
          {step > 0 && (
            <Button variant="outline" onClick={prevStep} data-testid="button-wizard-prev">
              Voltar
            </Button>
          )}
          <Button variant="outline" onClick={handleClose} data-testid="button-wizard-cancel">Cancelar</Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={nextStep} data-testid="button-wizard-next">
              Próximo
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={createMutation.isPending} data-testid="button-wizard-submit">
              {createMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
              Criar Rotina
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Log Panel ───────────────────────────────────────────────

function LogPanel({ rotinaId, rotinaNome }: { rotinaId?: string; rotinaNome?: string }) {
  const { data: logs = [], isLoading } = useQuery<ReguaLog[]>({
    queryKey: ["/api/regua-logs", rotinaId],
    queryFn: async () => {
      const qs = rotinaId ? `?rotinaId=${rotinaId}&limit=50` : "?limit=50";
      const res = await fetch(`/api/regua-logs${qs}`);
      return res.json();
    },
    refetchInterval: 5000,
  });

  if (isLoading) return <div className="flex items-center justify-center h-20"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  if (logs.length === 0) return (
    <div className="flex flex-col items-center justify-center h-20 text-muted-foreground">
      <p className="text-sm italic">Nenhum log de execução{rotinaId ? " para esta rotina" : ""}</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {rotinaId && rotinaNome && (
        <p className="text-xs text-muted-foreground font-medium">Logs da rotina: <strong>{rotinaNome}</strong></p>
      )}
      {logs.map(log => (
        <div key={log.id} className="border rounded-md p-3 space-y-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[log.status]}`}>
                {log.status === "em_andamento" && <Loader2 className="h-3 w-3 animate-spin" />}
                {log.status === "concluido" && <CheckCircle2 className="h-3 w-3" />}
                {log.status === "erro" && <XCircle className="h-3 w-3" />}
                {log.status}
              </span>
              {!rotinaId && <span className="text-xs font-medium">{log.rotinaNome}</span>}
              <span className="text-xs text-muted-foreground">{fmtTs(log.iniciadoEm)}</span>
            </div>
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span>Total: <strong className="text-foreground">{log.totalRegistros}</strong></span>
              <span>Enviados: <strong className="text-green-600">{log.enviadosOk}</strong></span>
              <span>Duplicados: <strong className="text-yellow-600">{log.duplicados}</strong></span>
              <span>Erros: <strong className="text-red-600">{log.erros}</strong></span>
            </div>
          </div>
          {log.mensagens.length > 0 && (
            <ScrollArea className="h-40 rounded bg-muted/30 p-2">
              <div className="space-y-0.5">
                {log.mensagens.map((line, i) => (
                  <p key={i} className={`text-[11px] font-mono leading-relaxed
                    ${line.includes("ERRO") || line.includes("❌") ? "text-red-500" :
                      line.includes("✔") || line.includes("✅") ? "text-green-600 dark:text-green-400" :
                      line.includes("⚠") ? "text-yellow-600" : "text-foreground/80"}`}>
                    {line}
                  </p>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Rotina Card ─────────────────────────────────────────────

function RotinaCard({ rotina }: { rotina: ReguaRotina }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"info" | "log">("info");

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/regua-rotinas/${rotina.id}`);
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/regua-rotinas"] }); toast({ title: "Rotina removida" }); },
  });

  const executeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/regua-rotinas/${rotina.id}/executar`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/regua-rotinas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/regua-logs"] });
      toast({ title: "Execução iniciada!" });
    },
    onError: (e: any) => toast({ title: `Erro: ${e.message}`, variant: "destructive" }),
  });

  const pauseMutation = useMutation({
    mutationFn: async () => {
      const newStatus = rotina.status === "pausado" ? "ativo" : "pausado";
      const res = await apiRequest("PATCH", `/api/regua-rotinas/${rotina.id}`, { status: newStatus });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/regua-rotinas"] }),
  });

  const operacaoLabel = OPERACOES.find(o => o.id === rotina.operacaoId)?.label ?? String(rotina.operacaoId);

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base">{rotina.nome}</CardTitle>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[rotina.status]}`}>
                {rotina.status}
              </span>
            </div>
            <CardDescription className="mt-1 flex flex-wrap gap-3 text-xs">
              <span><Zap className="h-3 w-3 inline mr-1" />{operacaoLabel}</span>
              <span><Table2 className="h-3 w-3 inline mr-1" />{rotina.dataset}.{rotina.tabela}</span>
              <span><Calendar className="h-3 w-3 inline mr-1" />{fmtAgendamento(rotina.agendamento)}</span>
              <span className="font-mono bg-muted/50 px-1.5 rounded">Lista #{rotina.listaId}{rotina.campanhaId ? ` · Camp. #${rotina.campanhaId}` : ""}</span>
            </CardDescription>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="outline" size="sm"
              onClick={() => executeMutation.mutate()}
              disabled={executeMutation.isPending || rotina.status === "pausado"}
              data-testid={`button-executar-rotina-${rotina.id}`}
            >
              {executeMutation.isPending
                ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                : <Play className="h-3 w-3 mr-1" />}
              Executar
            </Button>
            <Button
              variant="ghost" size="icon"
              onClick={() => pauseMutation.mutate()}
              title={rotina.status === "pausado" ? "Retomar" : "Pausar"}
              data-testid={`button-pause-rotina-${rotina.id}`}
            >
              {rotina.status === "pausado"
                ? <PlayCircle className="h-4 w-4 text-green-600" />
                : <PauseCircle className="h-4 w-4 text-yellow-600" />}
            </Button>
            <Button
              variant="ghost" size="icon"
              onClick={() => deleteMutation.mutate()}
              className="text-destructive hover:text-destructive"
              data-testid={`button-delete-rotina-${rotina.id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost" size="icon"
              onClick={() => setExpanded(p => !p)}
              data-testid={`button-expand-rotina-${rotina.id}`}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <div className="flex gap-4 text-xs text-muted-foreground mt-1">
          <span>Última execução: {fmtTs(rotina.ultimaExecucao)}</span>
          <span>Próxima: {fmtTs(rotina.proximaExecucao)}</span>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0">
          <div className="flex gap-2 mb-3">
            <Button
              variant={activeTab === "info" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("info")}
            >
              <Info className="h-3.5 w-3.5 mr-1" />
              Configuração
            </Button>
            <Button
              variant={activeTab === "log" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("log")}
              data-testid={`button-tab-log-${rotina.id}`}
            >
              <FileText className="h-3.5 w-3.5 mr-1" />
              Logs
            </Button>
          </div>

          {activeTab === "info" && (
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Mapeamento de campos</p>
                <div className="grid grid-cols-2 gap-1">
                  {rotina.mapeamento.map(m => (
                    <div key={m.campoApi} className="flex items-center gap-1 text-xs bg-muted/30 rounded px-2 py-1">
                      <span className="font-mono text-muted-foreground">{m.colunaBq}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="font-mono text-primary">{m.campoApi}</span>
                    </div>
                  ))}
                </div>
              </div>
              {rotina.filtros.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Filtros WHERE</p>
                  <div className="flex flex-wrap gap-1">
                    {rotina.filtros.map((f, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {f.coluna} {f.operador} {f.valor}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "log" && (
            <LogPanel rotinaId={rotina.id} rotinaNome={rotina.nome} />
          )}
        </CardContent>
      )}
    </Card>
  );
}

// Needed for log tab button icon
function FileText({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

// ─── Main Page ───────────────────────────────────────────────

export default function ReguaAutomatica() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState("todos");
  const [showAllLogs, setShowAllLogs] = useState(false);

  const { data: rotinas = [], isLoading, refetch } = useQuery<ReguaRotina[]>({
    queryKey: ["/api/regua-rotinas"],
    refetchInterval: 10000,
  });

  const { data: reguaConfigStatus } = useQuery<{ configured: boolean; projectId: string; dataset: string }>({
    queryKey: ["/api/regua-config"],
    retry: false,
  });

  const counts = {
    ativo: rotinas.filter(r => r.status === "ativo").length,
    pausado: rotinas.filter(r => r.status === "pausado").length,
    concluido: rotinas.filter(r => r.status === "concluido").length,
    erro: rotinas.filter(r => r.status === "erro").length,
  };

  const filtered = filterStatus === "todos" ? rotinas : rotinas.filter(r => r.status === filterStatus);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b shrink-0">
        <Zap className="h-5 w-5" />
        <div>
          <h1 className="text-xl font-bold">Régua Automática</h1>
          <p className="text-sm text-muted-foreground">Rotinas automáticas BigQuery → Discador ibridge</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        {!reguaConfigStatus?.configured && (
          <div className="flex items-start gap-3 p-4 border border-yellow-200 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-800 rounded-lg">
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">BigQuery não configurado</p>
              <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                Acesse <strong>Configurações → Régua Automática (BigQuery)</strong> para inserir as credenciais do serviço.
              </p>
            </div>
          </div>
        )}

        {reguaConfigStatus?.configured && (
          <div className="flex items-center gap-2 p-3 border border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800 rounded-lg">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <p className="text-sm text-green-800 dark:text-green-200">
              BigQuery conectado — Projeto: <strong>{reguaConfigStatus.projectId}</strong>
              {reguaConfigStatus.dataset && <span> · Dataset padrão: <strong>{reguaConfigStatus.dataset}</strong></span>}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-rotinas">
              <RefreshCw className="h-4 w-4 mr-1" />
              Atualizar
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowAllLogs(p => !p)} data-testid="button-toggle-all-logs">
              <Clock className="h-4 w-4 mr-1" />
              {showAllLogs ? "Ocultar logs gerais" : "Ver todos os logs"}
            </Button>
          </div>
          <Button onClick={() => setCreateOpen(true)} data-testid="button-nova-rotina">
            <Plus className="h-4 w-4 mr-2" />
            Nova Rotina
          </Button>
        </div>

        {showAllLogs && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Histórico de execuções (todas as rotinas)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LogPanel />
            </CardContent>
          </Card>
        )}

        {/* Status counters */}
        <div className="grid grid-cols-4 gap-3">
          {(["ativo", "pausado", "concluido", "erro"] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(prev => prev === s ? "todos" : s)}
              className={`p-3 rounded-lg border text-left transition-all ${filterStatus === s ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
              data-testid={`filter-rotina-${s}`}
            >
              <p className="text-2xl font-bold">{counts[s]}</p>
              <p className="text-xs text-muted-foreground capitalize mt-0.5">{s}</p>
            </button>
          ))}
        </div>

        {/* Rotinas list */}
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <Zap className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">
              {rotinas.length === 0 ? "Nenhuma rotina criada ainda" : "Nenhuma rotina com este status"}
            </p>
            {rotinas.length === 0 && (
              <Button className="mt-3" variant="outline" size="sm" onClick={() => setCreateOpen(true)} data-testid="button-empty-nova-rotina">
                <Plus className="h-4 w-4 mr-1" />
                Criar primeira rotina
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(r => (
              <RotinaCard key={r.id} rotina={r} />
            ))}
          </div>
        )}
      </div>

      <CreateRotinaWizard open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

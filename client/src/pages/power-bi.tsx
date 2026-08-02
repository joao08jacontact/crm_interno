import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  RefreshCw, Plus, Trash2, Settings2, LayoutGrid, CheckCircle2,
  XCircle, Clock, AlertCircle, Play, Eye, EyeOff, Edit2, Save, X, Filter, Tag,
  Calendar, CalendarClock, BarChart3, BellRing, ToggleLeft, ToggleRight, Info
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface PbiConfig {
  tenantId: string;
  clientId: string;
  hasSecret: boolean;
  hasConfig: boolean;
}

interface PbiOperacao {
  id: string;
  name: string;
}

interface PbiDataset {
  id: string;
  name: string;
  groupId: string;
  datasetId: string;
  operacao?: string;
  gerenciadoPorAutoTarefa?: boolean;
}

interface PbiRefreshStatus extends PbiDataset {
  status: string;
  lastRefresh: string | null;
  startTime: string | null;
  errorMessage: string | null;
  errorDetails: any | null;
  requestId: string | null;
  refreshType: string | null;
}

interface PbiAgendamento {
  id: string;
  datasetId: string;
  horarios: string[];
  diasSemana: number[];
  tipo: "diario" | "semanal";
  ativo: boolean;
}

interface PbiRefreshLog {
  id: string;
  datasetId: string;
  datasetName: string;
  horario: string;
  timestamp: string;
  status: "success" | "error";
  errorMessage?: string;
  triggeredBy: "scheduler" | "manual";
}

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const HOURS_RANGE = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);

function statusBadge(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "completed") return (
    <Badge className="bg-green-500/15 text-green-500 border border-green-500/30 gap-1 text-xs">
      <CheckCircle2 className="h-3.5 w-3.5" />Completo
    </Badge>
  );
  if (s === "inprogress") return (
    <Badge className="bg-blue-500/15 text-blue-500 border border-blue-500/30 gap-1 text-xs animate-pulse">
      <RefreshCw className="h-3.5 w-3.5 animate-spin" />Em andamento
    </Badge>
  );
  if (s === "failed" || s === "error") return (
    <Badge className="bg-red-500/15 text-red-500 border border-red-500/30 gap-1 text-xs">
      <XCircle className="h-3.5 w-3.5" />Falha
    </Badge>
  );
  if (s === "disabled") return (
    <Badge variant="outline" className="text-xs text-muted-foreground">Desabilitado</Badge>
  );
  return (
    <Badge variant="outline" className="text-xs text-muted-foreground gap-1">
      <Clock className="h-3.5 w-3.5" />{status || "Desconhecido"}
    </Badge>
  );
}

function formatTs(iso: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit"
    });
  } catch { return iso; }
}

function ErrorDetailsPanel({ ds }: { ds: PbiRefreshStatus }) {
  const [open, setOpen] = useState(false);

  if (!ds.errorMessage) return null;

  const pbiErr = ds.errorDetails?.error?.["pbi.error"] || ds.errorDetails?.error;
  const rootCause = pbiErr?.details?.find(
    (d: any) => d.code === "DM_ErrorDetailNameCode_UnderlyingErrorMessage"
  )?.detail?.value
    || pbiErr?.code
    || ds.errorDetails?.error?.code
    || ds.errorMessage;

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(p => !p)}
        className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors"
        data-testid={`btn-toggle-error-${ds.id}`}
      >
        <AlertCircle className="h-3.5 w-3.5" />
        {open ? "Ocultar detalhes" : "Ver detalhes do erro"}
      </button>

      {open && (
        <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/5 overflow-hidden text-xs">
          <div className="p-3 border-b border-red-500/15">
            <p className="text-red-400 font-medium mb-0.5">Causa raiz</p>
            <p className="text-red-300/80 break-words">{rootCause}</p>
          </div>
          <div className="px-3 py-2 flex flex-wrap gap-x-4 gap-y-1 border-b border-red-500/15 text-muted-foreground">
            {ds.errorMessage && (
              <span><span className="text-red-400/70 font-mono">Código:</span> {ds.errorMessage}</span>
            )}
            {ds.startTime && (
              <span><span className="text-red-400/70 font-mono">Início:</span> {formatTs(ds.startTime)}</span>
            )}
            {ds.refreshType && (
              <span><span className="text-red-400/70 font-mono">Tipo:</span> {ds.refreshType}</span>
            )}
            {ds.requestId && (
              <span><span className="text-red-400/70 font-mono">Request ID:</span> {ds.requestId}</span>
            )}
          </div>
          {ds.errorDetails && (
            <details className="group">
              <summary className="px-3 py-2 cursor-pointer text-muted-foreground hover:text-foreground select-none list-none flex items-center gap-1">
                <span className="text-[10px] uppercase tracking-wide">JSON completo</span>
                <span className="text-muted-foreground/50 group-open:rotate-180 transition-transform inline-block ml-auto">▾</span>
              </summary>
              <pre className="px-3 pb-3 text-[10px] text-red-300/70 font-mono whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                {JSON.stringify(ds.errorDetails, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function RefreshCard({ ds, onManualRefresh, isRefreshing }: {
  ds: PbiRefreshStatus;
  onManualRefresh: () => void;
  isRefreshing: boolean;
}) {
  const hasError = !!(ds.errorMessage);

  return (
    <Card className={`hover:shadow-md transition-shadow ${hasError ? "border-red-500/30" : ""}`}
      data-testid={`pbi-card-${ds.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-sm truncate max-w-[220px]" title={ds.name}>{ds.name}</span>
              {statusBadge(ds.status)}
            </div>
            {ds.operacao && (
              <div className="flex items-center gap-1 mb-1">
                <Tag className="h-3 w-3 text-amber-500/70" />
                <span className="text-[11px] text-amber-500/80">{ds.operacao}</span>
              </div>
            )}
            {ds.lastRefresh && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <Clock className="h-3 w-3" />
                <span>Última atualização: {formatTs(ds.lastRefresh)}</span>
              </div>
            )}
            {ds.startTime && !ds.lastRefresh && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <Clock className="h-3 w-3" />
                <span>Iniciado: {formatTs(ds.startTime)}</span>
              </div>
            )}
            {!ds.lastRefresh && !ds.startTime && (
              <span className="text-xs text-muted-foreground italic">Nenhuma atualização registrada</span>
            )}
            <ErrorDetailsPanel ds={ds} />
            <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground/50 font-mono">
              <span>Group: {ds.groupId.slice(0, 8)}…</span>
              <span className="mx-1">·</span>
              <span>Dataset: {ds.datasetId.slice(0, 8)}…</span>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 h-8 gap-1.5 text-xs"
            onClick={onManualRefresh}
            disabled={isRefreshing || ds.status?.toLowerCase() === "inprogress"}
            data-testid={`btn-refresh-${ds.id}`}
          >
            <Play className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DatasetFormRow({ onAdd, operacoes }: {
  onAdd: (d: { name: string; groupId: string; datasetId: string; operacao?: string }) => void;
  operacoes: PbiOperacao[];
}) {
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [operacao, setOperacao] = useState("");

  const submit = () => {
    if (!name.trim() || !groupId.trim() || !datasetId.trim()) return;
    onAdd({ name: name.trim(), groupId: groupId.trim(), datasetId: datasetId.trim(), operacao: operacao || undefined });
    setName(""); setGroupId(""); setDatasetId(""); setOperacao("");
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr] gap-2">
        <div>
          <Label className="text-xs mb-1 block">Nome do painel</Label>
          <Input data-testid="input-ds-name" placeholder="Ex: Relatório de Vendas" value={name} onChange={e => setName(e.target.value)} className="h-8 text-sm" />
        </div>
        <div>
          <Label className="text-xs mb-1 block">Group ID (Workspace)</Label>
          <Input data-testid="input-ds-groupid" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={groupId} onChange={e => setGroupId(e.target.value)} className="h-8 text-sm font-mono" />
        </div>
        <div>
          <Label className="text-xs mb-1 block">Dataset ID</Label>
          <Input data-testid="input-ds-datasetid" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={datasetId} onChange={e => setDatasetId(e.target.value)} className="h-8 text-sm font-mono" />
        </div>
      </div>
      <div className="flex gap-2 items-end">
        <div className="w-56">
          <Label className="text-xs mb-1 block">Operação <span className="text-muted-foreground">(opcional)</span></Label>
          <Select value={operacao || "__none__"} onValueChange={v => setOperacao(v === "__none__" ? "" : v)}>
            <SelectTrigger className="h-8 text-sm" data-testid="select-ds-operacao">
              <SelectValue placeholder="Selecionar operação…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Nenhuma</SelectItem>
              {operacoes.map(op => (
                <SelectItem key={op.id} value={op.name}>{op.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" className="h-8 gap-1.5" onClick={submit} data-testid="btn-add-dataset">
          <Plus className="h-4 w-4" />Adicionar painel
        </Button>
      </div>
    </div>
  );
}

export default function PowerBi() {
  const { toast } = useToast();
  const [tab, setTab] = useState("paineis");
  const [showSecret, setShowSecret] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; groupId: string; datasetId: string; operacao: string }>({
    name: "", groupId: "", datasetId: "", operacao: ""
  });
  const [filterOperacao, setFilterOperacao] = useState("");
  const [newOperacaoName, setNewOperacaoName] = useState("");

  // Agendamentos state
  const [agForm, setAgForm] = useState<{
    datasetId: string; tipo: "diario" | "semanal"; diasSemana: number[]; horariosSel: string[];
  }>({ datasetId: "", tipo: "diario", diasSemana: [1,2,3,4,5], horariosSel: [] });
  const [editingAgId, setEditingAgId] = useState<string | null>(null);

  const { data: config, isLoading: isLoadingConfig } = useQuery<PbiConfig>({
    queryKey: ["/api/pbi-config"],
  });

  const { data: datasets = [] } = useQuery<PbiDataset[]>({
    queryKey: ["/api/pbi-datasets"],
  });

  const { data: operacoes = [] } = useQuery<PbiOperacao[]>({
    queryKey: ["/api/pbi-operacoes"],
  });

  const { data: agendamentos = [], refetch: refetchAgendamentos } = useQuery<PbiAgendamento[]>({
    queryKey: ["/api/pbi-agendamentos"],
  });

  const { data: refreshLogs = [], refetch: refetchLogs } = useQuery<PbiRefreshLog[]>({
    queryKey: ["/api/pbi-refresh-logs"],
    refetchInterval: 60_000,
  });

  const createAgendamento = useMutation({
    mutationFn: (body: Omit<PbiAgendamento, 'id'>) => apiRequest("POST", "/api/pbi-agendamentos", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pbi-agendamentos"] });
      setAgForm({ datasetId: "", tipo: "diario", diasSemana: [1,2,3,4,5], horariosSel: [] });
      toast({ title: "Agendamento criado!" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const updateAgendamento = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<PbiAgendamento> }) =>
      apiRequest("PATCH", `/api/pbi-agendamentos/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pbi-agendamentos"] });
      setEditingAgId(null);
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteAgendamento = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/pbi-agendamentos/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/pbi-agendamentos"] }),
  });

  const clearLogs = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/pbi-refresh-logs"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pbi-refresh-logs"] });
      toast({ title: "Logs limpos" });
    },
  });

  const { data: statusList = [], isLoading: isLoadingStatus, refetch: refetchStatus, dataUpdatedAt, error: statusError } = useQuery<PbiRefreshStatus[], Error>({
    queryKey: ["/api/pbi-refresh-status"],
    queryFn: async () => {
      const res = await fetch("/api/pbi-refresh-status");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    },
    enabled: !!config?.hasConfig && datasets.length > 0,
    refetchInterval: 30_000,
    retry: false,
  });

  const [configForm, setConfigForm] = useState({ tenantId: "", clientId: "", clientSecret: "" });
  const [configFormInit, setConfigFormInit] = useState(false);

  if (config && !configFormInit) {
    setConfigForm({ tenantId: config.tenantId, clientId: config.clientId, clientSecret: "" });
    setConfigFormInit(true);
  }

  const saveConfig = useMutation({
    mutationFn: () => apiRequest("POST", "/api/pbi-config", configForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pbi-config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pbi-refresh-status"] });
      toast({ title: "Configurações salvas" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const addDataset = useMutation({
    mutationFn: (d: { name: string; groupId: string; datasetId: string; operacao?: string }) =>
      apiRequest("POST", "/api/pbi-datasets", d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/pbi-datasets"] }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteDataset = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/pbi-datasets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pbi-datasets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pbi-refresh-status"] });
    },
  });

  const updateDataset = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<PbiDataset> }) =>
      apiRequest("PATCH", `/api/pbi-datasets/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pbi-datasets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pbi-refresh-status"] });
      setEditingId(null);
    },
  });

  const addOperacao = useMutation({
    mutationFn: (name: string) => apiRequest("POST", "/api/pbi-operacoes", { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pbi-operacoes"] });
      setNewOperacaoName("");
      toast({ title: "Operação criada" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteOperacao = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/pbi-operacoes/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/pbi-operacoes"] }); },
  });

  const manualRefresh = async (ds: PbiDataset) => {
    setRefreshingId(ds.id);
    try {
      const res = await fetch(`/api/pbi-refresh/${ds.groupId}/${ds.datasetId}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro desconhecido");
      toast({ title: "Atualização disparada!", description: ds.name });
      setTimeout(() => refetchStatus(), 3000);
    } catch (e: any) {
      toast({ title: "Erro ao atualizar", description: e.message, variant: "destructive" });
    } finally {
      setRefreshingId(null);
    }
  };

  const lastRefreshTime = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("pt-BR") : null;

  const filteredStatus = (filterOperacao && filterOperacao !== "__all__")
    ? statusList.filter(ds => ds.operacao === filterOperacao)
    : statusList;

  return (
    <div className="flex flex-col h-full p-4 md:p-6 gap-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-amber-500/15 border border-amber-500/30">
            <svg className="h-5 w-5 text-amber-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.545 10.239v1.448h2.148c-.085.716-.647 2.097-2.148 2.097-1.29 0-2.344-1.067-2.344-2.384s1.054-2.384 2.344-2.384c.734 0 1.225.313 1.505.582l1.022-1.008C14.319 7.783 13.491 7.4 12.545 7.4c-2.108 0-3.816 1.707-3.816 3.816s1.708 3.816 3.816 3.816c2.203 0 3.664-1.548 3.664-3.732 0-.25-.027-.441-.063-.622h-3.601zm-8.73 5.127v-9.04l8.73 5.12-8.73 3.92zm10.184 3.634L6.045 21.8 2 19.366V4.634L6.045 2.2 14 5.4l2.455-1.4L22 7.4v9.2l-5.545 3.2-2.455-1.4z"/>
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Power BI</h1>
            <p className="text-xs text-muted-foreground">Monitor de datasets e refresh</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lastRefreshTime && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              Atualizado às {lastRefreshTime}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => refetchStatus()}
            disabled={isLoadingStatus}
            data-testid="btn-refresh-all"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoadingStatus ? "animate-spin" : ""}`} />
            Atualizar status
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 overflow-hidden flex flex-col">
        <TabsList className="shrink-0 w-fit">
          <TabsTrigger value="paineis" data-testid="tab-paineis">
            <LayoutGrid className="h-4 w-4 mr-2" />Painéis
            {datasets.length > 0 && <Badge variant="secondary" className="ml-2 text-xs">{datasets.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="agendamentos" data-testid="tab-agendamentos">
            <CalendarClock className="h-4 w-4 mr-2" />Agendamentos
            {agendamentos.filter(a => a.ativo).length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">{agendamentos.filter(a => a.ativo).length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="dashboard" data-testid="tab-dashboard">
            <BarChart3 className="h-4 w-4 mr-2" />Dashboard
            {refreshLogs.filter(l => l.status === "error").length > 0 && (
              <Badge className="ml-2 text-xs bg-red-500/20 text-red-400 border border-red-500/30">
                {refreshLogs.filter(l => l.status === "error").length} erros
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="config" data-testid="tab-pbi-config">
            <Settings2 className="h-4 w-4 mr-2" />Configurações
            {config?.hasConfig && <CheckCircle2 className="h-3 w-3 ml-2 text-green-500" />}
          </TabsTrigger>
        </TabsList>

        {/* Painéis Tab */}
        <TabsContent value="paineis" className="flex-1 overflow-auto mt-4">
          {/* Auth / API error banner */}
          {statusError && (
            <div className="mb-4 flex gap-3 items-start p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-500">Erro ao buscar status</p>
                <p className="text-xs text-red-400 mt-1 break-all">{statusError.message}</p>
                {statusError.message.includes("7000215") || statusError.message.toLowerCase().includes("invalid client secret") ? (
                  <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-400">
                    <strong>⚠ Atenção:</strong> Você provavelmente colou o <strong>ID do segredo</strong> (um GUID) em vez do <strong>Valor do segredo</strong> (a string longa). No portal Azure, em Certificados &amp; Segredos, há duas colunas: "ID do segredo" e "Valor" — use a coluna <strong>Valor</strong>.
                    <Button size="sm" variant="outline" className="ml-2 h-6 text-xs px-2 border-amber-500/50 text-amber-400" onClick={() => setTab("config")}>
                      Corrigir agora
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {!config?.hasConfig && !isLoadingConfig && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <AlertCircle className="h-12 w-12 text-amber-500/60" />
              <div>
                <p className="font-semibold">Power BI não configurado</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Vá para a aba <strong>Configurações</strong> e informe as credenciais Azure.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setTab("config")} data-testid="btn-go-config">
                <Settings2 className="h-4 w-4 mr-2" />Configurar agora
              </Button>
            </div>
          )}

          {config?.hasConfig && datasets.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <LayoutGrid className="h-12 w-12 text-muted-foreground/30" />
              <div>
                <p className="font-semibold">Nenhum painel cadastrado</p>
                <p className="text-sm text-muted-foreground mt-1">Adicione datasets na aba Configurações.</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setTab("config")}>
                <Plus className="h-4 w-4 mr-2" />Adicionar painel
              </Button>
            </div>
          )}

          {config?.hasConfig && datasets.length > 0 && (
            <>
              {/* Filter bar */}
              <div className="flex items-center gap-2 mb-4">
                <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground">Filtrar por operação:</span>
                <Select value={filterOperacao || "__all__"} onValueChange={v => setFilterOperacao(v === "__all__" ? "" : v)}>
                  <SelectTrigger className="h-8 w-52 text-xs" data-testid="select-filter-operacao">
                    <SelectValue placeholder="Todas as operações" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todas</SelectItem>
                    {operacoes.map(op => (
                      <SelectItem key={op.id} value={op.name}>{op.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {filterOperacao && (
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setFilterOperacao("")}>
                    <X className="h-3.5 w-3.5 mr-1" />Limpar
                  </Button>
                )}
              </div>

              {isLoadingStatus && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {datasets.map(ds => (
                    <Card key={ds.id}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
                  ))}
                </div>
              )}

              {!isLoadingStatus && filteredStatus.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pb-4">
                  {filteredStatus.map(ds => (
                    <RefreshCard
                      key={ds.id}
                      ds={ds}
                      onManualRefresh={() => manualRefresh(ds)}
                      isRefreshing={refreshingId === ds.id}
                    />
                  ))}
                </div>
              )}

              {!isLoadingStatus && filteredStatus.length === 0 && statusList.length > 0 && (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
                  <Filter className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">Nenhum painel com a operação <strong>{filterOperacao}</strong>.</p>
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => setFilterOperacao("")}>Limpar filtro</Button>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* Agendamentos Tab */}
        <TabsContent value="agendamentos" className="flex-1 overflow-auto mt-4">
          <div className="max-w-4xl space-y-4 pb-6">
            {datasets.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <CalendarClock className="h-12 w-12 text-muted-foreground/30" />
                <p className="font-semibold">Nenhum painel cadastrado</p>
                <p className="text-sm text-muted-foreground">Cadastre datasets na aba Configurações primeiro.</p>
                <Button size="sm" variant="outline" onClick={() => setTab("config")}><Plus className="h-4 w-4 mr-2" />Ir para Configurações</Button>
              </div>
            )}

            {datasets.length > 0 && (
              <>
                {/* Novo agendamento */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-amber-500" />
                      Novo agendamento de refresh
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Dataset */}
                    <div>
                      <Label className="text-xs mb-1.5 block">Painel / Dataset</Label>
                      <Select value={agForm.datasetId || "__none__"} onValueChange={v => setAgForm(f => ({ ...f, datasetId: v === "__none__" ? "" : v }))}>
                        <SelectTrigger className="h-9" data-testid="select-ag-dataset">
                          <SelectValue placeholder="Selecionar painel…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Selecionar painel…</SelectItem>
                          {datasets.map(ds => (
                            <SelectItem key={ds.id} value={ds.id}>{ds.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Tipo */}
                    <div>
                      <Label className="text-xs mb-1.5 block">Recorrência</Label>
                      <div className="flex gap-2">
                        {(["diario", "semanal"] as const).map(t => (
                          <button
                            key={t}
                            onClick={() => setAgForm(f => ({ ...f, tipo: t }))}
                            className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${agForm.tipo === t ? "bg-amber-500/20 border-amber-500/50 text-amber-400 font-medium" : "border-border text-muted-foreground hover:border-amber-500/30"}`}
                            data-testid={`btn-tipo-${t}`}
                          >
                            {t === "diario" ? "Diário" : "Semanal"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Dias da semana (somente semanal) */}
                    {agForm.tipo === "semanal" && (
                      <div>
                        <Label className="text-xs mb-1.5 block">Dias da semana</Label>
                        <div className="flex gap-1.5 flex-wrap">
                          {DIAS_SEMANA.map((d, i) => (
                            <button
                              key={i}
                              onClick={() => setAgForm(f => ({
                                ...f,
                                diasSemana: f.diasSemana.includes(i)
                                  ? f.diasSemana.filter(x => x !== i)
                                  : [...f.diasSemana, i]
                              }))}
                              className={`w-10 h-10 rounded-md text-xs font-medium border transition-colors ${agForm.diasSemana.includes(i) ? "bg-amber-500/20 border-amber-500/50 text-amber-400" : "border-border text-muted-foreground hover:border-amber-500/30"}`}
                              data-testid={`btn-dia-${i}`}
                            >
                              {d}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Horários */}
                    <div>
                      <Label className="text-xs mb-1.5 block">
                        Horários de refresh <span className="text-muted-foreground">(selecione um ou mais)</span>
                      </Label>
                      <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-12 gap-1.5">
                        {HOURS_RANGE.map(h => (
                          <button
                            key={h}
                            onClick={() => setAgForm(f => ({
                              ...f,
                              horariosSel: f.horariosSel.includes(h)
                                ? f.horariosSel.filter(x => x !== h)
                                : [...f.horariosSel, h].sort()
                            }))}
                            className={`py-1.5 rounded-md text-xs font-mono border transition-colors ${agForm.horariosSel.includes(h) ? "bg-amber-500/20 border-amber-500/50 text-amber-400 font-semibold" : "border-border text-muted-foreground hover:border-amber-500/30"}`}
                            data-testid={`btn-hora-${h}`}
                          >
                            {h}
                          </button>
                        ))}
                      </div>
                      {agForm.horariosSel.length > 0 && (
                        <p className="text-xs text-amber-400/80 mt-2 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Selecionados: {agForm.horariosSel.join(", ")}
                        </p>
                      )}
                    </div>

                    <Button
                      size="sm"
                      className="gap-1.5"
                      disabled={!agForm.datasetId || agForm.horariosSel.length === 0 || createAgendamento.isPending}
                      onClick={() => createAgendamento.mutate({
                        datasetId: agForm.datasetId,
                        horarios: agForm.horariosSel,
                        diasSemana: agForm.tipo === "semanal" ? agForm.diasSemana : [],
                        tipo: agForm.tipo,
                        ativo: true,
                      })}
                      data-testid="btn-criar-agendamento"
                    >
                      <Plus className="h-4 w-4" />
                      {createAgendamento.isPending ? "Salvando…" : "Criar agendamento"}
                    </Button>
                  </CardContent>
                </Card>

                {/* Lista de agendamentos */}
                {agendamentos.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <CalendarClock className="h-4 w-4 text-amber-500" />
                        Agendamentos ativos
                        <Badge variant="outline" className="text-xs ml-auto">{agendamentos.length}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {agendamentos.map(ag => {
                        const ds = datasets.find(d => d.id === ag.datasetId);
                        return (
                          <div key={ag.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${ag.ativo ? "bg-muted/10 border-border" : "bg-muted/5 border-border/50 opacity-60"}`}>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium">{ds?.name ?? "Painel removido"}</span>
                                <Badge variant="outline" className={`text-[10px] px-1.5 ${ag.tipo === "diario" ? "border-blue-500/40 text-blue-400" : "border-purple-500/40 text-purple-400"}`}>
                                  {ag.tipo === "diario" ? "Diário" : "Semanal"}
                                </Badge>
                                {ag.tipo === "semanal" && ag.diasSemana.length > 0 && (
                                  <span className="text-[10px] text-muted-foreground">
                                    {ag.diasSemana.sort().map(d => DIAS_SEMANA[d]).join(", ")}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                {ag.horarios.sort().map(h => (
                                  <span key={h} className="text-[11px] font-mono bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded">{h}</span>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                onClick={() => updateAgendamento.mutate({ id: ag.id, updates: { ativo: !ag.ativo } })}
                                className="text-muted-foreground hover:text-amber-400 transition-colors"
                                title={ag.ativo ? "Desativar" : "Ativar"}
                                data-testid={`btn-toggle-ag-${ag.id}`}
                              >
                                {ag.ativo
                                  ? <ToggleRight className="h-5 w-5 text-green-500" />
                                  : <ToggleLeft className="h-5 w-5" />}
                              </button>
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 w-7 p-0 text-red-500 hover:text-red-400"
                                onClick={() => deleteAgendamento.mutate(ag.id)}
                                data-testid={`btn-delete-ag-${ag.id}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                )}

                {agendamentos.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-10 gap-2 text-center text-muted-foreground">
                    <Info className="h-8 w-8 opacity-30" />
                    <p className="text-sm">Nenhum agendamento criado ainda.</p>
                  </div>
                )}
              </>
            )}
          </div>
        </TabsContent>

        {/* Dashboard Tab */}
        <TabsContent value="dashboard" className="flex-1 overflow-auto mt-4">
          <div className="space-y-4 pb-6">
            {/* Alertas de erros */}
            {refreshLogs.filter(l => l.status === "error").length > 0 && (
              <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                <BellRing className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-red-400 mb-2">
                    {refreshLogs.filter(l => l.status === "error").length} erros recentes
                  </p>
                  <div className="space-y-1.5">
                    {refreshLogs.filter(l => l.status === "error").slice(0, 5).map(log => (
                      <div key={log.id} className="text-xs flex items-start gap-2">
                        <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                        <span className="text-red-300/80">
                          <strong>{log.datasetName}</strong> às {log.horario} ({new Date(log.timestamp).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })})
                          {log.errorMessage && <span className="block text-red-400/60 font-mono text-[10px] mt-0.5">{log.errorMessage.slice(0, 150)}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Grade Horário × BI */}
            {datasets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center text-muted-foreground">
                <BarChart3 className="h-12 w-12 opacity-20" />
                <p className="text-sm">Nenhum painel cadastrado. Adicione datasets na aba Configurações.</p>
              </div>
            ) : (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-amber-500" />
                    Grade de horários — Hora × BI
                    <span className="text-xs text-muted-foreground font-normal ml-1">(horário de Brasília)</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-10 bg-background border-b border-r border-border px-3 py-2 text-left font-medium text-muted-foreground min-w-[140px]">
                          Painel
                        </th>
                        {HOURS_RANGE.map(h => (
                          <th key={h} className="border-b border-r border-border px-1 py-2 font-mono text-[10px] text-muted-foreground/70 whitespace-nowrap min-w-[36px] text-center">
                            {h.slice(0, 2)}h
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {datasets.map((ds, rowIdx) => {
                        const ag = agendamentos.find(a => a.datasetId === ds.id);
                        const lastLogByHour = (hour: string) => {
                          const matching = refreshLogs.filter(l => l.datasetId === ds.id && l.horario === hour);
                          return matching[0] ?? null;
                        };
                        return (
                          <tr key={ds.id} className={rowIdx % 2 === 0 ? "bg-muted/5" : ""}>
                            <td className="sticky left-0 z-10 bg-background border-b border-r border-border px-3 py-2">
                              <div className="flex items-center gap-1.5">
                                {ag?.ativo ? (
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                                ) : (
                                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 shrink-0" />
                                )}
                                <span className="font-medium truncate max-w-[120px]" title={ds.name}>{ds.name}</span>
                              </div>
                              {ds.operacao && (
                                <span className="text-[10px] text-amber-500/70 ml-3">{ds.operacao}</span>
                              )}
                            </td>
                            {HOURS_RANGE.map(h => {
                              const isScheduled = ag?.ativo && ag.horarios.includes(h);
                              const isScheduledInactive = !ag?.ativo && ag?.horarios.includes(h);
                              const log = lastLogByHour(h);
                              return (
                                <td key={h} className="border-b border-r border-border px-1 py-1.5 text-center">
                                  {isScheduled && (
                                    <div className="group relative flex justify-center">
                                      <span className={`inline-block w-5 h-5 rounded-full border flex items-center justify-center cursor-default
                                        ${log?.status === "success" ? "bg-green-500/25 border-green-500/60" :
                                          log?.status === "error" ? "bg-red-500/25 border-red-500/60" :
                                          "bg-amber-500/20 border-amber-500/40"}`}>
                                        {log?.status === "success" && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                                        {log?.status === "error" && <XCircle className="h-3 w-3 text-red-500" />}
                                        {!log && <Clock className="h-3 w-3 text-amber-500/70" />}
                                      </span>
                                      {log && (
                                        <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-20 bg-popover border border-border rounded-md p-2 text-[10px] shadow-md whitespace-nowrap">
                                          <p className="font-mono">{new Date(log.timestamp).toLocaleString("pt-BR")}</p>
                                          <p className={log.status === "success" ? "text-green-400" : "text-red-400"}>
                                            {log.status === "success" ? "✓ Sucesso" : "✗ Erro"}
                                          </p>
                                          {log.errorMessage && <p className="text-red-400/70 max-w-[200px] break-words">{log.errorMessage.slice(0, 100)}</p>}
                                          <p className="text-muted-foreground">{log.triggeredBy === "scheduler" ? "Agendador" : "Manual"}</p>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {isScheduledInactive && (
                                    <span className="inline-block w-5 h-5 rounded-full border border-muted-foreground/20 bg-muted/10" />
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {/* Legenda */}
                  <div className="flex items-center gap-4 px-4 py-2.5 border-t border-border text-[11px] text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500" />Sucesso</span>
                    <span className="flex items-center gap-1.5"><XCircle className="h-3 w-3 text-red-500" />Erro</span>
                    <span className="flex items-center gap-1.5"><Clock className="h-3 w-3 text-amber-500/70" />Agendado (sem histórico)</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full border border-muted-foreground/20 inline-block" />Inativo</span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Histórico de execuções */}
            {refreshLogs.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Clock className="h-4 w-4 text-amber-500" />
                    Histórico de atualizações
                    <Badge variant="outline" className="text-xs ml-auto">{refreshLogs.length}</Badge>
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-red-400 ml-1"
                      onClick={() => clearLogs.mutate()}
                      disabled={clearLogs.isPending}
                      data-testid="btn-clear-logs"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />Limpar
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-border max-h-80 overflow-y-auto">
                    {refreshLogs.slice(0, 100).map(log => (
                      <div key={log.id} className="flex items-center gap-3 px-4 py-2">
                        {log.status === "success"
                          ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                          : <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{log.datasetName}</span>
                            <span className="text-[11px] font-mono text-muted-foreground">{log.horario}</span>
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${log.triggeredBy === "scheduler" ? "border-blue-500/30 text-blue-400" : "border-muted-foreground/30"}`}>
                              {log.triggeredBy === "scheduler" ? "Agendador" : "Manual"}
                            </Badge>
                          </div>
                          {log.errorMessage && (
                            <p className="text-[11px] text-red-400/70 font-mono mt-0.5 truncate">{log.errorMessage}</p>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {new Date(log.timestamp).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {refreshLogs.length === 0 && datasets.length > 0 && (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-center text-muted-foreground">
                <Info className="h-8 w-8 opacity-30" />
                <p className="text-sm">Nenhuma execução registrada ainda. O agendador registra automaticamente cada refresh.</p>
              </div>
            )}

            <div className="flex justify-end">
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => { refetchLogs(); }} data-testid="btn-refresh-logs">
                <RefreshCw className="h-3.5 w-3.5" />Atualizar logs
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* Config Tab */}
        <TabsContent value="config" className="flex-1 overflow-auto mt-4">
          <div className="max-w-3xl space-y-6 pb-6">
            {/* Azure Credentials */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Settings2 className="h-4 w-4 text-amber-500" />
                  Credenciais Azure (iguais para todos os painéis)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs mb-1 block">Tenant ID</Label>
                  <Input
                    data-testid="input-tenant-id"
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={configForm.tenantId}
                    onChange={e => setConfigForm(f => ({ ...f, tenantId: e.target.value }))}
                    className="font-mono text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Client ID</Label>
                  <Input
                    data-testid="input-client-id"
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={configForm.clientId}
                    onChange={e => setConfigForm(f => ({ ...f, clientId: e.target.value }))}
                    className="font-mono text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">
                    Client Secret — <span className="text-amber-500 font-normal">use o Valor, não o ID</span>
                    {config?.hasSecret && !configForm.clientSecret && (
                      <span className="ml-2 text-green-500 text-[10px]">✓ salvo</span>
                    )}
                  </Label>
                  <div className="relative">
                    <Input
                      data-testid="input-client-secret"
                      type={showSecret ? "text" : "password"}
                      placeholder={config?.hasSecret ? "••••••••••••••••••••" : "Cole o Valor do segredo (não o ID)"}
                      value={configForm.clientSecret}
                      onChange={e => setConfigForm(f => ({ ...f, clientSecret: e.target.value }))}
                      className="font-mono text-sm pr-10"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowSecret(p => !p)}
                    >
                      {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    No portal Azure → App registrations → Certificados &amp; segredos → coluna <strong>Valor</strong> (não a coluna "ID do segredo").
                  </p>
                </div>
                <Button
                  size="sm"
                  className="mt-1 gap-1.5"
                  onClick={() => saveConfig.mutate()}
                  disabled={saveConfig.isPending}
                  data-testid="btn-save-pbi-config"
                >
                  <Save className="h-4 w-4" />
                  {saveConfig.isPending ? "Salvando…" : "Salvar credenciais"}
                </Button>
              </CardContent>
            </Card>

            {/* Operações */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Tag className="h-4 w-4 text-amber-500" />
                  Operações
                  <Badge variant="outline" className="text-xs ml-auto">{operacoes.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {operacoes.length > 0 && (
                  <div className="space-y-1">
                    {operacoes.map(op => (
                      <div key={op.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors group">
                        <span className="text-sm">{op.name}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-red-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => deleteOperacao.mutate(op.id)}
                          data-testid={`btn-delete-operacao-${op.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                    <Separator className="my-2" />
                  </div>
                )}
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Label className="text-xs mb-1 block">Nova operação</Label>
                    <Input
                      data-testid="input-new-operacao"
                      placeholder="Ex: Comercial, Financeiro…"
                      value={newOperacaoName}
                      onChange={e => setNewOperacaoName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && newOperacaoName.trim()) addOperacao.mutate(newOperacaoName); }}
                      className="h-8 text-sm"
                    />
                  </div>
                  <Button
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => { if (newOperacaoName.trim()) addOperacao.mutate(newOperacaoName); }}
                    disabled={!newOperacaoName.trim() || addOperacao.isPending}
                    data-testid="btn-add-operacao"
                  >
                    <Plus className="h-4 w-4" />Criar
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Datasets */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <LayoutGrid className="h-4 w-4 text-amber-500" />
                  Painéis / Datasets
                  <Badge variant="outline" className="text-xs ml-auto">{datasets.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {datasets.length > 0 && (
                  <div className="space-y-2">
                    {datasets.map(ds => (
                      <div key={ds.id}>
                        {editingId === ds.id ? (
                          <div className="space-y-2 p-3 bg-muted/30 rounded-lg border">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-sm" placeholder="Nome" data-testid={`input-edit-name-${ds.id}`} />
                              <Input value={editForm.groupId} onChange={e => setEditForm(f => ({ ...f, groupId: e.target.value }))} className="h-8 text-sm font-mono" placeholder="Group ID" data-testid={`input-edit-groupid-${ds.id}`} />
                              <Input value={editForm.datasetId} onChange={e => setEditForm(f => ({ ...f, datasetId: e.target.value }))} className="h-8 text-sm font-mono" placeholder="Dataset ID" data-testid={`input-edit-datasetid-${ds.id}`} />
                            </div>
                            <div className="flex gap-2 items-center">
                              <div className="w-52">
                                <Select value={editForm.operacao} onValueChange={v => setEditForm(f => ({ ...f, operacao: v }))}>
                                  <SelectTrigger className="h-8 text-sm" data-testid={`select-edit-operacao-${ds.id}`}>
                                    <SelectValue placeholder="Selecionar operação…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">Nenhuma</SelectItem>
                                    {operacoes.map(op => (
                                      <SelectItem key={op.id} value={op.name}>{op.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex gap-1 ml-auto">
                                <Button size="sm" className="h-8 w-8 p-0" onClick={() => updateDataset.mutate({ id: ds.id, updates: { ...editForm, operacao: editForm.operacao || undefined } })} data-testid={`btn-save-edit-${ds.id}`}>
                                  <Save className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setEditingId(null)}>
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors group">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium truncate">{ds.name}</p>
                                {ds.operacao && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 text-amber-500/80 shrink-0">
                                    {ds.operacao}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-[10px] text-muted-foreground font-mono">
                                G: {ds.groupId.slice(0, 12)}… · D: {ds.datasetId.slice(0, 12)}…
                              </p>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                title={ds.gerenciadoPorAutoTarefa ? "Gerenciado por Auto-Tarefa — clique para desativar" : "Definir como gerenciado por Auto-Tarefa"}
                                onClick={() => updateDataset.mutate({ id: ds.id, updates: { gerenciadoPorAutoTarefa: !ds.gerenciadoPorAutoTarefa } })}
                                data-testid={`btn-toggle-auto-tarefa-${ds.id}`}
                                className={`h-7 px-2 text-xs rounded border transition-colors ${ds.gerenciadoPorAutoTarefa ? "border-blue-500/50 text-blue-400 bg-blue-500/10 hover:bg-blue-500/20" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground"}`}
                              >
                                🔗 Auto
                              </button>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => {
                                setEditingId(ds.id);
                                setEditForm({ name: ds.name, groupId: ds.groupId, datasetId: ds.datasetId, operacao: ds.operacao || "" });
                              }} data-testid={`btn-edit-${ds.id}`}>
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-400" onClick={() => deleteDataset.mutate(ds.id)} data-testid={`btn-delete-${ds.id}`}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    <Separator className="my-3" />
                  </div>
                )}

                <DatasetFormRow onAdd={d => addDataset.mutate(d)} operacoes={operacoes} />
                <p className="text-xs text-muted-foreground">
                  Encontre o <strong>Group ID</strong> (Workspace ID) e <strong>Dataset ID</strong> na URL do Power BI:
                  <code className="ml-1 text-[10px] bg-muted px-1.5 py-0.5 rounded">
                    app.powerbi.com/groups/<span className="text-amber-500">&#123;groupId&#125;</span>/datasets/<span className="text-amber-500">&#123;datasetId&#125;</span>
                  </code>
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

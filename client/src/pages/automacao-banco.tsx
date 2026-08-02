import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DatabaseZap, Plus, Pencil, Trash2, Play, RefreshCw, CheckCircle2,
  AlertCircle, Clock, Loader2, ShieldAlert, Database, Table2,
  Settings2, ScrollText, ChevronDown, ChevronRight, XCircle, Activity, Search,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface DbAutoConfig {
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

interface DbAutoLog {
  id: string;
  configId: string;
  tableKey: string;
  timestamp: string;
  tipo: "check_ok" | "check_stale" | "fix_triggered" | "fix_ok" | "fix_error";
  mensagem: string;
  duracao?: number;
}

function statusBadge(status: DbAutoConfig["ultimoStatus"]) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    ok: { label: "OK", cls: "text-green-400 border-green-500/30 bg-green-500/10", icon: <CheckCircle2 className="h-3 w-3" /> },
    stale: { label: "Desatualizado", cls: "text-yellow-400 border-yellow-500/30 bg-yellow-500/10", icon: <AlertCircle className="h-3 w-3" /> },
    running_fix: { label: "Executando…", cls: "text-blue-400 border-blue-500/30 bg-blue-500/10", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    error: { label: "Erro", cls: "text-red-400 border-red-500/30 bg-red-500/10", icon: <XCircle className="h-3 w-3" /> },
    unknown: { label: "Aguardando", cls: "text-muted-foreground border-border", icon: <Clock className="h-3 w-3" /> },
  };
  const s = map[status] ?? map.unknown;
  return (
    <Badge variant="outline" className={`flex items-center gap-1 text-xs ${s.cls}`}>
      {s.icon}{s.label}
    </Badge>
  );
}

function logTypeBadge(tipo: DbAutoLog["tipo"]) {
  const map: Record<string, { label: string; cls: string }> = {
    check_ok: { label: "OK", cls: "text-green-400 border-green-500/30" },
    check_stale: { label: "Desatualizado", cls: "text-yellow-400 border-yellow-500/30" },
    fix_triggered: { label: "EXE disparado", cls: "text-blue-400 border-blue-500/30" },
    fix_ok: { label: "EXE OK", cls: "text-green-400 border-green-500/30" },
    fix_error: { label: "EXE Erro", cls: "text-red-400 border-red-500/30" },
  };
  const s = map[tipo] ?? { label: tipo, cls: "" };
  return <Badge variant="outline" className={`text-xs ${s.cls}`}>{s.label}</Badge>;
}

function relTime(ts?: string) {
  if (!ts) return "—";
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true, locale: ptBR }); }
  catch { return ts; }
}

// ─── Config Form ─────────────────────────────────────────────────────────────

function ConfigForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Partial<DbAutoConfig>;
  onSave: (v: Omit<DbAutoConfig, "id" | "criadoEm" | "ultimoStatus" | "ultimaVerificacao" | "ultimaAtualizacaoTabela" | "ultimoErro">) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [nome, setNome] = useState(initial?.nome ?? "");
  const [database, setDatabase] = useState(initial?.database ?? "");
  const [dbFetchKey, setDbFetchKey] = useState(initial?.database ?? "");
  const [tableKey, setTableKey] = useState(
    initial?.schema && initial?.table ? `${initial.schema}.${initial.table}` : ""
  );
  const [tsCol, setTsCol] = useState(initial?.timestampColumn ?? "");
  const [limiar, setLimiar] = useState(String(initial?.limiarMinutos ?? 120));
  const [exeUrl, setExeUrl] = useState(initial?.exeUrl ?? "");
  const [ativo, setAtivo] = useState(initial?.ativo ?? true);

  const { data: allTables = [], isFetching: loadingTables, isError: tablesError } = useQuery<
    { schema: string; name: string; kind: string }[]
  >({
    queryKey: ["/api/db-all-tables", dbFetchKey],
    queryFn: async () => {
      const res = await fetch(`/api/db-all-tables?database=${encodeURIComponent(dbFetchKey)}`);
      if (!res.ok) throw new Error("Erro ao carregar tabelas");
      return res.json();
    },
    enabled: !!dbFetchKey,
    retry: false,
  });

  const schema = tableKey.includes(".") ? tableKey.split(".")[0] : "";
  const table = tableKey.includes(".") ? tableKey.split(".").slice(1).join(".") : "";

  const { data: columns = [], isFetching: loadingCols } = useQuery<
    { column_name: string; data_type: string }[]
  >({
    queryKey: ["/api/db-table-columns", dbFetchKey, schema, table],
    queryFn: async () => {
      const res = await fetch(
        `/api/db-table-columns?database=${encodeURIComponent(dbFetchKey)}&schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}`
      );
      if (!res.ok) throw new Error("Erro ao carregar colunas");
      return res.json();
    },
    enabled: !!(dbFetchKey && schema && table),
    retry: false,
  });

  const handleLoadTables = () => {
    setDbFetchKey(database);
    setTableKey("");
    setTsCol("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!schema || !table || !tsCol) return;
    onSave({ nome, database, schema, table, timestampColumn: tsCol, limiarMinutos: Number(limiar), exeUrl, ativo });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>Nome da configuração</Label>
        <Input
          value={nome}
          onChange={e => setNome(e.target.value)}
          placeholder="Ex: Monitor COGNA – Ibridge"
          required
          data-testid="input-config-nome"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Banco de dados</Label>
        <div className="flex gap-2">
          <Input
            value={database}
            onChange={e => setDatabase(e.target.value)}
            placeholder="Ex: COGNA, FMU, PRODUCAO"
            required
            data-testid="input-config-database"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={handleLoadTables}
            disabled={!database || loadingTables}
            data-testid="btn-load-tables"
          >
            {loadingTables
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Search className="h-3.5 w-3.5" />}
            Carregar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Digite o nome do banco e clique em <strong>Carregar</strong> para listar as tabelas.
        </p>
        {tablesError && (
          <p className="text-xs text-red-400">Não foi possível conectar ao banco. Verifique o nome e as configurações de conexão.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Tabela</Label>
        <select
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm disabled:opacity-50"
          value={tableKey}
          onChange={e => { setTableKey(e.target.value); setTsCol(""); }}
          required
          disabled={allTables.length === 0}
          data-testid="select-config-table"
        >
          <option value="">
            {loadingTables
              ? "Carregando tabelas…"
              : allTables.length === 0
              ? "— carregue o banco primeiro —"
              : "— selecione a tabela —"}
          </option>
          {allTables.map(t => (
            <option key={`${t.schema}.${t.name}`} value={`${t.schema}.${t.name}`}>
              {t.schema}.{t.name}
              {t.kind === "matview" ? " (matview)" : t.kind === "view" ? " (view)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label>Coluna de data/hora</Label>
        <select
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm disabled:opacity-50"
          value={tsCol}
          onChange={e => setTsCol(e.target.value)}
          required
          disabled={columns.length === 0}
          data-testid="select-config-tsCol"
        >
          <option value="">
            {loadingCols
              ? "Carregando colunas…"
              : columns.length === 0
              ? "— selecione a tabela primeiro —"
              : "— selecione a coluna —"}
          </option>
          {columns.map(c => (
            <option key={c.column_name} value={c.column_name}>
              {c.column_name} ({c.data_type})
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Coluna usada para detectar quando a tabela foi atualizada pela última vez.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Limiar (minutos)</Label>
          <Input
            type="number"
            min={1}
            value={limiar}
            onChange={e => setLimiar(e.target.value)}
            required
            data-testid="input-config-limiar"
          />
          <p className="text-xs text-muted-foreground">
            Se a tabela ficar sem atualizar por esse tempo, dispara o EXE.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Ativo</Label>
          <div className="flex items-center gap-2 h-9">
            <Switch
              checked={ativo}
              onCheckedChange={setAtivo}
              id="config-ativo"
              data-testid="switch-config-ativo"
            />
            <Label htmlFor="config-ativo" className="text-sm font-normal cursor-pointer">
              Monitor ativo
            </Label>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>URL do EXE</Label>
        <Input
          value={exeUrl}
          onChange={e => setExeUrl(e.target.value)}
          placeholder="http://192.168.0.10:8080/run"
          required
          data-testid="input-config-exeUrl"
        />
        <p className="text-xs text-muted-foreground">
          Endpoint HTTP chamado via POST quando a tabela estiver desatualizada.
        </p>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button
          type="submit"
          disabled={saving || !schema || !table || !tsCol}
          data-testid="btn-config-salvar"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Salvar
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AutomacaoBanco() {
  const { toast } = useToast();
  const [tab, setTab] = useState("dashboard");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<DbAutoConfig | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clearLogsConfirm, setClearLogsConfirm] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  const { data: configs = [], isLoading: isLoadingConfigs } = useQuery<DbAutoConfig[]>({
    queryKey: ["/api/db-auto-configs"],
    refetchInterval: 15000,
  });

  const { data: logs = [], isLoading: isLoadingLogs, refetch: refetchLogs } = useQuery<DbAutoLog[]>({
    queryKey: ["/api/db-auto-logs"],
    refetchInterval: 30000,
  });

  const createConfig = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/db-auto-configs", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/db-auto-configs"] });
      setDialogOpen(false);
      toast({ title: "Monitor criado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const updateConfig = useMutation({
    mutationFn: ({ id, ...body }: any) => apiRequest("PUT", `/api/db-auto-configs/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/db-auto-configs"] });
      setDialogOpen(false);
      setEditingConfig(null);
      toast({ title: "Monitor atualizado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteConfig = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/db-auto-configs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/db-auto-configs"] });
      setDeletingId(null);
      toast({ title: "Monitor removido" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const toggleConfig = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      apiRequest("PUT", `/api/db-auto-configs/${id}`, { ativo }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/db-auto-configs"] }),
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const runNow = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/db-auto-run-now/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/db-auto-configs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/db-auto-logs"] });
      toast({ title: "EXE disparado" });
    },
    onError: (e: any) => toast({ title: "Erro ao disparar", description: e.message, variant: "destructive" }),
  });

  const clearLogs = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/db-auto-logs"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/db-auto-logs"] });
      setClearLogsConfirm(false);
      toast({ title: "Logs apagados" });
    },
  });

  const statsOk = configs.filter(c => c.ultimoStatus === "ok").length;
  const statsStale = configs.filter(c => c.ultimoStatus === "stale").length;
  const statsError = configs.filter(c => c.ultimoStatus === "error").length;
  const statsRunning = configs.filter(c => c.ultimoStatus === "running_fix").length;

  return (
    <div className="flex flex-col h-full overflow-hidden p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <DatabaseZap className="h-5 w-5 text-blue-400" />
          <h1 className="text-lg font-semibold">Automação Banco</h1>
          <Badge variant="outline" className="text-xs">Watchdog</Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Activity className="h-3.5 w-3.5" />
          Verificação a cada 5 min
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0">
        {[
          { label: "Total", value: configs.length, icon: Database, cls: "text-muted-foreground" },
          { label: "OK", value: statsOk, icon: CheckCircle2, cls: "text-green-400" },
          { label: "Desatualizado", value: statsStale, icon: AlertCircle, cls: "text-yellow-400" },
          { label: "Erro / Exec.", value: statsError + statsRunning, icon: ShieldAlert, cls: "text-red-400" },
        ].map(s => (
          <Card key={s.label} className="py-3 px-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{s.label}</span>
              <s.icon className={`h-4 w-4 ${s.cls}`} />
            </div>
            <div className={`text-2xl font-bold mt-1 ${s.cls}`}>{s.value}</div>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 overflow-hidden flex flex-col">
        <TabsList className="shrink-0 w-fit">
          <TabsTrigger value="dashboard" data-testid="tab-autobd-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="configuracoes" data-testid="tab-autobd-configuracoes">Configurações</TabsTrigger>
          <TabsTrigger value="logs" data-testid="tab-autobd-logs">
            Logs
            {logs.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] py-0 px-1.5 h-4">{logs.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Dashboard ── */}
        <TabsContent value="dashboard" className="flex-1 overflow-hidden mt-4">
          <ScrollArea className="h-full pr-2">
            {isLoadingConfigs && (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
              </div>
            )}
            {!isLoadingConfigs && configs.length === 0 && (
              <div className="text-center py-16 text-muted-foreground">
                <DatabaseZap className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Nenhum monitor configurado</p>
                <p className="text-xs mt-1">
                  Crie um monitor na aba <strong>Configurações</strong>.
                </p>
              </div>
            )}
            {configs.length > 0 && (
              <div className="space-y-2 pb-4">
                {configs.map(c => (
                  <Card
                    key={c.id}
                    className={`transition-colors ${!c.ativo ? "opacity-50" : ""}`}
                    data-testid={`card-monitor-${c.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{c.nome}</span>
                            {statusBadge(c.ultimoStatus)}
                            {!c.ativo && (
                              <Badge variant="outline" className="text-xs text-muted-foreground">Inativo</Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Database className="h-3 w-3" />{c.database}
                            </span>
                            <span className="flex items-center gap-1">
                              <Table2 className="h-3 w-3" />{c.schema}.{c.table}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />Limiar: {c.limiarMinutos} min
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                            {c.ultimaVerificacao && (
                              <span>Verificado {relTime(c.ultimaVerificacao)}</span>
                            )}
                            {c.ultimaAtualizacaoTabela && (
                              <span>Dado: {relTime(c.ultimaAtualizacaoTabela)}</span>
                            )}
                            {c.ultimoErro && (
                              <span
                                className="text-red-400 truncate max-w-xs"
                                title={c.ultimoErro}
                              >{c.ultimoErro}</span>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 text-xs shrink-0"
                          disabled={runNow.isPending || c.ultimoStatus === "running_fix"}
                          onClick={() => runNow.mutate(c.id)}
                          data-testid={`btn-run-now-${c.id}`}
                        >
                          {c.ultimoStatus === "running_fix"
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Play className="h-3 w-3" />}
                          Executar agora
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        {/* ── Configurações ── */}
        <TabsContent value="configuracoes" className="flex-1 overflow-hidden mt-4">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <span className="text-sm text-muted-foreground">{configs.length} monitor(es)</span>
            <Button
              size="sm"
              className="gap-1.5 text-xs h-8"
              onClick={() => { setEditingConfig(null); setDialogOpen(true); }}
              data-testid="btn-add-config"
            >
              <Plus className="h-3.5 w-3.5" />
              Novo Monitor
            </Button>
          </div>
          <ScrollArea className="h-[calc(100%-44px)] pr-2">
            {isLoadingConfigs && <Skeleton className="h-20 w-full rounded-lg" />}
            {configs.length === 0 && !isLoadingConfigs && (
              <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
                <Settings2 className="h-8 w-8 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Nenhum monitor criado</p>
                <p className="text-xs mt-1">Clique em <strong>Novo Monitor</strong> para começar.</p>
              </div>
            )}
            {configs.map(c => (
              <Card
                key={c.id}
                className={`mb-3 ${!c.ativo ? "opacity-60" : ""}`}
                data-testid={`card-config-${c.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Switch
                      checked={c.ativo}
                      onCheckedChange={v => toggleConfig.mutate({ id: c.id, ativo: v })}
                      className="mt-0.5 shrink-0"
                      data-testid={`switch-config-toggle-${c.id}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{c.nome}</span>
                        <Badge variant="outline" className="text-xs">{c.database}</Badge>
                        {statusBadge(c.ultimoStatus)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                        <span className="font-mono">{c.schema}.{c.table}</span>
                        <span>coluna: <strong className="text-foreground/70">{c.timestampColumn}</strong></span>
                        <span>limiar: <strong className="text-foreground/70">{c.limiarMinutos} min</strong></span>
                      </div>
                      <div
                        className="text-xs text-muted-foreground/70 mt-0.5 truncate"
                        title={c.exeUrl}
                      >
                        EXE: {c.exeUrl}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => { setEditingConfig(c); setDialogOpen(true); }}
                        data-testid={`btn-edit-config-${c.id}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-400 hover:text-red-300"
                        onClick={() => setDeletingId(c.id)}
                        data-testid={`btn-delete-config-${c.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </ScrollArea>
        </TabsContent>

        {/* ── Logs ── */}
        <TabsContent value="logs" className="flex-1 overflow-hidden mt-4">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <span className="text-sm text-muted-foreground">{logs.length} evento(s)</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs h-8"
                onClick={() => refetchLogs()}
                data-testid="btn-refresh-logs"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Atualizar
              </Button>
              {logs.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs h-8 text-red-400 border-red-500/30 hover:bg-red-500/10"
                  onClick={() => setClearLogsConfirm(true)}
                  data-testid="btn-clear-logs"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Limpar
                </Button>
              )}
            </div>
          </div>
          <ScrollArea className="h-[calc(100%-44px)] pr-2">
            {isLoadingLogs && (
              <div className="space-y-1.5">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full rounded-md" />)}
              </div>
            )}
            {logs.length === 0 && !isLoadingLogs && (
              <div className="text-center py-12 text-muted-foreground">
                <ScrollText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Nenhum log registrado</p>
              </div>
            )}
            {logs.length > 0 && (
              <div className="space-y-1 pb-4 font-mono text-xs">
                {logs.map(log => {
                  const expanded = expandedLogs.has(log.id);
                  const configName = configs.find(c => c.id === log.configId)?.nome ?? log.configId;
                  return (
                    <div
                      key={log.id}
                      className="border border-border/50 rounded-md overflow-hidden"
                      data-testid={`log-entry-${log.id}`}
                    >
                      <button
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/30 text-left transition-colors"
                        onClick={() => setExpandedLogs(prev => {
                          const next = new Set(prev);
                          next.has(log.id) ? next.delete(log.id) : next.add(log.id);
                          return next;
                        })}
                      >
                        {expanded
                          ? <ChevronDown className="h-3 w-3 shrink-0" />
                          : <ChevronRight className="h-3 w-3 shrink-0" />}
                        <span className="text-muted-foreground shrink-0 w-32">
                          {new Date(log.timestamp).toLocaleString("pt-BR", { hour12: false, dateStyle: "short", timeStyle: "medium" })}
                        </span>
                        {logTypeBadge(log.tipo)}
                        <span className="font-semibold shrink-0">{log.tableKey}</span>
                        <span className="text-muted-foreground truncate">{log.mensagem}</span>
                        {log.duracao !== undefined && (
                          <span className="text-muted-foreground shrink-0 ml-auto">{log.duracao}ms</span>
                        )}
                      </button>
                      {expanded && (
                        <div className="px-4 py-2 border-t border-border/50 bg-muted/20 text-xs text-muted-foreground whitespace-pre-wrap break-all">
                          {log.mensagem}
                          <div className="mt-1 text-muted-foreground/60">Config: {configName}</div>
                          {log.duracao !== undefined && (
                            <div className="text-muted-foreground/40">Duração: {log.duracao}ms</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* ── Config Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={v => { setDialogOpen(v); if (!v) setEditingConfig(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingConfig ? "Editar Monitor" : "Novo Monitor"}</DialogTitle>
          </DialogHeader>
          <ConfigForm
            initial={editingConfig ?? undefined}
            saving={createConfig.isPending || updateConfig.isPending}
            onCancel={() => { setDialogOpen(false); setEditingConfig(null); }}
            onSave={v => {
              if (editingConfig) updateConfig.mutate({ id: editingConfig.id, ...v });
              else createConfig.mutate(v);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ── */}
      <AlertDialog open={!!deletingId} onOpenChange={v => !v && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover monitor?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deletingId && deleteConfig.mutate(deletingId)}
              data-testid="btn-confirm-delete"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Clear Logs Confirm ── */}
      <AlertDialog open={clearLogsConfirm} onOpenChange={setClearLogsConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Limpar todos os logs?</AlertDialogTitle>
            <AlertDialogDescription>
              O histórico de execuções será apagado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => clearLogs.mutate()}
              data-testid="btn-confirm-clear-logs"
            >
              Limpar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

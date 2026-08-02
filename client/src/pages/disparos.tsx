import { useState, useRef, useEffect } from "react";
import { UploadBaseCognaDialog } from "@/components/upload-base-cogna-dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Command, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Send, Plus, Search, StopCircle, RefreshCw, Trash2, Clock,
  Upload, FileText, AlertCircle, CheckCircle2, Loader2,
  ChevronDown, ChevronUp, Play, Eye, Calendar, Info,
  BarChart2, X, Radio, Layout, Settings2, Download, Database,
  ChevronsUpDown, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  DISPARO_COLUNAS_OBRIGATORIAS, DISPARO_TEMPLATE_COLUNAS, DISPARO_STATUS,
  type Disparo, type DisparoCanal, type DisparoTemplate,
  type MetaOperacao, type MetaPhoneNumber, type MetaTemplate,
} from "@shared/schema";

// ── helpers ────────────────────────────────────────────────────────────────

function todayBR() {
  const now = new Date();
  const brOffset = -3 * 60;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const br = new Date(utcMs + brOffset * 60000);
  return `${br.getFullYear()}-${String(br.getMonth() + 1).padStart(2, "0")}-${String(br.getDate()).padStart(2, "0")}`;
}

function statusColor(status: Disparo["status"]) {
  const map: Record<string, string> = {
    agendado: "bg-blue-500/15 text-blue-600 border-blue-300 dark:text-blue-400",
    executando: "bg-amber-500/15 text-amber-600 border-amber-300 dark:text-amber-400",
    concluido: "bg-green-500/15 text-green-600 border-green-300 dark:text-green-400",
    parado: "bg-gray-500/15 text-gray-600 border-gray-300 dark:text-gray-400",
    erro: "bg-red-500/15 text-red-600 border-red-300 dark:text-red-400",
  };
  return map[status] || map.agendado;
}

function statusIcon(status: Disparo["status"]) {
  if (status === "agendado") return <Clock className="h-3 w-3" />;
  if (status === "executando") return <Loader2 className="h-3 w-3 animate-spin" />;
  if (status === "concluido") return <CheckCircle2 className="h-3 w-3" />;
  if (status === "parado") return <StopCircle className="h-3 w-3" />;
  return <AlertCircle className="h-3 w-3" />;
}

function fmtDate(ymd: string) {
  try { return format(parseISO(ymd), "dd/MM/yyyy", { locale: ptBR }); } catch { return ymd; }
}

function fmtTs(ts?: number) {
  if (!ts) return "—";
  return format(new Date(ts), "dd/MM HH:mm:ss", { locale: ptBR });
}

type DisparoSafe = Omit<Disparo, "arquivoConteudo"> & { arquivoConteudo?: string };

// ── Main Component ─────────────────────────────────────────────────────────

export default function Disparos() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedDate, setSelectedDate] = useState(todayBR());
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"lista" | "cronograma" | "canais">("lista");
  const [showCreate, setShowCreate] = useState(false);
  const [showUploadBase, setShowUploadBase] = useState(false);
  const [logsDialogId, setLogsDialogId] = useState<string | null>(null);
  const [reagendarId, setReagendarId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── queries ──────────────────────────────────────────────────────────────

  const { data: disparos = [], isLoading } = useQuery<DisparoSafe[]>({
    queryKey: ["/api/disparos", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/disparos?data=${selectedDate}`);
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: canais = [] } = useQuery<DisparoCanal[]>({
    queryKey: ["/api/disparo-canais"],
  });

  const { data: templates = [] } = useQuery<DisparoTemplate[]>({
    queryKey: ["/api/disparo-templates"],
  });

  const { data: metaTemplatesAll = [] } = useQuery<MetaTemplate[]>({
    queryKey: ["/api/meta/templates"],
    staleTime: 0,
  });

  const { data: cronograma } = useQuery<{ data: string; cronograma: Record<string, DisparoSafe[]> }>({
    queryKey: ["/api/disparos/cronograma", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/disparos/cronograma/${selectedDate}`);
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: logsData, refetch: refetchLogs } = useQuery({
    queryKey: ["/api/disparos/logs", logsDialogId],
    queryFn: async () => {
      if (!logsDialogId) return null;
      const res = await fetch(`/api/disparos/${logsDialogId}/logs`);
      return res.json();
    },
    enabled: !!logsDialogId,
    refetchInterval: logsDialogId ? 2000 : false,
  });

  // ── mutations ─────────────────────────────────────────────────────────────

  const invalidateDisparos = () => {
    queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith("/api/disparos") });
  };

  const pararMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/disparos/${id}/parar`),
    onSuccess: () => { toast({ title: "Disparo parado" }); invalidateDisparos(); },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const dispararMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/disparos/${id}/disparar`),
    onSuccess: () => { toast({ title: "Disparo iniciado!" }); invalidateDisparos(); },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deletarMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/disparos/${id}`),
    onSuccess: () => { toast({ title: "Disparo removido" }); invalidateDisparos(); },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  // ── filtered list ─────────────────────────────────────────────────────────

  const filtered = disparos.filter(d =>
    !search || d.nome.toLowerCase().includes(search.toLowerCase()) ||
    d.descricao?.toLowerCase().includes(search.toLowerCase())
  );

  // ── stats ─────────────────────────────────────────────────────────────────

  const stats = {
    total: disparos.length,
    agendados: disparos.filter(d => d.status === "agendado").length,
    executando: disparos.filter(d => d.status === "executando").length,
    concluidos: disparos.filter(d => d.status === "concluido").length,
    erros: disparos.filter(d => d.status === "erro").length,
  };

  const getCanalNome = (id?: string) => id ? (canais.find(c => c.id === id)?.nome ?? "—") : "—";
  const getTemplateNome = (id?: string) => id ? (templates.find(t => t.id === id)?.nome ?? "—") : "—";
  const getMetaTemplateNome = (id?: string) => id ? (metaTemplatesAll.find(t => t.id === id)?.name ?? id) : "—";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b bg-background/95 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Send className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Disparos</h1>
            <p className="text-xs text-muted-foreground">Agendador de campanhas via API</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="w-40"
            data-testid="input-date-filter"
          />
          <Button variant="outline" onClick={() => setShowUploadBase(true)}>
            <Upload className="h-4 w-4 mr-2" /> Subir base
          </Button>
          <Button onClick={() => setShowCreate(true)} data-testid="button-novo-disparo">
            <Plus className="h-4 w-4 mr-2" /> Novo Disparo
          </Button>
        </div>
      </header>

      {/* Stats bar */}
      <div className="flex gap-3 px-4 py-2 border-b bg-muted/30 flex-wrap">
        <StatPill label="Total" value={stats.total} color="text-foreground" />
        <StatPill label="Agendados" value={stats.agendados} color="text-blue-500" />
        <StatPill label="Executando" value={stats.executando} color="text-amber-500" />
        <StatPill label="Concluídos" value={stats.concluidos} color="text-green-500" />
        <StatPill label="Erros" value={stats.erros} color="text-red-500" />
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Radio className="h-3 w-3" /> {canais.length} canais
          <Layout className="h-3 w-3 ml-2" /> {templates.length} templates
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as typeof activeTab)} className="flex flex-col flex-1 overflow-hidden">
        <div className="flex items-center gap-3 px-4 pt-3 pb-0">
          <TabsList>
            <TabsTrigger value="lista" data-testid="tab-lista">
              <BarChart2 className="h-4 w-4 mr-1" /> Lista
            </TabsTrigger>
            <TabsTrigger value="cronograma" data-testid="tab-cronograma">
              <Calendar className="h-4 w-4 mr-1" /> Cronograma
            </TabsTrigger>
            <TabsTrigger value="canais" data-testid="tab-canais">
              <Settings2 className="h-4 w-4 mr-1" /> Canais & Templates
            </TabsTrigger>
          </TabsList>
          {activeTab !== "canais" && (
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Pesquisar disparo..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                data-testid="input-search"
              />
            </div>
          )}
          {activeTab !== "canais" && <ColunasInfoPopover />}
        </div>

        {/* Lista Tab */}
        <TabsContent value="lista" className="flex-1 overflow-auto p-4 mt-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState date={selectedDate} onNew={() => setShowCreate(true)} />
          ) : (
            <div className="space-y-3">
              {filtered.map(d => (
                <DisparoCard
                  key={d.id}
                  disparo={d}
                  expanded={expandedId === d.id}
                  canalNome={getCanalNome(d.canalId)}
                  templateNome={d.metaTemplateId ? getMetaTemplateNome(d.metaTemplateId) : getTemplateNome(d.templateId)}
                  onToggle={() => setExpandedId(expandedId === d.id ? null : d.id)}
                  onParar={() => pararMutation.mutate(d.id)}
                  onDisparar={() => dispararMutation.mutate(d.id)}
                  onDeletar={() => deletarMutation.mutate(d.id)}
                  onLogs={() => setLogsDialogId(d.id)}
                  onReagendar={() => setReagendarId(d.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Cronograma Tab */}
        <TabsContent value="cronograma" className="flex-1 overflow-auto p-4 mt-0">
          <CronogramaView
            data={selectedDate}
            cronograma={cronograma?.cronograma ?? {}}
            onParar={id => pararMutation.mutate(id)}
            onDisparar={id => dispararMutation.mutate(id)}
            onLogs={id => setLogsDialogId(id)}
          />
        </TabsContent>

        {/* Canais & Templates Tab */}
        <TabsContent value="canais" className="flex-1 overflow-auto p-4 mt-0">
          <CanaisTemplatesManager
            canais={canais}
            templates={templates}
            onRefresh={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/disparo-canais"] });
              queryClient.invalidateQueries({ queryKey: ["/api/disparo-templates"] });
            }}
          />
        </TabsContent>
      </Tabs>

      {/* Upload Base COGNA Dialog */}
      <UploadBaseCognaDialog
        open={showUploadBase}
        onClose={() => setShowUploadBase(false)}
      />

      {/* Create Dialog */}
      {showCreate && (
        <CreateDisparoDialog
          canais={canais}
          templates={templates}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); invalidateDisparos(); }}
        />
      )}

      {/* Logs Dialog */}
      {logsDialogId && (
        <LogsDialog
          disparo={disparos.find(d => d.id === logsDialogId)}
          logsData={logsData}
          onClose={() => setLogsDialogId(null)}
          onRefresh={() => refetchLogs()}
        />
      )}

      {/* Reagendar Dialog */}
      {reagendarId && (
        <ReagendarDialog
          disparo={disparos.find(d => d.id === reagendarId)!}
          onClose={() => setReagendarId(null)}
          onDone={() => { setReagendarId(null); invalidateDisparos(); }}
        />
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <span className="text-muted-foreground">{label}:</span>
      <span className={`font-bold ${color}`}>{value}</span>
    </div>
  );
}

function EmptyState({ date, onNew }: { date: string; onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted-foreground">
      <Send className="h-12 w-12 opacity-20" />
      <div className="text-center">
        <p className="font-medium">Nenhum disparo para {fmtDate(date)}</p>
        <p className="text-sm mt-1">Crie um novo disparo para começar</p>
      </div>
      <Button variant="outline" onClick={onNew}>
        <Plus className="h-4 w-4 mr-2" /> Criar Disparo
      </Button>
    </div>
  );
}

function DisparoCard({
  disparo, expanded, canalNome, templateNome,
  onToggle, onParar, onDisparar, onDeletar, onLogs, onReagendar,
}: {
  disparo: DisparoSafe;
  expanded: boolean;
  canalNome: string;
  templateNome: string;
  onToggle: () => void;
  onParar: () => void;
  onDisparar: () => void;
  onDeletar: () => void;
  onLogs: () => void;
  onReagendar: () => void;
}) {
  const progress = disparo.totalRegistros > 0
    ? Math.round((disparo.processados / disparo.totalRegistros) * 100)
    : 0;

  return (
    <Card className="border transition-shadow hover:shadow-md" data-testid={`card-disparo-${disparo.id}`}>
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`h-8 w-8 rounded-full flex items-center justify-center border ${statusColor(disparo.status)} shrink-0`}>
              {statusIcon(disparo.status)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold truncate">{disparo.nome}</span>
                <Badge className={`text-xs border ${statusColor(disparo.status)} gap-1`} variant="outline">
                  {statusIcon(disparo.status)}
                  {DISPARO_STATUS[disparo.status]}
                </Badge>
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                {disparo.canalId && (
                  <span className="flex items-center gap-1">
                    <Radio className="h-3 w-3" /> {canalNome}
                  </span>
                )}
                {(disparo.metaTemplateId || disparo.templateId) && (
                  <span className="flex items-center gap-1">
                    <Layout className="h-3 w-3" />
                    {disparo.metaTemplateId ? getMetaTemplateNome(disparo.metaTemplateId) : templateNome}
                  </span>
                )}
                {disparo.descricao && <span>{disparo.descricao}</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <div className="flex items-center gap-1 text-sm font-mono font-semibold">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                {disparo.horario}
              </div>
              <div className="text-xs text-muted-foreground">{fmtDate(disparo.data)}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={onToggle} data-testid={`button-expand-${disparo.id}`}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {(disparo.status === "executando" || disparo.status === "concluido") && disparo.totalRegistros > 0 && (
        <div className="px-4 pb-2">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>{disparo.processados} / {disparo.totalRegistros} enviados</span>
            <span className="text-red-500">{disparo.erros} erros</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      <CardContent className="px-4 pb-3 pt-0">
        <div className="flex items-center gap-2 flex-wrap">
          {disparo.arquivoConteudo === "[presente]" && (
            <Badge variant="outline" className="text-xs gap-1">
              <FileText className="h-3 w-3" />
              {disparo.arquivoNome || "Base"} — {disparo.totalRegistros} reg.
            </Badge>
          )}
          {!disparo.arquivoConteudo && (
            <Badge variant="outline" className="text-xs text-orange-500 border-orange-300 gap-1">
              <AlertCircle className="h-3 w-3" /> Sem base
            </Badge>
          )}
          <div className="flex-1" />

          {(disparo.status === "agendado" || disparo.status === "parado" || disparo.status === "erro") && (
            <Button size="sm" variant="default" onClick={onDisparar} className="gap-1 h-7" data-testid={`button-disparar-${disparo.id}`}>
              <Play className="h-3 w-3" /> Disparar Agora
            </Button>
          )}
          {disparo.status === "executando" && (
            <Button size="sm" variant="destructive" onClick={onParar} className="gap-1 h-7" data-testid={`button-parar-${disparo.id}`}>
              <StopCircle className="h-3 w-3" /> Parar
            </Button>
          )}
          {(disparo.status === "parado" || disparo.status === "concluido" || disparo.status === "erro") && (
            <Button size="sm" variant="outline" onClick={onReagendar} className="gap-1 h-7" data-testid={`button-reagendar-${disparo.id}`}>
              <RefreshCw className="h-3 w-3" /> Reagendar
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onLogs} className="gap-1 h-7" data-testid={`button-logs-${disparo.id}`}>
            <Eye className="h-3 w-3" /> Logs
          </Button>
          {disparo.status !== "executando" && (
            <Button
              size="sm" variant="ghost" onClick={onDeletar}
              className="gap-1 h-7 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
              data-testid={`button-deletar-${disparo.id}`}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Detail label="Canal" value={canalNome} />
              <Detail label="Template" value={templateNome} />
              <Detail label="Total registros" value={String(disparo.totalRegistros)} />
              <Detail label="Processados" value={String(disparo.processados)} />
              <Detail label="Erros" value={String(disparo.erros)} />
              <Detail label="Iniciado em" value={fmtTs(disparo.iniciadoEm)} />
              <Detail label="Concluído em" value={fmtTs(disparo.concluidoEm)} />
            </div>
            {disparo.parametrosExtras && disparo.parametrosExtras.length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground font-medium">Parâmetros extras:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {disparo.parametrosExtras.map((p, i) => (
                    <Badge key={i} variant="outline" className="text-xs">{p.key}: {p.value}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium text-sm truncate">{value}</p>
    </div>
  );
}

// ── Cronograma View ────────────────────────────────────────────────────────

function CronogramaView({
  data, cronograma, onParar, onDisparar, onLogs,
}: {
  data: string;
  cronograma: Record<string, DisparoSafe[]>;
  onParar: (id: string) => void;
  onDisparar: (id: string) => void;
  onLogs: (id: string) => void;
}) {
  const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
  const hasAny = Object.keys(cronograma).length > 0;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">Cronograma de {fmtDate(data)}</span>
        {!hasAny && <span className="text-sm text-muted-foreground">— nenhum disparo agendado</span>}
      </div>
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-20">Hora</TableHead>
              <TableHead>Disparo</TableHead>
              <TableHead className="w-28">Canal / Template</TableHead>
              <TableHead className="w-24 text-center">Registros</TableHead>
              <TableHead className="w-32 text-center">Status</TableHead>
              <TableHead className="w-32">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {hours.map(hora => {
              const items = cronograma[hora] ?? [];
              if (items.length === 0) {
                return (
                  <TableRow key={hora} className="opacity-30">
                    <TableCell className="font-mono text-xs text-muted-foreground py-1.5">{hora}</TableCell>
                    <TableCell className="text-muted-foreground text-xs py-1.5">—</TableCell>
                    <TableCell /><TableCell /><TableCell /><TableCell />
                  </TableRow>
                );
              }
              return items.map((d, idx) => (
                <TableRow key={d.id} className={idx === 0 ? "border-t-2 border-primary/30" : ""}>
                  <TableCell className="font-mono text-sm font-bold py-2">{idx === 0 ? hora : ""}</TableCell>
                  <TableCell className="py-2">
                    <span className="font-medium text-sm">{d.nome}</span>
                    {d.descricao && <p className="text-xs text-muted-foreground">{d.descricao}</p>}
                  </TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground">
                    {d.canalId || d.templateId || d.metaTemplateId ? `${d.canalId ? "canal" : ""}${(d.templateId || d.metaTemplateId) ? " / template" : ""}` : "—"}
                  </TableCell>
                  <TableCell className="text-center text-sm py-2">
                    {d.totalRegistros > 0 ? `${d.processados}/${d.totalRegistros}` : "—"}
                  </TableCell>
                  <TableCell className="text-center py-2">
                    <Badge className={`text-xs border gap-1 ${statusColor(d.status)}`} variant="outline">
                      {statusIcon(d.status)} {DISPARO_STATUS[d.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-2">
                    <div className="flex gap-1">
                      {d.status === "agendado" && (
                        <Button size="sm" variant="outline" className="h-6 px-2" onClick={() => onDisparar(d.id)}>
                          <Play className="h-3 w-3" />
                        </Button>
                      )}
                      {d.status === "executando" && (
                        <Button size="sm" variant="destructive" className="h-6 px-2" onClick={() => onParar(d.id)}>
                          <StopCircle className="h-3 w-3" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => onLogs(d.id)}>
                        <Eye className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ));
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── Canais & Templates Manager ─────────────────────────────────────────────

function CanaisTemplatesManager({
  canais, templates, onRefresh,
}: {
  canais: DisparoCanal[];
  templates: DisparoTemplate[];
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [canalForm, setCanalForm] = useState({ nome: "", codigo: "", descricao: "" });
  const [templateForm, setTemplateForm] = useState({ nome: "", codigo: "", canalId: "", descricao: "", corpo: "" });

  const criarCanalMutation = useMutation({
    mutationFn: (data: object) => apiRequest("POST", "/api/disparo-canais", data),
    onSuccess: () => { toast({ title: "Canal criado!" }); onRefresh(); setCanalForm({ nome: "", codigo: "", descricao: "" }); },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deletarCanalMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/disparo-canais/${id}`),
    onSuccess: () => { toast({ title: "Canal removido" }); onRefresh(); },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const criarTemplateMutation = useMutation({
    mutationFn: (data: object) => apiRequest("POST", "/api/disparo-templates", data),
    onSuccess: () => { toast({ title: "Template criado!" }); onRefresh(); setTemplateForm({ nome: "", codigo: "", canalId: "", descricao: "", corpo: "" }); },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deletarTemplateMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/disparo-templates/${id}`),
    onSuccess: () => { toast({ title: "Template removido" }); onRefresh(); },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const handleCriarCanal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canalForm.nome || !canalForm.codigo) {
      toast({ title: "Preencha nome e código", variant: "destructive" }); return;
    }
    criarCanalMutation.mutate(canalForm);
  };

  const handleCriarTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateForm.nome || !templateForm.codigo || !templateForm.canalId) {
      toast({ title: "Preencha nome, código e canal", variant: "destructive" }); return;
    }
    criarTemplateMutation.mutate(templateForm);
  };

  const getCanalNome = (id: string) => canais.find(c => c.id === id)?.nome ?? id;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Canais */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Canais</h2>
          <Badge variant="secondary">{canais.length}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Defina os canais de envio disponíveis (WhatsApp, SMS, E-mail, etc.)
        </p>

        {/* Create Canal form */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Novo Canal</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCriarCanal} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Nome *</Label>
                  <Input
                    value={canalForm.nome}
                    onChange={e => setCanalForm(p => ({ ...p, nome: e.target.value }))}
                    placeholder="Ex: WhatsApp"
                    data-testid="input-canal-nome"
                  />
                </div>
                <div>
                  <Label className="text-xs">Código * <span className="text-muted-foreground">(enviado à API)</span></Label>
                  <Input
                    value={canalForm.codigo}
                    onChange={e => setCanalForm(p => ({ ...p, codigo: e.target.value }))}
                    placeholder="Ex: whatsapp"
                    data-testid="input-canal-codigo"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Descrição</Label>
                <Input
                  value={canalForm.descricao}
                  onChange={e => setCanalForm(p => ({ ...p, descricao: e.target.value }))}
                  placeholder="Opcional"
                />
              </div>
              <Button type="submit" size="sm" className="w-full" disabled={criarCanalMutation.isPending} data-testid="button-criar-canal">
                {criarCanalMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                Adicionar Canal
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Canais list */}
        {canais.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <Radio className="h-8 w-8 mx-auto mb-2 opacity-20" />
            Nenhum canal cadastrado
          </div>
        ) : (
          <div className="space-y-2">
            {canais.map(c => (
              <div key={c.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors" data-testid={`row-canal-${c.id}`}>
                <div>
                  <p className="font-medium text-sm">{c.nome}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{c.codigo}</code>
                    {c.descricao && <span className="text-xs text-muted-foreground">{c.descricao}</span>}
                  </div>
                </div>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                  onClick={() => deletarCanalMutation.mutate(c.id)}
                  disabled={deletarCanalMutation.isPending}
                  data-testid={`button-deletar-canal-${c.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Templates */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Layout className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Templates</h2>
          <Badge variant="secondary">{templates.length}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Defina os templates de mensagem disponíveis para cada canal
        </p>

        {/* Create Template form */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Novo Template</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCriarTemplate} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Nome *</Label>
                  <Input
                    value={templateForm.nome}
                    onChange={e => setTemplateForm(p => ({ ...p, nome: e.target.value }))}
                    placeholder="Ex: Boas-vindas FMU"
                    data-testid="input-template-nome"
                  />
                </div>
                <div>
                  <Label className="text-xs">Código * <span className="text-muted-foreground">(enviado à API)</span></Label>
                  <Input
                    value={templateForm.codigo}
                    onChange={e => setTemplateForm(p => ({ ...p, codigo: e.target.value }))}
                    placeholder="Ex: boas_vindas_fmu"
                    data-testid="input-template-codigo"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Canal *</Label>
                <Select value={templateForm.canalId} onValueChange={v => setTemplateForm(p => ({ ...p, canalId: v }))}>
                  <SelectTrigger data-testid="select-template-canal">
                    <SelectValue placeholder="Selecione o canal..." />
                  </SelectTrigger>
                  <SelectContent>
                    {canais.length === 0 ? (
                      <SelectItem value="__none" disabled>Nenhum canal cadastrado</SelectItem>
                    ) : canais.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Descrição</Label>
                <Input
                  value={templateForm.descricao}
                  onChange={e => setTemplateForm(p => ({ ...p, descricao: e.target.value }))}
                  placeholder="Opcional"
                />
              </div>
              <div>
                <Label className="text-xs">Corpo da mensagem <span className="text-muted-foreground">(use {`{{1}}`}, {`{{2}}`}... para variáveis)</span></Label>
                <Textarea
                  value={templateForm.corpo}
                  onChange={e => setTemplateForm(p => ({ ...p, corpo: e.target.value }))}
                  placeholder={"Olá, {{1}}. Identificamos uma pendência no curso {{2}}..."}
                  rows={4}
                  className="text-sm font-mono resize-none"
                />
              </div>
              <Button type="submit" size="sm" className="w-full" disabled={criarTemplateMutation.isPending} data-testid="button-criar-template">
                {criarTemplateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                Adicionar Template
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Templates list */}
        {templates.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <Layout className="h-8 w-8 mx-auto mb-2 opacity-20" />
            Nenhum template cadastrado
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map(t => (
              <div key={t.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors" data-testid={`row-template-${t.id}`}>
                <div>
                  <p className="font-medium text-sm">{t.nome}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{t.codigo}</code>
                    <Badge variant="outline" className="text-xs gap-1 py-0">
                      <Radio className="h-2.5 w-2.5" /> {getCanalNome(t.canalId)}
                    </Badge>
                    {t.descricao && <span className="text-xs text-muted-foreground">{t.descricao}</span>}
                  </div>
                </div>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                  onClick={() => deletarTemplateMutation.mutate(t.id)}
                  disabled={deletarTemplateMutation.isPending}
                  data-testid={`button-deletar-template-${t.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Colunas Info Popover ───────────────────────────────────────────────────

function ColunasInfoPopover() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="outline" size="sm" className="gap-1" onClick={() => setOpen(o => !o)} data-testid="button-colunas-info">
        <Info className="h-4 w-4" /> Colunas Obrigatórias
      </Button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-96 bg-popover border rounded-lg shadow-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> Colunas obrigatórias na base CSV
            </h3>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen(false)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            O arquivo CSV deve conter estas colunas na primeira linha (cabeçalho):
          </p>
          <div className="space-y-2">
            {DISPARO_COLUNAS_OBRIGATORIAS.map(col => (
              <div key={col.campo} className="flex gap-3 p-2 bg-muted/50 rounded text-sm">
                <code className="font-mono font-bold text-primary min-w-[80px]">{col.campo}</code>
                <div>
                  <p className="text-xs">{col.descricao}</p>
                  <p className="text-xs text-muted-foreground">Ex: {col.exemplo}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded text-xs text-amber-700 dark:text-amber-400">
            <AlertCircle className="h-3 w-3 inline mr-1" />
            Além das colunas da base, os campos <code>canal</code> e <code>template</code> são adicionados automaticamente pelo sistema.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Create Dialog ──────────────────────────────────────────────────────────

// Colunas disponíveis na base COGNA (para mapeamento de variáveis do template)
const COGNA_COLUMNS = [
  "telefone", "nome", "cpf", "canaldeorigem", "curso",
  "unidade", "origem", "lista_nome", "modalidade", "nivelescolaridade",
];

// Extrai índices de variáveis {{N}} do corpo do template, em ordem
function extractTemplateVars(corpo: string): string[] {
  const found = new Set<string>();
  const order: string[] = [];
  for (const m of corpo.matchAll(/\{\{(\d+)\}\}/g)) {
    if (!found.has(m[1])) { found.add(m[1]); order.push(m[1]); }
  }
  return order.sort((a, b) => Number(a) - Number(b));
}

type HorarioSlot = {
  id: string;
  horario: string;
  limite?: number;
};

function parseCSVHeaders(conteudo: string): { headers: string[]; rows: number } {
  const lines = conteudo.split("\n").filter(l => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: 0 };
  // Auto-detect separator: semicolon or comma
  const firstLine = lines[0].replace(/^\uFEFF/, ""); // strip BOM
  const sep = firstLine.includes(";") ? ";" : ",";
  const headers = firstLine.split(sep).map(h => h.trim().toLowerCase().replace(/"/g, ""));
  return { headers, rows: lines.length - 1 };
}

function downloadTemplate() {
  window.open("/api/disparo-template.csv", "_blank");
}

function CreateDisparoDialog({
  canais, templates, onClose, onCreated,
}: {
  canais: DisparoCanal[];
  templates: DisparoTemplate[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [data, setData] = useState(todayBR());
  const [operacaoId, setOperacaoId] = useState("");
  const [canalId, setCanalId] = useState("");
  const [metaTemplateId, setMetaTemplateId] = useState("");
  // base global — única para todos os horários
  const [fonte, setFonte] = useState<"csv" | "cogna">("csv");
  const [arquivo, setArquivo] = useState<{ nome: string; conteudo: string; rows: number; headers: string[]; erros: string[] } | null>(null);
  const [cognaOrigem, setCognaOrigem] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [slots, setSlots] = useState<HorarioSlot[]>([{ id: crypto.randomUUID(), horario: "", limite: undefined }]);
  const [variaveis, setVariaveis] = useState<Array<{ key: string; value: string; auto?: boolean }>>([]);
  const [creating, setCreating] = useState(false);

  // origens da base COGNA disponíveis para usar como fonte
  const { data: cognaData } = useQuery<{
    origens: { origem: string; total: number; pendentes: number }[];
    diagnostico: "ok" | "tabela_nao_existe" | "tabela_vazia" | "sem_origem";
    totalRows?: number;
  }>({
    queryKey: ["/api/cogna/origens"],
    retry: false,
  });
  const cognaOrigens = cognaData?.origens ?? [];
  const cognaDiagnostico = cognaData?.diagnostico;

  // Meta: operações, telefones e templates (do Gestão Meta, sincronizados do WhatsApp)
  const { data: metaOperacoes = [] } = useQuery<MetaOperacao[]>({
    queryKey: ["/api/meta/operacoes"],
  });
  const { data: metaPhones = [] } = useQuery<MetaPhoneNumber[]>({
    queryKey: ["/api/meta/phone-numbers"],
  });
  const { data: metaTemplatesList = [] } = useQuery<MetaTemplate[]>({
    queryKey: ["/api/meta/templates"],
    staleTime: 0,
  });

  // canalIds dos telefones da operação selecionada
  const canalIdsOp = operacaoId
    ? [...new Set(metaPhones.filter(p => p.operacaoId === operacaoId && p.canalId).map(p => p.canalId!))]
    : [];
  // canais de disparo que aparecem nesses telefones
  const canaisOp = operacaoId ? canais.filter(c => canalIdsOp.includes(c.id)) : canais;
  // MetaTemplates da operação selecionada (APPROVED em primeiro)
  const metaTemplatesOp = operacaoId
    ? metaTemplatesList
        .filter(t => t.operacaoId === operacaoId)
        .sort((a, b) => (a.status === "APPROVED" ? -1 : 1) - (b.status === "APPROVED" ? -1 : 1))
    : [];

  const requiredCols = DISPARO_COLUNAS_OBRIGATORIAS.map(c => c.campo);
  const metaTemplateSelecionado = metaTemplatesList.find(t => t.id === metaTemplateId);

  // Colunas disponíveis dependem da fonte selecionada
  const availableHeaders: string[] = fonte === "csv" ? (arquivo?.headers ?? []) : COGNA_COLUMNS;

  // Auto-extrai variáveis {{N}} do bodyText do MetaTemplate quando o template muda
  useEffect(() => {
    if (!metaTemplateSelecionado?.bodyText) {
      setVariaveis([]);
      return;
    }
    const vars = extractTemplateVars(metaTemplateSelecionado.bodyText);
    setVariaveis(vars.map(key => ({ key, value: "", auto: true })));
  }, [metaTemplateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const addVariavel = () => setVariaveis(v => [...v, { key: "", value: "", auto: false }]);
  const removeVariavel = (i: number) => setVariaveis(v => v.filter((_, j) => j !== i));
  const updateVariavel = (i: number, field: "key" | "value", val: string) =>
    setVariaveis(v => v.map((x, j) => j === i ? { ...x, [field]: val } : x));

  const addSlot = () => setSlots(s => [...s, { id: crypto.randomUUID(), horario: "", limite: undefined }]);
  const removeSlot = (id: string) => setSlots(s => s.filter(x => x.id !== id));

  // lê o CSV global (único para todos os horários)
  const handleFileGlobal = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const conteudo = ev.target?.result as string;
      if (!conteudo.trim()) { toast({ title: "Arquivo vazio", variant: "destructive" }); return; }
      const { headers, rows } = parseCSVHeaders(conteudo);
      const missing = requiredCols.filter(c => !headers.includes(c));
      const erros = missing.map(m => `Coluna ausente: "${m}"`);
      setArquivo({ nome: f.name, conteudo, rows, headers, erros });
      e.target.value = "";
    };
    reader.readAsText(f, "UTF-8");
  };

  const createMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/disparos", body),
    onSuccess: () => {},
    onError: (e: Error) => toast({ title: "Erro ao criar disparo", description: e.message, variant: "destructive" }),
  });

  // fatia um CSV para no máximo `limite` linhas de dados (preserva header)
  function sliceCsv(conteudo: string, limite?: number): { conteudo: string; rows: number } {
    if (!limite) {
      const rows = Math.max(0, conteudo.split("\n").filter(l => l.trim()).length - 1);
      return { conteudo, rows };
    }
    const lines = conteudo.split("\n").filter(l => l.trim());
    const header = lines[0] ?? "";
    const data   = lines.slice(1, limite + 1);
    return { conteudo: [header, ...data].join("\n"), rows: data.length };
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) { toast({ title: "Informe o nome do disparo", variant: "destructive" }); return; }
    if (!data) { toast({ title: "Informe a data", variant: "destructive" }); return; }
    if (slots.some(s => !s.horario)) { toast({ title: "Preencha o horário de todos os agendamentos", variant: "destructive" }); return; }
    if (fonte === "csv" && arquivo?.erros && arquivo.erros.length > 0) {
      toast({ title: "Corrija as colunas inválidas no CSV antes de continuar", variant: "destructive" }); return;
    }
    if (fonte === "csv" && !arquivo) { toast({ title: "Selecione o arquivo CSV", variant: "destructive" }); return; }
    if (fonte === "cogna" && !cognaOrigem) { toast({ title: "Selecione a origem da base COGNA", variant: "destructive" }); return; }

    setCreating(true);
    const parametrosExtras = variaveis.filter(v => v.key.trim()).length > 0
      ? variaveis.filter(v => v.key.trim()).map(v => ({ key: v.key.trim(), value: v.value.trim() }))
      : undefined;

    try {
      // Para COGNA, busca o CSV base uma vez e aplica limite por slot
      let csvBase: string | undefined;
      let nomeBase: string | undefined;
      if (fonte === "cogna") {
        const resp = await fetch(`/api/cogna/rows-csv?origem=${encodeURIComponent(cognaOrigem)}&data=${encodeURIComponent(data)}`);
        if (!resp.ok) throw new Error(`Erro ao buscar base COGNA: ${await resp.text()}`);
        csvBase  = await resp.text();
        nomeBase = `cogna_${cognaOrigem}_${data}.csv`;
      } else {
        csvBase  = arquivo!.conteudo;
        nomeBase = arquivo!.nome;
      }

      for (const slot of slots) {
        const { conteudo: arquivoConteudo, rows: totalRegistros } = sliceCsv(csvBase, slot.limite);
        const label = slots.length > 1 ? ` ${slot.horario}` : "";
        await createMutation.mutateAsync({
          nome: `${nome.trim()}${label}`,
          descricao,
          horario: slot.horario,
          data,
          canalId: canalId || undefined,
          metaTemplateId: metaTemplateId || undefined,
          arquivoNome: nomeBase,
          arquivoConteudo,
          origemCogna: fonte === "cogna" ? cognaOrigem : undefined,
          totalRegistros,
          parametrosExtras,
        });
      }
      toast({ title: slots.length === 1 ? "Disparo criado!" : `${slots.length} disparos criados!` });
      onCreated();
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" /> Novo Disparo
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* ── Identificação ── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Nome do Disparo *</Label>
              <Input
                value={nome} onChange={e => setNome(e.target.value)}
                placeholder="Ex: Campanha FMU Janeiro"
                data-testid="input-nome"
              />
              {slots.length > 1 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Cada horário criará um disparo com sufixo do horário — ex: "Campanha FMU Janeiro 08:00"
                </p>
              )}
            </div>
            <div className="col-span-2">
              <Label>Descrição <span className="text-muted-foreground text-xs font-normal">(opcional)</span></Label>
              <Textarea value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Descrição da campanha..." rows={2} data-testid="input-descricao" />
            </div>
            <div>
              <Label>Data *</Label>
              <Input type="date" value={data} onChange={e => setData(e.target.value)} data-testid="input-data" />
            </div>
          </div>

          {/* ── Base de Dados (global) ── */}
          <div className="border rounded-lg p-4 space-y-3">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" /> Base de Dados
              <span className="font-normal text-xs text-muted-foreground">(mesma para todos os horários)</span>
            </h4>

            {/* Toggle CSV / COGNA */}
            <div className="flex rounded-md border overflow-hidden w-fit">
              <button
                type="button" onClick={() => { setFonte("csv"); setArquivo(null); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors
                  ${fonte === "csv" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
              >
                <Upload className="h-3 w-3" /> CSV
              </button>
              <button
                type="button" onClick={() => { setFonte("cogna"); setCognaOrigem(""); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-l
                  ${fonte === "cogna" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
              >
                <Database className="h-3 w-3" /> Base COGNA
              </button>
            </div>

            {fonte === "csv" ? (
              <div className="space-y-2">
                <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileGlobal} />
                <Button
                  type="button" variant="outline" size="sm"
                  className={`gap-1.5 ${arquivo ? (arquivo.erros.length > 0 ? "border-red-400 text-red-600" : "border-green-400 text-green-700") : ""}`}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {arquivo
                    ? <><CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {arquivo.nome} <span className="text-muted-foreground ml-1">({arquivo.rows.toLocaleString("pt-BR")} reg.)</span></>
                    : <><Upload className="h-3.5 w-3.5" /> Selecionar CSV…</>}
                </Button>
                {arquivo?.erros && arquivo.erros.length > 0 && (
                  <ul className="text-xs text-red-500 list-disc list-inside">
                    {arquivo.erros.map(e => <li key={e}>{e}</li>)}
                  </ul>
                )}
                {arquivo && arquivo.erros.length === 0 && (
                  <div className="flex flex-wrap gap-1">
                    {requiredCols.map(col => (
                      <code key={col} className={`text-xs px-1.5 py-0.5 rounded font-mono ${arquivo.headers.includes(col) ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"}`}>
                        {arquivo.headers.includes(col) ? "✓" : "✗"} {col}
                      </code>
                    ))}
                  </div>
                )}
                {!arquivo && (
                  <p className="text-xs text-muted-foreground">
                    CSV com separador <strong>;</strong> contendo as colunas:{" "}
                    {DISPARO_COLUNAS_OBRIGATORIAS.map(c => c.campo).join(", ")}.{" "}
                    <button type="button" className="underline hover:text-foreground" onClick={downloadTemplate}>Baixar modelo</button>
                  </p>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                <Select value={cognaOrigem || "__none__"} onValueChange={v => setCognaOrigem(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="h-8 text-sm w-72">
                    <SelectValue placeholder="Selecionar origem…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— selecionar origem —</SelectItem>
                    {cognaOrigens.map(o => (
                      <SelectItem key={o.origem} value={o.origem}>
                        {o.origem}
                        <span className="ml-2 text-xs text-muted-foreground">({o.pendentes.toLocaleString("pt-BR")} pendentes)</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {cognaOrigem && (() => {
                  const info = cognaOrigens.find(o => o.origem === cognaOrigem);
                  return info ? (
                    <Badge variant="secondary" className="gap-1 text-xs">
                      <CheckCircle2 className="h-3 w-3 text-green-600" />
                      {info.pendentes.toLocaleString("pt-BR")} registros disponíveis
                    </Badge>
                  ) : null;
                })()}
                {cognaOrigens.length === 0 && (
                  <span className="text-xs text-amber-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {cognaDiagnostico === "tabela_nao_existe" && "Tabela não encontrada — faça um upload primeiro"}
                    {cognaDiagnostico === "tabela_vazia" && "Base vazia — suba uma planilha via 'Subir base'"}
                    {cognaDiagnostico === "sem_origem" && "Base sem coluna 'origem' — verifique o mapeamento no upload"}
                    {(!cognaDiagnostico || cognaDiagnostico === "ok") && "Nenhuma origem disponível"}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* ── Operação → Canal → Template ── */}
          <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
            <h4 className="font-semibold flex items-center gap-2 text-sm">
              <Radio className="h-4 w-4 text-primary" /> Operação / Canal / Template
              <span className="font-normal text-xs text-muted-foreground">(único para todos os horários)</span>
            </h4>

            {/* 1. Operação */}
            <div>
              <Label>Operação</Label>
              <Select
                value={operacaoId || "__none__"}
                onValueChange={v => {
                  const val = v === "__none__" ? "" : v;
                  setOperacaoId(val);
                  setCanalId("");
                  setMetaTemplateId("");
                }}
              >
                <SelectTrigger data-testid="select-operacao">
                  <SelectValue placeholder="Selecione a operação..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— selecionar operação —</SelectItem>
                  {metaOperacoes.map(op => (
                    <SelectItem key={op.id} value={op.id}>{op.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {metaOperacoes.length === 0 && (
                <p className="text-xs text-amber-500 mt-1 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Nenhuma operação cadastrada no Gestão Meta
                </p>
              )}
            </div>

            {/* 2. Canal */}
            {operacaoId && (
              <div>
                <Label>Canal</Label>
                <Select
                  value={canalId || "__none__"}
                  onValueChange={v => {
                    const val = v === "__none__" ? "" : v;
                    setCanalId(val);
                    setMetaTemplateId("");
                  }}
                  disabled={canaisOp.length === 0}
                >
                  <SelectTrigger data-testid="select-canal">
                    <SelectValue placeholder={canaisOp.length === 0 ? "Nenhum canal vinculado nesta operação" : "Selecione o canal..."} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— selecionar canal —</SelectItem>
                    {canaisOp.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {canaisOp.length === 0 && (
                  <p className="text-xs text-amber-500 mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Nenhum telefone desta operação tem canal vinculado — configure em Gestão Meta → Configuração.
                  </p>
                )}
              </div>
            )}

            {/* 3. Template — do Gestão Meta (sincronizado do WhatsApp) */}
            {operacaoId && canalId && (
              <div>
                <Label>Template</Label>
                <Select
                  value={metaTemplateId || "__none__"}
                  onValueChange={v => setMetaTemplateId(v === "__none__" ? "" : v)}
                  disabled={metaTemplatesOp.length === 0}
                >
                  <SelectTrigger data-testid="select-template">
                    <SelectValue placeholder={metaTemplatesOp.length === 0 ? "Nenhum template nesta operação" : "Selecione o template..."} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— selecionar template —</SelectItem>
                    {metaTemplatesOp.map(t => (
                      <SelectItem key={t.id} value={t.id}>
                        <div className="flex items-center gap-2">
                          <span>{t.name}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            t.status === "APPROVED" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                            t.status === "PAUSED"   ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" :
                            "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                          }`}>{t.status}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {metaTemplatesOp.length === 0 && (
                  <p className="text-xs text-amber-500 mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Nenhum template sincronizado para esta operação — sincronize em Gestão Meta.
                  </p>
                )}
                {metaTemplateSelecionado && (
                  <>
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono bg-muted px-1.5 py-0.5 rounded">{metaTemplateSelecionado.name}</span>
                      <span>·</span>
                      <span>{metaTemplateSelecionado.language}</span>
                      <span>·</span>
                      <span>{metaTemplateSelecionado.category}</span>
                    </div>
                    {metaTemplateSelecionado.bodyText ? (
                      <div className="mt-2 space-y-1">
                        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <FileText className="h-3 w-3" /> Mensagem do template
                        </p>
                        <pre className="text-xs bg-muted/50 border rounded-lg p-3 whitespace-pre-wrap font-sans leading-relaxed text-foreground/80 max-h-40 overflow-y-auto">
                          {metaTemplateSelecionado.bodyText}
                        </pre>
                        {extractTemplateVars(metaTemplateSelecionado.bodyText).length > 0 && (
                          <p className="text-xs text-primary flex items-center gap-1 mt-1">
                            <Settings2 className="h-3 w-3" />
                            {extractTemplateVars(metaTemplateSelecionado.bodyText).length} variável(is) detectada(s) — mapeie abaixo
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1 italic">
                        <Info className="h-3 w-3 shrink-0" />
                        Corpo não disponível — sincronize novamente em Gestão Meta para carregar a mensagem.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Variáveis do Template ── */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-semibold text-sm flex items-center gap-2">
                  <Settings2 className="h-4 w-4 text-primary" /> Variáveis do Template
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Adicione variáveis extras a serem enviadas com o disparo.
                </p>
              </div>
              <Button
                type="button" variant="outline" size="sm" className="gap-1.5 h-7 shrink-0"
                onClick={addVariavel} data-testid="button-add-variavel"
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar
              </Button>
            </div>

            {variaveis.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 border border-dashed rounded-lg">
                <Info className="h-3.5 w-3.5 shrink-0" />
                {"Clique em \"Adicionar\" para inserir variáveis manualmente."}
              </div>
            ) : (
              <div className="space-y-2">
                {variaveis.map((v, i) => (
                  <div key={i} className="flex items-center gap-2" data-testid={`variavel-row-${i}`}>
                    {/* Chave */}
                    {v.auto ? (
                      <span className="shrink-0 w-16 text-center font-mono text-xs font-semibold bg-primary/10 text-primary border border-primary/20 rounded px-2 py-1.5">
                        {`{{${v.key}}}`}
                      </span>
                    ) : (
                      <div className="w-32 shrink-0">
                        <Input
                          value={v.key}
                          onChange={e => updateVariavel(i, "key", e.target.value)}
                          placeholder="chave"
                          className="font-mono text-sm h-8"
                          data-testid={`input-variavel-key-${i}`}
                        />
                      </div>
                    )}
                    <span className="text-muted-foreground text-sm shrink-0">→</span>
                    {/* Valor: dropdown de colunas se há base carregada, senão input livre */}
                    <div className="flex-1">
                      {availableHeaders.length > 0 ? (
                        <Select
                          value={v.value || "__none__"}
                          onValueChange={val => updateVariavel(i, "value", val === "__none__" ? "" : val)}
                        >
                          <SelectTrigger className="h-8 text-sm" data-testid={`select-variavel-col-${i}`}>
                            <SelectValue placeholder="Selecionar coluna…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— selecionar coluna —</SelectItem>
                            {availableHeaders.map(h => (
                              <SelectItem key={h} value={h}>{h}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={v.value}
                          onChange={e => updateVariavel(i, "value", e.target.value)}
                          placeholder={fonte === "csv" ? "Carregue um CSV para ver as colunas" : "coluna"}
                          className="text-sm h-8"
                          data-testid={`input-variavel-value-${i}`}
                        />
                      )}
                    </div>
                    <Button
                      type="button" variant="ghost" size="icon"
                      className="h-8 w-8 shrink-0 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                      onClick={() => removeVariavel(i)}
                      data-testid={`button-remove-variavel-${i}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Horários de Disparo ── */}
          <div className="border rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" /> Horários de Disparo
                <Badge variant="secondary" className="text-xs">{slots.length}</Badge>
              </h4>
              <Button
                type="button" variant="outline" size="sm" className="gap-1.5 h-7"
                onClick={addSlot} data-testid="button-add-slot"
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar Horário
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Defina o horário e o limite máximo de registros para cada disparo.
              {fonte === "cogna" && cognaOrigem && (() => {
                const total = slots.reduce((s, sl) => s + (sl.limite ?? 0), 0);
                const disp  = cognaOrigens.find(o => o.origem === cognaOrigem)?.pendentes ?? 0;
                return total > 0
                  ? <span className={`ml-1 font-medium ${total > disp ? "text-amber-500" : "text-green-600"}`}>
                      Total configurado: {total.toLocaleString("pt-BR")} / {disp.toLocaleString("pt-BR")} disponíveis
                    </span>
                  : null;
              })()}
            </p>

            <div className="space-y-2">
              {slots.map((slot, idx) => (
                <HorarioSlotRow
                  key={slot.id}
                  slot={slot}
                  index={idx}
                  canRemove={slots.length > 1}
                  onHorario={h => setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, horario: h } : s))}
                  onLimite={l => setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, limite: l } : s))}
                  onRemove={() => removeSlot(slot.id)}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={creating} data-testid="button-criar">
              {creating
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Criando...</>
                : <><Send className="h-4 w-4 mr-2" /> {slots.length === 1 ? "Criar Disparo" : `Criar ${slots.length} Disparos`}</>
              }
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Horario Slot Row ───────────────────────────────────────────────────────

function HorarioSlotRow({
  slot, index, canRemove, onHorario, onLimite, onRemove,
}: {
  slot: HorarioSlot;
  index: number;
  canRemove: boolean;
  onHorario: (h: string) => void;
  onLimite: (l: number | undefined) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-2.5 bg-background" data-testid={`slot-row-${index}`}>
      {/* Número */}
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0">
        {index + 1}
      </span>

      {/* Horário */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Label className="text-xs text-muted-foreground whitespace-nowrap">Horário</Label>
        <Input
          type="time"
          value={slot.horario}
          onChange={e => onHorario(e.target.value)}
          className="w-28 h-8 text-sm"
          data-testid={`input-horario-${index}`}
        />
      </div>

      {/* Limite */}
      <div className="flex items-center gap-1.5 flex-1">
        <Label className="text-xs text-muted-foreground whitespace-nowrap">Máx. registros</Label>
        <Input
          type="number"
          min={1}
          placeholder="Sem limite"
          value={slot.limite ?? ""}
          onChange={e => onLimite(e.target.value ? Math.max(1, parseInt(e.target.value)) : undefined)}
          className="w-36 h-8 text-sm"
          data-testid={`input-limite-${index}`}
        />
        {slot.limite && (
          <span className="text-xs text-muted-foreground">
            reg.
          </span>
        )}
      </div>

      {/* Remover */}
      {canRemove && (
        <Button
          type="button" variant="ghost" size="icon"
          className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950 shrink-0"
          onClick={onRemove} data-testid={`button-remove-slot-${index}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

// ── Logs Dialog ────────────────────────────────────────────────────────────

function LogsDialog({
  disparo, logsData, onClose, onRefresh,
}: {
  disparo?: DisparoSafe;
  logsData?: { logs: string[]; status: string; processados: number; erros: number; totalRegistros: number } | null;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const logsEndRef = useRef<HTMLDivElement>(null);
  const progress = logsData && logsData.totalRegistros > 0
    ? Math.round((logsData.processados / logsData.totalRegistros) * 100)
    : 0;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary" /> Logs — {disparo?.nome}
          </DialogTitle>
        </DialogHeader>

        {logsData && (
          <div className="space-y-2 px-1">
            <div className="flex items-center gap-3 flex-wrap text-sm">
              <Badge className={`gap-1 border ${statusColor((logsData.status as Disparo["status"]))} text-xs`} variant="outline">
                {statusIcon(logsData.status as Disparo["status"])}
                {DISPARO_STATUS[logsData.status as Disparo["status"]] || logsData.status}
              </Badge>
              <span className="text-muted-foreground">{logsData.processados}/{logsData.totalRegistros} enviados</span>
              {logsData.erros > 0 && <span className="text-red-500">{logsData.erros} erros</span>}
            </div>
            {logsData.totalRegistros > 0 && <Progress value={progress} className="h-2" />}
          </div>
        )}

        <div className="flex-1 overflow-auto bg-black/90 dark:bg-black rounded-lg p-3 font-mono text-xs text-green-400 min-h-[300px]">
          {logsData?.logs && logsData.logs.length > 0 ? (
            logsData.logs.map((line, i) => <div key={i} className="leading-5 hover:bg-white/5 px-1 rounded">{line}</div>)
          ) : (
            <div className="text-muted-foreground">Aguardando logs...</div>
          )}
          <div ref={logsEndRef} />
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="outline" size="sm" onClick={onRefresh} className="gap-1">
            <RefreshCw className="h-3.5 w-3.5" /> Atualizar
          </Button>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Reagendar Dialog ───────────────────────────────────────────────────────

function ReagendarDialog({
  disparo, onClose, onDone,
}: {
  disparo: DisparoSafe;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [horario, setHorario] = useState(disparo.horario);
  const [data, setData] = useState(disparo.data);

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/disparos/${disparo.id}/reagendar`, { horario, data }),
    onSuccess: () => { toast({ title: "Disparo reagendado!" }); onDone(); },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-primary" /> Reagendar Disparo
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{disparo.nome}</p>
          <div>
            <Label>Nova Data</Label>
            <Input type="date" value={data} onChange={e => setData(e.target.value)} data-testid="input-nova-data" />
          </div>
          <div>
            <Label>Novo Horário</Label>
            <Input type="time" value={horario} onChange={e => setHorario(e.target.value)} data-testid="input-novo-horario" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} data-testid="button-confirmar-reagendar">
              {mutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Reagendar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

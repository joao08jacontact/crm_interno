import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, isAfter, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Plus, FolderKanban, Trash2, Pencil, ExternalLink,
  CheckCircle2, Circle, Loader2, Calendar as CalendarIcon, User,
  Building2, BarChart3, AlertTriangle, Tag, X, Clock, AlertCircle,
  Eye, Zap, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  type ProjetoWithEtapas,
  type Etapa,
  type ProjetoStatus,
  type EtapaStatus,
  type ProjetoPrioridade,
  PROJETO_STATUS,
  PROJETO_STATUS_COLORS,
  PROJETO_PRIORIDADE,
  PROJETO_PRIORIDADE_COLORS,
  ETAPA_STATUS,
  OPERACOES,
} from "@shared/schema";

// ─── helpers ──────────────────────────────────────────────────────────────────

function isAtrasado(projeto: ProjetoWithEtapas): boolean {
  if (projeto.status === "concluido" || projeto.status === "cancelado") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  try {
    return isAfter(today, parseISO(projeto.dataPrevisao));
  } catch {
    return false;
  }
}

function diasAtraso(projeto: ProjetoWithEtapas): number {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const prev = parseISO(projeto.dataPrevisao);
    return Math.floor((today.getTime() - prev.getTime()) / 86400000);
  } catch {
    return 0;
  }
}

function getEtapaStatusIcon(status: string) {
  switch (status) {
    case "concluida":   return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
    case "em_andamento":return <Loader2 className="h-4 w-4 text-yellow-500 shrink-0" />;
    case "bloqueado":   return <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />;
    case "em_revisao":  return <Eye className="h-4 w-4 text-purple-500 shrink-0" />;
    default:            return <Circle className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

function getEtapaStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "concluida":   return "default";
    case "bloqueado":   return "destructive";
    default:            return "outline";
  }
}

// ─── default form state ────────────────────────────────────────────────────────

const defaultProjetoForm = () => ({
  nome: "",
  descricao: "",
  responsavel: "",
  operacao: "",
  status: "planejamento" as ProjetoStatus,
  dataInicio: new Date(),
  dataPrevisao: new Date(),
  sprint: "",
  prioridade: "" as ProjetoPrioridade | "",
  escopo: "",
  contexto: "",
  foraDeEscopo: "",
  tags: [] as string[],
});

const defaultEtapaForm = () => ({
  projetoId: "",
  nome: "",
  descricao: "",
  responsavel: "",
  dataPrevista: "",
  status: "pendente" as EtapaStatus,
  estimativa: "",
  observacao: "",
});

// ─── component ────────────────────────────────────────────────────────────────

export default function ProjetosPage() {
  const { toast } = useToast();

  // dialogs
  const [isCreateOpen, setIsCreateOpen]         = useState(false);
  const [isEditOpen, setIsEditOpen]             = useState(false);
  const [isDeleteOpen, setIsDeleteOpen]         = useState(false);
  const [isEtapaOpen, setIsEtapaOpen]           = useState(false);
  const [isEditEtapaOpen, setIsEditEtapaOpen]   = useState(false);
  const [isViewOpen, setIsViewOpen]             = useState(false);

  // selected items
  const [selectedProjeto, setSelectedProjeto]   = useState<ProjetoWithEtapas | null>(null);
  const [selectedEtapaId, setSelectedEtapaId]   = useState<string | null>(null);
  const [viewProjetoId, setViewProjetoId]       = useState<string | null>(null);

  // UI state
  const [statusFilter, setStatusFilter]         = useState("all");
  const [sprintFilter, setSprintFilter]         = useState("all");
  const [searchTerm, setSearchTerm]             = useState("");
  const [tagInput, setTagInput]                 = useState("");

  // forms
  const [projetoForm, setProjetoForm] = useState(defaultProjetoForm());
  const [etapaForm, setEtapaForm]     = useState(defaultEtapaForm());

  // ── queries & mutations ────────────────────────────────────────────────────

  const { data: projetos = [], isLoading } = useQuery<ProjetoWithEtapas[]>({
    queryKey: ["/api/projetos"],
  });

  const createProjetoMutation = useMutation({
    mutationFn: async (data: any) => (await apiRequest("POST", "/api/projetos", data)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projetos"] });
      setIsCreateOpen(false);
      setProjetoForm(defaultProjetoForm());
      toast({ title: "Projeto criado com sucesso!" });
    },
    onError: (e: Error) => toast({ title: "Erro ao criar projeto", description: e.message, variant: "destructive" }),
  });

  const updateProjetoMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) =>
      (await apiRequest("PATCH", `/api/projetos/${id}`, data)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projetos"] });
      setIsEditOpen(false);
      setSelectedProjeto(null);
      setProjetoForm(defaultProjetoForm());
      toast({ title: "Projeto atualizado!" });
    },
    onError: (e: Error) => toast({ title: "Erro ao atualizar projeto", description: e.message, variant: "destructive" }),
  });

  const deleteProjetoMutation = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/projetos/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projetos"] });
      setIsDeleteOpen(false);
      setSelectedProjeto(null);
      toast({ title: "Projeto excluído!" });
    },
    onError: (e: Error) => toast({ title: "Erro ao excluir projeto", description: e.message, variant: "destructive" }),
  });

  const createEtapaMutation = useMutation({
    mutationFn: async (data: any) => (await apiRequest("POST", "/api/etapas", data)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projetos"] });
      setIsEtapaOpen(false);
      setEtapaForm(defaultEtapaForm());
      toast({ title: "Etapa adicionada!" });
    },
    onError: (e: Error) => toast({ title: "Erro ao criar etapa", description: e.message, variant: "destructive" }),
  });

  const updateEtapaMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) =>
      (await apiRequest("PATCH", `/api/etapas/${id}`, data)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/projetos"] }),
    onError: (e: Error) => toast({ title: "Erro ao atualizar etapa", description: e.message, variant: "destructive" }),
  });

  const deleteEtapaMutation = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/etapas/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projetos"] });
      toast({ title: "Etapa removida!" });
    },
    onError: (e: Error) => toast({ title: "Erro ao remover etapa", description: e.message, variant: "destructive" }),
  });

  // ── handlers ──────────────────────────────────────────────────────────────

  const openViewDialog = (projeto: ProjetoWithEtapas) => {
    setViewProjetoId(projeto.id);
    setIsViewOpen(true);
  };

  const buildProjetoPayload = () => ({
    nome: projetoForm.nome,
    descricao: projetoForm.descricao,
    responsavel: projetoForm.responsavel,
    operacao: projetoForm.operacao,
    status: projetoForm.status,
    dataInicio: format(projetoForm.dataInicio, "yyyy-MM-dd"),
    dataPrevisao: format(projetoForm.dataPrevisao, "yyyy-MM-dd"),
    sprint: projetoForm.sprint || undefined,
    prioridade: projetoForm.prioridade || undefined,
    escopo: projetoForm.escopo || undefined,
    contexto: projetoForm.contexto || undefined,
    foraDeEscopo: projetoForm.foraDeEscopo || undefined,
    tags: projetoForm.tags.length ? projetoForm.tags : undefined,
  });

  const handleCreateProjeto = () => createProjetoMutation.mutate(buildProjetoPayload());

  const handleEditProjeto = () => {
    if (!selectedProjeto) return;
    updateProjetoMutation.mutate({ id: selectedProjeto.id, data: buildProjetoPayload() });
  };

  const openEditDialog = (projeto: ProjetoWithEtapas) => {
    setSelectedProjeto(projeto);
    setProjetoForm({
      nome: projeto.nome,
      descricao: projeto.descricao ?? "",
      responsavel: projeto.responsavel ?? "",
      operacao: projeto.operacao,
      status: projeto.status as ProjetoStatus,
      dataInicio: new Date(projeto.dataInicio + "T12:00:00"),
      dataPrevisao: new Date(projeto.dataPrevisao + "T12:00:00"),
      sprint: projeto.sprint ?? "",
      prioridade: (projeto.prioridade as ProjetoPrioridade) ?? "",
      escopo: projeto.escopo ?? "",
      contexto: projeto.contexto ?? "",
      foraDeEscopo: projeto.foraDeEscopo ?? "",
      tags: projeto.tags ?? [],
    });
    setIsEditOpen(true);
  };

  const openDeleteDialog = (projeto: ProjetoWithEtapas) => {
    setSelectedProjeto(projeto);
    setIsDeleteOpen(true);
  };

  const openAddEtapa = (projetoId: string) => {
    setEtapaForm({ ...defaultEtapaForm(), projetoId });
    setIsEtapaOpen(true);
  };

  const openEditEtapa = (etapa: Etapa) => {
    setSelectedEtapaId(etapa.id);
    setEtapaForm({
      projetoId: etapa.projetoId,
      nome: etapa.nome,
      descricao: etapa.descricao ?? "",
      responsavel: etapa.responsavel ?? "",
      dataPrevista: etapa.dataPrevista ?? "",
      status: etapa.status as EtapaStatus,
      estimativa: etapa.estimativa != null ? String(etapa.estimativa) : "",
      observacao: etapa.observacao ?? "",
    });
    setIsEditEtapaOpen(true);
  };

  const handleCreateEtapa = () => {
    createEtapaMutation.mutate({
      projetoId: etapaForm.projetoId,
      nome: etapaForm.nome,
      descricao: etapaForm.descricao || undefined,
      responsavel: etapaForm.responsavel || undefined,
      dataPrevista: etapaForm.dataPrevista || undefined,
      status: etapaForm.status,
      estimativa: etapaForm.estimativa ? Number(etapaForm.estimativa) : undefined,
      observacao: etapaForm.observacao || undefined,
    });
  };

  const handleEditEtapa = () => {
    if (!selectedEtapaId) return;
    updateEtapaMutation.mutate({
      id: selectedEtapaId,
      data: {
        nome: etapaForm.nome,
        descricao: etapaForm.descricao || undefined,
        responsavel: etapaForm.responsavel || undefined,
        dataPrevista: etapaForm.dataPrevista || undefined,
        status: etapaForm.status,
        estimativa: etapaForm.estimativa ? Number(etapaForm.estimativa) : undefined,
        observacao: etapaForm.observacao || undefined,
      },
    });
    setIsEditEtapaOpen(false);
    setSelectedEtapaId(null);
    setEtapaForm(defaultEtapaForm());
  };

  const cycleEtapaStatus = (etapaId: string, current: string) => {
    const order: EtapaStatus[] = ["pendente", "em_andamento", "em_revisao", "concluida"];
    const idx = order.indexOf(current as EtapaStatus);
    const next = order[(idx + 1) % order.length];
    updateEtapaMutation.mutate({ id: etapaId, data: { status: next } });
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !projetoForm.tags.includes(t)) {
      setProjetoForm(f => ({ ...f, tags: [...f.tags, t] }));
    }
    setTagInput("");
  };

  const removeTag = (tag: string) =>
    setProjetoForm(f => ({ ...f, tags: f.tags.filter(t => t !== tag) }));

  // ── derived data ──────────────────────────────────────────────────────────

  const viewProjeto = projetos.find(p => p.id === viewProjetoId) ?? null;

  const allSprints = Array.from(new Set(projetos.map(p => p.sprint).filter(Boolean))) as string[];

  const filteredProjetos = projetos.filter(p => {
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (sprintFilter !== "all" && p.sprint !== sprintFilter) return false;
    if (searchTerm && !p.nome.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !p.operacao.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total:        projetos.length,
    emAndamento:  projetos.filter(p => p.status === "em_andamento").length,
    concluidos:   projetos.filter(p => p.status === "concluido").length,
    atrasados:    projetos.filter(isAtrasado).length,
  };

  // ── sub-renders ───────────────────────────────────────────────────────────

  const TagInput = () => (
    <div className="space-y-2">
      <Label>Tags <span className="text-muted-foreground text-xs">(opcional)</span></Label>
      <div className="flex flex-wrap gap-1.5 p-2 border rounded-md min-h-[38px] cursor-text"
        onClick={() => document.getElementById("tag-input-field")?.focus()}>
        {projetoForm.tags.map(tag => (
          <Badge key={tag} variant="secondary" className="gap-1 text-xs">
            {tag}
            <button type="button" onClick={() => removeTag(tag)} className="hover:text-destructive">
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}
        <input
          id="tag-input-field"
          value={tagInput}
          onChange={e => setTagInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } if (e.key === ",") { e.preventDefault(); addTag(); } }}
          onBlur={addTag}
          placeholder={projetoForm.tags.length ? "" : "#ETL, #dashboard…"}
          className="outline-none bg-transparent text-sm flex-1 min-w-[100px]"
        />
      </div>
      <p className="text-xs text-muted-foreground">Pressione Enter ou vírgula para adicionar</p>
    </div>
  );

  const renderProjetoGeralTab = () => (
    <div className="space-y-4 p-1">
      <div className="space-y-2">
        <Label>Nome do Projeto <span className="text-destructive">*</span></Label>
        <Input
          value={projetoForm.nome}
          onChange={e => setProjetoForm({ ...projetoForm, nome: e.target.value })}
          placeholder="Nome do projeto"
          data-testid="input-projeto-nome"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Sprint</Label>
          <Input
            value={projetoForm.sprint}
            onChange={e => setProjetoForm({ ...projetoForm, sprint: e.target.value })}
            placeholder="Ex: Sprint 14 — 28/07 a 08/08"
          />
        </div>
        <div className="space-y-2">
          <Label>Prioridade</Label>
          <Select
            value={projetoForm.prioridade}
            onValueChange={v => setProjetoForm({ ...projetoForm, prioridade: v as ProjetoPrioridade })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alta">🔴 Alta</SelectItem>
              <SelectItem value="media">🟡 Média</SelectItem>
              <SelectItem value="baixa">🟢 Baixa</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Responsável Principal</Label>
          <Input
            value={projetoForm.responsavel}
            onChange={e => setProjetoForm({ ...projetoForm, responsavel: e.target.value })}
            placeholder="Nome do responsável"
          />
        </div>
        <div className="space-y-2">
          <Label>Operação <span className="text-destructive">*</span></Label>
          <Select
            value={projetoForm.operacao}
            onValueChange={v => setProjetoForm({ ...projetoForm, operacao: v })}
          >
            <SelectTrigger data-testid="select-projeto-operacao">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {OPERACOES.map(op => (
                <SelectItem key={op} value={op}>{op}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Status</Label>
        <Select
          value={projetoForm.status}
          onValueChange={v => setProjetoForm({ ...projetoForm, status: v as ProjetoStatus })}
        >
          <SelectTrigger data-testid="select-projeto-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PROJETO_STATUS).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Data Início</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start text-left font-normal">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(projetoForm.dataInicio, "dd/MM/yyyy", { locale: ptBR })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={projetoForm.dataInicio}
                onSelect={d => d && setProjetoForm({ ...projetoForm, dataInicio: d })} locale={ptBR} />
            </PopoverContent>
          </Popover>
        </div>
        <div className="space-y-2">
          <Label>Previsão de Conclusão</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start text-left font-normal">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(projetoForm.dataPrevisao, "dd/MM/yyyy", { locale: ptBR })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={projetoForm.dataPrevisao}
                onSelect={d => d && setProjetoForm({ ...projetoForm, dataPrevisao: d })} locale={ptBR} />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <TagInput />
    </div>
  );

  const renderProjetoDescricaoTab = () => (
    <div className="space-y-4 p-1">
      <div className="space-y-2">
        <Label>Escopo <span className="text-destructive">*</span></Label>
        <Textarea
          value={projetoForm.escopo}
          onChange={e => setProjetoForm({ ...projetoForm, escopo: e.target.value })}
          placeholder="O que está incluído neste projeto?"
          className="resize-none min-h-[80px]"
        />
      </div>
      <div className="space-y-2">
        <Label>Contexto / Problema <span className="text-muted-foreground text-xs">(opcional)</span></Label>
        <Textarea
          value={projetoForm.contexto}
          onChange={e => setProjetoForm({ ...projetoForm, contexto: e.target.value })}
          placeholder="O que motivou este projeto? Qual problema resolve?"
          className="resize-none min-h-[80px]"
        />
      </div>
      <div className="space-y-2">
        <Label>Fora de Escopo <span className="text-muted-foreground text-xs">(opcional)</span></Label>
        <Textarea
          value={projetoForm.foraDeEscopo}
          onChange={e => setProjetoForm({ ...projetoForm, foraDeEscopo: e.target.value })}
          placeholder="O que NÃO será feito neste projeto?"
          className="resize-none min-h-[80px]"
        />
      </div>
    </div>
  );

  const renderEtapasTab = (projeto: ProjetoWithEtapas) => (
    <div className="space-y-2 p-1">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted-foreground">{projeto.etapas.length} etapa(s)</span>
        <Button size="sm" variant="outline" onClick={() => openAddEtapa(projeto.id)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar Etapa
        </Button>
      </div>
      {projeto.etapas.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Nenhuma etapa cadastrada.</p>
      ) : (
        <div className="space-y-1.5">
          {projeto.etapas.map(etapa => (
            <div key={etapa.id}
              className="flex items-center gap-2 p-2 rounded-md border bg-muted/30">
              <button onClick={() => cycleEtapaStatus(etapa.id, etapa.status)} className="shrink-0" title="Clique para avançar status">
                {getEtapaStatusIcon(etapa.status)}
              </button>
              <div className="flex-1 min-w-0">
                <span className={`text-sm font-medium ${etapa.status === "concluida" ? "line-through text-muted-foreground" : ""}`}>
                  {etapa.nome}
                </span>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                  {etapa.responsavel && <span>{etapa.responsavel}</span>}
                  {etapa.dataPrevista && <span className="flex items-center gap-0.5"><CalendarIcon className="h-3 w-3" />{format(new Date(etapa.dataPrevista + "T12:00:00"), "dd/MM")}</span>}
                  {etapa.estimativa != null && <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" />{etapa.estimativa}h</span>}
                </div>
                {etapa.observacao && <p className="text-xs text-orange-600 mt-0.5 truncate">{etapa.observacao}</p>}
              </div>
              <Badge variant={getEtapaStatusVariant(etapa.status)} className="text-xs shrink-0">
                {ETAPA_STATUS[etapa.status as EtapaStatus]}
              </Badge>
              <Button size="icon" variant="ghost" className="shrink-0 h-7 w-7" onClick={() => { setIsEditOpen(false); openEditEtapa(etapa); }}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="shrink-0 h-7 w-7" onClick={() => deleteEtapaMutation.mutate(etapa.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderEtapaForm = () => (
    <div className="space-y-4 py-2">
      {/* Nome + Status lado a lado */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2 space-y-2">
          <Label>Nome da Etapa <span className="text-destructive">*</span></Label>
          <Input
            value={etapaForm.nome}
            onChange={e => setEtapaForm({ ...etapaForm, nome: e.target.value })}
            placeholder="Nome da etapa"
            data-testid="input-etapa-nome"
          />
        </div>
        <div className="space-y-2">
          <Label>Status</Label>
          <Select
            value={etapaForm.status}
            onValueChange={v => setEtapaForm({ ...etapaForm, status: v as EtapaStatus })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ETAPA_STATUS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Responsável + Estimativa + Data lado a lado */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>Responsável</Label>
          <Input
            value={etapaForm.responsavel}
            onChange={e => setEtapaForm({ ...etapaForm, responsavel: e.target.value })}
            placeholder="Nome"
            data-testid="input-etapa-responsavel"
          />
        </div>
        <div className="space-y-2">
          <Label>Estimativa (h)</Label>
          <Input
            type="number"
            min="0"
            value={etapaForm.estimativa}
            onChange={e => setEtapaForm({ ...etapaForm, estimativa: e.target.value })}
            placeholder="Ex: 8"
          />
        </div>
        <div className="space-y-2">
          <Label>Data Prevista</Label>
          <Input
            type="date"
            value={etapaForm.dataPrevista}
            onChange={e => setEtapaForm({ ...etapaForm, dataPrevista: e.target.value })}
            data-testid="input-etapa-data"
          />
        </div>
      </div>

      {/* Descrição — campo principal de detalhamento */}
      <div className="space-y-2">
        <Label>Descrição <span className="text-muted-foreground text-xs">(detalhamento técnico, passos, referências)</span></Label>
        <Textarea
          value={etapaForm.descricao}
          onChange={e => setEtapaForm({ ...etapaForm, descricao: e.target.value })}
          placeholder="Descreva o que precisa ser feito nesta etapa, detalhes técnicos, links de referência, critérios de aceite..."
          className="min-h-[140px] resize-y"
          data-testid="input-etapa-descricao"
        />
      </div>

      {/* Observação / Bloqueio */}
      <div className="space-y-2">
        <Label>Observação / Bloqueio <span className="text-muted-foreground text-xs">(opcional)</span></Label>
        <Textarea
          value={etapaForm.observacao}
          onChange={e => setEtapaForm({ ...etapaForm, observacao: e.target.value })}
          placeholder="Registre aqui impedimentos, dependências externas, motivo do bloqueio ou qualquer anotação importante..."
          className="min-h-[90px] resize-y"
        />
      </div>
    </div>
  );

  // ── project detail view ───────────────────────────────────────────────────

  const renderProjectDetail = (projeto: ProjetoWithEtapas) => {
    const atrasado = isAtrasado(projeto);
    const atraso   = atrasado ? diasAtraso(projeto) : 0;
    const totalEst = projeto.etapas.reduce((s, e) => s + (e.estimativa ?? 0), 0);
    const concEst  = projeto.etapas.filter(e => e.status === "concluida").reduce((s, e) => s + (e.estimativa ?? 0), 0);

    return (
      <div className="space-y-6">

        {/* ── badges / meta ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 items-center">
          <Badge className={`${PROJETO_STATUS_COLORS[projeto.status as ProjetoStatus]} text-white`}>
            {PROJETO_STATUS[projeto.status as ProjetoStatus]}
          </Badge>
          {projeto.prioridade && (
            <Badge className={`${PROJETO_PRIORIDADE_COLORS[projeto.prioridade as ProjetoPrioridade]} text-white`}>
              {PROJETO_PRIORIDADE[projeto.prioridade as ProjetoPrioridade]} Prioridade
            </Badge>
          )}
          {atrasado && (
            <Badge className="bg-red-500 text-white gap-1">
              <AlertTriangle className="h-3 w-3" />
              {atraso} dia{atraso !== 1 ? "s" : ""} de atraso
            </Badge>
          )}
        </div>

        {/* ── info grid ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          {projeto.sprint && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1"><Zap className="h-3 w-3" /> Sprint</p>
              <p className="font-medium">{projeto.sprint}</p>
            </div>
          )}
          {projeto.responsavel && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1"><User className="h-3 w-3" /> Responsável</p>
              <p className="font-medium">{projeto.responsavel}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1"><Building2 className="h-3 w-3" /> Operação</p>
            <p className="font-medium">{projeto.operacao}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1"><CalendarIcon className="h-3 w-3" /> Início</p>
            <p className="font-medium">{format(new Date(projeto.dataInicio + "T12:00:00"), "dd/MM/yyyy")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1"><CalendarIcon className="h-3 w-3" /> Previsão</p>
            <p className={`font-medium ${atrasado ? "text-red-500" : ""}`}>
              {format(new Date(projeto.dataPrevisao + "T12:00:00"), "dd/MM/yyyy")}
            </p>
          </div>
          {projeto.dataConclusaoReal && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Conclusão real</p>
              <p className="font-medium text-green-600">{format(new Date(projeto.dataConclusaoReal + "T12:00:00"), "dd/MM/yyyy")}</p>
            </div>
          )}
        </div>

        {/* ── progresso ─────────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm font-medium">Progresso</span>
            <span className="text-sm font-bold">{projeto.progresso}%</span>
          </div>
          <Progress value={projeto.progresso} className="h-3" />
          {totalEst > 0 && (
            <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
              <Clock className="h-3 w-3" /> {concEst}/{totalEst}h estimadas concluídas
            </p>
          )}
        </div>

        {/* ── tags ──────────────────────────────────────────────────────── */}
        {projeto.tags && projeto.tags.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><Tag className="h-3 w-3" /> Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {projeto.tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}
            </div>
          </div>
        )}

        {/* ── descrição estruturada ─────────────────────────────────────── */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 border-b pb-1.5">
            <FileText className="h-4 w-4" /> Descrição
          </h3>
          {/* Escopo */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Escopo</p>
            {projeto.escopo
              ? <p className="text-sm leading-relaxed whitespace-pre-wrap bg-muted/40 rounded-md p-3 break-words">{projeto.escopo}</p>
              : <p className="text-sm text-muted-foreground italic bg-muted/20 rounded-md p-3">Não preenchido</p>}
          </div>
          {/* Contexto / Problema */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Contexto / Problema</p>
            {projeto.contexto
              ? <p className="text-sm leading-relaxed whitespace-pre-wrap bg-muted/40 rounded-md p-3 break-words">{projeto.contexto}</p>
              : <p className="text-sm text-muted-foreground italic bg-muted/20 rounded-md p-3">Não preenchido</p>}
          </div>
          {/* Fora de Escopo */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Fora de Escopo</p>
            {projeto.foraDeEscopo
              ? <p className="text-sm leading-relaxed whitespace-pre-wrap bg-muted/40 rounded-md p-3 break-words">{projeto.foraDeEscopo}</p>
              : <p className="text-sm text-muted-foreground italic bg-muted/20 rounded-md p-3">Não preenchido</p>}
          </div>
        </div>

        {/* ── etapas ────────────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between border-b pb-1.5 mb-3">
            <h3 className="text-sm font-semibold">Etapas ({projeto.etapas.length})</h3>
            <Button size="sm" variant="outline" onClick={() => openAddEtapa(projeto.id)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar Etapa
            </Button>
          </div>

          {projeto.etapas.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhuma etapa cadastrada.</p>
          ) : (
            <div className="space-y-3">
              {projeto.etapas.map((etapa, idx) => (
                <div
                  key={etapa.id}
                  className={`rounded-lg border p-4 space-y-3 ${
                    etapa.status === "bloqueado"  ? "border-red-300 bg-red-50/30 dark:bg-red-900/10" :
                    etapa.status === "concluida"  ? "border-green-200 bg-green-50/30 dark:bg-green-900/10 opacity-75" :
                    etapa.status === "em_revisao" ? "border-purple-200 bg-purple-50/30 dark:bg-purple-900/10" :
                    "bg-muted/20"
                  }`}
                  data-testid={`row-etapa-${etapa.id}`}
                >
                  {/* cabeçalho da etapa */}
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => cycleEtapaStatus(etapa.id, etapa.status)}
                      className="shrink-0 mt-0.5"
                      title="Avançar status"
                      data-testid={`button-toggle-etapa-${etapa.id}`}
                    >
                      {getEtapaStatusIcon(etapa.status)}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground font-mono">#{idx + 1}</span>
                        <span className={`font-medium text-sm ${etapa.status === "concluida" ? "line-through text-muted-foreground" : ""}`}>
                          {etapa.nome}
                        </span>
                        <Badge variant={getEtapaStatusVariant(etapa.status)} className="text-xs">
                          {ETAPA_STATUS[etapa.status as EtapaStatus]}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        {etapa.responsavel && (
                          <span className="flex items-center gap-1"><User className="h-3 w-3" />{etapa.responsavel}</span>
                        )}
                        {etapa.estimativa != null && (
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{etapa.estimativa}h estimadas</span>
                        )}
                        {etapa.dataPrevista && (
                          <span className="flex items-center gap-1">
                            <CalendarIcon className="h-3 w-3" />
                            Previsto: {format(new Date(etapa.dataPrevista + "T12:00:00"), "dd/MM/yyyy")}
                          </span>
                        )}
                        {etapa.dataInicioReal && (
                          <span className="flex items-center gap-1 text-blue-600">
                            <CalendarIcon className="h-3 w-3" />
                            Início real: {format(new Date(etapa.dataInicioReal + "T12:00:00"), "dd/MM/yyyy")}
                          </span>
                        )}
                        {etapa.dataConclusaoReal && (
                          <span className="flex items-center gap-1 text-green-600">
                            <CheckCircle2 className="h-3 w-3" />
                            Concluída: {format(new Date(etapa.dataConclusaoReal + "T12:00:00"), "dd/MM/yyyy")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEditEtapa(etapa)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deleteEtapaMutation.mutate(etapa.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* descrição da etapa */}
                  {etapa.descricao && (
                    <div className="ml-7">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Descrição</p>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/80">{etapa.descricao}</p>
                    </div>
                  )}

                  {/* observação / bloqueio */}
                  {etapa.observacao && (
                    <div className="ml-7 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-md p-2.5">
                      <p className="text-xs font-semibold text-orange-700 dark:text-orange-400 uppercase tracking-wide mb-0.5">
                        ⚠ Observação / Bloqueio
                      </p>
                      <p className="text-sm text-orange-800 dark:text-orange-300 whitespace-pre-wrap">{etapa.observacao}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── main render ───────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between gap-2 p-4 border-b flex-wrap">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Projetos</h1>
        </div>
        <Button onClick={() => { setProjetoForm(defaultProjetoForm()); setIsCreateOpen(true); }} data-testid="button-create-projeto">
          <Plus className="h-4 w-4 mr-2" />
          Novo Projeto
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Total</span>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-2xl font-bold" data-testid="text-projetos-total">{stats.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Em Andamento</span>
                <Loader2 className="h-4 w-4 text-yellow-500" />
              </div>
              <p className="text-2xl font-bold" data-testid="text-projetos-andamento">{stats.emAndamento}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Concluídos</span>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              </div>
              <p className="text-2xl font-bold" data-testid="text-projetos-concluidos">{stats.concluidos}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Atrasados</span>
                <AlertTriangle className="h-4 w-4 text-red-500" />
              </div>
              <p className="text-2xl font-bold text-red-500" data-testid="text-projetos-atrasados">{stats.atrasados}</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Buscar projeto..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="max-w-xs"
            data-testid="input-search-projeto"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44" data-testid="select-filter-status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {Object.entries(PROJETO_STATUS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {allSprints.length > 0 && (
            <Select value={sprintFilter} onValueChange={setSprintFilter}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Sprint" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as sprints</SelectItem>
                {allSprints.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}</div>
        ) : filteredProjetos.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <FolderKanban className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Nenhum projeto encontrado.</p>
              <p className="text-sm mt-1">Crie um novo projeto para começar.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredProjetos.map(projeto => {
              const atrasado = isAtrasado(projeto);
              const atraso   = atrasado ? diasAtraso(projeto) : 0;

              return (
                <Card
                  key={projeto.id}
                  data-testid={`card-projeto-${projeto.id}`}
                  className={`transition-shadow hover:shadow-md ${atrasado ? "border-red-300 dark:border-red-800" : ""}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      {/* info principal */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-semibold text-sm truncate" data-testid={`text-projeto-nome-${projeto.id}`}>
                            {projeto.nome}
                          </span>
                          {atrasado && (
                            <Badge className="bg-red-500 text-white gap-1 text-xs">
                              <AlertTriangle className="h-3 w-3" />
                              {atraso}d atraso
                            </Badge>
                          )}
                          <Badge className={`${PROJETO_STATUS_COLORS[projeto.status as ProjetoStatus]} text-white text-xs`} data-testid={`badge-status-${projeto.id}`}>
                            {PROJETO_STATUS[projeto.status as ProjetoStatus]}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            {projeto.operacao}
                          </span>
                          <span className="flex items-center gap-1">
                            <CalendarIcon className="h-3 w-3" />
                            {format(new Date(projeto.dataInicio + "T12:00:00"), "dd/MM/yyyy")} →{" "}
                            {format(new Date(projeto.dataPrevisao + "T12:00:00"), "dd/MM/yyyy")}
                          </span>
                          {projeto.etapas.length > 0 && (
                            <span className="text-muted-foreground">
                              {projeto.etapas.filter(e => e.status === "concluida").length}/{projeto.etapas.length} etapas
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <Progress value={projeto.progresso} className="flex-1 h-1.5" />
                          <span className="text-xs font-medium text-muted-foreground w-10 text-right shrink-0" data-testid={`text-progresso-${projeto.id}`}>
                            {projeto.progresso}%
                          </span>
                        </div>
                      </div>

                      {/* ações */}
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="default"
                          className="gap-1.5"
                          onClick={() => openViewDialog(projeto)}
                          data-testid={`button-open-${projeto.id}`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Abrir
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => openEditDialog(projeto)} data-testid={`button-edit-${projeto.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => openDeleteDialog(projeto)} data-testid={`button-delete-${projeto.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Create Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Novo Projeto</DialogTitle>
            <DialogDescription>Preencha os dados para criar um novo projeto.</DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="geral" className="flex-1 overflow-hidden flex flex-col">
            <TabsList className="shrink-0">
              <TabsTrigger value="geral">Geral</TabsTrigger>
              <TabsTrigger value="descricao">Descrição</TabsTrigger>
            </TabsList>
            <div className="flex-1 overflow-y-auto mt-2 pr-1">
              <TabsContent value="geral" className="mt-0">{renderProjetoGeralTab()}</TabsContent>
              <TabsContent value="descricao" className="mt-0">{renderProjetoDescricaoTab()}</TabsContent>
            </div>
          </Tabs>
          <DialogFooter className="gap-2 shrink-0 border-t pt-3 mt-2">
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleCreateProjeto}
              disabled={createProjetoMutation.isPending || !projetoForm.nome || !projetoForm.operacao}
              data-testid="button-confirm-create-projeto"
            >
              {createProjetoMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Criar Projeto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Dialog ───────────────────────────────────────────────────── */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Editar Projeto</DialogTitle>
            <DialogDescription>Altere os dados do projeto.</DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="geral" className="flex-1 overflow-hidden flex flex-col">
            <TabsList className="shrink-0">
              <TabsTrigger value="geral">Geral</TabsTrigger>
              <TabsTrigger value="descricao">Descrição</TabsTrigger>
              <TabsTrigger value="etapas">
                Etapas {selectedProjeto ? `(${selectedProjeto.etapas.length})` : ""}
              </TabsTrigger>
            </TabsList>
            <div className="flex-1 overflow-y-auto mt-2 pr-1">
              <TabsContent value="geral" className="mt-0">{renderProjetoGeralTab()}</TabsContent>
              <TabsContent value="descricao" className="mt-0">{renderProjetoDescricaoTab()}</TabsContent>
              <TabsContent value="etapas" className="mt-0">
                {selectedProjeto ? renderEtapasTab(selectedProjeto) : null}
              </TabsContent>
            </div>
          </Tabs>
          <DialogFooter className="gap-2 shrink-0 border-t pt-3 mt-2">
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleEditProjeto}
              disabled={updateProjetoMutation.isPending || !projetoForm.nome || !projetoForm.operacao}
              data-testid="button-confirm-edit-projeto"
            >
              {updateProjetoMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Dialog ─────────────────────────────────────────────────── */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Projeto</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o projeto "{selectedProjeto?.nome}"? Esta ação não pode ser desfeita e todas as etapas serão removidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedProjeto && deleteProjetoMutation.mutate(selectedProjeto.id)}
              data-testid="button-confirm-delete-projeto"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Add Etapa Dialog ──────────────────────────────────────────────── */}
      <Dialog open={isEtapaOpen} onOpenChange={setIsEtapaOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Adicionar Etapa</DialogTitle>
            <DialogDescription>Preencha os dados da nova etapa.</DialogDescription>
          </DialogHeader>
          {renderEtapaForm()}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsEtapaOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleCreateEtapa}
              disabled={createEtapaMutation.isPending || !etapaForm.nome}
              data-testid="button-confirm-create-etapa"
            >
              {createEtapaMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Etapa Dialog ─────────────────────────────────────────────── */}
      <Dialog open={isEditEtapaOpen} onOpenChange={setIsEditEtapaOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Editar Etapa</DialogTitle>
            <DialogDescription>Altere os dados da etapa.</DialogDescription>
          </DialogHeader>
          {renderEtapaForm()}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsEditEtapaOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleEditEtapa}
              disabled={updateEtapaMutation.isPending || !etapaForm.nome}
              data-testid="button-confirm-edit-etapa"
            >
              {updateEtapaMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── View Project Dialog ───────────────────────────────────────────── */}
      <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogTitle className="sr-only">{viewProjeto?.nome ?? "Detalhes do Projeto"}</DialogTitle>
          <DialogDescription className="sr-only">Visualização completa do projeto, etapas e descrição.</DialogDescription>
          {viewProjeto && (
            <>
              {/* header fixo */}
              <div className="flex items-start justify-between gap-3 px-6 py-5 border-b shrink-0">
                <div className="min-w-0 flex-1">
                  <p className="text-xl font-bold truncate">{viewProjeto.nome}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{viewProjeto.operacao}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => { setIsViewOpen(false); openEditDialog(viewProjeto); }}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </Button>
                </div>
              </div>

              {/* conteúdo scrollável */}
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {renderProjectDetail(viewProjeto)}
              </div>

              {/* footer fixo */}
              <div className="border-t px-6 py-3 shrink-0 flex justify-end">
                <Button variant="outline" onClick={() => setIsViewOpen(false)}>Fechar</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

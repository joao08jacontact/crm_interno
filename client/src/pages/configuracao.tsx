import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { 
  Users, Plus, Pencil, Trash2, UserX, UserCheck, ArrowRightLeft, Loader2, Shield, User as UserIcon, Clock, Save, Globe, CheckCircle2, XCircle, Eye, EyeOff, Send, Bot, Database, Zap, GitMerge
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AnalistaRole, Solicitante, SlaConfig, Task } from "@shared/schema";
import { OPERACOES, GLPI_PRIORITY } from "@shared/schema";

interface AnalistaDisplay {
  id: string;
  nome: string;
  role: AnalistaRole;
  ativo: boolean;
}

export default function ConfiguracaoPage() {
  const { toast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  
  // Solicitante states
  const [isSolicitanteCreateOpen, setIsSolicitanteCreateOpen] = useState(false);
  const [isSolicitanteDeleteOpen, setIsSolicitanteDeleteOpen] = useState(false);
  const [selectedSolicitante, setSelectedSolicitante] = useState<Solicitante | null>(null);
  const [solicitanteForm, setSolicitanteForm] = useState({
    nome: "",
    operacao: "",
    glpiUserId: "",
  });
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [selectedAnalista, setSelectedAnalista] = useState<AnalistaDisplay | null>(null);
  
  // SLA state
  const [slaValues, setSlaValues] = useState<Record<number, number>>({});
  const [slaChanged, setSlaChanged] = useState(false);

  // DB config state
  const [dbForm, setDbForm] = useState({ host: "", port: "5433", database: "", username: "", password: "" });
  const [dbTestResult, setDbTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showDbPassword, setShowDbPassword] = useState(false);

  // GLPI config state
  const [glpiForm, setGlpiForm] = useState({ apiUrl: "", appToken: "", userToken: "" });
  const [glpiTestResult, setGlpiTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showAppToken, setShowAppToken] = useState(false);
  const [showUserToken, setShowUserToken] = useState(false);

  // Disparos config state
  const [disparoForm, setDisparoForm] = useState({ apiUrl: "", apiToken: "" });
  const [showDisparoToken, setShowDisparoToken] = useState(false);
  const [rpaForm, setRpaForm] = useState({ url: "", email: "", senha: "" });
  const [showRpaSenha, setShowRpaSenha] = useState(false);
  const [reguaForm, setReguaForm] = useState({ projectId: "", dataset: "", credentialsJson: "", discadorKey: "", discadorUrl: "" });
  const [showReguaCredentials, setShowReguaCredentials] = useState(false);
  const [reguaTestResult, setReguaTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const [formData, setFormData] = useState({
    nome: "",
    senha: "",
    role: "analista_ti" as AnalistaRole,
    ativo: true,
  });

  const [transferData, setTransferData] = useState({
    deAnalistaId: "",
    paraAnalistaId: "",
    dataInicio: new Date(),
    dataFim: new Date(),
    usePeriod: false,
    selectedTaskId: "" as string,
  });

  const { data: analistas, isLoading } = useQuery<AnalistaDisplay[]>({
    queryKey: ["/api/analistas/all"],
  });

  const { data: solicitantes, isLoading: isLoadingSolicitantes } = useQuery<Solicitante[]>({
    queryKey: ["/api/solicitantes"],
  });

  const { data: slaConfig, isLoading: isLoadingSla } = useQuery<SlaConfig[]>({
    queryKey: ["/api/sla-config"],
  });

  const { data: dbConfig } = useQuery<{ host: string; port: number; database: string; username: string; hasConfig: boolean }>({
    queryKey: ["/api/db-config"],
  });

  useEffect(() => {
    if (dbConfig?.host && !dbForm.host) {
      setDbForm(prev => ({
        ...prev,
        host: dbConfig.host,
        port: String(dbConfig.port || 5433),
        database: dbConfig.database,
        username: dbConfig.username,
      }));
    }
  }, [dbConfig]);

  const saveDbConfigMutation = useMutation({
    mutationFn: async (data: typeof dbForm) => {
      const payload: Record<string, any> = { host: data.host, port: Number(data.port), database: data.database, username: data.username };
      if (data.password) payload.password = data.password;
      const res = await apiRequest("POST", "/api/db-config", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/db-config"] });
      toast({ title: "Configuração do banco salva!" });
      setDbForm(prev => ({ ...prev, password: "" }));
    },
    onError: () => toast({ title: "Erro ao salvar configuração", variant: "destructive" }),
  });

  const [discoverResult, setDiscoverResult] = useState<{ databases: string[]; connectedVia: string } | null>(null);

  const discoverDbMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/db-discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(dbForm.password ? { password: dbForm.password } : {}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível conectar");
      return json;
    },
    onSuccess: (data: any) => setDiscoverResult(data),
    onError: (e: any) => { setDiscoverResult(null); setDbTestResult({ ok: false, msg: `✘ ${e.message}` }); },
  });

  const testDbMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/db-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro de conexão");
      return json;
    },
    onSuccess: (data: any) => setDbTestResult({ ok: true, msg: `✔ Conexão OK — ${data.version?.split(" ").slice(0, 2).join(" ")}` }),
    onError: (e: any) => setDbTestResult({ ok: false, msg: `✘ ${e.message}` }),
  });

  const { data: glpiConfig } = useQuery<{ apiUrl: string; appToken: string; userToken: string; hasConfig: boolean }>({
    queryKey: ["/api/glpi-config"],
  });

  // Initialize GLPI form from stored config
  useEffect(() => {
    if (glpiConfig?.apiUrl && !glpiForm.apiUrl) {
      setGlpiForm(prev => ({ ...prev, apiUrl: glpiConfig.apiUrl }));
    }
  }, [glpiConfig]);

  const { data: disparoConfig } = useQuery<{ apiUrl: string; apiToken: string; hasConfig: boolean }>({
    queryKey: ["/api/disparo-config"],
  });

  useEffect(() => {
    if (disparoConfig?.apiUrl && !disparoForm.apiUrl) {
      setDisparoForm(prev => ({ ...prev, apiUrl: disparoConfig.apiUrl }));
    }
  }, [disparoConfig]);

  const { data: rpaConfig } = useQuery<{ url: string; email: string; senha: string }>({
    queryKey: ["/api/rpa-config"],
  });

  useEffect(() => {
    if (rpaConfig?.url && !rpaForm.url) {
      setRpaForm(prev => ({ ...prev, url: rpaConfig.url, email: rpaConfig.email ?? "" }));
    }
  }, [rpaConfig]);

  const saveRpaConfigMutation = useMutation({
    mutationFn: async (data: { url: string; email: string; senha: string }) => {
      const payload: Record<string, string> = { url: data.url, email: data.email };
      if (data.senha) payload.senha = data.senha;
      const response = await apiRequest("POST", "/api/rpa-config", payload);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rpa-config"] });
      toast({ title: "Configuração RPA salva com sucesso!" });
      setRpaForm(prev => ({ ...prev, senha: "" }));
    },
    onError: () => toast({ title: "Erro ao salvar configuração RPA", variant: "destructive" }),
  });

  const handleSaveRpaConfig = () => {
    if (!rpaForm.url) {
      toast({ title: "Informe a URL da plataforma", variant: "destructive" });
      return;
    }
    saveRpaConfigMutation.mutate(rpaForm);
  };

  // ── Régua Automática (BigQuery) config ──
  const { data: reguaConfigData } = useQuery<{ configured: boolean; projectId: string; dataset: string; discadorKey: string; discadorUrl: string }>({
    queryKey: ["/api/regua-config"],
  });

  useEffect(() => {
    if (reguaConfigData?.projectId && !reguaForm.projectId) {
      setReguaForm(prev => ({
        ...prev,
        projectId: reguaConfigData.projectId,
        dataset: reguaConfigData.dataset ?? "",
        discadorUrl: reguaConfigData.discadorUrl ?? "",
      }));
    }
  }, [reguaConfigData]);

  const saveReguaConfigMutation = useMutation({
    mutationFn: async (data: typeof reguaForm) => {
      const payload: Record<string, string> = { projectId: data.projectId, dataset: data.dataset, discadorUrl: data.discadorUrl };
      if (data.credentialsJson) payload.credentialsJson = data.credentialsJson;
      if (data.discadorKey) payload.discadorKey = data.discadorKey;
      const res = await apiRequest("POST", "/api/regua-config", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/regua-config"] });
      toast({ title: "Configuração BigQuery salva!" });
      setReguaForm(prev => ({ ...prev, credentialsJson: "", discadorKey: "" }));
    },
    onError: () => toast({ title: "Erro ao salvar configuração BigQuery", variant: "destructive" }),
  });

  const testReguaConfigMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/regua-config/test", {});
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro desconhecido");
      return json;
    },
    onSuccess: (data: any) => {
      setReguaTestResult({ ok: true, msg: `✔ Conexão OK — ${data.datasets?.length ?? 0} dataset(s) encontrado(s)` });
    },
    onError: (e: any) => {
      setReguaTestResult({ ok: false, msg: `✘ ${e.message}` });
    },
  });

  // Initialize SLA values from fetched config
  useEffect(() => {
    if (slaConfig && Object.keys(slaValues).length === 0) {
      const values: Record<number, number> = {};
      slaConfig.forEach(c => {
        values[c.prioridadeCode] = c.horasMaximas;
      });
      setSlaValues(values);
    }
  }, [slaConfig, slaValues]);

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await apiRequest("POST", "/api/analistas", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/analistas/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analistas"] });
      setIsCreateOpen(false);
      resetForm();
      toast({ title: "Analista criado com sucesso!" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao criar analista", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof formData> }) => {
      const response = await apiRequest("PATCH", `/api/analistas/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/analistas/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analistas"] });
      setIsEditOpen(false);
      setSelectedAnalista(null);
      resetForm();
      toast({ title: "Analista atualizado com sucesso!" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao atualizar analista", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/analistas/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/analistas/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analistas"] });
      setIsDeleteOpen(false);
      setSelectedAnalista(null);
      toast({ title: "Analista excluído com sucesso!" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao excluir analista", description: error.message, variant: "destructive" });
    },
  });

  const transferDateString = format(transferData.dataInicio, "yyyy-MM-dd");
  const transferOriginAnalista = analistas?.find(a => a.id === transferData.deAnalistaId);
  
  const { data: transferTasks = [] } = useQuery<Task[]>({
    queryKey: [`/api/tasks?ymd=${transferDateString}`],
    enabled: !!transferData.deAnalistaId && isTransferOpen,
  });

  const originTasks = transferTasks.filter(t => 
    transferOriginAnalista && t.responsavel === transferOriginAnalista.nome
  );

  const transferMutation = useMutation({
    mutationFn: async (data: { deAnalistaId: string; paraAnalistaId: string; dataInicio: string; dataFim?: string; taskId?: string }) => {
      const response = await apiRequest("POST", "/api/demandas/transfer", data);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === "string" && key.startsWith("/api/tasks");
      }});
      setIsTransferOpen(false);
      setTransferData({
        deAnalistaId: "",
        paraAnalistaId: "",
        dataInicio: new Date(),
        dataFim: new Date(),
        usePeriod: false,
        selectedTaskId: "",
      });
      toast({ 
        title: "Transferência concluída!", 
        description: `${data.transferidas} demanda(s) transferida(s).` 
      });
    },
    onError: (error: Error) => {
      toast({ title: "Erro na transferência", description: error.message, variant: "destructive" });
    },
  });

  const createSolicitanteMutation = useMutation({
    mutationFn: async (data: { nome: string; operacao: string; glpiUserId: number }) => {
      const response = await apiRequest("POST", "/api/solicitantes", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/solicitantes"] });
      setIsSolicitanteCreateOpen(false);
      setSolicitanteForm({ nome: "", operacao: "", glpiUserId: "" });
      toast({ title: "Solicitante cadastrado com sucesso!" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao cadastrar solicitante", description: error.message, variant: "destructive" });
    },
  });

  const deleteSolicitanteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/solicitantes/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/solicitantes"] });
      setIsSolicitanteDeleteOpen(false);
      setSelectedSolicitante(null);
      toast({ title: "Solicitante excluído com sucesso!" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao excluir solicitante", description: error.message, variant: "destructive" });
    },
  });

  const updateSlaMutation = useMutation({
    mutationFn: async (configs: SlaConfig[]) => {
      const response = await apiRequest("POST", "/api/sla-config", configs);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sla-config"] });
      setSlaChanged(false);
      toast({ title: "Configuração de SLA salva com sucesso!" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao salvar SLA", description: error.message, variant: "destructive" });
    },
  });

  const handleSlaChange = (prioridadeCode: number, value: string) => {
    const horas = parseInt(value) || 0;
    setSlaValues(prev => ({ ...prev, [prioridadeCode]: horas }));
    setSlaChanged(true);
  };

  const handleSaveSla = () => {
    const configs: SlaConfig[] = Object.entries(slaValues).map(([code, horas]) => ({
      prioridadeCode: parseInt(code),
      horasMaximas: horas,
    }));
    updateSlaMutation.mutate(configs);
  };

  const saveGlpiMutation = useMutation({
    mutationFn: async (data: { apiUrl: string; appToken: string; userToken: string }) => {
      const response = await apiRequest("POST", "/api/glpi-config", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/glpi-config"] });
      toast({ title: "Configuração do GLPI salva com sucesso!" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao salvar configuração", description: error.message, variant: "destructive" });
    },
  });

  const testGlpiMutation = useMutation({
    mutationFn: async (data: { apiUrl: string; appToken: string; userToken: string }) => {
      const response = await apiRequest("POST", "/api/glpi-config/test", data);
      return response.json();
    },
    onSuccess: (result: { success: boolean; message: string }) => {
      setGlpiTestResult(result);
    },
    onError: (error: Error) => {
      setGlpiTestResult({ success: false, message: error.message });
    },
  });

  const handleSaveGlpi = () => {
    const hasExistingConfig = glpiConfig?.hasConfig;
    if (!glpiForm.apiUrl) {
      toast({ title: "Preencha a URL do GLPI", variant: "destructive" });
      return;
    }
    if (!glpiForm.appToken && !hasExistingConfig) {
      toast({ title: "Preencha o App-Token", variant: "destructive" });
      return;
    }
    if (!glpiForm.userToken && !hasExistingConfig) {
      toast({ title: "Preencha o User-Token", variant: "destructive" });
      return;
    }
    saveGlpiMutation.mutate(glpiForm);
  };

  const handleTestGlpi = () => {
    if (!glpiForm.apiUrl || !glpiForm.appToken || !glpiForm.userToken) {
      toast({ title: "Preencha todos os campos para testar", variant: "destructive" });
      return;
    }
    setGlpiTestResult(null);
    testGlpiMutation.mutate(glpiForm);
  };

  const saveDisparoConfigMutation = useMutation({
    mutationFn: async (data: { apiUrl: string; apiToken: string }) => {
      const response = await apiRequest("POST", "/api/disparo-config", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/disparo-config"] });
      toast({ title: "Configuração de Disparos salva com sucesso!" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    },
  });

  const handleSaveDisparoConfig = () => {
    if (!disparoForm.apiUrl) {
      toast({ title: "Preencha a URL da API", variant: "destructive" });
      return;
    }
    saveDisparoConfigMutation.mutate(disparoForm);
  };

  const resetForm = () => {
    setFormData({ nome: "", senha: "", role: "analista_ti", ativo: true });
  };

  const handleCreateSolicitante = () => {
    const glpiId = parseInt(solicitanteForm.glpiUserId);
    if (!solicitanteForm.nome || !solicitanteForm.operacao || isNaN(glpiId)) {
      toast({ title: "Preencha todos os campos corretamente", variant: "destructive" });
      return;
    }
    createSolicitanteMutation.mutate({
      nome: solicitanteForm.nome,
      operacao: solicitanteForm.operacao,
      glpiUserId: glpiId,
    });
  };

  const handleCreate = () => {
    if (!formData.nome || !formData.senha) {
      toast({ title: "Preencha todos os campos", variant: "destructive" });
      return;
    }
    createMutation.mutate(formData);
  };

  const handleEdit = (analista: AnalistaDisplay) => {
    setSelectedAnalista(analista);
    setFormData({
      nome: analista.nome,
      senha: "",
      role: analista.role,
      ativo: analista.ativo,
    });
    setIsEditOpen(true);
  };

  const handleUpdate = () => {
    if (!selectedAnalista) return;
    const updates: Partial<typeof formData> = {
      nome: formData.nome,
      role: formData.role,
      ativo: formData.ativo,
    };
    if (formData.senha) {
      updates.senha = formData.senha;
    }
    updateMutation.mutate({ id: selectedAnalista.id, data: updates });
  };

  const handleToggleStatus = (analista: AnalistaDisplay) => {
    updateMutation.mutate({ 
      id: analista.id, 
      data: { ativo: !analista.ativo } 
    });
  };

  const handleDelete = (analista: AnalistaDisplay) => {
    setSelectedAnalista(analista);
    setIsDeleteOpen(true);
  };

  const handleTransfer = (taskId?: string) => {
    if (!transferData.deAnalistaId || !transferData.paraAnalistaId) {
      toast({ title: "Selecione os analistas", variant: "destructive" });
      return;
    }
    if (transferData.deAnalistaId === transferData.paraAnalistaId) {
      toast({ title: "Selecione analistas diferentes", variant: "destructive" });
      return;
    }
    transferMutation.mutate({
      deAnalistaId: transferData.deAnalistaId,
      paraAnalistaId: transferData.paraAnalistaId,
      dataInicio: format(transferData.dataInicio, "yyyy-MM-dd"),
      dataFim: transferData.usePeriod ? format(transferData.dataFim, "yyyy-MM-dd") : undefined,
      taskId: taskId || undefined,
    });
  };

  const activeAnalistas = analistas?.filter(a => a.ativo) || [];

  return (
    <div className="p-6 space-y-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6" />
            Configuração
          </h1>
          <p className="text-muted-foreground">Gerencie os analistas e transfira demandas</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle>Analistas</CardTitle>
              <CardDescription>Gerencie os analistas do sistema</CardDescription>
            </div>
            <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-analista">
              <Plus className="h-4 w-4 mr-2" />
              Novo Analista
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : analistas && analistas.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analistas.map((analista) => (
                    <TableRow key={analista.id} data-testid={`row-analista-${analista.id}`}>
                      <TableCell className="font-medium">{analista.nome}</TableCell>
                      <TableCell>
                        <Badge variant={analista.role === "admin" ? "default" : analista.role === "control_desk" ? "outline" : "secondary"}>
                          {analista.role === "admin" ? (
                            <><Shield className="h-3 w-3 mr-1" />Admin</>
                          ) : analista.role === "control_desk" ? (
                            <><UserIcon className="h-3 w-3 mr-1" />Control Desk</>
                          ) : (
                            <><UserIcon className="h-3 w-3 mr-1" />Analista de TI</>
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={analista.ativo ? "outline" : "destructive"}>
                          {analista.ativo ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(analista)}
                            title="Editar"
                            data-testid={`button-edit-${analista.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggleStatus(analista)}
                            title={analista.ativo ? "Inativar" : "Ativar"}
                            data-testid={`button-toggle-${analista.id}`}
                          >
                            {analista.ativo ? (
                              <UserX className="h-4 w-4 text-orange-500" />
                            ) : (
                              <UserCheck className="h-4 w-4 text-green-500" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(analista)}
                            title="Excluir"
                            data-testid={`button-delete-${analista.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                Nenhum analista cadastrado. Clique em "Novo Analista" para criar.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" />
              Transferir Demandas
            </CardTitle>
            <CardDescription>
              Transfira demandas de um analista para outro (férias, folga, etc.)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              className="w-full" 
              onClick={() => setIsTransferOpen(true)}
              disabled={activeAnalistas.length < 2}
              data-testid="button-open-transfer"
            >
              <ArrowRightLeft className="h-4 w-4 mr-2" />
              Transferir Demandas
            </Button>
            {activeAnalistas.length < 2 && (
              <p className="text-sm text-muted-foreground mt-2 text-center">
                É necessário pelo menos 2 analistas ativos para transferir demandas.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Seção de Solicitantes */}
      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Solicitantes (IDs GLPI)</CardTitle>
            <CardDescription>Cadastre os solicitantes para exibir o nome ao invés do ID</CardDescription>
          </div>
          <Button onClick={() => setIsSolicitanteCreateOpen(true)} data-testid="button-create-solicitante">
            <Plus className="h-4 w-4 mr-2" />
            Novo Solicitante
          </Button>
        </CardHeader>
        <CardContent>
          {isLoadingSolicitantes ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : solicitantes && solicitantes.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Operação</TableHead>
                  <TableHead>ID GLPI</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {solicitantes.map((sol) => (
                  <TableRow key={sol.id} data-testid={`row-solicitante-${sol.id}`}>
                    <TableCell className="font-medium">{sol.nome}</TableCell>
                    <TableCell>{sol.operacao}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{sol.glpiUserId}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setSelectedSolicitante(sol);
                          setIsSolicitanteDeleteOpen(true);
                        }}
                        title="Excluir"
                        data-testid={`button-delete-solicitante-${sol.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Nenhum solicitante cadastrado. Clique em "Novo Solicitante" para criar.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Seção de SLA */}
      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Configuração de SLA
            </CardTitle>
            <CardDescription>
              Defina o tempo máximo em horas para cada nível de prioridade dos chamados
            </CardDescription>
          </div>
          <Button 
            onClick={handleSaveSla} 
            disabled={!slaChanged || updateSlaMutation.isPending}
            data-testid="button-save-sla"
          >
            {updateSlaMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Salvar SLA
          </Button>
        </CardHeader>
        <CardContent>
          {isLoadingSla ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {[6, 5, 4, 3, 2, 1].map((code) => (
                <div key={code} className="flex items-center gap-3 p-3 border rounded-md">
                  <Badge 
                    className={`min-w-[100px] justify-center ${
                      code === 6 ? 'bg-red-700' :
                      code === 5 ? 'bg-red-500' :
                      code === 4 ? 'bg-orange-500' :
                      code === 3 ? 'bg-yellow-500' :
                      code === 2 ? 'bg-blue-400' :
                      'bg-gray-400'
                    } text-white`}
                  >
                    {GLPI_PRIORITY[code]}
                  </Badge>
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      type="number"
                      min={1}
                      value={slaValues[code] || ''}
                      onChange={(e) => handleSlaChange(code, e.target.value)}
                      className="w-20"
                      data-testid={`input-sla-${code}`}
                    />
                    <span className="text-sm text-muted-foreground">horas</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-sm text-muted-foreground mt-4">
            O SLA é calculado a partir da abertura do chamado + as horas configuradas para cada prioridade.
          </p>
        </CardContent>
      </Card>

      {/* Seção de Configuração GLPI */}
      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Configuração GLPI
            </CardTitle>
            <CardDescription>
              Configure os tokens de acesso à API do GLPI
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button 
              variant="outline"
              onClick={handleTestGlpi} 
              disabled={testGlpiMutation.isPending}
              data-testid="button-test-glpi"
            >
              {testGlpiMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Globe className="h-4 w-4 mr-2" />
              )}
              Testar Conexão
            </Button>
            <Button 
              onClick={handleSaveGlpi} 
              disabled={saveGlpiMutation.isPending}
              data-testid="button-save-glpi"
            >
              {saveGlpiMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Salvar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {glpiConfig?.hasConfig && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 border rounded-md">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span>Configuração atual: {glpiConfig.apiUrl} | App-Token: {glpiConfig.appToken} | User-Token: {glpiConfig.userToken}</span>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="glpi-url">URL da API REST do GLPI</Label>
              <Input
                id="glpi-url"
                placeholder="https://chamados.exemplo.com.br/apirest.php"
                value={glpiForm.apiUrl}
                onChange={(e) => setGlpiForm(prev => ({ ...prev, apiUrl: e.target.value }))}
                data-testid="input-glpi-url"
              />
              <p className="text-xs text-muted-foreground">
                Pode ser /apirest.php ou /glpi/apirest.php dependendo da instalação
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="glpi-app-token">App-Token</Label>
              <div className="flex gap-2">
                <Input
                  id="glpi-app-token"
                  type={showAppToken ? "text" : "password"}
                  placeholder={glpiConfig?.hasConfig ? "Já configurado - deixe vazio para manter" : "Cole o App-Token do GLPI"}
                  value={glpiForm.appToken}
                  onChange={(e) => setGlpiForm(prev => ({ ...prev, appToken: e.target.value }))}
                  data-testid="input-glpi-app-token"
                />
                <Button 
                  size="icon" 
                  variant="ghost" 
                  onClick={() => setShowAppToken(v => !v)}
                  data-testid="button-toggle-app-token"
                >
                  {showAppToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Criado em: GLPI {'>'} Configurar {'>'} Geral {'>'} API
                {glpiConfig?.hasConfig && glpiConfig.appToken && <span className="ml-2 text-green-600">(configurado: {glpiConfig.appToken})</span>}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="glpi-user-token">User-Token</Label>
              <div className="flex gap-2">
                <Input
                  id="glpi-user-token"
                  type={showUserToken ? "text" : "password"}
                  placeholder={glpiConfig?.hasConfig ? "Já configurado - deixe vazio para manter" : "Cole o User-Token do GLPI"}
                  value={glpiForm.userToken}
                  onChange={(e) => setGlpiForm(prev => ({ ...prev, userToken: e.target.value }))}
                  data-testid="input-glpi-user-token"
                />
                <Button 
                  size="icon" 
                  variant="ghost" 
                  onClick={() => setShowUserToken(v => !v)}
                  data-testid="button-toggle-user-token"
                >
                  {showUserToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Criado em: GLPI {'>'} Administração {'>'} Usuários {'>'} [usuário] {'>'} Configurações
                {glpiConfig?.hasConfig && glpiConfig.userToken && <span className="ml-2 text-green-600">(configurado: {glpiConfig.userToken})</span>}
              </p>
            </div>
            {glpiTestResult && (
              <div className={`flex items-center gap-2 p-3 border rounded-md ${glpiTestResult.success ? 'border-green-500 bg-green-500/10' : 'border-red-500 bg-red-500/10'}`}>
                {glpiTestResult.success ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
                )}
                <span className="text-sm">{glpiTestResult.message}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Seção de Configuração Disparos */}
      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Configuração — Disparos
            </CardTitle>
            <CardDescription>
              URL da API e token de autenticação usados por todos os disparos
            </CardDescription>
          </div>
          <Button
            onClick={handleSaveDisparoConfig}
            disabled={saveDisparoConfigMutation.isPending}
            data-testid="button-save-disparo-config"
          >
            {saveDisparoConfigMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Salvar
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {disparoConfig?.hasConfig && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 border rounded-md">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span>API configurada: {disparoConfig.apiUrl} | Token: {disparoConfig.apiToken}</span>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="disparo-url">URL da API de Disparos</Label>
              <Input
                id="disparo-url"
                type="url"
                placeholder="https://api.exemplo.com/v1/enviar"
                value={disparoForm.apiUrl}
                onChange={e => setDisparoForm(prev => ({ ...prev, apiUrl: e.target.value }))}
                data-testid="input-disparo-url"
              />
              <p className="text-xs text-muted-foreground">
                Esta URL será usada em todos os disparos. Cada linha da base CSV será enviada como um POST para esta URL.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="disparo-token">Token de Autenticação</Label>
              <div className="flex gap-2">
                <Input
                  id="disparo-token"
                  type={showDisparoToken ? "text" : "password"}
                  placeholder={disparoConfig?.hasConfig ? "Já configurado — deixe vazio para manter" : "Bearer token ou API Key"}
                  value={disparoForm.apiToken}
                  onChange={e => setDisparoForm(prev => ({ ...prev, apiToken: e.target.value }))}
                  data-testid="input-disparo-token"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowDisparoToken(s => !s)}
                  data-testid="button-toggle-disparo-token"
                >
                  {showDisparoToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Enviado como <code className="bg-muted px-1 rounded">Authorization: Bearer [token]</code> em cada chamada.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* RPA Config Card */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              Configuração — RPA ConnectaCX
            </CardTitle>
            <CardDescription>
              Credenciais para automação de disparos via navegador na plataforma ConnectaCX
            </CardDescription>
          </div>
          <Button
            onClick={handleSaveRpaConfig}
            disabled={saveRpaConfigMutation.isPending}
            data-testid="button-save-rpa-config"
          >
            {saveRpaConfigMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Salvar
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {rpaConfig?.url && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 border rounded-md">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span>RPA configurado: {rpaConfig.url} | {rpaConfig.email}</span>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="rpa-url">URL da Plataforma</Label>
              <Input
                id="rpa-url"
                type="url"
                placeholder="https://connectadesk-cogna.connectacx.com/sign-in"
                value={rpaForm.url}
                onChange={e => setRpaForm(prev => ({ ...prev, url: e.target.value }))}
                data-testid="input-rpa-url"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rpa-email">E-mail de Login</Label>
              <Input
                id="rpa-email"
                type="email"
                placeholder="usuario@empresa.com"
                value={rpaForm.email}
                onChange={e => setRpaForm(prev => ({ ...prev, email: e.target.value }))}
                data-testid="input-rpa-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rpa-senha">Senha</Label>
              <div className="flex gap-2">
                <Input
                  id="rpa-senha"
                  type={showRpaSenha ? "text" : "password"}
                  placeholder={rpaConfig?.senha ? "Já configurada — deixe vazio para manter" : "Senha de acesso"}
                  value={rpaForm.senha}
                  onChange={e => setRpaForm(prev => ({ ...prev, senha: e.target.value }))}
                  data-testid="input-rpa-senha"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowRpaSenha(s => !s)}
                  data-testid="button-toggle-rpa-senha"
                >
                  {showRpaSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Credenciais usadas pelo robô para fazer login automático na plataforma.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Régua Automática (BigQuery) Config Card */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <GitMerge className="h-5 w-5" />
              Régua Automática — BigQuery
            </CardTitle>
            <CardDescription>
              Credenciais da conta de serviço Google para acesso ao BigQuery. O JSON nunca é retornado pela API.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => testReguaConfigMutation.mutate()}
              disabled={testReguaConfigMutation.isPending || !reguaConfigData?.configured}
              data-testid="button-test-regua-config"
            >
              {testReguaConfigMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Testar
            </Button>
            <Button
              onClick={() => saveReguaConfigMutation.mutate(reguaForm)}
              disabled={saveReguaConfigMutation.isPending}
              data-testid="button-save-regua-config"
            >
              {saveReguaConfigMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Salvar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {reguaConfigData?.configured ? (
              <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded px-3 py-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>BigQuery configurado — Projeto: <strong>{reguaConfigData.projectId}</strong></span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded px-3 py-2">
                <XCircle className="h-4 w-4 shrink-0" />
                <span>Ainda não configurado — cole o JSON da conta de serviço abaixo</span>
              </div>
            )}

            {reguaTestResult && (
              <div className={`flex items-center gap-2 text-sm rounded px-3 py-2 border ${reguaTestResult.ok ? "text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-900/20 dark:border-green-800" : "text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-800"}`}>
                {reguaTestResult.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                <span>{reguaTestResult.msg}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="regua-project-id">Project ID (BigQuery)</Label>
                <Input
                  id="regua-project-id"
                  placeholder="ex: gen-lang-client-0301889503"
                  value={reguaForm.projectId}
                  onChange={e => setReguaForm(prev => ({ ...prev, projectId: e.target.value }))}
                  data-testid="input-regua-project-id"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="regua-dataset">Dataset padrão</Label>
                <Input
                  id="regua-dataset"
                  placeholder="ex: jacontactcenter"
                  value={reguaForm.dataset}
                  onChange={e => setReguaForm(prev => ({ ...prev, dataset: e.target.value }))}
                  data-testid="input-regua-dataset"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="regua-credentials">
                JSON da Conta de Serviço Google
                <span className="ml-2 text-xs text-muted-foreground font-normal">(segredo — nunca exibido após salvar)</span>
              </Label>
              <div className="relative">
                <textarea
                  id="regua-credentials"
                  rows={showReguaCredentials ? 8 : 3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono shadow-sm resize-y placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder={reguaConfigData?.configured
                    ? '{"type":"service_account",...} — deixe vazio para manter o JSON atual'
                    : 'Cole aqui o conteúdo completo do arquivo JSON da conta de serviço...'}
                  value={reguaForm.credentialsJson}
                  onChange={e => setReguaForm(prev => ({ ...prev, credentialsJson: e.target.value }))}
                  data-testid="textarea-regua-credentials"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute top-2 right-2 h-7 text-xs"
                  onClick={() => setShowReguaCredentials(s => !s)}
                  data-testid="button-toggle-regua-credentials"
                >
                  {showReguaCredentials ? <EyeOff className="h-3.5 w-3.5 mr-1" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
                  {showReguaCredentials ? "Recolher" : "Expandir"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                O JSON é armazenado no servidor e nunca enviado ao navegador. Clique em <strong>Testar</strong> para validar a conexão.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2 border-t">
              <div className="space-y-2">
                <Label htmlFor="regua-discador-url">URL do Discador ibridge</Label>
                <Input
                  id="regua-discador-url"
                  placeholder="https://kroton-crm.ibridge.net.br/api/v2/"
                  value={reguaForm.discadorUrl}
                  onChange={e => setReguaForm(prev => ({ ...prev, discadorUrl: e.target.value }))}
                  data-testid="input-regua-discador-url"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="regua-discador-key">
                  Chave da API ibridge
                  <span className="ml-2 text-xs text-muted-foreground font-normal">(segredo — deixe vazio para manter)</span>
                </Label>
                <Input
                  id="regua-discador-key"
                  type="password"
                  placeholder={reguaConfigData?.discadorKey || "****xxxx"}
                  value={reguaForm.discadorKey}
                  onChange={e => setReguaForm(prev => ({ ...prev, discadorKey: e.target.value }))}
                  data-testid="input-regua-discador-key"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Seção de Banco de Dados */}
      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Banco de Dados PostgreSQL
            </CardTitle>
            <CardDescription>Configure a conexão com o banco de dados externo</CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => { setDiscoverResult(null); setDbTestResult(null); discoverDbMutation.mutate(); }} disabled={discoverDbMutation.isPending || !dbForm.host} data-testid="button-discover-db">
              {discoverDbMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Database className="h-4 w-4 mr-2" />}
              Descobrir Bancos
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setDbTestResult(null); testDbMutation.mutate(); }} disabled={testDbMutation.isPending} data-testid="button-test-db">
              {testDbMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Testar Conexão
            </Button>
            <Button size="sm" onClick={() => saveDbConfigMutation.mutate(dbForm)} disabled={saveDbConfigMutation.isPending} data-testid="button-save-db">
              {saveDbConfigMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Salvar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {dbTestResult && (
            <div className={`flex items-center gap-2 p-3 rounded-md text-sm ${dbTestResult.ok ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
              {dbTestResult.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
              {dbTestResult.msg}
            </div>
          )}
          {discoverResult && (
            <div className="p-3 rounded-md bg-blue-500/10 border border-blue-500/20 space-y-2">
              <p className="text-xs font-medium text-blue-500">Bancos encontrados (via <code>{discoverResult.connectedVia}</code>) — clique para selecionar:</p>
              <div className="flex flex-wrap gap-2">
                {discoverResult.databases.map(db => (
                  <button
                    key={db}
                    onClick={() => { setDbForm(p => ({ ...p, database: db })); setDiscoverResult(null); }}
                    className={`px-2 py-1 rounded text-xs font-mono border transition-colors hover:bg-primary hover:text-primary-foreground ${dbForm.database === db ? "bg-primary text-primary-foreground" : "bg-muted border-border"}`}
                    data-testid={`button-select-db-${db}`}
                  >
                    {db}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="db-host">Host</Label>
              <Input id="db-host" placeholder="177.104.183.92" value={dbForm.host} onChange={e => setDbForm(p => ({ ...p, host: e.target.value }))} data-testid="input-db-host" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="db-port">Porta</Label>
              <Input id="db-port" placeholder="5433" value={dbForm.port} onChange={e => setDbForm(p => ({ ...p, port: e.target.value }))} data-testid="input-db-port" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="db-database">Database</Label>
            <Input id="db-database" placeholder="ja_dados" value={dbForm.database} onChange={e => setDbForm(p => ({ ...p, database: e.target.value }))} data-testid="input-db-database" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="db-username">Usuário</Label>
              <Input id="db-username" placeholder="datahub_user" value={dbForm.username} onChange={e => setDbForm(p => ({ ...p, username: e.target.value }))} data-testid="input-db-username" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="db-password">Senha <span className="text-xs text-muted-foreground font-normal">(deixe vazio para manter)</span></Label>
              <div className="relative">
                <Input id="db-password" type={showDbPassword ? "text" : "password"} placeholder="••••••••" value={dbForm.password} onChange={e => setDbForm(p => ({ ...p, password: e.target.value }))} data-testid="input-db-password" className="pr-10" />
                <Button variant="ghost" size="icon" className="absolute right-0 top-0 h-full px-3" onClick={() => setShowDbPassword(s => !s)} type="button">
                  {showDbPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dialog para criar solicitante */}
      <Dialog open={isSolicitanteCreateOpen} onOpenChange={setIsSolicitanteCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Solicitante</DialogTitle>
            <DialogDescription>Cadastre o nome correspondente ao ID do GLPI.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="sol-nome">Nome</Label>
              <Input
                id="sol-nome"
                value={solicitanteForm.nome}
                onChange={(e) => setSolicitanteForm({ ...solicitanteForm, nome: e.target.value })}
                placeholder="Nome do solicitante"
                data-testid="input-solicitante-nome"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sol-operacao">Operação</Label>
              <Select 
                value={solicitanteForm.operacao} 
                onValueChange={(v) => setSolicitanteForm({ ...solicitanteForm, operacao: v })}
              >
                <SelectTrigger data-testid="select-solicitante-operacao">
                  <SelectValue placeholder="Selecione a operação" />
                </SelectTrigger>
                <SelectContent>
                  {OPERACOES.map((op) => (
                    <SelectItem key={op} value={op}>{op}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sol-glpiId">ID do GLPI</Label>
              <Input
                id="sol-glpiId"
                type="number"
                value={solicitanteForm.glpiUserId}
                onChange={(e) => setSolicitanteForm({ ...solicitanteForm, glpiUserId: e.target.value })}
                placeholder="Ex: 17"
                data-testid="input-solicitante-glpiid"
              />
              <p className="text-xs text-muted-foreground">
                Este é o ID do usuário no GLPI (solicitanteId nos chamados)
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSolicitanteCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreateSolicitante} disabled={createSolicitanteMutation.isPending} data-testid="button-confirm-create-solicitante">
              {createSolicitanteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AlertDialog para excluir solicitante */}
      <AlertDialog open={isSolicitanteDeleteOpen} onOpenChange={setIsSolicitanteDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Solicitante</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o solicitante "{selectedSolicitante?.nome}"?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedSolicitante && deleteSolicitanteMutation.mutate(selectedSolicitante.id)}
              className="bg-red-500 hover:bg-red-600"
              data-testid="button-confirm-delete-solicitante"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Analista</DialogTitle>
            <DialogDescription>Preencha os dados para criar um novo analista.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="nome">Nome</Label>
              <Input
                id="nome"
                value={formData.nome}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                placeholder="Nome completo"
                data-testid="input-nome"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="senha">Senha</Label>
              <Input
                id="senha"
                type="password"
                value={formData.senha}
                onChange={(e) => setFormData({ ...formData, senha: e.target.value })}
                placeholder="Mínimo 4 caracteres"
                data-testid="input-senha"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Tipo</Label>
              <Select 
                value={formData.role} 
                onValueChange={(v) => setFormData({ ...formData, role: v as AnalistaRole })}
              >
                <SelectTrigger data-testid="select-role">
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="analista_ti">Analista de TI</SelectItem>
                  <SelectItem value="control_desk">Control Desk</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-save-analista">
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Analista</DialogTitle>
            <DialogDescription>Altere os dados do analista. Deixe a senha em branco para não alterar.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-nome">Nome</Label>
              <Input
                id="edit-nome"
                value={formData.nome}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                placeholder="Nome completo"
                data-testid="input-edit-nome"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-senha">Nova Senha (opcional)</Label>
              <Input
                id="edit-senha"
                type="password"
                value={formData.senha}
                onChange={(e) => setFormData({ ...formData, senha: e.target.value })}
                placeholder="Deixe em branco para manter"
                data-testid="input-edit-senha"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">Tipo</Label>
              <Select 
                value={formData.role} 
                onValueChange={(v) => setFormData({ ...formData, role: v as AnalistaRole })}
              >
                <SelectTrigger data-testid="select-edit-role">
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="analista_ti">Analista de TI</SelectItem>
                  <SelectItem value="control_desk">Control Desk</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select 
                value={formData.ativo ? "ativo" : "inativo"} 
                onValueChange={(v) => setFormData({ ...formData, ativo: v === "ativo" })}
              >
                <SelectTrigger data-testid="select-edit-status">
                  <SelectValue placeholder="Selecione o status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="inativo">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancelar</Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending} data-testid="button-update-analista">
              {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o analista "{selectedAnalista?.nome}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => selectedAnalista && deleteMutation.mutate(selectedAnalista.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isTransferOpen} onOpenChange={setIsTransferOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Transferir Demandas</DialogTitle>
            <DialogDescription>
              Transfira demandas de um analista para outro. Selecione uma demanda específica ou transfira todas de uma data/período.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>De (analista de origem)</Label>
              <Select 
                value={transferData.deAnalistaId} 
                onValueChange={(v) => setTransferData({ ...transferData, deAnalistaId: v, selectedTaskId: "" })}
              >
                <SelectTrigger data-testid="select-transfer-from">
                  <SelectValue placeholder="Selecione o analista" />
                </SelectTrigger>
                <SelectContent>
                  {activeAnalistas.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Para (analista de destino)</Label>
              <Select 
                value={transferData.paraAnalistaId} 
                onValueChange={(v) => setTransferData({ ...transferData, paraAnalistaId: v })}
              >
                <SelectTrigger data-testid="select-transfer-to">
                  <SelectValue placeholder="Selecione o analista" />
                </SelectTrigger>
                <SelectContent>
                  {activeAnalistas
                    .filter(a => a.id !== transferData.deAnalistaId)
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="usePeriod"
                checked={transferData.usePeriod}
                onChange={(e) => setTransferData({ ...transferData, usePeriod: e.target.checked })}
                className="h-4 w-4"
              />
              <Label htmlFor="usePeriod">Usar período (de - até)</Label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{transferData.usePeriod ? "Data Início" : "Data"}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      {format(transferData.dataInicio, "dd/MM/yyyy", { locale: ptBR })}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={transferData.dataInicio}
                      onSelect={(d) => d && setTransferData({ ...transferData, dataInicio: d })}
                      locale={ptBR}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              {transferData.usePeriod && (
                <div className="space-y-2">
                  <Label>Data Fim</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left font-normal">
                        {format(transferData.dataFim, "dd/MM/yyyy", { locale: ptBR })}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={transferData.dataFim}
                        onSelect={(d) => d && setTransferData({ ...transferData, dataFim: d })}
                        locale={ptBR}
                        disabled={(date) => date < transferData.dataInicio}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>
          </div>
          {transferData.deAnalistaId && transferData.paraAnalistaId && transferData.deAnalistaId !== transferData.paraAnalistaId && originTasks.length > 0 && (
            <div className="space-y-2">
              <Label>Selecionar demanda específica (opcional)</Label>
              <Select
                value={transferData.selectedTaskId}
                onValueChange={(v) => setTransferData({ ...transferData, selectedTaskId: v })}
              >
                <SelectTrigger data-testid="select-transfer-task">
                  <SelectValue placeholder="Todas as demandas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as demandas ({originTasks.length})</SelectItem>
                  {originTasks.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.titulo} ({t.inicio})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsTransferOpen(false)}>Cancelar</Button>
            <Button 
              onClick={() => handleTransfer(transferData.selectedTaskId && transferData.selectedTaskId !== "all" ? transferData.selectedTaskId : undefined)} 
              disabled={transferMutation.isPending} 
              data-testid="button-confirm-transfer"
            >
              {transferMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {transferData.selectedTaskId && transferData.selectedTaskId !== "all" ? "Transferir Demanda" : "Transferir Todas"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

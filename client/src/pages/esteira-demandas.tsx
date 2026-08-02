import { useState, useEffect } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, addDays, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Plus, ChevronLeft, ChevronRight, Trash2, Clock, User, Building2, Filter, AlertTriangle, CheckCircle2, Pencil, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { type Task, OPERACOES, DIAS_SEMANA } from "@shared/schema";

interface AnalistaOption {
  id: string;
  nome: string;
  role: "admin" | "control_desk" | "analista_ti";
  ativo: boolean;
}

type TaskStatus = "concluida" | "atrasada" | "em_dia";

function getTaskStatus(task: Task, currentTime: Date): TaskStatus {
  if (task.concluida) return "concluida";
  
  const [fimHour, fimMin] = task.fim.split(":").map(Number);
  const taskEndTime = new Date(currentTime);
  taskEndTime.setHours(fimHour, fimMin, 0, 0);
  
  if (currentTime > taskEndTime) return "atrasada";
  return "em_dia";
}

function getTimeDiff(task: Task, currentTime: Date): string {
  if (task.concluida) return "";
  
  const [fimHour, fimMin] = task.fim.split(":").map(Number);
  const taskEndTime = new Date(currentTime);
  taskEndTime.setHours(fimHour, fimMin, 0, 0);
  
  const diffMs = taskEndTime.getTime() - currentTime.getTime();
  const diffMins = Math.floor(Math.abs(diffMs) / 60000);
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  
  const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  
  return diffMs < 0 ? `-${timeStr}` : timeStr;
}

function StatusBadge({ status }: { status: TaskStatus }) {
  if (status === "concluida") {
    return <Badge className="bg-green-600 text-white">Concluída</Badge>;
  }
  if (status === "atrasada") {
    return <Badge className="bg-red-600 text-white">Atrasada</Badge>;
  }
  return <Badge className="bg-blue-600 text-white">Em dia</Badge>;
}

export default function EsteiraDemandas() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [filterResponsavel, setFilterResponsavel] = useState<string>("all");
  const [filterOperacao, setFilterOperacao] = useState<string>("all");
  const [recKind, setRecKind] = useState<string>("once");
  const [weekDay, setWeekDay] = useState<number>(1);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitulo, setEditTitulo] = useState("");
  const [editInicio, setEditInicio] = useState("");
  const [editFim, setEditFim] = useState("");
  const [editOperacao, setEditOperacao] = useState("");
  const [editResponsavel, setEditResponsavel] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 30000);
    return () => clearInterval(interval);
  }, []);

  const dateString = format(selectedDate, "yyyy-MM-dd");

  const { data: analistas = [] } = useQuery<AnalistaOption[]>({
    queryKey: ["/api/analistas/all"],
  });

  // Only show Control Desk and Analista de TI in columns (not Admin)
  const responsaveis = analistas
    .filter(a => a.ativo && (a.role === "control_desk" || a.role === "analista_ti"))
    .map(a => a.nome);

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: [`/api/tasks?ymd=${dateString}`],
  });

  const createMutation = useMutation({
    mutationFn: async (data: Omit<Task, "id">) => {
      return apiRequest("POST", "/api/tasks", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tasks?ymd=${dateString}`] });
      setIsDialogOpen(false);
      setRecKind("once");
      toast({ title: "Tarefa criada com sucesso!" });
    },
    onError: () => {
      toast({ title: "Erro ao criar tarefa", variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, concluida }: { id: string; concluida: boolean }) => {
      return apiRequest("PATCH", `/api/tasks/${id}`, { concluida });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/tasks") });
      setSelectedTask(null);
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Task> }) => {
      return apiRequest("PATCH", `/api/tasks/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/tasks") });
      setIsEditing(false);
      setSelectedTask(null);
      toast({ title: "Tarefa atualizada com sucesso!" });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar tarefa", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/tasks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tasks?ymd=${dateString}`] });
      toast({ title: "Tarefa excluída!" });
    },
  });

  const deleteSeriesMutation = useMutation({
    mutationFn: async (id: string) => {
      // Extract original ID from virtual ID if needed (format: originalId_YYYY-MM-DD)
      const originalId = id.includes('_') ? id.split('_').slice(0, -1).join('_') : id;
      return apiRequest("DELETE", `/api/tasks/${originalId}/series`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tasks?ymd=${dateString}`] });
      toast({ title: "Série de tarefas excluída!" });
    },
  });

  const startEditing = (task: Task) => {
    setEditTitulo(task.titulo);
    setEditInicio(task.inicio);
    setEditFim(task.fim);
    setEditOperacao(task.operacao);
    setEditResponsavel(task.responsavel);
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (!selectedTask || !editTitulo.trim()) return;
    editMutation.mutate({
      id: selectedTask.id,
      updates: {
        titulo: editTitulo,
        inicio: editInicio,
        fim: editFim,
        operacao: editOperacao,
        responsavel: editResponsavel,
      },
    });
  };

  const handleDeleteTask = (task: Task) => {
    // Check if it's a recurring task (daily or weekly)
    const isRecurring = task.recKind === 'daily' || task.recKind === 'weekly';
    if (isRecurring) {
      setDeleteConfirmOpen(true);
    } else {
      deleteMutation.mutate(task.id);
      setSelectedTask(null);
    }
  };

  const handleDeleteThisOnly = () => {
    if (selectedTask) {
      deleteMutation.mutate(selectedTask.id);
      setSelectedTask(null);
      setDeleteConfirmOpen(false);
    }
  };

  const handleDeleteAllSeries = () => {
    if (selectedTask) {
      deleteSeriesMutation.mutate(selectedTask.id);
      setSelectedTask(null);
      setDeleteConfirmOpen(false);
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const responsavel = formData.get("responsavel") as string;
    if (!responsavel) {
      toast({ title: "Selecione um responsável", variant: "destructive" });
      return;
    }
    
    // Calculate correct ymd for weekly tasks
    let taskYmd = dateString;
    if (recKind === "weekly") {
      // Find the next occurrence of the selected weekday starting from selectedDate
      const baseDate = selectedDate;
      const currentDayOfWeek = baseDate.getDay(); // 0 = Sunday, 1 = Monday, etc
      let daysUntilTarget = weekDay - currentDayOfWeek;
      if (daysUntilTarget < 0) {
        daysUntilTarget += 7; // Next week
      }
      const targetDate = addDays(baseDate, daysUntilTarget);
      taskYmd = format(targetDate, "yyyy-MM-dd");
    }
    
    createMutation.mutate({
      titulo: formData.get("titulo") as string,
      inicio: formData.get("inicio") as string,
      fim: formData.get("fim") as string,
      responsavel,
      operacao: formData.get("operacao") as string,
      concluida: false,
      ymd: taskYmd,
      recKind: recKind as "once" | "daily" | "weekly",
      weekDay: recKind === "weekly" ? weekDay : undefined,
      createdAt: Date.now(),
    });
  };

  const goToPreviousDay = () => setSelectedDate(subDays(selectedDate, 1));
  const goToNextDay = () => setSelectedDate(addDays(selectedDate, 1));
  const goToToday = () => setSelectedDate(new Date());

  const filteredTasks = tasks.filter(task => {
    if (filterResponsavel !== "all" && task.responsavel !== filterResponsavel) return false;
    if (filterOperacao !== "all" && task.operacao !== filterOperacao) return false;
    return true;
  });

  const tasksByResponsavel = responsaveis.reduce((acc, resp) => {
    acc[resp] = filteredTasks.filter(t => t.responsavel === resp);
    return acc;
  }, {} as Record<string, Task[]>);

  const tasksByOperacao = OPERACOES.reduce((acc, op) => {
    const count = filteredTasks.filter(t => t.operacao === op).length;
    if (count > 0) acc[op] = count;
    return acc;
  }, {} as Record<string, number>);

  const totalByResponsavel = responsaveis.map(resp => ({
    name: resp,
    count: filteredTasks.filter(t => t.responsavel === resp).length
  }));

  const handleDownloadReport = () => {
    if (filteredTasks.length === 0) {
      toast({ title: "Nenhuma tarefa para exportar", variant: "destructive" });
      return;
    }

    const now = new Date();
    const headers = [
      "Responsável",
      "Título",
      "Operação",
      "Início",
      "Fim",
      "Status",
      "Tempo Restante / Atraso",
      "Recorrência",
      "Finalizado em",
      "Data",
    ];

    const statusLabel = (task: Task) => {
      const s = getTaskStatus(task, now);
      if (s === "concluida") return "Concluída";
      if (s === "atrasada") return "Atrasada";
      return "Em dia";
    };

    const recLabel = (task: Task) => {
      if (task.recKind === "daily") return "Diária";
      if (task.recKind === "weekly") return `Semanal (${DIAS_SEMANA[task.weekDay ?? 0]})`;
      return "Única";
    };

    const escCsv = (val: string) => {
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const rows = filteredTasks
      .sort((a, b) => a.responsavel.localeCompare(b.responsavel) || a.inicio.localeCompare(b.inicio))
      .map(task => [
        escCsv(task.responsavel),
        escCsv(task.titulo),
        escCsv(task.operacao),
        task.inicio,
        task.fim,
        statusLabel(task),
        task.concluida ? "" : getTimeDiff(task, now),
        recLabel(task),
        task.completedAt ? format(new Date(task.completedAt), "dd/MM/yyyy HH:mm") : "",
        format(selectedDate, "dd/MM/yyyy"),
      ].join(","));

    const bom = "\uFEFF";
    const csv = bom + headers.join(",") + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio-esteira-${dateString}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast({ title: "Relatório baixado com sucesso!" });
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between gap-4 p-4 border-b bg-card flex-wrap">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-semibold">Esteira de Demandas</h1>
            <p className="text-sm text-muted-foreground">Gestão de tarefas operacionais</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={goToPreviousDay} data-testid="button-prev-day">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={goToToday} data-testid="button-today">
            Hoje
          </Button>
          <div className="px-4 py-2 bg-muted rounded-md min-w-[180px] text-center">
            <span className="font-medium">
              {format(selectedDate, "EEEE, dd 'de' MMMM", { locale: ptBR })}
            </span>
          </div>
          <Button variant="outline" size="icon" onClick={goToNextDay} data-testid="button-next-day">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={handleDownloadReport}
            disabled={filteredTasks.length === 0}
            data-testid="button-download-report"
          >
            <Download className="h-4 w-4 mr-2" />
            Relatório
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-task" disabled={responsaveis.length === 0}>
                <Plus className="h-4 w-4 mr-2" />
                Nova Tarefa
              </Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova Tarefa</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="titulo">Título</Label>
                <Input
                  id="titulo"
                  name="titulo"
                  placeholder="Descrição da tarefa"
                  required
                  data-testid="input-titulo"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="inicio">Início</Label>
                  <Input
                    id="inicio"
                    name="inicio"
                    type="time"
                    defaultValue="09:00"
                    required
                    data-testid="input-inicio"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fim">Fim</Label>
                  <Input
                    id="fim"
                    name="fim"
                    type="time"
                    defaultValue="10:00"
                    required
                    data-testid="input-fim"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Recorrência</Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={recKind === "once" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setRecKind("once")}
                    data-testid="rec-once"
                  >
                    Apenas uma vez
                  </Button>
                  <Button
                    type="button"
                    variant={recKind === "daily" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setRecKind("daily")}
                    data-testid="rec-daily"
                  >
                    Todos os dias
                  </Button>
                  <Button
                    type="button"
                    variant={recKind === "weekly" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setRecKind("weekly")}
                    data-testid="rec-weekly"
                  >
                    Uma vez por semana
                  </Button>
                </div>
              </div>

              {recKind === "weekly" && (
                <div className="space-y-2">
                  <Label>Qual dia da semana?</Label>
                  <div className="flex flex-wrap gap-2">
                    {DIAS_SEMANA.map((dia, idx) => (
                      <Button
                        key={idx}
                        type="button"
                        variant={weekDay === idx ? "default" : "outline"}
                        size="sm"
                        onClick={() => setWeekDay(idx)}
                        data-testid={`weekday-${idx}`}
                      >
                        {dia}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="responsavel">Responsável</Label>
                {responsaveis.length === 0 ? (
                  <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                    <AlertTriangle className="h-4 w-4 inline mr-2" />
                    Nenhum analista disponível. Cadastre analistas com role "Control Desk" ou "Analista de TI" na página de Configuração.
                  </div>
                ) : (
                  <Select name="responsavel" defaultValue={responsaveis[0] || ""}>
                    <SelectTrigger data-testid="select-responsavel">
                      <SelectValue placeholder="Selecione o responsável" />
                    </SelectTrigger>
                    <SelectContent>
                      {responsaveis.map((resp) => (
                        <SelectItem key={resp} value={resp}>
                          {resp}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="operacao">Operação</Label>
                <Select name="operacao" defaultValue={OPERACOES[0]}>
                  <SelectTrigger data-testid="select-operacao">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPERACOES.map((op) => (
                      <SelectItem key={op} value={op}>
                        {op}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createMutation.isPending || responsaveis.length === 0} data-testid="button-submit-task">
                  {createMutation.isPending ? "Criando..." : "Criar Tarefa"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4">
        <div className="flex flex-wrap items-center gap-4 mb-4 p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Filtros:</span>
          </div>
          <SearchableSelect
            value={filterResponsavel}
            onValueChange={setFilterResponsavel}
            options={[
              { value: "all", label: "Todos os responsáveis" },
              ...responsaveis.map(resp => ({ value: resp, label: resp })),
            ]}
            placeholder="Responsável"
            searchPlaceholder="Pesquisar responsável..."
            triggerClassName="w-[180px]"
            data-testid="filter-responsavel"
          />
          <SearchableSelect
            value={filterOperacao}
            onValueChange={setFilterOperacao}
            options={[
              { value: "all", label: "Todas as operações" },
              ...OPERACOES.map(op => ({ value: op, label: op })),
            ]}
            placeholder="Operação"
            searchPlaceholder="Pesquisar operação..."
            triggerClassName="w-[180px]"
            data-testid="filter-operacao"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <User className="h-4 w-4" />
                Demandas por Responsável
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {totalByResponsavel.map(item => (
                  <div key={item.name} className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md">
                    <span className="text-sm">{item.name.split(" ")[0]}</span>
                    <Badge variant="secondary">{item.count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Demandas por Operação
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {Object.entries(tasksByOperacao).map(([op, count]) => (
                  <div key={op} className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md">
                    <span className="text-sm">{op}</span>
                    <Badge variant="secondary">{count}</Badge>
                  </div>
                ))}
                {Object.keys(tasksByOperacao).length === 0 && (
                  <span className="text-sm text-muted-foreground">Nenhuma demanda</span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-64 w-full" />
            ))}
          </div>
        ) : responsaveis.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="space-y-4">
              <User className="h-12 w-12 mx-auto text-muted-foreground" />
              <div>
                <h3 className="text-lg font-medium">Nenhum analista cadastrado</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Para criar demandas, primeiro cadastre os analistas na tela de Configuração.
                </p>
              </div>
            </div>
          </Card>
        ) : (
          <div className={`grid grid-cols-1 gap-4 ${responsaveis.length <= 3 ? 'md:grid-cols-3' : responsaveis.length <= 4 ? 'md:grid-cols-4' : 'md:grid-cols-3 lg:grid-cols-5'}`}>
            {responsaveis.map(responsavelName => {
              const respTasks = tasksByResponsavel[responsavelName] || [];
              return (
                <Card key={responsavelName} className="flex flex-col">
                  <CardHeader className="pb-2 border-b">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{responsavelName}</CardTitle>
                      <Badge variant="outline">{respTasks.length}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 p-3 space-y-2 overflow-auto max-h-[500px]">
                    {respTasks.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Sem demandas neste dia
                      </p>
                    ) : (
                      respTasks
                        .sort((a, b) => a.inicio.localeCompare(b.inicio))
                        .map(task => {
                          const status = getTaskStatus(task, currentTime);
                          const timeDiff = getTimeDiff(task, currentTime);
                          return (
                            <div
                              key={task.id}
                              className={`p-3 rounded-md border cursor-pointer transition-all hover-elevate ${
                                status === "concluida" ? "bg-muted/50 opacity-60" : 
                                status === "atrasada" ? "border-red-500/50 bg-red-500/5" : 
                                "bg-card"
                              }`}
                              onClick={() => setSelectedTask(task)}
                              data-testid={`task-card-${task.id}`}
                            >
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <StatusBadge status={status} />
                                <span className="text-xs text-muted-foreground">
                                  {task.inicio} - {task.fim}
                                </span>
                              </div>
                              <p className={`font-medium text-sm mb-1 ${status === "concluida" ? "line-through" : ""}`}>
                                {task.titulo}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Operação: {task.operacao}
                              </p>
                              {status === "concluida" && task.completedAt ? (
                                <div className="flex items-center gap-1 mt-2 text-xs text-green-600">
                                  <CheckCircle2 className="h-3 w-3" />
                                  <span>Finalizado às {format(new Date(task.completedAt), "HH:mm")}</span>
                                </div>
                              ) : status !== "concluida" ? (
                                <div className={`flex items-center gap-1 mt-2 text-xs ${
                                  status === "atrasada" ? "text-red-500" : "text-blue-500"
                                }`}>
                                  {status === "atrasada" ? (
                                    <AlertTriangle className="h-3 w-3" />
                                  ) : (
                                    <Clock className="h-3 w-3" />
                                  )}
                                  <span>{timeDiff}</span>
                                </div>
                              ) : null}
                            </div>
                          );
                        })
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!selectedTask} onOpenChange={(open) => { if (!open) { setSelectedTask(null); setIsEditing(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Editar Tarefa" : "Detalhes da Tarefa"}</DialogTitle>
          </DialogHeader>
          {selectedTask && !isEditing && (
            <div className="space-y-4">
              <div>
                <Label className="text-muted-foreground">Título</Label>
                <p className="font-medium">{selectedTask.titulo}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Horário</Label>
                  <p>{selectedTask.inicio} - {selectedTask.fim}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    <StatusBadge status={getTaskStatus(selectedTask, currentTime)} />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Responsável</Label>
                  <p>{selectedTask.responsavel}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Operação</Label>
                  <p>{selectedTask.operacao}</p>
                </div>
              </div>
              {selectedTask.concluida && selectedTask.completedAt && (
                <div>
                  <Label className="text-muted-foreground">Finalizado em</Label>
                  <p className="text-green-600">
                    {format(new Date(selectedTask.completedAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </p>
                </div>
              )}
              {!selectedTask.concluida && (
                <div>
                  <Label className="text-muted-foreground">Tempo restante</Label>
                  <p className={getTaskStatus(selectedTask, currentTime) === "atrasada" ? "text-red-500" : "text-blue-500"}>
                    {getTimeDiff(selectedTask, currentTime)}
                  </p>
                </div>
              )}
              <div className="flex justify-between pt-4 border-t gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDeleteTask(selectedTask)}
                  data-testid="button-delete-task"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Excluir
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => startEditing(selectedTask)}
                    data-testid="button-edit-task"
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Editar
                  </Button>
                  {!selectedTask.concluida ? (
                    <Button
                      size="sm"
                      onClick={() => toggleMutation.mutate({ id: selectedTask.id, concluida: true })}
                      data-testid="button-complete-task"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Concluir
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleMutation.mutate({ id: selectedTask.id, concluida: false })}
                      data-testid="button-reopen-task"
                    >
                      Reabrir
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
          {selectedTask && isEditing && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Título</Label>
                <Input
                  value={editTitulo}
                  onChange={(e) => setEditTitulo(e.target.value)}
                  data-testid="input-edit-titulo"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Início</Label>
                  <Input
                    type="time"
                    value={editInicio}
                    onChange={(e) => setEditInicio(e.target.value)}
                    data-testid="input-edit-inicio"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Fim</Label>
                  <Input
                    type="time"
                    value={editFim}
                    onChange={(e) => setEditFim(e.target.value)}
                    data-testid="input-edit-fim"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Responsável</Label>
                <Select value={editResponsavel} onValueChange={setEditResponsavel}>
                  <SelectTrigger data-testid="select-edit-responsavel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {responsaveis.map((resp) => (
                      <SelectItem key={resp} value={resp}>{resp}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Operação</Label>
                <Select value={editOperacao} onValueChange={setEditOperacao}>
                  <SelectTrigger data-testid="select-edit-operacao">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPERACOES.map((op) => (
                      <SelectItem key={op} value={op}>{op}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => setIsEditing(false)} data-testid="button-cancel-edit">
                  Cancelar
                </Button>
                <Button
                  onClick={handleSaveEdit}
                  disabled={editMutation.isPending || !editTitulo.trim()}
                  data-testid="button-save-edit"
                >
                  {editMutation.isPending ? "Salvando..." : "Salvar"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog for Recurring Tasks */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir Tarefa Recorrente</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-muted-foreground">
              Esta é uma tarefa recorrente. O que deseja fazer?
            </p>
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                onClick={handleDeleteThisOnly}
                data-testid="button-delete-this-only"
              >
                Excluir apenas esta ocorrência
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteAllSeries}
                data-testid="button-delete-all-series"
              >
                Excluir toda a série
              </Button>
              <Button
                variant="ghost"
                onClick={() => setDeleteConfirmOpen(false)}
                data-testid="button-cancel-delete"
              >
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState, useEffect, useMemo, useRef } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO, differenceInHours, addHours } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  RefreshCw,
  AlertCircle,
  Clock,
  Hourglass,
  CheckCircle2,
  Timer,
  Play,
  Pause,
  Square,
  RotateCcw,
  Filter,
  Save,
  Send,
  Paperclip,
  MessageSquare,
  X,
  Loader2,
  FileText,
  Download,
  User,
  Circle,
  GitCommitHorizontal,
  Flag,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { type GlpiTicket, type Solicitante } from "@shared/schema";

// Parse structured description from GLPI form data
function parseTicketDescription(descricao: string): { structured: Record<string, string>; raw: string } | null {
  if (!descricao.includes("Dados do formulário")) {
    return null;
  }
  
  const fields: Record<string, string> = {};
  
  // Extract common fields
  const patterns = [
    { key: "Nome da Demanda", regex: /Nome da Demanda\s*:\s*([^\d]+?)(?=\d+\)|$)/i },
    { key: "Tipo de Ação", regex: /Tipo de Ação\s*:\s*([^\d]+?)(?=\d+\)|$)/i },
    { key: "Origem dos Dados", regex: /Origem dos Dados\s*:\s*([^\d]+?)(?=\d+\)|$)/i },
    { key: "Operação", regex: /Operação(?:\s+Origem)?\s*:\s*([^\d&]+?)(?=\d+\)|&nbsp;|Dados da Ação)/i },
    { key: "Descrição do Chamado", regex: /Descrição do Chamado\s*:\s*([\s\S]+?)(?=\d+\)\s*Anexo|$)/i },
    { key: "Anexo", regex: /Anexo\s*:\s*([^\d]+?)(?=\d+\)|&nbsp;|Prazos)/i },
    { key: "Data de Abertura", regex: /Data de Abertura\s*:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/i },
    { key: "Prazo de Entrega", regex: /Prazo de Entrega\s*:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/i },
    { key: "Período dos Dados", regex: /Período dos Dados\s*:\s*([^\d]+?)(?=\d+\)|$)/i },
    { key: "Criticidade", regex: /Criticidade(?:\s+da Ação)?\s*:\s*(\w+)/i },
  ];
  
  for (const { key, regex } of patterns) {
    const match = descricao.match(regex);
    if (match && match[1]) {
      fields[key] = match[1].trim().replace(/&nbsp;/gi, " ").replace(/\s+/g, " ");
    }
  }
  
  return Object.keys(fields).length > 0 ? { structured: fields, raw: descricao } : null;
}

interface KanbanColumn {
  id: string;
  title: string;
  tickets: GlpiTicket[];
  count: number;
}

interface KanbanData {
  columns: KanbanColumn[];
}

interface TicketTimer {
  ticketId: number;
  startTime: number | null;
  totalTime: number;
  isRunning: boolean;
  isPaused: boolean;
}

interface TicketNote {
  ticketId: number;
  note: string;
}

interface TicketFollowup {
  id: number;
  content: string;
  date_creation: string;
  users_id: number;
  is_private: boolean;
}

interface FileAttachment {
  name: string;
  base64: string;
}

interface TicketDocument {
  id: number;
  name: string;
  filename: string;
  mime: string;
  date_creation: string;
}

interface TimelineEvent {
  id: number;
  type: "creation" | "followup" | "solution" | "status_change" | "assignment";
  content: string;
  date: string;
  userId: number;
  isPrivate: boolean;
}

interface SlaConfig {
  prioridadeCode: number;
  prioridadeNome: string;
  horasMaximas: number;
}

interface LocalTicketResponsible {
  ticketId: number;
  analistaId: string;
  analistaNome: string;
  assignedAt: string;
}

const GLPI_STATUSES = [
  { value: 1, label: "Novo" },
  { value: 2, label: "Em Processamento (atribuído)" },
  { value: 3, label: "Em Processamento (planejado)" },
  { value: 4, label: "Pendente" },
  { value: 5, label: "Resolvido" },
  { value: 6, label: "Fechado" },
];

const COLUMN_COLORS: Record<string, { bg: string; border: string; icon: typeof AlertCircle }> = {
  "aguardando": { bg: "bg-blue-500/10", border: "border-blue-500", icon: AlertCircle },
  "em-atendimento": { bg: "bg-yellow-500/10", border: "border-yellow-500", icon: Clock },
  "pendente-mais-24h": { bg: "bg-red-500/10", border: "border-red-500", icon: Timer },
  "pendente-menos-24h": { bg: "bg-orange-500/10", border: "border-orange-500", icon: Hourglass },
  "solucionado": { bg: "bg-green-500/10", border: "border-green-500", icon: CheckCircle2 },
};

const PRIORITY_COLORS: Record<number, string> = {
  1: "bg-gray-400",
  2: "bg-blue-400",
  3: "bg-yellow-400",
  4: "bg-orange-500",
  5: "bg-red-500",
  6: "bg-red-700",
};

const STATUS_COLORS: Record<number, string> = {
  1: "bg-blue-500",
  2: "bg-yellow-500",
  3: "bg-yellow-600",
  4: "bg-orange-500",
  5: "bg-green-500",
  6: "bg-gray-500",
};

function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export default function KanbanGlpi() {
  const { analista, isLoggedIn } = useAuth();
  const [selectedTicket, setSelectedTicket] = useState<GlpiTicket | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [timers, setTimers] = useState<Record<number, TicketTimer>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [currentNote, setCurrentNote] = useState("");
  const [displayTime, setDisplayTime] = useState(0);
  const [followupContent, setFollowupContent] = useState("");
  const [isPrivateFollowup, setIsPrivateFollowup] = useState(false);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: kanbanData, isLoading, refetch } = useQuery<KanbanData>({
    queryKey: ["/api/tickets/kanban"],
    refetchInterval: 30000,
  });

  const { data: solicitantes } = useQuery<Solicitante[]>({
    queryKey: ["/api/solicitantes"],
  });

  const { data: allResponsibles } = useQuery<LocalTicketResponsible[]>({
    queryKey: ["/api/ticket-responsibles"],
  });

  // Helper function to get solicitante name by GLPI user ID
  const getSolicitanteName = (glpiUserId: number): string => {
    if (!solicitantes) return `#${glpiUserId}`;
    const sol = solicitantes.find(s => s.glpiUserId === glpiUserId);
    return sol ? sol.nome : `#${glpiUserId}`;
  };

  const { data: followups, refetch: refetchFollowups, isLoading: isLoadingFollowups } = useQuery<TicketFollowup[]>({
    queryKey: selectedTicket ? ["/api/tickets", selectedTicket.id, "followups"] : ["no-ticket"],
    enabled: !!selectedTicket,
  });

  const { data: ticketDocuments, isLoading: isLoadingDocuments } = useQuery<TicketDocument[]>({
    queryKey: selectedTicket ? ["/api/tickets", selectedTicket.id, "documents"] : ["no-ticket-docs"],
    enabled: !!selectedTicket,
  });

  const { data: localResponsible, refetch: refetchResponsible } = useQuery<LocalTicketResponsible>({
    queryKey: selectedTicket ? ["/api/tickets", selectedTicket.id, "responsible"] : ["no-ticket-resp"],
    enabled: !!selectedTicket,
  });

  const { data: timelineEvents, isLoading: isLoadingTimeline } = useQuery<TimelineEvent[]>({
    queryKey: selectedTicket ? ["/api/tickets", selectedTicket.id, "timeline"] : ["no-ticket-tl"],
    enabled: !!selectedTicket,
  });

  const { data: slaConfigs } = useQuery<SlaConfig[]>({
    queryKey: ["/api/sla-config"],
  });

  const addFollowupMutation = useMutation({
    mutationFn: async ({ ticketId, content, isPrivate }: { ticketId: number; content: string; isPrivate: boolean }) => {
      return apiRequest("POST", `/api/tickets/${ticketId}/followups`, { content, isPrivate });
    },
    onSuccess: () => {
      toast({ title: "Acompanhamento adicionado", description: "O acompanhamento foi enviado ao GLPI com sucesso." });
      setFollowupContent("");
      setIsPrivateFollowup(false);
      refetchFollowups();
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ ticketId, status }: { ticketId: number; status: number }) => {
      return apiRequest("PATCH", `/api/tickets/${ticketId}/status`, { status });
    },
    onSuccess: () => {
      toast({ title: "Status atualizado", description: "O status do ticket foi alterado no GLPI." });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets/kanban"] });
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const uploadDocumentMutation = useMutation({
    mutationFn: async ({ ticketId, filename, base64Content }: { ticketId: number; filename: string; base64Content: string }) => {
      return apiRequest("POST", `/api/tickets/${ticketId}/documents`, { filename, base64Content });
    },
    onSuccess: () => {
      toast({ title: "Anexo enviado", description: "O arquivo foi anexado ao ticket no GLPI." });
      setAttachments([]);
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao anexar", description: error.message, variant: "destructive" });
    },
  });

  const { data: analistasData } = useQuery<any[]>({
    queryKey: ["/api/analistas"],
    enabled: analista?.role === "admin",
  });

  const updateResponsibleMutation = useMutation({
    mutationFn: async ({ ticketId, analistaId }: { ticketId: number; analistaId: string }) => {
      const res = await fetch(`/api/tickets/${ticketId}/responsible`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "X-Analista-Id": analista?.id || ""
        },
        body: JSON.stringify({ analistaId })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Responsável alterado", description: `Responsável alterado para ${data.analistaNome}` });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets/kanban"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ticket-responsibles"] });
      refetch();
      refetchResponsible();
    },
    onError: (error: Error) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        setAttachments(prev => [...prev, { name: file.name, base64 }]);
      };
      reader.readAsDataURL(file);
    });
    
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSendFollowup = async () => {
    if (!selectedTicket || !followupContent.trim()) return;

    const messageWithAnalyst = isLoggedIn && analista
      ? `[${analista.nome}]: ${followupContent}`
      : followupContent;

    await addFollowupMutation.mutateAsync({
      ticketId: selectedTicket.id,
      content: messageWithAnalyst,
      isPrivate: isPrivateFollowup,
    });

    for (const attachment of attachments) {
      await uploadDocumentMutation.mutateAsync({
        ticketId: selectedTicket.id,
        filename: attachment.name,
        base64Content: attachment.base64,
      });
    }
  };

  const handleStatusChange = (status: string) => {
    if (!selectedTicket) return;
    updateStatusMutation.mutate({
      ticketId: selectedTicket.id,
      status: parseInt(status),
    });
  };

  const categories = useMemo(() => {
    const allTickets = kanbanData?.columns.flatMap(c => c.tickets) || [];
    const cats = new Set(allTickets.map(t => t.categoria).filter(Boolean));
    return Array.from(cats).sort();
  }, [kanbanData]);

  const priorities = useMemo(() => {
    const allTickets = kanbanData?.columns.flatMap(c => c.tickets) || [];
    const prios = new Set(allTickets.map(t => t.prioridade).filter(Boolean));
    return Array.from(prios).sort();
  }, [kanbanData]);

  const getResponsibleName = (ticketId: number): string | null => {
    if (!allResponsibles) return null;
    const responsible = allResponsibles.find(r => r.ticketId === ticketId);
    return responsible?.analistaNome || null;
  };

  const filteredData = useMemo(() => {
    if (!kanbanData) return kanbanData;
    
    const searchLower = searchQuery.toLowerCase().trim();
    
    return {
      columns: kanbanData.columns.map(col => {
        let tickets = col.tickets;
        
        if (categoryFilter !== "all") {
          tickets = tickets.filter(t => t.categoria === categoryFilter);
        }
        
        if (priorityFilter !== "all") {
          tickets = tickets.filter(t => t.prioridade === priorityFilter);
        }
        
        if (searchLower) {
          tickets = tickets.filter(t => 
            (t.titulo?.toLowerCase() || "").includes(searchLower) ||
            t.id.toString().includes(searchLower)
          );
        }
        
        return {
          ...col,
          tickets,
          count: tickets.length
        };
      })
    };
  }, [kanbanData, categoryFilter, priorityFilter, searchQuery]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (selectedTicket) {
        const timer = timers[selectedTicket.id];
        if (timer?.isRunning && timer.startTime) {
          const elapsed = Math.floor((Date.now() - timer.startTime) / 1000);
          setDisplayTime(timer.totalTime + elapsed);
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [selectedTicket, timers]);

  useEffect(() => {
    if (selectedTicket) {
      const timer = timers[selectedTicket.id];
      if (timer) {
        if (timer.isRunning && timer.startTime) {
          const elapsed = Math.floor((Date.now() - timer.startTime) / 1000);
          setDisplayTime(timer.totalTime + elapsed);
        } else {
          setDisplayTime(timer.totalTime);
        }
      } else {
        setDisplayTime(0);
      }
      setCurrentNote(notes[selectedTicket.id] || "");
    }
  }, [selectedTicket, timers, notes]);

  const startTimer = (ticketId: number) => {
    setTimers(prev => ({
      ...prev,
      [ticketId]: {
        ticketId,
        startTime: Date.now(),
        totalTime: prev[ticketId]?.totalTime || 0,
        isRunning: true,
        isPaused: false,
      }
    }));
  };

  const pauseTimer = (ticketId: number) => {
    setTimers(prev => {
      const timer = prev[ticketId];
      if (!timer || !timer.startTime) return prev;
      const elapsed = Math.floor((Date.now() - timer.startTime) / 1000);
      return {
        ...prev,
        [ticketId]: {
          ...timer,
          totalTime: timer.totalTime + elapsed,
          startTime: null,
          isRunning: false,
          isPaused: true,
        }
      };
    });
  };

  const resumeTimer = (ticketId: number) => {
    setTimers(prev => ({
      ...prev,
      [ticketId]: {
        ...prev[ticketId],
        startTime: Date.now(),
        isRunning: true,
        isPaused: false,
      }
    }));
  };

  const resetTimer = (ticketId: number) => {
    setTimers(prev => {
      const { [ticketId]: _, ...rest } = prev;
      return rest;
    });
    setDisplayTime(0);
  };

  const stopTimer = (ticketId: number) => {
    setTimers(prev => {
      const timer = prev[ticketId];
      if (!timer) return prev;
      let finalTime = timer.totalTime;
      if (timer.isRunning && timer.startTime) {
        finalTime += Math.floor((Date.now() - timer.startTime) / 1000);
      }
      return {
        ...prev,
        [ticketId]: {
          ...timer,
          totalTime: finalTime,
          startTime: null,
          isRunning: false,
          isPaused: false,
        }
      };
    });
  };

  const saveNote = (ticketId: number, note: string) => {
    setNotes(prev => ({ ...prev, [ticketId]: note }));
  };

  const totalTickets = filteredData?.columns.reduce((sum, col) => sum + col.count, 0) || 0;

  const getTimerState = (ticketId: number) => {
    const timer = timers[ticketId];
    if (!timer) return "not_started";
    if (timer.isRunning) return "running";
    if (timer.isPaused) return "paused";
    if (timer.totalTime > 0) return "stopped";
    return "not_started";
  };

  const exportToExcel = () => {
    if (!filteredData) return;
    
    const rows: string[][] = [];
    rows.push(["ID", "Título", "Status", "Categoria", "Prioridade", "Data Criação", "Responsável", "Tempo Controle"]);
    
    filteredData.columns.forEach((column) => {
      column.tickets.forEach((ticket) => {
        const timer = timers[ticket.id];
        let timeStr = "00:00:00";
        if (timer) {
          if (timer.isRunning && timer.startTime) {
            const elapsed = timer.totalTime + Math.floor((Date.now() - timer.startTime) / 1000);
            timeStr = formatTime(elapsed);
          } else {
            timeStr = formatTime(timer.totalTime);
          }
        }
        
        rows.push([
          ticket.id.toString(),
          ticket.titulo,
          column.title,
          ticket.categoria,
          ticket.prioridade,
          format(parseISO(ticket.dataCriacao), "dd/MM/yyyy HH:mm", { locale: ptBR }),
          getResponsibleName(ticket.id) || "",
          timeStr,
        ]);
      });
    });
    
    const csvContent = rows.map(row => 
      row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(",")
    ).join("\n");
    
    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `kanban_glpi_${format(new Date(), "yyyy-MM-dd_HH-mm")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast({ title: "Exportação concluída!", description: "Arquivo CSV gerado com sucesso" });
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between gap-4 p-4 border-b bg-card">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-semibold">Quadro Kanban GLPI</h1>
            <p className="text-sm text-muted-foreground">
              Visualização de tickets por status ({totalTickets} tickets)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportToExcel} data-testid="button-export">
            <Download className="h-4 w-4 mr-2" />
            Exportar
          </Button>
          <Button variant="outline" onClick={() => refetch()} data-testid="button-refresh">
            <RefreshCw className="h-4 w-4 mr-2" />
            Atualizar
          </Button>
        </div>
      </header>

      <div className="p-4 border-b bg-muted/30">
        <div className="flex items-center gap-4 flex-wrap">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filtros:</span>
          <Input
            placeholder="Buscar por ID ou título..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-48"
            data-testid="filter-search"
          />
          <SearchableSelect
            value={categoryFilter}
            onValueChange={setCategoryFilter}
            options={[
              { value: "all", label: "Todas as categorias" },
              ...categories.map(cat => ({ value: cat, label: cat })),
            ]}
            placeholder="Categoria"
            searchPlaceholder="Pesquisar categoria..."
            triggerClassName="w-56"
            data-testid="filter-category"
          />
          <SearchableSelect
            value={priorityFilter}
            onValueChange={setPriorityFilter}
            options={[
              { value: "all", label: "Todas prioridades" },
              ...priorities.map(prio => ({ value: prio, label: prio })),
            ]}
            placeholder="Prioridade"
            searchPlaceholder="Pesquisar prioridade..."
            triggerClassName="w-40"
            data-testid="filter-priority"
          />
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-4">
        {isLoading ? (
          <div className="flex gap-3 h-full">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex-1 min-w-0">
                <Skeleton className="h-12 w-full mb-4" />
                <Skeleton className="h-32 w-full mb-2" />
                <Skeleton className="h-32 w-full mb-2" />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-3 h-full min-h-0">
            {filteredData?.columns.map((column) => {
              const colorConfig = COLUMN_COLORS[column.id] || COLUMN_COLORS["aguardando"];
              const Icon = colorConfig.icon;
              
              return (
                <div
                  key={column.id}
                  className="flex-1 min-w-0 flex flex-col"
                  data-testid={`kanban-column-${column.id}`}
                >
                  <div className={`rounded-t-lg px-4 py-3 ${colorConfig.bg} border-t-2 ${colorConfig.border}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        <span className="font-medium text-sm">{column.title}</span>
                      </div>
                      <Badge variant="secondary">{column.count}</Badge>
                    </div>
                  </div>
                  
                  <ScrollArea className="flex-1 bg-muted/20 rounded-b-lg p-2">
                    <div className="space-y-2">
                      {column.tickets.map((ticket) => {
                        const timerState = getTimerState(ticket.id);
                        const timer = timers[ticket.id];
                        let cardTime = 0;
                        if (timer) {
                          if (timer.isRunning && timer.startTime) {
                            cardTime = timer.totalTime + Math.floor((Date.now() - timer.startTime) / 1000);
                          } else {
                            cardTime = timer.totalTime;
                          }
                        }
                        
                        const pendingHours = differenceInHours(new Date(), parseISO(ticket.dataModificacao));
                        
                        return (
                          <Card
                            key={ticket.id}
                            className="cursor-pointer hover-elevate"
                            onClick={() => setSelectedTicket(ticket)}
                            data-testid={`kanban-ticket-${ticket.id}`}
                          >
                            <CardContent className="p-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-mono text-xs text-muted-foreground">#{ticket.id}</span>
                                <Badge className={`${PRIORITY_COLORS[ticket.prioridadeCode]} text-white text-xs`}>
                                  {ticket.prioridade}
                                </Badge>
                              </div>
                              <p className="text-sm font-medium line-clamp-2 mb-2">{ticket.titulo}</p>
                              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                                <span>{ticket.categoria}</span>
                                {(() => {
                                  const responsibleName = getResponsibleName(ticket.id);
                                  if (responsibleName) {
                                    return (
                                      <div className="flex items-center gap-1 text-primary">
                                        <User className="h-3 w-3" />
                                        <span>{responsibleName}</span>
                                      </div>
                                    );
                                  }
                                  return null;
                                })()}
                                {column.id.includes("pendente") && (
                                  <span className="text-orange-500">{pendingHours}h pendente</span>
                                )}
                              </div>
                              {timerState !== "not_started" && (
                                <div className={`mt-2 text-xs font-mono flex items-center gap-1 ${
                                  timerState === "running" ? "text-green-500" : 
                                  timerState === "paused" ? "text-yellow-500" : "text-muted-foreground"
                                }`}>
                                  <Timer className="h-3 w-3" />
                                  {formatTime(cardTime)}
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                      {column.tickets.length === 0 && (
                        <p className="text-center text-sm text-muted-foreground py-8">
                          Nenhum ticket
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!selectedTicket} onOpenChange={(open) => !open && setSelectedTicket(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ticket #{selectedTicket?.id}</DialogTitle>
            <DialogDescription>Gerenciamento e acompanhamento do chamado</DialogDescription>
          </DialogHeader>
          {selectedTicket && (
            <Tabs defaultValue="detalhes" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="detalhes" data-testid="tab-detalhes">
                  <Timer className="h-4 w-4 mr-2" />
                  Detalhes + Timer
                </TabsTrigger>
                <TabsTrigger value="linha-do-tempo" data-testid="tab-linha-do-tempo">
                  <GitCommitHorizontal className="h-4 w-4 mr-2" />
                  Linha do Tempo
                </TabsTrigger>
                <TabsTrigger value="acompanhamento" data-testid="tab-acompanhamento">
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Acompanhamento
                </TabsTrigger>
              </TabsList>

              <TabsContent value="detalhes" className="space-y-6 mt-4">
                <div className="p-4 bg-muted/30 rounded-lg">
                  <h3 className="font-semibold mb-2">{selectedTicket.titulo}</h3>
                  {(() => {
                    const parsed = parseTicketDescription(selectedTicket.descricao);
                    if (parsed) {
                      return (
                        <div className="space-y-3">
                          {Object.entries(parsed.structured).map(([key, value]) => (
                            <div key={key} className="border-l-2 border-primary/50 pl-3">
                              <span className="text-xs font-medium text-muted-foreground">{key}</span>
                              <p className="text-sm whitespace-pre-wrap">{value}</p>
                            </div>
                          ))}
                        </div>
                      );
                    }
                    return (
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {selectedTicket.descricao || "Sem descrição disponível"}
                      </p>
                    );
                  })()}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Status Atual</Label>
                    <Badge className={`${STATUS_COLORS[selectedTicket.statusCode]} text-white mt-1`}>
                      {selectedTicket.status}
                    </Badge>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Prioridade</Label>
                    <Badge className={`${PRIORITY_COLORS[selectedTicket.prioridadeCode]} text-white mt-1`}>
                      {selectedTicket.prioridade}
                    </Badge>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Categoria</Label>
                    <p className="text-sm mt-1">{selectedTicket.categoria}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Tipo</Label>
                    <p className="text-sm mt-1">{selectedTicket.tipo}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Data de Criação</Label>
                    <p className="text-sm">{format(parseISO(selectedTicket.dataCriacao), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Última Modificação</Label>
                    <p className="text-sm">{format(parseISO(selectedTicket.dataModificacao), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Solicitante</Label>
                    <p className="text-sm">{getSolicitanteName(selectedTicket.solicitanteId)}</p>
                  </div>
                </div>

                <div className="p-3 bg-muted/30 rounded-lg">
                  <Label className="text-xs text-muted-foreground mb-2 block">Responsável (Control Desk)</Label>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 flex-1">
                      <User className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">{localResponsible?.analistaNome || "Carregando..."}</span>
                    </div>
                    {analista?.role === "admin" && (
                      <div className="flex items-center gap-2">
                        <SearchableSelect
                          value=""
                          onValueChange={(value) => {
                            if (value) {
                              updateResponsibleMutation.mutate({
                                ticketId: selectedTicket.id,
                                analistaId: value
                              });
                            }
                          }}
                          options={(analistasData?.filter((a: any) => a.ativo && a.role !== "admin") ?? []).map((a: any) => ({
                            value: a.id,
                            label: a.nome,
                            description: a.role === "control_desk" ? "Control Desk" : "Analista TI",
                          }))}
                          placeholder="Alterar responsável"
                          searchPlaceholder="Pesquisar analista..."
                          triggerClassName="w-52"
                          data-testid="select-responsible"
                        />
                        {updateResponsibleMutation.isPending && (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <Card className="border-2 border-primary/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Timer className="h-4 w-4" />
                      Controle de Tempo
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between mb-4">
                      <div className={`text-4xl font-mono font-bold ${
                        getTimerState(selectedTicket.id) === "running" ? "text-green-500" :
                        getTimerState(selectedTicket.id) === "paused" ? "text-yellow-500" : ""
                      }`}>
                        {formatTime(displayTime)}
                      </div>
                      <div className="flex items-center gap-2">
                        {getTimerState(selectedTicket.id) === "not_started" && (
                          <Button onClick={() => startTimer(selectedTicket.id)} data-testid="button-start-timer">
                            <Play className="h-4 w-4 mr-2" />
                            Iniciar Demanda
                          </Button>
                        )}
                        {getTimerState(selectedTicket.id) === "running" && (
                          <>
                            <Button variant="outline" onClick={() => pauseTimer(selectedTicket.id)} data-testid="button-pause-timer">
                              <Pause className="h-4 w-4 mr-2" />
                              Pendente
                            </Button>
                            <Button variant="destructive" onClick={() => stopTimer(selectedTicket.id)} data-testid="button-stop-timer">
                              <Square className="h-4 w-4 mr-2" />
                              Encerrar
                            </Button>
                          </>
                        )}
                        {getTimerState(selectedTicket.id) === "paused" && (
                          <>
                            <Button onClick={() => resumeTimer(selectedTicket.id)} data-testid="button-resume-timer">
                              <RotateCcw className="h-4 w-4 mr-2" />
                              Retomar
                            </Button>
                            <Button variant="destructive" onClick={() => stopTimer(selectedTicket.id)} data-testid="button-stop-timer-paused">
                              <Square className="h-4 w-4 mr-2" />
                              Encerrar
                            </Button>
                          </>
                        )}
                        {getTimerState(selectedTicket.id) === "stopped" && (
                          <>
                            <Badge variant="outline" className="text-lg py-2 px-4">
                              Tempo total: {formatTime(timers[selectedTicket.id]?.totalTime || 0)}
                            </Badge>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => resetTimer(selectedTicket.id)}
                              data-testid="button-reset-timer"
                            >
                              <RotateCcw className="h-4 w-4 mr-2" />
                              Zerar
                            </Button>
                          </>
                        )}
                        {(getTimerState(selectedTicket.id) === "running" || getTimerState(selectedTicket.id) === "paused") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => resetTimer(selectedTicket.id)}
                            data-testid="button-reset-timer-active"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Paperclip className="h-4 w-4" />
                      Anexos do Chamado
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {isLoadingDocuments ? (
                      <div className="space-y-2">
                        <Skeleton className="h-8 w-full" />
                      </div>
                    ) : ticketDocuments && ticketDocuments.length > 0 ? (
                      <div className="space-y-2">
                        {ticketDocuments.map((doc) => (
                          <div key={doc.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg" data-testid={`attachment-${doc.id}`}>
                            <div className="flex items-center gap-2">
                              <Paperclip className="h-4 w-4 text-muted-foreground" />
                              <div>
                                <p className="text-sm font-medium">{doc.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {doc.filename} - {format(parseISO(doc.date_creation), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                                </p>
                              </div>
                            </div>
                            <a
                              href={`/api/documents/${doc.id}/download`}
                              download={doc.filename}
                              className="inline-flex items-center justify-center"
                              data-testid={`button-download-${doc.id}`}
                            >
                              <Button variant="ghost" size="icon">
                                <Download className="h-4 w-4" />
                              </Button>
                            </a>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Nenhum anexo encontrado
                      </p>
                    )}
                  </CardContent>
                </Card>

                <div className="space-y-2">
                  <Label>Observação Local</Label>
                  <Textarea
                    placeholder="Adicione observações sobre este chamado (salvo localmente)..."
                    value={currentNote}
                    onChange={(e) => setCurrentNote(e.target.value)}
                    rows={3}
                    data-testid="textarea-observacao"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => saveNote(selectedTicket.id, currentNote)}
                    data-testid="button-save-note"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    Salvar Observação
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="linha-do-tempo" className="space-y-6 mt-4">
                {(() => {
                  const slaHours = slaConfigs?.find(s => s.prioridadeCode === selectedTicket.prioridadeCode)?.horasMaximas;
                  const creationDate = parseISO(selectedTicket.dataCriacao);
                  const deadlineDate = slaHours ? addHours(creationDate, slaHours) : null;
                  const now = new Date();
                  const isOverdue = deadlineDate ? now > deadlineDate && !selectedTicket.dataFechamento : false;

                  const allEvents: Array<{
                    id: number | string;
                    type: string;
                    label: string;
                    content: string;
                    date: Date;
                    dateStr: string;
                    color: string;
                    icon: typeof Circle;
                  }> = [];

                  allEvents.push({
                    id: "creation",
                    type: "creation",
                    label: "Abertura do Chamado",
                    content: selectedTicket.titulo,
                    date: creationDate,
                    dateStr: format(creationDate, "dd/MM/yyyy HH:mm", { locale: ptBR }),
                    color: "bg-blue-500",
                    icon: Circle,
                  });

                  if (timelineEvents) {
                    for (const evt of timelineEvents) {
                      const evtDate = parseISO(evt.date);
                      let label = "Interação";
                      let color = "bg-primary";
                      let icon: typeof Circle = MessageSquare;

                      if (evt.type === "followup") {
                        const match = evt.content.match(/^\[([^\]]+)\]:\s*/);
                        const author = match ? match[1] : null;
                        label = author ? `Interação - ${author}` : "Acompanhamento";
                        color = "bg-yellow-500";
                        icon = MessageSquare;
                      } else if (evt.type === "solution") {
                        label = "Solução";
                        color = "bg-green-500";
                        icon = CheckCircle2;
                      } else if (evt.type === "assignment") {
                        label = "Tarefa";
                        color = "bg-purple-500";
                        icon = Wrench;
                      } else if (evt.type === "status_change") {
                        label = "Alteração de Status";
                        color = "bg-orange-500";
                        icon = RefreshCw;
                      }

                      allEvents.push({
                        id: evt.id,
                        type: evt.type,
                        label,
                        content: evt.content.replace(/^\[([^\]]+)\]:\s*/, ""),
                        date: evtDate,
                        dateStr: format(evtDate, "dd/MM/yyyy HH:mm", { locale: ptBR }),
                        color,
                        icon,
                      });
                    }
                  }

                  if (deadlineDate) {
                    allEvents.push({
                      id: "deadline",
                      type: "deadline",
                      label: "Prazo SLA",
                      content: `${slaHours}h (${selectedTicket.prioridade})`,
                      date: deadlineDate,
                      dateStr: format(deadlineDate, "dd/MM/yyyy HH:mm", { locale: ptBR }),
                      color: isOverdue ? "bg-red-500" : "bg-green-600",
                      icon: Flag,
                    });
                  }

                  if (selectedTicket.dataFechamento) {
                    const closeDate = parseISO(selectedTicket.dataFechamento);
                    allEvents.push({
                      id: "closed",
                      type: "closed",
                      label: "Fechamento",
                      content: "Chamado encerrado",
                      date: closeDate,
                      dateStr: format(closeDate, "dd/MM/yyyy HH:mm", { locale: ptBR }),
                      color: "bg-gray-500",
                      icon: CheckCircle2,
                    });
                  }

                  allEvents.sort((a, b) => a.date.getTime() - b.date.getTime());

                  return (
                    <>
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <GitCommitHorizontal className="h-4 w-4" />
                            Linha do Tempo do Chamado
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          {isLoadingTimeline ? (
                            <div className="space-y-4">
                              <Skeleton className="h-12 w-full" />
                              <Skeleton className="h-12 w-full" />
                              <Skeleton className="h-12 w-full" />
                            </div>
                          ) : (
                            <ScrollArea className="h-[400px]">
                              <div className="relative pl-8">
                                <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-border" />

                                {allEvents.map((evt, index) => {
                                  const IconComp = evt.icon;
                                  const isDeadline = evt.type === "deadline";
                                  const isClosed = evt.type === "closed";

                                  return (
                                    <div
                                      key={`${evt.id}-${index}`}
                                      className={`relative mb-6 ${isDeadline ? "opacity-80" : ""}`}
                                      data-testid={`timeline-event-${evt.id}`}
                                    >
                                      <div className={`absolute -left-5 w-6 h-6 rounded-full ${evt.color} flex items-center justify-center ring-4 ring-background`}>
                                        <IconComp className="h-3 w-3 text-white" />
                                      </div>

                                      <div className={`ml-4 p-3 rounded-md border ${isDeadline ? "border-dashed" : ""} ${isClosed ? "bg-muted/50" : "bg-muted/30"}`}>
                                        <div className="flex items-center justify-between gap-2 flex-wrap">
                                          <div className="flex items-center gap-2">
                                            <span className="text-xs font-medium text-muted-foreground">
                                              {evt.dateStr}
                                            </span>
                                            <Badge variant="secondary" className="text-xs">
                                              {evt.label}
                                            </Badge>
                                          </div>
                                        </div>
                                        <p className="text-sm mt-1 whitespace-pre-wrap">
                                          {evt.content}
                                        </p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </ScrollArea>
                          )}
                        </CardContent>
                      </Card>

                      <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-blue-500" />
                          <span className="text-xs text-muted-foreground">Abertura</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-yellow-500" />
                          <span className="text-xs text-muted-foreground">Interação</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-green-500" />
                          <span className="text-xs text-muted-foreground">Solução</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-purple-500" />
                          <span className="text-xs text-muted-foreground">Tarefa</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-green-600" />
                          <span className="text-xs text-muted-foreground">Prazo SLA</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-red-500" />
                          <span className="text-xs text-muted-foreground">Fora do Prazo</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-gray-500" />
                          <span className="text-xs text-muted-foreground">Fechamento</span>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </TabsContent>

              <TabsContent value="acompanhamento" className="space-y-6 mt-4">
                <Card className="border-2 border-primary/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Alterar Status no GLPI</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4">
                      <SearchableSelect
                        value={selectedTicket.statusCode.toString()}
                        onValueChange={handleStatusChange}
                        disabled={updateStatusMutation.isPending}
                        options={GLPI_STATUSES.map(s => ({ value: s.value.toString(), label: s.label }))}
                        placeholder="Selecione o status"
                        searchPlaceholder="Pesquisar status..."
                        triggerClassName="w-64"
                        data-testid="select-status"
                      />
                      {updateStatusMutation.isPending && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Send className="h-4 w-4" />
                      Adicionar Resposta/Acompanhamento
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Textarea
                      placeholder="Digite sua resposta ou acompanhamento..."
                      value={followupContent}
                      onChange={(e) => setFollowupContent(e.target.value)}
                      rows={4}
                      data-testid="textarea-followup"
                    />
                    
                    <div className="flex items-center gap-4">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="private"
                          checked={isPrivateFollowup}
                          onCheckedChange={(checked) => setIsPrivateFollowup(checked === true)}
                          data-testid="checkbox-private"
                        />
                        <Label htmlFor="private" className="text-sm">Acompanhamento Privado</Label>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          onChange={handleFileSelect}
                          className="hidden"
                          data-testid="input-file"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          data-testid="button-attach"
                        >
                          <Paperclip className="h-4 w-4 mr-2" />
                          Anexar Arquivos
                        </Button>
                      </div>
                      
                      {attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {attachments.map((file, index) => (
                            <Badge key={index} variant="secondary" className="flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              {file.name}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-4 w-4 p-0 ml-1"
                                onClick={() => removeAttachment(index)}
                                data-testid={`button-remove-attachment-${index}`}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    <Button
                      onClick={handleSendFollowup}
                      disabled={!followupContent.trim() || addFollowupMutation.isPending || uploadDocumentMutation.isPending}
                      data-testid="button-send-followup"
                    >
                      {(addFollowupMutation.isPending || uploadDocumentMutation.isPending) ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4 mr-2" />
                      )}
                      Enviar ao GLPI
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Paperclip className="h-4 w-4" />
                      Anexos do Chamado
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {isLoadingDocuments ? (
                      <div className="space-y-2">
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                      </div>
                    ) : ticketDocuments && ticketDocuments.length > 0 ? (
                      <div className="space-y-2">
                        {ticketDocuments.map((doc) => (
                          <div key={doc.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                            <div className="flex items-center gap-2">
                              <Paperclip className="h-4 w-4 text-muted-foreground" />
                              <div>
                                <p className="text-sm font-medium">{doc.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {doc.filename} - {format(parseISO(doc.date_creation), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Nenhum anexo encontrado
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <MessageSquare className="h-4 w-4" />
                      Histórico de Acompanhamentos
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {isLoadingFollowups ? (
                      <div className="space-y-4">
                        <Skeleton className="h-20 w-full" />
                        <Skeleton className="h-20 w-full" />
                      </div>
                    ) : followups && followups.length > 0 ? (
                      <ScrollArea className="h-64">
                        <div className="space-y-4">
                          {followups.map((f) => {
                            const match = f.content.match(/^\[([^\]]+)\]:\s*/);
                            const author = match ? match[1] : null;
                            const messageContent = match ? f.content.replace(match[0], "") : f.content;
                            
                            return (
                              <div key={f.id} className="p-3 bg-muted/30 rounded-lg">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">
                                      {format(parseISO(f.date_creation), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                                    </span>
                                    {author && (
                                      <Badge variant="secondary" className="text-xs">
                                        {author}
                                      </Badge>
                                    )}
                                  </div>
                                  {f.is_private && (
                                    <Badge variant="outline" className="text-xs">Privado</Badge>
                                  )}
                                </div>
                                <p className="text-sm whitespace-pre-wrap">{messageContent}</p>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        Nenhum acompanhamento registrado
                      </p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}

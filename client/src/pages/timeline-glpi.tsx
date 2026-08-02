import { useState, useMemo } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, addDays, startOfDay, differenceInDays, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  Filter,
  User,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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

interface Solicitante {
  id: string;
  nome: string;
  operacao: string;
  glpiUserId: number;
}

interface TimelineTicket {
  id: number;
  titulo: string;
  status: string;
  statusCode: number;
  prioridade: string;
  prioridadeCode: number;
  categoria: string;
  dataInicio: string;
  dataFim: string;
  dataCriacao: string;
  dataModificacao: string;
  operacao?: string | null;
  solicitanteId?: number;
}

type ViewMode = "dias" | "semanas" | "meses";

const STATUS_COLORS: Record<number, string> = {
  1: "bg-blue-500",
  2: "bg-yellow-500",
  3: "bg-yellow-600",
  4: "bg-orange-500",
  5: "bg-green-500",
  6: "bg-gray-500",
};

const PRIORITY_COLORS: Record<number, string> = {
  1: "#9ca3af",
  2: "#60a5fa",
  3: "#fbbf24",
  4: "#f97316",
  5: "#ef4444",
  6: "#b91c1c",
};

export default function TimelineGlpi() {
  const [searchQuery, setSearchQuery] = useState("");
  const [solicitanteFilter, setSolicitanteFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("dias");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedTicket, setSelectedTicket] = useState<TimelineTicket | null>(null);
  const [selectedStatuses, setSelectedStatuses] = useState<Set<number>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const { analista } = useAuth();

  const { data: tickets = [], isLoading, refetch } = useQuery<TimelineTicket[]>({
    queryKey: ["/api/tickets/timeline"],
    refetchInterval: 60000,
  });

  const { data: solicitantes = [] } = useQuery<Solicitante[]>({
    queryKey: ["/api/solicitantes"],
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets/timeline"] });
      toast({ title: "Responsável atualizado com sucesso!" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao atualizar responsável", description: error.message, variant: "destructive" });
    },
  });

  const getSolicitanteName = (solicitanteId?: number) => {
    if (!solicitanteId) return null;
    const sol = solicitantes.find(s => s.glpiUserId === solicitanteId);
    return sol?.nome || null;
  };

  const categories = useMemo(() => {
    const cats = new Set(tickets.map(t => t.categoria).filter(Boolean));
    return Array.from(cats).sort();
  }, [tickets]);

  const toggleStatus = (statusCode: number) => {
    setSelectedStatuses(prev => {
      const next = new Set(prev);
      if (next.has(statusCode)) {
        next.delete(statusCode);
      } else {
        next.add(statusCode);
      }
      return next;
    });
  };

  const toggleCategory = (category: string) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const filteredTickets = useMemo(() => {
    return tickets
      .filter((ticket) => {
        // Filter by search query (title or ID)
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          const matchTitle = ticket.titulo.toLowerCase().includes(query);
          const matchId = ticket.id.toString().includes(query);
          if (!matchTitle && !matchId) return false;
        }
        // Filter by solicitante
        if (solicitanteFilter !== "all") {
          const solicitanteName = getSolicitanteName(ticket.solicitanteId);
          if (solicitanteName !== solicitanteFilter) return false;
        }
        if (selectedStatuses.size > 0 && !selectedStatuses.has(ticket.statusCode)) {
          return false;
        }
        if (selectedCategories.size > 0 && !selectedCategories.has(ticket.categoria)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.id - a.id);
  }, [tickets, searchQuery, solicitanteFilter, selectedStatuses, selectedCategories, solicitantes]);

  const { timelineStart, timelineEnd, columns } = useMemo(() => {
    let start: Date;
    let end: Date;
    let cols: { label: string; start: Date; end: Date }[] = [];

    if (viewMode === "dias") {
      start = startOfDay(addDays(currentDate, -2));
      end = startOfDay(addDays(currentDate, 6));
      for (let i = 0; i < 8; i++) {
        const dayStart = addDays(start, i);
        cols.push({
          label: format(dayStart, "dd/MM"),
          start: dayStart,
          end: addDays(dayStart, 1),
        });
      }
    } else if (viewMode === "semanas") {
      start = addDays(currentDate, -7);
      end = addDays(currentDate, 21);
      for (let i = 0; i < 4; i++) {
        const weekStart = addDays(start, i * 7);
        const weekEnd = addDays(weekStart, 6);
        cols.push({
          label: `${format(weekStart, "dd/MM")} - ${format(weekEnd, "dd/MM")}`,
          start: weekStart,
          end: weekEnd,
        });
      }
    } else {
      start = addDays(currentDate, -30);
      end = addDays(currentDate, 60);
      for (let i = -1; i <= 2; i++) {
        const monthDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + i, 1);
        const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + i + 1, 0);
        cols.push({
          label: format(monthDate, "MMMM yyyy", { locale: ptBR }),
          start: monthDate,
          end: monthEnd,
        });
      }
    }

    return { timelineStart: start, timelineEnd: end, columns: cols };
  }, [currentDate, viewMode]);

  const totalDays = differenceInDays(timelineEnd, timelineStart);

  const getBarPosition = (startDate: string, endDate: string) => {
    const start = parseISO(startDate);
    const end = parseISO(endDate);
    
    const startDiff = differenceInDays(start, timelineStart);
    const endDiff = differenceInDays(end, timelineStart);
    
    const left = Math.max(0, (startDiff / totalDays) * 100);
    const right = Math.min(100, (endDiff / totalDays) * 100);
    const width = Math.max(2, right - left);
    
    return { left: `${left}%`, width: `${width}%` };
  };

  const navigate = (direction: "prev" | "next" | "today") => {
    if (direction === "today") {
      setCurrentDate(new Date());
    } else {
      const delta = viewMode === "dias" ? 7 : viewMode === "semanas" ? 14 : 30;
      setCurrentDate(prev => addDays(prev, direction === "next" ? delta : -delta));
    }
  };

  const todayPosition = useMemo(() => {
    const today = startOfDay(new Date());
    const diff = differenceInDays(today, timelineStart);
    return (diff / totalDays) * 100;
  }, [timelineStart, totalDays]);

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between gap-4 p-4 border-b bg-card">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-semibold">Cronograma GLPI</h1>
            <p className="text-sm text-muted-foreground">Visualização de timeline dos tickets</p>
          </div>
        </div>

        <Button variant="outline" onClick={() => refetch()} data-testid="button-refresh">
          <RefreshCw className="h-4 w-4 mr-2" />
          Atualizar
        </Button>
      </header>

      <div className="flex-1 overflow-hidden flex flex-col p-4">
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Filtros:</span>
              </div>
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Pesquisar ID ou título..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-48"
                  data-testid="input-search"
                />
              </div>
              {solicitantes.length > 0 && (
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <SearchableSelect
                    value={solicitanteFilter}
                    onValueChange={setSolicitanteFilter}
                    options={[
                      { value: "all", label: "Todos Solicitantes" },
                      ...solicitantes.map(sol => ({ value: sol.nome, label: sol.nome })),
                    ]}
                    placeholder="Solicitante"
                    searchPlaceholder="Pesquisar solicitante..."
                    triggerClassName="w-44"
                    data-testid="select-solicitante"
                  />
                </div>
              )}
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground mr-1">Status:</span>
                {[
                  { code: 1, label: "Novo" },
                  { code: 2, label: "Em Proc." },
                  { code: 4, label: "Pendente" },
                  { code: 5, label: "Resolvido" },
                  { code: 6, label: "Fechado" },
                ].map(item => (
                  <Button
                    key={item.code}
                    variant={selectedStatuses.has(item.code) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleStatus(item.code)}
                    data-testid={`filter-status-${item.code}`}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              {selectedStatuses.size > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedStatuses(new Set())}
                  className="text-xs"
                  data-testid="button-clear-status"
                >
                  Limpar
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Categorias:</span>
              {categories.slice(0, 6).map(cat => (
                <Button
                  key={cat}
                  variant={selectedCategories.has(cat) ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleCategory(cat)}
                  data-testid={`filter-cat-${cat.replace(/\s+/g, '-')}`}
                  className="text-xs"
                >
                  {cat.length > 15 ? cat.substring(0, 15) + "..." : cat}
                </Button>
              ))}
              {selectedCategories.size > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedCategories(new Set())}
                  className="text-xs"
                  data-testid="button-clear-categories"
                >
                  Limpar
                </Button>
              )}
              <div className="flex items-center gap-1 ml-auto">
                <Button variant="outline" size="sm" onClick={() => navigate("prev")} data-testid="button-prev">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate("today")} data-testid="button-today">
                  Hoje
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate("next")} data-testid="button-next">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center border rounded-md overflow-hidden">
                {(["dias", "semanas", "meses"] as ViewMode[]).map((mode) => (
                  <Button
                    key={mode}
                    variant={viewMode === mode ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode(mode)}
                    className="rounded-none"
                    data-testid={`button-view-${mode}`}
                  >
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="flex-1 overflow-hidden">
          <CardContent className="p-0 h-full">
            {isLoading ? (
              <div className="flex-1 p-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-10 w-full mb-2" />
                ))}
              </div>
            ) : (
              <div className="h-full overflow-auto" data-testid="timeline-scroll-container">
                <table className="w-full border-collapse" style={{ minWidth: '900px' }}>
                  <thead className="sticky top-0 z-20">
                    <tr className="bg-muted/95 backdrop-blur">
                      <th className="w-72 min-w-[288px] px-4 py-3 text-left font-medium text-sm border-b border-r">
                        Ticket
                      </th>
                      <th className="border-b p-0 relative">
                        <div className="flex">
                          {columns.map((col, i) => (
                            <div
                              key={i}
                              className="flex-1 px-2 py-3 text-center text-xs font-medium border-r last:border-r-0"
                            >
                              {col.label}
                            </div>
                          ))}
                        </div>
                        {todayPosition >= 0 && todayPosition <= 100 && (
                          <div
                            className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none"
                            style={{ left: `${todayPosition}%` }}
                          >
                            <div className="absolute top-1 -left-3 bg-red-500 text-white text-xs px-1 rounded whitespace-nowrap">
                              Hoje
                            </div>
                          </div>
                        )}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTickets.slice(0, 100).map((ticket) => {
                      const isOverdue = new Date(ticket.dataFim) < new Date() && ticket.statusCode !== 5 && ticket.statusCode !== 6;
                      const pos = getBarPosition(ticket.dataInicio, ticket.dataFim);
                      return (
                        <tr
                          key={ticket.id}
                          className={`border-b hover-elevate cursor-pointer ${isOverdue ? 'bg-red-500/10' : ''}`}
                          onClick={() => setSelectedTicket(ticket)}
                          data-testid={`timeline-ticket-${ticket.id}`}
                        >
                          <td className={`w-72 min-w-[288px] px-3 py-2 border-r align-top ${isOverdue ? 'border-l-2 border-l-red-500' : ''}`}>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-muted-foreground">#{ticket.id}</span>
                              <Badge className={`${STATUS_COLORS[ticket.statusCode]} text-white text-xs`}>
                                {ticket.status.split(" ")[0]}
                              </Badge>
                              {isOverdue && (
                                <Badge variant="destructive" className="text-xs">
                                  Fora do Prazo
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm truncate mt-1" title={ticket.titulo}>{ticket.titulo}</p>
                            {ticket.operacao && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1" data-testid={`timeline-ticket-operacao-${ticket.id}`}>
                                <User className="h-3 w-3" />
                                <span>{ticket.operacao}</span>
                              </div>
                            )}
                          </td>
                          <td 
                            className="relative h-16 p-0"
                            style={{ 
                              backgroundImage: columns.length > 1 
                                ? `repeating-linear-gradient(to right, transparent, transparent calc(${100/columns.length}% - 1px), hsl(var(--border)) calc(${100/columns.length}% - 1px), hsl(var(--border)) calc(${100/columns.length}%))` 
                                : 'none'
                            }}
                          >
                            <div
                              className={`absolute top-1/2 -translate-y-1/2 h-6 rounded cursor-pointer hover:opacity-80 transition-opacity ${isOverdue ? 'ring-2 ring-red-500' : ''}`}
                              style={{
                                left: pos.left,
                                width: pos.width,
                                backgroundColor: isOverdue ? '#ef4444' : (PRIORITY_COLORS[ticket.prioridadeCode] || "#6366f1"),
                              }}
                              title={ticket.titulo}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="mt-2 text-sm text-muted-foreground">
          {filteredTickets.length} de {tickets.length} tickets
        </div>
      </div>

      <Dialog open={!!selectedTicket} onOpenChange={(open) => !open && setSelectedTicket(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalhes do Ticket #{selectedTicket?.id}</DialogTitle>
            <DialogDescription>Informações completas do chamado</DialogDescription>
          </DialogHeader>
          {selectedTicket && (
            <div className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground">Título</Label>
                <p className="font-medium">{selectedTicket.titulo}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    <Badge className={`${STATUS_COLORS[selectedTicket.statusCode]} text-white`}>
                      {selectedTicket.status}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Prioridade</Label>
                  <div className="mt-1">
                    <Badge style={{ backgroundColor: PRIORITY_COLORS[selectedTicket.prioridadeCode] }} className="text-white">
                      {selectedTicket.prioridade}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Categoria</Label>
                  <p>{selectedTicket.categoria}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Data de Criação</Label>
                  <p>{format(parseISO(selectedTicket.dataCriacao), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Início Previsto (SLA)</Label>
                  <p>{format(parseISO(selectedTicket.dataInicio), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Fim Previsto (SLA)</Label>
                  <p>{format(parseISO(selectedTicket.dataFim), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Última Modificação</Label>
                <p>{format(parseISO(selectedTicket.dataModificacao), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
              </div>
              
              {/* Responsável Section */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs text-muted-foreground">Responsável (Control Desk)</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span>{selectedTicket.operacao || "Não atribuído"}</span>
                    </div>
                  </div>
                  {analista?.role === "admin" && (
                    <div className="flex items-center gap-2">
                      <Select
                        onValueChange={(value) => {
                          if (value) {
                            updateResponsibleMutation.mutate({
                              ticketId: selectedTicket.id,
                              analistaId: value
                            });
                          }
                        }}
                      >
                        <SelectTrigger className="w-48" data-testid="select-responsible">
                          <SelectValue placeholder="Alterar responsável" />
                        </SelectTrigger>
                        <SelectContent>
                          {analistasData?.filter((a: any) => a.ativo && a.role !== "admin").map((a: any) => (
                            <SelectItem key={a.id} value={a.id} data-testid={`select-responsible-${a.id}`}>
                              {a.nome} ({a.role === "control_desk" ? "Control Desk" : "Analista TI"})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {updateResponsibleMutation.isPending && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

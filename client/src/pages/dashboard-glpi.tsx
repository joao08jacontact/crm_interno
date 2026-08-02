import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, isWithinInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  BarChart3,
  Ticket,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Filter,
  Search,
  Timer,
  X,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type GlpiTicket, type TicketStats } from "@shared/schema";

interface ChartDataPoint {
  date: string;
  abertos: number;
  fechados: number;
}

interface TimeMetrics {
  tempoMedioFechamento: string;
  tempoMedioResolucao: string;
  tempoAtePrimeiroAtendimento: string;
  tempoMedioEspera: string;
}

const STATUS_COLORS: Record<number, string> = {
  1: "bg-blue-500",
  2: "bg-yellow-500",
  3: "bg-yellow-600",
  4: "bg-orange-500",
  5: "bg-green-500",
  6: "bg-gray-500",
};

const PRIORITY_COLORS: Record<number, string> = {
  1: "bg-gray-400",
  2: "bg-blue-400",
  3: "bg-yellow-400",
  4: "bg-orange-500",
  5: "bg-red-500",
  6: "bg-red-700",
};

const BAR_COLORS = [
  "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1"
];

export default function DashboardGlpi() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [dateAberturaFrom, setDateAberturaFrom] = useState("");
  const [dateAberturaTo, setDateAberturaTo] = useState("");
  const [dateFechamentoFrom, setDateFechamentoFrom] = useState("");
  const [dateFechamentoTo, setDateFechamentoTo] = useState("");

  const { data: tickets = [], isLoading: ticketsLoading, refetch: refetchTickets } = useQuery<GlpiTicket[]>({
    queryKey: ["/api/tickets"],
    refetchInterval: 60000,
  });

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery<TicketStats>({
    queryKey: ["/api/tickets/stats"],
    refetchInterval: 60000,
  });

  const { data: chartData = [], isLoading: chartLoading, refetch: refetchChart } = useQuery<ChartDataPoint[]>({
    queryKey: ["/api/tickets/chart"],
    refetchInterval: 60000,
  });

  const { data: timeMetrics, isLoading: metricsLoading, refetch: refetchMetrics } = useQuery<TimeMetrics>({
    queryKey: ["/api/tickets/metrics"],
    refetchInterval: 60000,
  });

  const categories = useMemo(() => {
    const cats = new Set(tickets.map(t => t.categoria).filter(Boolean));
    return Array.from(cats).sort();
  }, [tickets]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      if (statusFilter !== "all") {
        if (statusFilter === "resolvidos") {
          if (ticket.statusCode !== 5 && ticket.statusCode !== 6) return false;
        } else if (parseInt(statusFilter) !== ticket.statusCode) {
          return false;
        }
      }
      if (categoryFilter !== "all" && ticket.categoria !== categoryFilter) {
        return false;
      }
      if (searchQuery && !ticket.titulo.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      if (dateAberturaFrom || dateAberturaTo) {
        const ticketDate = parseISO(ticket.dataCriacao);
        if (dateAberturaFrom && ticketDate < parseISO(dateAberturaFrom)) return false;
        if (dateAberturaTo && ticketDate > parseISO(dateAberturaTo + "T23:59:59")) return false;
      }
      if (dateFechamentoFrom || dateFechamentoTo) {
        if (!ticket.dataFechamento) return false;
        const fechDate = parseISO(ticket.dataFechamento);
        if (dateFechamentoFrom && fechDate < parseISO(dateFechamentoFrom)) return false;
        if (dateFechamentoTo && fechDate > parseISO(dateFechamentoTo + "T23:59:59")) return false;
      }
      return true;
    });
  }, [tickets, statusFilter, categoryFilter, searchQuery, dateAberturaFrom, dateAberturaTo, dateFechamentoFrom, dateFechamentoTo]);

  const operacaoData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredTickets.forEach(t => {
      const op = t.operacao || "Não informado";
      counts[op] = (counts[op] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filteredTickets]);

  const solicitanteData = useMemo(() => {
    const counts: Record<number, number> = {};
    filteredTickets.forEach(t => {
      counts[t.solicitanteId] = (counts[t.solicitanteId] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([id, value]) => ({ name: `Usuário #${id}`, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filteredTickets]);

  const handleRefresh = () => {
    refetchTickets();
    refetchStats();
    refetchChart();
    refetchMetrics();
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setCategoryFilter("all");
    setDateAberturaFrom("");
    setDateAberturaTo("");
    setDateFechamentoFrom("");
    setDateFechamentoTo("");
  };

  // Calcular estatísticas baseadas nos tickets filtrados
  const filteredStats = useMemo(() => {
    const total = filteredTickets.length;
    const novos = filteredTickets.filter(t => t.statusCode === 1).length;
    const emProcessamento = filteredTickets.filter(t => t.statusCode === 2).length;
    const pendentes = filteredTickets.filter(t => t.statusCode === 4).length;
    const resolvidos = filteredTickets.filter(t => t.statusCode === 5 || t.statusCode === 6).length;
    return { total, novos, emProcessamento, pendentes, resolvidos };
  }, [filteredTickets]);

  // Verificar se há algum filtro ativo
  const hasActiveFilters = searchQuery || statusFilter !== "all" || categoryFilter !== "all" || 
    dateAberturaFrom || dateAberturaTo || dateFechamentoFrom || dateFechamentoTo;

  // Usar stats filtrados se houver filtros ativos, caso contrário usar stats da API
  const displayStats = hasActiveFilters ? filteredStats : {
    total: stats?.total || 0,
    novos: stats?.novos || 0,
    emProcessamento: stats?.emProcessamento || 0,
    pendentes: stats?.pendentes || 0,
    resolvidos: (stats?.resolvidos || 0) + (stats?.fechados || 0)
  };

  // Calcular métricas de tempo baseadas nos tickets filtrados
  const filteredMetrics = useMemo(() => {
    const formatTime = (ms: number): string => {
      const hours = Math.floor(ms / 3600000);
      const minutes = Math.floor((ms % 3600000) / 60000);
      const seconds = Math.floor((ms % 60000) / 1000);
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    // Tempo de fechamento - tickets com dataFechamento (status 5 ou 6)
    const closedTickets = filteredTickets.filter(t => t.dataFechamento && (t.statusCode === 5 || t.statusCode === 6));
    let tempoMedioFechamento = "00:00:00";
    if (closedTickets.length > 0) {
      let totalMs = 0;
      closedTickets.forEach(t => {
        const criacao = new Date(t.dataCriacao).getTime();
        const fechamento = new Date(t.dataFechamento!).getTime();
        totalMs += fechamento - criacao;
      });
      tempoMedioFechamento = formatTime(totalMs / closedTickets.length);
    }

    // Tempo de resolução - apenas status 5 (Resolvido)
    const resolvedTickets = filteredTickets.filter(t => t.statusCode === 5);
    let tempoMedioResolucao = "00:00:00";
    if (resolvedTickets.length > 0) {
      let totalMs = 0;
      resolvedTickets.forEach(t => {
        const criacao = new Date(t.dataCriacao).getTime();
        const modificacao = new Date(t.dataModificacao).getTime();
        totalMs += modificacao - criacao;
      });
      tempoMedioResolucao = formatTime(totalMs / resolvedTickets.length);
    }

    // Tempo até primeiro atendimento - diferença entre modificação e criação para tickets que saíram do status "Novo"
    const attendedTickets = filteredTickets.filter(t => t.statusCode >= 2 && t.statusCode <= 6);
    let tempoAtePrimeiroAtendimento = "00:00:00";
    if (attendedTickets.length > 0) {
      let totalMs = 0;
      let validCount = 0;
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      attendedTickets.forEach(t => {
        const criacao = new Date(t.dataCriacao).getTime();
        const modificacao = new Date(t.dataModificacao).getTime();
        const diff = modificacao - criacao;
        // Apenas considera se a diferença for positiva e menor que 30 dias
        if (diff > 0 && diff < thirtyDays) {
          totalMs += diff;
          validCount++;
        }
      });
      if (validCount > 0) {
        tempoAtePrimeiroAtendimento = formatTime(totalMs / validCount);
      }
    }

    // Tempo médio de espera - (agora - dataModificacao) para tickets pendentes (status 4)
    const pendingTickets = filteredTickets.filter(t => t.statusCode === 4);
    let tempoMedioEspera = "00:00:00";
    if (pendingTickets.length > 0) {
      let totalMs = 0;
      const now = Date.now();
      pendingTickets.forEach(t => {
        const modificacao = new Date(t.dataModificacao).getTime();
        const waitTime = now - modificacao;
        if (waitTime > 0) {
          totalMs += waitTime;
        }
      });
      tempoMedioEspera = formatTime(totalMs / pendingTickets.length);
    }
    
    return { tempoMedioFechamento, tempoMedioResolucao, tempoAtePrimeiroAtendimento, tempoMedioEspera };
  }, [filteredTickets]);

  // Usar métricas filtradas se houver filtros ativos
  const displayMetrics = hasActiveFilters ? filteredMetrics : timeMetrics;

  // Calcular gráfico filtrado de abertos vs fechados
  const filteredChartData = useMemo(() => {
    const days: Record<string, { abertos: number; fechados: number }> = {};
    const now = new Date();
    
    // Initialize last 30 days
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const key = date.toISOString().split('T')[0];
      days[key] = { abertos: 0, fechados: 0 };
    }
    
    filteredTickets.forEach(t => {
      const criacaoDate = t.dataCriacao.split('T')[0];
      if (days[criacaoDate]) {
        days[criacaoDate].abertos++;
      }
      if (t.dataModificacao && (t.statusCode === 5 || t.statusCode === 6)) {
        const modDate = t.dataModificacao.split('T')[0];
        if (days[modDate]) {
          days[modDate].fechados++;
        }
      }
    });
    
    return Object.entries(days).map(([date, data]) => ({
      date: date.split('-').slice(1).join('/'),
      abertos: data.abertos,
      fechados: data.fechados
    }));
  }, [filteredTickets]);

  // Usar gráfico filtrado se houver filtros ativos
  const displayChartData = hasActiveFilters ? filteredChartData : chartData;

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between gap-4 p-4 border-b bg-card">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-semibold">Dashboard GLPI</h1>
            <p className="text-sm text-muted-foreground">Monitoramento de tickets em tempo real</p>
          </div>
        </div>

        <Button variant="outline" onClick={handleRefresh} data-testid="button-refresh">
          <RefreshCw className="h-4 w-4 mr-2" />
          Atualizar
        </Button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Filtros</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Nome do Ticket</Label>
                  <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Filtrar por nome..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      data-testid="input-search"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Data de Abertura - De</Label>
                  <Input
                    type="date"
                    value={dateAberturaFrom}
                    onChange={(e) => setDateAberturaFrom(e.target.value)}
                    data-testid="input-abertura-de"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Data de Abertura - Até</Label>
                  <Input
                    type="date"
                    value={dateAberturaTo}
                    onChange={(e) => setDateAberturaTo(e.target.value)}
                    data-testid="input-abertura-ate"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Data de Fechamento - De</Label>
                  <Input
                    type="date"
                    value={dateFechamentoFrom}
                    onChange={(e) => setDateFechamentoFrom(e.target.value)}
                    data-testid="input-fechamento-de"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Data de Fechamento - Até</Label>
                  <Input
                    type="date"
                    value={dateFechamentoTo}
                    onChange={(e) => setDateFechamentoTo(e.target.value)}
                    data-testid="input-fechamento-ate"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Status</Label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: "all", label: "Todos" },
                    { value: "1", label: "Novo" },
                    { value: "2", label: "Em Processamento" },
                    { value: "4", label: "Pendente" },
                    { value: "resolvidos", label: "Resolvido" },
                  ].map(item => (
                    <Button
                      key={item.value}
                      variant={statusFilter === item.value ? "default" : "outline"}
                      size="sm"
                      onClick={() => setStatusFilter(item.value)}
                      data-testid={`filter-status-${item.value}`}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Categorias</Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={categoryFilter === "all" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCategoryFilter("all")}
                  >
                    Todas
                  </Button>
                  {categories.slice(0, 7).map(cat => (
                    <Button
                      key={cat}
                      variant={categoryFilter === cat ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCategoryFilter(cat)}
                    >
                      {cat}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="default" size="sm" data-testid="button-apply-filters">
                  Aplicar Filtros
                </Button>
                <Button variant="outline" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
                  Limpar Tudo
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-blue-500/10">
                  <Ticket className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold" data-testid="stat-total">{statsLoading && !hasActiveFilters ? "-" : displayStats.total}</p>
                  <p className="text-xs text-muted-foreground">Total</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-blue-600/10">
                  <AlertCircle className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold" data-testid="stat-novos">{statsLoading && !hasActiveFilters ? "-" : displayStats.novos}</p>
                  <p className="text-xs text-muted-foreground">Novos</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-yellow-500/10">
                  <Clock className="h-5 w-5 text-yellow-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold" data-testid="stat-processamento">{statsLoading && !hasActiveFilters ? "-" : displayStats.emProcessamento}</p>
                  <p className="text-xs text-muted-foreground">Em Processamento</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-orange-500/10">
                  <Clock className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold" data-testid="stat-pendentes">{statsLoading && !hasActiveFilters ? "-" : displayStats.pendentes}</p>
                  <p className="text-xs text-muted-foreground">Pendentes</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-green-500/10">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold" data-testid="stat-resolvidos">{statsLoading && !hasActiveFilters ? "-" : displayStats.resolvidos}</p>
                  <p className="text-xs text-muted-foreground">Resolvidos</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Tickets Abertos vs Resolvidos (Últimos 30 dias)</CardTitle>
          </CardHeader>
          <CardContent>
            {chartLoading && !hasActiveFilters ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={displayChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217, 20%, 25%)" />
                  <XAxis 
                    dataKey="date" 
                    stroke="hsl(217, 20%, 50%)" 
                    fontSize={12}
                    tick={{ fill: 'hsl(217, 20%, 60%)' }}
                  />
                  <YAxis 
                    stroke="hsl(217, 20%, 50%)" 
                    fontSize={12}
                    tick={{ fill: 'hsl(217, 20%, 60%)' }}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(217, 30%, 15%)', 
                      border: '1px solid hsl(217, 20%, 30%)',
                      borderRadius: '8px',
                      color: 'hsl(217, 20%, 90%)'
                    }}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="abertos" 
                    name="Abertos"
                    stroke="#3b82f6" 
                    strokeWidth={2}
                    dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6, stroke: '#3b82f6', strokeWidth: 2 }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="fechados" 
                    name="Resolvidos"
                    stroke="#22c55e" 
                    strokeWidth={2}
                    dot={{ fill: '#22c55e', strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6, stroke: '#22c55e', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-4">Métricas de Tempo</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="bg-gradient-to-br from-card to-card/80">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-full bg-orange-500/20">
                    <Timer className="h-6 w-6 text-orange-500" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Tempo Médio de Resolução</p>
                    <p className="text-2xl font-bold font-mono mt-1" data-testid="metric-resolucao">
                      {metricsLoading && !hasActiveFilters ? "-" : displayMetrics?.tempoMedioFechamento || "00:00:00"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-card to-card/80">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-full bg-blue-500/20">
                    <Clock className="h-6 w-6 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Tempo Até Primeiro Atendimento</p>
                    <p className="text-2xl font-bold font-mono mt-1" data-testid="metric-atendimento">
                      {metricsLoading && !hasActiveFilters ? "-" : displayMetrics?.tempoAtePrimeiroAtendimento || "00:00:00"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="mb-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Chamados por Solicitante</CardTitle>
            </CardHeader>
            <CardContent>
              {ticketsLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : solicitanteData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhum dado disponível</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={solicitanteData} layout="vertical" margin={{ left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(217, 20%, 25%)" />
                    <XAxis type="number" stroke="hsl(217, 20%, 50%)" fontSize={12} />
                    <YAxis 
                      type="category" 
                      dataKey="name" 
                      stroke="hsl(217, 20%, 50%)" 
                      fontSize={11}
                      width={80}
                      tick={{ fill: 'hsl(217, 20%, 60%)' }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(217, 30%, 15%)', 
                        border: '1px solid hsl(217, 20%, 30%)',
                        borderRadius: '8px',
                        color: 'hsl(217, 20%, 90%)'
                      }}
                    />
                    <Bar dataKey="value" name="Chamados">
                      {solicitanteData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Lista de Tickets
              </div>
              <Badge variant="secondary">
                {filteredTickets.length} ticket{filteredTickets.length !== 1 ? "s" : ""}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ticketsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : filteredTickets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Ticket className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Nenhum ticket encontrado</h3>
                <p className="text-muted-foreground">
                  {tickets.length === 0
                    ? "Não há tickets no sistema ainda"
                    : "Tente ajustar os filtros de busca"}
                </p>
              </div>
            ) : (
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">ID</TableHead>
                      <TableHead>Título</TableHead>
                      <TableHead className="w-40">Categoria</TableHead>
                      <TableHead className="w-32">Operação</TableHead>
                      <TableHead className="w-40">Status</TableHead>
                      <TableHead className="w-28">Prioridade</TableHead>
                      <TableHead className="w-36">Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTickets.slice(0, 50).map((ticket) => (
                      <TableRow key={ticket.id} data-testid={`ticket-row-${ticket.id}`}>
                        <TableCell className="font-mono text-sm">#{ticket.id}</TableCell>
                        <TableCell className="max-w-md truncate" title={ticket.titulo}>{ticket.titulo}</TableCell>
                        <TableCell className="text-sm truncate" title={ticket.categoria}>{ticket.categoria}</TableCell>
                        <TableCell className="text-sm truncate">{ticket.operacao || "-"}</TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={`${STATUS_COLORS[ticket.statusCode] || "bg-gray-500"} text-white`}
                          >
                            {ticket.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={`${PRIORITY_COLORS[ticket.prioridadeCode] || "bg-gray-400"} text-white`}
                          >
                            {ticket.prioridade}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(ticket.dataCriacao), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

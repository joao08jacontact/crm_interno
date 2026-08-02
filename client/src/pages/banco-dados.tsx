import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Database, Table2, Eye, RefreshCw, ChevronRight, ChevronDown,
  Clock, CheckCircle2, XCircle, AlertCircle, Code2, Rows3, Layers,
  ServerCrash, Play, CalendarClock, Hash, Server, HardDrive, Activity,
  Users, Zap, Settings2, GitBranch, ArrowRight, Loader2, Power, PowerOff,
  RotateCw, PlayCircle, PauseCircle, SortAsc, Bookmark, Pencil, Trash2, Plus, X, Search,
  Download, Filter
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface DbCustomBlock {
  id: string;
  database: string;
  nome: string;
  tables: string[]; // "schema.table" strings
}

interface SchemaDetail {
  tables: { name: string; rows: number | null }[];
  matviews: { name: string; ispopulated: boolean; definition: string }[];
  views: { name: string; definition: string }[];
}

interface Column {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

interface DbInfo {
  name: string;
  size: string;
  sizeBytes: number;
  owner: string;
  collate: string;
  connLimit: number | null;
  connections: number;
}

interface ServerOverview {
  connectedVia: string;
  version: string;
  serverVersion: string;
  maxConnections: number;
  dataDirectory: string;
  connections: { total: string; active: string; idle: string; waiting: string };
  databases: DbInfo[];
  totalSize: string;
  totalSizeBytes: number;
}

interface CronJob {
  jobid: number;
  jobname: string;
  schedule: string;
  command: string;
  active: boolean;
  start_time: string | null;
  end_time: string | null;
  status: string | null;
  return_message: string | null;
}

interface TableWithColumns {
  schema: string;
  name: string;
  kind: "table" | "matview" | "view";
  columns: { column_name: string; data_type: string }[];
}

/** Parse PG date/timestamp strings treating naive values as São Paulo (UTC-3) */
function parsePgDate(raw: string): Date {
  if (!raw) return new Date(NaN);
  // Already has timezone info — parse as-is
  if (raw.includes("+") || raw.toUpperCase().endsWith("Z")) {
    let s = raw.replace(" ", "T");
    // Normalize bare offset "+00" / "-03" → "+00:00" / "-03:00"
    // PostgreSQL sometimes returns "+00" without ":MM"
    s = s.replace(/([+-])(\d{2})$/, "$1$2:00");
    return new Date(s);
  }
  // Date-only: "YYYY-MM-DD" → treat as SP midnight
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(raw + "T00:00:00-03:00");
  }
  // Timestamp without timezone: "YYYY-MM-DD HH:MM:SS" → treat as SP
  return new Date(raw.replace(" ", "T") + "-03:00");
}

function formatDateTime(iso: string | null) {
  if (!iso) return null;
  try {
    const d = parsePgDate(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return iso; }
}

function isRecent(iso: string | null, hours = 24): boolean {
  if (!iso) return false;
  try {
    const diff = Date.now() - parsePgDate(iso).getTime();
    return diff < hours * 3600 * 1000;
  } catch { return false; }
}

function todayLocalStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ExportCsvDialog({ open, onClose, database, schema, table, dateColumn }: {
  open: boolean; onClose: () => void;
  database: string; schema: string; table: string; dateColumn: string;
}) {
  const today = todayLocalStr();
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [filterColumn, setFilterColumn] = useState("nenhuma");
  const [filterValue, setFilterValue] = useState("");
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  const { data: columns = [] } = useQuery<Column[]>({
    queryKey: ["/api/db-table-columns", database, schema, table],
    queryFn: async () => {
      const res = await fetch(`/api/db-table-columns?database=${encodeURIComponent(database)}&schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}`);
      return res.json();
    },
    enabled: open,
  });

  const doExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({
        database, schema, table, dateColumn,
        dateFrom: dateFrom ? `${dateFrom}T00:00:00` : "",
        dateTo: dateTo ? `${dateTo}T23:59:59` : "",
        ...(filterColumn !== "nenhuma" && filterValue ? { filterColumn, filterValue } : {}),
      });
      Object.keys(Object.fromEntries(params)).forEach(k => { if (!params.get(k)) params.delete(k); });
      const res = await fetch(`/api/db-export-csv?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erro desconhecido" }));
        toast({ title: `Erro ao exportar: ${err.error}`, variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${table}_${today}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "CSV exportado com sucesso!" });
    } catch (e: any) {
      toast({ title: `Erro: ${e.message}`, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Download className="h-4 w-4 text-blue-400" />
            Exportar CSV — <span className="font-mono text-muted-foreground">{schema}.{table}</span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Configurar e exportar dados da tabela {schema}.{table} em formato CSV.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Date range */}
          <div className="space-y-2">
            <Label className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Filtro por data — coluna: <code className="font-mono bg-muted px-1 rounded">{dateColumn}</code>
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">De</Label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="w-full h-8 px-2 text-xs rounded-md border border-input bg-background text-foreground"
                  data-testid="input-date-from"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Até</Label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="w-full h-8 px-2 text-xs rounded-md border border-input bg-background text-foreground"
                  data-testid="input-date-to"
                />
              </div>
            </div>
          </div>

          {/* Column filter */}
          <div className="space-y-2">
            <Label className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
              <Filter className="h-3.5 w-3.5" /> Filtro por coluna (opcional)
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Coluna</Label>
                <select
                  value={filterColumn}
                  onChange={e => { setFilterColumn(e.target.value); if (e.target.value === "nenhuma") setFilterValue(""); }}
                  className="w-full h-8 px-2 text-xs rounded-md border border-input bg-background text-foreground"
                  data-testid="select-filter-column"
                >
                  <option value="nenhuma">— Nenhuma —</option>
                  {columns.map(c => (
                    <option key={c.column_name} value={c.column_name}>{c.column_name} ({c.data_type})</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Contém</Label>
                <input
                  type="text"
                  value={filterValue}
                  onChange={e => setFilterValue(e.target.value)}
                  disabled={filterColumn === "nenhuma"}
                  placeholder="valor a filtrar..."
                  className="w-full h-8 px-2 text-xs rounded-md border border-input bg-background text-foreground disabled:opacity-40"
                  data-testid="input-filter-value"
                />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border/30 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Exporta até <strong>100.000 linhas</strong>, ordenadas da mais recente para a mais antiga.
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
            <Button size="sm" onClick={doExport} disabled={exporting} data-testid="button-export-csv">
              {exporting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
              {exporting ? "Exportando..." : "Exportar CSV"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LastUpdateBadge({ database, schema, table, column }: { database: string; schema: string; table: string; column: string }) {
  const { data, isLoading } = useQuery<{ lastUpdate: string | null }>({
    queryKey: ["/api/db-table-lastupdate", database, schema, table, column],
    queryFn: async () => {
      const res = await fetch(`/api/db-table-lastupdate?database=${encodeURIComponent(database)}&schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}&column=${encodeURIComponent(column)}`);
      return res.json();
    },
    staleTime: 60_000,
    retry: false,
  });

  if (isLoading) return <Skeleton className="h-4 w-24 inline-block" />;
  if (!data?.lastUpdate) return <span className="text-xs text-muted-foreground/50 italic">sem data</span>;

  const raw = data.lastUpdate;
  const d = parsePgDate(raw);
  const isFuture = !isNaN(d.getTime()) && d.getTime() > Date.now();
  let display = raw;
  if (!isNaN(d.getTime())) {
    display = d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <span
      title={`Valor bruto do banco: ${raw}`}
      className={`inline-flex items-center gap-1 text-xs font-mono cursor-help ${isFuture ? "text-amber-500" : "text-emerald-500"}`}
    >
      <Clock className="h-3 w-3" />
      {display}
      {isFuture && <span className="text-amber-400 text-[10px]">↑futuro</span>}
    </span>
  );
}

function SqlViewer({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false);
  const lines = sql?.trim().split("\n") || [];
  return (
    <div className="mt-2">
      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground" onClick={() => setOpen(o => !o)}>
        <Code2 className="h-3.5 w-3.5" />
        {open ? "Recolher SQL" : `Ver SQL (${lines.length} linha${lines.length !== 1 ? "s" : ""})`}
      </Button>
      {open && (
        <pre className="mt-2 p-3 bg-muted/60 rounded-md text-xs font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed border">
          {sql?.trim()}
        </pre>
      )}
    </div>
  );
}

function ColumnList({ schema, table, database }: { schema: string; table: string; database: string }) {
  const { data: columns, isLoading } = useQuery<Column[]>({
    queryKey: ["/api/db-table-columns", database, schema, table],
    queryFn: async () => {
      const res = await fetch(`/api/db-table-columns?database=${encodeURIComponent(database)}&schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}`);
      return res.json();
    },
  });

  if (isLoading) return <div className="py-2 px-4"><Skeleton className="h-4 w-full" /></div>;
  if (!columns || columns.length === 0) return <div className="px-4 py-2 text-xs text-muted-foreground">Sem colunas</div>;

  return (
    <div className="px-3 pb-2 pt-1 space-y-0.5">
      {columns.map(col => (
        <div key={col.column_name} className="flex items-center gap-2 py-0.5 text-xs">
          <Hash className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="font-mono font-medium">{col.column_name}</span>
          <span className="text-muted-foreground">{col.data_type}</span>
          {col.is_nullable === "YES" && <span className="text-muted-foreground/60">null</span>}
          {col.column_default && <span className="text-muted-foreground/60 truncate max-w-[200px]">= {col.column_default}</span>}
        </div>
      ))}
    </div>
  );
}

function TableItem({ schema, name, rows, icon: Icon, iconClass, database, timestampConfig }: { schema: string; name: string; rows?: number | null; icon: any; iconClass: string; database: string; timestampConfig: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const tsColumn = timestampConfig[`${schema}.${name}`];
  return (
    <div>
      <div className="flex items-center gap-1 group">
        <button
          className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 rounded text-sm text-left flex-1 min-w-0"
          onClick={() => setOpen(o => !o)}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          <Icon className={`h-3.5 w-3.5 shrink-0 ${iconClass}`} />
          <span className="font-mono flex-1 truncate">{name}</span>
          {tsColumn && <LastUpdateBadge database={database} schema={schema} table={name} column={tsColumn} />}
          {rows != null && <span className="text-xs text-muted-foreground opacity-60 group-hover:opacity-100 ml-1">{rows.toLocaleString("pt-BR")}</span>}
        </button>
        {tsColumn && (
          <button
            type="button"
            title="Exportar CSV"
            onClick={() => setExportOpen(true)}
            data-testid={`btn-export-${schema}-${name}`}
            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 flex items-center justify-center rounded hover:bg-muted/80 text-muted-foreground hover:text-blue-400 mr-1"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && <ColumnList schema={schema} table={name} database={database} />}
      {exportOpen && tsColumn && (
        <ExportCsvDialog
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          database={database}
          schema={schema}
          table={name}
          dateColumn={tsColumn}
        />
      )}
    </div>
  );
}

function SchemaAccordion({ schema, database, timestampConfig }: { schema: string; database: string; timestampConfig: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [bulkTs, setBulkTs] = useState<Record<string, string | null>>({});

  const { data, isLoading, error } = useQuery<SchemaDetail>({
    queryKey: ["/api/db-schema-detail", database, schema],
    queryFn: async () => {
      const res = await fetch(`/api/db-schema-detail?database=${encodeURIComponent(database)}&schema=${encodeURIComponent(schema)}`);
      return res.json();
    },
    enabled: open,
  });

  // Fetch bulk timestamps when schema detail loads
  useEffect(() => {
    if (!data) return;
    const items = data.tables
      .filter(t => !!timestampConfig[`${schema}.${t.name}`])
      .map(t => ({ schema, table: t.name, column: timestampConfig[`${schema}.${t.name}`] }));
    if (items.length === 0) return;
    fetch("/api/db-bulk-lastupdates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ database, items }),
    }).then(r => r.json()).then(result => setBulkTs(result)).catch(() => {});
  }, [data, schema, database, timestampConfig]);

  // Sort tables: least-updated (oldest) first → most-updated → no config last
  const sortedTables = data ? [...data.tables].sort((a, b) => {
    const hasA = !!timestampConfig[`${schema}.${a.name}`];
    const hasB = !!timestampConfig[`${schema}.${b.name}`];
    if (!hasA && !hasB) return 0;
    if (!hasA) return 1;
    if (!hasB) return -1;
    const tsA = bulkTs[`${schema}.${a.name}`];
    const tsB = bulkTs[`${schema}.${b.name}`];
    if (tsA === null && tsB === null) return 0;
    if (tsA === null) return -1;
    if (tsB === null) return 1;
    return new Date(tsA).getTime() - new Date(tsB).getTime();
  }) : [];

  const totalItems = (data?.tables.length || 0) + (data?.matviews.length || 0) + (data?.views.length || 0);

  return (
    <Card className="overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
        <Layers className="h-4 w-4 text-blue-500 shrink-0" />
        <span className="font-semibold text-sm flex-1 text-left uppercase tracking-wide">{schema}</span>
        {data && (
          <div className="flex items-center gap-2">
            {data.tables.length > 0 && <Badge variant="outline" className="text-xs gap-1"><Table2 className="h-3 w-3" />{data.tables.length}</Badge>}
            {data.matviews.length > 0 && <Badge variant="outline" className="text-xs gap-1 text-purple-500 border-purple-500/30"><Eye className="h-3 w-3" />{data.matviews.length}</Badge>}
            {data.views.length > 0 && <Badge variant="outline" className="text-xs gap-1 text-cyan-500 border-cyan-500/30"><Eye className="h-3 w-3" />{data.views.length}</Badge>}
          </div>
        )}
      </button>

      {open && (
        <div className="border-t">
          {isLoading && (
            <div className="p-4 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 p-4 text-sm text-red-500">
              <XCircle className="h-4 w-4" />{(error as any).message}
            </div>
          )}
          {data && totalItems === 0 && (
            <div className="p-4 text-sm text-muted-foreground text-center">Schema vazio</div>
          )}
          {data && (
            <div className="divide-y divide-border/50">
              {data.tables.length > 0 && (
                <div className="p-2">
                  <div className="flex items-center gap-2 px-3 py-1 mb-1">
                    <Table2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tabelas ({data.tables.length})</span>
                    {Object.keys(bulkTs).length > 0 && <span className="text-xs text-muted-foreground/50 flex items-center gap-1"><SortAsc className="h-3 w-3" />menos recente → mais recente</span>}
                  </div>
                  {sortedTables.map(t => (
                    <TableItem key={t.name} schema={schema} name={t.name} rows={t.rows} icon={Table2} iconClass="text-muted-foreground" database={database} timestampConfig={timestampConfig} />
                  ))}
                </div>
              )}
              {data.matviews.length > 0 && (
                <div className="p-2">
                  <div className="flex items-center gap-2 px-3 py-1 mb-1">
                    <Eye className="h-3.5 w-3.5 text-purple-500" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Views Materializadas ({data.matviews.length})</span>
                  </div>
                  {data.matviews.map(v => (
                    <div key={v.name} className="px-3 py-1.5">
                      <div className="flex items-center gap-2 text-sm">
                        <Eye className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                        <span className="font-mono flex-1">{v.name}</span>
                        <Badge variant="outline" className={`text-xs ${v.ispopulated ? "text-green-500 border-green-500/30" : "text-yellow-500 border-yellow-500/30"}`}>
                          {v.ispopulated ? "Populada" : "Não populada"}
                        </Badge>
                      </div>
                      <SqlViewer sql={v.definition} />
                    </div>
                  ))}
                </div>
              )}
              {data.views.length > 0 && (
                <div className="p-2">
                  <div className="flex items-center gap-2 px-3 py-1 mb-1">
                    <Eye className="h-3.5 w-3.5 text-cyan-500" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Views ({data.views.length})</span>
                  </div>
                  {data.views.map(v => (
                    <div key={v.name} className="px-3 py-1.5">
                      <div className="flex items-center gap-2 text-sm">
                        <Eye className="h-3.5 w-3.5 text-cyan-500 shrink-0" />
                        <span className="font-mono flex-1">{v.name}</span>
                      </div>
                      <SqlViewer sql={v.definition} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function BlockTableRow({ database, schema, name, tsColumn }: { database: string; schema: string; name: string; tsColumn?: string }) {
  const [exportOpen, setExportOpen] = useState(false);
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 rounded group">
      <Table2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-xs text-muted-foreground/70 font-mono shrink-0">{schema}.</span>
      <span className="font-mono text-sm flex-1 truncate">{name}</span>
      {tsColumn && <LastUpdateBadge database={database} schema={schema} table={name} column={tsColumn} />}
      {tsColumn && (
        <button
          type="button"
          title="Exportar CSV"
          onClick={() => setExportOpen(true)}
          data-testid={`btn-export-block-${schema}-${name}`}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 flex items-center justify-center rounded hover:bg-muted/80 text-muted-foreground hover:text-blue-400"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      )}
      {exportOpen && tsColumn && (
        <ExportCsvDialog
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          database={database}
          schema={schema}
          table={name}
          dateColumn={tsColumn}
        />
      )}
    </div>
  );
}

function CustomBlockAccordion({ block, database, timestampConfig, onEdit, onDelete }: {
  block: DbCustomBlock;
  database: string;
  timestampConfig: Record<string, string>;
  onEdit: (block: DbCustomBlock) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [bulkTs, setBulkTs] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (!open || block.tables.length === 0) return;
    const items = block.tables
      .map(t => {
        const dot = t.indexOf(".");
        const schema = t.slice(0, dot);
        const table = t.slice(dot + 1);
        const column = timestampConfig[t];
        return column ? { schema, table, column } : null;
      })
      .filter(Boolean) as { schema: string; table: string; column: string }[];
    if (items.length === 0) return;
    fetch("/api/db-bulk-lastupdates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ database, items }),
    }).then(r => r.json()).then(result => setBulkTs(result)).catch(() => {});
  }, [open, block.tables, database, timestampConfig]);

  const sortedTables = [...block.tables].sort((a, b) => {
    const hasA = !!timestampConfig[a];
    const hasB = !!timestampConfig[b];
    if (!hasA && !hasB) return 0;
    if (!hasA) return 1;
    if (!hasB) return -1;
    const tsA = bulkTs[a];
    const tsB = bulkTs[b];
    if (tsA === null && tsB === null) return 0;
    if (tsA === null) return -1;
    if (tsB === null) return 1;
    return new Date(tsA).getTime() - new Date(tsB).getTime();
  });

  return (
    <Card className="overflow-hidden border-primary/40">
      <div className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
        <button className="flex items-center gap-3 flex-1 min-w-0" onClick={() => setOpen(o => !o)}>
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
          <Bookmark className="h-4 w-4 text-primary shrink-0" />
          <span className="font-semibold text-sm flex-1 text-left truncate">{block.nome}</span>
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="outline" className="text-xs text-primary border-primary/40">{block.tables.length} tabela{block.tables.length !== 1 ? "s" : ""}</Badge>
          <Button
            variant="ghost" size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => onEdit(block)}
            data-testid={`btn-edit-block-${block.id}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(block.id)}
            data-testid={`btn-delete-block-${block.id}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {open && (
        <div className="border-t">
          {block.tables.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">Nenhuma tabela selecionada</div>
          )}
          <div className="p-2">
            {Object.keys(bulkTs).length > 0 && (
              <div className="flex items-center gap-1 px-3 py-1 mb-1">
                <SortAsc className="h-3 w-3 text-muted-foreground/50" />
                <span className="text-xs text-muted-foreground/50">menos recente → mais recente</span>
              </div>
            )}
            {sortedTables.map(t => {
              const dot = t.indexOf(".");
              const schema = t.slice(0, dot);
              const name = t.slice(dot + 1);
              const tsColumn = timestampConfig[t];
              return (
                <BlockTableRow key={t} database={database} schema={schema} name={name} tsColumn={tsColumn} />
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

interface MatviewDep { dep_name: string; dep_schema: string; dep_kind: "table" | "matview" | "view" }

function MatviewCard({ database, schema, v, timestampConfig }: {
  database: string;
  schema: string;
  v: { name: string; ispopulated: boolean; definition: string };
  timestampConfig: Record<string, string>;
}) {
  const [showCode, setShowCode] = useState(false);
  const [showDeps, setShowDeps] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const { toast } = useToast();

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/db-matview-refresh", { database, schema, name: v.name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/db-table-lastupdate", database, schema, v.name] });
      queryClient.invalidateQueries({ queryKey: ["/api/db-matviews-all", database] });
      toast({ title: "View atualizada", description: `${v.name} foi atualizada com sucesso.` });
    },
    onError: (e: any) => toast({ title: "Erro ao atualizar", description: e.message, variant: "destructive" }),
  });

  const { data: depsData, isLoading: isLoadingDeps } = useQuery<{ deps: MatviewDep[] }>({
    queryKey: ["/api/db-matview-deps", database, schema, v.name],
    queryFn: async () => {
      const res = await fetch(`/api/db-matview-deps?database=${encodeURIComponent(database)}&schema=${encodeURIComponent(schema)}&name=${encodeURIComponent(v.name)}`);
      return res.json();
    },
    enabled: showDeps,
    staleTime: 120_000,
    retry: false,
  });

  const kindIcon = (kind: string) => {
    if (kind === "matview") return <Eye className="h-3.5 w-3.5 text-purple-500 shrink-0" />;
    if (kind === "view") return <Eye className="h-3.5 w-3.5 text-cyan-500 shrink-0" />;
    return <Table2 className="h-3.5 w-3.5 text-blue-400 shrink-0" />;
  };

  const tables = depsData?.deps.filter(d => d.dep_kind === "table") || [];
  const views = depsData?.deps.filter(d => d.dep_kind === "view") || [];
  const matviews = depsData?.deps.filter(d => d.dep_kind === "matview") || [];
  const allDeps = [...tables, ...views, ...matviews];

  const tsColumn = timestampConfig[`${schema}.${v.name}`];

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3 px-4 py-3">
        <Eye className="h-4 w-4 text-purple-500 shrink-0" />
        <span className="font-mono font-semibold text-sm flex-1 truncate">{v.name}</span>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {tsColumn && <LastUpdateBadge database={database} schema={schema} table={v.name} column={tsColumn} />}
          <Badge variant="outline" className={`text-xs ${v.ispopulated ? "text-green-500 border-green-500/30" : "text-yellow-500 border-yellow-500/30"}`}>
            {v.ispopulated ? "✓ Populada" : "⚠ Não populada"}
          </Badge>
          {tsColumn && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
              onClick={() => setExportOpen(true)}
              data-testid={`btn-export-matview-${v.name}`}
            >
              <Download className="h-3.5 w-3.5" />
              Exportar CSV
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            data-testid={`btn-refresh-matview-${v.name}`}
          >
            {refreshMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
            Atualizar agora
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-7 gap-1.5 text-xs ${showDeps ? "text-purple-500" : "text-muted-foreground"}`}
            onClick={() => setShowDeps(p => !p)}
            data-testid={`btn-deps-${v.name}`}
          >
            <GitBranch className="h-3.5 w-3.5" />
            {showDeps ? "Ocultar" : "Dependências"}
            {depsData && <Badge variant="secondary" className="text-[10px] px-1 h-4">{depsData.deps.length}</Badge>}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-7 gap-1.5 text-xs ${showCode ? "text-purple-500" : "text-muted-foreground"}`}
            onClick={() => setShowCode(p => !p)}
            data-testid={`btn-code-${v.name}`}
          >
            <Code2 className="h-3.5 w-3.5" />
            {showCode ? "Fechar" : "Ver código"}
          </Button>
        </div>
      </div>

      {showDeps && (
        <div className="border-t bg-muted/20 px-4 py-3">
          <div className="flex items-center gap-2 mb-3">
            <GitBranch className="h-3.5 w-3.5 text-purple-500" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dependências diretas</span>
          </div>
          {isLoadingDeps && (
            <div className="space-y-2">
              {[1,2,3].map(i => <Skeleton key={i} className="h-7 w-full rounded" />)}
            </div>
          )}
          {depsData && allDeps.length === 0 && (
            <p className="text-xs text-muted-foreground italic">Nenhuma dependência encontrada</p>
          )}
          {depsData && allDeps.length > 0 && (
            <div className="space-y-1">
              {/* Group by kind */}
              {[
                { kind: "table", items: tables, label: "Tabelas", color: "text-blue-400" },
                { kind: "view", items: views, label: "Views", color: "text-cyan-500" },
                { kind: "matview", items: matviews, label: "Views Materializadas", color: "text-purple-500" },
              ].map(group => group.items.length === 0 ? null : (
                <div key={group.kind} className="mb-2">
                  <span className={`text-[10px] font-semibold uppercase tracking-widest ${group.color} block mb-1`}>{group.label}</span>
                  <div className="space-y-0.5 pl-3 border-l border-border/60">
                    {group.items.map(dep => {
                      const depTsColumn = timestampConfig[`${dep.dep_schema}.${dep.dep_name}`];
                      return (
                        <div key={dep.dep_name} className="flex items-center gap-2 py-1">
                          <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                          {kindIcon(dep.dep_kind)}
                          <span className="font-mono text-xs">{dep.dep_name}</span>
                          {dep.dep_schema !== schema && (
                            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{dep.dep_schema}</span>
                          )}
                          {depTsColumn && (
                            <LastUpdateBadge
                              database={database}
                              schema={dep.dep_schema}
                              table={dep.dep_name}
                              column={depTsColumn}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showCode && (
        <div className="border-t px-4 pb-4 pt-3">
          <pre className="p-3 bg-muted/60 rounded-md text-xs font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed border">
            {v.definition?.trim()}
          </pre>
        </div>
      )}
      {exportOpen && tsColumn && (
        <ExportCsvDialog
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          database={database}
          schema={schema}
          table={v.name}
          dateColumn={tsColumn}
        />
      )}
    </Card>
  );
}

function CronsTabContent({ cronData, isLoadingCrons, activeDb, refetchCrons }: {
  cronData: { hasCron: boolean; jobs: CronJob[] } | undefined;
  isLoadingCrons: boolean;
  activeDb: string;
  refetchCrons: () => void;
}) {
  const { toast } = useToast();

  const toggleMutation = useMutation({
    mutationFn: ({ jobid, active }: { jobid: number; active: boolean }) =>
      apiRequest("POST", "/api/db-cron-toggle", { database: activeDb, jobid, active }),
    onSuccess: () => { refetchCrons(); toast({ title: "CRON atualizado" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const runNowMutation = useMutation({
    mutationFn: (jobid: number) =>
      apiRequest("POST", "/api/db-cron-run-now", { database: activeDb, jobid }),
    onSuccess: () => { refetchCrons(); toast({ title: "Executado", description: "Comando executado com sucesso." }); },
    onError: (e: any) => toast({ title: "Erro ao executar", description: e.message, variant: "destructive" }),
  });

  // Sort jobs: oldest last_run first, then no last_run (never ran)
  const sortedJobs = cronData?.jobs ? [...cronData.jobs].sort((a, b) => {
    if (!a.start_time && !b.start_time) return 0;
    if (!a.start_time) return 1;
    if (!b.start_time) return -1;
    return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
  }) : [];

  return (
    <ScrollArea className="h-full pr-2">
      {isLoadingCrons && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
        </div>
      )}
      {cronData && !cronData.hasCron && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <AlertCircle className="h-10 w-10 text-muted-foreground/50" />
          <div>
            <p className="font-medium">Extensão pg_cron não encontrada</p>
            <p className="text-sm text-muted-foreground mt-1">A extensão pg_cron não está instalada neste banco de dados.</p>
          </div>
        </div>
      )}
      {cronData?.hasCron && sortedJobs.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">Nenhum job CRON cadastrado</div>
      )}
      {cronData?.hasCron && sortedJobs.length > 0 && (
        <div className="space-y-3 pb-6">
          <div className="flex items-center gap-2 mb-3">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">CRON</span>
            <Badge variant="outline" className="text-xs">{sortedJobs.length} job{sortedJobs.length !== 1 ? "s" : ""}</Badge>
            <span className="text-xs text-muted-foreground ml-1 flex items-center gap-1"><SortAsc className="h-3 w-3" />mais antigos primeiro</span>
          </div>
          {sortedJobs.map(job => {
            const recent = isRecent(job.start_time, 24);
            const statusOk = job.status === "succeeded" || job.status === "running";
            const isToggling = toggleMutation.isPending;
            const isRunning = runNowMutation.isPending;
            return (
              <Card key={job.jobid} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{job.jobname || `Job #${job.jobid}`}</span>
                        <Badge variant="outline" className={`text-xs ${job.active ? "text-green-500 border-green-500/30" : "text-red-500 border-red-500/30"}`}>
                          {job.active ? "Ativo" : "Inativo"}
                        </Badge>
                      </div>
                      {job.start_time && (
                        <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>{formatDateTime(job.start_time)}</span>
                          {job.end_time && job.start_time && (
                            <span className="text-muted-foreground/60">
                              ({Math.round((new Date(job.end_time).getTime() - new Date(job.start_time).getTime()) / 1000)}s)
                            </span>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <Play className="h-3 w-3 text-muted-foreground" />
                        <code className="text-xs font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">{job.schedule}</code>
                      </div>
                      <p className="text-xs text-muted-foreground/70 mt-1.5 font-mono truncate">{job.command}</p>
                      {job.return_message && job.status !== "succeeded" && (
                        <p className="text-xs text-red-500 mt-1 truncate">{job.return_message}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <div>
                        {recent && statusOk ? (
                          <Badge className="bg-green-500/15 text-green-500 border border-green-500/30 gap-1 text-xs">
                            <CheckCircle2 className="h-3.5 w-3.5" />Atual
                          </Badge>
                        ) : job.status === "failed" ? (
                          <Badge className="bg-red-500/15 text-red-500 border border-red-500/30 gap-1 text-xs">
                            <XCircle className="h-3.5 w-3.5" />Falha
                          </Badge>
                        ) : !job.start_time ? (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            <Clock className="h-3.5 w-3.5 mr-1" />Nunca executou
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            <Rows3 className="h-3.5 w-3.5 mr-1" />Desatualizado
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 text-xs"
                          disabled={isRunning}
                          onClick={() => runNowMutation.mutate(job.jobid)}
                          data-testid={`btn-cron-run-${job.jobid}`}
                          title="Executar agora"
                        >
                          {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
                          Executar
                        </Button>
                        {job.active ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
                            disabled={isToggling}
                            onClick={() => toggleMutation.mutate({ jobid: job.jobid, active: false })}
                            data-testid={`btn-cron-inativar-${job.jobid}`}
                          >
                            {isToggling ? <Loader2 className="h-3 w-3 animate-spin" /> : <PauseCircle className="h-3 w-3" />}
                            Inativar
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10"
                            disabled={isToggling}
                            onClick={() => toggleMutation.mutate({ jobid: job.jobid, active: true })}
                            data-testid={`btn-cron-ativar-${job.jobid}`}
                          >
                            {isToggling ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
                            Ativar
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </ScrollArea>
  );
}

export default function BancoDados() {
  const [tab, setTab] = useState("schemas");
  const [selectedDb, setSelectedDb] = useState<string>("");

  const { data: dbConfig } = useQuery<{ host: string; port: number; database: string; username: string; hasConfig: boolean }>({
    queryKey: ["/api/db-config"],
  });

  // Initialize selectedDb from config
  useEffect(() => {
    if (dbConfig?.database && !selectedDb) {
      setSelectedDb(dbConfig.database);
    }
  }, [dbConfig?.database]);

  const activeDb = selectedDb || dbConfig?.database || "";

  const { data: overview, isLoading: isLoadingOverview, error: overviewError, refetch: refetchOverview } = useQuery<ServerOverview>({
    queryKey: ["/api/db-server-overview"],
    enabled: !!dbConfig?.hasConfig,
    retry: false,
  });

  const { data: schemas, isLoading: isLoadingSchemas, error: schemasError, refetch: refetchSchemas } = useQuery<string[]>({
    queryKey: ["/api/db-schemas", activeDb],
    queryFn: async () => {
      const res = await fetch(`/api/db-schemas?database=${encodeURIComponent(activeDb)}`);
      return res.json();
    },
    enabled: !!dbConfig?.hasConfig && !!activeDb,
    retry: false,
  });

  const { data: matviewsAll, isLoading: isLoadingMatviews } = useQuery<{ schema: string; items: SchemaDetail["matviews"] }[]>({
    queryKey: ["/api/db-matviews-all", activeDb],
    queryFn: async () => {
      if (!schemas || schemas.length === 0) return [];
      const results = await Promise.all(
        schemas.map(async (s) => {
          const res = await fetch(`/api/db-schema-detail?database=${encodeURIComponent(activeDb)}&schema=${encodeURIComponent(s)}`);
          const data: SchemaDetail = await res.json();
          return { schema: s, items: data.matviews || [] };
        })
      );
      return results.filter(r => r.items.length > 0);
    },
    enabled: !!schemas && schemas.length > 0 && tab === "matviews",
  });

  const { data: timestampConfig = {} } = useQuery<Record<string, string>>({
    queryKey: ["/api/db-timestamp-config", activeDb],
    queryFn: async () => {
      const res = await fetch(`/api/db-timestamp-config?database=${encodeURIComponent(activeDb)}`);
      return res.json();
    },
    enabled: !!dbConfig?.hasConfig && !!activeDb,
  });

  // Bulk timestamps for matviews sorting
  const [matviewBulkTs, setMatviewBulkTs] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (!matviewsAll || !timestampConfig) return;
    const items: { schema: string; table: string; column: string }[] = [];
    for (const { schema, items: views } of matviewsAll) {
      for (const v of views) {
        const col = timestampConfig[`${schema}.${v.name}`];
        if (col) items.push({ schema, table: v.name, column: col });
      }
    }
    if (items.length === 0) return;
    fetch("/api/db-bulk-lastupdates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ database: activeDb, items }),
    }).then(r => r.json()).then(result => setMatviewBulkTs(result)).catch(() => {});
  }, [matviewsAll, activeDb, timestampConfig]);

  const { data: cronData, isLoading: isLoadingCrons, refetch: refetchCrons } = useQuery<{ hasCron: boolean; jobs: CronJob[] }>({
    queryKey: ["/api/db-crons", activeDb],
    queryFn: async () => {
      const res = await fetch(`/api/db-crons?database=${encodeURIComponent(activeDb)}`);
      return res.json();
    },
    enabled: !!dbConfig?.hasConfig && !!activeDb && tab === "crons",
    retry: false,
  });

  const { data: allTables, isLoading: isLoadingAllTables } = useQuery<TableWithColumns[]>({
    queryKey: ["/api/db-all-tables", activeDb],
    queryFn: async () => {
      const res = await fetch(`/api/db-all-tables?database=${encodeURIComponent(activeDb)}`);
      return res.json();
    },
    enabled: !!dbConfig?.hasConfig && !!activeDb && tab === "config",
    retry: false,
  });

  const saveTsConfig = useMutation({
    mutationFn: ({ key, column }: { key: string; column: string | null }) =>
      apiRequest("POST", "/api/db-timestamp-config", { database: activeDb, key, column }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/db-timestamp-config", activeDb] });
      queryClient.invalidateQueries({ queryKey: ["/api/db-table-lastupdate"] });
    },
  });

  // Custom blocks
  const { data: customBlocks = [] } = useQuery<DbCustomBlock[]>({
    queryKey: ["/api/db-custom-blocks", activeDb],
    queryFn: async () => {
      const res = await fetch(`/api/db-custom-blocks?database=${encodeURIComponent(activeDb)}`);
      return res.json();
    },
    enabled: !!dbConfig?.hasConfig && !!activeDb,
  });

  const saveBlockMutation = useMutation({
    mutationFn: (block: Partial<DbCustomBlock> & { nome: string; tables: string[] }) =>
      apiRequest("POST", "/api/db-custom-blocks", { database: activeDb, ...block }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/db-custom-blocks", activeDb] });
      setBlockFormOpen(false);
      setBlockFormName("");
      setBlockFormTables(new Set());
      setBlockEditingId(null);
    },
  });

  const deleteBlockMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/db-custom-blocks/${id}?database=${encodeURIComponent(activeDb)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/db-custom-blocks", activeDb] }),
  });

  // Custom block form state
  const [blockFormOpen, setBlockFormOpen] = useState(false);
  const [blockFormName, setBlockFormName] = useState("");
  const [blockFormTables, setBlockFormTables] = useState<Set<string>>(new Set());
  const [blockFormSearch, setBlockFormSearch] = useState("");
  const [blockEditingId, setBlockEditingId] = useState<string | null>(null);

  function startEditBlock(block: DbCustomBlock) {
    setBlockEditingId(block.id);
    setBlockFormName(block.nome);
    setBlockFormTables(new Set(block.tables));
    setBlockFormSearch("");
    setBlockFormOpen(true);
    setTab("config");
  }

  function openNewBlockForm() {
    setBlockEditingId(null);
    setBlockFormName("");
    setBlockFormTables(new Set());
    setBlockFormSearch("");
    setBlockFormOpen(true);
  }

  function toggleBlockTable(key: string) {
    setBlockFormTables(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleSelectDb(dbName: string) {
    setSelectedDb(dbName);
    queryClient.removeQueries({ queryKey: ["/api/db-schemas"] });
    queryClient.removeQueries({ queryKey: ["/api/db-schema-detail"] });
    queryClient.removeQueries({ queryKey: ["/api/db-matviews-all"] });
    queryClient.removeQueries({ queryKey: ["/api/db-crons"] });
    queryClient.removeQueries({ queryKey: ["/api/db-table-columns"] });
  }

  function handleRefresh() {
    queryClient.removeQueries({ queryKey: ["/api/db-schemas"] });
    queryClient.removeQueries({ queryKey: ["/api/db-schema-detail"] });
    queryClient.removeQueries({ queryKey: ["/api/db-matviews-all"] });
    queryClient.removeQueries({ queryKey: ["/api/db-crons"] });
    queryClient.removeQueries({ queryKey: ["/api/db-server-overview"] });
    queryClient.removeQueries({ queryKey: ["/api/db-table-columns"] });
    refetchSchemas();
    refetchOverview();
    if (tab === "crons") refetchCrons();
  }

  if (!dbConfig?.hasConfig) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 text-center p-8">
        <ServerCrash className="h-12 w-12 text-muted-foreground/50" />
        <div>
          <h2 className="text-lg font-semibold">Banco de dados não configurado</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Acesse <strong>Configuração → Banco de Dados PostgreSQL</strong> e preencha os dados de conexão.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border/60 shrink-0 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Database className="h-5 w-5 text-primary shrink-0" />
          <div className="shrink-0">
            <h1 className="text-lg font-semibold leading-tight">Banco de Dados</h1>
            <p className="text-xs text-muted-foreground">
              {dbConfig.host}:{dbConfig.port}
            </p>
          </div>
          {/* Database filter pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto ml-1 pb-0.5 scrollbar-hide">
            {isLoadingOverview && !overview && (
              <div className="flex gap-1.5">
                {[1,2,3].map(i => <Skeleton key={i} className="h-6 w-20 rounded-full" />)}
              </div>
            )}
            {overview?.databases.map(d => {
              const isActive = d.name.trim() === activeDb.trim();
              return (
                <button
                  key={d.name}
                  data-testid={`db-filter-${d.name}`}
                  onClick={() => handleSelectDb(d.name.trim())}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all shrink-0 border ${
                    isActive
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-transparent text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                  }`}
                >
                  <Database className="h-3 w-3" />
                  {d.name.trim()}
                  <span className={isActive ? "opacity-80" : "opacity-60"}>({d.size})</span>
                </button>
              );
            })}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} data-testid="button-refresh-db" className="shrink-0">
          <RefreshCw className="h-3.5 w-3.5 mr-2" />
          Atualizar
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 overflow-hidden px-6 pt-4">
        <TabsList className="shrink-0 w-fit">
          <TabsTrigger value="servidor" data-testid="tab-servidor">
            <Server className="h-4 w-4 mr-2" />Servidor
          </TabsTrigger>
          <TabsTrigger value="schemas" data-testid="tab-schemas">
            <Layers className="h-4 w-4 mr-2" />Schemas
            {schemas && <Badge variant="secondary" className="ml-2 text-xs">{schemas.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="matviews" data-testid="tab-matviews">
            <Eye className="h-4 w-4 mr-2" />Views Materializadas
          </TabsTrigger>
          <TabsTrigger value="crons" data-testid="tab-crons">
            <CalendarClock className="h-4 w-4 mr-2" />CRONs
          </TabsTrigger>
          <TabsTrigger value="config" data-testid="tab-config">
            <Settings2 className="h-4 w-4 mr-2" />Config
            {Object.keys(timestampConfig).length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">{Object.keys(timestampConfig).length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Servidor Tab */}
        <TabsContent value="servidor" className="flex-1 overflow-hidden mt-4">
          <ScrollArea className="h-full pr-2">
            {isLoadingOverview && (
              <div className="grid grid-cols-2 gap-4 pb-6">
                {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-lg" />)}
              </div>
            )}
            {overviewError && (
              <div className="flex items-center gap-2 p-4 text-sm text-red-500 bg-red-500/10 rounded-md">
                <XCircle className="h-4 w-4" />Erro: {(overviewError as any).message}
              </div>
            )}
            {overview && (
              <div className="space-y-6 pb-6">
                {/* Stats cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Server className="h-4 w-4 text-blue-500" />
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Versão</span>
                      </div>
                      <p className="font-mono text-sm font-semibold">PostgreSQL {overview.serverVersion}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <HardDrive className="h-4 w-4 text-purple-500" />
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tamanho Total</span>
                      </div>
                      <p className="font-semibold text-sm">{overview.totalSize}</p>
                      <p className="text-xs text-muted-foreground">{overview.databases.length} banco{overview.databases.length !== 1 ? "s" : ""}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Activity className="h-4 w-4 text-green-500" />
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Conexões Ativas</span>
                      </div>
                      <p className="font-semibold text-sm">{overview.connections.active} <span className="text-muted-foreground font-normal">/ {overview.maxConnections} max</span></p>
                      <p className="text-xs text-muted-foreground">{overview.connections.idle} idle · {overview.connections.waiting} waiting</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Users className="h-4 w-4 text-orange-500" />
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Conexões</span>
                      </div>
                      <p className="font-semibold text-sm">{overview.connections.total}</p>
                      <p className="text-xs text-muted-foreground truncate">via {overview.connectedVia}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Databases table */}
                <Card>
                  <CardHeader className="py-3 px-4 border-b">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Database className="h-4 w-4 text-primary" />
                      Todos os Bancos de Dados
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y divide-border/50">
                      {overview.databases.map(db => {
                        const pct = overview.totalSizeBytes > 0 ? (db.sizeBytes / overview.totalSizeBytes) * 100 : 0;
                        const isActive = db.name === dbConfig?.database;
                        return (
                          <div key={db.name} className={`flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors ${isActive ? "bg-primary/5" : ""}`}>
                            <div className="flex items-center gap-2 w-40 shrink-0">
                              <Database className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                              <span className={`font-mono text-sm font-medium truncate ${isActive ? "text-primary" : ""}`}>{db.name}</span>
                              {isActive && <Badge className="text-xs py-0 px-1.5 h-4">ativo</Badge>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between text-xs mb-1">
                                <span className="text-muted-foreground">{db.size}</span>
                                <span className="text-muted-foreground">{pct.toFixed(1)}%</span>
                              </div>
                              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${isActive ? "bg-primary" : "bg-muted-foreground/40"}`}
                                  style={{ width: `${Math.max(pct, 0.5)}%` }}
                                />
                              </div>
                            </div>
                            <div className="flex items-center gap-4 shrink-0 text-xs text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                <span>{db.connections}</span>
                              </div>
                              <div className="hidden sm:block">
                                <span>{db.owner}</span>
                              </div>
                              {db.connLimit !== null && (
                                <Badge variant="outline" className="text-xs py-0">lim: {db.connLimit}</Badge>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* Server info */}
                <Card>
                  <CardHeader className="py-3 px-4 border-b">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Zap className="h-4 w-4 text-yellow-500" />
                      Informações do Servidor
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-2">
                    <div className="grid grid-cols-1 gap-2 text-sm">
                      <div className="flex gap-2">
                        <span className="text-muted-foreground w-36 shrink-0">Versão completa</span>
                        <span className="font-mono text-xs truncate">{overview.version}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-muted-foreground w-36 shrink-0">Diretório de dados</span>
                        <span className="font-mono text-xs truncate">{overview.dataDirectory}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-muted-foreground w-36 shrink-0">Máx. conexões</span>
                        <span className="font-mono text-xs">{overview.maxConnections}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-muted-foreground w-36 shrink-0">Host</span>
                        <span className="font-mono text-xs">{dbConfig?.host}:{dbConfig?.port}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        {/* Schemas Tab */}
        <TabsContent value="schemas" className="flex-1 overflow-hidden mt-4">
          <ScrollArea className="h-full pr-2">
            {schemasError && (
              <div className="flex items-center gap-2 p-4 text-sm text-red-500 bg-red-500/10 rounded-md">
                <XCircle className="h-4 w-4" />
                Erro ao conectar: {(schemasError as any).message}
              </div>
            )}
            {isLoadingSchemas && (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
              </div>
            )}
            {schemas && schemas.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">Nenhum schema encontrado</div>
            )}
            {(customBlocks.length > 0 || schemas) && (
              <div className="space-y-3 pb-6">
                {/* Custom blocks first */}
                {customBlocks.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 px-1">
                      <Bookmark className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs font-semibold text-primary uppercase tracking-wider">Blocos Personalizados</span>
                      <Badge variant="secondary" className="text-xs">{customBlocks.length}</Badge>
                    </div>
                    {customBlocks.map(block => (
                      <CustomBlockAccordion
                        key={block.id}
                        block={block}
                        database={activeDb}
                        timestampConfig={timestampConfig}
                        onEdit={startEditBlock}
                        onDelete={(id) => deleteBlockMutation.mutate(id)}
                      />
                    ))}
                    <div className="border-t border-border/50 pt-3">
                      <div className="flex items-center gap-2 px-1 mb-3">
                        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Todos os Schemas</span>
                      </div>
                    </div>
                  </>
                )}
                {schemas && schemas.map(schema => (
                  <SchemaAccordion key={`${activeDb}-${schema}`} schema={schema} database={activeDb} timestampConfig={timestampConfig} />
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        {/* Matviews Tab */}
        <TabsContent value="matviews" className="flex-1 overflow-hidden mt-4">
          <ScrollArea className="h-full pr-2">
            {isLoadingMatviews && (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
              </div>
            )}
            {matviewsAll && matviewsAll.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">Nenhuma view materializada encontrada</div>
            )}
            {matviewsAll && (
              <div className="space-y-6 pb-6">
                {matviewsAll.map(({ schema, items }) => {
                  const sortedItems = [...items].sort((a, b) => {
                    const tsA = matviewBulkTs[`${schema}.${a.name}`];
                    const tsB = matviewBulkTs[`${schema}.${b.name}`];
                    if (tsA === undefined && tsB === undefined) return 0;
                    if (tsA === undefined) return 1;
                    if (tsB === undefined) return -1;
                    if (tsA === null && tsB === null) return 0;
                    if (tsA === null) return -1;
                    if (tsB === null) return 1;
                    return new Date(tsA).getTime() - new Date(tsB).getTime();
                  });
                  return (
                    <div key={schema}>
                      <div className="flex items-center gap-2 mb-3">
                        <Layers className="h-4 w-4 text-blue-500" />
                        <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{schema}</span>
                        <Badge variant="outline" className="text-xs">{items.length}</Badge>
                        {Object.keys(matviewBulkTs).length > 0 && (
                          <span className="text-xs text-muted-foreground/50 flex items-center gap-1 ml-1">
                            <SortAsc className="h-3 w-3" />menos recente → mais recente
                          </span>
                        )}
                      </div>
                      <div className="space-y-2">
                        {sortedItems.map(v => (
                          <MatviewCard key={v.name} database={activeDb} schema={schema} v={v} timestampConfig={timestampConfig} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        {/* CRONs Tab */}
        <TabsContent value="crons" className="flex-1 overflow-hidden mt-4">
          <CronsTabContent
            cronData={cronData}
            isLoadingCrons={isLoadingCrons}
            activeDb={activeDb}
            refetchCrons={refetchCrons}
          />
        </TabsContent>

        {/* Config Tab */}
        <TabsContent value="config" className="flex-1 overflow-hidden mt-4">
          <ScrollArea className="h-full pr-2">
            <div className="pb-6 space-y-6">

              {/* ── Blocos Personalizados ──────────────────────────────────── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bookmark className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Blocos Personalizados</h3>
                    {customBlocks.length > 0 && <Badge variant="secondary" className="text-xs">{customBlocks.length}</Badge>}
                  </div>
                  <Button
                    size="sm" variant="outline"
                    className="h-8 gap-1.5 text-xs"
                    onClick={openNewBlockForm}
                    data-testid="btn-new-custom-block"
                  >
                    <Plus className="h-3.5 w-3.5" />Novo Bloco
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Crie grupos personalizados de tabelas para visualização rápida na aba Schemas.
                </p>

                {/* Existing blocks list */}
                {customBlocks.length === 0 && !blockFormOpen && (
                  <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                    Nenhum bloco criado ainda. Clique em <strong>Novo Bloco</strong> para começar.
                  </div>
                )}
                {customBlocks.map(block => (
                  <Card key={block.id} className="flex items-center gap-3 px-4 py-3">
                    <Bookmark className="h-4 w-4 text-primary shrink-0" />
                    <span className="flex-1 font-semibold text-sm truncate">{block.nome}</span>
                    <Badge variant="outline" className="text-xs shrink-0">{block.tables.length} tabela{block.tables.length !== 1 ? "s" : ""}</Badge>
                    <Button
                      variant="ghost" size="sm"
                      className="h-7 w-7 p-0 shrink-0"
                      onClick={() => startEditBlock(block)}
                      data-testid={`btn-config-edit-block-${block.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteBlockMutation.mutate(block.id)}
                      disabled={deleteBlockMutation.isPending}
                      data-testid={`btn-config-delete-block-${block.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </Card>
                ))}

                {/* Form */}
                {blockFormOpen && (() => {
                  const search = blockFormSearch.toLowerCase();
                  const filtered = (allTables || []).filter(t =>
                    t.name.toLowerCase().includes(search) || t.schema.toLowerCase().includes(search)
                  );
                  const bySchema = filtered.reduce((acc, t) => {
                    if (!acc[t.schema]) acc[t.schema] = [];
                    acc[t.schema].push(t);
                    return acc;
                  }, {} as Record<string, typeof filtered>);

                  return (
                    <Card className="overflow-hidden border-primary/50">
                      <div className="flex items-center gap-3 px-4 py-3 bg-primary/5 border-b">
                        <Bookmark className="h-4 w-4 text-primary shrink-0" />
                        <span className="text-sm font-semibold flex-1">
                          {blockEditingId ? "Editar Bloco" : "Novo Bloco"}
                        </span>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setBlockFormOpen(false)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="p-4 space-y-4">
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Nome do Bloco</label>
                          <Input
                            placeholder="Ex: Tabelas Operacionais, KPIs..."
                            value={blockFormName}
                            onChange={e => setBlockFormName(e.target.value)}
                            className="h-9"
                            data-testid="input-block-name"
                          />
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              Tabelas ({blockFormTables.size} selecionada{blockFormTables.size !== 1 ? "s" : ""})
                            </label>
                            {blockFormTables.size > 0 && (
                              <button
                                className="text-xs text-muted-foreground hover:text-foreground underline"
                                onClick={() => setBlockFormTables(new Set())}
                              >
                                Limpar seleção
                              </button>
                            )}
                          </div>
                          <div className="relative mb-2">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                            <Input
                              placeholder="Filtrar tabelas..."
                              value={blockFormSearch}
                              onChange={e => setBlockFormSearch(e.target.value)}
                              className="h-8 pl-8 text-xs"
                              data-testid="input-block-table-search"
                            />
                          </div>
                          {isLoadingAllTables && (
                            <div className="space-y-1.5 mt-2">
                              {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-7 w-full" />)}
                            </div>
                          )}
                          <div className="border rounded-md overflow-hidden max-h-72 overflow-y-auto">
                            {Object.keys(bySchema).length === 0 && !isLoadingAllTables && (
                              <div className="p-4 text-center text-xs text-muted-foreground">
                                {blockFormSearch ? "Nenhuma tabela encontrada" : "Nenhuma tabela disponível"}
                              </div>
                            )}
                            {Object.entries(bySchema).map(([schema, tables]) => (
                              <div key={schema}>
                                <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 border-b sticky top-0 z-10">
                                  <Layers className="h-3 w-3 text-blue-500 shrink-0" />
                                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{schema}</span>
                                  <span className="text-[10px] text-muted-foreground/60 ml-auto">
                                    {tables.filter(t => blockFormTables.has(`${t.schema}.${t.name}`)).length}/{tables.length}
                                  </span>
                                </div>
                                {tables.map(t => {
                                  const key = `${t.schema}.${t.name}`;
                                  const checked = blockFormTables.has(key);
                                  const icon = t.kind === "matview"
                                    ? <Eye className="h-3 w-3 text-purple-500 shrink-0" />
                                    : t.kind === "view"
                                    ? <Eye className="h-3 w-3 text-cyan-500 shrink-0" />
                                    : <Table2 className="h-3 w-3 text-muted-foreground shrink-0" />;
                                  return (
                                    <label
                                      key={key}
                                      className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors hover:bg-muted/50 border-b border-border/30 last:border-0 ${checked ? "bg-primary/5" : ""}`}
                                      data-testid={`label-block-table-${key}`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleBlockTable(key)}
                                        className="rounded accent-primary"
                                      />
                                      {icon}
                                      <span className="font-mono text-xs flex-1 truncate">{t.name}</span>
                                      {checked && <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />}
                                    </label>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            onClick={() => saveBlockMutation.mutate({
                              id: blockEditingId || undefined,
                              nome: blockFormName,
                              tables: Array.from(blockFormTables),
                            })}
                            disabled={!blockFormName.trim() || blockFormTables.size === 0 || saveBlockMutation.isPending}
                            data-testid="btn-save-block"
                          >
                            {saveBlockMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                            {blockEditingId ? "Salvar alterações" : "Criar bloco"}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setBlockFormOpen(false)}>
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    </Card>
                  );
                })()}
              </div>

              {/* ── Timestamp Config ──────────────────────────────────────── */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Coluna de Data por Tabela</h3>
                </div>
              <p className="text-xs text-muted-foreground pb-2">
                Selecione a coluna de timestamp de cada tabela para exibir a data da última atualização na aba Schemas.
              </p>
              {isLoadingAllTables && (
                <div className="space-y-2">
                  {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
                </div>
              )}
              {allTables && allTables.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">Nenhuma tabela encontrada</div>
              )}
              {allTables && allTables.length > 0 && (() => {
                const bySchema = allTables.reduce((acc, t) => {
                  if (!acc[t.schema]) acc[t.schema] = [];
                  acc[t.schema].push(t);
                  return acc;
                }, {} as Record<string, TableWithColumns[]>);

                return Object.entries(bySchema).map(([schema, tables]) => (
                  <Card key={schema} className="overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/30 border-b">
                      <Layers className="h-4 w-4 text-blue-500 shrink-0" />
                      <span className="text-xs font-semibold uppercase tracking-widest">{schema}</span>
                      <Badge variant="outline" className="text-xs ml-auto">{tables.length}</Badge>
                    </div>
                    <div className="divide-y divide-border/40">
                      {tables.map(t => {
                        const key = `${t.schema}.${t.name}`;
                        const currentColumn = timestampConfig[key] || "";
                        const kindIcon = t.kind === "matview" ? <Eye className="h-3.5 w-3.5 text-purple-500 shrink-0" /> :
                                         t.kind === "view" ? <Eye className="h-3.5 w-3.5 text-cyan-500 shrink-0" /> :
                                         <Table2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
                        return (
                          <div key={key} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors">
                            {kindIcon}
                            <span className="font-mono text-sm flex-1 truncate">{t.name}</span>
                            {currentColumn && (
                              <span className="text-xs text-emerald-500 font-mono hidden sm:block shrink-0">
                                <Clock className="h-3 w-3 inline mr-1" />{currentColumn}
                              </span>
                            )}
                            {(() => {
                              const DATE_TYPES = ["date","timestamp","timestamp with time zone","timestamp without time zone","time","time with time zone","time without time zone"];
                              const dateCols = t.columns.filter(c => DATE_TYPES.some(dt => c.data_type.startsWith(dt)));
                              const otherCols = t.columns.filter(c => !DATE_TYPES.some(dt => c.data_type.startsWith(dt)));
                              return (
                                <Select
                                  value={currentColumn || "__none__"}
                                  onValueChange={(val) => {
                                    saveTsConfig.mutate({ key, column: val === "__none__" ? null : val });
                                  }}
                                >
                                  <SelectTrigger
                                    className="h-7 w-44 text-xs shrink-0"
                                    data-testid={`select-ts-col-${key}`}
                                  >
                                    <SelectValue placeholder="— sem coluna —" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">— sem coluna —</SelectItem>
                                    {dateCols.length > 0 && (
                                      <SelectGroup>
                                        <SelectLabel className="text-xs text-emerald-500">📅 Datas / Timestamps</SelectLabel>
                                        {dateCols.map(col => (
                                          <SelectItem key={col.column_name} value={col.column_name}>
                                            <span className="font-mono text-emerald-600 dark:text-emerald-400">{col.column_name}</span>
                                            <span className="text-muted-foreground ml-1 text-xs">({col.data_type})</span>
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                    )}
                                    {dateCols.length > 0 && otherCols.length > 0 && <SelectSeparator />}
                                    {otherCols.length > 0 && (
                                      <SelectGroup>
                                        <SelectLabel className="text-xs text-muted-foreground">Outras colunas</SelectLabel>
                                        {otherCols.map(col => (
                                          <SelectItem key={col.column_name} value={col.column_name}>
                                            <span className="font-mono">{col.column_name}</span>
                                            <span className="text-muted-foreground ml-1 text-xs">({col.data_type})</span>
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                    )}
                                  </SelectContent>
                                </Select>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                ));
              })()}
              </div>{/* end timestamp section */}
            </div>{/* end space-y-6 */}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

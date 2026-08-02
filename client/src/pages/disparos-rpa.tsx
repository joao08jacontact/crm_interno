import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Bot, Plus, Trash2, Play, Clock, CheckCircle2, XCircle, Loader2,
  FileText, ChevronDown, ChevronUp, Upload, X, Send, Settings,
  AlertTriangle, Info, Wifi, WifiOff, Download, RefreshCw, BarChart2,
  TrendingUp, Users, MessageSquare, AlertCircle,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import type { RpaDisparo, MetaTemplate, MetaOperacao } from "@shared/schema";

// ── palette (igual ao resto da app) ─────────────────────────────────────────
const P = {
  bg:      "#0A1628",
  surface: "#131B2E",
  elevated:"#1A2540",
  border:  "#1E2D45",
  accent:  "#3B7FF5",
  textPri: "#E8EDF5",
  textSec: "#6B7FA3",
  GREEN:   "#22C55E",
  YELLOW:  "#EAB308",
  RED:     "#EF4444",
  UNKNOWN: "#6B7FA3",
};

// ── helpers ──────────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<RpaDisparo["status"], string> = {
  agendado:     "Agendado",
  em_andamento: "Em andamento",
  concluido:    "Concluído",
  erro:         "Erro",
};

function StatusBadge({ status }: { status: RpaDisparo["status"] }) {
  const colors = {
    agendado:     { bg: P.accent  + "22", color: P.accent  },
    em_andamento: { bg: P.YELLOW  + "22", color: P.YELLOW  },
    concluido:    { bg: P.GREEN   + "22", color: P.GREEN   },
    erro:         { bg: P.RED     + "22", color: P.RED     },
  };
  const icons = {
    agendado:     <Clock       className="h-3 w-3" />,
    em_andamento: <Loader2     className="h-3 w-3 animate-spin" />,
    concluido:    <CheckCircle2 className="h-3 w-3" />,
    erro:         <XCircle     className="h-3 w-3" />,
  };
  const { bg, color } = colors[status];
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: bg, color }}>
      {icons[status]}{STATUS_LABELS[status]}
    </span>
  );
}

function QualityBadge({ q }: { q: "GREEN" | "YELLOW" | "RED" | "UNKNOWN" | null }) {
  if (!q) return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-medium"
      style={{ background: P.UNKNOWN + "22", color: P.UNKNOWN }}>
      <Info className="h-3 w-3" /> Sem dados Meta
    </span>
  );
  const map = {
    GREEN:   { color: P.GREEN,   label: "Alta" },
    YELLOW:  { color: P.YELLOW,  label: "Média" },
    RED:     { color: P.RED,     label: "Baixa ⚠️" },
    UNKNOWN: { color: P.UNKNOWN, label: "Desconhecida" },
  };
  const { color, label } = map[q];
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-medium"
      style={{ background: color + "22", color }}>
      {label}
    </span>
  );
}

function fmtTs(ts?: number) {
  if (!ts) return "—";
  return format(new Date(ts), "dd/MM/yyyy HH:mm:ss", { locale: ptBR });
}

function sliceCsv(content: string, limit: number | null): { conteudo: string; rows: number } {
  const lines = content.split("\n").filter(l => l.trim());
  const header = lines[0] ?? "";
  const data = lines.slice(1);
  const sliced = limit !== null && limit > 0 ? data.slice(0, limit) : data;
  return { conteudo: [header, ...sliced].join("\n"), rows: sliced.length };
}

// ── tipos externos ───────────────────────────────────────────────────────────
interface ExtChannel { id: number; name: string; status: string; channelHubId: string | null }
interface ExtTemplate { id: string; name: string; status: string; category: string; components: any[] }
interface ExtQueue    { id: number; name: string; color: string }

interface Slot { horario: string; limite: string } // limite: "" = sem limite

// ══════════════════════════════════════════════════════════════════════════════
// DIALOG: Novo Disparo RPA
// ══════════════════════════════════════════════════════════════════════════════
function CreateRpaDisparoDialog({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [nome,       setNome]       = useState("");
  const [data,       setData]       = useState(format(new Date(), "yyyy-MM-dd"));
  const [canalId,    setCanalId]    = useState<number | null>(null);
  const [templateId, setTemplateId] = useState<string>("");
  const [filaId,     setFilaId]     = useState<number | null>(null);
  const [operacaoId, setOperacaoId] = useState<string>("");
  const [slots,      setSlots]      = useState<Slot[]>([{ horario: "", limite: "" }]);
  const [arquivo,    setArquivo]    = useState<{ nome: string; conteudo: string; colunas: string[] } | null>(null);
  const [varMapping, setVarMapping] = useState<Record<string, string>>({}); // { "1": "coluna", "2": "coluna" }
  const [creating,   setCreating]   = useState(false);

  // Queries externas (via proxy server → ConnectaCX)
  const { data: channels = [], isLoading: loadCh, error: errCh } = useQuery<ExtChannel[]>({
    queryKey: ["/api/rpa-channels"],
    queryFn: async () => {
      const r = await fetch("/api/rpa-channels");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
    enabled: open,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  const { data: templates = [], isLoading: loadTpl } = useQuery<ExtTemplate[]>({
    queryKey: ["/api/rpa-templates-live", canalId],
    queryFn: async () => {
      const r = await fetch(`/api/rpa-templates-live/${canalId}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
    enabled: !!canalId,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  const { data: queues = [] } = useQuery<ExtQueue[]>({
    queryKey: ["/api/rpa-queues"],
    queryFn: async () => {
      const r = await fetch("/api/rpa-queues");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
    enabled: open,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  const { data: operacoes = [] } = useQuery<MetaOperacao[]>({
    queryKey: ["/api/meta/operacoes"],
    queryFn: () => fetch("/api/meta/operacoes").then(r => r.json()),
    enabled: open,
  });

  const { data: metaTemplates = [] } = useQuery<MetaTemplate[]>({
    queryKey: ["/api/meta/templates"],
    queryFn: () => fetch("/api/meta/templates").then(r => r.json()),
    enabled: open,
  });

  const createMut = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/rpa-disparos", payload).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/rpa-disparos"] }),
  });

  // Derivados
  const selectedChannel  = channels.find(c => c.id === canalId);
  const selectedTemplate = templates.find(t => t.id === templateId);
  const metaMatch = selectedTemplate
    ? metaTemplates.find(mt => mt.name === selectedTemplate.name)
    : null;
  const metaQuality = metaMatch?.qualityScore ?? null;

  // Extrai variáveis {{N}} do corpo do template selecionado
  const templateVars: string[] = (() => {
    if (!selectedTemplate) return [];
    const body = selectedTemplate.components?.find((c: any) => c.type === "BODY");
    if (!body?.text) return [];
    const matches = [...body.text.matchAll(/\{\{(\d+)\}\}/g)];
    const nums = [...new Set(matches.map(m => m[1]))].sort((a, b) => Number(a) - Number(b));
    return nums;
  })();

  // Limpa o mapeamento quando o template muda
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setVarMapping({}); }, [templateId]);

  // CSV
  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const content = e.target?.result as string;
      const bom = content.charCodeAt(0) === 0xFEFF;
      const clean = bom ? content.slice(1) : content;
      const first = clean.split(/\r?\n/)[0] ?? "";
      const sep = first.includes(";") ? ";" : ",";
      const colunas = first.split(sep).map(h => h.trim().replace(/^"|"$/g, ""));
      setArquivo({ nome: file.name, conteudo: clean, colunas });
    };
    reader.readAsText(file, "utf-8");
  };

  // Slots
  const addSlot    = () => setSlots(p => [...p, { horario: "", limite: "" }]);
  const removeSlot = (i: number) => setSlots(p => p.filter((_, j) => j !== i));
  const setSlot    = (i: number, field: keyof Slot, val: string) =>
    setSlots(p => p.map((s, j) => j === i ? { ...s, [field]: val } : s));

  const reset = () => {
    setNome(""); setData(format(new Date(), "yyyy-MM-dd"));
    setCanalId(null); setTemplateId(""); setFilaId(null); setOperacaoId("");
    setSlots([{ horario: "", limite: "" }]);
    setArquivo(null); setVarMapping({});
  };

  const handleSubmit = async () => {
    if (!nome.trim())         { toast({ title: "Informe o nome do disparo",       variant: "destructive" }); return; }
    if (!canalId)             { toast({ title: "Selecione o canal",                variant: "destructive" }); return; }
    if (!templateId)          { toast({ title: "Selecione o template",             variant: "destructive" }); return; }
    const missingVar = templateVars.find(v => !varMapping[v]);
    if (missingVar)           { toast({ title: `Mapeie a coluna para a variável {{${missingVar}}}`, variant: "destructive" }); return; }
    if (!arquivo)             { toast({ title: "Selecione o arquivo CSV",          variant: "destructive" }); return; }
    if (slots.some(s => !s.horario)) { toast({ title: "Preencha o horário de todos os slots", variant: "destructive" }); return; }

    const tpl = templates.find(t => t.id === templateId)!;
    const canal = channels.find(c => c.id === canalId)!;
    const fila  = queues.find(q => q.id === filaId);

    setCreating(true);
    try {
      for (const slot of slots) {
        const limite = slot.limite ? parseInt(slot.limite) : null;
        const { conteudo, rows } = sliceCsv(arquivo.conteudo, limite);
        const label = slots.length > 1 ? ` ${slot.horario}` : "";
        await createMut.mutateAsync({
          nome:               `${nome.trim()}${label}`,
          data,
          horario:            slot.horario,
          canalExternalId:    canal.id,
          canalNome:          canal.name,
          templateExternalId: String(tpl.id),
          templateNome:       tpl.name,
          templateRaw:        JSON.stringify(tpl),
          varMapping:         Object.keys(varMapping).length > 0 ? varMapping : undefined,
          filaExternalId:     fila?.id,
          filaNome:           fila?.name,
          operacaoId:         operacaoId || undefined,
          arquivoNome:        arquivo.nome,
          arquivoConteudo:    conteudo,
          totalRegistros:     rows,
        });
      }
      toast({ title: slots.length === 1 ? "Disparo RPA criado!" : `${slots.length} disparos RPA criados!` });
      onCreated();
      reset();
    } catch {
      toast({ title: "Erro ao criar disparo RPA", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const iStyle = { background: "#0F1A2E", border: `1px solid ${P.border}`, color: P.textPri };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); reset(); } }}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto"
        style={{ background: P.surface, border: `1px solid ${P.border}` }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base" style={{ color: P.textPri }}>
            <Send className="h-5 w-5" style={{ color: P.accent }} />
            Novo Disparo RPA
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">

          {/* Erro de configuração */}
          {errCh && (
            <div className="flex items-center gap-2 px-3 py-2 rounded text-xs"
              style={{ background: P.RED + "18", border: `1px solid ${P.RED}44`, color: P.RED }}>
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Não foi possível conectar ao ConnectaCX. Verifique as credenciais na aba Configuração.
            </div>
          )}

          {/* Nome + Data */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label style={{ color: P.textSec }}>Nome do Disparo *</Label>
              <input value={nome} onChange={e => setNome(e.target.value)}
                placeholder="Ex: Estácio — Captação Janeiro"
                className="w-full rounded px-3 py-2 text-sm outline-none focus:ring-1 ring-blue-500"
                style={iStyle} />
            </div>
            <div className="space-y-1">
              <Label style={{ color: P.textSec }}>Data *</Label>
              <input type="date" value={data} onChange={e => setData(e.target.value)}
                className="w-full rounded px-3 py-2 text-sm outline-none focus:ring-1 ring-blue-500"
                style={iStyle} />
            </div>
          </div>

          <Separator style={{ background: P.border }} />

          {/* Canal */}
          <div className="space-y-1">
            <Label style={{ color: P.textSec }}>Canal *</Label>
            {loadCh ? (
              <p className="text-xs" style={{ color: P.textSec }}>
                <Loader2 className="inline h-3 w-3 animate-spin mr-1" />Carregando canais do ConnectaCX…
              </p>
            ) : channels.length === 0 ? (
              <p className="text-xs" style={{ color: P.textSec }}>Nenhum canal CONNECTED encontrado.</p>
            ) : (
              <Select value={String(canalId ?? "")} onValueChange={v => { setCanalId(Number(v)); setTemplateId(""); }}>
                <SelectTrigger style={{ ...iStyle, minWidth: 0 }}>
                  <SelectValue placeholder="Selecione o canal" />
                </SelectTrigger>
                <SelectContent style={{ background: P.surface, border: `1px solid ${P.border}` }}>
                  {channels.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      <span className="flex items-center gap-2">
                        <Wifi className="h-3 w-3" style={{ color: P.GREEN }} />
                        {c.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Template */}
          {canalId && (
            <div className="space-y-1">
              <Label style={{ color: P.textSec }}>Template *</Label>
              {loadTpl ? (
                <p className="text-xs" style={{ color: P.textSec }}>
                  <Loader2 className="inline h-3 w-3 animate-spin mr-1" />Carregando templates…
                </p>
              ) : templates.length === 0 ? (
                <p className="text-xs" style={{ color: P.textSec }}>Nenhum template APPROVED neste canal.</p>
              ) : (
                <>
                  <Select value={templateId} onValueChange={setTemplateId}>
                    <SelectTrigger style={{ ...iStyle, minWidth: 0 }}>
                      <SelectValue placeholder="Selecione o template" />
                    </SelectTrigger>
                    <SelectContent style={{ background: P.surface, border: `1px solid ${P.border}` }}>
                      {templates.map(t => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Badge de qualidade Gestão Meta */}
                  {selectedTemplate && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px]" style={{ color: P.textSec }}>Qualidade no Gestão Meta:</span>
                      <QualityBadge q={metaQuality as any} />
                      {!metaMatch && (
                        <span className="text-[10px]" style={{ color: P.textSec }}>
                          (template "{selectedTemplate.name}" não encontrado nos templates sincronizados)
                        </span>
                      )}
                    </div>
                  )}
                  {metaQuality === "RED" && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded text-xs mt-1"
                      style={{ background: P.RED + "18", border: `1px solid ${P.RED}44`, color: P.RED }}>
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      Qualidade BAIXA — o disparo será bloqueado no momento da execução.
                    </div>
                  )}

                  {/* Preview do corpo do template */}
                  {selectedTemplate && (() => {
                    const body = selectedTemplate.components?.find(c => c.type === "BODY");
                    return body?.text ? (
                      <div className="mt-2 px-3 py-2 rounded text-xs" style={{ background: P.elevated, border: `1px solid ${P.border}`, color: P.textSec }}>
                        <p className="font-semibold mb-1" style={{ color: P.textSec }}>Corpo do template:</p>
                        <p className="leading-relaxed whitespace-pre-wrap">{body.text}</p>
                      </div>
                    ) : null;
                  })()}

                  {/* Mapeamento de variáveis */}
                  {templateVars.length > 0 && (
                    <div className="mt-3 px-3 py-3 rounded space-y-2"
                      style={{ background: P.elevated, border: `1px solid ${P.accent}44` }}>
                      <p className="text-xs font-semibold" style={{ color: P.accent }}>
                        Mapeamento de variáveis do template
                      </p>
                      <p className="text-[11px]" style={{ color: P.textSec }}>
                        Selecione qual coluna do CSV corresponde a cada variável.
                        {arquivo ? "" : " (carregue o CSV primeiro para ver as colunas)"}
                      </p>
                      <div className="space-y-2 mt-1">
                        {templateVars.map(v => (
                          <div key={v} className="flex items-center gap-3">
                            <span className="text-xs font-mono px-2 py-0.5 rounded shrink-0"
                              style={{ background: P.accent + "22", color: P.accent, minWidth: 40, textAlign: "center" }}>
                              {`{{${v}}}`}
                            </span>
                            <Select
                              value={varMapping[v] ?? "__none__"}
                              onValueChange={col => setVarMapping(prev => ({ ...prev, [v]: col === "__none__" ? "" : col }))}
                            >
                              <SelectTrigger className="h-8 text-xs flex-1"
                                style={{ background: "#0F1A2E", border: `1px solid ${P.border}`, color: varMapping[v] ? P.textPri : P.textSec }}>
                                <SelectValue placeholder="Selecione a coluna…" />
                              </SelectTrigger>
                              <SelectContent style={{ background: P.surface, border: `1px solid ${P.border}` }}>
                                <SelectItem value="__none__"><span style={{ color: P.textSec }}>— Selecione a coluna —</span></SelectItem>
                                {arquivo && arquivo.colunas.length > 0
                                  ? arquivo.colunas.map(col => (
                                      <SelectItem key={col} value={col}>{col}</SelectItem>
                                    ))
                                  : (
                                    <SelectItem value="__nocolumns__" disabled>
                                      <span style={{ color: P.textSec }}>Carregue o CSV primeiro</span>
                                    </SelectItem>
                                  )
                                }
                              </SelectContent>
                            </Select>
                            {varMapping[v] ? (
                              <span className="text-[10px]" style={{ color: P.GREEN }}>✓</span>
                            ) : (
                              <span className="text-[10px]" style={{ color: P.RED }}>●</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Fila + Operação */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label style={{ color: P.textSec }}>Fila <span style={{ color: P.textSec, fontSize: 10 }}>(opcional)</span></Label>
              <Select value={String(filaId ?? "__none__")} onValueChange={v => setFilaId(v === "__none__" ? null : Number(v))}>
                <SelectTrigger style={{ ...iStyle, minWidth: 0 }}>
                  <SelectValue placeholder="Sem fila" />
                </SelectTrigger>
                <SelectContent style={{ background: P.surface, border: `1px solid ${P.border}` }}>
                  <SelectItem value="__none__">Sem fila</SelectItem>
                  {queues.map(q => (
                    <SelectItem key={q.id} value={String(q.id)}>{q.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label style={{ color: P.textSec }}>Operação <span style={{ color: P.textSec, fontSize: 10 }}>(opcional)</span></Label>
              <Select value={operacaoId || "__none__"} onValueChange={v => setOperacaoId(v === "__none__" ? "" : v)}>
                <SelectTrigger style={{ ...iStyle, minWidth: 0 }}>
                  <SelectValue placeholder="Sem operação" />
                </SelectTrigger>
                <SelectContent style={{ background: P.surface, border: `1px solid ${P.border}` }}>
                  <SelectItem value="__none__">Sem operação</SelectItem>
                  {operacoes.map(op => (
                    <SelectItem key={op.id} value={op.id}>{op.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator style={{ background: P.border }} />

          {/* CSV */}
          <div className="space-y-2">
            <Label style={{ color: P.textSec }}>Base de Contatos (CSV) *</Label>
            {arquivo ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-3 py-2 rounded"
                  style={{ background: P.elevated, border: `1px solid ${P.border}` }}>
                  <div className="flex items-center gap-2 text-xs">
                    <FileText className="h-4 w-4" style={{ color: P.GREEN }} />
                    <span className="font-medium" style={{ color: P.textPri }}>{arquivo.nome}</span>
                  </div>
                  <button onClick={() => setArquivo(null)} style={{ color: P.textSec }}
                    className="hover:opacity-70 p-1"><X className="h-4 w-4" /></button>
                </div>
                {arquivo.colunas.length > 0 && (
                  <div className="px-3 py-2 rounded text-xs" style={{ background: P.elevated, border: `1px solid ${P.border}` }}>
                    <p className="mb-1.5" style={{ color: P.textSec }}>Colunas detectadas:</p>
                    <div className="flex flex-wrap gap-1">
                      {arquivo.colunas.map((col, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-full text-[10px]"
                          style={{ background: P.accent + "22", color: P.accent }}>
                          {col}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors hover:opacity-80"
                style={{ borderColor: P.border }}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) readFile(f); }}
                onDragOver={e => e.preventDefault()}
                onClick={() => fileRef.current?.click()}>
                <Upload className="h-6 w-6 mx-auto mb-2" style={{ color: P.textSec }} />
                <p className="text-sm" style={{ color: P.textSec }}>Arraste o CSV aqui ou clique para selecionar</p>
                <p className="text-xs mt-1" style={{ color: P.textSec }}>
                  Suporte a separador <code style={{ background: P.elevated, padding: "1px 4px", borderRadius: 3 }}>;</code> e <code style={{ background: P.elevated, padding: "1px 4px", borderRadius: 3 }}>,</code>
                </p>
                <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); }} />
              </div>
            )}
          </div>

          <Separator style={{ background: P.border }} />

          {/* Horários de Disparo */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" style={{ color: P.accent }} />
                <span className="text-sm font-semibold" style={{ color: P.textPri }}>
                  Horários de Disparo
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full font-mono"
                  style={{ background: P.accent + "22", color: P.accent }}>{slots.length}</span>
              </div>
              <button onClick={addSlot}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded hover:opacity-80 transition-opacity"
                style={{ background: P.accent + "22", color: P.accent, border: `1px solid ${P.accent}44` }}>
                <Plus className="h-3.5 w-3.5" /> Adicionar Horário
              </button>
            </div>
            <p className="text-[11px]" style={{ color: P.textSec }}>
              Defina o horário e o limite máximo de registros para cada disparo.
            </p>
            <div className="space-y-2">
              {slots.map((slot, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded"
                  style={{ background: P.elevated, border: `1px solid ${P.border}` }}>
                  {/* Número do slot */}
                  <span className="text-xs font-mono font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: P.accent, color: "#fff" }}>{i + 1}</span>

                  <div className="flex items-center gap-2 flex-1 flex-wrap">
                    <div className="flex items-center gap-2">
                      <label className="text-xs shrink-0" style={{ color: P.textSec }}>Horário</label>
                      <input type="time" value={slot.horario}
                        onChange={e => setSlot(i, "horario", e.target.value)}
                        className="rounded px-2 py-1 text-sm font-mono outline-none focus:ring-1 ring-blue-500"
                        style={{ ...iStyle, width: 110 }} />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs shrink-0" style={{ color: P.textSec }}>Máx. registros</label>
                      <input type="number" min={1} value={slot.limite}
                        onChange={e => setSlot(i, "limite", e.target.value)}
                        placeholder="Sem limite"
                        className="rounded px-2 py-1 text-sm font-mono outline-none focus:ring-1 ring-blue-500"
                        style={{ ...iStyle, width: 120 }} />
                    </div>
                  </div>

                  {slots.length > 1 && (
                    <button onClick={() => removeSlot(i)} className="hover:opacity-70 shrink-0"
                      style={{ color: P.RED }}>
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { onClose(); reset(); }}
            style={{ borderColor: P.border, color: P.textSec, background: "transparent" }}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={creating}
            style={{ background: P.accent, color: "#fff" }}>
            {creating
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : <Send className="h-4 w-4 mr-2" />}
            Criar Disparo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Funil de campanha ConnectaCX ─────────────────────────────────────────────
const FUNIL_ROWS = [
  { keys: ["contactsTotal","totalRecipients","total"],                     label: "Total",       color: "#7C3AED" },
  { keys: ["contactsWaiting","waiting","queue"],                           label: "Na fila",     color: "#EAB308" },
  { keys: ["contactsSent","sent"],                                         label: "Enviado",     color: "#3B7FF5" },
  { keys: ["contactsDelivered","delivered"],                               label: "Entregue",    color: "#38BDF8" },
  { keys: ["contactsRead","read"],                                         label: "Lido",        color: "#06B6D4" },
  { keys: ["contactsAnswered","answered"],                                  label: "Respondido",  color: "#A78BFA" },
  { keys: ["contactsChatOpened","chatOpened","chat_opened"],               label: "Já em chat",  color: "#F97316" },
  { keys: ["contactsWrappedUp","wrappedUp","wrapped_up"],                  label: "Concluído",   color: "#22C55E" },
  { keys: ["contactsFailed","contactsSentFailed","failed"],                label: "Falha",       color: "#EF4444" },
];

const STATUS_PT: Record<string, string> = {
  waiting: "Na fila", sent: "Enviado", failed: "Falha",
  sent_failed: "Falha no envio", delivered: "Entregue",
  invalid_number: "Número inválido", read: "Lido",
  answered: "Respondido", chat_opened: "Já em chat", wrapped_up: "Concluído",
};

function pick(obj: any, keys: string[]): number {
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj[k] !== null) return Number(obj[k]) || 0;
  }
  return 0;
}

function CampanhaPanel({ campanhaId }: { campanhaId: number }) {
  const [page, setPage] = useState(1);
  const { toast } = useToast();

  const { data: funil, isLoading: loadFunil, refetch: refetchFunil, isFetching: fetchingFunil } = useQuery<any>({
    queryKey: [`/api/rpa-campanha/${campanhaId}/status`],
    queryFn: () => fetch(`/api/rpa-campanha/${campanhaId}/status`).then(r => r.json()),
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const { data: contatosResp, isLoading: loadContatos, refetch: refetchContatos } = useQuery<any>({
    queryKey: [`/api/rpa-campanha/${campanhaId}/contatos`, page],
    queryFn: () => fetch(`/api/rpa-campanha/${campanhaId}/contatos?page=${page}`).then(r => r.json()),
    staleTime: 30000,
  });

  const handleExport = () => window.open(`/api/rpa-campanha/${campanhaId}/exportar`, "_blank");

  const total     = pick(funil, FUNIL_ROWS[0].keys);
  const contatos: any[] = contatosResp?.data ?? contatosResp?.contacts ?? contatosResp?.recipients ?? (Array.isArray(contatosResp) ? contatosResp : []);
  const totalPages: number = contatosResp?.totalPages ?? contatosResp?.total_pages ?? contatosResp?.lastPage ?? 1;

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 className="h-3.5 w-3.5" style={{ color: P.accent }} />
          <span className="text-xs font-semibold" style={{ color: P.textPri }}>Funil de conversão</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
            style={{ background: P.accent + "22", color: P.accent }}>#{campanhaId}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => { refetchFunil(); refetchContatos(); }}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded hover:opacity-80"
            style={{ background: P.elevated, color: P.textSec, border: `1px solid ${P.border}` }}>
            <RefreshCw className={`h-2.5 w-2.5 ${fetchingFunil ? "animate-spin" : ""}`} /> Atualizar
          </button>
          <button onClick={handleExport}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded hover:opacity-80"
            style={{ background: P.GREEN + "18", color: P.GREEN, border: `1px solid ${P.GREEN}44` }}>
            <Download className="h-2.5 w-2.5" /> Exportar CSV
          </button>
        </div>
      </div>

      {/* Funil — barras horizontais compactas */}
      {loadFunil ? (
        <div className="flex items-center gap-2 text-xs py-2 justify-center" style={{ color: P.textSec }}>
          <Loader2 className="h-3 w-3 animate-spin" /> Carregando…
        </div>
      ) : funil?.error ? (
        <p className="text-xs px-2 py-1.5 rounded" style={{ color: P.RED, background: P.RED + "12" }}>
          Erro: {funil.error}
        </p>
      ) : (
        <div className="rounded overflow-hidden" style={{ border: `1px solid ${P.border}` }}>
          {FUNIL_ROWS.map((row, ri) => {
            const val = pick(funil, row.keys);
            const pct = total > 0 ? (val / total) * 100 : 0;
            const isTotal = ri === 0;
            return (
              <div key={row.label}
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 1fr 72px",
                  alignItems: "center",
                  gap: 10,
                  padding: "5px 12px",
                  borderBottom: ri < FUNIL_ROWS.length - 1 ? `1px solid ${P.border}` : undefined,
                  background: isTotal ? row.color + "10" : undefined,
                }}>
                {/* Label — coluna fixa, nunca sobreposta */}
                <span className="text-[11px] font-medium truncate"
                  style={{ color: isTotal ? row.color : P.textSec }}>{row.label}</span>
                {/* Barra — ocupa o espaço livre */}
                <div className="h-3 rounded overflow-hidden" style={{ background: P.elevated }}>
                  <div className="h-full rounded transition-all duration-500"
                    style={{
                      width: `${Math.max(pct, pct > 0 ? 2 : 0)}%`,
                      background: row.color, opacity: val > 0 ? 1 : 0.12,
                    }} />
                </div>
                {/* Valor — coluna fixa à direita */}
                <div className="text-right">
                  <span className="text-xs font-bold" style={{ color: val > 0 ? row.color : P.textSec }}>{val}</span>
                  <span className="text-[10px] ml-1" style={{ color: P.textSec }}>({Math.round(pct)}%)</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tabela de contatos */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: P.textSec }}>
          Contatos
        </p>
        {loadContatos ? (
          <div className="flex items-center gap-2 text-xs py-2 justify-center" style={{ color: P.textSec }}>
            <Loader2 className="h-3 w-3 animate-spin" /> Carregando…
          </div>
        ) : (
          <>
            <div className="rounded overflow-hidden" style={{ border: `1px solid ${P.border}` }}>
              <table className="w-full">
                <thead>
                  <tr style={{ background: P.elevated, borderBottom: `1px solid ${P.border}` }}>
                    <th className="text-left px-3 py-1.5 text-[10px] font-medium" style={{ color: P.textSec }}>Nome / Número</th>
                    <th className="text-left px-3 py-1.5 text-[10px] font-medium" style={{ color: P.textSec }}>Status</th>
                    <th className="text-left px-3 py-1.5 text-[10px] font-medium" style={{ color: P.textSec }}>Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {contatos.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-3 text-center text-xs" style={{ color: P.textSec }}>
                        Nenhum contato ainda
                      </td>
                    </tr>
                  ) : (
                    contatos.map((c: any, i: number) => {
                      const stRaw: string = c.status ?? "";
                      const stLabel = STATUS_PT[stRaw] ?? stRaw;
                      const stColor = ["failed","sent_failed","invalid_number"].includes(stRaw) ? P.RED
                        : ["delivered","read","answered","wrapped_up"].includes(stRaw) ? P.GREEN
                        : stRaw === "chat_opened" ? "#F97316"
                        : stRaw === "waiting" ? P.YELLOW : P.accent;
                      const name   = c.contact?.name   ?? c.name   ?? "—";
                      const number = c.contact?.number ?? c.number ?? c.phone ?? "";
                      const obs    = c.statusNote ?? c.observation ?? c.error ?? "—";
                      return (
                        <tr key={i} style={{ borderTop: i > 0 ? `1px solid ${P.border}` : undefined }}>
                          <td className="px-3 py-1.5">
                            <span className="text-xs font-medium" style={{ color: P.textPri }}>{name}</span>
                            {number && <span className="text-[10px] font-mono ml-1.5" style={{ color: P.textSec }}>{number}</span>}
                          </td>
                          <td className="px-3 py-1.5">
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
                              style={{ background: stColor + "20", color: stColor }}>
                              {stLabel || "—"}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 max-w-xs">
                            <span className="text-[10px]" style={{ color: P.textSec }}>{obs}</span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-1.5">
                <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                  className="text-[10px] px-2 py-1 rounded disabled:opacity-30"
                  style={{ background: P.elevated, color: P.textSec, border: `1px solid ${P.border}` }}>
                  ← Ant.
                </button>
                <span className="text-[10px] font-mono" style={{ color: P.textSec }}>{page}/{totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                  className="text-[10px] px-2 py-1 rounded disabled:opacity-30"
                  style={{ background: P.elevated, color: P.textSec, border: `1px solid ${P.border}` }}>
                  Próx. →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CARD SLIM (clicável → abre modal)
// ══════════════════════════════════════════════════════════════════════════════
function DisparoCardSlim({ disparo, onClick, selected }: {
  disparo: RpaDisparo; onClick: () => void; selected: boolean;
}) {
  const barColor = disparo.status === "concluido" ? P.GREEN
    : disparo.status === "erro" ? P.RED
    : disparo.status === "em_andamento" ? P.YELLOW : P.accent;

  return (
    <button onClick={onClick} className="w-full text-left transition-all hover:opacity-90"
      style={{
        background: selected ? P.elevated : P.surface,
        border: `1px solid ${selected ? P.accent + "88" : P.border}`,
        borderRadius: 8,
        overflow: "hidden",
        display: "block",
      }}>
      <div style={{ height: 3, background: barColor }} />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="font-semibold text-sm truncate" style={{ color: P.textPri }}>{disparo.nome}</span>
          <StatusBadge status={disparo.status} />
          {disparo.campanhaId && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{ background: P.accent + "18", color: P.accent }}>
              #{disparo.campanhaId}
            </span>
          )}
        </div>
        <p className="text-xs truncate" style={{ color: P.textSec }}>
          {disparo.horario}
          {disparo.canalNome    && <> · {disparo.canalNome}</>}
          {disparo.templateNome && <> · {disparo.templateNome}</>}
          {disparo.totalRegistros > 0 && <> · {disparo.totalRegistros.toLocaleString("pt-BR")} reg.</>}
        </p>
      </div>
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL DE DETALHE DO DISPARO
// ══════════════════════════════════════════════════════════════════════════════
function DisparoDetalheModal({ disparo, onClose, onDelete, onExecute }: {
  disparo: RpaDisparo; onClose: () => void; onDelete: () => void; onExecute: () => void;
}) {
  const [vinculando,    setVinculando]    = useState(false);
  const [inputCampanha, setInputCampanha] = useState("");
  const { toast } = useToast();

  const vincularCampanha = async () => {
    const num = parseInt(inputCampanha.trim());
    if (!num) return;
    try {
      const r = await fetch(`/api/rpa-disparos/${disparo.id}/campanha`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campanhaId: num }),
      });
      if (!r.ok) throw new Error("Falha");
      toast({ title: `Campanha #${num} vinculada!` });
      queryClient.invalidateQueries({ queryKey: ["/api/rpa-disparos"] });
      setVinculando(false); setInputCampanha("");
    } catch {
      toast({ title: "Erro ao vincular campanha", variant: "destructive" });
    }
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent
        className="p-0 gap-0 [&>button:last-child]:hidden"
        style={{
          background: P.surface,
          border: `1px solid ${P.border}`,
          maxWidth: "min(960px, 92vw)",
          width: "min(960px, 92vw)",
          maxHeight: "88vh",
          overflowY: "auto",
          borderRadius: 12,
        }}>
        {/* Título para acessibilidade */}
        <DialogTitle className="sr-only">{disparo.nome}</DialogTitle>

        {/* Header sticky */}
        <div className="px-5 py-3.5 flex items-center gap-3 sticky top-0 z-20"
          style={{ borderBottom: `1px solid ${P.border}`, background: P.elevated }}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span className="font-bold text-sm" style={{ color: P.textPri }}>{disparo.nome}</span>
              <StatusBadge status={disparo.status} />
              {disparo.campanhaId && (
                <span className="text-[11px] font-mono px-2 py-0.5 rounded"
                  style={{ background: P.accent + "22", color: P.accent, border: `1px solid ${P.accent}44` }}>
                  Campanha #{disparo.campanhaId}
                </span>
              )}
            </div>
            <p className="text-[11px]" style={{ color: P.textSec }}>
              {disparo.data?.split("-").reverse().join("/")} às {disparo.horario}
              {disparo.canalNome && <> · {disparo.canalNome}</>}
              {disparo.templateNome && <> · {disparo.templateNome}</>}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {(disparo.status === "agendado" || disparo.status === "erro") && (
              <button onClick={() => { onExecute(); onClose(); }}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded hover:opacity-80"
                style={{ background: P.accent, color: "#fff" }}>
                <Play className="h-3 w-3" /> Executar
              </button>
            )}
            {disparo.status !== "em_andamento" && (
              <button onClick={() => { onDelete(); onClose(); }}
                className="p-1.5 rounded hover:opacity-70" style={{ color: P.RED }}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            <button onClick={onClose}
              className="p-1.5 rounded hover:opacity-70"
              style={{ color: P.textSec }}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Corpo */}
        <div className="px-5 py-3 space-y-3">

          {/* Metadados — linha única compacta */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px]">
            {[
              { label: "Canal",     value: disparo.canalNome    },
              { label: "Template",  value: disparo.templateNome },
              { label: "Fila",      value: disparo.filaNome     },
              { label: "Arquivo",   value: disparo.arquivoNome  },
              { label: "Registros", value: disparo.totalRegistros > 0 ? String(disparo.totalRegistros) : undefined },
              { label: "Criado",    value: fmtTs(disparo.criadoEm) },
              { label: "Iniciado",  value: disparo.iniciadoEm  ? fmtTs(disparo.iniciadoEm)  : undefined },
              { label: "Concluído", value: disparo.concluidoEm ? fmtTs(disparo.concluidoEm) : undefined },
            ].filter(r => r.value).map(r => (
              <span key={r.label} style={{ color: P.textSec }}>
                {r.label}: <strong style={{ color: P.textPri, fontWeight: 500 }}>{r.value}</strong>
              </span>
            ))}
          </div>

          {/* Log de execução — altura fixa com scroll interno */}
          {disparo.logs && disparo.logs.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide font-semibold mb-1" style={{ color: P.textSec }}>
                Log
              </p>
              <div className="rounded p-2 space-y-0.5 overflow-y-auto overflow-x-hidden"
                style={{ background: "#060D1A", border: `1px solid ${P.border}`, maxHeight: 88 }}>
                {disparo.logs.map((line, i) => (
                  <p key={i} className="text-[10px] font-mono leading-snug break-all"
                    style={{
                      color: line.includes("❌") || line.includes("ERRO") ? P.RED
                        : line.includes("✅") || line.includes("🆔") ? P.GREEN
                        : P.textSec,
                    }}>
                    {line}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Funil ConnectaCX */}
          <Separator style={{ background: P.border }} />
          {disparo.campanhaId ? (
            <CampanhaPanel campanhaId={disparo.campanhaId} />
          ) : disparo.status === "concluido" ? (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg"
              style={{ background: P.elevated, border: `1px solid ${P.border}` }}>
              <BarChart2 className="h-4 w-4 shrink-0" style={{ color: P.textSec }} />
              {vinculando ? (
                <>
                  <input value={inputCampanha} onChange={e => setInputCampanha(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && vincularCampanha()}
                    placeholder="ID numérico da campanha ConnectaCX"
                    className="flex-1 rounded px-3 py-1.5 text-sm font-mono outline-none focus:ring-1 ring-blue-500"
                    style={{ background: "#0A1020", border: `1px solid ${P.border}`, color: P.textPri }}
                    autoFocus />
                  <button onClick={vincularCampanha}
                    className="text-sm px-3 py-1.5 rounded hover:opacity-80"
                    style={{ background: P.accent, color: "#fff" }}>
                    Vincular
                  </button>
                  <button onClick={() => setVinculando(false)}
                    className="text-sm px-2 py-1.5 rounded hover:opacity-70"
                    style={{ color: P.textSec }}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span className="text-sm flex-1" style={{ color: P.textSec }}>Nenhuma campanha ConnectaCX vinculada</span>
                  <button onClick={() => setVinculando(true)}
                    className="text-sm px-3 py-1.5 rounded hover:opacity-80"
                    style={{ background: P.accent + "22", color: P.accent, border: `1px solid ${P.accent}44` }}>
                    + Vincular campanha
                  </button>
                </>
              )}
            </div>
          ) : null}

          {/* padding bottom extra para scroll confortável */}
          <div className="h-4" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD PAINEL DIREITO
// ══════════════════════════════════════════════════════════════════════════════
function DashboardPanel({ disparos }: { disparos: RpaDisparo[] }) {
  const total      = disparos.length;
  const concluidos = disparos.filter(d => d.status === "concluido").length;
  const erros      = disparos.filter(d => d.status === "erro").length;
  const andamento  = disparos.filter(d => d.status === "em_andamento").length;
  const agendados  = disparos.filter(d => d.status === "agendado").length;
  const totalReg   = disparos.reduce((s, d) => s + (d.totalRegistros ?? 0), 0);
  const taxaSucesso = total > 0 ? Math.round((concluidos / total) * 100) : 0;

  const chartData = [
    { name: "Agendado",    value: agendados,  color: P.accent  },
    { name: "Em andamento",value: andamento,  color: P.YELLOW  },
    { name: "Concluído",   value: concluidos, color: P.GREEN   },
    { name: "Erro",        value: erros,      color: P.RED     },
  ].filter(d => d.value > 0);

  const kpis = [
    { label: "Total de disparos",    value: total,       icon: <Bot       className="h-4 w-4" />, color: P.accent  },
    { label: "Concluídos",           value: concluidos,  icon: <CheckCircle2 className="h-4 w-4" />, color: P.GREEN },
    { label: "Com erro",             value: erros,       icon: <AlertCircle className="h-4 w-4" />,  color: P.RED   },
    { label: "Registros no total",   value: totalReg.toLocaleString("pt-BR"), icon: <Users className="h-4 w-4" />, color: P.YELLOW },
  ];

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3">
        {kpis.map(k => (
          <div key={k.label} className="px-4 py-4 rounded-lg"
            style={{ background: P.surface, border: `1px solid ${P.border}` }}>
            <div className="flex items-center gap-2 mb-2" style={{ color: k.color }}>
              {k.icon}
              <span className="text-xs font-medium" style={{ color: P.textSec }}>{k.label}</span>
            </div>
            <p className="text-2xl font-bold" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Taxa de sucesso */}
      {total > 0 && (
        <div className="px-4 py-4 rounded-lg" style={{ background: P.surface, border: `1px solid ${P.border}` }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold" style={{ color: P.textSec }}>Taxa de conclusão</span>
            <span className="text-sm font-bold" style={{ color: taxaSucesso >= 80 ? P.GREEN : taxaSucesso >= 50 ? P.YELLOW : P.RED }}>
              {taxaSucesso}%
            </span>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden" style={{ background: P.elevated }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${taxaSucesso}%`,
                background: taxaSucesso >= 80 ? P.GREEN : taxaSucesso >= 50 ? P.YELLOW : P.RED,
              }} />
          </div>
        </div>
      )}

      {/* Gráfico por status */}
      {chartData.length > 0 && (
        <div className="px-4 py-4 rounded-lg" style={{ background: P.surface, border: `1px solid ${P.border}` }}>
          <p className="text-xs font-semibold mb-4" style={{ color: P.textSec }}>Disparos por status</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fill: P.textSec, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: P.textSec, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: P.elevated, border: `1px solid ${P.border}`, borderRadius: 8 }}
                labelStyle={{ color: P.textPri, fontSize: 12 }}
                itemStyle={{ color: P.textSec, fontSize: 12 }}
                cursor={{ fill: P.elevated + "88" }}
              />
              <Bar dataKey="value" name="Disparos" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Lista de disparos com falha */}
      {erros > 0 && (
        <div className="rounded-lg overflow-hidden" style={{ background: P.surface, border: `1px solid ${P.RED}33` }}>
          <div className="px-4 py-3 flex items-center gap-2"
            style={{ background: P.RED + "12", borderBottom: `1px solid ${P.border}` }}>
            <AlertCircle className="h-3.5 w-3.5" style={{ color: P.RED }} />
            <span className="text-xs font-semibold" style={{ color: P.RED }}>Disparos com erro</span>
          </div>
          <div className="divide-y" style={{ borderColor: P.border }}>
            {disparos.filter(d => d.status === "erro").map(d => (
              <div key={d.id} className="px-4 py-2.5">
                <p className="text-xs font-medium" style={{ color: P.textPri }}>{d.nome}</p>
                <p className="text-[11px]" style={{ color: P.textSec }}>
                  {d.horario} · {d.totalRegistros > 0 ? `${d.totalRegistros} reg.` : "sem registros"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty */}
      {total === 0 && (
        <div className="text-center py-12 space-y-2">
          <TrendingUp className="h-8 w-8 mx-auto" style={{ color: P.border }} />
          <p className="text-sm" style={{ color: P.textSec }}>Nenhum disparo nesta data.</p>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ABA CONFIGURAÇÃO
// ══════════════════════════════════════════════════════════════════════════════
function ConfiguracaoTab() {
  const { toast } = useToast();
  const { data: cfg } = useQuery<{ url: string; email: string; senha: string }>({
    queryKey: ["/api/rpa-config"],
    queryFn: () => apiRequest("GET", "/api/rpa-config").then(r => r.json()),
  });

  const [url,       setUrl]       = useState("");
  const [email,     setEmail]     = useState("");
  const [senha,     setSenha]     = useState("");
  const [show,      setShow]      = useState(false);
  const [populated, setPopulated] = useState(false);

  // Pré-popula inputs com valores salvos (apenas uma vez)
  useEffect(() => {
    if (cfg && !populated) {
      if (cfg.url)   setUrl(cfg.url);
      if (cfg.email) setEmail(cfg.email);
      setPopulated(true);
    }
  }, [cfg, populated]);

  const saveMut = useMutation({
    mutationFn: () => {
      // Nunca sobrescreve com string vazia — omite campo se o usuário não digitou nada
      const payload: Record<string, string> = {};
      if (url.trim())   payload.url   = url.trim();
      if (email.trim()) payload.email = email.trim();
      if (senha)        payload.senha = senha;          // só envia se o user digitou
      return apiRequest("POST", "/api/rpa-config", payload).then(r => r.json());
    },
    onSuccess: () => {
      toast({ title: "Configuração salva!" });
      queryClient.invalidateQueries({ queryKey: ["/api/rpa-config"] });
      setSenha(""); // limpa senha após salvar
    },
    onError: () => toast({ title: "Erro ao salvar", variant: "destructive" }),
  });

  const iStyle = { background: "#0F1A2E", border: `1px solid ${P.border}`, color: P.textPri };
  const lStyle = { color: P.textSec };

  return (
    <div className="max-w-lg space-y-4 p-4">
      <div style={{ background: P.elevated, border: `1px solid ${P.border}`, borderRadius: 10, padding: 20 }}>
        <h3 className="font-semibold mb-1 flex items-center gap-2" style={{ color: P.textPri }}>
          <Settings className="h-4 w-4" style={{ color: P.accent }} /> ConnectaCX
        </h3>
        <p className="text-xs mb-4" style={{ color: P.textSec }}>
          Credenciais para autenticação na plataforma ConnectaCX (Estácio).
        </p>

        {cfg && (
          <div className="flex items-center gap-2 mb-4 text-xs">
            {cfg.url && cfg.email && cfg.senha
              ? <><Wifi className="h-3.5 w-3.5" style={{ color: P.GREEN }} /><span style={{ color: P.GREEN }}>Configurado — {cfg.email}</span></>
              : <><WifiOff className="h-3.5 w-3.5" style={{ color: P.RED }} /><span style={{ color: P.RED }}>Não configurado</span></>
            }
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1">
            <Label style={lStyle}>URL base da API *</Label>
            <input value={url} onChange={e => setUrl(e.target.value)}
              placeholder={cfg?.url || "https://connectadesk-jacc.api.connectacx.com"}
              className="w-full rounded px-3 py-2 text-sm font-mono outline-none focus:ring-1 ring-blue-500"
              style={iStyle} />
          </div>
          <div className="space-y-1">
            <Label style={lStyle}>E-mail *</Label>
            <input value={email} onChange={e => setEmail(e.target.value)}
              placeholder={cfg?.email || "usuario@estacio.br"}
              type="email"
              className="w-full rounded px-3 py-2 text-sm outline-none focus:ring-1 ring-blue-500"
              style={iStyle} />
          </div>
          <div className="space-y-1">
            <Label style={lStyle}>Senha *</Label>
            <div className="flex gap-2">
              <input value={senha} onChange={e => setSenha(e.target.value)}
                placeholder={cfg?.senha || "••••••••"}
                type={show ? "text" : "password"}
                className="flex-1 rounded px-3 py-2 text-sm outline-none focus:ring-1 ring-blue-500"
                style={iStyle} />
              <button onClick={() => setShow(p => !p)} className="px-2 rounded hover:opacity-70"
                style={{ background: P.elevated, border: `1px solid ${P.border}`, color: P.textSec }}>
                {show ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </div>
        </div>

        <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
          className="mt-4 w-full flex items-center justify-center gap-2 py-2 rounded text-sm font-medium hover:opacity-90"
          style={{ background: P.accent, color: "#fff" }}>
          {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Salvar configuração
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PÁGINA PRINCIPAL — layout duas colunas, tela toda
// ══════════════════════════════════════════════════════════════════════════════
export default function DisparosRpaPage() {
  const { toast } = useToast();
  const [showCreate,   setShowCreate]   = useState(false);
  const [selectedId,   setSelectedId]   = useState<string | null>(null);
  const [dataFiltro,   setDataFiltro]   = useState(format(new Date(), "yyyy-MM-dd"));
  const [activeTab,    setActiveTab]    = useState<"disparos" | "config">("disparos");

  const { data: disparos = [], isLoading } = useQuery<RpaDisparo[]>({
    queryKey: ["/api/rpa-disparos", dataFiltro],
    queryFn: () => fetch(`/api/rpa-disparos?data=${dataFiltro}`).then(r => r.json()),
    refetchInterval: 10000,
  });

  const selectedDisparo = disparos.find(d => d.id === selectedId) ?? null;

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/rpa-disparos/${id}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rpa-disparos"] });
      setSelectedId(null);
    },
  });

  const executeMut = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/rpa-disparos/${id}/executar`).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Execução iniciada!" });
      queryClient.invalidateQueries({ queryKey: ["/api/rpa-disparos"] });
    },
    onError: () => toast({ title: "Erro ao executar", variant: "destructive" }),
  });

  return (
    <div className="flex flex-col min-h-screen" style={{ background: P.bg }}>

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-6 py-3 shrink-0"
        style={{ background: P.surface, borderBottom: `1px solid ${P.border}` }}>
        <Bot className="h-5 w-5" style={{ color: P.accent }} />
        <div>
          <h1 className="text-base font-bold leading-none" style={{ color: P.textPri }}>Disparos RPA</h1>
          <p className="text-[11px]" style={{ color: P.textSec }}>Campanhas ConnectaCX via REST API</p>
        </div>
        <div className="flex items-center gap-1 ml-2">
          {(["disparos", "config"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="text-xs px-3 py-1.5 rounded transition-all"
              style={{
                background: activeTab === tab ? P.accent : "transparent",
                color: activeTab === tab ? "#fff" : P.textSec,
              }}>
              {tab === "disparos" ? "Disparos" : "Configuração"}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {activeTab === "disparos" && (
          <>
            <input type="date" value={dataFiltro} onChange={e => setDataFiltro(e.target.value)}
              className="rounded px-3 py-1.5 text-sm outline-none focus:ring-1 ring-blue-500"
              style={{ background: P.elevated, border: `1px solid ${P.border}`, color: P.textPri }} />
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded hover:opacity-90"
              style={{ background: P.accent, color: "#fff" }}>
              <Plus className="h-4 w-4" /> Novo Disparo
            </button>
          </>
        )}
      </div>

      {/* ── Conteúdo ──────────────────────────────────────────────────────── */}
      {activeTab === "config" ? (
        <div className="flex-1 overflow-y-auto p-6">
          <ConfiguracaoTab />
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">

          {/* Coluna esquerda: lista de disparos */}
          <div className="w-80 shrink-0 flex flex-col border-r overflow-y-auto"
            style={{ borderColor: P.border, background: P.surface }}>
            <div className="px-3 py-3 shrink-0 sticky top-0 z-10"
              style={{ background: P.surface, borderBottom: `1px solid ${P.border}` }}>
              <p className="text-[11px] font-semibold" style={{ color: P.textSec }}>
                {disparos.length} disparo{disparos.length !== 1 ? "s" : ""} — {dataFiltro.split("-").reverse().join("/")}
              </p>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin" style={{ color: P.textSec }} />
              </div>
            ) : disparos.length === 0 ? (
              <div className="text-center py-16 px-6 space-y-2">
                <Bot className="h-8 w-8 mx-auto" style={{ color: P.border }} />
                <p className="text-xs" style={{ color: P.textSec }}>Nenhum disparo nesta data.<br />Clique em <strong>Novo Disparo</strong> para agendar.</p>
              </div>
            ) : (
              <div className="p-3 space-y-2">
                {disparos.map(d => (
                  <DisparoCardSlim key={d.id} disparo={d}
                    selected={d.id === selectedId}
                    onClick={() => setSelectedId(d.id === selectedId ? null : d.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Coluna direita: dashboard gerencial */}
          <div className="flex-1 overflow-y-auto p-6">
            <DashboardPanel disparos={disparos} />
          </div>
        </div>
      )}

      {/* Modal de detalhe */}
      {selectedDisparo && (
        <DisparoDetalheModal
          disparo={selectedDisparo}
          onClose={() => setSelectedId(null)}
          onDelete={() => deleteMut.mutate(selectedDisparo.id)}
          onExecute={() => executeMut.mutate(selectedDisparo.id)}
        />
      )}

      {showCreate && (
        <CreateRpaDisparoDialog
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ["/api/rpa-disparos"] });
          }}
        />
      )}
    </div>
  );
}

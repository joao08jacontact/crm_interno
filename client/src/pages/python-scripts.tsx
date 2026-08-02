import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Play, Plus, Trash2, Edit2, Clock, CheckCircle2, XCircle,
  Loader2, Terminal, Settings, Wifi, WifiOff, Eye, EyeOff,
  RefreshCw, Tag, FolderOpen, Calendar, AlertCircle, LayoutDashboard,
  ListOrdered, ChevronDown, ChevronRight, Circle,
} from "lucide-react";
import type { PythonScript, PythonExecution, PythonQueueItem, InsertPythonScript } from "@shared/schema";

// ─────────────────────────────────────────────────────────────
// Types & constants
// ─────────────────────────────────────────────────────────────
type AgentConfig = { agentUrl: string; agentKey: string; hasConfig: boolean };
type FilaResponse = { vmBusy: boolean; fila: PythonQueueItem[]; total: number };

const FREQ_OPTIONS = [
  { value: "nenhum", label: "Sem agendamento" },
  { value: "uma_vez", label: "Uma vez" },
  { value: "diario", label: "Diário" },
  { value: "semanal", label: "Semanal" },
  { value: "mensal", label: "Mensalmente" },
];

const DIAS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const DELAY_OPTIONS = [
  { label: "30 minutos", value: 30 },
  { label: "1 hora", value: 60 },
  { label: "2 horas", value: 120 },
  { label: "4 horas", value: 240 },
];
const REPEAT_OPTIONS = [
  { label: "5 minutos", value: 5 },
  { label: "10 minutos", value: 10 },
  { label: "30 minutos", value: 30 },
  { label: "1 hora", value: 60 },
];
const PERIOD_OPTIONS = [
  { label: "30 minutos", value: 30 },
  { label: "1 hora", value: 60 },
  { label: "4 horas", value: 240 },
  { label: "1 dia", value: 1440 },
  { label: "Indeterminado", value: 0 },
];
const TIMEOUT_OPTIONS = [
  { label: "30 minutos", value: 30 },
  { label: "1 hora", value: 60 },
  { label: "3 horas", value: 180 },
  { label: "1 dia", value: 1440 },
  { label: "3 dias", value: 4320 },
];

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}
function nowIsoTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fmtDate(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function fmtDuration(start: number, end?: number): string {
  const ms = (end ?? Date.now()) - start;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

// ─────────────────────────────────────────────────────────────
// Script Form Dialog — Windows Task Scheduler style
// ─────────────────────────────────────────────────────────────
interface ScriptFormProps { open: boolean; onClose: () => void; initial?: PythonScript; }

function ScriptFormDialog({ open, onClose, initial }: ScriptFormProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Basic fields
  const [nome, setNome] = useState(initial?.nome ?? "");
  const [descricao, setDescricao] = useState(initial?.descricao ?? "");
  const [caminhoVm, setCaminhoVm] = useState(initial?.caminhoVm ?? "");
  const [argumentos, setArgumentos] = useState(initial?.argumentos ?? "");
  const [tagsRaw, setTagsRaw] = useState((initial?.tags ?? []).join(", "));
  const [ativo, setAtivo] = useState(initial?.ativo ?? true);
  const [gerenciadoPorAutoTarefa, setGerenciadoPorAutoTarefa] = useState(initial?.gerenciadoPorAutoTarefa ?? false);

  // Scheduling
  const ag = initial?.agendamento;
  const [tipoFreq, setTipoFreq] = useState(ag?.tipo ?? "nenhum");
  const [horario, setHorario] = useState(ag?.horario ?? nowIsoTime());
  const [dataInicio, setDataInicio] = useState(ag?.dataHoraUnica?.slice(0, 10) ?? todayIsoDate());
  const [diasSemana, setDiasSemana] = useState<number[]>(ag?.diasSemana ?? []);
  const [diaMes, setDiaMes] = useState(ag?.diaMes ?? 1);
  const [habilitado, setHabilitado] = useState(ag?.habilitado ?? true);

  // Advanced
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [useAtraso, setUseAtraso] = useState(!!ag?.atrasoAleatorio);
  const [atraso, setAtraso] = useState(ag?.atrasoAleatorio ?? 60);
  const [useRepetir, setUseRepetir] = useState(!!ag?.repetirCada);
  const [repetirValor, setRepetirValor] = useState(ag?.repetirCada?.valor ?? 60);
  const [repetirUnidade, setRepetirUnidade] = useState<"minutos" | "horas">(ag?.repetirCada?.unidade ?? "minutos");
  const [periodoRepetir, setPeriodoRepetir] = useState(ag?.repetirCada?.periodoMinutos ?? 0);
  const [useInterromper, setUseInterromper] = useState(!!ag?.interromperApos);
  const [interromperApos, setInterromperApos] = useState(ag?.interromperApos ?? 180);
  const [useExpira, setUseExpira] = useState(!!ag?.expiraEm);
  const [expiraData, setExpiraData] = useState(ag?.expiraEm?.slice(0, 10) ?? "");
  const [expiraHora, setExpiraHora] = useState(ag?.expiraEm?.slice(11, 16) ?? "");
  const [useJanela, setUseJanela] = useState(!!ag?.janelaHorario);
  const [janelaInicio, setJanelaInicio] = useState(ag?.janelaHorario?.inicio ?? "08:00");
  const [janelaFim, setJanelaFim] = useState(ag?.janelaHorario?.fim ?? "21:00");
  type JanelaExcecao = { dias: number[]; inicio: string; fim: string };
  const [janelaExcecoes, setJanelaExcecoes] = useState<JanelaExcecao[]>(ag?.janelaHorario?.excecoes ?? []);

  const mutation = useMutation({
    mutationFn: async () => {
      const agendamento = tipoFreq !== "nenhum" ? {
        tipo: tipoFreq as any,
        horario: tipoFreq !== "uma_vez" ? horario : undefined,
        diasSemana: (tipoFreq === "semanal" || tipoFreq === "diario") ? diasSemana : undefined,
        diaMes: tipoFreq === "mensal" ? diaMes : undefined,
        dataHoraUnica: tipoFreq === "uma_vez" ? `${dataInicio}T${horario}` : undefined,
        repetirCada: useRepetir ? { valor: repetirValor, unidade: repetirUnidade, periodoMinutos: periodoRepetir } : undefined,
        janelaHorario: useJanela ? { inicio: janelaInicio, fim: janelaFim, excecoes: janelaExcecoes.length > 0 ? janelaExcecoes : undefined } : undefined,
        atrasoAleatorio: useAtraso ? atraso : undefined,
        interromperApos: useInterromper ? interromperApos : undefined,
        expiraEm: useExpira && expiraData ? `${expiraData}T${expiraHora || "23:59"}` : undefined,
        habilitado,
      } : undefined;
      const payload: Partial<InsertPythonScript> = {
        nome, descricao, caminhoVm, argumentos,
        tags: tagsRaw.split(",").map(t => t.trim()).filter(Boolean),
        ativo, gerenciadoPorAutoTarefa, agendamento: agendamento as any,
      };
      if (initial) return apiRequest("PUT", `/api/python-scripts/${initial.id}`, payload).then(r => r.json());
      return apiRequest("POST", "/api/python-scripts", payload).then(r => r.json());
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["/api/python-scripts"] });
      if (d.avisoConflito) {
        toast({ title: "⚠️ Horário ajustado automaticamente", description: d.avisoConflito });
      } else {
        toast({ title: initial ? "Script atualizado!" : "Script criado!" });
      }
      onClose();
    },
    onError: (e: any) => toast({ title: `Erro: ${e.message}`, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border/50">
          <DialogTitle>{initial ? "Editar Script" : "Novo Script Python"}</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-4 space-y-4">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <Label>Nome <span className="text-red-500">*</span></Label>
              <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Snapshot Banco" data-testid="input-script-nome" />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Caminho na VM <span className="text-red-500">*</span></Label>
              <Input value={caminhoVm} onChange={e => setCaminhoVm(e.target.value)} placeholder='H:\Scripts\meu_script.exe' className="font-mono text-sm" data-testid="input-script-caminho" />
            </div>
            <div className="space-y-1">
              <Label>Argumentos <span className="text-xs text-muted-foreground">(opcional)</span></Label>
              <Input value={argumentos} onChange={e => setArgumentos(e.target.value)} placeholder="--modo producao" className="font-mono text-sm" />
            </div>
            <div className="space-y-1">
              <Label>Tags <span className="text-xs text-muted-foreground">(vírgula)</span></Label>
              <Input value={tagsRaw} onChange={e => setTagsRaw(e.target.value)} placeholder="relatorio, diario" />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Descrição</Label>
              <Textarea value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="O que esse script faz..." rows={2} />
            </div>
          </div>

          {/* Windows Task Scheduler style scheduling */}
          <div className="border border-border/60 rounded-lg overflow-hidden">
            <div className="bg-muted/30 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/40">
              Configurações de Agendamento
            </div>
            <div className="p-4 space-y-4">
              {/* Frequency radio buttons */}
              <div className="flex items-start gap-6">
                <div className="space-y-2 min-w-[130px]">
                  {FREQ_OPTIONS.map(opt => (
                    <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="radio"
                        name="freq"
                        value={opt.value}
                        checked={tipoFreq === opt.value}
                        onChange={() => setTipoFreq(opt.value)}
                        className="accent-primary"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>

                {tipoFreq !== "nenhum" && (
                  <div className="flex-1 space-y-3">
                    {/* Date + time row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {tipoFreq === "uma_vez" && (
                        <>
                          <Label className="text-sm w-14">Iniciar:</Label>
                          <Input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} className="w-36 text-sm" />
                          <Input type="time" value={horario} onChange={e => setHorario(e.target.value)} className="w-28 text-sm" />
                        </>
                      )}
                      {(tipoFreq === "diario" || tipoFreq === "semanal" || tipoFreq === "mensal") && (
                        <>
                          <Label className="text-sm w-14">Horário:</Label>
                          <Input type="time" value={horario} onChange={e => setHorario(e.target.value)} className="w-28 text-sm" />
                        </>
                      )}
                    </div>

                    {/* Day-of-week for semanal / diario */}
                    {(tipoFreq === "semanal" || tipoFreq === "diario") && (
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Dias da semana</Label>
                        <div className="flex gap-1 flex-wrap">
                          {DIAS_PT.map((d, i) => {
                            const sel = diasSemana.includes(i);
                            return (
                              <button key={i} type="button"
                                onClick={() => setDiasSemana(sel ? diasSemana.filter(x => x !== i) : [...diasSemana, i])}
                                className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${sel ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>
                                {d}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Day of month for mensal */}
                    {tipoFreq === "mensal" && (
                      <div className="flex items-center gap-2">
                        <Label className="text-sm">Dia do mês:</Label>
                        <Input type="number" min={1} max={31} value={diaMes} onChange={e => setDiaMes(Number(e.target.value))} className="w-20 text-sm" />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Advanced settings — collapsible */}
              {tipoFreq !== "nenhum" && (
                <div className="border-t border-border/40 pt-3">
                  <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={() => setShowAdvanced(v => !v)}>
                    {showAdvanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    Configurações avançadas
                  </button>

                  {showAdvanced && (
                    <div className="mt-3 space-y-2.5 text-sm">
                      {/* Atraso aleatório */}
                      <div className="flex items-center gap-3">
                        <Checkbox checked={useAtraso} onCheckedChange={v => setUseAtraso(!!v)} id="cb-atraso" />
                        <label htmlFor="cb-atraso" className="text-sm cursor-pointer">Atrasar tarefa em até (atraso aleatório):</label>
                        <select value={atraso} onChange={e => setAtraso(Number(e.target.value))} disabled={!useAtraso}
                          className="border border-border rounded px-2 py-1 text-xs bg-background disabled:opacity-40">
                          {DELAY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>

                      {/* Repetir */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <Checkbox checked={useRepetir} onCheckedChange={v => setUseRepetir(!!v)} id="cb-repetir" />
                        <label htmlFor="cb-repetir" className="cursor-pointer">Repetir a tarefa a cada:</label>
                        <select value={repetirValor} onChange={e => setRepetirValor(Number(e.target.value))} disabled={!useRepetir}
                          className="border border-border rounded px-2 py-1 text-xs bg-background disabled:opacity-40">
                          {REPEAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <span className="text-muted-foreground">por um período de:</span>
                        <select value={periodoRepetir} onChange={e => setPeriodoRepetir(Number(e.target.value))} disabled={!useRepetir}
                          className="border border-border rounded px-2 py-1 text-xs bg-background disabled:opacity-40">
                          {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>

                      {/* Interromper após */}
                      <div className="flex items-center gap-3">
                        <Checkbox checked={useInterromper} onCheckedChange={v => setUseInterromper(!!v)} id="cb-interromper" />
                        <label htmlFor="cb-interromper" className="cursor-pointer">Interromper tarefa executada por mais de:</label>
                        <select value={interromperApos} onChange={e => setInterromperApos(Number(e.target.value))} disabled={!useInterromper}
                          className="border border-border rounded px-2 py-1 text-xs bg-background disabled:opacity-40">
                          {TIMEOUT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>

                      {/* Janela de horário */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-3 flex-wrap">
                          <Checkbox checked={useJanela} onCheckedChange={v => setUseJanela(!!v)} id="cb-janela" />
                          <label htmlFor="cb-janela" className="cursor-pointer">Janela de horário:</label>
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground text-xs">De</span>
                            <Input type="time" value={janelaInicio} onChange={e => setJanelaInicio(e.target.value)} disabled={!useJanela} className="w-24 text-xs h-7 disabled:opacity-40" data-testid="input-janela-inicio" />
                            <span className="text-muted-foreground text-xs">Até</span>
                            <Input type="time" value={janelaFim} onChange={e => setJanelaFim(e.target.value)} disabled={!useJanela} className="w-24 text-xs h-7 disabled:opacity-40" data-testid="input-janela-fim" />
                          </div>
                        </div>
                        {useJanela && (
                          <div className="ml-6 space-y-1.5">
                            {janelaExcecoes.map((exc, i) => (
                              <div key={i} className="flex items-center gap-2 flex-wrap">
                                <div className="flex gap-0.5">
                                  {([{d:0,l:"Dom"},{d:1,l:"Seg"},{d:2,l:"Ter"},{d:3,l:"Qua"},{d:4,l:"Qui"},{d:5,l:"Sex"},{d:6,l:"Sáb"}] as {d:number,l:string}[]).map(({d,l}) => (
                                    <button key={d} type="button" onClick={() => {
                                      const copy = [...janelaExcecoes];
                                      const dias = copy[i].dias.includes(d) ? copy[i].dias.filter(x => x !== d) : [...copy[i].dias, d];
                                      copy[i] = { ...copy[i], dias };
                                      setJanelaExcecoes(copy);
                                    }} className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${exc.dias.includes(d) ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-foreground"}`}>
                                      {l}
                                    </button>
                                  ))}
                                </div>
                                <span className="text-muted-foreground text-xs">De</span>
                                <Input type="time" value={exc.inicio} onChange={e => { const n=[...janelaExcecoes]; n[i]={...n[i],inicio:e.target.value}; setJanelaExcecoes(n); }} className="w-24 text-xs h-7" />
                                <span className="text-muted-foreground text-xs">Até</span>
                                <Input type="time" value={exc.fim} onChange={e => { const n=[...janelaExcecoes]; n[i]={...n[i],fim:e.target.value}; setJanelaExcecoes(n); }} className="w-24 text-xs h-7" />
                                <button type="button" onClick={() => setJanelaExcecoes(janelaExcecoes.filter((_,j)=>j!==i))} className="text-muted-foreground hover:text-destructive transition-colors">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ))}
                            <button type="button" onClick={() => setJanelaExcecoes([...janelaExcecoes, {dias:[], inicio:"09:00", fim:"15:00"}])} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                              <Plus className="h-3 w-3" /> Exceção por dia
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Expira em */}
                      <div className="flex items-center gap-3 flex-wrap">
                        <Checkbox checked={useExpira} onCheckedChange={v => setUseExpira(!!v)} id="cb-expira" />
                        <label htmlFor="cb-expira" className="cursor-pointer">Expira em:</label>
                        <Input type="date" value={expiraData} onChange={e => setExpiraData(e.target.value)} disabled={!useExpira} className="w-36 text-xs h-7 disabled:opacity-40" />
                        <Input type="time" value={expiraHora} onChange={e => setExpiraHora(e.target.value)} disabled={!useExpira} className="w-24 text-xs h-7 disabled:opacity-40" />
                      </div>

                      {/* Habilitado */}
                      <div className="flex items-center gap-2 pt-1 border-t border-border/30">
                        <Checkbox checked={habilitado} onCheckedChange={v => setHabilitado(!!v)} id="cb-habilitado" className="data-[state=checked]:bg-primary" />
                        <label htmlFor="cb-habilitado" className="font-medium cursor-pointer">Habilitado</label>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Ativo toggle */}
          <div className="flex items-center gap-3">
            <Switch checked={ativo} onCheckedChange={setAtivo} id="script-ativo" data-testid="switch-script-ativo" />
            <Label htmlFor="script-ativo">Script ativo</Label>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={gerenciadoPorAutoTarefa} onCheckedChange={setGerenciadoPorAutoTarefa} id="script-auto-tarefa" data-testid="switch-gerenciado-auto-tarefa" />
            <div>
              <Label htmlFor="script-auto-tarefa" className="cursor-pointer">Gerenciado por Auto-Tarefa</Label>
              <p className="text-xs text-muted-foreground">Quando ativo, o agendamento próprio deste script é ignorado</p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 pb-5 pt-2 border-t border-border/40">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !nome || !caminhoVm} data-testid="button-save-script">
            {mutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Log Viewer Modal
// ─────────────────────────────────────────────────────────────
function LogViewerModal({ execId, onClose }: { execId: string; onClose: () => void }) {
  const logRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const { data: exec } = useQuery<PythonExecution>({
    queryKey: ["/api/python-execucoes", execId],
    queryFn: () => fetch(`/api/python-execucoes/${execId}`).then(r => r.json()),
    refetchInterval: (q) => ["executando", "aguardando"].includes(q.state.data?.status ?? "") ? 2000 : false,
  });

  useEffect(() => {
    if (autoScroll && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [exec?.logs, autoScroll]);

  const statusBadge = {
    aguardando: <Badge className="bg-blue-500/15 text-blue-400 border border-blue-500/30 animate-pulse"><ListOrdered className="h-3 w-3 mr-1" />Na fila</Badge>,
    executando: <Badge className="bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 animate-pulse"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Executando</Badge>,
    concluido: <Badge className="bg-green-500/15 text-green-400 border border-green-500/30"><CheckCircle2 className="h-3 w-3 mr-1" />Concluído</Badge>,
    erro: <Badge className="bg-red-500/15 text-red-400 border border-red-500/30"><XCircle className="h-3 w-3 mr-1" />Erro</Badge>,
    timeout: <Badge className="bg-orange-500/15 text-orange-400 border border-orange-500/30"><AlertCircle className="h-3 w-3 mr-1" />Timeout</Badge>,
  }[exec?.status ?? "aguardando"];

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Terminal className="h-5 w-5" />
            <DialogTitle className="flex-1">{exec?.scriptNome ?? "Logs"}</DialogTitle>
            {statusBadge}
          </div>
          {exec && (
            <p className="text-xs text-muted-foreground">
              Início: {fmtDate(exec.iniciadoEm)} • Duração: {fmtDuration(exec.iniciadoEm, exec.concluidoEm)} • Origem: {exec.origem}
            </p>
          )}
        </DialogHeader>
        <div className="flex items-center gap-2 px-1">
          <Switch checked={autoScroll} onCheckedChange={setAutoScroll} id="autoscroll" />
          <Label htmlFor="autoscroll" className="text-xs text-muted-foreground">Auto-scroll</Label>
          <span className="ml-auto text-xs text-muted-foreground">{exec?.logs?.length ?? 0} linhas</span>
        </div>
        <div ref={logRef} className="flex-1 overflow-y-auto bg-black/40 rounded-lg border border-border/50 p-3 font-mono text-xs space-y-0.5" data-testid="log-viewer">
          {(exec?.logs ?? []).map((line, i) => (
            <div key={i} className={`leading-5 whitespace-pre-wrap break-all ${
              line.includes("ERRO") || line.includes("Error") || line.includes("error") ? "text-red-400"
              : line.includes("[OK]") || line.includes("Sucesso") ? "text-green-400"
              : line.includes("[FIM]") ? "text-cyan-400"
              : line.startsWith("[") ? "text-muted-foreground"
              : "text-foreground"
            }`}>
              {line || " "}
            </div>
          ))}
          {["executando", "aguardando"].includes(exec?.status ?? "") && (
            <div className="text-yellow-400 animate-pulse">▌</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Dashboard Tab — matrix grid (scripts × hours)
// ─────────────────────────────────────────────────────────────
function DashboardTab({ scripts, executions }: { scripts: PythonScript[]; executions: PythonExecution[] }) {
  const HOURS = Array.from({ length: 24 }, (_, i) => i);

  // today's executions only
  const todayStart = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const todayExecs = executions.filter(e => e.iniciadoEm >= todayStart);

  // map: scriptId → hour → best status
  const statusPriority: Record<string, number> = { executando: 5, aguardando: 4, erro: 3, timeout: 2, concluido: 1 };
  const dashMap: Record<string, Record<number, PythonExecution["status"]>> = {};
  for (const exec of todayExecs) {
    const hour = new Date(exec.iniciadoEm).getHours();
    if (!dashMap[exec.scriptId]) dashMap[exec.scriptId] = {};
    const existing = dashMap[exec.scriptId][hour];
    if (!existing || (statusPriority[exec.status] ?? 0) > (statusPriority[existing] ?? 0)) {
      dashMap[exec.scriptId][hour] = exec.status;
    }
  }

  // scheduled hour per script
  const scheduledMap: Record<string, number> = {};
  for (const s of scripts) {
    if (s.agendamento?.tipo !== "nenhum" && s.agendamento?.horario && s.agendamento?.habilitado !== false) {
      scheduledMap[s.id] = parseInt(s.agendamento.horario.split(":")[0]);
    }
  }

  const nowHour = new Date().getHours();
  const displayScripts = scripts.slice(0, 20);

  function dotColor(status?: PythonExecution["status"], isScheduled?: boolean): string {
    if (status === "concluido") return "bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]";
    if (status === "erro" || status === "timeout") return "bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.6)]";
    if (status === "executando") return "bg-yellow-400 animate-pulse shadow-[0_0_4px_rgba(250,204,21,0.8)]";
    if (status === "aguardando") return "bg-blue-400 animate-pulse";
    if (isScheduled) return "bg-muted-foreground/30 border border-muted-foreground/20";
    return "";
  }

  function dotLabel(status?: PythonExecution["status"], isScheduled?: boolean, hour?: number): string {
    const t = `${String(hour).padStart(2, "0")}:00`;
    if (status === "concluido") return `${t} — Concluído ✓`;
    if (status === "erro") return `${t} — Erro ✗`;
    if (status === "timeout") return `${t} — Timeout`;
    if (status === "executando") return `${t} — Executando agora...`;
    if (status === "aguardando") return `${t} — Aguardando na fila`;
    if (isScheduled) return `${t} — Agendado`;
    return "";
  }

  if (displayScripts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
        <LayoutDashboard className="h-10 w-10 opacity-30" />
        <p className="text-sm">Nenhum script cadastrado ainda.</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-3">
        {/* Legend */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />Concluído</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />Erro</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" />Executando</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-400 inline-block" />Na fila</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/30 border border-muted-foreground/20 inline-block" />Agendado (pendente)</div>
        </div>

        {/* Matrix table */}
        <div className="overflow-x-auto rounded-lg border border-border/50">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-muted/30 border-b border-border/50">
                <th className="sticky left-0 z-10 bg-muted/30 text-left px-3 py-2 font-medium text-muted-foreground min-w-[160px] max-w-[200px]">Script</th>
                {HOURS.map(h => (
                  <th key={h} className={`px-2 py-2 font-medium text-center min-w-[34px] ${h === nowHour ? "text-primary" : "text-muted-foreground"}`}>
                    {String(h).padStart(2, "0")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {displayScripts.map((script, ri) => {
                const rowStatus = dashMap[script.id] ?? {};
                const schedHour = scheduledMap[script.id];
                return (
                  <tr key={script.id} className={`hover:bg-muted/20 transition-colors ${ri % 2 === 0 ? "" : "bg-muted/5"}`} data-testid={`dash-row-${script.id}`}>
                    <td className="sticky left-0 z-10 bg-card px-3 py-2 font-medium truncate max-w-[200px]" style={{ backgroundColor: ri % 2 === 0 ? "" : "" }}>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${script.ultimoStatus === "sucesso" || script.ultimoStatus === "executando" ? "bg-green-400" : script.ultimoStatus === "erro" ? "bg-red-400" : script.ultimoStatus === "aguardando" ? "bg-blue-400" : "bg-muted-foreground/40"}`} />
                        <span className="truncate">{script.nome}</span>
                      </div>
                    </td>
                    {HOURS.map(h => {
                      const status = rowStatus[h];
                      const isScheduled = schedHour === h && h >= nowHour && !status;
                      const dot = dotColor(status, isScheduled);
                      return (
                        <td key={h} className={`px-2 py-2 text-center ${h === nowHour ? "bg-primary/5" : ""}`}>
                          {dot ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className={`inline-block w-2.5 h-2.5 rounded-full cursor-default ${dot}`} data-testid={`dot-${script.id}-${h}`} />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">
                                {dotLabel(status, isScheduled, h)}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="inline-block w-2.5 h-2.5 rounded-full bg-muted/20" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground">Exibindo {displayScripts.length} scripts • Dados de hoje — atualiza a cada 10s</p>
      </div>
    </TooltipProvider>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────
export default function PythonScripts() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [editScript, setEditScript] = useState<PythonScript | undefined>();
  const [viewExecId, setViewExecId] = useState<string | undefined>();
  const [showKey, setShowKey] = useState(false);
  const [agentUrlInput, setAgentUrlInput] = useState("");
  const [agentKeyInput, setAgentKeyInput] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  const { data: scripts = [] } = useQuery<PythonScript[]>({
    queryKey: ["/api/python-scripts"],
    refetchInterval: (q) => {
      const list = q.state.data ?? [];
      return list.some(s => s.ultimoStatus === "executando" || s.ultimoStatus === "aguardando") ? 3000 : 8000;
    },
  });
  const { data: executions = [] } = useQuery<PythonExecution[]>({
    queryKey: ["/api/python-execucoes"],
    refetchInterval: (q) => {
      const list = q.state.data ?? [];
      return list.some(e => e.status === "executando" || e.status === "aguardando") ? 2000 : 8000;
    },
  });
  const { data: agentConfig } = useQuery<AgentConfig>({ queryKey: ["/api/python-config"] });
  const { data: filaData } = useQuery<FilaResponse>({ queryKey: ["/api/python-fila"], refetchInterval: 3000 });

  useEffect(() => {
    if (agentConfig?.agentUrl && !agentUrlInput) setAgentUrlInput(agentConfig.agentUrl);
  }, [agentConfig]);

  const saveCfgMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/python-config", { agentUrl: agentUrlInput, agentKey: agentKeyInput || undefined }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/python-config"] }); toast({ title: "Configuração salva!" }); setAgentKeyInput(""); },
    onError: (e: any) => toast({ title: `Erro: ${e.message}`, variant: "destructive" }),
  });

  const testCfgMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/python-config/test", {}).then(r => r.json()),
    onSuccess: (d) => toast({ title: "✅ Agente online!", description: d.output ?? "Conexão OK" }),
    onError: (e: any) => toast({ title: `❌ ${e.message}`, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/python-scripts/${id}`).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/python-scripts"] }); toast({ title: "Script removido" }); },
  });

  const executarMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/python-scripts/${id}/executar`, {}).then(r => r.json()),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["/api/python-scripts"] });
      qc.invalidateQueries({ queryKey: ["/api/python-execucoes"] });
      qc.invalidateQueries({ queryKey: ["/api/python-fila"] });
      if (d.execucaoId) setViewExecId(d.execucaoId);
      toast({ title: d.filaPos > 0 ? `Na fila — posição ${d.filaPos}` : "Execução iniciada!" });
    },
    onError: (e: any) => toast({ title: `Erro: ${e.message}`, variant: "destructive" }),
  });

  const allTags = Array.from(new Set(scripts.flatMap(s => s.tags ?? []))).sort();
  const filteredScripts = tagFilter ? scripts.filter(s => (s.tags ?? []).includes(tagFilter)) : scripts;

  const runningCount = scripts.filter(s => s.ultimoStatus === "executando").length;
  const queueCount = filaData?.total ?? 0;
  const successToday = executions.filter(e => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    return e.status === "concluido" && e.iniciadoEm >= todayStart.getTime();
  }).length;
  const errorToday = executions.filter(e => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    return e.status === "erro" && e.iniciadoEm >= todayStart.getTime();
  }).length;

  const STATUS_COLOR: Record<string, string> = {
    sucesso: "bg-green-500/15 text-green-400 border-green-500/30",
    erro: "bg-red-500/15 text-red-400 border-red-500/30",
    executando: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    aguardando: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    nunca: "bg-muted/50 text-muted-foreground border-border",
    concluido: "bg-green-500/15 text-green-400 border-green-500/30",
    timeout: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  };
  const STATUS_LABEL: Record<string, string> = {
    sucesso: "Sucesso", erro: "Erro", executando: "Executando", aguardando: "Na fila",
    nunca: "Nunca executado", concluido: "Concluído", timeout: "Timeout",
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Automação — Gestão de Execuções</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Gerencie, agende e monitore execuções de scripts na VM Windows</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {agentConfig?.hasConfig ? (
            <Badge className="bg-green-500/15 text-green-400 border border-green-500/30 gap-1">
              <Wifi className="h-3 w-3" /> Agente online
            </Badge>
          ) : (
            <Badge className="bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 gap-1">
              <WifiOff className="h-3 w-3" /> Agente não configurado
            </Badge>
          )}
          {filaData?.vmBusy && (
            <Badge className="bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 gap-1 animate-pulse">
              <Loader2 className="h-3 w-3 animate-spin" /> VM ocupada
            </Badge>
          )}
          {queueCount > 0 && (
            <Badge className="bg-blue-500/15 text-blue-400 border border-blue-500/30 gap-1">
              <ListOrdered className="h-3 w-3" /> {queueCount} na fila
            </Badge>
          )}
          <Button size="sm" onClick={() => { setEditScript(undefined); setShowForm(true); }} data-testid="button-novo-script">
            <Plus className="h-4 w-4 mr-1" /> Novo Script
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3 px-6 py-3 shrink-0">
        {[
          { label: "Scripts cadastrados", value: scripts.length, icon: FolderOpen, color: "text-blue-400" },
          { label: "Executando / Na fila", value: `${runningCount} / ${queueCount}`, icon: Loader2, color: "text-yellow-400" },
          { label: "Concluídos hoje", value: successToday, icon: CheckCircle2, color: "text-green-400" },
          { label: "Com erro hoje", value: errorToday, icon: XCircle, color: "text-red-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="py-3 px-4">
            <div className="flex items-center gap-3">
              <Icon className={`h-5 w-5 ${color}`} />
              <div>
                <div className="text-xl font-bold">{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Queue display */}
      {filaData && filaData.fila.length > 0 && (
        <div className="mx-6 mb-2 rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-2">
          <div className="flex items-center gap-2 text-xs text-blue-400 font-medium mb-1">
            <ListOrdered className="h-3.5 w-3.5" /> Fila de execução
          </div>
          <div className="flex flex-wrap gap-2">
            {filaData.fila.map(item => (
              <Badge key={item.execId} className="bg-blue-500/10 text-blue-300 border border-blue-500/20 text-xs gap-1">
                <span className="opacity-60">#{item.posicao}</span> {item.scriptNome}
                <span className="opacity-50">({item.origem})</span>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex-1 overflow-hidden px-6 pb-4">
        <Tabs defaultValue="dashboard" className="h-full flex flex-col">
          <TabsList className="shrink-0 w-fit">
            <TabsTrigger value="dashboard"><LayoutDashboard className="h-3.5 w-3.5 mr-1" />Dashboard</TabsTrigger>
            <TabsTrigger value="scripts">Scripts ({scripts.length})</TabsTrigger>
            <TabsTrigger value="historico">Histórico ({executions.length})</TabsTrigger>
            <TabsTrigger value="config"><Settings className="h-3.5 w-3.5 mr-1" />Configuração</TabsTrigger>
          </TabsList>

          {/* ── Dashboard Tab ── */}
          <TabsContent value="dashboard" className="flex-1 overflow-y-auto mt-3">
            <DashboardTab scripts={scripts} executions={executions} />
          </TabsContent>

          {/* ── Scripts Tab ── */}
          <TabsContent value="scripts" className="flex-1 overflow-y-auto mt-3 space-y-3">
            {allTags.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant={!tagFilter ? "default" : "outline"} onClick={() => setTagFilter("")} className="h-6 text-xs px-2">Todos</Button>
                {allTags.map(t => (
                  <Button key={t} size="sm" variant={tagFilter === t ? "default" : "outline"} onClick={() => setTagFilter(tagFilter === t ? "" : t)} className="h-6 text-xs px-2">
                    <Tag className="h-3 w-3 mr-1" />{t}
                  </Button>
                ))}
              </div>
            )}
            {filteredScripts.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                <FolderOpen className="h-10 w-10 opacity-30" />
                <p className="text-sm">Nenhum script cadastrado ainda.</p>
                <Button size="sm" onClick={() => { setEditScript(undefined); setShowForm(true); }}>
                  <Plus className="h-4 w-4 mr-1" /> Adicionar script
                </Button>
              </div>
            )}
            <div className="grid gap-3 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
              {filteredScripts.map(script => {
                const isRunning = script.ultimoStatus === "executando";
                const isQueued = script.ultimoStatus === "aguardando";
                const lastExec = executions.find(e => e.scriptId === script.id);
                return (
                  <Card key={script.id} className={`relative ${!script.ativo ? "opacity-60" : ""}`} data-testid={`card-script-${script.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-sm font-semibold truncate">{script.nome}</CardTitle>
                          {script.descricao && <CardDescription className="text-xs mt-0.5 line-clamp-2">{script.descricao}</CardDescription>}
                        </div>
                        <Badge className={`text-xs border shrink-0 ${STATUS_COLOR[script.ultimoStatus ?? "nunca"]}`}>
                          {isRunning && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                          {isQueued && <ListOrdered className="h-3 w-3 mr-1" />}
                          {STATUS_LABEL[script.ultimoStatus ?? "nunca"]}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="font-mono text-xs text-muted-foreground bg-muted/30 rounded px-2 py-1 truncate" title={script.caminhoVm}>
                        {script.caminhoVm}
                      </div>
                      {(script.tags ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {(script.tags ?? []).map(t => (
                            <span key={t} className="text-xs bg-muted/50 text-muted-foreground rounded px-1.5 py-0.5">{t}</span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {script.ultimaExecucao ? fmtDate(script.ultimaExecucao) : "Nunca executado"}
                        </span>
                        {script.agendamento && script.agendamento.tipo !== "nenhum" && (
                          <span className="flex items-center gap-1 text-blue-400">
                            <Calendar className="h-3 w-3" />
                            {script.agendamento.tipo === "diario" ? `Diário ${script.agendamento.horario}` :
                             script.agendamento.tipo === "semanal" ? `Semanal ${script.agendamento.horario}` :
                             script.agendamento.tipo === "mensal" ? `Mensal dia ${script.agendamento.diaMes}` : "Agendado"}
                            {!script.agendamento.habilitado && <span className="text-muted-foreground/60"> (inativo)</span>}
                          </span>
                        )}
                      </div>
                      {script.duracaoMediaMs && (
                        <div className="text-xs text-muted-foreground/60">⏱ Duração média: {fmtDuration(0, script.duracaoMediaMs)}</div>
                      )}
                      <div className="flex items-center gap-1 pt-1">
                        <Button
                          size="sm" className="flex-1 h-7"
                          onClick={() => executarMutation.mutate(script.id)}
                          disabled={executarMutation.isPending && executarMutation.variables === script.id}
                          data-testid={`button-executar-${script.id}`}
                        >
                          {isRunning ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> :
                           isQueued ? <ListOrdered className="h-3 w-3 mr-1" /> :
                           <Play className="h-3 w-3 mr-1" />}
                          {isRunning ? "Executando..." : isQueued ? "Na fila" : "Executar"}
                        </Button>
                        {lastExec && (
                          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setViewExecId(lastExec.id)} data-testid={`button-logs-${script.id}`}>
                            <Terminal className="h-3 w-3" />
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => { setEditScript(script); setShowForm(true); }} data-testid={`button-edit-${script.id}`}>
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 px-2 text-red-400 hover:text-red-300" onClick={() => deleteMutation.mutate(script.id)} data-testid={`button-delete-${script.id}`}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          {/* ── Histórico Tab ── */}
          <TabsContent value="historico" className="flex-1 overflow-y-auto mt-3">
            {executions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <Clock className="h-10 w-10 opacity-30" />
                <p className="text-sm">Nenhuma execução registrada ainda.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {executions.map(exec => (
                  <div key={exec.id} className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-3 hover:bg-muted/20 transition-colors" data-testid={`row-exec-${exec.id}`}>
                    <div className={`w-2 h-2 rounded-full shrink-0 ${exec.status === "concluido" ? "bg-green-400" : exec.status === "erro" ? "bg-red-400" : exec.status === "executando" ? "bg-yellow-400 animate-pulse" : exec.status === "aguardando" ? "bg-blue-400 animate-pulse" : "bg-orange-400"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{exec.scriptNome}</div>
                      <div className="text-xs text-muted-foreground flex gap-3 mt-0.5">
                        <span>{fmtDate(exec.iniciadoEm)}</span>
                        <span>{fmtDuration(exec.iniciadoEm, exec.concluidoEm)}</span>
                        <span className="capitalize">{exec.origem}</span>
                        {exec.exitCode !== undefined && exec.exitCode !== null && (
                          <span className={exec.exitCode === 0 ? "text-green-400" : "text-red-400"}>exit {exec.exitCode}</span>
                        )}
                      </div>
                    </div>
                    <Badge className={`text-xs border shrink-0 ${STATUS_COLOR[exec.status]}`}>
                      {exec.status === "executando" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                      {exec.status === "aguardando" && <ListOrdered className="h-3 w-3 mr-1" />}
                      {STATUS_LABEL[exec.status]}
                    </Badge>
                    <Button size="sm" variant="outline" className="h-7 px-2 shrink-0" onClick={() => setViewExecId(exec.id)} data-testid={`button-ver-logs-${exec.id}`}>
                      <Terminal className="h-3 w-3 mr-1" />Logs
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Config Tab ── */}
          <TabsContent value="config" className="mt-3">
            <Card className="max-w-lg">
              <CardHeader>
                <CardTitle className="text-base">Agente Python na VM</CardTitle>
                <CardDescription>Configure a URL e a chave de autenticação do agente rodando na VM Windows.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {agentConfig?.hasConfig && (
                  <div className="flex items-center gap-2 text-sm text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                    <Wifi className="h-4 w-4 shrink-0" />
                    Agente configurado — {agentConfig.agentUrl}
                  </div>
                )}
                <div className="space-y-1">
                  <Label>URL do Agente</Label>
                  <Input value={agentUrlInput} onChange={e => setAgentUrlInput(e.target.value)} placeholder="https://xxxx.ngrok-free.app" data-testid="input-agent-url" />
                </div>
                <div className="space-y-1">
                  <Label>Chave de API {agentConfig?.hasConfig && <span className="text-xs text-muted-foreground">(deixe vazio para manter)</span>}</Label>
                  <div className="flex gap-2">
                    <Input type={showKey ? "text" : "password"} value={agentKeyInput} onChange={e => setAgentKeyInput(e.target.value)} placeholder={agentConfig?.hasConfig ? agentConfig.agentKey : "Chave secreta"} className="flex-1" data-testid="input-agent-key" />
                    <Button size="icon" variant="outline" onClick={() => setShowKey(v => !v)}>
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => saveCfgMutation.mutate()} disabled={saveCfgMutation.isPending || !agentUrlInput} data-testid="button-save-config">
                    {saveCfgMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                    Salvar
                  </Button>
                  <Button variant="outline" onClick={() => testCfgMutation.mutate()} disabled={testCfgMutation.isPending || !agentConfig?.hasConfig} data-testid="button-test-config">
                    {testCfgMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wifi className="h-4 w-4 mr-1" />}
                    Testar conexão
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Dialogs */}
      {showForm && (
        <ScriptFormDialog
          open={showForm}
          onClose={() => { setShowForm(false); setEditScript(undefined); }}
          initial={editScript}
        />
      )}
      {viewExecId && <LogViewerModal execId={viewExecId} onClose={() => setViewExecId(undefined)} />}
    </div>
  );
}

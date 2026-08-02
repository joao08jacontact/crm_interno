import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, Trash2, Play, Edit2, ChevronDown, ChevronRight,
  Loader2, Database, Zap, BarChart3, Clock, CheckCircle2,
  XCircle, Circle, RefreshCw, ListChecks
} from "lucide-react";

type VerifBanco = { dbNome?: string; schema: string; tabela: string; coluna: string; toleranciaMinutos: number };
type JanelaExcecao = { dias: number[]; inicio: string; fim: string };
type Agendamento = {
  tipo: string; horario?: string; diasSemana?: number[];
  habilitado: boolean; repetirCada?: { valor: number; unidade: string; periodoMinutos: number };
  janelaHorario?: { inicio: string; fim: string; excecoes?: JanelaExcecao[] };
  expiraEm?: string;
};
type AutoTarefa = {
  id: string; nome: string; descricao: string; ativo: boolean;
  agendamento?: Agendamento; pularVerificacaoBanco?: boolean; verificacaoBanco: VerifBanco[];
  pbiDatasetId?: string; automacaoId?: string;
  status: "idle" | "verificando_banco" | "aguardando_pbi" | "executando_automacao" | "concluido" | "erro";
  ultimaExecucao?: number; proximaExecucao?: number;
  ultimoStatus: "sucesso" | "erro" | "nunca"; logs: string[]; criadoEm: number;
};
type PbiDataset = { id: string; name: string; groupId: string; datasetId: string; operacao?: string; gerenciadoPorAutoTarefa?: boolean };
type PythonScript = { id: string; nome: string; descricao: string; ativo: boolean; gerenciadoPorAutoTarefa?: boolean };
type DbAutoConfig = { id: string; nome: string; database: string; schema: string; table: string; timestampColumn: string; limiarMinutos: number; ativo: boolean; ultimoStatus: string };

const FREQ_OPTIONS = [
  { value: "nenhum", label: "Sem agendamento" },
  { value: "diario", label: "Diário" },
  { value: "semanal", label: "Semanal" },
  { value: "mensal", label: "Mensal" },
];
const DAYS_BR = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const REPEAT_OPTIONS = [5, 10, 15, 30, 60, 120].map(v => ({
  value: v, label: v >= 60 ? `${v / 60}h` : `${v}min`
}));
const PERIOD_OPTIONS = [
  { value: 30, label: "30 minutos" }, { value: 60, label: "1 hora" },
  { value: 240, label: "4 horas" }, { value: 1440, label: "1 dia" }, { value: 0, label: "Indeterminado" }
];

const STATUS_INFO: Record<AutoTarefa["status"], { label: string; color: string; spin: boolean }> = {
  idle: { label: "Aguardando", color: "text-slate-400", spin: false },
  verificando_banco: { label: "Verificando banco...", color: "text-blue-400", spin: true },
  aguardando_pbi: { label: "Aguardando PBI...", color: "text-yellow-400", spin: true },
  executando_automacao: { label: "Executando automação...", color: "text-orange-400", spin: true },
  concluido: { label: "Concluído", color: "text-green-400", spin: false },
  erro: { label: "Erro", color: "text-red-400", spin: false },
};

function fmtTime(ts?: number) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function nowTime() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`;
}

// ─── Form Dialog ──────────────────────────────────────────────────────────────
function TarefaFormDialog({ open, onClose, initial, pbiDatasets, scripts }: {
  open: boolean; onClose: () => void; initial?: AutoTarefa;
  pbiDatasets: PbiDataset[]; scripts: PythonScript[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const ag = initial?.agendamento;

  const { data: dbAutoConfigs = [] } = useQuery<DbAutoConfig[]>({
    queryKey: ["/api/db-auto-configs"],
  });

  // Geral
  const [nome, setNome] = useState(initial?.nome ?? "");
  const [descricao, setDescricao] = useState(initial?.descricao ?? "");
  const [ativo, setAtivo] = useState(initial?.ativo ?? true);

  // Banco
  const [pularVerificacaoBanco, setPularVerificacaoBanco] = useState(initial?.pularVerificacaoBanco ?? false);
  const [verifBanco, setVerifBanco] = useState<VerifBanco[]>(initial?.verificacaoBanco ?? []);

  // PBI
  const [pbiDatasetId, setPbiDatasetId] = useState(initial?.pbiDatasetId ?? "nenhum");

  // Automação
  const [automacaoId, setAutomacaoId] = useState(initial?.automacaoId ?? "nenhum");

  // Agendamento
  const [tipoFreq, setTipoFreq] = useState(ag?.tipo ?? "nenhum");
  const [horario, setHorario] = useState(ag?.horario ?? nowTime());
  const [diasSemana, setDiasSemana] = useState<number[]>(ag?.diasSemana ?? []);
  const [habilitado, setHabilitado] = useState(ag?.habilitado ?? true);
  const [showAdv, setShowAdv] = useState(false);
  const [useRepetir, setUseRepetir] = useState(!!ag?.repetirCada);
  const [repetirValor, setRepetirValor] = useState(ag?.repetirCada?.valor ?? 60);
  const [periodoRepetir, setPeriodoRepetir] = useState(ag?.repetirCada?.periodoMinutos ?? 0);
  const [useJanela, setUseJanela] = useState(!!ag?.janelaHorario);
  const [janelaInicio, setJanelaInicio] = useState(ag?.janelaHorario?.inicio ?? "08:00");
  const [janelaFim, setJanelaFim] = useState(ag?.janelaHorario?.fim ?? "21:00");
  const [janelaExcecoes, setJanelaExcecoes] = useState<JanelaExcecao[]>(ag?.janelaHorario?.excecoes ?? []);
  const [useExpira, setUseExpira] = useState(!!ag?.expiraEm);
  const [expiraData, setExpiraData] = useState(ag?.expiraEm?.slice(0, 10) ?? "");
  const [expiraHora, setExpiraHora] = useState(ag?.expiraEm?.slice(11, 16) ?? "");

  const mutation = useMutation({
    mutationFn: async () => {
      const agendamento: Agendamento | undefined = tipoFreq !== "nenhum" ? {
        tipo: tipoFreq,
        horario,
        diasSemana: (tipoFreq === "semanal" || tipoFreq === "diario") ? diasSemana : undefined,
        habilitado,
        repetirCada: useRepetir ? { valor: repetirValor, unidade: "minutos", periodoMinutos: periodoRepetir } : undefined,
        janelaHorario: useJanela ? { inicio: janelaInicio, fim: janelaFim, excecoes: janelaExcecoes.length > 0 ? janelaExcecoes : undefined } : undefined,
        expiraEm: useExpira && expiraData ? `${expiraData}T${expiraHora || "23:59"}` : undefined,
      } : undefined;
      const payload = {
        nome, descricao, ativo, agendamento,
        pularVerificacaoBanco,
        verificacaoBanco: pularVerificacaoBanco ? [] : verifBanco,
        pbiDatasetId: pbiDatasetId === "nenhum" ? undefined : pbiDatasetId,
        automacaoId: automacaoId === "nenhum" ? undefined : automacaoId,
      };
      if (initial) {
        return apiRequest("PUT", `/api/auto-tarefas/${initial.id}`, payload).then(r => r.json());
      }
      return apiRequest("POST", "/api/auto-tarefas", payload).then(r => r.json());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/auto-tarefas"] });
      toast({ title: initial ? "Tarefa atualizada!" : "Tarefa criada!" });
      onClose();
    },
    onError: (e: any) => toast({ title: `Erro: ${e.message}`, variant: "destructive" }),
  });

  const addRow = () => setVerifBanco(v => [...v, { dbNome: "", schema: "public", tabela: "", coluna: "updated_at", toleranciaMinutos: 30 }]);
  const removeRow = (i: number) => setVerifBanco(v => v.filter((_, j) => j !== i));
  const updateRow = (i: number, f: keyof VerifBanco, val: any) => setVerifBanco(v => v.map((r, j) => j === i ? { ...r, [f]: val } : r));
  const toggleDia = (d: number) => setDiasSemana(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d]);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border/50">
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-blue-400" />
            {initial ? "Editar Auto-Tarefa" : "Nova Auto-Tarefa"}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="geral" className="px-6 py-4">
          <TabsList className="mb-4">
            <TabsTrigger value="geral">Geral</TabsTrigger>
            <TabsTrigger value="banco">
              Banco {pularVerificacaoBanco
                ? <Badge variant="secondary" className="ml-1 text-xs opacity-50">off</Badge>
                : verifBanco.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{verifBanco.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="pbi">Power BI</TabsTrigger>
            <TabsTrigger value="automacao">Automação</TabsTrigger>
            <TabsTrigger value="agendamento">Agendamento</TabsTrigger>
          </TabsList>

          {/* Geral */}
          <TabsContent value="geral" className="space-y-4 mt-0">
            <div className="space-y-1">
              <Label>Nome *</Label>
              <Input
                data-testid="input-nome"
                value={nome}
                onChange={e => setNome(e.target.value)}
                placeholder="Ex: Cogna - Atualização Diária"
              />
            </div>
            <div className="space-y-1">
              <Label>Descrição</Label>
              <Textarea
                value={descricao}
                onChange={e => setDescricao(e.target.value)}
                placeholder="Descreva o fluxo desta tarefa..."
                rows={3}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={ativo} onCheckedChange={setAtivo} id="at-ativo" data-testid="switch-ativo" />
              <Label htmlFor="at-ativo" className="cursor-pointer">Tarefa ativa</Label>
            </div>
            <div className="rounded-lg border border-border/40 bg-blue-500/5 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Fluxo de execução:</p>
              {pularVerificacaoBanco ? (
                <>
                  <p>① Disparar atualização do dataset Power BI e aguardar conclusão</p>
                  <p>② Se ok → executar script de automação (Python)</p>
                </>
              ) : (
                <>
                  <p>① Verificar atualização do banco de dados (todas as tabelas configuradas)</p>
                  <p>② Se ok → disparar atualização do dataset Power BI e aguardar conclusão</p>
                  <p>③ Se ok → executar script de automação (Python)</p>
                </>
              )}
              <p className="text-amber-400">Qualquer etapa com falha interrompe o fluxo e registra o erro.</p>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Switch
                checked={pularVerificacaoBanco}
                onCheckedChange={setPularVerificacaoBanco}
                id="at-pular-banco"
                data-testid="switch-pular-banco"
              />
              <Label htmlFor="at-pular-banco" className="cursor-pointer text-sm">
                Pular verificação de banco — iniciar direto no Power BI
              </Label>
            </div>
          </TabsContent>

          {/* Banco */}
          <TabsContent value="banco" className="space-y-3 mt-0">
            <p className="text-xs text-muted-foreground">
              Defina quais tabelas precisam estar atualizadas. Todas devem estar dentro da tolerância para o fluxo continuar.
            </p>

            {/* Importar do módulo Banco de Dados */}
            {dbAutoConfigs.length > 0 && !pularVerificacaoBanco && (
              <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5" />
                  Importar do monitoramento (Banco de Dados)
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {dbAutoConfigs.map(cfg => {
                    const jaAdicionado = verifBanco.some(
                      r => r.schema === cfg.schema && r.tabela === cfg.table
                    );
                    return (
                      <button
                        key={cfg.id}
                        type="button"
                        disabled={jaAdicionado}
                        onClick={() => setVerifBanco(v => [...v, {
                          dbNome: cfg.database,
                          schema: cfg.schema,
                          tabela: cfg.table,
                          coluna: cfg.timestampColumn,
                          toleranciaMinutos: cfg.limiarMinutos,
                        }])}
                        data-testid={`btn-import-banco-${cfg.id}`}
                        title={jaAdicionado ? "Já adicionado" : `${cfg.schema}.${cfg.table} · ${cfg.timestampColumn} · ${cfg.limiarMinutos}min`}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs transition-colors ${
                          jaAdicionado
                            ? "border-green-500/30 text-green-400 bg-green-500/5 cursor-default opacity-60"
                            : "border-border/50 text-muted-foreground hover:text-foreground hover:border-blue-500/50 hover:bg-blue-500/5 cursor-pointer"
                        }`}
                      >
                        <Database className="h-3 w-3 shrink-0" />
                        <span className="font-mono">{cfg.schema}.{cfg.table}</span>
                        {cfg.nome && cfg.nome !== cfg.table && (
                          <span className="text-muted-foreground/60">({cfg.nome})</span>
                        )}
                        {jaAdicionado && <span>✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {pularVerificacaoBanco && (
              <div className="rounded-lg border border-border/30 bg-muted/10 p-3 text-xs text-muted-foreground/60 text-center">
                Verificação de banco desativada. Ative na aba Geral para configurar tabelas.
              </div>
            )}

            {!pularVerificacaoBanco && verifBanco.map((row, i) => (
              <div key={i} className="border border-border/50 rounded-lg p-3 space-y-2 relative bg-card/50">
                <button type="button" onClick={() => removeRow(i)} className="absolute top-2 right-2 text-muted-foreground hover:text-destructive transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <div className="grid grid-cols-2 gap-2 pr-6">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Schema</Label>
                    <Input
                      value={row.schema}
                      onChange={e => updateRow(i, "schema", e.target.value)}
                      placeholder="public"
                      className="h-7 text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Tabela</Label>
                    <Input
                      value={row.tabela}
                      onChange={e => updateRow(i, "tabela", e.target.value)}
                      placeholder="nome_da_tabela"
                      className="h-7 text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Coluna timestamp</Label>
                    <Input
                      value={row.coluna}
                      onChange={e => updateRow(i, "coluna", e.target.value)}
                      placeholder="updated_at"
                      className="h-7 text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Tolerância (minutos)</Label>
                    <Input
                      type="number"
                      value={row.toleranciaMinutos}
                      onChange={e => updateRow(i, "toleranciaMinutos", Number(e.target.value))}
                      min={1}
                      className="h-7 text-xs"
                    />
                  </div>
                </div>
              </div>
            ))}
            {!pularVerificacaoBanco && (
              <Button type="button" variant="outline" size="sm" onClick={addRow} className="w-full" data-testid="button-add-banco">
                <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar tabela manualmente
              </Button>
            )}
          </TabsContent>

          {/* PBI */}
          <TabsContent value="pbi" className="space-y-3 mt-0">
            <p className="text-xs text-muted-foreground">
              Selecione o dataset Power BI a ser atualizado após a verificação do banco. O fluxo aguarda a conclusão antes de avançar.
            </p>
            <div className="space-y-1">
              <Label>Dataset Power BI</Label>
              <Select value={pbiDatasetId} onValueChange={setPbiDatasetId}>
                <SelectTrigger data-testid="select-pbi-dataset">
                  <SelectValue placeholder="Selecionar dataset..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhum">— Nenhum (pular etapa) —</SelectItem>
                  {pbiDatasets.map(ds => (
                    <SelectItem key={ds.id} value={ds.id} data-testid={`option-dataset-${ds.id}`}>
                      {ds.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {pbiDatasetId && pbiDatasetId !== "nenhum" && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-400">
                <strong>Dica:</strong> Para evitar conflito com o agendamento próprio do Power BI, habilite a opção
                "Gerenciado por Auto-Tarefa" no módulo Power BI para este dataset. Isso desativa o agendamento
                próprio enquanto a Auto-Tarefa o controla.
              </div>
            )}
          </TabsContent>

          {/* Automação */}
          <TabsContent value="automacao" className="space-y-3 mt-0">
            <p className="text-xs text-muted-foreground">
              Selecione o script de automação a executar após o Power BI. O fluxo aguarda o término do script.
            </p>
            <div className="space-y-1">
              <Label>Script / Automação</Label>
              <Select value={automacaoId} onValueChange={setAutomacaoId}>
                <SelectTrigger data-testid="select-automacao">
                  <SelectValue placeholder="Selecionar automação..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhum">— Nenhuma (pular etapa) —</SelectItem>
                  {scripts.map(s => (
                    <SelectItem key={s.id} value={s.id} data-testid={`option-script-${s.id}`}>
                      {s.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {automacaoId && automacaoId !== "nenhum" && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-400">
                <strong>Dica:</strong> Para evitar execução dupla, marque esta automação como
                "Gerenciado por Auto-Tarefa" no módulo Automação. Isso desativa o agendamento próprio.
              </div>
            )}
          </TabsContent>

          {/* Agendamento */}
          <TabsContent value="agendamento" className="space-y-4 mt-0">
            <div className="space-y-1">
              <Label>Frequência</Label>
              <select
                value={tipoFreq}
                onChange={e => setTipoFreq(e.target.value)}
                className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background"
                data-testid="select-frequencia"
              >
                {FREQ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {tipoFreq !== "nenhum" && (
              <div className="space-y-1">
                <Label>Horário</Label>
                <Input type="time" value={horario} onChange={e => setHorario(e.target.value)} className="w-32" data-testid="input-horario" />
              </div>
            )}

            {(tipoFreq === "semanal" || tipoFreq === "diario") && (
              <div className="space-y-1">
                <Label>Dias da semana {tipoFreq === "diario" && <span className="text-muted-foreground font-normal text-xs">(vazio = todos os dias)</span>}</Label>
                <div className="flex gap-1 flex-wrap">
                  {DAYS_BR.map((d, i) => (
                    <button
                      key={i} type="button" onClick={() => toggleDia(i)}
                      data-testid={`button-dia-${i}`}
                      className={`px-2.5 py-1 text-xs rounded border transition-colors ${diasSemana.includes(i)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:border-foreground"}`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tipoFreq !== "nenhum" && (
              <div className="border-t border-border/40 pt-3 space-y-3">
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowAdv(v => !v)}
                >
                  {showAdv ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Opções avançadas
                </button>

                {showAdv && (
                  <div className="space-y-3 pl-1">
                    {/* Repetir */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Checkbox checked={useRepetir} onCheckedChange={v => setUseRepetir(!!v)} id="at-repetir" />
                        <label htmlFor="at-repetir" className="text-sm cursor-pointer">Repetir a cada</label>
                        <select
                          value={repetirValor}
                          onChange={e => setRepetirValor(Number(e.target.value))}
                          disabled={!useRepetir}
                          className="border border-border rounded px-2 py-1 text-xs bg-background disabled:opacity-40"
                        >
                          {REPEAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <span className="text-xs text-muted-foreground">por</span>
                        <select
                          value={periodoRepetir}
                          onChange={e => setPeriodoRepetir(Number(e.target.value))}
                          disabled={!useRepetir}
                          className="border border-border rounded px-2 py-1 text-xs bg-background disabled:opacity-40"
                        >
                          {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Janela de Horário */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        <Checkbox checked={useJanela} onCheckedChange={v => setUseJanela(!!v)} id="at-janela" />
                        <label htmlFor="at-janela" className="text-sm cursor-pointer">Janela de horário</label>
                        <span className="text-xs text-muted-foreground">De</span>
                        <Input
                          type="time" value={janelaInicio} onChange={e => setJanelaInicio(e.target.value)}
                          disabled={!useJanela} className="w-24 text-xs h-7 disabled:opacity-40"
                        />
                        <span className="text-xs text-muted-foreground">Até</span>
                        <Input
                          type="time" value={janelaFim} onChange={e => setJanelaFim(e.target.value)}
                          disabled={!useJanela} className="w-24 text-xs h-7 disabled:opacity-40"
                        />
                      </div>
                      {useJanela && (
                        <div className="ml-6 space-y-1.5">
                          {janelaExcecoes.map((exc, i) => (
                            <div key={i} className="flex items-center gap-2 flex-wrap">
                              <div className="flex gap-0.5 flex-wrap">
                                {DAYS_BR.map((d, di) => (
                                  <button
                                    key={di} type="button"
                                    onClick={() => {
                                      const n = [...janelaExcecoes];
                                      n[i] = { ...n[i], dias: n[i].dias.includes(di) ? n[i].dias.filter(x => x !== di) : [...n[i].dias, di] };
                                      setJanelaExcecoes(n);
                                    }}
                                    className={`px-1.5 py-0.5 text-xs rounded border ${exc.dias.includes(di) ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}
                                  >{d}</button>
                                ))}
                              </div>
                              <Input type="time" value={exc.inicio} onChange={e => { const n = [...janelaExcecoes]; n[i] = { ...n[i], inicio: e.target.value }; setJanelaExcecoes(n); }} className="w-24 text-xs h-7" />
                              <Input type="time" value={exc.fim} onChange={e => { const n = [...janelaExcecoes]; n[i] = { ...n[i], fim: e.target.value }; setJanelaExcecoes(n); }} className="w-24 text-xs h-7" />
                              <button type="button" onClick={() => setJanelaExcecoes(janelaExcecoes.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                          <button type="button" onClick={() => setJanelaExcecoes([...janelaExcecoes, { dias: [], inicio: "09:00", fim: "15:00" }])} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                            <Plus className="h-3 w-3" /> Exceção por dia
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Expira */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <Checkbox checked={useExpira} onCheckedChange={v => setUseExpira(!!v)} id="at-expira" />
                      <label htmlFor="at-expira" className="text-sm cursor-pointer">Expira em</label>
                      <Input type="date" value={expiraData} onChange={e => setExpiraData(e.target.value)} disabled={!useExpira} className="w-36 text-xs h-7 disabled:opacity-40" />
                      <Input type="time" value={expiraHora} onChange={e => setExpiraHora(e.target.value)} disabled={!useExpira} className="w-24 text-xs h-7 disabled:opacity-40" />
                    </div>

                    {/* Habilitado */}
                    <div className="flex items-center gap-2 pt-1 border-t border-border/30">
                      <Checkbox checked={habilitado} onCheckedChange={v => setHabilitado(!!v)} id="at-habilitado" />
                      <label htmlFor="at-habilitado" className="font-medium text-sm cursor-pointer">Agendamento habilitado</label>
                    </div>
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 px-6 pb-5 pt-2 border-t border-border/40">
          <Button variant="outline" onClick={onClose} data-testid="button-cancelar">Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !nome.trim()} data-testid="button-salvar">
            {mutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {initial ? "Salvar alterações" : "Criar Tarefa"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tarefa Card ──────────────────────────────────────────────────────────────
function TarefaCard({ tarefa, pbiDatasets, scripts, onEdit, onDelete, onRun }: {
  tarefa: AutoTarefa; pbiDatasets: PbiDataset[]; scripts: PythonScript[];
  onEdit: () => void; onDelete: () => void; onRun: () => void;
}) {
  const [showLogs, setShowLogs] = useState(false);
  const st = STATUS_INFO[tarefa.status];
  const isRunning = st.spin;
  const pbiName = tarefa.pbiDatasetId ? pbiDatasets.find(d => d.id === tarefa.pbiDatasetId)?.name : null;
  const scriptName = tarefa.automacaoId ? scripts.find(s => s.id === tarefa.automacaoId)?.nome : null;

  return (
    <Card className="border-border/50" data-testid={`card-tarefa-${tarefa.id}`}>
      <CardHeader className="py-3 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-sm font-semibold">{tarefa.nome}</CardTitle>
              <span className={`flex items-center gap-1 text-xs ${st.color}`}>
                {isRunning
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : tarefa.status === "concluido" ? <CheckCircle2 className="h-3 w-3" />
                  : tarefa.status === "erro" ? <XCircle className="h-3 w-3" />
                  : <Circle className="h-3 w-3" />}
                {st.label}
              </span>
              {!tarefa.ativo && <Badge variant="outline" className="text-xs text-muted-foreground">Inativo</Badge>}
              {tarefa.ultimoStatus !== "nunca" && !isRunning && (
                <Badge variant="outline" className={`text-xs ${tarefa.ultimoStatus === "sucesso" ? "text-green-400 border-green-500/30" : "text-red-400 border-red-500/30"}`}>
                  {tarefa.ultimoStatus === "sucesso" ? "✅ Último ok" : "❌ Último com erro"}
                </Badge>
              )}
            </div>
            {tarefa.descricao && <CardDescription className="text-xs mt-0.5 truncate">{tarefa.descricao}</CardDescription>}
          </div>
          <div className="flex gap-1 shrink-0">
            <Button
              size="icon" variant="ghost" className="h-7 w-7" onClick={onRun}
              disabled={isRunning} title="Executar agora"
              data-testid={`button-run-${tarefa.id}`}
            >
              {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit} title="Editar" data-testid={`button-edit-${tarefa.id}`}>
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onDelete} title="Excluir" data-testid={`button-delete-${tarefa.id}`}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0 space-y-2">
        {/* Pipeline */}
        <div className="flex items-center gap-1.5 text-xs flex-wrap">
          {tarefa.pularVerificacaoBanco ? (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded border border-border/20 text-muted-foreground/40 line-through">
              <Database className="h-3 w-3" />
              Banco
            </div>
          ) : (
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded border ${tarefa.verificacaoBanco?.length > 0 ? "border-blue-500/40 text-blue-400 bg-blue-500/5" : "border-border/30 text-muted-foreground"}`}>
              <Database className="h-3 w-3" />
              {tarefa.verificacaoBanco?.length > 0
                ? `Banco (${tarefa.verificacaoBanco.length} tabela${tarefa.verificacaoBanco.length !== 1 ? "s" : ""})`
                : "Banco (—)"}
            </div>
          )}
          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded border ${pbiName ? "border-yellow-500/40 text-yellow-400 bg-yellow-500/5" : "border-border/30 text-muted-foreground"}`}>
            <BarChart3 className="h-3 w-3" />
            {pbiName ?? "Power BI (—)"}
          </div>
          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded border ${scriptName ? "border-orange-500/40 text-orange-400 bg-orange-500/5" : "border-border/30 text-muted-foreground"}`}>
            <Zap className="h-3 w-3" />
            {scriptName ?? "Automação (—)"}
          </div>
        </div>

        {/* Times */}
        <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Última: {fmtTime(tarefa.ultimaExecucao)}
          </span>
          <span className="flex items-center gap-1">
            <RefreshCw className="h-3 w-3" />
            Próxima: {fmtTime(tarefa.proximaExecucao)}
          </span>
        </div>

        {/* Logs */}
        {tarefa.logs?.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowLogs(v => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid={`button-toggle-logs-${tarefa.id}`}
            >
              {showLogs ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Logs ({tarefa.logs.length} linhas)
            </button>
            {showLogs && (
              <div className="mt-1.5 bg-black/50 dark:bg-black/70 rounded p-2 font-mono text-[11px] max-h-48 overflow-y-auto space-y-0.5 border border-border/30">
                {tarefa.logs.slice(-60).map((line, i) => (
                  <div
                    key={i}
                    className={`whitespace-pre-wrap leading-tight ${
                      line.includes("❌") ? "text-red-400"
                      : line.includes("✅") ? "text-green-400"
                      : line.includes("⏳") || line.includes("⚡") || line.includes("🚀") ? "text-yellow-400"
                      : line.includes("🔍") ? "text-blue-400"
                      : line.includes("⚙️") ? "text-orange-400"
                      : line.includes("🎉") ? "text-green-300"
                      : "text-slate-300"}`}
                  >
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AutoTarefas() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AutoTarefa | undefined>();

  const { data: tarefas = [], isLoading } = useQuery<AutoTarefa[]>({
    queryKey: ["/api/auto-tarefas"],
    refetchInterval: 15_000,
  });

  const { data: pbiDatasets = [] } = useQuery<PbiDataset[]>({
    queryKey: ["/api/pbi-datasets"],
  });

  const { data: scripts = [] } = useQuery<PythonScript[]>({
    queryKey: ["/api/python-scripts"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/auto-tarefas/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/auto-tarefas"] });
      toast({ title: "Tarefa excluída" });
    },
    onError: (e: any) => toast({ title: `Erro: ${e.message}`, variant: "destructive" }),
  });

  const runMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/auto-tarefas/${id}/run`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/auto-tarefas"] });
      toast({ title: "Tarefa iniciada!", description: "Acompanhe o progresso nos logs do card." });
    },
    onError: (e: any) => toast({ title: `Erro ao iniciar: ${e.message}`, variant: "destructive" }),
  });

  const openNew = () => { setEditing(undefined); setFormOpen(true); };
  const openEdit = (t: AutoTarefa) => { setEditing(t); setFormOpen(true); };

  const active = tarefas.filter(t => t.ativo).length;
  const running = tarefas.filter(t => STATUS_INFO[t.status].spin).length;
  const errors = tarefas.filter(t => t.ultimoStatus === "erro").length;

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-blue-400" />
          <h1 className="text-lg font-semibold">Auto - Tarefas</h1>
          <Badge variant="secondary" data-testid="badge-total">{tarefas.length}</Badge>
        </div>
        <Button size="sm" onClick={openNew} data-testid="button-nova-tarefa">
          <Plus className="h-4 w-4 mr-1" /> Nova Tarefa
        </Button>
      </div>

      {/* Stats */}
      {tarefas.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total", value: tarefas.length, color: "text-blue-400" },
            { label: "Ativas", value: active, color: "text-green-400" },
            { label: "Executando", value: running, color: "text-yellow-400" },
            { label: "Com erro", value: errors, color: "text-red-400" },
          ].map(({ label, value, color }) => (
            <Card key={label} className="py-2 px-3 border-border/40" data-testid={`stat-${label.toLowerCase()}`}>
              <div className={`text-xl font-bold ${color}`}>{value}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </Card>
          ))}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && tarefas.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ListChecks className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground font-medium">Nenhuma Auto-Tarefa cadastrada</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            Crie um fluxo automatizado que verifica o banco de dados, atualiza um dataset do Power BI
            e executa uma automação — tudo em sequência.
          </p>
          <Button className="mt-4" onClick={openNew} data-testid="button-criar-primeira">
            <Plus className="h-4 w-4 mr-1" /> Criar primeira tarefa
          </Button>
        </div>
      )}

      {/* Cards */}
      <div className="grid gap-3">
        {tarefas.map(t => (
          <TarefaCard
            key={t.id}
            tarefa={t}
            pbiDatasets={pbiDatasets}
            scripts={scripts}
            onEdit={() => openEdit(t)}
            onDelete={() => { if (confirm(`Excluir "${t.nome}"?`)) deleteMutation.mutate(t.id); }}
            onRun={() => runMutation.mutate(t.id)}
          />
        ))}
      </div>

      {/* Form */}
      {formOpen && (
        <TarefaFormDialog
          open={formOpen}
          onClose={() => { setFormOpen(false); setEditing(undefined); }}
          initial={editing}
          pbiDatasets={pbiDatasets}
          scripts={scripts}
        />
      )}
    </div>
  );
}

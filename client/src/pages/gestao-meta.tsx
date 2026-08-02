import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  AlertTriangle, CheckCircle2, RefreshCw, Plus, Trash2, Eye, EyeOff,
  Loader2, Shield, ChevronDown, ChevronRight, Pencil, Check,
  Phone, FileText, Building2, X, Layers
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  type MetaWaba, type MetaOperacao, type MetaPhoneNumber, type MetaTemplate,
  type MetaQualityRating, type MetaConversationAnalytics, type DisparoCanal,
  META_QUALITY_COLORS, META_QUALITY_LABELS,
  META_TEMPLATE_STATUS_LABELS, META_TEMPLATE_CATEGORY_LABELS,
  TIER_ORDER, TIER_LIMITS, TIER_LABELS,
} from "@shared/schema";

// ── palette ────────────────────────────────────────────────────────────────
const P = {
  bg:       "#0B1220",
  surface:  "#131B2E",
  elevated: "#1A2438",
  border:   "#26314A",
  textPri:  "#E8ECF4",
  textSec:  "#8B96AC",
  accent:   "#6C7BFF",
  GREEN:    "#34D399",
  YELLOW:   "#FBBF24",
  RED:      "#F87171",
  UNKNOWN:  "#64748B",
};

// ── helpers ────────────────────────────────────────────────────────────────
const qColor = (r: MetaQualityRating) => META_QUALITY_COLORS[r] ?? P.UNKNOWN;

const QUALITY_ORDER: MetaQualityRating[] = ["RED", "YELLOW", "UNKNOWN", "GREEN"];
function worstQuality(ratings: MetaQualityRating[]): MetaQualityRating {
  if (!ratings.length) return "UNKNOWN";
  for (const q of QUALITY_ORDER) if (ratings.includes(q)) return q;
  return "GREEN";
}

function QBadge({ q, small }: { q: MetaQualityRating; small?: boolean }) {
  const c = qColor(q);
  const sz = small ? "text-[10px] px-1.5 py-0 leading-5" : "text-xs px-2 py-0.5 leading-5";
  return (
    <span style={{ background: c + "22", color: c, border: `1px solid ${c}44` }}
      className={`rounded font-mono font-semibold ${sz} whitespace-nowrap`}>
      {META_QUALITY_LABELS[q]}
    </span>
  );
}

function Beacon({ q }: { q: MetaQualityRating }) {
  const c = qColor(q);
  const pulse = q === "RED" ? "motion-safe:animate-pulse" : "";
  return (
    <span className={`inline-block w-3 h-3 rounded-full shrink-0 ${pulse}`}
      style={{ background: c, boxShadow: `0 0 6px ${c}88` }} />
  );
}

// ── API fetchers ───────────────────────────────────────────────────────────
const fetchMeta = (path: string) => apiRequest("GET", path).then(r => r.json());

// ══════════════════════════════════════════════════════════════════════════
export default function GestaoMetaPage() {
  const [tab, setTab] = useState<"painel" | "config">("painel");

  const qc = useQueryClient();
  const { data: operacoes = [] } = useQuery<MetaOperacao[]>({ queryKey: ["/api/meta/operacoes"], queryFn: () => fetchMeta("/api/meta/operacoes") });
  const { data: wabas = [] }     = useQuery<MetaWaba[]>({ queryKey: ["/api/meta/wabas"],     queryFn: () => fetchMeta("/api/meta/wabas") });
  const { data: phones = [] }    = useQuery<MetaPhoneNumber[]>({ queryKey: ["/api/meta/phone-numbers"], queryFn: () => fetchMeta("/api/meta/phone-numbers") });
  const { data: templates = [] } = useQuery<MetaTemplate[]>({ queryKey: ["/api/meta/templates"],   queryFn: () => fetchMeta("/api/meta/templates") });
  const { data: convAnalytics = [] } = useQuery<MetaConversationAnalytics[]>({ queryKey: ["/api/meta/conversation-analytics"], queryFn: () => fetchMeta("/api/meta/conversation-analytics") });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/meta/wabas"] });
    qc.invalidateQueries({ queryKey: ["/api/meta/phone-numbers"] });
    qc.invalidateQueries({ queryKey: ["/api/meta/templates"] });
    qc.invalidateQueries({ queryKey: ["/api/meta/operacoes"] });
    qc.invalidateQueries({ queryKey: ["/api/meta/conversation-analytics"] });
  };

  // ── alert bar items ────────────────────────────────────────────────────
  const alerts = useMemo(() => {
    const opMap = Object.fromEntries(operacoes.map(o => [o.id, o.nome]));
    const items: { key: string; label: string; op: string; quality: MetaQualityRating; kind: "phone" | "template" }[] = [];
    for (const p of phones) {
      if (p.qualityRating === "RED" || p.qualityRating === "YELLOW") {
        items.push({ key: p.id, label: p.displayPhoneNumber, op: opMap[p.operacaoId ?? ""] || "Sem operação", quality: p.qualityRating, kind: "phone" });
      }
    }
    for (const t of templates) {
      if (t.qualityScore === "RED" || t.qualityScore === "YELLOW") {
        items.push({ key: t.id, label: t.name, op: opMap[t.operacaoId ?? ""] || "Sem operação", quality: t.qualityScore, kind: "template" });
      }
    }
    return items;
  }, [phones, templates, operacoes]);

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: P.bg, color: P.textPri }}>
      {/* ── tab header ────────────────────────────────────────────────── */}
      <div style={{ background: P.surface, borderBottom: `1px solid ${P.border}` }}
        className="shrink-0 flex items-center gap-0 px-4">
        {(["painel", "config"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={tab === t ? { color: P.accent, borderBottom: `2px solid ${P.accent}` } : { color: P.textSec, borderBottom: "2px solid transparent" }}
            className="px-4 py-3 text-sm font-medium capitalize transition-colors hover:opacity-90">
            {t === "painel" ? "Painel" : "Configuração"}
          </button>
        ))}
      </div>

      {/* ── alert bar ─────────────────────────────────────────────────── */}
      {tab === "painel" && (
        <div className="shrink-0 px-4 py-2" style={{ background: alerts.length ? "#2a1212" : "#0d1f12", borderBottom: `1px solid ${P.border}` }}>
          {alerts.length === 0 ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: P.GREEN }}>
              <CheckCircle2 className="h-4 w-4" /> Tudo operando normalmente
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: P.RED }} />
              <span className="text-xs font-semibold" style={{ color: P.RED }}>{alerts.length} alerta{alerts.length > 1 ? "s" : ""}</span>
              {alerts.slice(0, 8).map(a => (
                <span key={a.key} className="flex items-center gap-1 text-xs rounded px-2 py-0.5 font-mono"
                  style={{ background: qColor(a.quality) + "20", color: qColor(a.quality), border: `1px solid ${qColor(a.quality)}44` }}>
                  {a.kind === "phone" ? <Phone className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                  {a.label} · {a.op}
                </span>
              ))}
              {alerts.length > 8 && <span className="text-xs" style={{ color: P.textSec }}>+{alerts.length - 8} mais</span>}
            </div>
          )}
        </div>
      )}

      {/* ── main content ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {tab === "painel"
          ? <PainelTab operacoes={operacoes} phones={phones} templates={templates} wabas={wabas} convAnalytics={convAnalytics} />
          : <ConfigTab operacoes={operacoes} phones={phones} wabas={wabas} onMutated={invalidate} />
        }
      </div>
    </div>
  );
}

// ── últimos 7 dias (abrev. pt-BR) ─────────────────────────────────────────
function last7DayLabels(): string[] {
  const days = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  const now = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    return days[d.getDay()];
  });
}

// ── mini bar chart ─────────────────────────────────────────────────────────
function MiniBarChart({ data, color }: { data: number[]; color: string }) {
  const labels = last7DayLabels();
  const hasData = data.some(v => v > 0);
  const chartData = labels.map((label, i) => ({ label, v: data[i] ?? 0 }));

  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-[88px]"
        style={{ border: `1px dashed ${P.border}`, borderRadius: 6 }}>
        <p className="text-[10px]" style={{ color: P.textSec }}>Sem dados — aguardando sincronização da API</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={88}>
      <BarChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barSize={14}>
        <XAxis dataKey="label" tick={{ fontSize: 9, fill: P.textSec }} axisLine={false} tickLine={false} />
        <YAxis hide />
        <Tooltip
          contentStyle={{ background: P.elevated, border: `1px solid ${P.border}`, borderRadius: 6, fontSize: 11 }}
          labelStyle={{ color: P.textSec }}
          itemStyle={{ color: P.textPri }}
          formatter={(v: number) => [v.toLocaleString("pt-BR"), "Disparos"]}
        />
        <Bar dataKey="v" radius={[3,3,0,0]}>
          {chartData.map((_, i) => (
            <Cell key={i} fill={i === 6 ? color : color + "88"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// PAINEL TAB
// ══════════════════════════════════════════════════════════════════════════
function PainelTab({ operacoes, phones, templates, wabas, convAnalytics }: {
  operacoes: MetaOperacao[];
  phones: MetaPhoneNumber[];
  templates: MetaTemplate[];
  wabas: MetaWaba[];
  convAnalytics: MetaConversationAnalytics[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  // mapa wabaId → daily7d para acesso rápido no card
  const convByWaba = useMemo(
    () => Object.fromEntries(convAnalytics.map(c => [c.wabaId, c.daily7d])) as Record<string, number[]>,
    [convAnalytics],
  );

  const opData = useMemo(() => {
    const all = [
      ...operacoes.map(o => o.id),
      ...(phones.filter(p => !p.operacaoId).length || templates.filter(t => !t.operacaoId).length ? ["__unassigned__"] : [])
    ];
    const ids = [...new Set(all)];
    return ids.map(id => {
      const op = operacoes.find(o => o.id === id);
      const myPhones = phones.filter(p => (id === "__unassigned__" ? !p.operacaoId : p.operacaoId === id));
      const myTpls   = templates.filter(t => (id === "__unassigned__" ? !t.operacaoId : t.operacaoId === id));
      const allRatings: MetaQualityRating[] = [...myPhones.map(p => p.qualityRating), ...myTpls.map(t => t.qualityScore)];
      const beacon = worstQuality(allRatings);
      const disparo7d = myTpls.reduce((s, t) => s + (t.disparo7d ?? 0), 0);
      // soma histórico diário de todos os templates da operação
      const chartData = Array.from({ length: 7 }, (_, i) =>
        myTpls.reduce((s, t) => s + ((t.disparo7dHistory ?? [])[i] ?? 0), 0)
      );
      return { id, nome: op?.nome ?? "Sem operação", myPhones, myTpls, beacon, disparo7d, chartData };
    });
  }, [operacoes, phones, templates]);

  if (opData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3" style={{ color: P.textSec }}>
        <Building2 className="h-10 w-10 opacity-40" />
        <p className="text-sm">Nenhuma operação configurada ainda.</p>
        <p className="text-xs">Vá até a aba Configuração para cadastrar WABAs e operações.</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {opData.map(op => (
        <OperacaoCard key={op.id} op={op}
          wabas={wabas}
          convByWaba={convByWaba}
          isExpanded={expanded === op.id}
          onToggle={() => setExpanded(prev => prev === op.id ? null : op.id)} />
      ))}
    </div>
  );
}

function OperacaoCard({ op, wabas, convByWaba, isExpanded, onToggle }: {
  op: {
    id: string; nome: string;
    myPhones: MetaPhoneNumber[]; myTpls: MetaTemplate[];
    beacon: MetaQualityRating; disparo7d: number; chartData: number[];
  };
  wabas: MetaWaba[];
  convByWaba: Record<string, number[]>;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { myPhones, myTpls, beacon, disparo7d, chartData } = op;
  const accentColor = qColor(beacon);
  const total = myPhones.length;
  const dist = (["GREEN","YELLOW","RED","UNKNOWN"] as MetaQualityRating[]).map(q => ({
    q, count: myPhones.filter(p => p.qualityRating === q).length
  })).filter(d => d.count > 0);
  const worstTpl = worstQuality(myTpls.map(t => t.qualityScore));

  // Agrupa telefones por WABA (preserva ordem de inserção)
  const wabaGroups = useMemo(() => {
    const map = new Map<string, MetaPhoneNumber[]>();
    for (const p of myPhones) {
      const wid = p.wabaId ?? "__sem_waba__";
      if (!map.has(wid)) map.set(wid, []);
      map.get(wid)!.push(p);
    }
    return Array.from(map.entries()).map(([wabaMetaId, wabaPhones]) => ({ wabaMetaId, wabaPhones }));
  }, [myPhones]);

  return (
    <div style={{ background: P.surface, border: `1px solid ${P.border}`, borderRadius: 10, overflow: "hidden" }}>
      {/* barra colorida de acento no topo */}
      <div style={{ height: 4, background: accentColor, opacity: 0.85 }} />

      {/* cabeçalho clicável */}
      <button onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:opacity-90 transition-opacity">
        <Beacon q={beacon} />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-base truncate" style={{ color: P.textPri }}>{op.nome}</p>
          <p className="text-xs mt-0.5" style={{ color: P.textSec }}>
            {wabaGroups.length} WABA{wabaGroups.length !== 1 ? "s" : ""} · {myPhones.length} número{myPhones.length !== 1 ? "s" : ""} · {myTpls.length} template{myTpls.length !== 1 ? "s" : ""}
          </p>
        </div>
        {/* totais rápidos */}
        <div className="text-right shrink-0 mr-2 hidden sm:block">
          <p className="text-[10px] uppercase tracking-wide" style={{ color: P.textSec }}>Disparos 7d</p>
          <p className="text-lg font-mono font-bold" style={{ color: P.textPri }}>{disparo7d.toLocaleString("pt-BR")}</p>
        </div>
        {isExpanded
          ? <ChevronDown className="h-4 w-4 shrink-0" style={{ color: P.textSec }} />
          : <ChevronRight className="h-4 w-4 shrink-0" style={{ color: P.textSec }} />}
      </button>

      {/* corpo sempre visível: gráfico + qualidade + resumo WABA */}
      <div className="px-5 pb-4" style={{ borderTop: `1px solid ${P.border}` }}>
        <div className="flex flex-col sm:flex-row gap-5 pt-4">
          {/* gráfico de disparos dia a dia */}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wide font-medium mb-2" style={{ color: P.textSec }}>
              Disparos por dia (últimos 7 dias)
            </p>
            <MiniBarChart data={chartData} color={accentColor} />
          </div>

          {/* painel lateral de qualidade */}
          <div className="sm:w-48 shrink-0 space-y-3">
            {/* disparos total (mobile: só aqui) */}
            <div className="sm:hidden">
              <p className="text-[10px] uppercase tracking-wide" style={{ color: P.textSec }}>Disparos 7d</p>
              <p className="text-xl font-mono font-bold" style={{ color: P.textPri }}>{disparo7d.toLocaleString("pt-BR")}</p>
            </div>

            {/* qualidade números */}
            {total > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wide font-medium mb-1.5" style={{ color: P.textSec }}>Qualidade dos números</p>
                <div className="flex h-2 rounded-full overflow-hidden gap-px mb-1.5">
                  {(["GREEN","YELLOW","RED","UNKNOWN"] as MetaQualityRating[]).map(q => {
                    const cnt = myPhones.filter(p => p.qualityRating === q).length;
                    if (!cnt) return null;
                    return <div key={q} style={{ flex: cnt, background: qColor(q) }} title={`${META_QUALITY_LABELS[q]}: ${cnt}`} />;
                  })}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {dist.map(d => (
                    <span key={d.q} className="text-[10px] font-mono" style={{ color: qColor(d.q) }}>
                      {META_QUALITY_LABELS[d.q]}: {d.count}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* templates pior qualidade */}
            {myTpls.length > 0 && (
              <div className="flex items-center gap-2">
                <FileText className="h-3 w-3 shrink-0" style={{ color: P.textSec }} />
                <span className="text-[10px]" style={{ color: P.textSec }}>{myTpls.length} template{myTpls.length !== 1 ? "s" : ""}</span>
                <QBadge q={worstTpl} small />
              </div>
            )}
          </div>
        </div>

        {/* resumo compacto dos WABAs (sempre visível) */}
        {wabaGroups.length > 0 && (
          <div className="mt-4 pt-3 space-y-1.5" style={{ borderTop: `1px solid ${P.border}` }}>
            <p className="text-[10px] uppercase tracking-wide font-medium mb-2 flex items-center gap-1.5" style={{ color: P.textSec }}>
              <Layers className="h-3 w-3" /> WABAs desta operação
            </p>
            {wabaGroups.map(({ wabaMetaId, wabaPhones }) => {
              const waba = wabas.find(w => w.wabaId === wabaMetaId);
              const name = waba?.apelido && waba.apelido !== wabaMetaId
                ? waba.apelido
                : wabaMetaId.length > 14 ? `…${wabaMetaId.slice(-10)}` : wabaMetaId;
              const q = worstQuality(wabaPhones.map(p => p.qualityRating));
              const tier = wabaPhones[0]?.messagingLimitTier ?? "";
              return (
                <div key={wabaMetaId}
                  className="flex items-center gap-2 px-3 py-2 rounded text-xs"
                  style={{ background: P.elevated, border: `1px solid ${P.border}` }}>
                  <Beacon q={q} />
                  <span className="font-semibold flex-1 truncate" style={{ color: P.textPri }}>{name}</span>
                  {tier && <TierBadge tier={tier} />}
                  <span className="font-mono text-[10px] shrink-0" style={{ color: P.textSec }}>
                    {wabaPhones.length}n
                  </span>
                </div>
              );
            })}
            {!isExpanded && (
              <p className="text-[10px] text-center mt-1" style={{ color: P.textSec }}>
                ↕ Expanda para ver detalhes e limite de mensagens por WABA
              </p>
            )}
          </div>
        )}
      </div>

      {/* detalhe expandido: blocos por WABA + templates */}
      {isExpanded && (
        <div style={{ borderTop: `1px solid ${P.border}`, background: P.elevated }} className="px-5 py-4 space-y-4">

          {/* bloco por WABA */}
          {wabaGroups.map(({ wabaMetaId, wabaPhones }) => (
            <WabaBlock
              key={wabaMetaId}
              wabaMetaId={wabaMetaId}
              phones={wabaPhones}
              wabas={wabas}
              convByWaba={convByWaba}
            />
          ))}

          {/* templates (flat, por toda a operação) */}
          {myTpls.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: P.textSec }}>
                <FileText className="h-3 w-3" /> Templates
              </p>
              <div className="space-y-1.5">
                {myTpls.map(t => (
                  <div key={t.id} className="flex items-center gap-2 text-xs flex-wrap"
                    style={{ padding: "6px 8px", background: P.surface, borderRadius: 6, border: `1px solid ${P.border}` }}>
                    <QBadge q={t.qualityScore} small />
                    <span className="font-mono font-semibold truncate max-w-[180px]" style={{ color: P.textPri }}>{t.name}</span>
                    <TemplateStatusBadge s={t.status} />
                    <span className="text-[10px]" style={{ color: P.textSec }}>{META_TEMPLATE_CATEGORY_LABELS[t.category]}</span>
                    <span className="font-mono text-[10px] ml-auto" style={{ color: P.textSec }}>{(t.disparo7d ?? 0).toLocaleString("pt-BR")} env.</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {myPhones.length === 0 && myTpls.length === 0 && (
            <p className="text-xs text-center py-2" style={{ color: P.textSec }}>Nenhum número ou template atribuído a esta operação.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── WabaBlock: bloco de um WABA específico com seus números e tier ──────────
function WabaBlock({ wabaMetaId, phones, wabas, convByWaba }: {
  wabaMetaId: string;
  phones: MetaPhoneNumber[];
  wabas: MetaWaba[];
  convByWaba: Record<string, number[]>;
}) {
  const waba = wabas.find(w => w.wabaId === wabaMetaId);
  const displayName = waba?.apelido && waba.apelido !== wabaMetaId
    ? waba.apelido
    : null;
  const shortId = wabaMetaId.length > 16 ? `${wabaMetaId.slice(0, 8)}…${wabaMetaId.slice(-6)}` : wabaMetaId;

  return (
    <div style={{ border: `1px solid ${P.border}`, borderRadius: 8, overflow: "hidden" }}>
      {/* cabeçalho do WABA */}
      <div style={{ background: P.bg, borderBottom: `1px solid ${P.border}` }}
        className="px-4 py-2.5 flex items-center gap-2">
        <Layers className="h-3.5 w-3.5 shrink-0" style={{ color: P.accent }} />
        <div className="flex-1 min-w-0">
          {displayName
            ? <>
                <span className="text-sm font-bold mr-2" style={{ color: P.accent }}>{displayName}</span>
                <span className="font-mono text-[10px]" style={{ color: P.textSec }}>· {shortId}</span>
              </>
            : <span className="font-mono text-sm font-semibold" style={{ color: P.accent }}>{shortId}</span>
          }
        </div>
        <span className="text-[10px] shrink-0" style={{ color: P.textSec }}>
          {phones.length} número{phones.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* números do WABA */}
      <div className="px-4 pt-3 pb-1 space-y-1.5">
        {phones.map(p => (
          <div key={p.id} className="flex items-center gap-2 text-xs flex-wrap"
            style={{ padding: "6px 8px", background: P.surface, borderRadius: 6, border: `1px solid ${P.border}` }}>
            <QBadge q={p.qualityRating} small />
            <span className="font-mono font-semibold" style={{ color: P.textPri }}>{p.displayPhoneNumber}</span>
            <span style={{ color: P.textSec }}>{p.verifiedName}</span>
            <PhoneStatusBadge s={p.status} />
            <span className="ml-auto"><TierBadge tier={p.messagingLimitTier} /></span>
          </div>
        ))}
      </div>

      {/* Tier Progress Card para este WABA */}
      <div className="px-4 pb-4 pt-2">
        <TierProgressCard phones={phones} convByWaba={convByWaba} />
      </div>
    </div>
  );
}

// ── Tier rail + progress card ──────────────────────────────────────────────
const TIER_STEPS = TIER_ORDER.map(key => ({
  key,
  label: TIER_LABELS[key] ?? key,
  limit: TIER_LIMITS[key] ?? Infinity,
}));

function TierBadge({ tier }: { tier: string }) {
  const label = TIER_LABELS[tier] ?? tier;
  const isUnlimited = tier === "UNLIMITED";
  return (
    <span className="text-[10px] px-1.5 rounded font-mono font-semibold whitespace-nowrap"
      style={{ background: P.accent + "22", color: P.accent, border: `1px solid ${P.accent}44` }}>
      {isUnlimited ? "∞ Ilimitado" : `${label}/dia`}
    </span>
  );
}

function TierProgressCard({ phones, convByWaba }: {
  phones: MetaPhoneNumber[];
  convByWaba: Record<string, number[]>;
}) {
  // --- agrega WABAs únicas desta operação ---
  const seenWabas = new Set<string>();
  const daily7d = Array(7).fill(0) as number[];
  for (const p of phones) {
    if (p.wabaId && !seenWabas.has(p.wabaId)) {
      seenWabas.add(p.wabaId);
      const d = convByWaba[p.wabaId] ?? Array(7).fill(0);
      d.forEach((v: number, i: number) => { daily7d[i] += v; });
    }
  }

  // tier mais restritivo entre todos os números
  const tierKeys = phones.map(p => p.messagingLimitTier).filter(Boolean);
  const worstTierKey = tierKeys.reduce((worst, k) => {
    const wi = TIER_ORDER.indexOf(worst as any);
    const ki = TIER_ORDER.indexOf(k as any);
    return ki < wi ? k : worst;
  }, "UNLIMITED");

  const currentIdx = TIER_ORDER.indexOf(worstTierKey as any);
  const currentStep = TIER_STEPS[currentIdx] ?? TIER_STEPS[TIER_STEPS.length - 1];
  const isUnlimited = worstTierKey === "UNLIMITED";

  const total7d = daily7d.reduce((s: number, v: number) => s + v, 0);
  const peakDay = Math.max(...daily7d, 0);
  const threshold = isUnlimited ? 0 : currentStep.limit * 0.5;

  // elegibilidade para upgrade
  const worstQ = worstQuality(phones.map(p => p.qualityRating));
  const hasVolume = isUnlimited || peakDay >= threshold;
  const eligibility: "GREEN" | "YELLOW" | "RED" =
    worstQ === "RED" ? "RED" : hasVolume ? "GREEN" : "YELLOW";

  const eligibilityLabel: Record<string, string> = {
    GREEN:  "Elegível para upgrade automático",
    YELLOW: "Volume insuficiente para upgrade",
    RED:    "Bloqueado — qualidade baixa",
  };

  const progressPct = isUnlimited ? 100
    : threshold > 0 ? Math.min(100, (peakDay / threshold) * 100) : 0;

  const sharedCount = seenWabas.size > 1 ? phones.length : 0;
  const noData = total7d === 0;

  const eColor = P[eligibility];

  return (
    <div style={{
      background: P.elevated,
      border: `1px solid ${P.border}`,
      borderRadius: 8,
      padding: "14px 16px",
    }}>
      {/* cabeçalho */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: P.textSec }}>
          Limite de mensagens
        </p>
        <span className="text-[10px] px-2 py-0.5 rounded font-medium"
          style={{ background: eColor + "22", color: eColor, border: `1px solid ${eColor}44` }}>
          {eligibilityLabel[eligibility]}
        </span>
      </div>

      {/* limite atual em destaque */}
      <div className="flex items-end gap-2 mb-1">
        <span className="font-mono font-bold leading-none" style={{ fontSize: 28, color: P.textPri }}>
          {currentStep.label}
        </span>
        {!isUnlimited && (
          <span className="text-[11px] mb-0.5" style={{ color: P.textSec }}>
            conversas iniciadas pela empresa em 24h
          </span>
        )}
      </div>

      {/* régua de tiers */}
      <div className="flex items-center gap-0 my-3 relative">
        {/* linha de fundo */}
        <div style={{ position: "absolute", top: 5, left: 0, right: 0, height: 2, background: P.border, borderRadius: 1 }} />
        {TIER_STEPS.map((step, idx) => {
          const isCurrent = step.key === worstTierKey;
          const isPast = idx < currentIdx;
          const dotColor = isCurrent ? P.accent : isPast ? P.GREEN : P.border;
          return (
            <div key={step.key} className="flex-1 flex flex-col items-center gap-1 relative z-10">
              <div style={{
                width: isCurrent ? 12 : 8,
                height: isCurrent ? 12 : 8,
                borderRadius: "50%",
                background: dotColor,
                border: isCurrent ? `2px solid ${P.accent}` : undefined,
                boxShadow: isCurrent ? `0 0 8px ${P.accent}88` : undefined,
                transition: "all 0.2s",
              }} />
              {isCurrent && (
                <span className="absolute -top-5 text-[9px] font-semibold whitespace-nowrap px-1 rounded"
                  style={{ background: P.accent + "33", color: P.accent }}>
                  Atual
                </span>
              )}
              <span className="text-[9px] font-mono mt-1" style={{ color: isCurrent ? P.accent : isPast ? P.GREEN : P.textSec }}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* barra de progresso para próximo tier */}
      {!isUnlimited && (
        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between text-[10px]" style={{ color: P.textSec }}>
            <span>Pico diário: <span className="font-mono font-semibold" style={{ color: P.textPri }}>{peakDay.toLocaleString("pt-BR")}</span></span>
            <span>Meta p/ upgrade: <span className="font-mono font-semibold" style={{ color: P.textPri }}>{threshold.toLocaleString("pt-BR")}</span></span>
          </div>
          <div style={{ background: P.border, height: 5, borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              width: `${progressPct}%`,
              height: "100%",
              background: eColor,
              borderRadius: 3,
              transition: "width 0.4s ease",
            }} />
          </div>
        </div>
      )}

      {/* texto de apoio */}
      <p className="text-[11px] mt-3" style={{ color: P.textSec }}>
        {noData
          ? "Ainda não há dados suficientes dos últimos 7 dias."
          : <>Você iniciou <span className="font-mono font-semibold" style={{ color: P.textPri }}>{total7d.toLocaleString("pt-BR")}</span> conversas com clientes únicos nos últimos 7 dias</>
        }
      </p>

      {/* nota de limite compartilhado */}
      {sharedCount > 1 && (
        <p className="text-[10px] mt-1" style={{ color: P.textSec }}>
          Limite compartilhado entre {sharedCount} números desta operação.
        </p>
      )}
    </div>
  );
}

function PhoneStatusBadge({ s }: { s: MetaPhoneNumber["status"] }) {
  const map: Record<string, { color: string; label: string }> = {
    CONNECTED:  { color: P.GREEN,   label: "Conectado"  },
    FLAGGED:    { color: P.YELLOW,  label: "Sinalizado" },
    RESTRICTED: { color: P.RED,     label: "Restrito"   },
  };
  const { color, label } = map[s] ?? { color: P.UNKNOWN, label: s };
  return (
    <span className="text-[10px] px-1.5 rounded font-medium" style={{ color, background: color + "22", border: `1px solid ${color}44` }}>
      {label}
    </span>
  );
}

function TemplateStatusBadge({ s }: { s: MetaTemplate["status"] }) {
  const colorMap: Record<string, string> = {
    APPROVED: P.GREEN, REJECTED: P.RED, PENDING: P.YELLOW, PAUSED: P.YELLOW, DISABLED: P.UNKNOWN,
  };
  const c = colorMap[s] ?? P.UNKNOWN;
  return (
    <span className="text-[10px] px-1.5 rounded font-medium" style={{ color: c, background: c + "22", border: `1px solid ${c}44` }}>
      {META_TEMPLATE_STATUS_LABELS[s]}
    </span>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// CONFIG TAB
// ══════════════════════════════════════════════════════════════════════════
function ConfigTab({ operacoes, phones, wabas, onMutated }: {
  operacoes: MetaOperacao[];
  phones: MetaPhoneNumber[];
  wabas: MetaWaba[];
  onMutated: () => void;
}) {
  // ── Bearer token ─────────────────────────────────────────────────
  const { data: tokenStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/meta/global-token"],
    queryFn: () => apiRequest("GET", "/api/meta/global-token").then(r => r.json()),
  });
  const [bearerInput,   setBearerInput]   = useState("");
  const [showBearer,    setShowBearer]    = useState(false);
  const [tokenFeedback, setTokenFeedback] = useState<"ok" | "err" | null>(null);
  const [tokenErrMsg,   setTokenErrMsg]   = useState("");
  const qc = useQueryClient();

  const saveTokenMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/meta/global-token", { token: bearerInput.trim() });
      return r.json();
    },
    onSuccess: () => {
      setBearerInput("");
      setTokenFeedback("ok");
      setTokenErrMsg("");
      qc.invalidateQueries({ queryKey: ["/api/meta/global-token"] });
      onMutated();
      setTimeout(() => setTokenFeedback(null), 4000);
    },
    onError: (e: any) => {
      setTokenFeedback("err");
      setTokenErrMsg(e?.message || "Erro ao salvar token");
    },
  });

  // ── WABA lookup ──────────────────────────────────────────────────
  type RawPhone = { id: string; display_phone_number: string; verified_name: string; quality_rating: string; messaging_limit_tier: string; status: string };
  const [wabaInput,    setWabaInput]    = useState("");
  const [foundPhones,  setFoundPhones]  = useState<RawPhone[]>([]);
  const [lookupError,  setLookupError]  = useState<string | null>(null);
  const [selectedPhoneId, setSelectedPhoneId] = useState("");
  const [selectedOpId,    setSelectedOpId]    = useState("");

  const lookupMut = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/meta/lookup-waba", { wabaId: wabaInput.trim() }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Erro");
        return d as { phones: RawPhone[] };
      }),
    onSuccess: (data) => {
      setFoundPhones(data.phones);
      setLookupError(null);
      setSelectedPhoneId(data.phones[0]?.id ?? "");
    },
    onError: (e: any) => { setLookupError(e.message); setFoundPhones([]); },
  });

  const savePhoneMut = useMutation({
    mutationFn: () => {
      const p = foundPhones.find(x => x.id === selectedPhoneId);
      if (!p) throw new Error("Selecione um número");
      return apiRequest("POST", "/api/meta/phone-numbers", {
        phoneId: p.id,
        displayPhoneNumber: p.display_phone_number,
        verifiedName: p.verified_name,
        qualityRating: p.quality_rating,
        messagingLimitTier: p.messaging_limit_tier,
        status: p.status,
        wabaId: wabaInput.trim(),
        operacaoId: selectedOpId || undefined,
      }).then(r => r.json());
    },
    onSuccess: () => {
      setFoundPhones([]);
      setWabaInput("");
      setSelectedPhoneId("");
      setSelectedOpId("");
      onMutated();
    },
  });

  // ── Sincronizar templates ─────────────────────────────────────────
  const [tplResult, setTplResult] = useState<{ total: number; totalDisparos: number; results: { wabaId: string; operacao?: string; count: number; disparosTotal: number; error?: string }[] } | null>(null);
  const [tplErr, setTplErr] = useState<string | null>(null);
  const syncTplMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/meta/fetch-templates-all", {});
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Erro ao buscar templates");
      return d as { total: number; totalDisparos: number; results: { wabaId: string; operacao?: string; count: number; disparosTotal: number; error?: string }[] };
    },
    onSuccess: (d) => { setTplResult(d); setTplErr(null); onMutated(); },
    onError: (e: any) => { setTplErr(e.message); setTplResult(null); },
  });

  // ── Operações ────────────────────────────────────────────────────
  const [newOpNome, setNewOpNome] = useState("");
  const addOpMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/meta/operacoes", { nome: newOpNome }).then(r => r.json()),
    onSuccess: () => { setNewOpNome(""); onMutated(); },
  });
  const delOpMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/meta/operacoes/${id}`),
    onSuccess: onMutated,
  });

  // ── Canais disponíveis para vincular aos números ─────────────────
  const { data: canais = [] } = useQuery<DisparoCanal[]>({
    queryKey: ["/api/disparo-canais"],
    queryFn: () => apiRequest("GET", "/api/disparo-canais").then(r => r.json()),
  });

  // aplica patch parcial no cache de phones (chamado em onMutate para update imediato)
  const optimisticPatchPhone = (id: string, patch: Partial<MetaPhoneNumber>) => {
    qc.setQueryData<MetaPhoneNumber[]>(["/api/meta/phone-numbers"], (old = []) =>
      old.map(p => p.id === id ? { ...p, ...patch } : p)
    );
  };
  // aplica o objeto retornado pelo servidor (chamado em onSuccess para confirmar)
  const patchPhoneCache = (updated: MetaPhoneNumber) => {
    qc.setQueryData<MetaPhoneNumber[]>(["/api/meta/phone-numbers"], (old = []) =>
      old.map(p => p.id === updated.id ? updated : p)
    );
  };

  // ── Phone list mutations ─────────────────────────────────────────
  const assignPhoneMut = useMutation({
    mutationFn: ({ id, operacaoId }: { id: string; operacaoId: string | null }) =>
      apiRequest("PATCH", `/api/meta/phone-numbers/${id}/operacao`, { operacaoId }).then(r => r.json()),
    onMutate: ({ id, operacaoId }) => optimisticPatchPhone(id, { operacaoId: operacaoId ?? undefined }),
    onSuccess: (updated: MetaPhoneNumber) => { patchPhoneCache(updated); },
    onError: () => qc.invalidateQueries({ queryKey: ["/api/meta/phone-numbers"] }),
  });
  const assignCanalMut = useMutation({
    mutationFn: ({ id, canalId }: { id: string; canalId: string | null }) =>
      apiRequest("PATCH", `/api/meta/phone-numbers/${id}/canal`, { canalId }).then(r => r.json()),
    onMutate: ({ id, canalId }) => optimisticPatchPhone(id, { canalId: canalId ?? undefined }),
    onSuccess: (updated: MetaPhoneNumber) => { patchPhoneCache(updated); },
    onError: () => qc.invalidateQueries({ queryKey: ["/api/meta/phone-numbers"] }),
  });
  const delPhoneMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/meta/phone-numbers/${id}`),
    onSuccess: onMutated,
  });

  const label = "text-xs font-medium mb-1.5 block";
  const inp   = `w-full text-sm rounded px-3 py-2 outline-none focus:ring-1`;
  const iStyle = { background: P.elevated, border: `1px solid ${P.border}`, color: P.textPri };
  const isTokenOk = tokenStatus?.configured;

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-6">

      {/* ── 1. Bearer Token ─────────────────────────────────────────── */}
      <Section title="Bearer Token da Meta" icon={<Shield className="h-4 w-4" />}>
        <div className="flex items-start gap-3 mb-4 p-3 rounded"
          style={{ background: isTokenOk ? P.GREEN + "11" : P.YELLOW + "11",
                   border: `1px solid ${isTokenOk ? P.GREEN : P.YELLOW}33` }}>
          {isTokenOk
            ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" style={{ color: P.GREEN }} />
            : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: P.YELLOW }} />}
          <div className="text-xs leading-relaxed" style={{ color: P.textSec }}>
            {isTokenOk
              ? <><strong style={{ color: P.GREEN }}>Token configurado.</strong> Para substituir, insira um novo token abaixo.</>
              : <><strong style={{ color: P.YELLOW }}>Nenhum token configurado.</strong> Configure o Bearer Token da Graph API da Meta para poder buscar números.</>
            }
            <br />O token é armazenado <strong style={{ color: P.textPri }}>exclusivamente no servidor</strong> e nunca trafega de volta para o browser.
          </div>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input value={bearerInput} onChange={e => setBearerInput(e.target.value)}
              type={showBearer ? "text" : "password"}
              placeholder={isTokenOk ? "Insira um novo token para substituir…" : "EAAxxxxxxx…"}
              className={`${inp} pr-10 font-mono`} style={iStyle} />
            <button type="button" onClick={() => setShowBearer(p => !p)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100">
              {showBearer ? <EyeOff className="h-4 w-4" style={{ color: P.textSec }} /> : <Eye className="h-4 w-4" style={{ color: P.textSec }} />}
            </button>
          </div>
          <Btn onClick={() => saveTokenMut.mutate()} disabled={!bearerInput.trim() || saveTokenMut.isPending} accent>
            {saveTokenMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvar token
          </Btn>
        </div>
        {tokenFeedback === "ok" && (
          <p className="text-xs mt-2 flex items-center gap-1" style={{ color: P.GREEN }}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Token salvo com sucesso.
          </p>
        )}
        {tokenFeedback === "err" && (
          <p className="text-xs mt-2 flex items-center gap-1" style={{ color: P.RED }}>
            <AlertTriangle className="h-3.5 w-3.5" /> {tokenErrMsg}
          </p>
        )}
      </Section>

      {/* ── 2. Operações ───────────────────────────────────────────── */}
      <Section title="Operações" icon={<Building2 className="h-4 w-4" />}>
        <div className="flex gap-2 mb-4">
          <input value={newOpNome} onChange={e => setNewOpNome(e.target.value)}
            placeholder="Nome da operação"
            className={`${inp} flex-1`} style={iStyle}
            onKeyDown={e => { if (e.key === "Enter" && newOpNome.trim()) addOpMut.mutate(); }}
          />
          <Btn onClick={() => addOpMut.mutate()} disabled={!newOpNome.trim() || addOpMut.isPending} small accent>
            {addOpMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Adicionar
          </Btn>
        </div>
        {operacoes.length === 0
          ? <p className="text-xs" style={{ color: P.textSec }}>Nenhuma operação cadastrada.</p>
          : <div className="flex flex-wrap gap-2">
              {operacoes.map(op => (
                <div key={op.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
                  style={{ background: P.accent + "22", color: P.accent, border: `1px solid ${P.accent}44` }}>
                  {op.nome}
                  <button onClick={() => delOpMut.mutate(op.id)} className="hover:opacity-70">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
        }
      </Section>

      {/* ── 2b. WABAs — apelidos ───────────────────────────────────── */}
      <Section title="WABAs" icon={<Layers className="h-4 w-4" />}>
        <p className="text-xs mb-3 leading-relaxed" style={{ color: P.textSec }}>
          Cada WABA é registrado automaticamente quando você adiciona um número.
          Dê um nome a cada um para facilitar a identificação no painel.
        </p>
        {wabas.length === 0 ? (
          <p className="text-xs" style={{ color: P.textSec }}>
            Nenhum WABA cadastrado. Adicione um número abaixo para registrar o WABA automaticamente.
          </p>
        ) : (
          <div className="space-y-2">
            {wabas.map(w => (
              <WabaApelidoRow key={w.id} waba={w} phones={phones} onRenamed={onMutated} />
            ))}
          </div>
        )}
      </Section>

      {/* ── 3. Buscar e adicionar número ────────────────────────────── */}
      <Section title="Adicionar número ao painel" icon={<Phone className="h-4 w-4" />}>
        {/* Step 1 — lookup */}
        <div className="flex gap-2 mb-4">
          <div className="flex-1">
            <label className={label} style={{ color: P.textSec }}>WABA ID</label>
            <input value={wabaInput} onChange={e => { setWabaInput(e.target.value); setFoundPhones([]); setLookupError(null); }}
              placeholder="ex: 959113499101214140"
              className={`${inp} font-mono`} style={iStyle}
              onKeyDown={e => { if (e.key === "Enter" && wabaInput.trim() && isTokenOk) lookupMut.mutate(); }}
            />
          </div>
          <div className="flex items-end">
            <Btn onClick={() => lookupMut.mutate()}
              disabled={!wabaInput.trim() || !isTokenOk || lookupMut.isPending} accent>
              {lookupMut.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Buscando…</>
                : <><RefreshCw className="h-4 w-4" /> Buscar telefones</>}
            </Btn>
          </div>
        </div>

        {!isTokenOk && (
          <p className="text-xs mb-3 flex items-center gap-1.5" style={{ color: P.YELLOW }}>
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Configure o Bearer Token antes de buscar.
          </p>
        )}

        {lookupError && (
          <div className="mb-3 flex items-center gap-2 text-xs p-3 rounded"
            style={{ background: P.RED + "20", border: `1px solid ${P.RED}44`, color: P.RED }}>
            <AlertTriangle className="h-4 w-4 shrink-0" />{lookupError}
          </div>
        )}

        {/* Step 2 — select phone + operação */}
        {foundPhones.length > 0 && (
          <div style={{ background: P.elevated, border: `1px solid ${P.border}`, borderRadius: 8 }}
            className="p-4 space-y-3">
            <p className="text-xs font-semibold mb-1" style={{ color: P.GREEN }}>
              <CheckCircle2 className="h-3.5 w-3.5 inline mr-1" />
              {foundPhones.length} número{foundPhones.length > 1 ? "s" : ""} encontrado{foundPhones.length > 1 ? "s" : ""}
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={label} style={{ color: P.textSec }}>Selecionar número</label>
                <select value={selectedPhoneId} onChange={e => setSelectedPhoneId(e.target.value)}
                  className={`${inp} cursor-pointer`} style={iStyle}>
                  {foundPhones.map(p => (
                    <option key={p.id} value={p.id}>{p.display_phone_number} — {p.verified_name || p.id}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label} style={{ color: P.textSec }}>Operação</label>
                <select value={selectedOpId} onChange={e => setSelectedOpId(e.target.value)}
                  className={`${inp} cursor-pointer`} style={iStyle}>
                  <option value="">Sem operação</option>
                  {operacoes.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Btn onClick={() => savePhoneMut.mutate()} disabled={!selectedPhoneId || savePhoneMut.isPending} accent>
                {savePhoneMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Adicionar ao painel
              </Btn>
              {savePhoneMut.isError && (
                <p className="text-xs" style={{ color: P.RED }}>{(savePhoneMut.error as any)?.message}</p>
              )}
            </div>
          </div>
        )}

        {/* Saved phones list */}
        {phones.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium mb-3" style={{ color: P.textSec }}>
              Números no painel ({phones.length})
            </p>
            <PhoneTable
              phones={phones}
              operacoes={operacoes}
              canais={canais}
              onAssign={(id, opId) => assignPhoneMut.mutate({ id, operacaoId: opId })}
              onAssignCanal={(id, canalId) => assignCanalMut.mutate({ id, canalId })}
              onDelete={id => delPhoneMut.mutate(id)}
            />
          </div>
        )}
        {phones.length === 0 && foundPhones.length === 0 && !lookupMut.isPending && (
          <p className="text-xs mt-3" style={{ color: P.textSec }}>
            Nenhum número adicionado. Insira um WABA ID e clique em "Buscar telefones".
          </p>
        )}
      </Section>

      {/* ── 4. Templates ────────────────────────────────────────────── */}
      <Section title="Templates" icon={<FileText className="h-4 w-4" />}>
        <p className="text-xs mb-4 leading-relaxed" style={{ color: P.textSec }}>
          Busca todos os templates de cada WABA dos números já cadastrados no painel.
          Os templates ficam disponíveis na aba <strong style={{ color: P.textPri }}>Painel</strong> vinculados à operação correspondente.
        </p>

        <div className="flex items-center gap-3 flex-wrap">
          <Btn
            onClick={() => { setTplResult(null); setTplErr(null); syncTplMut.mutate(); }}
            disabled={!isTokenOk || phones.length === 0 || syncTplMut.isPending}
            accent
          >
            {syncTplMut.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Buscando templates…</>
              : <><RefreshCw className="h-4 w-4" /> Sincronizar templates</>}
          </Btn>
          {!isTokenOk && (
            <span className="text-xs flex items-center gap-1" style={{ color: P.YELLOW }}>
              <AlertTriangle className="h-3.5 w-3.5" /> Configure o token primeiro
            </span>
          )}
          {phones.length === 0 && isTokenOk && (
            <span className="text-xs" style={{ color: P.textSec }}>
              Adicione ao menos um número antes de sincronizar
            </span>
          )}
        </div>

        {tplErr && (
          <div className="mt-3 flex items-start gap-2 text-xs p-3 rounded"
            style={{ background: P.RED + "20", border: `1px solid ${P.RED}44`, color: P.RED }}>
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{tplErr}</span>
          </div>
        )}

        {tplResult && (
          <div className="mt-3 space-y-2">
            <p className="text-xs font-semibold flex items-center gap-1.5" style={{ color: P.GREEN }}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              {tplResult.total} template{tplResult.total !== 1 ? "s" : ""} sincronizado{tplResult.total !== 1 ? "s" : ""} · {tplResult.totalDisparos.toLocaleString("pt-BR")} disparos (7d)
            </p>
            <div className="space-y-1">
              {tplResult.results.map(r => (
                <div key={r.wabaId} className="flex items-center gap-2 text-xs px-3 py-2 rounded"
                  style={{ background: P.elevated, border: `1px solid ${r.error ? P.RED + "44" : P.border}` }}>
                  <span className="font-mono text-[10px] flex-1 truncate" style={{ color: P.textSec }}>
                    WABA {r.wabaId}
                  </span>
                  {r.error ? (
                    <span style={{ color: P.RED }}>{r.error}</span>
                  ) : (
                    <span className="flex gap-3">
                      <span style={{ color: P.textSec }}>{r.count} templates</span>
                      <span style={{ color: P.accent }} className="font-mono font-semibold">
                        {r.disparosTotal.toLocaleString("pt-BR")} disparos
                      </span>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

// ── WabaApelidoRow: linha editável de apelido de WABA na aba Config ─────────
function WabaApelidoRow({ waba, phones, onRenamed }: {
  waba: MetaWaba;
  phones: MetaPhoneNumber[];
  onRenamed: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(waba.apelido === waba.wabaId ? "" : (waba.apelido ?? ""));
  const qc = useQueryClient();
  const linked = phones.filter(p => p.wabaId === waba.wabaId).length;
  const shortId = waba.wabaId.length > 18 ? `${waba.wabaId.slice(0, 8)}…${waba.wabaId.slice(-6)}` : waba.wabaId;

  const renameMut = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/meta/wabas/${waba.id}/apelido`, { apelido: draft.trim() || waba.wabaId }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/meta/wabas"] });
      setEditing(false);
      onRenamed();
    },
  });

  const iStyle = { background: "#131B2E", border: `1px solid ${P.border}`, color: P.textPri };

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded text-xs"
      style={{ background: P.elevated, border: `1px solid ${P.border}` }}>
      {/* WABA ID */}
      <span className="font-mono text-[10px] shrink-0 w-36 truncate" style={{ color: P.textSec }}
        title={waba.wabaId}>{shortId}</span>

      {/* nome / input */}
      {editing ? (
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={waba.wabaId}
          className="flex-1 text-xs rounded px-2 py-1 outline-none focus:ring-1 font-medium"
          style={iStyle}
          autoFocus
          onKeyDown={e => {
            if (e.key === "Enter") renameMut.mutate();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <span className="flex-1 font-medium" style={{ color: waba.apelido && waba.apelido !== waba.wabaId ? P.textPri : P.textSec }}>
          {waba.apelido && waba.apelido !== waba.wabaId ? waba.apelido : <em>Sem nome</em>}
        </span>
      )}

      {/* números vinculados */}
      <span className="shrink-0 text-[10px]" style={{ color: P.textSec }}>{linked}n</span>

      {/* ações */}
      {editing ? (
        <div className="flex gap-1 shrink-0">
          <button onClick={() => renameMut.mutate()} disabled={renameMut.isPending}
            className="p-1 rounded hover:opacity-80" style={{ color: P.GREEN, background: P.GREEN + "22" }}
            title="Salvar">
            {renameMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          </button>
          <button onClick={() => setEditing(false)}
            className="p-1 rounded hover:opacity-80" style={{ color: P.textSec, background: P.border + "44" }}
            title="Cancelar">
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button onClick={() => { setDraft(waba.apelido && waba.apelido !== waba.wabaId ? waba.apelido : ""); setEditing(true); }}
          className="shrink-0 p-1 rounded hover:opacity-80" style={{ color: P.accent, background: P.accent + "22" }}
          title="Renomear">
          <Pencil className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ── PhoneTable ──────────────────────────────────────────────────────────────
function PhoneTable({ phones, operacoes, canais, onAssign, onAssignCanal, onDelete }: {
  phones: MetaPhoneNumber[];
  operacoes: MetaOperacao[];
  canais: DisparoCanal[];
  onAssign: (id: string, opId: string | null) => void;
  onAssignCanal: (id: string, canalId: string | null) => void;
  onDelete: (id: string) => void;
}) {
  if (phones.length === 0) return <p className="text-xs" style={{ color: P.textSec }}>Nenhum número.</p>;

  const selectStyle = { background: P.elevated, border: `1px solid ${P.border}`, color: P.textPri };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: `1px solid ${P.border}` }}>
            {["Qualidade","Telefone","Nome verificado","Status","Tier","Operação","Canal",""].map(h => (
              <th key={h} className="pb-2 pr-3 text-left font-medium" style={{ color: P.textSec }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {phones.map(p => (
            <tr key={p.id} style={{ borderBottom: `1px solid ${P.border}20` }}>
              <td className="py-2 pr-3"><QBadge q={p.qualityRating} small /></td>
              <td className="py-2 pr-3 font-mono whitespace-nowrap" style={{ color: P.textPri }}>{p.displayPhoneNumber}</td>
              <td className="py-2 pr-3" style={{ color: P.textSec }}>{p.verifiedName || <span className="italic">—</span>}</td>
              <td className="py-2 pr-3"><PhoneStatusBadge s={p.status} /></td>
              <td className="py-2 pr-3 font-mono" style={{ color: P.textSec }}>{p.messagingLimitTier || "—"}</td>
              <td className="py-2 pr-3">
                <select
                  value={p.operacaoId ?? ""}
                  onChange={e => onAssign(p.id, e.target.value || null)}
                  className="text-xs rounded px-2 py-1 outline-none"
                  style={selectStyle}
                >
                  <option value="">Sem operação</option>
                  {operacoes.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
                </select>
              </td>
              <td className="py-2 pr-3">
                <select
                  value={p.canalId ?? ""}
                  onChange={e => onAssignCanal(p.id, e.target.value || null)}
                  className="text-xs rounded px-2 py-1 outline-none"
                  style={{
                    ...selectStyle,
                    ...(p.canalId ? { borderColor: P.accent + "88", color: P.accent } : {}),
                  }}
                >
                  <option value="">— canal —</option>
                  {canais.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </td>
              <td className="py-2">
                <button onClick={() => onDelete(p.id)} className="hover:opacity-70">
                  <Trash2 className="h-3.5 w-3.5" style={{ color: P.textSec }} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Reusable helpers ────────────────────────────────────────────────────────
function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: P.surface, border: `1px solid ${P.border}`, borderRadius: 10 }} className="p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold mb-4" style={{ color: P.textPri }}>
        <span style={{ color: P.accent }}>{icon}</span>
        {title}
      </h2>
      {children}
    </div>
  );
}

function Btn({ children, onClick, disabled, accent, danger, small }: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  accent?: boolean;
  danger?: boolean;
  small?: boolean;
}) {
  const bg = danger ? P.RED + "22" : accent ? P.accent : P.elevated;
  const col = danger ? P.RED : accent ? "#FFFFFF" : P.textSec;
  const border = danger ? P.RED + "44" : accent ? P.accent : P.border;
  const sz = small ? "text-xs px-2.5 py-1.5" : "text-sm px-3 py-2";
  return (
    <button onClick={onClick} disabled={disabled}
      className={`${sz} rounded flex items-center gap-1.5 font-medium transition-opacity disabled:opacity-40`}
      style={{ background: bg, color: col, border: `1px solid ${border}` }}>
      {children}
    </button>
  );
}

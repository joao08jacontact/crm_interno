import { useState, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2,
  X, ArrowRight, RefreshCw,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

// ── table schema ─────────────────────────────────────────────────────────────
export const TABLE_COLS = [
  { key: "cpf",                label: "CPF",                   required: true,  hint: "11 dígitos" },
  { key: "telefone",           label: "Telefone",              required: true,  hint: "55+DDD+9+número" },
  { key: "nome",               label: "Nome",                  required: true,  hint: "Nome completo" },
  { key: "unidade",            label: "Unidade",               required: true,  hint: "" },
  { key: "canal_origem",       label: "Canal de Origem",       required: true,  hint: "" },
  { key: "curso",              label: "Curso",                 required: true,  hint: "Curso de interesse" },
  { key: "modalidade",         label: "Modalidade",            required: true,  hint: "" },
  { key: "nivel_escolaridade", label: "Nível de Escolaridade", required: true,  hint: "" },
  { key: "origem",             label: "Origem",                required: true,  hint: "" },
  { key: "disparo_realizado",  label: "Disparo Realizado",     required: true,  hint: "0 ou 1" },
] as const;

type ColKey = (typeof TABLE_COLS)[number]["key"];

// ── normalizers ───────────────────────────────────────────────────────────────
function normalizeCpf(raw: unknown): string {
  const s = String(raw ?? "").replace(/\D/g, "");
  if (!s) return "";
  return s.padStart(11, "0").slice(-11);
}

function normalizePhone(raw: unknown): string {
  let s = String(raw ?? "").replace(/\D/g, "");
  if (!s) return "";
  if (s.startsWith("55") && s.length > 11) s = s.slice(2); // remove country code
  if (s.startsWith("0")) s = s.slice(1);                   // remove leading 0
  if (s.length === 10) s = s.slice(0, 2) + "9" + s.slice(2); // add 9 after DDD
  return "55" + s;
}

function normalizeDisparo(raw: unknown): number {
  const s = String(raw ?? "").toLowerCase().trim();
  return (s === "1" || s === "true" || s === "sim" || s === "yes") ? 1 : 0;
}

function normalize(key: ColKey, value: unknown): string | number {
  if (key === "cpf")               return normalizeCpf(value);
  if (key === "telefone")          return normalizePhone(value);
  if (key === "disparo_realizado") return normalizeDisparo(value);
  return String(value ?? "").trim();
}

// ── validation helpers ────────────────────────────────────────────────────────
function isValidCpf(v: string) { return v.length === 11 && /^\d+$/.test(v); }
function isValidPhone(v: string) { return v.length >= 12 && v.length <= 13 && v.startsWith("55"); }

// ── types ─────────────────────────────────────────────────────────────────────
type Mapping = Partial<Record<ColKey, string>>; // tableCol → excelHeader
type NormalizedRow = Partial<Record<ColKey, string | number>>;
type RowStatus = "ok" | "warn" | "error";

interface ParsedRow {
  original:   Record<string, unknown>;
  normalized: NormalizedRow;
  status:     RowStatus;
  issues:     string[];
}

// ── steps ─────────────────────────────────────────────────────────────────────
type Step = "upload" | "map" | "preview" | "done";

// ══════════════════════════════════════════════════════════════════════════════
export function UploadBaseCognaDialog({
  open, onClose,
}: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();

  // step state
  const [step, setStep] = useState<Step>("upload");

  // file / excel state
  const [fileName, setFileName]         = useState("");
  const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows]           = useState<Record<string, unknown>[]>([]);

  // mapping state
  const [mapping, setMapping] = useState<Mapping>({});
  // valores fixos: quando mapping[col] === "__fixed__", usa esse valor para todas as linhas
  const [fixedValues, setFixedValues] = useState<Partial<Record<ColKey, string>>>({});

  // parsed state
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);

  // upload progress
  const [uploading, setUploading]   = useState(false);
  const [progress, setProgress]     = useState(0);
  const [uploadResult, setUploadResult] = useState<{ inserted: number; errors: number } | null>(null);
  const [uploadError, setUploadError]   = useState<string | null>(null);

  const dropRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── reset ──────────────────────────────────────────────────────────────────
  function reset() {
    setStep("upload"); setFileName(""); setExcelHeaders([]); setRawRows([]);
    setMapping({}); setFixedValues({}); setParsedRows([]); setUploading(false); setProgress(0);
    setUploadResult(null); setUploadError(null);
  }

  function handleClose() { reset(); onClose(); }

  // ── parse Excel ────────────────────────────────────────────────────────────
  const parseFile = useCallback((file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      toast({ title: "Formato inválido", description: "Use um arquivo .xlsx ou .xls", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb   = XLSX.read(data, { type: "array", cellDates: true });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
          defval: "", raw: false,
        });
        if (!rows.length) {
          toast({ title: "Planilha vazia", description: "Nenhuma linha encontrada", variant: "destructive" });
          return;
        }
        const headers = Object.keys(rows[0]);
        setFileName(file.name);
        setExcelHeaders(headers);
        setRawRows(rows);
        // auto-map by similarity
        const auto: Mapping = {};
        for (const col of TABLE_COLS) {
          const match = headers.find(h => {
            const n = h.toLowerCase().replace(/\s+/g, "_");
            return n === col.key || n.includes(col.key) || col.key.includes(n);
          });
          if (match) (auto as any)[col.key] = match;
        }
        setMapping(auto);
        setStep("map");
      } catch (err: any) {
        toast({ title: "Erro ao ler arquivo", description: err.message, variant: "destructive" });
      }
    };
    reader.readAsArrayBuffer(file);
  }, [toast]);

  // ── drag & drop ────────────────────────────────────────────────────────────
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }, [parseFile]);

  // ── helpers: resolve o valor de uma coluna para uma linha ─────────────────
  function resolveValue(colKey: ColKey, raw: Record<string, unknown>): unknown {
    const src = (mapping as any)[colKey];
    if (!src) return undefined;
    if (src === "__fixed__") return (fixedValues as any)[colKey] ?? "";
    return raw[src];
  }

  function isMapped(colKey: ColKey): boolean {
    const src = (mapping as any)[colKey];
    if (!src) return false;
    if (src === "__fixed__") return !!((fixedValues as any)[colKey]?.trim());
    return true;
  }

  // ── apply mapping → parse rows ─────────────────────────────────────────────
  function applyMapping() {
    const result: ParsedRow[] = rawRows.map((raw) => {
      const normalized: NormalizedRow = {};
      const issues: string[] = [];

      for (const col of TABLE_COLS) {
        if (!isMapped(col.key)) continue;
        const val = normalize(col.key, resolveValue(col.key, raw));
        (normalized as any)[col.key] = val;

        if (col.key === "cpf" && !isValidCpf(val as string))
          issues.push("CPF inválido");
        if (col.key === "telefone" && !isValidPhone(val as string))
          issues.push("Telefone inválido");
      }

      const missingReq = TABLE_COLS.filter(c => c.required && !isMapped(c.key));
      if (missingReq.length) issues.push(...missingReq.map(c => `${c.label} não mapeado`));

      const status: RowStatus =
        issues.some(i => i.includes("não mapeado")) ? "error" :
        issues.length > 0 ? "warn" : "ok";

      return { original: raw, normalized, status, issues };
    });
    setParsedRows(result);
    setStep("preview");
  }

  // ── upload ─────────────────────────────────────────────────────────────────
  async function handleUpload() {
    const validRows = parsedRows.filter(r => r.status !== "error");
    if (!validRows.length) return;

    setUploading(true);
    setProgress(0);
    setUploadError(null);

    // batch into chunks of 500
    const CHUNK = 500;
    const chunks: NormalizedRow[][] = [];
    for (let i = 0; i < validRows.length; i += CHUNK)
      chunks.push(validRows.slice(i, i + CHUNK).map(r => r.normalized));

    let inserted = 0;
    let errors   = 0;

    try {
      for (let i = 0; i < chunks.length; i++) {
        const r = await apiRequest("POST", "/api/cogna/upload-base", { rows: chunks[i] });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Erro no servidor");
        inserted += d.inserted ?? 0;
        errors   += d.errors ?? 0;
        setProgress(Math.round(((i + 1) / chunks.length) * 100));
      }
      setUploadResult({ inserted, errors });
      setStep("done");
    } catch (err: any) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  // ── counts ─────────────────────────────────────────────────────────────────
  const okCount   = parsedRows.filter(r => r.status === "ok").length;
  const warnCount = parsedRows.filter(r => r.status === "warn").length;
  const errCount  = parsedRows.filter(r => r.status === "error").length;
  const uploadable = okCount + warnCount;

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 pt-5 pb-0 shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Subir base — COGNA_BRONZE
            </DialogTitle>
            <button onClick={handleClose} className="rounded-sm opacity-70 hover:opacity-100 transition-opacity">
              <X className="h-4 w-4" />
            </button>
          </div>
          {/* step indicator */}
          <div className="flex items-center gap-1 mt-4 mb-1">
            {(["upload","map","preview","done"] as Step[]).map((s, i) => {
              const labels = ["1. Arquivo","2. Mapeamento","3. Revisão","4. Concluído"];
              const active = step === s;
              const done   = (["upload","map","preview","done"] as Step[]).indexOf(step) > i;
              return (
                <div key={s} className="flex items-center gap-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors
                    ${active ? "bg-primary text-primary-foreground" :
                      done   ? "bg-primary/20 text-primary" :
                               "bg-muted text-muted-foreground"}`}>
                    {labels[i]}
                  </span>
                  {i < 3 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                </div>
              );
            })}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {/* ── STEP 1: UPLOAD ───────────────────────────────────────────── */}
          {step === "upload" && (
            <div
              ref={dropRef}
              onDrop={onDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => inputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-border hover:border-primary/60 transition-colors cursor-pointer py-16 bg-muted/20"
            >
              <div className="rounded-full bg-primary/10 p-5">
                <Upload className="h-10 w-10 text-primary" />
              </div>
              <div className="text-center space-y-1">
                <p className="font-semibold text-base">Arraste o arquivo ou clique para selecionar</p>
                <p className="text-sm text-muted-foreground">Suporte: .xlsx · .xls</p>
              </div>
              <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f); }} />
            </div>
          )}

          {/* ── STEP 2: MAP ──────────────────────────────────────────────── */}
          {step === "map" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 text-sm">
                <FileSpreadsheet className="h-4 w-4 text-primary shrink-0" />
                <span className="font-medium truncate">{fileName}</span>
                <span className="text-muted-foreground ml-auto shrink-0">
                  {rawRows.length.toLocaleString("pt-BR")} linhas
                </span>
                <button onClick={reset} className="text-muted-foreground hover:text-foreground ml-2">
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-44">Coluna da tabela</TableHead>
                      <TableHead className="w-20 text-center">Obrigatório</TableHead>
                      <TableHead>Coluna da planilha</TableHead>
                      <TableHead className="w-40 text-muted-foreground text-xs">Formato esperado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {TABLE_COLS.map(col => {
                      const src = (mapping as any)[col.key];
                      const isFixed = src === "__fixed__";
                      return (
                        <TableRow key={col.key}>
                          <TableCell className="font-mono text-sm font-medium">{col.key}</TableCell>
                          <TableCell className="text-center">
                            {col.required
                              ? <Badge variant="destructive" className="text-[10px] px-1.5 py-0">sim</Badge>
                              : <span className="text-xs text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1.5">
                              <Select
                                value={src ?? "__none__"}
                                onValueChange={v => setMapping(prev => ({
                                  ...prev,
                                  [col.key]: v === "__none__" ? undefined : v,
                                }))}
                              >
                                <SelectTrigger className="h-8 text-sm">
                                  <SelectValue placeholder="— não mapear —" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">— não mapear —</SelectItem>
                                  <SelectItem value="__fixed__">✏️ Digitar valor fixo…</SelectItem>
                                  {excelHeaders.map(h => (
                                    <SelectItem key={h} value={h}>{h}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {isFixed && (
                                <input
                                  autoFocus
                                  className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                                  placeholder={`Valor fixo para todos (ex: ${col.hint || col.label})`}
                                  value={(fixedValues as any)[col.key] ?? ""}
                                  onChange={e => setFixedValues(prev => ({
                                    ...prev,
                                    [col.key]: e.target.value,
                                  }))}
                                />
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{col.hint}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* preview of first 3 raw rows for the mapped columns */}
              {Object.keys(mapping).length > 0 && (
                <div className="rounded-lg border overflow-hidden">
                  <p className="text-xs font-medium px-3 py-2 bg-muted/50 border-b text-muted-foreground uppercase tracking-wide">
                    Amostra (3 linhas)
                  </p>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {TABLE_COLS.filter(c => (mapping as any)[c.key]).map(c => (
                            <TableHead key={c.key} className="text-xs">{c.label}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rawRows.slice(0, 3).map((row, i) => (
                          <TableRow key={i}>
                            {TABLE_COLS.filter(c => (mapping as any)[c.key]).map(c => (
                              <TableCell key={c.key} className="text-xs font-mono max-w-[140px] truncate">
                                {String(normalize(c.key, row[(mapping as any)[c.key]]) ?? "")}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: PREVIEW ──────────────────────────────────────────── */}
          {step === "preview" && (
            <div className="space-y-4">
              {/* summary pills */}
              <div className="flex flex-wrap gap-2">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-sm font-medium">
                  <FileSpreadsheet className="h-4 w-4" /> {rawRows.length.toLocaleString("pt-BR")} linhas lidas
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 text-sm font-medium">
                  <CheckCircle2 className="h-4 w-4" /> {okCount.toLocaleString("pt-BR")} ok
                </div>
                {warnCount > 0 && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-sm font-medium">
                    <AlertCircle className="h-4 w-4" /> {warnCount.toLocaleString("pt-BR")} com avisos
                  </div>
                )}
                {errCount > 0 && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 text-sm font-medium">
                    <AlertCircle className="h-4 w-4" /> {errCount.toLocaleString("pt-BR")} erros (ignorados)
                  </div>
                )}
              </div>

              {/* table preview */}
              <div className="rounded-lg border overflow-hidden">
                <p className="text-xs font-medium px-3 py-2 bg-muted/50 border-b text-muted-foreground uppercase tracking-wide">
                  Primeiras 10 linhas — dados normalizados
                </p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8 text-xs">#</TableHead>
                        {TABLE_COLS.filter(c => (mapping as any)[c.key]).map(c => (
                          <TableHead key={c.key} className="text-xs">{c.label}</TableHead>
                        ))}
                        <TableHead className="text-xs">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedRows.slice(0, 10).map((row, i) => (
                        <TableRow key={i} className={
                          row.status === "error" ? "bg-red-500/5" :
                          row.status === "warn"  ? "bg-amber-500/5" : ""
                        }>
                          <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                          {TABLE_COLS.filter(c => (mapping as any)[c.key]).map(c => (
                            <TableCell key={c.key} className="text-xs font-mono max-w-[130px]">
                              <span className="truncate block">
                                {String((row.normalized as any)[c.key] ?? "")}
                              </span>
                            </TableCell>
                          ))}
                          <TableCell>
                            {row.status === "ok" && (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                            )}
                            {row.status === "warn" && (
                              <span className="text-[10px] text-amber-600 dark:text-amber-400">
                                {row.issues.join(", ")}
                              </span>
                            )}
                            {row.status === "error" && (
                              <span className="text-[10px] text-red-500">{row.issues.join(", ")}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {parsedRows.length > 10 && (
                  <p className="text-xs text-muted-foreground px-3 py-2 border-t">
                    + {(parsedRows.length - 10).toLocaleString("pt-BR")} linhas adicionais
                  </p>
                )}
              </div>

              {/* progress bar while uploading */}
              {uploading && (
                <div className="space-y-1.5">
                  <Progress value={progress} className="h-2" />
                  <p className="text-xs text-muted-foreground text-center">
                    Enviando… {progress}%
                  </p>
                </div>
              )}

              {uploadError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-600 dark:text-red-400">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  {uploadError}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 4: DONE ─────────────────────────────────────────────── */}
          {step === "done" && uploadResult && (
            <div className="flex flex-col items-center justify-center gap-5 py-10">
              <div className="rounded-full bg-green-500/10 p-6">
                <CheckCircle2 className="h-12 w-12 text-green-500" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-xl font-bold">Base enviada com sucesso!</p>
                <p className="text-muted-foreground text-sm">
                  <span className="text-green-600 dark:text-green-400 font-semibold">
                    {uploadResult.inserted.toLocaleString("pt-BR")} registros
                  </span>{" "}
                  inseridos em{" "}
                  <span className="font-mono font-medium">COGNA_BRONZE.disparo_interno_cogna</span>
                </p>
                {uploadResult.errors > 0 && (
                  <p className="text-amber-600 dark:text-amber-400 text-sm">
                    {uploadResult.errors.toLocaleString("pt-BR")} linhas ignoradas por erro
                  </p>
                )}
              </div>
              <Button variant="outline" onClick={reset}>
                <Upload className="h-4 w-4 mr-2" /> Subir outra base
              </Button>
            </div>
          )}
        </div>

        {/* ── footer actions ────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t bg-background shrink-0 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {step === "map"     && `${rawRows.length.toLocaleString("pt-BR")} linhas detectadas`}
            {step === "preview" && `${uploadable.toLocaleString("pt-BR")} de ${rawRows.length.toLocaleString("pt-BR")} linhas serão enviadas`}
          </div>
          <div className="flex gap-2">
            {step === "map" && (
              <>
                <Button variant="outline" size="sm" onClick={reset}>Trocar arquivo</Button>
                <Button size="sm" onClick={applyMapping}
                  disabled={!TABLE_COLS.filter(c => c.required).every(c => !!(mapping as any)[c.key])}>
                  Revisar dados <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </>
            )}
            {step === "preview" && (
              <>
                <Button variant="outline" size="sm" onClick={() => setStep("map")} disabled={uploading}>
                  Voltar
                </Button>
                <Button size="sm" onClick={handleUpload}
                  disabled={uploading || uploadable === 0}>
                  {uploading
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando…</>
                    : <><Upload className="h-4 w-4 mr-2" /> Subir {uploadable.toLocaleString("pt-BR")} registros</>}
                </Button>
              </>
            )}
            {step === "done" && (
              <Button size="sm" onClick={handleClose}>Fechar</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

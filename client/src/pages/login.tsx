import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Lock, LogIn, Loader2, LayoutDashboard, Ticket, BarChart2, ListTodo, FolderKanban, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import logoInova from "@assets/logo-inova.png";
// logo-inova.png is in attached_assets/ (resolved by @assets alias)

const features = [
  { icon: ListTodo, label: "Esteira de Demandas", desc: "Agendamento e controle de tarefas recorrentes" },
  { icon: Ticket, label: "Chamados GLPI", desc: "Monitoramento de tickets em tempo real" },
  { icon: BarChart2, label: "Power BI", desc: "Status de refresh de datasets e dashboards" },
  { icon: FolderKanban, label: "Projetos", desc: "Acompanhamento de etapas e progresso" },
  { icon: Database, label: "Banco de Dados", desc: "Views materializadas e configurações" },
  { icon: LayoutDashboard, label: "Automações", desc: "Scripts Python e robôs RPA agendados" },
];

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { login } = useAuth();

  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");

  const loginMutation = useMutation({
    mutationFn: async ({ nome, senha }: { nome: string; senha: string }) => {
      const response = await apiRequest("POST", "/api/analistas/login", { nome, senha });
      return response.json();
    },
    onSuccess: (data) => {
      login(data);
      toast({ title: "Login realizado!", description: `Bem-vindo(a), ${data.nome}!` });
      setLocation("/kanban-glpi");
    },
    onError: () => {
      toast({ title: "Erro no login", description: "Nome ou senha incorretos", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome || !senha) {
      toast({ title: "Campos obrigatórios", description: "Digite seu nome e senha", variant: "destructive" });
      return;
    }
    loginMutation.mutate({ nome, senha });
  };

  return (
    <div className="min-h-screen flex">
      {/* ── Left panel ── */}
      <div
        className="hidden lg:flex flex-col flex-1 relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #0a0f1e 0%, #0d1b3e 50%, #0a1628 100%)" }}
      >
        {/* subtle grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: "linear-gradient(#4a9eff 1px, transparent 1px), linear-gradient(90deg, #4a9eff 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        {/* glow blobs */}
        <div className="absolute top-1/4 left-1/4 w-72 h-72 rounded-full opacity-10 blur-3xl" style={{ background: "#2563eb" }} />
        <div className="absolute bottom-1/4 right-1/4 w-48 h-48 rounded-full opacity-8 blur-2xl" style={{ background: "#7c3aed" }} />

        <div className="relative z-10 flex flex-col h-full px-14 py-12">
          {/* Logo */}
          <div className="flex items-center gap-4 mb-auto">
            <img src={logoInova} alt="Inova Análise" className="h-28 w-28 object-contain" />
            <div>
              <p className="text-white font-bold text-xl tracking-wide leading-tight">INOVA</p>
              <p className="text-blue-400 text-xs tracking-[0.2em] uppercase font-medium">Análise</p>
            </div>
          </div>

          {/* Headline */}
          <div className="my-auto">
            <p className="text-blue-400 text-xs tracking-[0.25em] uppercase font-semibold mb-4">
              Plataforma Interna de Operações
            </p>
            <h1 className="text-white font-bold leading-[1.15]" style={{ fontSize: "clamp(2rem, 3.5vw, 3rem)" }}>
              Gestão Equipe
            </h1>
            <h1 className="font-bold leading-[1.15] mb-6" style={{ fontSize: "clamp(2rem, 3.5vw, 3rem)", color: "#60a5fa" }}>
              de Dados
            </h1>
            <p className="text-slate-400 text-base max-w-sm leading-relaxed">
              Centralize chamados, tarefas, automações, projetos e dashboards em um único painel.
            </p>
          </div>

          {/* Feature grid */}
          <div className="grid grid-cols-2 gap-3 mb-8">
            {features.map(({ icon: Icon, label, desc }) => (
              <div
                key={label}
                className="flex items-start gap-3 p-3 rounded-xl border border-white/5 bg-white/[0.03] backdrop-blur-sm"
              >
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 border border-blue-500/20">
                  <Icon className="h-3.5 w-3.5 text-blue-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-white text-xs font-semibold leading-tight">{label}</p>
                  <p className="text-slate-500 text-[10px] leading-snug mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right panel (login form) ── */}
      <div className="flex flex-col w-full lg:w-[440px] shrink-0 bg-white dark:bg-slate-950 relative">
        {/* top accent bar */}
        <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, #2563eb, #7c3aed, #06b6d4)" }} />

        <div className="flex flex-col flex-1 items-center justify-center px-10 py-12">
          {/* mobile logo */}
          <div className="flex lg:hidden flex-col items-center mb-8 gap-2">
            <div className="h-12 w-12 rounded-xl bg-slate-900 flex items-center justify-center">
              <img src={logoInova} alt="Inova" className="h-10 w-10 object-contain" />
            </div>
            <p className="text-slate-700 dark:text-slate-300 font-bold text-lg">Gestão Equipe de Dados</p>
          </div>

          <div className="w-full max-w-sm">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Bem-vindo</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-8">
              Entre com suas credenciais para acessar
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="nome" className="text-slate-700 dark:text-slate-300 text-sm font-medium">
                  Login
                </Label>
                <Input
                  id="nome"
                  type="text"
                  placeholder="Nome do analista"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className="h-11 border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 focus-visible:ring-blue-500 text-slate-900 dark:text-white placeholder:text-slate-400"
                  data-testid="input-nome"
                  autoComplete="username"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="senha" className="text-slate-700 dark:text-slate-300 text-sm font-medium">
                  Senha
                </Label>
                <div className="relative">
                  <Input
                    id="senha"
                    type="password"
                    placeholder="••••••••"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    className="h-11 pr-10 border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 focus-visible:ring-blue-500 text-slate-900 dark:text-white placeholder:text-slate-400"
                    data-testid="input-senha"
                    autoComplete="current-password"
                  />
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-11 text-sm font-semibold mt-2"
                style={{ background: "linear-gradient(90deg, #2563eb, #1d4ed8)", boxShadow: "0 4px 14px rgba(37,99,235,0.35)" }}
                disabled={loginMutation.isPending || !nome || !senha}
                data-testid="button-login"
              >
                {loginMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <LogIn className="h-4 w-4 mr-2" />
                )}
                Entrar
              </Button>
            </form>

            <p className="text-center text-xs text-slate-400 mt-8">
              Primeira vez? Use a senha fornecida pelo administrador.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

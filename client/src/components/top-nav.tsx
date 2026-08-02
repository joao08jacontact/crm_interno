import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, BarChart3, HardDrive, Zap, Calendar,
  Columns, User, LogOut, Settings, FolderKanban, Send,
  Bot, GitMerge, PieChart, ChevronDown, Menu, X, DatabaseZap, ListChecks, MessageCircle
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/contexts/AuthContext";
import logoInova from "@assets/logo-inova.png";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const menuItems = [
  { title: "Esteira", url: "/", icon: LayoutDashboard },
  { title: "Dashboard GLPI", url: "/dashboard", icon: BarChart3 },
  { title: "Cronograma", url: "/timeline", icon: Calendar },
  { title: "Kanban", url: "/kanban", icon: Columns },
  { title: "Power BI", url: "/power-bi", icon: PieChart },
  { title: "Auto - Tarefas", url: "/auto-tarefas", icon: ListChecks },
  { title: "Projetos", url: "/projetos", icon: FolderKanban },
  { title: "Automação", url: "/automacao", icon: Zap },
  { title: "Banco de Dados", url: "/banco-dados", icon: HardDrive },
  { title: "Auto Banco", url: "/automacao-banco", icon: DatabaseZap },
  { title: "Disparos", url: "/disparos", icon: Send },
  { title: "Disparos RPA", url: "/disparos-rpa", icon: Bot },
  { title: "Régua", url: "/regua-automatica", icon: GitMerge },
  { title: "Gestão Meta", url: "/gestao-meta", icon: MessageCircle },
];

export function TopNav() {
  const [location, setLocation] = useLocation();
  const { analista, isLoggedIn, isAdmin, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => {
    logout();
    setLocation("/login");
  };

  const isActive = (url: string) =>
    url === "/" ? location === "/" : location.startsWith(url);

  return (
    <>
      <nav
        className="h-10 shrink-0 flex items-center px-3 gap-1 border-b border-white/5 z-50"
        style={{ background: "#0d1117" }}
      >
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 mr-3 shrink-0 select-none">
          <img src={logoInova} alt="Inova" className="h-6 w-6 object-contain" />
          <span className="text-white text-sm font-semibold tracking-wide hidden sm:block whitespace-nowrap">
            Inova Análise
          </span>
        </Link>

        {/* Divider */}
        <div className="h-4 w-px bg-white/10 mr-2 shrink-0 hidden sm:block" />

        {/* Nav items — desktop */}
        <div className="hidden md:flex items-center gap-0.5 flex-1 overflow-x-auto scrollbar-hide">
          {menuItems.map((item) => {
            const active = isActive(item.url);
            return (
              <Link
                key={item.url}
                href={item.url}
                data-testid={`link-${item.url.replace("/", "") || "home"}`}
                className={`
                  flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-all
                  ${active
                    ? "bg-blue-500/15 text-blue-400 border border-blue-500/25"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/5"}
                `}
              >
                <item.icon className="h-3.5 w-3.5 shrink-0" />
                {item.title}
              </Link>
            );
          })}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <ThemeToggle />

          {isAdmin && (
            <Link href="/configuracao">
              <button
                className={`p-1.5 rounded transition-colors ${location === "/configuracao" ? "text-blue-400" : "text-slate-500 hover:text-slate-300"}`}
                title="Configuração"
                data-testid="link-configuracao"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
            </Link>
          )}

          {isLoggedIn && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-slate-300 hover:bg-white/5 transition-colors">
                  <User className="h-3.5 w-3.5 text-blue-400" />
                  <span className="hidden sm:block max-w-[80px] truncate">{analista?.nome}</span>
                  <ChevronDown className="h-3 w-3 text-slate-500" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <div className="px-2 py-1.5">
                  <p className="text-xs font-medium">{analista?.nome}</p>
                  <Badge variant={isAdmin ? "default" : "secondary"} className="text-[10px] mt-0.5">
                    {analista?.role === "admin" ? "Admin" : analista?.role === "control_desk" ? "Control Desk" : "Analista de TI"}
                  </Badge>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-red-400 focus:text-red-400 cursor-pointer">
                  <LogOut className="h-3.5 w-3.5 mr-2" />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-1.5 text-slate-400 hover:text-slate-200"
            onClick={() => setMobileOpen(p => !p)}
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </nav>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 top-10 z-40 flex flex-col"
          style={{ background: "#0d1117" }}
        >
          <div className="flex flex-col p-3 gap-1 overflow-y-auto">
            {menuItems.map((item) => {
              const active = isActive(item.url);
              return (
                <Link
                  key={item.url}
                  href={item.url}
                  onClick={() => setMobileOpen(false)}
                  className={`
                    flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all
                    ${active ? "bg-blue-500/15 text-blue-400 border border-blue-500/25" : "text-slate-300 hover:bg-white/5"}
                  `}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.title}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

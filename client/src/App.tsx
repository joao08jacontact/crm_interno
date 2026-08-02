import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { TopNav } from "@/components/top-nav";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import EsteiraDemandas from "@/pages/esteira-demandas";
import DashboardGlpi from "@/pages/dashboard-glpi";
import TimelineGlpi from "@/pages/timeline-glpi";
import KanbanGlpi from "@/pages/kanban-glpi";
import Projetos from "@/pages/projetos";
import Disparos from "@/pages/disparos";
import DisparosRpa from "@/pages/disparos-rpa";
import ReguaAutomatica from "@/pages/regua-automatica";
import Automacao from "@/pages/python-scripts";
import BancoDados from "@/pages/banco-dados";
import AutomacaoBanco from "@/pages/automacao-banco";
import PowerBi from "@/pages/power-bi";
import AutoTarefas from "@/pages/auto-tarefas";
import Configuracao from "@/pages/configuracao";
import GestaoMeta from "@/pages/gestao-meta";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";

function ProtectedRoutes() {
  const { isAdmin } = useAuth();

  return (
    <Switch>
      <Route path="/" component={EsteiraDemandas} />
      <Route path="/dashboard" component={DashboardGlpi} />
      <Route path="/timeline" component={TimelineGlpi} />
      <Route path="/kanban" component={KanbanGlpi} />
      <Route path="/kanban-glpi" component={KanbanGlpi} />
      <Route path="/automacao" component={Automacao} />
      <Route path="/banco-dados" component={BancoDados} />
      <Route path="/automacao-banco" component={AutomacaoBanco} />
      <Route path="/power-bi" component={PowerBi} />
      <Route path="/auto-tarefas" component={AutoTarefas} />
      <Route path="/projetos" component={Projetos} />
      <Route path="/disparos" component={Disparos} />
      <Route path="/disparos-rpa" component={DisparosRpa} />
      <Route path="/regua-automatica" component={ReguaAutomatica} />
      <Route path="/gestao-meta" component={GestaoMeta} />
      <Route path="/configuracao">
        {isAdmin ? <Configuracao /> : <Redirect to="/" />}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const [location] = useLocation();
  const { isLoggedIn, isAdmin } = useAuth();

  if (location === "/login") return <LoginPage />;
  if (!isLoggedIn) return <LoginPage />;
  if (location === "/configuracao" && !isAdmin) return <Redirect to="/" />;

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden">
      <TopNav />
      <div className="flex-1 overflow-hidden">
        <ProtectedRoutes />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <AuthProvider>
            <AppContent />
            <Toaster />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

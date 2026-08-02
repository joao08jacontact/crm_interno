import { Link, useLocation } from "wouter";
import { LayoutDashboard, BarChart3, Database, Zap, Calendar, Columns, User, LogOut, LogIn, Settings, FolderKanban, Send, Bot, GitMerge, HardDrive, PieChart } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/contexts/AuthContext";

const menuItems = [
  {
    title: "Esteira de Demandas",
    url: "/",
    icon: LayoutDashboard,
  },
  {
    title: "Dashboard GLPI",
    url: "/dashboard",
    icon: BarChart3,
  },
  {
    title: "Cronograma",
    url: "/timeline",
    icon: Calendar,
  },
  {
    title: "Quadro Kanban",
    url: "/kanban",
    icon: Columns,
  },
  {
    title: "Automação",
    url: "/automacao",
    icon: Zap,
  },
  {
    title: "Banco de Dados",
    url: "/banco-dados",
    icon: HardDrive,
  },
  {
    title: "Power BI",
    url: "/power-bi",
    icon: PieChart,
  },
  {
    title: "Projetos",
    url: "/projetos",
    icon: FolderKanban,
  },
  {
    title: "Disparos",
    url: "/disparos",
    icon: Send,
  },
  {
    title: "Disparos RPA",
    url: "/disparos-rpa",
    icon: Bot,
  },
  {
    title: "Régua Automática",
    url: "/regua-automatica",
    icon: GitMerge,
  },
];

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { analista, isLoggedIn, isAdmin, logout } = useAuth();

  const handleLogout = () => {
    logout();
    setLocation("/login");
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
            <LayoutDashboard className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">JaContact</span>
            <span className="text-xs text-muted-foreground">Plataforma Unificada</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Módulos</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={`link-${item.url.replace("/", "") || "home"}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Administração</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/configuracao"}
                    data-testid="link-configuracao"
                  >
                    <Link href="/configuracao">
                      <Settings className="h-4 w-4" />
                      <span>Configuração</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="p-4 space-y-3">
        {isLoggedIn ? (
          <div className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-primary" />
              <div className="flex flex-col">
                <span className="text-sm font-medium">{analista?.nome}</span>
                <Badge variant={isAdmin ? "default" : "secondary"} className="text-xs w-fit">
                  {analista?.role === "admin" ? "Admin" : analista?.role === "control_desk" ? "Control Desk" : "Analista de TI"}
                </Badge>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              title="Sair"
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setLocation("/login")}
            data-testid="button-go-login"
          >
            <LogIn className="h-4 w-4 mr-2" />
            Fazer Login
          </Button>
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Tema</span>
          <ThemeToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

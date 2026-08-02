import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import type { AnalistaRole } from "@shared/schema";

interface Analista {
  id: string;
  nome: string;
  role: AnalistaRole;
}

interface AuthContextType {
  analista: Analista | null;
  isLoggedIn: boolean;
  isAdmin: boolean;
  login: (analista: Analista) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STORAGE_KEY = "analista_logado";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [analista, setAnalista] = useState<Analista | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return null;
      }
    }
    return null;
  });

  useEffect(() => {
    if (analista) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(analista));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [analista]);

  const login = (analistaData: Analista) => {
    setAnalista(analistaData);
  };

  const logout = () => {
    setAnalista(null);
  };

  const isAdmin = analista?.role === "admin";

  return (
    <AuthContext.Provider value={{ analista, isLoggedIn: !!analista, isAdmin, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

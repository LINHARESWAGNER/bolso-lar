import { useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  CalendarDays,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  PiggyBank,
  Plus,
  Receipt,
  Settings,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/lib/queries";
import { PeriodProvider } from "./period-context";
import { Onboarding } from "./onboarding";
import { TransactionDialog } from "./transaction-dialog";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/lancamentos", label: "Lançamentos", icon: Receipt },
  { to: "/contas", label: "Contas", icon: Wallet },
  { to: "/cartoes", label: "Cartões", icon: CreditCard },
  { to: "/orcamento", label: "Orçamento", icon: PiggyBank },
  { to: "/calendario", label: "Calendário", icon: CalendarDays },
  { to: "/fluxo-de-caixa", label: "Fluxo de Caixa", icon: TrendingUp },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
] as const;

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            pathname === item.to
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
          )}
        >
          <item.icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data: profile, isLoading } = useProfile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  if (!profile?.family_id) {
    return <Onboarding defaultName={profile?.full_name ?? undefined} />;
  }

  const familyName = profile.families?.name ?? "Minha família";

  return (
    <PeriodProvider>
      <div className="flex min-h-screen w-full bg-background">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 lg:flex">
          <div className="px-2 pb-6">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Finanças
            </p>
            <p className="truncate text-base font-semibold text-sidebar-foreground">
              {familyName}
            </p>
          </div>
          <NavList />
          <div className="mt-auto pt-4">
            <Button variant="ghost" className="w-full justify-start gap-3" onClick={signOut}>
              <LogOut className="h-4 w-4" /> Sair
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="icon" className="lg:hidden" aria-label="Abrir menu">
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-64 bg-sidebar p-4">
                  <p className="truncate px-2 pb-4 pt-2 font-semibold text-sidebar-foreground">
                    {familyName}
                  </p>
                  <NavList onNavigate={() => setMenuOpen(false)} />
                  <Button variant="ghost" className="mt-4 w-full justify-start gap-3" onClick={signOut}>
                    <LogOut className="h-4 w-4" /> Sair
                  </Button>
                </SheetContent>
              </Sheet>
              <span className="truncate text-sm text-muted-foreground">{familyName}</span>
            </div>
            <Button onClick={() => setNewOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Novo lançamento</span>
            </Button>
          </header>

          <main className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-6 lg:pb-6">{children}</main>
        </div>

        <TransactionDialog open={newOpen} onOpenChange={setNewOpen} />
      </div>
    </PeriodProvider>
  );
}
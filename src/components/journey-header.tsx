import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";

const JOURNEY_LABELS = {
  cadastros: { href: "/cadastros", label: "Cadastros iniciais" },
  planejamento: { href: "/planejamento", label: "Planejamento" },
  execucao: { href: "/lancamentos", label: "Execução" },
  verificacao: { href: "/saude-financeira", label: "Verificação" },
} as const;

export type JourneyOrigin = keyof typeof JOURNEY_LABELS;

export function JourneyHeader({
  step,
  title,
  subtitle,
  actions,
}: {
  step: 1 | 2 | 3 | 4 | 5;
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded border border-primary/40 bg-primary/15 px-2 py-0.5 font-medium uppercase tracking-wide text-primary">
            Etapa {step} de 5
          </span>
          <span className="text-muted-foreground">Jornada Financeira</span>
        </div>
        <h1 className="break-words text-2xl font-semibold text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {actions && <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto">{actions}</div>}
    </header>
  );
}

export function JourneyBackLink({ origin }: { origin?: JourneyOrigin }) {
  const searchOrigin = useRouterState({
    select: (state) => {
      const search = state.location.search as Record<string, unknown>;
      const value = search["origem"];
      return typeof value === "string" ? value : undefined;
    },
  });
  const resolvedOrigin = origin ?? searchOrigin;
  if (!resolvedOrigin || !(resolvedOrigin in JOURNEY_LABELS)) return null;
  const destination = JOURNEY_LABELS[resolvedOrigin as JourneyOrigin];

  return (
    <a
      href={destination.href}
      className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
    >
      <ArrowLeft className="h-4 w-4" /> Voltar para {destination.label}
    </a>
  );
}

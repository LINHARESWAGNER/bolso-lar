import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MonthSelector } from "@/components/month-selector";
import { usePeriod } from "@/components/period-context";
import { PageHeader, StatusBadge } from "@/components/ui-bits";
import { brl, formatDateBR, monthLabel, toISODate } from "@/lib/format";
import { notCancelled } from "@/lib/derive";
import { useTransactions } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/calendario")({
  head: () => ({
    meta: [
      { title: "Calendário — Finanças da Família" },
      { name: "description", content: "Vencimentos de contas e recebimentos em visão mensal." },
      { property: "og:title", content: "Calendário — Finanças da Família" },
      { property: "og:description", content: "Vencimentos de contas e recebimentos em visão mensal." },
    ],
  }),
  component: Calendario,
});

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function Calendario() {
  const { month, year } = usePeriod();
  const { data: transactions = [] } = useTransactions();
  const [selected, setSelected] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const map = new Map<string, typeof transactions>();
    for (const t of transactions) {
      const day = t.due_date ?? t.competence_date;
      if (!day || !notCancelled(t)) continue;
      const d = new Date(`${day}T00:00:00`);
      if (d.getFullYear() !== year || d.getMonth() + 1 !== month) continue;
      map.set(day, [...(map.get(day) ?? []), t]);
    }
    return map;
  }, [transactions, year, month]);

  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const leading = first.getDay();
  const cells: (string | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => toISODate(new Date(year, month - 1, i + 1))),
  ];

  const today = toISODate(new Date());
  const selectedItems = selected ? (byDay.get(selected) ?? []) : [];

  return (
    <div>
      <PageHeader title="Calendário" subtitle={monthLabel(month, year)} actions={<MonthSelector />} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="grid grid-cols-7 gap-1 text-center text-xs uppercase text-muted-foreground">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1">{d}</div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((iso, i) => {
              if (!iso) return <div key={`e${i}`} />;
              const items = byDay.get(iso) ?? [];
              const receitas = items.filter((t) => t.type === "receita").length;
              const despesas = items.filter((t) => t.type !== "receita").length;
              const atrasado = items.some((t) => t.status !== "pago" && iso < today);
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setSelected(iso)}
                  className={cn(
                    "min-h-16 rounded-lg border border-border/60 p-1.5 text-left transition-colors hover:border-primary/60",
                    iso === today && "border-primary",
                    selected === iso && "bg-accent",
                  )}
                >
                  <span className="text-xs font-medium text-foreground">{Number(iso.slice(8))}</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {receitas > 0 && (
                      <span className="rounded bg-success/15 px-1 text-[10px] text-success">{receitas}</span>
                    )}
                    {despesas > 0 && (
                      <span
                        className={cn(
                          "rounded px-1 text-[10px]",
                          atrasado ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning",
                        )}
                      >
                        {despesas}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-card-foreground">
            {selected ? formatDateBR(selected) : "Selecione um dia"}
          </h2>
          <ul className="mt-3 space-y-3">
            {selected && selectedItems.length === 0 && (
              <li className="text-sm text-muted-foreground">Nada previsto neste dia.</li>
            )}
            {selectedItems.map((t) => (
              <li key={t.id} className="rounded-lg border border-border/70 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {t.description}
                  </p>
                  <StatusBadge status={t.status} />
                </div>
                <p
                  className={cn(
                    "mt-1 text-sm font-semibold",
                    t.type === "receita" ? "text-success" : "text-destructive",
                  )}
                >
                  {brl(Number(t.amount))}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
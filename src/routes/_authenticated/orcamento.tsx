import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/currency-input";
import { MonthSelector } from "@/components/month-selector";
import { usePeriod } from "@/components/period-context";
import { EmptyState, PageHeader } from "@/components/ui-bits";
import { brl, monthLabel } from "@/lib/format";
import { monthRange } from "@/lib/finance";
import { realizedForCategory } from "@/lib/derive";
import {
  useBudgets,
  useCategories,
  useInvalidateFinance,
  useProfile,
  useTransactions,
} from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/orcamento")({
  head: () => ({
    meta: [
      { title: "Orçamento — Finanças da Família" },
      { name: "description", content: "Limites mensais por categoria com acompanhamento do realizado." },
      { property: "og:title", content: "Orçamento — Finanças da Família" },
      { property: "og:description", content: "Limites mensais por categoria com acompanhamento do realizado." },
    ],
  }),
  component: Orcamento,
});

function Orcamento() {
  const { month, year } = usePeriod();
  const { data: categories = [] } = useCategories();
  const { data: transactions = [] } = useTransactions();
  const { data: budgets = [] } = useBudgets();
  const { data: profile } = useProfile();
  const invalidate = useInvalidateFinance();
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  const reference = monthRange(year, month).start;
  const budget = budgets.find((b) => b.reference_month === reference);

  const expenseRoots = useMemo(
    () => categories.filter((c) => c.kind === "despesa" && !c.parent_id && c.is_active),
    [categories],
  );

  const valueFor = (categoryId: string): number => {
    if (draft[categoryId] !== undefined) return draft[categoryId];
    const item = budget?.budget_items.find((i) => i.category_id === categoryId);
    return item ? Number(item.amount) : 0;
  };

  const rows = expenseRoots.map((cat) => {
    const orcado = valueFor(cat.id);
    const { realizado, comprometido } = realizedForCategory(
      transactions,
      categories,
      cat.id,
      year,
      month,
    );
    const usado = realizado + comprometido;
    return {
      cat,
      orcado,
      realizado,
      comprometido,
      usado,
      pct: orcado > 0 ? (usado / orcado) * 100 : 0,
    };
  });

  const totalOrcado = rows.reduce((s, r) => s + r.orcado, 0);
  const totalUsado = rows.reduce((s, r) => s + r.usado, 0);

  async function save() {
    if (!profile?.family_id) return;
    setSaving(true);
    try {
      let budgetId = budget?.id;
      if (!budgetId) {
        const { data, error } = await supabase
          .from("budgets")
          .insert({ family_id: profile.family_id, reference_month: reference })
          .select("id")
          .single();
        if (error) throw error;
        budgetId = data.id;
      }
      await supabase.from("budget_items").delete().eq("budget_id", budgetId);
      const items = rows
        .filter((r) => r.orcado > 0)
        .map((r) => ({
          family_id: profile.family_id!,
          budget_id: budgetId!,
          category_id: r.cat.id,
          amount: r.orcado,
        }));
      if (items.length) {
        const { error } = await supabase.from("budget_items").insert(items);
        if (error) throw error;
      }
      setDraft({});
      invalidate();
      toast.success("Orçamento salvo");
    } catch {
      toast.error("Não foi possível salvar o orçamento");
    } finally {
      setSaving(false);
    }
  }

  function copyPrevious() {
    const prev = new Date(year, month - 2, 1);
    const prevRef = monthRange(prev.getFullYear(), prev.getMonth() + 1).start;
    const prevBudget = budgets.find((b) => b.reference_month === prevRef);
    if (!prevBudget) {
      toast.error("Sem orçamento no mês anterior");
      return;
    }
    const next: Record<string, number> = {};
    for (const item of prevBudget.budget_items) next[item.category_id] = Number(item.amount);
    setDraft(next);
    toast.success("Valores copiados — revise e salve");
  }

  return (
    <div>
      <PageHeader
        title="Orçamento"
        subtitle={`${monthLabel(month, year)} · ${brl(totalUsado)} de ${brl(totalOrcado)}`}
        actions={
          <>
            <MonthSelector />
            <Button variant="outline" onClick={copyPrevious}>Copiar mês anterior</Button>
            <Button onClick={save} disabled={saving}>Salvar</Button>
          </>
        }
      />

      {expenseRoots.length === 0 ? (
        <EmptyState title="Nenhuma categoria de despesa" hint="Crie categorias em Configurações." />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.cat.id} className="rounded-xl border border-border bg-card p-4">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-card-foreground">{r.cat.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Realizado {brl(r.realizado)} · Previsto {brl(r.comprometido)}
                  </p>
                </div>
                <div className="w-32 shrink-0">
                  <CurrencyInput
                    value={valueFor(r.cat.id)}
                    onValueChange={(v) => setDraft((d) => ({ ...d, [r.cat.id]: v }))}
                  />
                </div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${r.pct > 100 ? "bg-destructive" : r.pct > 80 ? "bg-warning" : "bg-primary"}`}
                  style={{ width: `${Math.min(r.pct, 100)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {r.orcado > 0
                  ? `${r.pct.toFixed(0)}% do limite · restam ${brl(Math.max(r.orcado - r.usado, 0))}`
                  : "Sem limite definido"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
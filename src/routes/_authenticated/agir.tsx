import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, History, LockKeyhole, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { JourneyHeader } from "@/components/journey-header";
import { MonthSelector } from "@/components/month-selector";
import { CurrencyInput } from "@/components/currency-input";
import { usePeriod } from "@/components/period-context";
import { useBudgetPlanVersions, useBudgets, useCategories, useInvalidateFinance, useProfile, useTransactions, useInvoices } from "@/lib/queries";
import { isThirdPartyTransaction, realizedBalanceBefore } from "@/lib/derive";
import { planningFixedMonth } from "@/lib/planning";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/agir")({
  head: () => ({ meta: [{ title: "Action (Agir) — Finanças da Família" }] }),
  component: ActionPage,
});

type BudgetItem = { category_id: string; amount: number };
type Snapshot = { income?: number; fixed?: number; variable?: number; budget_items?: BudgetItem[] };

// Comparacao visual em centavos para evitar R$ 0,00 com cor negativa.
const moneyCents = (amount: number) => Math.round(Number(amount) * 100);
const centsBrl = (amount: number) => brl(moneyCents(amount) / 100);
const balanceClass = (amount: number) =>
  moneyCents(amount) < 0 ? "text-destructive" : moneyCents(amount) > 0 ? "text-success" : "text-foreground";

function snapshotOf(value: unknown): Snapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Snapshot;
}

function ActionPage() {
  const { month, year } = usePeriod();
  const { data: profile } = useProfile();
  const { data: budgets = [], isLoading: loadingBudgets } = useBudgets();
  const { data: categories = [], isLoading: loadingCategories } = useCategories();
  const { data: versions = [], isLoading: loadingVersions, refetch: refetchVersions } = useBudgetPlanVersions();
  const { data: transactions = [] } = useTransactions();
  const { data: invoices = [] } = useInvoices();
  const invalidate = useInvalidateFinance();
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<"erro_original" | "revisao">("erro_original");
  const [justification, setJustification] = useState("");
  const [saving, setSaving] = useState(false);
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const budget = budgets.find((item) => item.family_id === profile?.family_id && item.reference_month.startsWith(key));
  const monthVersions = versions.filter((item) => item.family_id === profile?.family_id && item.reference_month.startsWith(key));
  const latest = monthVersions.reduce((result, current) =>
    !result || current.version_number > result.version_number ? current : result,
    undefined as (typeof monthVersions)[number] | undefined,
  );
  const original = monthVersions.find((item) => item.version_number === 1);
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);

  const names = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
  const currentItems = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of budget?.budget_items ?? []) {
      let cat = categoryById.get(item.category_id);
      const seen = new Set<string>();
      while (cat?.parent_id && !seen.has(cat.id)) {
        seen.add(cat.id);
        cat = categoryById.get(cat.parent_id);
      }
      const id = cat?.id ?? item.category_id;
      totals.set(id, (totals.get(id) ?? 0) + Number(item.amount));
    }
    return [...totals].map(([id, amount]) => ({ id, name: names.get(id) ?? "Categoria", amount }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [budget, categoryById, names]);

  useEffect(() => {
    setDrafts(Object.fromEntries(currentItems.map((item) => [item.id, item.amount])));
    setJustification("");
    setReason("erro_original");
  }, [key, latest?.id, budget?.updated_at, currentItems]);

  const originalSnapshot = snapshotOf(original?.snapshot);
  const originalItems = new Map((originalSnapshot.budget_items ?? []).map((item) => [item.category_id, Number(item.amount)]));
  const originalTotal = (originalSnapshot.budget_items ?? []).reduce((sum, item) => sum + Number(item.amount), 0);
  const currentTotal = currentItems.reduce((sum, item) => sum + item.amount, 0);
  const draftTotal = Object.values(drafts).reduce((sum, value) => sum + Number(value || 0), 0);
  const loading = loadingBudgets || loadingCategories || loadingVersions;
  const monthStart = `${key}-01`;
  const previousBalance = useMemo(() => {
    const familyTransactions = transactions.filter((transaction) =>
      transaction.family_id === profile?.family_id &&
      !isThirdPartyTransaction(categories, transaction)
    );
    return realizedBalanceBefore(familyTransactions, monthStart);
  }, [transactions, categories, profile?.family_id, monthStart]);


  // Mesmas regras do Plan: competencia para variaveis, pago + previsto,
  // parcelas contadas uma unica vez e despesas para terceiros excluidas.
  const variableUsage = useMemo(() => {
    const usage = new Map<string, { committed: number; registered: number; paid: number; pending: number }>();
    for (const transaction of transactions) {
      if (
        transaction.family_id !== profile?.family_id ||
        transaction.type !== "despesa" ||
        transaction.expense_nature !== "variavel" ||
        transaction.status === "cancelado" ||
        !transaction.competence_date.startsWith(key) ||
        !transaction.category_id ||
        isThirdPartyTransaction(categories, transaction)
      ) continue;

      let category = categoryById.get(transaction.category_id);
      const seen = new Set<string>();
      while (category?.parent_id && !seen.has(category.id)) {
        seen.add(category.id);
        category = categoryById.get(category.parent_id);
      }
      const rootId = category?.id ?? transaction.category_id;
      const total = usage.get(rootId) ?? { committed: 0, registered: 0, paid: 0, pending: 0 };
      const value = Number(transaction.amount);
      total.registered += value;
      if (transaction.installment_group_id !== null) total.committed += value;
      if (transaction.status === "pago") total.paid += value;
      else total.pending += value;
      usage.set(rootId, total);
    }
    return usage;
  }, [transactions, categories, categoryById, profile?.family_id, key]);

  const usageTotals = useMemo(() => {
    const total = { committed: 0, registered: 0, paid: 0, pending: 0 };
    for (const value of variableUsage.values()) {
      total.committed += value.committed;
      total.registered += value.registered;
      total.paid += value.paid;
      total.pending += value.pending;
    }
    return total;
  }, [variableUsage]);

  const context = useMemo(() => {
    const familyTransactions = transactions.filter((t) =>
      t.family_id === profile?.family_id && t.status !== "cancelado" && !isThirdPartyTransaction(categories, t)
    );
    const monthTransactions = familyTransactions.filter((t) => t.competence_date.startsWith(key));
    const familyInvoices = invoices.filter((i) => i.family_id === profile?.family_id);
    const income = monthTransactions.filter((t) => t.type === "receita")
      .reduce((sum, t) => sum + Number(t.amount), 0);
    const fixed = familyTransactions.filter((t) =>
      t.type === "despesa" && t.expense_nature === "fixo" && planningFixedMonth(t, familyInvoices) === key
    ).reduce((sum, t) => sum + Number(t.amount), 0);
    return { income, fixed };
  }, [transactions, categories, invoices, profile?.family_id, key]);

  const plannedMonthlyResult = context.income - context.fixed - draftTotal;
  const projectedClosingBalance = previousBalance + plannedMonthlyResult;
  const adjustment = draftTotal - currentTotal;
  const minimumViolations = [...variableUsage.entries()].filter(
    ([id, usage]) => moneyCents(drafts[id] ?? 0) < moneyCents(usage.registered),
  );

  async function saveReview() {
    if (!latest || saving) return;
    if (minimumViolations.length > 0) {
      toast.error("Existem categorias com novo limite abaixo do gasto registrado.");
      return;
    }
    if (justification.trim().length < 10) {
      toast.error("Escreva uma justificativa de pelo menos 10 caracteres.");
      return;
    }
    if (!window.confirm(`Registrar ${reason === "erro_original" ? "correção" : "revisão"} como versão ${latest.version_number + 1}?`)) return;
    setSaving(true);
    try {
      const items = Object.entries(drafts)
        .filter(([, amount]) => Number(amount) > 0)
        .map(([category_id, amount]) => ({ category_id, amount: Number(amount) }));
      const { error } = await supabase.rpc("save_budget_plan_version", {
        p_reference_month: `${key}-01`,
        p_items: items,
        p_context: { income: context.income, fixed: context.fixed, variable: draftTotal },
        p_expected_version: latest.version_number,
        p_change_kind: reason,
        p_justification: justification.trim(),
      });
      if (error) throw error;
      await refetchVersions();
      invalidate();
      toast.success("Revisão registrada e histórico preservado.");
    } catch (error) {
      toast.error("Não foi possível registrar a revisão", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <JourneyHeader
        step={5}
        title="Action (Agir)"
        subtitle="Corrija erros ou revise o orçamento com justificativa e histórico"
        actions={<MonthSelector />}
      />

      <div className="rounded-xl border bg-card p-4 sm:p-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando orçamento e histórico…</p>
        ) : !latest ? (
          <div className="space-y-2">
            <p className="font-medium">{budget ? "Orçamento anterior ao controle de versões" : "Nenhum orçamento aprovado neste mês"}</p>
            <p className="text-sm text-muted-foreground">
              {budget
                ? "Os valores existentes foram preservados. A incorporação explícita desse orçamento ao histórico ainda está pendente; nenhuma edição será realizada aqui."
                : "Planeje e salve o orçamento no Plan para aprová-lo automaticamente."}
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">Orçamento original aprovado</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{brl(originalTotal)}</p>
              </div>
              <div className="text-right">
                <p className="inline-flex items-center gap-2 text-xs text-muted-foreground"><LockKeyhole className="h-4 w-4" /> Versão {latest.version_number}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">Vigente: {brl(currentTotal)}</p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border bg-background/40 p-3">
                <p className="text-xs text-muted-foreground">Saldo do mês anterior</p>
                <p className={`mt-1 text-lg font-semibold tabular-nums ${balanceClass(previousBalance)}`}>{centsBrl(previousBalance)}</p>
              </div>
              <div className="rounded-lg border bg-background/40 p-3">
                <p className="text-xs text-muted-foreground">Receitas do mês</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-success">{centsBrl(context.income)}</p>
              </div>
              <div className="rounded-lg border bg-background/40 p-3">
                <p className="text-xs text-muted-foreground">Despesas fixas</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{centsBrl(context.fixed)}</p>
              </div>
              <div className="rounded-lg border bg-background/40 p-3">
                <p className="text-xs text-muted-foreground">Gasto variável registrado</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{centsBrl(usageTotals.registered)}</p>
                <p className="text-xs text-muted-foreground">Inclui parcelas; pago {centsBrl(usageTotals.paid)} e previsto {centsBrl(usageTotals.pending)}</p>
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-background/40 p-3">
                <p className="text-xs text-muted-foreground">Novo orçamento variável</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{centsBrl(draftTotal)}</p>
              </div>
              <div className="rounded-lg border bg-background/40 p-3">
                <p className="text-xs text-muted-foreground">Ajuste proposto</p>
                <p className={`mt-1 text-xl font-semibold tabular-nums ${balanceClass(-adjustment)}`}>{adjustment > 0 ? "+" : ""}{centsBrl(adjustment)}</p>
                <p className="text-xs text-muted-foreground">Em relação ao limite vigente</p>
              </div>
              <div className="rounded-lg border bg-background/40 p-3">
                <p className="text-xs text-muted-foreground">Saldo financeiro após revisão</p>
                <p className={`mt-1 text-xl font-semibold tabular-nums ${balanceClass(projectedClosingBalance)}`}>{centsBrl(projectedClosingBalance)}</p>
                <p className="text-xs text-muted-foreground">Saldo anterior + receitas − fixas − novo orçamento</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              O saldo anterior vem dos movimentos realizados até o mês precedente. O gasto variável contém
              parcelas e demais despesas pagas e previstas na competência, sem duplicidade. Saldo anterior
              não é receita nova. A projeção orçamentária não substitui o fluxo de caixa por vencimentos.
            </p>
            {moneyCents(projectedClosingBalance) < 0 && (
              <div role="alert" className="mt-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                Atenção: faltam {centsBrl(Math.abs(projectedClosingBalance))} para cobrir o orçamento revisado,
                mesmo considerando o saldo vindo do mês anterior. Reduza limites ou reveja despesas antes de aprovar.
              </div>
            )}
            {moneyCents(projectedClosingBalance) >= 0 && moneyCents(plannedMonthlyResult) < 0 && (
              <div role="status" className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-400">
                O planejamento do mês é deficitário em {centsBrl(Math.abs(plannedMonthlyResult))}, mas o saldo anterior cobre a diferença.
              </div>
            )}
          </>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)]">
        <section className="rounded-xl border bg-card p-4 sm:p-5">
          <h2 className="flex items-center gap-2 font-semibold"><RotateCcw className="h-5 w-5" /> Revisão por categoria</h2>
          {latest && (
            <>
              <div className="mt-4 space-y-3">
                {[...new Set([...currentItems.map((item) => item.id), ...Object.keys(drafts), ...variableUsage.keys()])]
                  .map((id) => {
                    const item = currentItems.find((entry) => entry.id === id);
                    const usage = variableUsage.get(id) ?? { committed: 0, registered: 0, paid: 0, pending: 0 };
                    const proposed = Number(drafts[id] ?? 0);
                    const originalAmount = originalItems.get(id) ?? 0;
                    const change = proposed - (item?.amount ?? 0);
                    const invalid = moneyCents(proposed) < moneyCents(usage.registered);
                    const percent = moneyCents(proposed) > 0
                      ? Math.min(100, Math.max(0, (usage.registered / proposed) * 100))
                      : usage.registered > 0 ? 100 : 0;
                    return (
                      <div key={id} className={`rounded-lg border p-3 ${invalid ? "border-destructive/60 bg-destructive/5" : "border-border bg-background/20"}`}>
                        <div className="grid items-center gap-3 lg:grid-cols-[minmax(130px,1.4fr)_repeat(3,minmax(105px,1fr))_minmax(125px,1fr)]">
                          <div className="min-w-0 font-medium">{item?.name ?? names.get(id) ?? "Categoria"}</div>
                          <div><p className="text-xs text-muted-foreground">Original</p><p className="tabular-nums">{centsBrl(originalAmount)}</p></div>
                          <div><p className="text-xs text-muted-foreground">Gasto do mês</p><p className="tabular-nums" title={`Pago ${centsBrl(usage.paid)}; previsto ${centsBrl(usage.pending)}; parcelas incluídas ${centsBrl(usage.committed)}`}>{centsBrl(usage.registered)}</p></div>
                          <div><p className="text-xs text-muted-foreground">Ajuste</p><p className={`tabular-nums ${balanceClass(-change)}`}>{change > 0 ? "+" : ""}{centsBrl(change)}</p></div>
                          <div>
                            <label className="text-xs text-muted-foreground" htmlFor={`action-limit-${id}`}>Novo limite</label>
                            <CurrencyInput
                              id={`action-limit-${id}`}
                              aria-label={`Novo limite para ${item?.name ?? names.get(id) ?? "Categoria"}`}
                              className="mt-1 w-full"
                              value={proposed}
                              onValueChange={(value) => setDrafts((current) => ({ ...current, [id]: value }))}
                              disabled={saving}
                            />
                          </div>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                          <div className={`h-full rounded-full transition-all ${invalid ? "bg-destructive" : percent >= 90 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${percent}%` }} />
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="text-muted-foreground">{percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do novo limite consumido</span>
                          {invalid ? (
                            <span role="alert" className="font-medium text-destructive">Mínimo permitido: {centsBrl(usage.registered)}. Aumente o novo limite.</span>
                          ) : (
                            <span className={balanceClass(proposed - usage.registered)}>Disponível após revisão: {centsBrl(proposed - usage.registered)}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  className="rounded-md border bg-background p-2 text-sm"
                  defaultValue=""
                  disabled={saving}
                  onChange={(event) => {
                    if (!event.target.value) return;
                    const id = event.target.value;
                    setDrafts((current) => ({ ...current, [id]: 0 }));
                    event.target.value = "";
                  }}
                >
                  <option value="">+ Adicionar categoria</option>
                  {categories.filter((cat) => cat.family_id === profile?.family_id && cat.kind === "despesa" && !cat.parent_id && !(cat.id in drafts)).map((cat) => (
                    <option value={cat.id} key={cat.id}>{cat.name}</option>
                  ))}
                </select>
                <span className="ml-auto font-semibold">Novo total: {centsBrl(draftTotal)} · Ajuste: {adjustment > 0 ? "+" : ""}{centsBrl(adjustment)}</span>
              </div>
              <div className="mt-5 space-y-3 border-t pt-4">
                <label className="block text-sm font-medium" htmlFor="pdca-reason">Motivo</label>
                <select id="pdca-reason" className="w-full rounded-md border bg-background p-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} disabled={saving}>
                  <option value="erro_original">Erro no planejamento original</option>
                  <option value="revisao">Mudança de necessidade / revisão</option>
                </select>
                <label className="block text-sm font-medium" htmlFor="pdca-justification">Justificativa (mínimo 10 caracteres)</label>
                <textarea id="pdca-justification" className="min-h-24 w-full rounded-md border bg-background p-3 text-sm" value={justification} onChange={(e) => setJustification(e.target.value)} disabled={saving} placeholder="Explique por que o orçamento precisa mudar" />
                {minimumViolations.length > 0 && (
                  <p role="alert" className="text-sm text-destructive">Ajuste {minimumViolations.length} categoria(s) com limite inferior ao gasto antes de registrar.</p>
                )}
                <button type="button" onClick={saveReview} disabled={saving || justification.trim().length < 10 || minimumViolations.length > 0} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
                  <Save className="h-4 w-4" /> Registrar versão {latest.version_number + 1}
                </button>
              </div>
            </>
          )}
        </section>
        <section className="rounded-xl border bg-card p-4 sm:p-5">
          <h2 className="flex items-center gap-2 font-semibold"><History className="h-5 w-5" /> Histórico de versões</h2>
          {monthVersions.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Ainda não há versões registradas para este mês.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {[...monthVersions].sort((a, b) => b.version_number - a.version_number).map((version) => {
                const snap = snapshotOf(version.snapshot);
                return (
                  <article key={version.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex justify-between gap-2 font-medium">
                      <span>Versão {version.version_number} — {version.change_kind === "original" ? "Original" : version.change_kind === "erro_original" ? "Correção de erro" : "Revisão"}</span>
                      <span>{brl(Number(snap.variable ?? 0))}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{new Date(version.created_at).toLocaleString("pt-BR")}</p>
                    {version.justification && <p className="mt-2">{version.justification}</p>}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
      <Link to="/planejamento" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" /> Voltar ao Plan (Planejar)
      </Link>
    </div>
  );
}

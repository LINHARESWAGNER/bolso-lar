import { PlanModeloA } from "@/components/plan-modelo-a";
import { planningFixedMonth } from "@/lib/planning";
import { useInvoices } from "@/lib/queries";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarRange,
  Lightbulb,
  LockKeyhole,
  Save,
  Copy,
  SlidersHorizontal,
  WalletCards,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { MonthSelector } from "@/components/month-selector";
import { JourneyHeader } from "@/components/journey-header";
import { usePeriod } from "@/components/period-context";
import { CurrencyInput } from "@/components/currency-input";
import { Button } from "@/components/ui/button";
import { brl, monthLabel, shortMonth } from "@/lib/format";
import { isThirdPartyTransaction, realizedBalanceBefore } from "@/lib/derive";
import { annualPlanningRows, planningMonthKey, variableBudgetSuggestions } from "@/lib/planning";
import {
  useBudgets,
  useBudgetPlanVersions,
  useCategories,
  useInvalidateFinance,
  useProfile,
  useTransactions,
  useVariableBudgets,
} from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/planejamento")({
  head: () => ({ meta: [{ title: "Planejamento — Finanças da Família" }] }),
  component: PlanejamentoRoute,
});

function Planejamento() {
  const { month, year } = usePeriod();
  const { data: profile } = useProfile();
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: budgets = [] } = useBudgets();
  const { data: versions = [], isLoading: loadingVersions, refetch: refetchVersions } = useBudgetPlanVersions();
  const { data: legacyPeriods = [] } = useVariableBudgets();
  const { data: invoices = [] } = useInvoices();
  const invalidate = useInvalidateFinance();
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const journeyTransactions = useMemo(
    () => transactions.filter(
      (transaction) =>
        transaction.family_id === profile?.family_id &&
        !isThirdPartyTransaction(categories, transaction)
    ),
    [transactions, categories, profile?.family_id],
  );

  const key = planningMonthKey(year, month);
  // Mesmo calculo do Painel: historico realizado anterior ao primeiro dia do mes.
  // Saldo anterior e recurso disponivel, nao uma receita da competencia.
  const saldoMesAnterior = useMemo(
    () => realizedBalanceBefore(journeyTransactions, `${key}-01`),
    [journeyTransactions, key],
  );
  const monthlyBudget = budgets.find((budget) =>
    budget.family_id === profile?.family_id && budget.reference_month.startsWith(key)
  );
  const monthVersions = versions.filter((version) =>
    version.family_id === profile?.family_id && version.reference_month.startsWith(key)
  );
  const approvedVersion = monthVersions.reduce((latest, current) =>
    !latest || current.version_number > latest.version_number ? current : latest,
    undefined as (typeof monthVersions)[number] | undefined,
  );
  const isApproved = Boolean(approvedVersion);
  const isLegacy = Boolean(monthlyBudget && !approvedVersion);
  const suggestion = useMemo(
    () => variableBudgetSuggestions(journeyTransactions, categories, year, month),
    [journeyTransactions, categories, year, month],
  );
  const expenseRoots = useMemo(
    () =>
      categories
        .filter((category) => category.kind === "despesa" && !category.parent_id)
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" })),
    [categories],
  );
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  useEffect(() => {
    const next: Record<string, number> = {};
    for (const item of monthlyBudget?.budget_items ?? []) {
      const rootId = categoryById.get(item.category_id)?.parent_id ?? item.category_id;
      next[rootId] = (next[rootId] ?? 0) + Number(item.amount);
    }
    for (const [categoryId, amount] of suggestion.suggestions) {
      if (!(categoryId in next)) next[categoryId] = 0;
      if (amount > 0 && !expenseRoots.some((category) => category.id === categoryId)) {
        next[categoryId] = 0;
      }
    }
    setDrafts(next);
  }, [monthlyBudget?.id, key, suggestion.suggestions, expenseRoots, categoryById]);

  const familyInvoices = useMemo(
    () =>
      invoices.filter(
        (invoice) => invoice.family_id === profile?.family_id
      ),
    [invoices, profile?.family_id]
  );
  const monthRows = useMemo(
    () =>
      journeyTransactions.filter(
        (transaction) =>
          transaction.status !== "cancelado" && transaction.competence_date.startsWith(key),
      ),
    [journeyTransactions, key],
  );
  const incomeRows = monthRows.filter((transaction) => transaction.type === "receita");
  const expectedIncome = sum(incomeRows);
  const extraIncome = sum(
    incomeRows.filter(
      (transaction) =>
        transaction.recurring_id == null &&
        transaction.status === "pago"
    )
  );
  const primaryIncome = expectedIncome - extraIncome;
  const installments = sum(
    monthRows.filter(
      (transaction) =>
        transaction.type === "despesa" &&
        transaction.installment_group_id !== null &&
        transaction.expense_nature !== "fixo",
    ),
  );
  const fixed = sum(
    journeyTransactions.filter(
      (transaction) =>
        transaction.status !== "cancelado" &&
        transaction.type === "despesa" &&
        transaction.expense_nature === "fixo" &&
        planningFixedMonth(transaction, familyInvoices) === key
    )
  );
  const variable = Object.values(drafts).reduce((total, amount) => total + Number(amount || 0), 0);
  const installmentsByRoot = new Map<string, number>();

  for (const transaction of monthRows) {
    if (
      transaction.type !== "despesa" ||
      transaction.installment_group_id === null ||
      transaction.expense_nature === "fixo" ||
      !transaction.category_id
    ) continue;

    let category = categoryById.get(transaction.category_id);
    const visited = new Set<string>();

    while (category?.parent_id && !visited.has(category.id)) {
      visited.add(category.id);
      category = categoryById.get(category.parent_id);
    }

    const rootId = category?.id ?? transaction.category_id;

    installmentsByRoot.set(
      rootId,
      (installmentsByRoot.get(rootId) ?? 0) + Number(transaction.amount),
    );
  }

  const variableAndInstallments = variable;
  const plannedExpenses = fixed + variableAndInstallments;
  const plannedResult = expectedIncome - plannedExpenses;
  const recursosDisponiveis = roundMoney(saldoMesAnterior + expectedIncome);
  const committedPct = expectedIncome > 0 ? (plannedExpenses / expectedIncome) * 100 : null;
  const normalizedPlannedResult = roundMoney(plannedResult);
  const plannedTone = moneyTone(plannedResult);
  const normalizedCommittedPct =
    committedPct === null ? null : Math.round((committedPct + Number.EPSILON) * 10) / 10;

  const visibleBudgetRoots = useMemo(() => {
    const ids = new Set([
      ...Object.keys(drafts),
      ...suggestion.suggestions.keys(),
      ...monthRows
        .filter((transaction) => transaction.expense_nature === "variavel")
        .map((transaction) => transaction.category_id)
        .filter((id): id is string => Boolean(id)),
    ]);
    const rootIds = new Set([...ids].map((id) => categoryById.get(id)?.parent_id ?? id));
    return expenseRoots.filter((category) => rootIds.has(category.id));
  }, [drafts, suggestion.suggestions, monthRows, expenseRoots, categoryById]);

  const childrenByRoot = useMemo(() => {
    const grouped = new Map<string, typeof categories>();
    for (const root of visibleBudgetRoots) {
      grouped.set(
        root.id,
        categories
          .filter((category) => category.kind === "despesa" && category.parent_id === root.id)
          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" })),
      );
    }
    return grouped;
  }, [categories, visibleBudgetRoots]);

  const annualRows = useMemo(
    () => annualPlanningRows(journeyTransactions, budgets, legacyPeriods, year, familyInvoices),
    [journeyTransactions, budgets, legacyPeriods, year, familyInvoices],
  );
  const annualTotals = annualRows.reduce(
    (total, row) => ({
      income: total.income + row.income,
      expenses: total.expenses + row.fixed + row.variable,
      result: total.result + row.plannedResult,
    }),
    { income: 0, expenses: 0, result: 0 },
  );
  const annualChart = annualRows.map((row) => ({
    month: shortMonth(row.month),
    receitas: row.income,
    despesas: row.fixed + row.variable,
    resultado: row.plannedResult,
  }));

  function copyPreviousBudget() {
    const previous = new Date(year, month - 2, 1);
    const previousKey = planningMonthKey(previous.getFullYear(), previous.getMonth() + 1);
    if (isApproved || isLegacy) return;
    const source = budgets.find((budget) => budget.family_id === profile?.family_id && budget.reference_month.startsWith(previousKey));
    if (!source) {
      toast.error("O mês anterior não possui orçamento variável salvo.");
      return;
    }
    const next: Record<string, number> = {};
    for (const item of source.budget_items ?? []) {
      const rootId = categoryById.get(item.category_id)?.parent_id ?? item.category_id;
      if (!expenseRoots.some((root) => root.id === rootId)) continue;
      next[rootId] = (next[rootId] ?? 0) + Number(item.amount);
    }
    if (Object.values(next).length === 0) {
      toast.error("Não há categorias de despesas no planejamento anterior.");
      return;
    }
    if (
      Object.values(drafts).some((value) => value > 0) &&
      !window.confirm(
        "Substituir os valores atuais pelos do mês anterior? As alterações só serão gravadas ao clicar em Salvar orçamento.",
      )
    )
      return;
    setDrafts(next);
    toast.info("Valores copiados para edição. Clique em Salvar orçamento para confirmar.");
  }

  function applySuggestions() {
    if (!suggestion.hasEnoughHistory || isApproved || isLegacy) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const [categoryId, amount] of suggestion.suggestions) next[categoryId] = amount;
      return next;
    });
  }

  async function saveVariableBudget() {
    const familyId = profile?.family_id;
    if (!familyId || loadingVersions || isApproved || isLegacy) return;
    const items = Object.entries(drafts)
      .filter(([, amount]) => Number(amount) > 0)
      .map(([category_id, amount]) => ({ category_id, amount: Number(amount) }));
    if (items.length === 0) {
      toast.error("Informe ao menos um limite de despesa variável antes de salvar.");
      return;
    }
    if (!window.confirm("Salvar este orçamento como aprovado? Depois, alterações somente pelo Action.")) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("save_budget_plan_version", {
        p_reference_month: `${key}-01`,
        p_items: items,
        p_context: { income: expectedIncome, fixed, variable },
        p_expected_version: 0,
        p_change_kind: null,
        p_justification: null,
      });
      if (error) throw error;
      await refetchVersions();
      invalidate();
      toast.success("Orçamento salvo e aprovado. Revisões somente pelo Action.");
    } catch (error) {
      toast.error("Não foi possível aprovar o orçamento", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <JourneyHeader
        step={2}
        title="Planejamento"
        subtitle="Organize o mês e acompanhe a visão fiscal do ano"
        actions={<MonthSelector />}
      />

      <div className="space-y-5">
        {/* Visao mensal e anual na mesma pagina, sem abas. */}

          <div hidden style={{ display: "none" }}>
<section
            className={`rounded-xl border p-4 ${
              plannedTone === "negative"
                ? "border-destructive/50 bg-destructive/10"
                : plannedTone === "positive"
                  ? "border-success/40 bg-success/10"
                  : "border-border bg-card"
            }`}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                    plannedTone === "negative"
                      ? "bg-destructive/20 text-destructive"
                      : plannedTone === "positive"
                        ? "bg-success/20 text-success"
                        : "bg-muted text-foreground"
                  }`}
                >
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">
                      {plannedTone === "negative"
                        ? "Déficit previsto no orçamento"
                        : plannedTone === "positive"
                          ? "Orçamento equilibrado"
                          : "Orçamento no limite"}
                    </h2>
                    {committedPct !== null && (
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          normalizedCommittedPct !== null && normalizedCommittedPct > 100
                            ? "bg-destructive/20 text-destructive"
                            : normalizedCommittedPct !== null && normalizedCommittedPct === 100
                              ? "bg-muted text-foreground"
                              : "bg-success/20 text-success"
                        }`}
                      >
                        {normalizedCommittedPct!.toLocaleString("pt-BR", {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })}
                        % comprometido
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Plano de {monthLabel(month, year)} · pode ser ajustado sem movimentar as contas
                  </p>
                </div>
              </div>
              <div className="sm:text-right">
                <p className="text-xs text-muted-foreground">Sobra planejada</p>
                <p
                  className={`mt-1 text-xl font-semibold ${
                    plannedTone === "negative"
                      ? "text-destructive"
                      : plannedTone === "positive"
                        ? "text-success"
                        : ""
                  }`}
                >
                  {brl(normalizedPlannedResult)}
                </p>
              </div>
            </div>
          </section>
</div>

          <section className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-success/10 text-success">
                    <Banknote className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="font-semibold">Receitas do mês</h2>
                    <p className="text-xs text-muted-foreground">Recebidas e previstas na competência</p>
                  </div>
                </div>
                <strong className="text-right text-2xl text-success">{brl(expectedIncome)}</strong>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <SummaryTile
                  title="Receitas planejadas"
                  description="Programadas e previstas"
                  value={primaryIncome}
                  tone="positive"
                />
                <SummaryTile
                  title="Receitas extras"
                  description="Recebidas sem recorrência"
                  value={extraIncome}
                  tone="positive"
                />
                <SummaryTile
                  title="Saldo mês anterior"
                  description="Acumulado realizado até o mês anterior"
                  value={saldoMesAnterior}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Recursos disponíveis (saldo anterior + receitas)</span>
                <strong className={moneyTone(recursosDisponiveis) === "negative" ? "text-destructive" : ""}>
                  {brl(recursosDisponiveis)}
                </strong>
              </div>
              <a
                href={`/recorrencias?visao=receitas&origem=planejamento&ano=${year}&mes=${String(month).padStart(2, "0")}`}
                className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-primary"
              >
                Gerenciar receitas <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </article>

            <article className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <WalletCards className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="font-semibold">Despesas totais</h2>
                    <p className="text-xs text-muted-foreground">Total consolidado do mês</p>
                  </div>
                </div>
                <strong className="text-right text-2xl">{brl(plannedExpenses)}</strong>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <SummaryTile
                  icon={<LockKeyhole className="h-4 w-4" />}
                  title="Despesas fixas"
                  description="Recorrências e parcelas fixas"
                  value={fixed}
                  href={`/recorrencias?visao=despesas-fixas&origem=planejamento&ano=${year}&mes=${String(month).padStart(2, "0")}`}
                  action="Gerenciar fixas"
                />
                <SummaryTile
                  icon={<SlidersHorizontal className="h-4 w-4" />}
                  title="Despesas variáveis"
                  description="Limite inclui compras parceladas"
                  value={variableAndInstallments}
                  href={isApproved ? "/agir" : "#orcamento-variavel"}
                  action={isApproved ? "Revisar no Action" : "Definir limites"}
                  detail={`Limite: ${brl(variable)} · Ja comprometido em parcelas: ${brl(installments)} (incluido no limite)`}
                  active
                />
              </div>
            </article>
          </section>

        {/* Visao fiscal anual imediatamente apos o resumo do mes. */}

          <div hidden style={{ display: "none" }}>
<section className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <CalendarRange className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <h2 className="font-semibold">Visão fiscal de {year}</h2>
                <p className="text-sm text-muted-foreground">
                  Consolida receitas previstas, despesas fixas e despesas variáveis de todos os
                  meses. Parcelas variáveis já estão incluídas nos limites das categorias.
                </p>
              </div>
            </div>
          </section>
</div>
          <div hidden style={{ display: "none" }}>
<section className="grid gap-3 sm:grid-cols-3">
            <Kpi label="Receitas previstas no ano" value={annualTotals.income} positive />
            <Kpi label="Despesas planejadas no ano" value={annualTotals.expenses} negative />
            <Kpi
              label="Resultado fiscal planejado"
              value={annualTotals.result}
              negative={annualTotals.result < 0}
            />
          </section>
</div>
          <div hidden style={{ display: "none" }}>
<section className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-semibold">Evolução planejada do ano</h2>
            <div className="mt-4 h-72 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={annualChart}
                  margin={{ top: 8, right: 10, bottom: 0, left: 8 }}
                >
                  <CartesianGrid stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                  />
                  <YAxis
                    tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                    tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`}
                  />
                  <Tooltip formatter={(value) => brl(Number(value))} />
                  <Legend />
                  <Bar dataKey="receitas" name="Receitas" fill="var(--color-chart-2)" />
                  <Bar dataKey="despesas" name="Despesas" fill="var(--color-chart-3)" />
                  <Line
                    dataKey="resultado"
                    name="Resultado"
                    stroke="var(--color-chart-1)"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </section>
</div>
          <div hidden style={{ display: "none" }}>
<section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border p-4">
              <h2 className="font-semibold">Planejamento mês a mês</h2>
              <p className="text-sm text-muted-foreground">
                Selecione outro mês no topo da página; os valores anuais acompanham o planejamento salvo.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-3">Mês</th>
                    <th className="p-3 text-right">Receitas</th>
                    <th className="p-3 text-right">Fixas</th>
                    <th className="p-3 text-right">Variáveis (inclui parcelas)</th>
                    <th className="p-3 text-right">Resultado planejado</th>
                    <th className="p-3 text-right">Realizado</th>
                  </tr>
                </thead>
                <tbody>
                  {annualRows.map((row) => (
                    <tr key={row.month} className="border-t border-border">
                      <td className="p-3 font-medium">
                        {shortMonth(row.month)}/{String(year).slice(-2)}
                      </td>
                      <td className="p-3 text-right text-success">{brl(row.income)}</td>
                      <td className="p-3 text-right">{brl(row.fixed)}</td>
                      <td className="p-3 text-right">{brl(row.variable)}</td>
                      <td
                        className={`p-3 text-right font-medium ${roundMoney(row.plannedResult) < 0 ? "text-destructive" : ""}`}
                      >
                        {brl(roundMoney(row.plannedResult))}
                      </td>
                      <td
                        className={`p-3 text-right ${roundMoney(row.realizedResult) < 0 ? "text-destructive" : ""}`}
                      >
                        {brl(roundMoney(row.realizedResult))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
</div>
        {/* Edicao e acompanhamento detalhado dos limites ficam abaixo da visao anual. */}
          {!isApproved && (
            <section id="orcamento-variavel" className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <div className="flex items-center gap-2">
                  <WalletCards className="h-5 w-5 text-primary" />
                  <h2 className="font-semibold">Orçamento das despesas variáveis</h2>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  O orçamento é um limite por categoria. Ele não cria uma despesa; o valor é
                  consumido quando você registra uma compra ou pagamento variável. Digite o limite
                  somente na categoria principal; todas as subcategorias usam o mesmo valor.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={copyPreviousBudget} disabled={saving || loadingVersions || isApproved || isLegacy}>
                  <Copy className="h-4 w-4" /> Copiar planejamento do mês anterior
                </Button>
                {suggestion.hasEnoughHistory && (
                  <Button variant="outline" onClick={applySuggestions} disabled={saving || loadingVersions || isApproved || isLegacy}>
                    <Lightbulb className="h-4 w-4" /> Aplicar sugestão de 3 meses
                  </Button>
                )}
                {isApproved ? (
                  <a href="/agir" className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">
                    <LockKeyhole className="h-4 w-4" /> Revisar no Action (versão {approvedVersion?.version_number})
                  </a>
                ) : isLegacy ? (
                  <span className="rounded-md border px-3 py-2 text-sm text-muted-foreground">Orçamento anterior: incorporação pendente</span>
                ) : (
                  <Button onClick={saveVariableBudget} disabled={saving || loadingVersions}>
                    <Save className="h-4 w-4" /> Salvar e aprovar orçamento
                  </Button>
                )}
              </div>
            </div>

            {suggestion.hasEnoughHistory ? (
              <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                <strong>Sugestão disponível.</strong> Calculada pela média real de{" "}
                {suggestion.months.join(", ")}. Você pode aceitar tudo ou ajustar cada categoria.
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                A sugestão será liberada quando houver despesas variáveis registradas em três meses
                consecutivos.
              </div>
            )}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2">Categoria</th>
                    {suggestion.months.map((key) => (
                      <th key={key} className="py-2 text-right">
                        {key.slice(5)}/{key.slice(2, 4)}
                      </th>
                    ))}
                    <th className="py-2 text-right">Média dos 3 meses</th>
                    <th className="py-2 pl-5">Orçamento do mês</th>
                    <th className="py-2 text-right">Parcelas comprometidas</th>
                    <th className="py-2 text-right">Restante antes dos demais gastos</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleBudgetRoots.map((root) => (
                    <TreeBudgetRows
                      key={root.id}
                      root={root}
                      children={childrenByRoot.get(root.id) ?? []}
                      hasHistory={suggestion.hasEnoughHistory}
                      rootAverage={suggestion.suggestions.get(root.id) ?? 0}
                      rootMonths={suggestion.rootMonths.get(root.id) ?? [0, 0, 0]}
                      categoryMonths={suggestion.categoryMonths}
                      categoryAverages={suggestion.categoryAverages}
                       value={drafts[root.id] ?? 0}
                       installmentCommitted={installmentsByRoot.get(root.id) ?? 0}
                      onValueChange={(value) => {
                        if (isApproved || isLegacy || loadingVersions) return;
                        setDrafts((current) => ({ ...current, [root.id]: value }));
                      }}
                      readOnly={isApproved || isLegacy || loadingVersions}
                    />
                  ))}
                </tbody>
              </table>
              {visibleBudgetRoots.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Ainda não há categorias variáveis com histórico. Escolha uma categoria para
                  começar.
                  <div className="mx-auto mt-3 max-w-sm">
                    <select
                      className="w-full rounded-md border border-input bg-background px-3 py-2"
                      defaultValue=""
                      disabled={isApproved || isLegacy || loadingVersions}
                      onChange={(event) => {
                        if (!event.target.value) return;
                        setDrafts((current) => ({ ...current, [event.target.value]: 0 }));
                        event.target.value = "";
                      }}
                    >
                      <option value="">Adicionar categoria…</option>
                      {expenseRoots.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
            {visibleBudgetRoots.length > 0 && (
              <div className="mt-3 flex justify-end">
                <select
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  defaultValue=""
                  disabled={isApproved || isLegacy || loadingVersions}
                  onChange={(event) => {
                    if (!event.target.value) return;
                    setDrafts((current) => ({
                      ...current,
                      [event.target.value]: current[event.target.value] ?? 0,
                    }));
                    event.target.value = "";
                  }}
                >
                  <option value="">+ Adicionar categoria</option>
                  {expenseRoots
                    .filter((category) => !(category.id in drafts))
                    .map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
            </section>
          )}
      </div>
    </div>
  );
}

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function moneyTone(value: number): "negative" | "positive" | "neutral" {
  const rounded = roundMoney(value);
  if (rounded < 0) return "negative";
  if (rounded > 0) return "positive";
  return "neutral";
}

function sum(rows: { amount: number }[]) {
  return rows.reduce((total, row) => total + Number(row.amount), 0);
}

function TreeBudgetRows({
  root,
  children,
  hasHistory,
  rootAverage,
  rootMonths,
  categoryMonths,
  categoryAverages,
  value,
  installmentCommitted,
  onValueChange,
  readOnly = false,
}: {
  root: { id: string; name: string };
  children: { id: string; name: string }[];
  hasHistory: boolean;
  rootAverage: number;
  rootMonths: number[];
  categoryMonths: Map<string, number[]>;
  categoryAverages: Map<string, number>;
  value: number;
  installmentCommitted: number;
  onValueChange: (value: number) => void;
  readOnly?: boolean;
}) {
  const remaining = roundMoney(value - installmentCommitted);

  return (
    <>
      <tr className="border-t border-border bg-muted/25">
        <td className="py-3 font-semibold">
          <span>{root.name}</span>
          <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Categoria principal
          </span>
        </td>
        {rootMonths.map((amount, index) => (
          <td key={index} className="py-3 text-right tabular-nums">
            {brl(amount)}
          </td>
        ))}
        <td className="py-3 text-right font-medium">
          {hasHistory ? brl(rootAverage) : "Aguardando histórico"}
        </td>
        <td className="py-3 pl-5">
          <CurrencyInput
            aria-label={`Orçamento de ${root.name}`}
            className="ml-auto max-w-[180px]"
            value={value}
            onValueChange={onValueChange}
            disabled={readOnly}
          />
        </td>
        <td className="py-3 text-right tabular-nums">
          {brl(installmentCommitted)}
        </td>
        <td className={`py-3 text-right font-medium tabular-nums ${
          Math.round((Number(remaining) + Number.EPSILON) * 100) < 0 ? "text-destructive" : ""
        }`}>
          {brl(remaining)}
        </td>
      </tr>
      {children.map((category, index) => (
        <tr key={category.id} className="border-t border-border/70 text-muted-foreground">
          <td className="relative py-2.5 pl-8">
            <span
              aria-hidden="true"
              className={`absolute left-3 top-0 w-3 border-b border-l border-border ${
                index === children.length - 1 ? "h-1/2" : "h-full"
              }`}
            />
            {category.name}
          </td>
          {(categoryMonths.get(category.id) ?? [0, 0, 0]).map((amount, index) => (
            <td key={index} className="py-2.5 text-right tabular-nums">
              {brl(amount)}
            </td>
          ))}
          <td className="py-2.5 text-right">
            {hasHistory ? brl(categoryAverages.get(category.id) ?? 0) : "—"}
          </td>
          <td colSpan={3} className="py-2.5 pl-5 text-sm">Usa o limite da categoria principal</td>
        </tr>
      ))}
    </>
  );
}

function SummaryTile({
  icon,
  title,
  description,
  value,
  href,
  action,
  detail,
  active = false,
  tone,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  value: number;
  href?: string;
  action?: string;
  detail?: string;
  active?: boolean;
  tone?: "positive";
}) {
  return (
    <div
      className={`rounded-lg border bg-background/30 p-3 ${active ? "border-primary" : "border-border"}`}
    >
      <div className="flex items-center gap-2">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      <p className={`mt-3 text-lg font-semibold ${tone === "positive" ? "text-success" : ""}`}>
        {brl(value)}
      </p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
      {href && action && (
        <a
          href={href}
          className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary"
        >
          {action} <ArrowRight className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  positive = false,
  negative = false,
}: {
  label: string;
  value: number;
  positive?: boolean;
  negative?: boolean;
}) {
  const normalizedValue = roundMoney(value);
  const showPositive = positive && normalizedValue !== 0;
  const showNegative = negative && normalizedValue !== 0;
  const autoTone = moneyTone(normalizedValue);

  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-2 text-xl font-semibold ${
          showPositive
            ? "text-success"
            : showNegative
              ? "text-destructive"
              : autoTone === "negative"
                ? "text-destructive"
                : autoTone === "positive"
                  ? "text-success"
                  : ""
        }`}
      >
        {brl(normalizedValue)}
      </p>
    </article>
  );
}


function PlanejamentoRoute() {
  const [modeloA, setModeloA] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setModeloA(params.get("modelo") !== "legado");
  }, []);

  if (modeloA) {
    return <PlanModeloA />;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <a
          href="/planejamento?modelo=A"
          className="rounded-lg border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10"
        >
          Voltar ao planejamento oficial
        </a>
      </div>
      <Planejamento />
    </div>
  );
}
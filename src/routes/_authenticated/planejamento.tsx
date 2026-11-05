import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarRange,
  CreditCard,
  Lightbulb,
  Repeat2,
  Save,
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
import { usePeriod } from "@/components/period-context";
import { CurrencyInput } from "@/components/currency-input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui-bits";
import { brl, monthLabel, shortMonth } from "@/lib/format";
import { isThirdPartyTransaction } from "@/lib/derive";
import { annualPlanningRows, planningMonthKey, variableBudgetSuggestions } from "@/lib/planning";
import {
  useBudgets,
  useCategories,
  useInvalidateFinance,
  useProfile,
  useTransactions,
  useVariableBudgets,
} from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/planejamento")({
  head: () => ({ meta: [{ title: "Planejamento — Finanças da Família" }] }),
  component: Planejamento,
});

function Planejamento() {
  const { month, year } = usePeriod();
  const { data: profile } = useProfile();
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: budgets = [] } = useBudgets();
  const { data: legacyPeriods = [] } = useVariableBudgets();
  const invalidate = useInvalidateFinance();
  const [tab, setTab] = useState("mensal");
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const journeyTransactions = useMemo(
    () => transactions.filter((transaction) => !isThirdPartyTransaction(categories, transaction)),
    [transactions, categories],
  );

  const key = planningMonthKey(year, month);
  const monthlyBudget = budgets.find((budget) => budget.reference_month.startsWith(key));
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

  const monthRows = useMemo(
    () =>
      journeyTransactions.filter(
        (transaction) =>
          transaction.status !== "cancelado" && transaction.competence_date.startsWith(key),
      ),
    [journeyTransactions, key],
  );
  const expectedIncome = sum(monthRows.filter((transaction) => transaction.type === "receita"));
  const installments = sum(
    monthRows.filter(
      (transaction) => transaction.type === "despesa" && transaction.installment_group_id !== null,
    ),
  );
  const fixed = sum(
    monthRows.filter(
      (transaction) =>
        transaction.type === "despesa" &&
        transaction.expense_nature === "fixo" &&
        transaction.installment_group_id === null,
    ),
  );
  const variable = Object.values(drafts).reduce((total, amount) => total + Number(amount || 0), 0);
  const plannedResult = expectedIncome - fixed - variable - installments;

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
    () => annualPlanningRows(journeyTransactions, budgets, legacyPeriods, year),
    [journeyTransactions, budgets, legacyPeriods, year],
  );
  const annualTotals = annualRows.reduce(
    (total, row) => ({
      income: total.income + row.income,
      expenses: total.expenses + row.fixed + row.variable + row.installments,
      result: total.result + row.plannedResult,
    }),
    { income: 0, expenses: 0, result: 0 },
  );
  const annualChart = annualRows.map((row) => ({
    month: shortMonth(row.month),
    receitas: row.income,
    despesas: row.fixed + row.variable + row.installments,
    resultado: row.plannedResult,
  }));

  function applySuggestions() {
    if (!suggestion.hasEnoughHistory) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const [categoryId, amount] of suggestion.suggestions) next[categoryId] = amount;
      return next;
    });
  }

  async function saveVariableBudget() {
    if (!profile?.family_id) return;
    setSaving(true);
    try {
      const { data: budget, error: budgetError } = await supabase
        .from("budgets")
        .upsert(
          { family_id: profile.family_id, reference_month: `${key}-01` },
          { onConflict: "family_id,reference_month" },
        )
        .select("id")
        .single();
      if (budgetError) throw budgetError;

      const { error: deleteError } = await supabase
        .from("budget_items")
        .delete()
        .eq("budget_id", budget.id);
      if (deleteError) throw deleteError;

      const items = Object.entries(drafts)
        .filter(([, amount]) => Number(amount) > 0)
        .map(([categoryId, amount]) => ({
          budget_id: budget.id,
          family_id: profile.family_id,
          category_id: categoryId,
          amount: Number(amount),
        }));
      if (items.length) {
        const { error: itemsError } = await supabase.from("budget_items").insert(items);
        if (itemsError) throw itemsError;
      }
      invalidate();
      toast.success("Orçamento variável do mês salvo");
    } catch (error) {
      toast.error("Não foi possível salvar o planejamento", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Planejamento"
        subtitle="Organize o mês e acompanhe a visão fiscal do ano"
        actions={<MonthSelector />}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-5 grid w-full grid-cols-2 sm:w-[420px]">
          <TabsTrigger value="mensal">Planejamento mensal</TabsTrigger>
          <TabsTrigger value="anual">Planejamento anual</TabsTrigger>
        </TabsList>

        <TabsContent value="mensal" className="space-y-5">
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-primary">Etapa 2</p>
                <h2 className="text-lg font-semibold">Plano de {monthLabel(month, year)}</h2>
                <p className="text-sm text-muted-foreground">
                  Pode ser alterado a qualquer momento sem movimentar o saldo das contas.
                </p>
              </div>
              <p className={plannedResult < 0 ? "text-destructive" : "text-success"}>
                Sobra planejada: <strong>{brl(plannedResult)}</strong>
              </p>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <PlanningBlock
              code="A"
              title="Receitas previstas"
              description="O que a família espera receber"
              value={expectedIncome}
              tone="positive"
              href="/recorrencias"
              action="Gerenciar receitas"
            />
            <PlanningBlock
              code="1"
              title="Despesas fixas"
              description="Compromissos conhecidos ou recorrentes"
              value={fixed}
              href="/recorrencias"
              action="Gerenciar despesas fixas"
            />
            <PlanningBlock
              code="2"
              title="Despesas variáveis"
              description="Limites para gastos que ainda acontecerão"
              value={variable}
              active
              href="#orcamento-variavel"
              action="Editar limites abaixo"
            />
            <PlanningBlock
              code="3"
              title="Dívidas parceladas"
              description="Cartão, financiamentos e empréstimos"
              value={installments}
              href="/parcelados"
              action="Gerenciar parcelamentos"
            />
          </section>

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
                {suggestion.hasEnoughHistory && (
                  <Button variant="outline" onClick={applySuggestions}>
                    <Lightbulb className="h-4 w-4" /> Aplicar sugestão de 3 meses
                  </Button>
                )}
                <Button onClick={saveVariableBudget} disabled={saving}>
                  <Save className="h-4 w-4" /> Salvar orçamento
                </Button>
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
              <table className="w-full min-w-[660px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2">Categoria</th>
                    <th className="py-2 text-right">Média dos 3 meses</th>
                    <th className="py-2 pl-5">Orçamento do mês</th>
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
                      categoryAverages={suggestion.categoryAverages}
                      value={drafts[root.id] ?? 0}
                      onValueChange={(value) =>
                        setDrafts((current) => ({ ...current, [root.id]: value }))
                      }
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
        </TabsContent>

        <TabsContent value="anual" className="space-y-5">
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <CalendarRange className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <h2 className="font-semibold">Visão fiscal de {year}</h2>
                <p className="text-sm text-muted-foreground">
                  Consolida receitas previstas, despesas fixas, limites variáveis e dívidas de todos
                  os meses.
                </p>
              </div>
            </div>
          </section>
          <section className="grid gap-3 sm:grid-cols-3">
            <Kpi label="Receitas previstas no ano" value={annualTotals.income} positive />
            <Kpi label="Despesas planejadas no ano" value={annualTotals.expenses} negative />
            <Kpi
              label="Resultado fiscal planejado"
              value={annualTotals.result}
              negative={annualTotals.result < 0}
            />
          </section>
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
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border p-4">
              <h2 className="font-semibold">Planejamento mês a mês</h2>
              <p className="text-sm text-muted-foreground">
                Ajuste um mês na aba mensal e esta visão é atualizada automaticamente.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-3">Mês</th>
                    <th className="p-3 text-right">Receitas</th>
                    <th className="p-3 text-right">Fixas</th>
                    <th className="p-3 text-right">Variáveis</th>
                    <th className="p-3 text-right">Dívidas</th>
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
                      <td className="p-3 text-right">{brl(row.installments)}</td>
                      <td
                        className={`p-3 text-right font-medium ${row.plannedResult < 0 ? "text-destructive" : ""}`}
                      >
                        {brl(row.plannedResult)}
                      </td>
                      <td
                        className={`p-3 text-right ${row.realizedResult < 0 ? "text-destructive" : ""}`}
                      >
                        {brl(row.realizedResult)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function sum(rows: { amount: number }[]) {
  return rows.reduce((total, row) => total + Number(row.amount), 0);
}

function TreeBudgetRows({
  root,
  children,
  hasHistory,
  rootAverage,
  categoryAverages,
  value,
  onValueChange,
}: {
  root: { id: string; name: string };
  children: { id: string; name: string }[];
  hasHistory: boolean;
  rootAverage: number;
  categoryAverages: Map<string, number>;
  value: number;
  onValueChange: (value: number) => void;
}) {
  return (
    <>
      <tr className="border-t border-border bg-muted/25">
        <td className="py-3 font-semibold">
          <span>{root.name}</span>
          <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Categoria principal
          </span>
        </td>
        <td className="py-3 text-right font-medium">
          {hasHistory ? brl(rootAverage) : "Aguardando histórico"}
        </td>
        <td className="py-3 pl-5">
          <CurrencyInput
            aria-label={`Orçamento de ${root.name}`}
            className="ml-auto max-w-[180px]"
            value={value}
            onValueChange={onValueChange}
          />
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
          <td className="py-2.5 text-right">
            {hasHistory ? brl(categoryAverages.get(category.id) ?? 0) : "—"}
          </td>
          <td className="py-2.5 pl-5 text-sm">Usa o limite da categoria principal</td>
        </tr>
      ))}
    </>
  );
}

function PlanningBlock({
  code,
  title,
  description,
  value,
  href,
  action,
  active = false,
  tone,
}: {
  code: string;
  title: string;
  description: string;
  value: number;
  href: string;
  action: string;
  active?: boolean;
  tone?: "positive";
}) {
  const Icon = code === "A" ? Repeat2 : code === "3" ? CreditCard : WalletCards;
  return (
    <article
      className={`rounded-xl border bg-card p-4 ${active ? "border-primary" : "border-border"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
          {code}
        </span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <h2 className="mt-3 font-semibold">{title}</h2>
      <p className="mt-1 min-h-10 text-sm text-muted-foreground">{description}</p>
      <p className={`mt-3 text-xl font-semibold ${tone === "positive" ? "text-success" : ""}`}>
        {brl(value)}
      </p>
      <a
        href={href}
        className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary"
      >
        {action} <ArrowRight className="h-3.5 w-3.5" />
      </a>
    </article>
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
  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-2 text-xl font-semibold ${positive ? "text-success" : negative ? "text-destructive" : ""}`}
      >
        {brl(value)}
      </p>
    </article>
  );
}

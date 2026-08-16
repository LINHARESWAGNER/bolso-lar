import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  CreditCard,
  PiggyBank,
  Scale,
  Wallet,
} from "lucide-react";
import { MonthSelector } from "@/components/month-selector";
import { usePeriod } from "@/components/period-context";
import { PageHeader, StatusBadge, EmptyState } from "@/components/ui-bits";
import { brl, brlCompact, formatDateBR, monthLabel, shortMonth } from "@/lib/format";
import {
  cashBalance,
  categoryPath,
  expensesByRootCategory,
  inMonth,
  monthTotals,
  notCancelled,
  realizedForCategory,
} from "@/lib/derive";
import {
  useAccounts,
  useBudgets,
  useCards,
  useCategories,
  useInvoices,
  useTransactions,
} from "@/lib/queries";
import { monthRange } from "@/lib/finance";
import { toISODate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Finanças da Família" },
      {
        name: "description",
        content: "Visão consolidada do mês: saldo, receitas, despesas, cartões e orçamento.",
      },
      { property: "og:title", content: "Dashboard — Finanças da Família" },
      {
        property: "og:description",
        content: "Visão consolidada do mês: saldo, receitas, despesas, cartões e orçamento.",
      },
    ],
  }),
  component: Dashboard,
});

const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  to,
  search,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "positive" | "negative" | "warning";
  to?: string;
  search?: { type: "receita" | "despesa" | "transferencia" | "pagamento_fatura" | "todos" };
}) {
  const toneClass =
    tone === "positive"
      ? "text-success"
      : tone === "negative"
        ? "text-destructive"
        : tone === "warning"
          ? "text-warning"
          : "text-foreground";
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      <p className={`mt-2 truncate text-xl font-semibold ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
    </>
  );
  const className = "block rounded-xl border border-border bg-card p-4 transition-colors hover:bg-surface-2/50";
  if (to) {
    return (
      <Link to={to} search={search ?? {}} className={className}>
        {content}
      </Link>
    );
  }
  return <div className={className}>{content}</div>;
}

function Dashboard() {
  const { month, year } = usePeriod();
  const { data: accounts = [] } = useAccounts();
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: cards = [] } = useCards();
  const { data: invoices = [] } = useInvoices();
  const { data: budgets = [] } = useBudgets();

  const totals = useMemo(
    () => monthTotals(transactions, year, month),
    [transactions, year, month],
  );
  const saldo = useMemo(
    () => cashBalance(accounts, transactions),
    [accounts, transactions],
  );

  const monthTx = useMemo(
    () =>
      transactions.filter(
        (t) => notCancelled(t) && inMonth(t.competence_date, year, month),
      ),
    [transactions, year, month],
  );

  const byCategory = useMemo(
    () => expensesByRootCategory(monthTx, categories),
    [monthTx, categories],
  );

  const evolution = useMemo(() => {
    const out: { name: string; receitas: number; despesas: number }[] = [];
    for (let m = 1; m <= 12; m++) {
      const t = monthTotals(transactions, year, m);
      out.push({
        name: shortMonth(m),
        receitas: t.receitas,
        despesas: t.despesas,
      });
    }
    return out;
  }, [transactions, year]);

  // Resultado apurado no mês anterior, carregado para o mês atual.
  const resultadoAnterior = useMemo(() => {
    const d = new Date(year, month - 2, 1);
    return monthTotals(transactions, d.getFullYear(), d.getMonth() + 1).resultado;
  }, [transactions, year, month]);

  const resultadoMes = totals.resultado + resultadoAnterior;

  const budget = budgets.find(
    (b) => b.reference_month === monthRange(year, month).start,
  );
  const budgetTotal =
    budget?.budget_items.reduce((s, i) => s + Number(i.amount), 0) ?? 0;
  const budgetRows = (budget?.budget_items ?? []).map((item) => {
    const r = realizedForCategory(transactions, categories, item.category_id, year, month);
    const orcado = Number(item.amount);
    return {
      id: item.id,
      name: categoryPath(categories, item.category_id),
      orcado,
      realizado: r.realizado,
      comprometido: r.comprometido,
      pct: orcado > 0 ? ((r.realizado + r.comprometido) / orcado) * 100 : 0,
    };
  });

  const faturasAbertas = invoices.filter((i) => i.status !== "paga");
  const faturaTotal = transactions
    .filter(
      (t) =>
        t.invoice_id &&
        t.type === "despesa" &&
        notCancelled(t) &&
        faturasAbertas.some((i) => i.id === t.invoice_id),
    )
    .reduce((s, t) => s + Number(t.amount), 0);

  const orcamentoDisponivel = budgetTotal - totals.despesas;

  const maiores = [...monthTx]
    .filter((t) => t.type === "despesa")
    .sort((a, b) => Number(b.amount) - Number(a.amount))
    .slice(0, 5);

  const hoje = toISODate(new Date());
  const proximos = transactions
    .filter(
      (t) =>
        notCancelled(t) &&
        t.status !== "pago" &&
        (t.due_date ?? "") >= hoje &&
        (t.type === "despesa" || t.type === "receita"),
    )
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
    .slice(0, 6);

  const ultimos = [...transactions]
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .slice(0, 6);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={monthLabel(month, year)}
        actions={<MonthSelector />}
      />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Saldo atual" value={brl(saldo)} icon={Wallet} hint="Contas no caixa" tone={saldo >= 0 ? "positive" : "negative"} />
        <Kpi label="Receitas do mês" value={brl(totals.receitas)} icon={ArrowUpRight} tone="positive" />
        <Kpi label="Despesas do mês" value={brl(totals.despesas)} icon={ArrowDownRight} tone="negative" />
        <Kpi
          label="Resultado mês anterior"
          value={brl(resultadoAnterior)}
          icon={Scale}
          hint="Saldo transportado para este mês"
          tone={resultadoAnterior >= 0 ? "positive" : "negative"}
        />
        <Kpi
          label="Resultado do mês"
          value={brl(resultadoMes)}
          icon={Scale}
          hint={`Do mês ${brl(totals.resultado)} + anterior ${brl(resultadoAnterior)}`}
          tone={resultadoMes >= 0 ? "positive" : "negative"}
        />
        <Kpi label="Contas a pagar" value={brl(totals.aPagar)} icon={ArrowDownRight} tone="warning" hint="Despesas pendentes no mês" />
        <Kpi label="Contas a receber" value={brl(totals.aReceber)} icon={ArrowUpRight} hint="Receitas pendentes no mês" />
        <Kpi label="Cartão de crédito" value={brl(faturaTotal)} icon={CreditCard} hint="Faturas em aberto" />
        <Kpi
          label="Orçamento disponível"
          value={brl(orcamentoDisponivel)}
          icon={PiggyBank}
          hint={budgetTotal ? `Orçado ${brl(budgetTotal)}` : "Sem orçamento definido"}
          tone={orcamentoDisponivel >= 0 ? "default" : "negative"}
        />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-card-foreground">
            Evolução de receitas e despesas
          </h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={evolution}>
                <XAxis dataKey="name" stroke="var(--color-muted-foreground)" fontSize={12} />
                <YAxis
                  stroke="var(--color-muted-foreground)"
                  fontSize={12}
                  tickFormatter={(v) => brlCompact(Number(v))}
                  width={70}
                />
                <Tooltip
                  formatter={(v) => brl(Number(v))}
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    color: "var(--color-popover-foreground)",
                  }}
                />
                <Bar dataKey="receitas" name="Receitas" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="despesas" name="Despesas" fill="var(--color-chart-3)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-card-foreground">Despesas por categoria</h2>
          {byCategory.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="Sem despesas no mês" />
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="h-52 w-full sm:w-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80}>
                      {byCategory.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v) => brl(Number(v))}
                      contentStyle={{
                        background: "var(--color-popover)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        color: "var(--color-popover-foreground)",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="min-w-0 flex-1 space-y-2">
                {byCategory.slice(0, 6).map((c, i) => (
                  <li key={c.name} className="flex items-center gap-2 text-sm">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{c.name}</span>
                    <span className="shrink-0 font-medium text-foreground">{brl(c.value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-card-foreground">Orçamento x realizado</h2>
          {budgetRows.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="Nenhum orçamento definido" hint="Defina limites por categoria em Orçamento." />
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {budgetRows.map((row) => (
                <li key={row.id}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate text-foreground">{row.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {brl(row.realizado + row.comprometido)} / {brl(row.orcado)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${row.pct > 100 ? "bg-destructive" : row.pct > 80 ? "bg-warning" : "bg-primary"}`}
                      style={{ width: `${Math.min(row.pct, 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-card-foreground">Situação dos cartões</h2>
          {cards.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="Nenhum cartão cadastrado" />
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {cards.map((card) => {
                const usado = transactions
                  .filter(
                    (t) =>
                      t.credit_card_id === card.id &&
                      t.type === "despesa" &&
                      notCancelled(t) &&
                      invoices.some((i) => i.id === t.invoice_id && i.status !== "paga"),
                  )
                  .reduce((s, t) => s + Number(t.amount), 0);
                const pct = card.credit_limit
                  ? (usado / Number(card.credit_limit)) * 100
                  : 0;
                return (
                  <li key={card.id}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate text-foreground">{card.name}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {brl(usado)} / {brl(Number(card.credit_limit))}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${pct > 90 ? "bg-destructive" : "bg-primary"}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-card-foreground">Maiores despesas</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {maiores.length === 0 && <li className="text-muted-foreground">Nada por aqui.</li>}
            {maiores.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-foreground">{t.description}</span>
                <span className="shrink-0 font-medium text-destructive">{brl(Number(t.amount))}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-card-foreground">Próximos vencimentos</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {proximos.length === 0 && <li className="text-muted-foreground">Nada previsto.</li>}
            {proximos.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-foreground">{t.description}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDateBR(t.due_date)}</span>
                <span
                  className={`shrink-0 font-medium ${t.type === "receita" ? "text-success" : "text-destructive"}`}
                >
                  {brl(Number(t.amount))}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-card-foreground">Últimas movimentações</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {ultimos.length === 0 && <li className="text-muted-foreground">Nada lançado ainda.</li>}
            {ultimos.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-foreground">{t.description}</span>
                <StatusBadge status={t.status} />
                <span className="shrink-0 font-medium text-foreground">{brl(Number(t.amount))}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
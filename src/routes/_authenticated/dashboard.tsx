import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, CreditCard, Scale, Wallet, AlertTriangle, ArrowRight, ListPlus, ClipboardCheck, Wrench } from "lucide-react";
import { MonthSelector } from "@/components/month-selector";
import { usePeriod } from "@/components/period-context";
import { PageHeader } from "@/components/ui-bits";
import { brl, brlCompact, monthLabel, round2, shortMonth, toISODate } from "@/lib/format";
import { buildCashResultsModel, type CashEvent } from "@/lib/cash-results-model";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import {
  cashBalance, isThirdPartyTransaction, monthTotals,
  realizedBalanceBefore,
  notCancelled,
} from "@/lib/derive";
import {
  useAccounts, useCards, useCategories, useInvoices, useTransactions,
  useBudgets, useProfile,
} from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [
    { title: "Painel — Gestão da Família" },
    { name: "description", content: "Situação financeira, evolução do caixa e próximas decisões." },
  ] }),
  component: Dashboard,
});

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}
function periodAfter(year: number, month: number, offset: number) {
  const d = new Date(year, month - 1 + offset, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
type CashTx = Tables<"transactions"> & { deleted_at?: string | null };
const cashEventTotal = (events: CashEvent[]) => events.reduce((total, event) => total + event.value, 0);

function Stat({ title, value, hint, tone = "default", icon: Icon, href }: {
  title: string; value: string; hint: string;
  tone?: "default" | "positive" | "negative" | "warning";
  icon: React.ComponentType<{ className?: string }>;
  href?: "/contas" | "/lancamentos" | "/planejamento" | "/cartoes" | "/fluxo-de-caixa";
}) {
  const colors = {default: "text-foreground", positive: "text-success", negative: "text-destructive", warning: "text-warning"};
  const content = <>
    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{title}</span><Icon className="h-4 w-4" /></div>
    <p className={`mt-3 text-xl font-bold tabular-nums ${colors[tone]}`}>{value}</p>
    <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
  </>;
  const className = "block min-w-0 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-surface-2/50";
  return href ? <Link to={href} className={className}>{content}</Link> : <div className={className}>{content}</div>;
}
function Dashboard() {
  const { month, year } = usePeriod();
  const accountsQuery = useAccounts();
  const { data: accounts = [] } = accountsQuery;
  const cardsQuery = useCards();
  const transactionsQuery = useTransactions();
  const { data: transactions = [] } = transactionsQuery;
  const categoriesQuery = useCategories();
  const { data: categories = [] } = categoriesQuery;
  const invoicesQuery = useInvoices();
  const { data: invoices = [] } = invoicesQuery;
  const budgetsQuery = useBudgets();
  const { data: budgets = [] } = budgetsQuery;
  const { data: profile } = useProfile();
  const familyId = profile?.family_id;

  const familyTransactions = useMemo(
    () => transactions.filter((t) => !isThirdPartyTransaction(categories, t)),
    [transactions, categories],
  );
  const totals = useMemo(() => monthTotals(familyTransactions, year, month), [familyTransactions, year, month]);
  const saldoAtual = useMemo(() => cashBalance(accounts, transactions), [accounts, transactions]);
  const saldoAnterior = useMemo(() => realizedBalanceBefore(familyTransactions, `${monthKey(year, month)}-01`), [familyTransactions, year, month]);
  const resultado = totals.resultado;

  // Aderencia do orcamento variavel deve ser medida pelos mesmos eventos de caixa
  // do Planejamento (4. Resultados), nunca pela apuracao antiga de /orcamento.
  const planKey = monthKey(year, month);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentIndex = currentYear * 12 + currentMonth - 1;
  const targetIndex = year * 12 + month - 1;
  // Mesma chave de cache, consulta paginada e apuracao do Fluxo de Caixa/4. Resultados.
  // Os dados resumidos dos hooks comuns nao substituem a leitura completa de transacoes.
  const cashTransactionsQuery = useQuery({
    queryKey: ["plan-modelo-a-read", familyId],
    enabled: !!familyId,
    queryFn: async () => {
      if (!familyId) return [] as CashTx[];
      const output: CashTx[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from("transactions")
          .select("*").eq("family_id", familyId).is("deleted_at", null)
          .order("id").range(offset, offset + 499);
        if (error) throw error;
        const page = data ?? [];
        output.push(...page);
        if (page.length < 500) break;
      }
      return output;
    },
  });
  const cashReady = !!familyId && !accountsQuery.isLoading && !cardsQuery.isLoading &&
    !invoicesQuery.isLoading && !categoriesQuery.isLoading && !budgetsQuery.isLoading &&
    !cashTransactionsQuery.isLoading && !accountsQuery.isError && !cardsQuery.isError &&
    !invoicesQuery.isError && !categoriesQuery.isError && !budgetsQuery.isError &&
    !cashTransactionsQuery.isError;
  const cashHasError = accountsQuery.isError || cardsQuery.isError || invoicesQuery.isError ||
    categoriesQuery.isError || budgetsQuery.isError || cashTransactionsQuery.isError;
  const today = toISODate(new Date());
  const nowKey = today.slice(0, 7);
  const cashModel = useMemo(() => buildCashResultsModel({
    accounts, cards: cardsQuery.data ?? [], invoices, categories,
    transactions: cashTransactionsQuery.data ?? [], budgets,
    family: familyId, today, now: nowKey,
  }), [accounts, cardsQuery.data, invoices, categories, cashTransactionsQuery.data, budgets, familyId, today, nowKey]);
  const monthCash = cashModel.row(monthKey(year, month));
  const cashToday = cashEventTotal(cashModel.actual) / 100;
  const pendingReceipts = cashEventTotal(monthCash.expected.filter((event) => event.kind === "receita")) / 100;
  const pendingPayments = -cashEventTotal(monthCash.expected.filter((event) => event.kind === "direta" || event.kind === "fatura")) / 100;
  const variableReserve = monthCash.reserve / 100;
  const netPending = round2(pendingReceipts - pendingPayments - variableReserve);
  const reconciledBalance = round2(monthCash.closing / 100);
  const cashTrend = useMemo(() => {
    const points: { name: string; realizado: number | null; projetado: number | null }[] = [];
    for (let i = -3; i < 0; i++) {
      const date = periodAfter(currentYear, currentMonth, i);
      points.push({ name: `${shortMonth(date.month)}/${String(date.year).slice(-2)}`,
        realizado: round2(cashModel.row(monthKey(date.year,date.month)).closing / 100), projetado: null });
    }
    points.push({ name: "Hoje", realizado: round2(cashToday), projetado: round2(cashToday) });
    for (let i = 0; i <= 3; i++) {
      const date = periodAfter(currentYear, currentMonth, i);
      points.push({ name: `${shortMonth(date.month)}/${String(date.year).slice(-2)}`,
        realizado: null, projetado: round2(cashModel.row(monthKey(date.year,date.month)).closing / 100) });
    }
    return points;
  }, [cashModel, cashToday, currentYear, currentMonth]);

  const targetInvoices = invoices.filter((i) => i.status !== "paga" && i.due_date.startsWith(monthKey(year,month)));
  const pendingInvoiceIds = new Set(targetInvoices.map((i) => i.id));
  const invoiceTotal = transactions
    .filter((t) => t.invoice_id && pendingInvoiceIds.has(t.invoice_id) && t.type === "despesa" && notCancelled(t))
    .reduce((sum, t) => sum + Number(t.amount), 0);
  const changeIsPositive = resultado >= 0;
  const variableBudgetExists = cashReady && monthCash.budget.exists;
  const variableLimit = variableBudgetExists
    ? round2(monthCash.budget.rows.reduce((sum, category) => sum + category.limit, 0) / 100)
    : null;
  const variableRegistered = cashReady ? round2(monthCash.variable / 100) : null;
  const variableDelta = variableLimit === null || variableRegistered === null
    ? null : round2(variableRegistered - variableLimit);
  const variablePercent = variableLimit !== null && variableLimit > 0 && variableRegistered !== null
    ? round2(variableRegistered / variableLimit * 100) : null;
  const variableExceeded = variableDelta !== null && variableDelta > 0;
  const variableRemaining = variableDelta !== null && variableDelta <= 0 ? round2(-variableDelta) : null;
  const planningSummary = !cashReady
    ? "Apurando..."
    : variableLimit === null ? "Sem limite" : variableExceeded
      ? `Excesso ${brl(variableDelta ?? 0)}` : `Dentro do limite`;
  const planningHint = !cashReady
    ? "Aguardando valores conciliados"
    : variableLimit === null
    ? "Limite variável não cadastrado"
    : variablePercent === null ? "Sem percentual de referência"
    : `Variáveis: ${variablePercent.toLocaleString("pt-BR", {maximumFractionDigits:1})}% do previsto`;
  const attentionTitle = !cashReady ? "Aguardando apuração do Planejamento"
    : variableLimit === null ? "Despesas variáveis sem planejamento"
    : variableExceeded ? `Despesas variáveis acima do limite em ${brl(variableDelta ?? 0)}`
    : "Despesas variáveis dentro do planejado";
  const attentionText = !cashReady
    ? (cashHasError ? "Não foi possível carregar os valores. Consulte o Planejamento." : "Carregando os valores conciliados com o Planejamento...")
    : variableLimit === null
      ? "Não há orçamento variável salvo para o período. Defina os limites antes de assumir novos compromissos."
      : variableExceeded
        ? `Você planejou ${brl(variableLimit)} e já registrou ${brl(variableRegistered ?? 0)} em despesas variáveis (${planningHint.replace("Variáveis: ", "")}). Apesar do resultado do caixa positivo de ${brl(resultado)}, o limite de consumo foi ultrapassado. Verifique as categorias responsáveis.`
        : `Foram registrados ${brl(variableRegistered ?? 0)} dos ${brl(variableLimit)} planejados em despesas variáveis. Restam ${brl(variableRemaining ?? 0)} até o limite; acompanhe as próximas compras.`;
  const monthIsCurrent = targetIndex === currentIndex;

  return <div className="space-y-5">
    <PageHeader title="Seu dinheiro, de hoje para o futuro" subtitle={monthLabel(month, year)} actions={<MonthSelector />} />
    <p className="text-xs text-muted-foreground">Indicadores familiares não incluem valores de terceiros. O horizonte de caixa utiliza a visão Geral, que pode incluí-los.</p>

    <section className="grid gap-4 xl:grid-cols-[1.15fr_1fr]" aria-label="Situação financeira">
      <div className="rounded-2xl border border-primary/30 bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-medium text-muted-foreground">Saldo atual das contas</p><span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">Realizado · hoje</span></div>
        <p className={`mt-4 text-3xl font-bold tabular-nums sm:text-4xl ${saldoAtual >= 0 ? "text-success" : "text-destructive"}`}>{brl(saldoAtual)}</p>
        <p className="mt-2 text-sm text-muted-foreground">Caixa das contas cadastradas, incluindo saldos iniciais quando aplicável.</p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded-lg bg-muted/60 px-3 py-2">Saldo anterior do período: <strong>{brl(saldoAnterior)}</strong></span>
          <span className="rounded-lg bg-muted/60 px-3 py-2">Resultado do mês: <strong className={changeIsPositive ? "text-success" : "text-destructive"}>{brl(resultado)}</strong></span>
        </div>
        <p className="mt-5 rounded-xl border border-border bg-muted/40 p-3 text-sm">
          <strong className="block">{changeIsPositive ? "O resultado realizado do período é positivo." : "As despesas realizadas superaram as receitas do período."}</strong>
          Entraram {brl(totals.receitasRealizadas)} e saíram {brl(totals.despesasRealizadas)} no mês selecionado. {monthIsCurrent ? "O mês ainda está em andamento." : "Confira o período selecionado para interpretar o fechamento."}
        </p>
        <Link to="/contas" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">Consultar contas <ArrowRight className="h-4 w-4" /></Link>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat title="Receitas recebidas" value={brl(totals.receitasRealizadas)} hint="Confirmadas no período" tone="positive" icon={ArrowUpRight} href="/lancamentos" />
        <Stat title="Despesas pagas" value={brl(totals.despesasRealizadas)} hint="Confirmadas no período" tone="negative" icon={ArrowDownRight} href="/lancamentos" />
        <Stat title="Resultado realizado" value={brl(resultado)} hint="Recebido menos pago" tone={resultado >= 0 ? "positive" : "negative"} icon={Scale} />
        <Stat title="Aderência ao planejamento" value={planningSummary} hint={planningHint} tone={variableExceeded ? "negative" : cashReady && variableLimit === null ? "warning" : variableLimit !== null ? "positive" : "default"} icon={ClipboardCheck} href="/planejamento" />
      </div>
    </section>

    <section className="grid gap-4 xl:grid-cols-[1.4fr_0.85fr]" aria-label="Evolução e decisões">
      <div className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div><h2 className="text-lg font-semibold">Como o mês está terminando?</h2><p className="text-xs text-muted-foreground">Caixa, pendências do período e perspectiva ao final do mês selecionado</p></div>
        {!cashReady ? <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          {cashHasError ? "Não foi possível carregar a apuração conciliada. Consulte o Fluxo de Caixa." : "Carregando apuração conciliada com o Fluxo de Caixa..."}
        </div> : <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Caixa hoje</p><p className="mt-2 text-lg font-semibold tabular-nums">{brl(cashToday)}</p><p className="text-xs text-muted-foreground">Regime de caixa · realizado</p></div>
          <div className="rounded-xl bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Impacto líquido pendente</p><p className={`mt-2 text-lg font-semibold tabular-nums ${netPending < 0 ? "text-warning" : "text-success"}`}>{brl(netPending)}</p><p className="text-xs text-muted-foreground">Receber {brl(pendingReceipts)} · pagar {brl(pendingPayments)} · reserva {brl(variableReserve)}</p></div>
          <div className="rounded-xl bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Saldo ao fim do mês selecionado</p><p className={`mt-2 text-lg font-semibold tabular-nums ${reconciledBalance >= 0 ? "text-success" : "text-destructive"}`}>{brl(reconciledBalance)}</p><p className="text-xs text-muted-foreground">Mesmo saldo do Fluxo de Caixa · visão Geral</p></div>
        </div>}
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold">Seu horizonte de caixa</h3><span className="text-xs text-muted-foreground">Regime de caixa · histórico e próximos 3 meses</span></div>
        {cashReady && <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={cashTrend} margin={{ top: 10, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 5" vertical={false} />
              <XAxis dataKey="name" stroke="var(--color-muted-foreground)" fontSize={11} />
              <YAxis stroke="var(--color-muted-foreground)" fontSize={11} width={78} tickFormatter={(v) => brlCompact(Number(v))} />
              <Tooltip formatter={(v, name) => [v == null ? "—" : brl(Number(v)), name === "realizado" ? "Saldo realizado" : "Saldo projetado"]} contentStyle={{background:"var(--color-popover)",border:"1px solid var(--color-border)",color:"var(--color-popover-foreground)",borderRadius:10}} />
              <Area type="monotone" dataKey="realizado" stroke="var(--color-chart-2)" fill="var(--color-chart-2)" fillOpacity={0.08} strokeWidth={2.5} connectNulls={false} />
              <Line type="monotone" dataKey="projetado" stroke="var(--color-chart-4)" strokeWidth={2.5} strokeDasharray="7 5" dot={{r:4}} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>}
        <p className="text-xs leading-relaxed text-muted-foreground">Valores conciliados com “4. Resultados” do Planejamento e com o Fluxo de Caixa na visão Geral. O trecho futuro incorpora compromissos conhecidos e a reserva variável; é uma projeção, não um pagamento já realizado. O impacto pendente é informativo e não será descontado novamente do saldo projetado.</p>
        <div className="flex flex-wrap gap-2"><Link to="/fluxo-de-caixa" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted">Ver fluxo de caixa</Link><Link to="/cartoes" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted">Consultar faturas</Link></div>
      </div>
      <div className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">O que merece atenção</h2><AlertTriangle className={`h-5 w-5 ${variableExceeded || (cashReady && variableLimit === null) ? "text-warning" : "text-muted-foreground"}`} /></div>
        <div className={`rounded-xl border-l-4 p-4 ${variableExceeded || (cashReady && variableLimit === null) ? "border-warning bg-warning/10" : "border-primary bg-muted/40"}`}>
          <p className="font-semibold">{attentionTitle}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{attentionText}</p>
          <Link to="/planejamento" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">Analisar despesas variáveis <ArrowRight className="h-4 w-4" /></Link>
        </div>
        <div className="rounded-xl border-l-4 border-primary bg-muted/40 p-4"><p className="font-semibold">{resultado >= 0 ? "Caixa realizado positivo" : "Caixa realizado negativo"}</p><p className="mt-2 text-sm leading-relaxed text-muted-foreground">O resultado realizado foi de {brl(resultado)}. Ele não equivale ao saldo disponível nas contas.</p></div>
        <h3 className="font-semibold">Sua próxima decisão</h3>
        <Link to="/saude-financeira" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90">Analisar saúde financeira <ArrowRight className="h-4 w-4" /></Link>
        <div className="border-t border-border pt-4"><p className="text-xs text-muted-foreground">Outros dados do período</p><div className="mt-3 grid grid-cols-2 gap-3 text-xs"><div>A receber <strong className="block text-sm">{brl(totals.aReceber)}</strong></div><div>A pagar <strong className="block text-sm">{brl(totals.aPagar)}</strong></div><div>Faturas abertas <strong className="block text-sm">{brl(invoiceTotal)}</strong></div><div>Saldo final (Fluxo) <strong className="block text-sm">{cashReady ? brl(reconciledBalance) : "—"}</strong></div></div></div>
      </div>
    </section>

    <section aria-label="Acesso rápido" className="rounded-2xl border border-border bg-card p-4 sm:p-5"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Acesso rápido</h2><span className="text-xs text-muted-foreground">Funcionalidades existentes</span></div><div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Link to="/contas" className="flex items-center gap-2 rounded-lg bg-muted/40 p-3 text-sm hover:bg-muted"><Wallet className="h-4 w-4" /> Minhas contas</Link>
      <Link to="/cartoes" className="flex items-center gap-2 rounded-lg bg-muted/40 p-3 text-sm hover:bg-muted"><CreditCard className="h-4 w-4" /> Cartões e faturas</Link>
      <Link to="/lancamentos" className="flex items-center gap-2 rounded-lg bg-muted/40 p-3 text-sm hover:bg-muted"><ListPlus className="h-4 w-4" /> Lançamentos</Link>
      <Link to="/saude-financeira" className="flex items-center gap-2 rounded-lg bg-muted/40 p-3 text-sm hover:bg-muted"><Scale className="h-4 w-4" /> Saúde financeira</Link>
    </div></section>
    <details className="rounded-xl border border-border bg-card p-4"><summary className="cursor-pointer text-sm font-semibold">Sua jornada financeira</summary><div className="mt-4 grid gap-2 md:grid-cols-3">
      <Link to="/cadastros" className="flex items-center gap-2 rounded-lg bg-muted/40 p-3 text-sm"><Wrench className="h-4 w-4" /> 1. Cadastros iniciais</Link>
      <Link to="/planejamento" className="flex items-center gap-2 rounded-lg bg-muted/40 p-3 text-sm"><ClipboardCheck className="h-4 w-4" /> 2. Planejamento</Link>
      <Link to="/lancamentos" className="flex items-center gap-2 rounded-lg bg-muted/40 p-3 text-sm"><ListPlus className="h-4 w-4" /> 3. Registrar e conciliar</Link>
    </div></details>
  </div>;
}

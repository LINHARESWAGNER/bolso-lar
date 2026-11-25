import { cashExpenseDate, cashExpensePaid } from "./budget-cash";
import type { Tables } from "./finance";
import { isThirdPartyTransaction } from "./derive";

type Transaction = Tables["transactions"]["Row"];
type Category = Tables["categories"]["Row"];
type Card = Tables["credit_cards"]["Row"];
type Asset = Tables["investment_assets"]["Row"];
type Movement = Tables["investment_movements"]["Row"];
type Budget = Tables["budgets"]["Row"] & { budget_items: Tables["budget_items"]["Row"][] };
type Group = Tables["installment_groups"]["Row"];
type Invoice = Tables["credit_card_invoices"]["Row"];
export type HealthMetricId = "budget" | "essential" | "debt" | "investment" | "reserve" | "cards";
export type HealthStatus = "saudavel" | "atencao" | "critico" | "insuficiente";
export type Settings = {
  essential_max_pct: number;
  debt_healthy_pct: number;
  debt_critical_pct: number;
  investment_target_pct: number;
  reserve_target_months: number;
  card_max_pct: number;
  budget_tolerance_pct: number;
};
export const DEFAULT_HEALTH_SETTINGS: Settings = {
  essential_max_pct: 60,
  debt_healthy_pct: 20,
  debt_critical_pct: 30,
  investment_target_pct: 20,
  reserve_target_months: 6,
  card_max_pct: 50,
  budget_tolerance_pct: 5,
};
export type HealthLine = {
  id: string;
  description: string;
  amount: number;
  category: string;
  date: string;
};
export type HealthMetric = {
  id: HealthMetricId;
  title: string;
  value: number | null;
  unit: "%" | "meses";
  status: HealthStatus;
  formula: string;
  numerator: number | null;
  denominator: number | null;
  lines: HealthLine[];
  note: string;
  target: string;
  recommendation: string;
  comparison?: number | null;
  extra?: string[];
  denominatorLines?: HealthLine[];
  debtBreakdown?: { bucket: DebtBucket; label: string; total: number; lines: HealthLine[] }[];
};
export type HealthData = {
  transactions: Transaction[];
  categories: Category[];
  cards: Card[];
  invoices: Invoice[];
  assets: Asset[];
  movements: Movement[];
  budgets: Budget[];
  groups: Group[];
  essentials: { category_id: string; is_essential: boolean }[];
  incomeClassifications?: {
    transaction_id: string;
    classification: "habitual" | "extraordinaria" | "ajuste_tecnico";
  }[];
  debtKinds: { installment_group_id: string; debt_kind: string }[];
};
/**
 * Exibe apenas grupos que possuem ao menos uma operação familiar, ou grupos
 * ainda sem lançamentos (cuja titularidade não pode ser inferida).
 * Se houver despesas familiares e de terceiros no mesmo grupo, mantém o
 * grupo para classificação, enquanto os cálculos filtram cada lançamento.
 */
export function familyInstallmentGroups<T extends Pick<Group, "id">>(
  groups: T[],
  transactions: Pick<Transaction, "installment_group_id" | "category_id">[],
  categories: Category[],
): T[] {
  const membership = new Map<string, { family: boolean; thirdParty: boolean }>();
  for (const transaction of transactions) {
    if (!transaction.installment_group_id) continue;
    const current = membership.get(transaction.installment_group_id) ?? {
      family: false,
      thirdParty: false,
    };
    if (isThirdPartyTransaction(categories, transaction)) current.thirdParty = true;
    else current.family = true;
    membership.set(transaction.installment_group_id, current);
  }
  return groups.filter((group) => {
    const state = membership.get(group.id);
    return !state || state.family || !state.thirdParty;
  });
}

export type DebtKind =
  | "emprestimo"
  | "financiamento"
  | "compra_parcelada"
  | "imposto_taxa_parcelada"
  | "acordo_renegociacao"
  | "outro_compromisso"
  | "nao_considerar"
  | "cartao_parcelado"
  | "nao_divida";
export type DebtBucket = "financial" | "purchases" | "taxes" | "other";
export const DEBT_LABELS: Record<DebtKind, string> = {
  emprestimo: "Empréstimo",
  financiamento: "Financiamento",
  compra_parcelada: "Compra parcelada",
  imposto_taxa_parcelada: "Imposto ou taxa parcelada",
  acordo_renegociacao: "Acordo ou renegociação",
  outro_compromisso: "Outro compromisso parcelado",
  nao_considerar: "Não considerar",
  cartao_parcelado: "Compra parcelada no cartão",
  nao_divida: "Não considerar (legado)",
};
export const DEBT_BUCKET_LABELS: Record<DebtBucket, string> = {
  financial: "Dívidas financeiras",
  purchases: "Compras parceladas",
  taxes: "Impostos e taxas parceladas",
  other: "Outros compromissos parcelados",
};
export function debtBucket(kind: string | undefined): DebtBucket | null {
  switch (kind) {
    case "emprestimo":
    case "financiamento":
    case "acordo_renegociacao":
      return "financial";
    case "cartao_parcelado":
    case "compra_parcelada":
      return "purchases";
    case "imposto_taxa_parcelada":
      return "taxes";
    case "outro_compromisso":
      return "other";
    default:
      return null;
  }
}
/** Uma marcação explícita na categoria filha prevalece sobre a herdada. */
export function resolveEssential(
  categoryId: string | null,
  categories: Pick<Category, "id" | "parent_id">[],
  rules: { category_id: string; is_essential: boolean }[],
): boolean | null {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const explicit = new Map(rules.map((rule) => [rule.category_id, rule.is_essential]));
  let id = categoryId;
  const visited = new Set<string>();
  while (id && !visited.has(id)) {
    visited.add(id);
    if (explicit.has(id)) return explicit.get(id)!;
    const current = byId.get(id);
    if (!current) return null;
    id = current.parent_id;
  }
  return null;
}
export type HealthPeriod = { start: string; end: string; months: number };
const amount = (value: number | string) => Number(value) || 0;
const sum = (rows: { amount: number }[]) => rows.reduce((n, row) => n + amount(row.amount), 0);
const safePct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);
const within = (date: string | null, period: HealthPeriod) =>
  !!date && date >= period.start && date <= period.end;
const makeLine = (t: Transaction, categoryNames: Map<string, string>): HealthLine => ({
  id: t.id,
  description: t.description,
  amount: amount(t.amount),
  category: categoryNames.get(t.category_id ?? "") ?? "Sem categoria",
  date: t.competence_date,
});
export function shiftPeriod(period: HealthPeriod): HealthPeriod {
  const [year, month] = period.start.split("-").map(Number);
  const start = new Date(year, month - 1 - period.months, 1);
  const end = new Date(year, month - 1, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: fmt(start), end: fmt(end), months: period.months };
}
export function buildFinancialHealth(
  data: HealthData,
  settings: Settings,
  period: HealthPeriod,
  today: string,
): HealthMetric[] {
  const end = period.end < today ? period.end : today;
  const realPeriod = { ...period, end };
  const names = new Map(data.categories.map((c) => [c.id, c.name]));

  const kinds = new Map(data.debtKinds.map((d) => [d.installment_group_id, d.debt_kind]));
  const groups = new Map(data.groups.map((g) => [g.id, g]));
  const eligible = data.transactions.filter(
    (t) =>
      t.type !== "pagamento_fatura" &&
      t.type !== "transferencia" &&
      t.status !== "cancelado" &&
      !isThirdPartyTransaction(data.categories, t),
  );
  const received = eligible.filter(
    (t) =>
      t.type === "receita" &&
      t.status === "pago" &&
      within(t.paid_date ?? t.due_date ?? t.competence_date, realPeriod),
  );
  const income = sum(received);
  // Despesas realizadas: uma compra/parcela por ID, pelo pagamento/vencimento em caixa.
  // A compra no cartao so esta paga quando sua fatura estiver liquidada.
  const expenseInvoices = new Map(data.invoices.map(i => [i.id, i]));
  const expenseCashLine = (t: Transaction): HealthLine => ({ ...makeLine(t, names), date: cashExpenseDate(t, expenseInvoices) ?? t.competence_date });
  const expenses = eligible.filter(
    (t) =>
      t.type === "despesa" &&
      cashExpensePaid(t, expenseInvoices) &&
      within(cashExpenseDate(t, expenseInvoices), period) &&
      (cashExpenseDate(t, expenseInvoices) ?? "") <= today,
  );
  const essentialStatus = (t: Transaction) =>
    resolveEssential(t.category_id, data.categories, data.essentials);
  // Essenciais por caixa: receitas no pagamento/vencimento e compras na fatura,
  // incluindo status pago e previsto; nao contabilizar a liquidacao da fatura duas vezes.
  const excludedIncomeIds = new Set(
    (data.incomeClassifications ?? [])
      .filter((row) => row.classification !== "habitual")
      .map((row) => row.transaction_id),
  );
  const essentialIncomeRows = eligible.filter(
    (t) =>
      t.type === "receita" && within(t.status === "pago" ? (t.paid_date ?? t.due_date ?? t.competence_date) : (t.due_date ?? t.competence_date), period) && !excludedIncomeIds.has(t.id),
  );
  const essentialIncome = sum(essentialIncomeRows);
  const essentialCandidateExpenses = eligible.filter(
    (t) => t.type === "despesa" && within(cashExpenseDate(t, expenseInvoices), period),
  );
  const excludedInvestmentCategory = (id: string | null): boolean => {
    const byId = new Map(data.categories.map((c) => [c.id, c]));
    let cat = id ? byId.get(id) : undefined;
    const seen = new Set<string>();
    while (cat && !seen.has(cat.id)) {
      seen.add(cat.id);
      if (/^(investimentos?|aportes?)(\b|\s|$)/i.test(cat.name)) return true;
      cat = cat.parent_id ? byId.get(cat.parent_id) : undefined;
    }
    return false;
  };
  const essentialMissing = essentialCandidateExpenses.some(
    (t) => !excludedInvestmentCategory(t.category_id) && essentialStatus(t) === null,
  );
  const essentialRegisteredExpenses = essentialCandidateExpenses.filter(
    (t) => essentialStatus(t) === true && !excludedInvestmentCategory(t.category_id),
  );
  // A reserva preserva sua base anterior de custo efetivamente realizado.
  const essentialExpenses = expenses.filter(
    (t) => essentialStatus(t) === true && !excludedInvestmentCategory(t.category_id),
  );
  const reserveEssentialMissing = expenses.some((t) => essentialStatus(t) === null);
  // Aderência usa despesas variáveis por mês de caixa (pagas e previstas).
  // Cada compra/parcela do cartão entra uma vez pela fatura; transferências, terceiros
  // e cancelamentos já foram excluídos em eligible. Não altera o monitor do mês corrente.
  const budgetInvoiceById = new Map(data.invoices.map(i => [i.id, i]));
  const budgetRows = data.budgets.filter((b) => within(b.reference_month, period));
  const variableBudget = budgetRows.reduce(
    (total, b) => total + b.budget_items.reduce((n, i) => n + amount(i.amount), 0),
    0,
  );
  const variableExpenses = eligible.filter(
    (t) =>
      t.type === "despesa" && t.expense_nature === "variavel" && within(cashExpenseDate(t, budgetInvoiceById), period),
  );
  const variableSpent = sum(variableExpenses);
  const budgetComponents: HealthLine[] = budgetRows.flatMap((b) =>
    b.budget_items.map((i) => ({
      id: i.id,
      description: "Limite variável",
      amount: amount(i.amount),
      category: names.get(i.category_id) ?? "Categoria",
      date: b.reference_month,
    })),
  );
  const budgetDeviation =
    budgetRows.length && variableBudget > 0 && period.end < today
      ? ((variableSpent - variableBudget) / variableBudget) * 100
      : null;
  const budgetStatus: HealthStatus =
    budgetDeviation === null
      ? "insuficiente"
      : budgetDeviation <= settings.budget_tolerance_pct
        ? "saudavel"
        : budgetDeviation <= settings.budget_tolerance_pct * 3
          ? "atencao"
          : "critico";
  // O tipo explícito prevalece; cartão sem classificação é detectado automaticamente.
  // nao_considerar e nao_divida (legado) são exclusões explícitas, inclusive no cartão.
  const debtClassification = (t: Transaction): DebtBucket | null => {
    if (!t.installment_group_id) return null;
    const kind =
      kinds.get(t.installment_group_id) ??
      (groups.get(t.installment_group_id)?.credit_card_id || t.credit_card_id
        ? "cartao_parcelado"
        : undefined);
    return debtBucket(kind);
  };
  const debtExpenses = expenses.filter((t) => debtClassification(t) !== null);
  const breakdown = (Object.keys(DEBT_BUCKET_LABELS) as DebtBucket[]).map((bucket) => {
    const lines = debtExpenses
      .filter((t) => debtClassification(t) === bucket)
      .map(expenseCashLine);
    return { bucket, label: DEBT_BUCKET_LABELS[bucket], total: sum(lines), lines };
  });
  const debtMissing = familyInstallmentGroups(data.groups, data.transactions, data.categories).some(
    (g) => !g.deleted_at && !g.credit_card_id && !kinds.has(g.id),
  );
  const movementRows = data.movements.filter(
    (m) => within(m.movement_date, realPeriod) && (m.type === "aporte" || m.type === "resgate"),
  );
  const netInvested = movementRows.reduce(
    (n, m) => n + (m.type === "aporte" ? amount(m.amount) : -amount(m.amount)),
    0,
  );
  const reserved = data.assets.filter((a) => a.is_active && a.is_emergency_reserve);
  const liquidReserve = reserved.filter((a) => a.liquidity === "imediata" || a.liquidity === "d_1");
  const reserveTotal = reserved.reduce((n, a) => n + amount(a.current_balance), 0);
  const liquidTotal = liquidReserve.reduce((n, a) => n + amount(a.current_balance), 0);
  // Referência mensal: despesas essenciais realizadas / meses do intervalo, sempre que houver dados.
  const essentialMonthly = period.months > 0 ? sum(essentialExpenses) / period.months : 0;
  const activeCards = data.cards.filter((c) => c.is_active);
  const totalLimit = activeCards.reduce((n, c) => n + amount(c.credit_limit), 0);
  const activeCardIds = new Set(activeCards.map((c) => c.id));
  const invoiceById = new Map(data.invoices.map((i) => [i.id, i]));
  // A liquidação da fatura é a fonte de verdade do saldo comprometido, não o status da compra.
  // Parcelas futuras permanecem comprometidas, mesmo quando a compra original foi quitada.
  const cardPurchases = eligible.filter(
    (t) =>
      t.type === "despesa" &&
      !!t.credit_card_id &&
      activeCardIds.has(t.credit_card_id) &&
      t.competence_date <= today &&
      (!t.invoice_id || invoiceById.get(t.invoice_id)?.status !== "paga"),
  );
  const futureCardInstallments = eligible.filter(
    (t) =>
      t.type === "despesa" &&
      !!t.credit_card_id &&
      activeCardIds.has(t.credit_card_id) &&
      !!t.installment_group_id &&
      t.competence_date > today &&
      (!t.invoice_id || invoiceById.get(t.invoice_id)?.status !== "paga"),
  );
  const outstanding = [...cardPurchases, ...futureCardInstallments];
  const byCard = activeCards.map((c) => ({
    card: c,
    used: sum(outstanding.filter((t) => t.credit_card_id === c.id)),
  }));
  const topCard = byCard
    .filter((x) => amount(x.card.credit_limit) > 0)
    .sort((a, b) => b.used / amount(b.card.credit_limit) - a.used / amount(a.card.credit_limit))[0];
  const horizon = new Date(`${today}T12:00:00`);
  horizon.setDate(horizon.getDate() + 90);
  const horizonISO = `${horizon.getFullYear()}-${String(horizon.getMonth() + 1).padStart(2, "0")}-${String(horizon.getDate()).padStart(2, "0")}`;
  const next90 = outstanding.filter(
    (t) =>
      !!t.installment_group_id &&
      (t.due_date ?? t.competence_date) > today &&
      (t.due_date ?? t.competence_date) <= horizonISO,
  );
  const over = (value: number | null, limit: number): HealthStatus =>
    value === null
      ? "insuficiente"
      : value <= limit
        ? "saudavel"
        : value <= limit * 1.2
          ? "atencao"
          : "critico";
  const under = (value: number | null, target: number): HealthStatus =>
    value === null
      ? "insuficiente"
      : value >= target
        ? "saudavel"
        : value >= target * 0.75
          ? "atencao"
          : "critico";
  const make = (
    id: HealthMetricId,
    title: string,
    value: number | null,
    status: HealthStatus,
    formula: string,
    numerator: number | null,
    denominator: number | null,
    lines: HealthLine[],
    note: string,
    target: string,
    recommendation: string,
    extra?: string[],
    denominatorLines?: HealthLine[],
  ): HealthMetric => ({
    id,
    title,
    value,
    status,
    formula,
    numerator,
    denominator,
    lines,
    note,
    target,
    recommendation,
    unit: id === "reserve" ? "meses" : "%",
    extra,
    denominatorLines,
  });
  return [
    make(
      "budget",
      "Aderência ao orçamento variável",
      budgetDeviation,
      budgetStatus,
      "(despesa variável registrada − limite variável planejado) / limite planejado × 100",
      variableSpent,
      variableBudget,
      variableExpenses.map((t) => ({ ...makeLine(t, names), date: cashExpenseDate(t, budgetInvoiceById) ?? t.competence_date })),
      period.end >= today
        ? "Mês em andamento: diagnóstico definitivo somente após o fechamento. O cálculo considera despesas variáveis registradas, pagas e previstas."
        : !budgetRows.length || variableBudget <= 0
          ? variableSpent > 0
            ? "Despesa não planejada: gastos variáveis registrados (pagos e previstos) sem limite mensal cadastrado."
            : "Não há orçamento variável válido salvo para o mês."
          : budgetDeviation !== null && budgetDeviation < 0
            ? "Gastos variáveis registrados (pagos e previstos) abaixo do limite planejado. Não é uma situação crítica."
            : "Considera despesas variáveis registradas, pagas e previstas pelo mês de caixa. Compras e parcelas do cartão entram uma vez pela fatura; terceiros e pagamentos de fatura não são contados novamente.",
      `Estouro máximo de ${settings.budget_tolerance_pct}%`,
      budgetDeviation !== null && budgetDeviation > settings.budget_tolerance_pct
        ? "Revise as categorias variáveis que ultrapassaram o teto mensal."
        : "Mantenha o controle dos limites variáveis.",
      undefined,
      budgetComponents,
    ),
    make(
      "essential",
      "Comprometimento com essenciais",
      essentialMissing ? null : safePct(sum(essentialRegisteredExpenses), essentialIncome),
      essentialMissing
        ? "insuficiente"
        : over(
            safePct(sum(essentialRegisteredExpenses), essentialIncome),
            settings.essential_max_pct,
          ),
      "despesas essenciais registradas / receitas registradas × 100 (mês de caixa)",
      sum(essentialRegisteredExpenses),
      essentialIncome,
      essentialRegisteredExpenses.map(expenseCashLine),
      essentialMissing
        ? "Há despesas sem definição de essencial (própria ou herdada). Classifique essas categorias para concluir o indicador."
        : essentialIncome <= 0
          ? "Não há receitas registradas para pagamento neste mês."
          : "Mês de caixa: inclui receitas habituais e despesas essenciais pagas ou previstas pelo vencimento/pagamento; no cartão, pela fatura. Receitas extraordinárias e ajustes técnicos não entram na renda de referência.",
      `Até ${settings.essential_max_pct}%`,
      "Compare os gastos essenciais com a renda planejada e identifique as categorias de maior impacto.",
      undefined,
      essentialIncomeRows.map((t) => ({ ...makeLine(t, names), date: (t.status === "pago" ? (t.paid_date ?? t.due_date ?? t.competence_date) : (t.due_date ?? t.competence_date)) })),
    ),
    {
      ...make(
        "debt",
        "Comprometimento da renda com dívidas e parcelas",
        debtMissing ? null : safePct(sum(debtExpenses), income),
        debtMissing
          ? "insuficiente"
          : safePct(sum(debtExpenses), income) === null
            ? "insuficiente"
            : (safePct(sum(debtExpenses), income) ?? 0) <= settings.debt_healthy_pct
              ? "saudavel"
              : (safePct(sum(debtExpenses), income) ?? 0) <= settings.debt_critical_pct
                ? "atencao"
                : "critico",
        "total das parcelas consideradas no período / renda efetivamente recebida × 100",
        sum(debtExpenses),
        income,
        debtExpenses.map(expenseCashLine),
        debtMissing
          ? "Classifique compromissos parcelados fora do cartão. Compras parceladas no cartão são identificadas automaticamente."
          : "Exclui compras à vista, transferências, terceiros e pagamento/consolidação de fatura.",
        `Saudável até ${settings.debt_healthy_pct}%; crítico acima de ${settings.debt_critical_pct}%`,
        "Priorize a redução de parcelas e evite novos financiamentos.",
        undefined,
        received.map((t) => makeLine(t, names)),
      ),
      debtBreakdown: breakdown,
    },
    make(
      "investment",
      "Taxa de investimento líquida",
      safePct(netInvested, income),
      under(safePct(netInvested, income), settings.investment_target_pct),
      "(aportes − resgates) / renda efetivamente recebida × 100",
      netInvested,
      income,
      movementRows.map((m) => ({
        id: m.id,
        description: `${m.type === "aporte" ? "Aporte" : "Resgate"} · ${data.assets.find((a) => a.id === m.investment_id)?.name ?? "Investimento"}`,
        amount: m.type === "aporte" ? amount(m.amount) : -amount(m.amount),
        category: "Investimentos",
        date: m.movement_date,
      })),
      "Não inclui rendimentos, dividendos reinvestidos ou ajustes de saldo.",
      `Pelo menos ${settings.investment_target_pct}%`,
      "Programe aportes regulares sem comprometer a reserva.",
      undefined,
      received.map((t) => makeLine(t, names)),
    ),
    make(
      "reserve",
      "Cobertura da reserva",
      reserveEssentialMissing || essentialMonthly <= 0 || reserved.length === 0
        ? null
        : liquidTotal / essentialMonthly,
      reserveEssentialMissing || essentialMonthly <= 0 || reserved.length === 0
        ? "insuficiente"
        : under(liquidTotal / essentialMonthly, settings.reserve_target_months),
      "reserva imediata ou D+1 / custo essencial mensal",
      liquidTotal,
      essentialMonthly,
      liquidReserve.map((a) => ({
        id: a.id,
        description: a.name,
        amount: amount(a.current_balance),
        category: a.liquidity,
        date: a.balance_date,
      })),
      reserved.length === 0
        ? "Marque os investimentos destinados à reserva de emergência."
        : essentialMonthly <= 0
          ? "É necessário ter despesas essenciais classificadas e realizadas."
          : "Saldo atual da reserva (não é saldo histórico). Referência de despesas essenciais do período selecionado.",
      `${settings.reserve_target_months} meses`,
      "Reforce a parcela da reserva com liquidez imediata ou D+1.",
      [
        `Patrimônio total destinado à reserva: R$ ${reserveTotal.toFixed(2)}`,
        `Cobertura total: ${essentialMonthly > 0 ? (reserveTotal / essentialMonthly).toFixed(1) : "—"} meses`,
      ],
      essentialExpenses.map(expenseCashLine),
    ),
    make(
      "cards",
      "Limite dos cartões comprometido",
      safePct(sum(outstanding), totalLimit),
      totalLimit <= 0
        ? "insuficiente"
        : over(safePct(sum(outstanding), totalLimit), settings.card_max_pct),
      "compras em aberto e parcelas futuras / limite total ativo × 100",
      sum(outstanding),
      totalLimit,
      outstanding.map((t) => makeLine(t, names)),
      totalLimit <= 0
        ? "Cadastre limite positivo para os cartões ativos."
        : "Apuração atual, independente do filtro histórico; exclui faturas pagas e pagamentos de fatura.",
      `Até ${settings.card_max_pct}%`,
      "Reduza os compromissos futuros antes de novas compras.",
      [
        `Limite total: R$ ${totalLimit.toFixed(2)}`,
        `Limite disponível: R$ ${(totalLimit - sum(outstanding)).toFixed(2)}`,
        `Cartão mais comprometido: ${topCard?.card.name ?? "Não identificado"}`,
        `Parcelas dos próximos 90 dias: R$ ${sum(next90).toFixed(2)}`,
      ],
      activeCards.map((c) => ({
        id: c.id,
        description: c.name,
        amount: amount(c.credit_limit),
        category: "Limite cadastrado",
        date: today,
      })),
    ),
  ];
}

/** Monitor do mês corrente: realizado e compromissos variáveis conhecidos, sem previsão linear. */
export function variableBudgetMonitor(data: HealthData, period: HealthPeriod, today: string) {
  const monthBudgets = data.budgets.filter((b) => within(b.reference_month, period));
  const budget = monthBudgets.reduce(
    (n, b) => n + b.budget_items.reduce((a, i) => a + amount(i.amount), 0),
    0,
  );
  const invoiceById = new Map(data.invoices.map(i => [i.id, i]));
  const eligible = data.transactions.filter(
    (t) =>
      t.type === "despesa" &&
      t.expense_nature === "variavel" &&
      t.status !== "cancelado" &&
      within(cashExpenseDate(t, invoiceById), period) &&
      !isThirdPartyTransaction(data.categories, t),
  );
  const realizedRows = eligible.filter((t) => cashExpensePaid(t, invoiceById));
  const pending = eligible.filter((t) => !cashExpensePaid(t, invoiceById));
  const realized = sum(realizedRows);
  const committed = sum(pending);
  return {
    budget,
    realized,
    committed,
    remaining: budget - realized - committed,
    hasBudget: monthBudgets.length > 0 && budget > 0,
    lines: eligible.map((t) => ({ ...makeLine(t, new Map(data.categories.map((c) => [c.id, c.name]))), date: cashExpenseDate(t, invoiceById) ?? t.competence_date })),
  };
}

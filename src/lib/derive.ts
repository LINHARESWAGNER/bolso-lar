import {
  accountBalance,
  monthRange,
  type Account,
  type Category,
  type Transaction,
} from "./finance";
import { round2 } from "./format";

export type OutflowKind = "recorrente" | "parcelado" | "pontual";

/** Classifica uma saída prevista para o fluxo de caixa. */
export function outflowKind(t: Transaction): OutflowKind {
  if (t.installment_group_id) return "parcelado";
  if (t.recurring_id) return "recorrente";
  return "pontual";
}

export const inMonth = (iso: string | null, year: number, month: number) => {
  if (!iso) return false;
  const { start, end } = monthRange(year, month);
  return iso >= start && iso <= end;
};

export const notCancelled = (t: Transaction) => t.status !== "cancelado";

/**
 * Data que define em qual orçamento mensal uma despesa variável deve entrar:
 * fatura para cartão; pagamento efetivo (ou vencimento previsto) para conta.
 */
export const budgetRefDate = (t: Transaction) =>
  t.credit_card_id
    ? (t.due_date ?? t.competence_date)
    : (t.paid_date ?? t.due_date ?? t.competence_date);

export const variableExpensesForMonth = (txs: Transaction[], year: number, month: number) =>
  txs.filter(
    (t) =>
      t.type === "despesa" &&
      t.expense_nature === "variavel" &&
      notCancelled(t) &&
      inMonth(budgetRefDate(t), year, month),
  );

export function variableBudgetForMonth(
  periods: { starts_on: string; ends_on: string; monthly_amount: number }[],
  year: number,
  month: number,
) {
  const reference = monthRange(year, month).start;
  const period = periods.find((p) => p.starts_on <= reference && p.ends_on >= reference);
  if (period) {
    return {
      amount: Number(period.monthly_amount),
      usesDefault: false,
      isPastWithoutBudget: false,
    };
  }

  const now = new Date();
  const isPastWithoutBudget =
    year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);

  return {
    amount: isPastWithoutBudget ? 0 : 3500,
    usesDefault: !isPastWithoutBudget,
    isPastWithoutBudget,
  };
}

/** Data de referência usada nas listagens: pagamento › vencimento › competência. */
export const refDate = (t: Transaction) => t.paid_date ?? t.due_date ?? t.competence_date;

export function cashBalance(accounts: Account[], txs: Transaction[]) {
  return accounts
    .filter((a) => a.is_active && a.include_in_cash)
    .reduce((sum, a) => sum + accountBalance(a, txs), 0);
}

export function monthTotals(txs: Transaction[], year: number, month: number) {
  // Receitas seguem a competência. Despesas seguem o vencimento (mês em que
  // impactam o orçamento/fatura), usando a competência apenas quando não há
  // uma data de vencimento cadastrada.
  const receitas = txs
    .filter(
      (t) => t.type === "receita" && notCancelled(t) && inMonth(t.competence_date, year, month),
    )
    .reduce((s, t) => s + Number(t.amount), 0);
  const despesas = txs
    .filter(
      (t) =>
        t.type === "despesa" &&
        notCancelled(t) &&
        inMonth(t.due_date ?? t.competence_date, year, month),
    )
    .reduce((s, t) => s + Number(t.amount), 0);

  // O resultado mensal representa somente o que efetivamente entrou ou saiu
  // no mês. Para dados antigos sem paid_date, mantemos uma data de fallback.
  const realized = txs.filter(
    (t) =>
      (t.type === "receita" || t.type === "despesa") &&
      t.status === "pago" &&
      inMonth(t.paid_date ?? t.due_date ?? t.competence_date, year, month),
  );
  const receitasRealizadas = realized
    .filter((t) => t.type === "receita")
    .reduce((s, t) => s + Number(t.amount), 0);
  const despesasRealizadas = realized
    .filter((t) => t.type === "despesa")
    .reduce((s, t) => s + Number(t.amount), 0);

  const aPagar = txs
    .filter(
      (t) =>
        t.type === "despesa" &&
        notCancelled(t) &&
        t.status !== "pago" &&
        inMonth(t.due_date ?? t.competence_date, year, month),
    )
    .reduce((s, t) => s + Number(t.amount), 0);

  const aReceber = txs
    .filter(
      (t) =>
        t.type === "receita" &&
        notCancelled(t) &&
        t.status !== "pago" &&
        inMonth(t.due_date ?? t.competence_date, year, month),
    )
    .reduce((s, t) => s + Number(t.amount), 0);

  return {
    receitas: round2(receitas),
    despesas: round2(despesas),
    receitasRealizadas: round2(receitasRealizadas),
    despesasRealizadas: round2(despesasRealizadas),
    resultado: round2(receitasRealizadas - despesasRealizadas),
    aPagar: round2(aPagar),
    aReceber: round2(aReceber),
  };
}

/** Rótulo "Categoria › Subcategoria". */
export function categoryPath(categories: Category[], id: string | null) {
  if (!id) return "Sem categoria";
  const cat = categories.find((c) => c.id === id);
  if (!cat) return "Sem categoria";
  const parent = cat.parent_id ? categories.find((c) => c.id === cat.parent_id) : null;
  return parent ? `${parent.name} › ${cat.name}` : cat.name;
}

/** Agrupa despesas por categoria raiz. */
export function expensesByRootCategory(txs: Transaction[], categories: Category[]) {
  const map = new Map<string, { name: string; value: number }>();
  for (const t of txs) {
    if (t.type !== "despesa" || !notCancelled(t)) continue;
    const cat = categories.find((c) => c.id === t.category_id);
    const root = cat?.parent_id ? categories.find((c) => c.id === cat.parent_id) : cat;
    const key = root?.id ?? "sem";
    const name = root?.name ?? "Sem categoria";
    const current = map.get(key) ?? { name, value: 0 };
    current.value += Number(t.amount);
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

/** Soma das despesas (competência) de uma categoria e suas subcategorias. */
export function realizedForCategory(
  txs: Transaction[],
  categories: Category[],
  categoryId: string,
  year: number,
  month: number,
) {
  const ids = new Set<string>([categoryId]);
  for (const c of categories) if (c.parent_id === categoryId) ids.add(c.id);
  const scoped = txs.filter(
    (t) =>
      t.type === "despesa" &&
      notCancelled(t) &&
      t.category_id &&
      ids.has(t.category_id) &&
      inMonth(t.competence_date, year, month),
  );
  return {
    realizado: scoped.filter((t) => t.status === "pago").reduce((s, t) => s + Number(t.amount), 0),
    comprometido: scoped
      .filter((t) => t.status !== "pago")
      .reduce((s, t) => s + Number(t.amount), 0),
  };
}

/**
 * Sobra de orçamento de um mês: para cada categoria orçada, o que ainda não
 * foi lançado (planejado − realizado − previsto). Usado no fluxo de caixa
 * apenas para meses futuros.
 */
export function budgetRemaining(
  budgets: { reference_month: string; budget_items: { category_id: string; amount: number }[] }[],
  txs: Transaction[],
  categories: Category[],
  year: number,
  month: number,
) {
  const reference = monthRange(year, month).start;
  const budget = budgets.find((b) => b.reference_month === reference);
  if (!budget) return 0;
  return budget.budget_items.reduce((sum, item) => {
    const { realizado, comprometido } = realizedForCategory(
      txs,
      categories,
      item.category_id,
      year,
      month,
    );
    return sum + Math.max(Number(item.amount) - realizado - comprometido, 0);
  }, 0);
}

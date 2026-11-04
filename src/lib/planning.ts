export type PlanningTransaction = {
  amount: number;
  category_id: string | null;
  competence_date: string;
  expense_nature: "fixo" | "variavel" | null;
  installment_group_id: string | null;
  status: string;
  type: string;
};

export type MonthlyBudget = {
  reference_month: string;
  budget_items: { category_id: string; amount: number }[];
};

export type LegacyVariableBudget = {
  starts_on: string;
  ends_on: string;
  monthly_amount: number;
};

export const planningMonthKey = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, "0")}`;

function previousMonth(year: number, month: number, offset: number) {
  const date = new Date(year, month - 1 - offset, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

export function variableBudgetSuggestions(
  transactions: PlanningTransaction[],
  year: number,
  month: number,
) {
  const months = [3, 2, 1].map((offset) => previousMonth(year, month, offset));
  const keys = months.map(({ year: itemYear, month: itemMonth }) =>
    planningMonthKey(itemYear, itemMonth),
  );
  const eligible = transactions.filter(
    (transaction) =>
      transaction.type === "despesa" &&
      transaction.expense_nature === "variavel" &&
      transaction.status !== "cancelado" &&
      keys.some((key) => transaction.competence_date.startsWith(key)),
  );
  const monthsWithData = new Set(
    eligible.map((transaction) => transaction.competence_date.slice(0, 7)),
  );
  const hasEnoughHistory = keys.every((key) => monthsWithData.has(key));
  const totals = new Map<string, number>();

  if (hasEnoughHistory) {
    for (const transaction of eligible) {
      if (!transaction.category_id) continue;
      totals.set(
        transaction.category_id,
        (totals.get(transaction.category_id) ?? 0) + Number(transaction.amount),
      );
    }
  }

  return {
    hasEnoughHistory,
    months: keys,
    suggestions: new Map(
      [...totals.entries()].map(([categoryId, total]) => [
        categoryId,
        Math.round((total / 3) * 100) / 100,
      ]),
    ),
  };
}

export function monthlyVariableBudget(
  budgets: MonthlyBudget[],
  legacyPeriods: LegacyVariableBudget[],
  year: number,
  month: number,
) {
  const key = planningMonthKey(year, month);
  const monthly = budgets.find((budget) => budget.reference_month.startsWith(key));
  if (monthly) {
    return monthly.budget_items.reduce((sum, item) => sum + Number(item.amount), 0);
  }
  const reference = `${planningMonthKey(year, month)}-01`;
  const legacy = legacyPeriods.find(
    (period) => period.starts_on <= reference && period.ends_on >= reference,
  );
  if (legacy) return Number(legacy.monthly_amount);

  const now = new Date();
  const isPast =
    year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);
  return isPast ? 0 : 3500;
}

export function annualPlanningRows(
  transactions: PlanningTransaction[],
  budgets: MonthlyBudget[],
  legacyPeriods: LegacyVariableBudget[],
  year: number,
) {
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const key = planningMonthKey(year, month);
    const rows = transactions.filter(
      (transaction) =>
        transaction.status !== "cancelado" && transaction.competence_date.startsWith(key),
    );
    const income = rows
      .filter((transaction) => transaction.type === "receita")
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
    const installments = rows
      .filter(
        (transaction) =>
          transaction.type === "despesa" && transaction.installment_group_id !== null,
      )
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
    const fixed = rows
      .filter(
        (transaction) =>
          transaction.type === "despesa" &&
          transaction.expense_nature === "fixo" &&
          transaction.installment_group_id === null,
      )
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
    const variable = monthlyVariableBudget(budgets, legacyPeriods, year, month);
    const realizedIncome = rows
      .filter((transaction) => transaction.type === "receita" && transaction.status === "pago")
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
    const realizedExpenses = rows
      .filter((transaction) => transaction.type === "despesa" && transaction.status === "pago")
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0);

    return {
      month,
      income,
      fixed,
      variable,
      installments,
      plannedResult: income - fixed - variable - installments,
      realizedResult: realizedIncome - realizedExpenses,
    };
  });
}

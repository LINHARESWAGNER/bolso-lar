export type Plan = {
  id: string;
  name: string;
  current_balance: number;
  initial_balance: number;
  plan_start_date: string;
  plan_end_date: string | null;
  annual_rate: number | null;
  monthly_contribution: number;
  contribution_frequency: string;
  reinvest_earnings: boolean;
};
export type Operation = {
  investment_id: string;
  movement_date: string;
  type: string;
  amount: number;
};
export const FREQUENCIES: Record<string, string> = {
  unico: "Único",
  mensal: "Mensal",
  semestral: "Semestral",
  anual: "Anual",
};
export function delta(m: Operation) {
  return m.type === "resgate" ? -Number(m.amount) : m.type === "dividendo" ? 0 : Number(m.amount);
}
function monthIndex(date: string) {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}
function monthKey(index: number) {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}
export function plannedContribution(plan: Plan, key: string) {
  const elapsed = monthIndex(key) - monthIndex(plan.plan_start_date);
  if (elapsed < 0 || (plan.plan_end_date && key > plan.plan_end_date.slice(0, 7))) return 0;
  const period = { unico: 0, mensal: 1, semestral: 6, anual: 12 }[plan.contribution_frequency];
  return elapsed === 0 || (period && elapsed % period === 0)
    ? Number(plan.monthly_contribution)
    : 0;
}
export type ComparisonRow = {
  key: string;
  investmentId: string;
  name: string;
  planned: number;
  actual: number;
  earnings: number;
  dividends: number;
  withdrawals: number;
  balance: number;
  projected: number;
};

/** Monthly planning convention: contributions at the beginning of their scheduled month.
 * Return is Modified Dietz over the same monthly interval for actual and forecast.
 * Corrections are external flows, never earnings; paid-out dividends count as returns.
 */
export function projectPortfolio(
  plans: Plan[],
  operations: Operation[],
  target: number,
  currentMonth: string,
) {
  const starts = plans.map((p) => monthIndex(p.plan_start_date));
  const start = starts.length ? Math.min(...starts) : monthIndex(currentMonth);
  const lastActual = Math.max(
    monthIndex(currentMonth),
    ...operations.map((m) => monthIndex(m.movement_date)),
  );
  const end = Math.min(
    start + 599,
    Math.max(
      lastActual + 12,
      ...plans.map((p) => (p.plan_end_date ? monthIndex(p.plan_end_date) : start + 239)),
    ),
  );
  const rows: ComparisonRow[] = [];
  const points: {
    key: string;
    previsto: number;
    realizado?: number;
    aportes: number;
    rendimentos: number;
    saque: number;
    distribuidos: number;
  }[] = [];
  const balances = new Map<string, number>();
  const projected = new Map<string, number>();
  let contributed = 0,
    earnings = 0,
    withdrawn = 0;
  let forecastContributions = 0,
    forecastEarnings = 0,
    distributed = 0;
  let actualCapital = 0,
    plannedCapital = 0,
    actualGain = 0,
    plannedGain = 0;
  const duration = Math.max(1, lastActual - start + 1);
  let reachedAt: string | null = null,
    crossoverAt: string | null = null;
  for (let index = start; index <= end; index++) {
    const key = monthKey(index);
    let predictedTotal = 0,
      actualTotal = 0,
      monthWithdrawals = 0,
      monthIncome = 0,
      monthContribution = 0;
    for (const plan of plans) {
      const firstMonth = monthIndex(plan.plan_start_date);
      if (index < firstMonth) continue;
      if (!balances.has(plan.id)) {
        balances.set(plan.id, Number(plan.initial_balance));
        projected.set(plan.id, Number(plan.initial_balance));
        if (index <= lastActual) {
          const weight = (lastActual - index + 1) / duration;
          actualCapital += Number(plan.initial_balance) * weight;
          plannedCapital += Number(plan.initial_balance) * weight;
        }
      }
      const planned = plannedContribution(plan, key);
      const active = !plan.plan_end_date || key <= plan.plan_end_date.slice(0, 7);
      const previous = projected.get(plan.id)!;
      const income = active
        ? (previous + planned) * (Math.pow(1 + Number(plan.annual_rate ?? 0) / 100, 1 / 12) - 1)
        : 0;
      const forecast = previous + planned + (plan.reinvest_earnings ? income : 0);
      projected.set(plan.id, forecast);
      predictedTotal += forecast;
      forecastContributions += planned;
      forecastEarnings += income;
      if (!plan.reinvest_earnings) distributed += income;
      monthIncome += income;
      monthContribution += planned;
      const entries = operations.filter(
        (m) => m.investment_id === plan.id && m.movement_date.slice(0, 7) === key,
      );
      const sum = (...types: string[]) =>
        entries.filter((m) => types.includes(m.type)).reduce((s, m) => s + Number(m.amount), 0);
      const actual = sum("aporte"),
        gain = sum("rendimento", "dividendo", "dividendo_reaplicado"),
        withdrawal = sum("resgate");
      const balance = balances.get(plan.id)! + entries.reduce((s, m) => s + delta(m), 0);
      balances.set(plan.id, balance);
      actualTotal += balance;
      if (index <= lastActual) {
        contributed += actual;
        earnings += gain;
        withdrawn += withdrawal;
        monthWithdrawals += withdrawal;
        const weight = (lastActual - index + 1) / duration;
        actualCapital += (actual - withdrawal + sum("ajuste")) * weight;
        plannedCapital += planned * weight;
        actualGain += gain;
        plannedGain += income;
      }
      rows.push({
        key,
        investmentId: plan.id,
        name: plan.name,
        planned,
        actual,
        earnings: gain,
        dividends: sum("dividendo_reaplicado"),
        withdrawals: withdrawal,
        balance,
        projected: forecast,
      });
    }
    points.push({
      key,
      previsto: predictedTotal,
      ...(index <= lastActual ? { realizado: actualTotal } : {}),
      aportes: forecastContributions,
      rendimentos: forecastEarnings,
      saque: monthWithdrawals,
      distribuidos: distributed,
    });
    if (!reachedAt && predictedTotal >= target) reachedAt = key;
    if (!crossoverAt && monthContribution > 0 && monthIncome > monthContribution) crossoverAt = key;
  }
  return {
    points,
    rows,
    contributed,
    earnings,
    withdrawn,
    reachedAt,
    crossoverAt,
    balance: points.find((p) => p.key === monthKey(lastActual))?.realizado ?? 0,
    actualReturn: actualCapital > 0 ? (actualGain / actualCapital) * 100 : null,
    plannedReturn: plannedCapital > 0 ? (plannedGain / plannedCapital) * 100 : null,
    returnStart: monthKey(start),
    returnEnd: monthKey(lastActual),
  };
}

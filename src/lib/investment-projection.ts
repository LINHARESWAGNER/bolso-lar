type Movement = { movement_date: string; type: string; amount: number };
type Closing = {
  reference_month: string;
  is_confirmed: boolean;
  actual_contribution: number;
  reinvested_dividends: number;
  withdrawals: number;
  ending_balance: number;
};
export type InvestmentPoint = {
  key: string;
  realizado?: number;
  previsto?: number;
  aportes: number;
  rendimentos: number;
  saque: number;
};

export function calculateInvestments(
  movements: Movement[],
  records: Closing[],
  assetBalance: number,
  annualRate: number,
  contribution: number,
  target: number,
  reinvest: boolean,
  currentMonth: string,
) {
  const closings = records
    .filter((r) => r.is_confirmed)
    .sort((a, b) => a.reference_month.localeCompare(b.reference_month));
  const last = closings.at(-1);
  const months = new Set([
    ...movements.map((m) => m.movement_date.slice(0, 7)),
    ...closings.map((r) => r.reference_month.slice(0, 7)),
  ]);
  const monthly = [...months].sort().map((key) => {
    const rows = movements.filter((m) => m.movement_date.startsWith(key));
    const sum = (types: string[]) =>
      rows.filter((m) => types.includes(m.type)).reduce((s, m) => s + Number(m.amount), 0);
    const closing = closings.find((r) => r.reference_month.startsWith(key));
    return {
      key,
      closing,
      net:
        (closing
          ? Number(closing.actual_contribution) +
            Number(closing.reinvested_dividends) -
            Number(closing.withdrawals)
          : sum(["aporte", "dividendo_reaplicado"]) - sum(["resgate"])) +
        sum(["rendimento", "ajuste"]),
      contribution: closing ? Number(closing.actual_contribution) : sum(["aporte"]),
      earnings:
        sum(["rendimento", "dividendo"]) +
        (closing ? Number(closing.reinvested_dividends) : sum(["dividendo_reaplicado"])),
      withdrawal: closing ? Number(closing.withdrawals) : sum(["resgate"]),
    };
  });
  const delta = (m: Movement) =>
    m.type === "resgate" ? -Number(m.amount) : m.type === "dividendo" ? 0 : Number(m.amount);
  // A confirmed closing is the consolidated portfolio snapshot. Only subsequent
  // movements change it; the same month's detailed entries must not be added again.
  const balance = last
    ? Number(last.ending_balance) +
      movements
        .filter((m) => m.movement_date.slice(0, 7) > last.reference_month.slice(0, 7))
        .reduce((s, m) => s + delta(m), 0)
    : assetBalance;
  let contributed = 0,
    earnings = 0,
    withdrawn = 0;
  const points: InvestmentPoint[] = [];
  const first = closings[0];
  let runningBalance = first
    ? Number(first.ending_balance) -
      monthly
        .filter((m) => m.key <= first.reference_month.slice(0, 7))
        .reduce((s, m) => s + m.net, 0)
    : balance - monthly.reduce((s, m) => s + m.net, 0);
  for (const month of monthly) {
    contributed += month.contribution;
    earnings += month.earnings;
    withdrawn += month.withdrawal;
    runningBalance = month.closing
      ? Number(month.closing.ending_balance)
      : runningBalance +
        movements
          .filter((m) => m.movement_date.startsWith(month.key))
          .reduce((s, m) => s + delta(m), 0);
    points.push({
      key: month.key,
      realizado: runningBalance,
      aportes: contributed,
      rendimentos: earnings,
      saque: month.withdrawal,
    });
  }
  const start = points.at(-1)?.key ?? currentMonth;
  if (!points.length)
    points.push({
      key: start,
      realizado: balance,
      aportes: contributed,
      rendimentos: earnings,
      saque: 0,
    });
  points[points.length - 1]!.realizado = balance;
  points[points.length - 1]!.previsto = balance;
  const totals = { balance, contributed, earnings, withdrawn };
  const rate = Math.pow(1 + annualRate / 100, 1 / 12) - 1;
  let projected = balance;
  let reachedAt: string | null = balance >= target ? start : null;
  let crossoverAt: string | null = null;
  const [year = 2026, month = 1] = start.split("-").map(Number);
  for (let i = 1; i <= 600; i++) {
    const date = new Date(year, month - 1 + i, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const income = (projected + contribution) * rate;
    projected += contribution + (reinvest ? income : 0);
    contributed += contribution;
    earnings += income;
    points.push({
      key,
      previsto: projected,
      aportes: contributed,
      rendimentos: earnings,
      saque: 0,
    });
    if (!crossoverAt && contribution > 0 && income > contribution) crossoverAt = key;
    if (!reachedAt && projected >= target) reachedAt = key;
    if (reachedAt && crossoverAt && key > reachedAt && i % 12 === 0) break;
  }
  return { points, reachedAt, crossoverAt, ...totals };
}

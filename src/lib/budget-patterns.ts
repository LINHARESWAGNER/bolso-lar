/** Etapa 6K: identifica rotinas por valor de cada compra, nao pelo estabelecimento.
 * Funcoes puras, nenhuma escrita no banco nem dependencias de interface. */
export type PatternPurchase = { date: string; amount: number };
export type ConsumptionPattern = {
  id: string;
  name: string;
  intervalDays: number;
  ticket: number;
  lastDate: string;
  count: number;
  observedMonths: number;
  valueBoundary?: number;
};
export type PatternAnalysis = {
  patterns: ConsumptionPattern[];
  method: "unico" | "segmentado";
  explanation: string;
  backtestSingleError: number | null;
  backtestSplitError: number | null;
  monthlyReference: number | null;
};
const day = (date: string) => Math.floor(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / 86400000);
const date = (days: number) => new Date(days * 86400000).toISOString().slice(0, 10);
const med = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};
const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const sum = (items: number[]) => items.reduce((v, x) => v + x, 0);
const perDay = (purchases: PatternPurchase[]) => {
  const totals = new Map<string, number>();
  for (const purchase of purchases) totals.set(purchase.date, (totals.get(purchase.date) ?? 0) + purchase.amount);
  return [...totals].map(([d, amount]) => ({ date: d, amount })).sort((a, b) => a.date.localeCompare(b.date));
};
const splitByValue = (purchases: PatternPurchase[]) => {
  const amounts = purchases.map(item => item.amount).filter(v => v > 0).sort((a, b) => a - b);
  if (amounts.length < 12) return null;
  // Divisao apenas se houver um vale real entre dois conjuntos sustentados.
  let bestIndex = -1;
  let bestGap = 1.8;
  const minCount = Math.max(4, Math.ceil(amounts.length * 0.18));
  for (let i = minCount; i <= amounts.length - minCount; i++) {
    const lower = amounts[i - 1] ?? 0;
    const higher = amounts[i] ?? 0;
    if (lower <= 0 || higher <= 0) continue;
    const gap = higher / lower;
    if (gap > bestGap) { bestGap = gap; bestIndex = i; }
  }
  if (bestIndex < 0) return null;
  const lowMedian = med(amounts.slice(0, bestIndex));
  const highMedian = med(amounts.slice(bestIndex));
  if (lowMedian <= 0 || highMedian / lowMedian < 3) return null;
  const low = amounts[bestIndex - 1] ?? 0;
  const high = amounts[bestIndex] ?? 0;
  return Math.sqrt(low * high);
};
function buildPattern(purchases: PatternPurchase[], id: string, name: string): ConsumptionPattern | null {
  const days = perDay(purchases);
  if (days.length < 3) return null;
  const gaps = days.slice(1).map((item, i) => day(item.date) - day(days[i]!.date)).filter(v => v > 0);
  const typical = med(gaps);
  const variation = typical > 0 ? med(gaps.map(value => Math.abs(value - typical))) / typical : Infinity;
  const activeMonths = new Set(days.map(item => item.date.slice(0, 7))).size;
  if (activeMonths < 2 || typical < 2 || typical > 35 || variation > 0.8) return null;
  // Ticket por dia DO PADRAO, com mediana robusta. A compra individual decide
  // o grupo, mas varias compras do mesmo grupo no dia contam como uma visita.
  const ticket = med(days.map(item => item.amount));
  if (ticket <= 0) return null;
  return { id, name, intervalDays: Math.max(1, Math.round(typical)), ticket: round(ticket),
    lastDate: days[days.length - 1]!.date, count: days.length, observedMonths: activeMonths };
}
function models(purchases: PatternPurchase[], separate: boolean): ConsumptionPattern[] {
  const threshold = separate ? splitByValue(purchases) : null;
  if (threshold !== null) {
    const small = buildPattern(purchases.filter(p => p.amount <= threshold), "pequenas", "Compras pequenas");
    const large = buildPattern(purchases.filter(p => p.amount > threshold), "maiores", "Compras maiores");
    // Um grupo sem cadencia nao deve criar uma extrapolacao artificial.
    if (small && large && small.count >= 4 && large.count >= 4) {
      small.valueBoundary = threshold;
      large.valueBoundary = threshold;
      return [small, large];
    }
  }
  const one = buildPattern(purchases, "geral", "Padrão geral");
  return one ? [one] : [];
}
const expectedMonth = (patterns: ConsumptionPattern[]) =>
  sum(patterns.map(p => p.ticket * 30.4375 / p.intervalDays));
function backtest(purchases: PatternPurchase[], asOf: string, separate: boolean) {
  const end = day(asOf);
  const errors: number[] = [];
  // Tres janelas de 30 dias inteiramente anteriores ao dia de referencia.
  for (const offset of [90, 60, 30]) {
    const testStart = end - offset;
    const trainStart = testStart - 180;
    const train = purchases.filter(p => day(p.date) < testStart && day(p.date) >= trainStart);
    const test = purchases.filter(p => day(p.date) >= testStart && day(p.date) < testStart + 30);
    const chosen = models(train, separate);
    if (!chosen.length || train.length < 10) continue;
    const predicted = sum(chosen.map(p => (30 / p.intervalDays) * p.ticket));
    const actual = sum(test.map(p => p.amount));
    errors.push(Math.abs(predicted - actual) / Math.max(actual, 100));
  }
  return errors.length >= 2 ? round(sum(errors) / errors.length) : null;
}
function monthlyMedian(purchases: PatternPurchase[], asOf: string) {
  const currentMonth = asOf.slice(0, 7);
  const totals = new Map<string, number>();
  for (const item of purchases) {
    const month = item.date.slice(0, 7);
    if (month >= currentMonth) continue;
    totals.set(month, (totals.get(month) ?? 0) + item.amount);
  }
  const months = [...totals].sort(([a], [b]) => b.localeCompare(a)).slice(0, 3);
  return months.length >= 3 ? med(months.map(([, v]) => v)) : null;
}
/** Separa em dois padroes so quando a evidencia e a validacao retroativa sustentam.
 * Nunca usa nome, orcamento planejado, meio de pagamento ou mes de fatura para classificar. */
export function analyzeConsumptionPatterns(input: PatternPurchase[], asOf: string): PatternAnalysis {
  const cleaned = input.filter(p => p.amount > 0 && Number.isFinite(p.amount) &&
    /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.date <= asOf &&
    day(p.date) >= day(asOf) - 185).sort((a, b) => a.date.localeCompare(b.date));
  const one = models(cleaned, false);
  const two = models(cleaned, true);
  const oneError = backtest(cleaned, asOf, false);
  const twoError = two.length === 2 ? backtest(cleaned, asOf, true) : null;
  const useTwo = two.length === 2 && oneError !== null && twoError !== null &&
    twoError < oneError * 0.95;
  const patterns = useTwo ? two : one;
  const reference = monthlyMedian(cleaned, asOf);
  // Controle do nivel financeiro, nunca teto orcamentario. A mediana dos
  // ultimos 3 meses fechados evita exageros de um unico dia incomum.
  if (patterns.length && reference !== null) {
    const modelMonthly = expectedMonth(patterns);
    if (modelMonthly > 0) {
      const factor = Math.max(0.5, Math.min(1.5, reference / modelMonthly));
      for (const pattern of patterns) pattern.ticket = round(pattern.ticket * factor);
    }
  }
  return {patterns, method: useTwo ? "segmentado" : "unico",
    explanation: useTwo
      ? "Pequenas e maiores compras reconhecidas por valor individual; separacao aprovada por teste retroativo."
      : "Padrao unico robusto: dados ou teste retroativo nao justificam segmentacao.",
    backtestSingleError: oneError, backtestSplitError: twoError,
    monthlyReference: reference === null ? null : round(reference)};
}


/** 6L: uma rotina semanal exige quatro compras em um mesmo mes, com
 * tres intervalos consecutivos proximos de uma semana, e continuidade recente.
 * A quantidade e por lancamento, mas dias distintos sao necessarios para
 * demonstrar a cadencia. Nao considera nome do estabelecimento nem cartao. */
export function isActiveWeeklyRoutine(purchases: PatternPurchase[], asOf: string): boolean {
  const clean = purchases.filter(p => p.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.date <= asOf)
    .sort((a,b)=>a.date.localeCompare(b.date));
  if (clean.length < 4) return false;
  const recent = clean[clean.length-1];
  if (!recent || day(asOf)-day(recent.date)>16) return false;
  const monthly = new Map<string,number[]>();
  for (const item of clean) {
    const key=item.date.slice(0,7);
    monthly.set(key,[...(monthly.get(key)??[]),day(item.date)]);
  }
  return [...monthly.values()].some(days=>{
    if (days.length<4) return false;
    const distinct=[...new Set(days)].sort((a,b)=>a-b);
    for(let i=0;i+3<distinct.length;i++) {
      const four=distinct.slice(i,i+4);
      if(four.every((value,j)=>j===0 || (value-four[j-1]!)>=5 && (value-four[j-1]!)<=10)) return true;
    }
    return false;
  });
}

/** Contas mensais diretas: no minimo tres meses distintos e vencimentos
 * mensais ativos. Excecao deliberada a exigencia de quatro lancamentos. */
export function isActiveDirectMonthly(purchases: PatternPurchase[], asOf: string): boolean {
  const days=perDay(purchases.filter(p=>p.amount>0 && p.date<=asOf));
  if(days.length<3 || day(asOf)-day(days[days.length-1]!.date)>50) return false;
  const months=new Set(days.map(p=>p.date.slice(0,7)));
  if(months.size<3) return false;
  const gaps=days.slice(1).map((p,i)=>day(p.date)-day(days[i]!.date));
  return gaps.length>=2 && gaps.slice(-3).every(g=>g>=24 && g<=36);
}

/** Categorias com consumo administravel frequente, sem rotina semanal:
 * ao menos quatro compras em dois meses recentes distintos, com atividade
 * nos ultimos 35 dias. Nao inventamos datas futuras: usa media mensal de caixa. */
export function isActiveManagedConsumption(purchases: PatternPurchase[], asOf: string): boolean {
  const currentMonth=asOf.slice(0,7);
  const first= date(day(`${currentMonth}-01`)-65).slice(0,7);
  const recent=purchases.filter(p=>p.amount>0 && p.date<=asOf && p.date.slice(0,7)>=first);
  if(!recent.length || day(asOf)-Math.max(...recent.map(p=>day(p.date)))>35) return false;
  const counts=new Map<string,number>();
  for(const item of recent) counts.set(item.date.slice(0,7),(counts.get(item.date.slice(0,7))??0)+1);
  return [...counts.values()].filter(count=>count>=4).length>=2;
}


/** 6L R2: estima consumo administravel com cobertura historica real.
 * Prioriza caixa quando ao menos dois dos tres meses estao representados;
 * se o ciclo de fatura deixa a amostra incompleta, usa datas das compras.
 * Nao usa orcamento como teto e nao cria compras ficticias. */
export function managedMonthlyReference(
  cashByMonth: number[], purchases: PatternPurchase[], asOf: string,
): { amount: number; source: "caixa" | "compras"; observedMonths: number } | null {
  const firstMonth = `${asOf.slice(0, 7)}-01`;
  const starts = [-3,-2,-1].map(offset => {
    const d = new Date(`${firstMonth}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + offset);
    return d.toISOString().slice(0,7);
  });
  const byPurchase = starts.map(month => round(sum(purchases
    .filter(p => p.amount > 0 && Number.isFinite(p.amount) && p.date.slice(0,7)===month)
    .map(p => p.amount))));
  const cash = cashByMonth.map(v => Number.isFinite(v) && v > 0 ? v : 0);
  const cashPresent = cash.filter(v => v > 0);
  const purchasePresent = byPurchase.filter(v => v > 0);
  // Nunca transformar um unico mes isolado em obrigacao permanente.
  if (cashPresent.length < 2 && purchasePresent.length < 2) return null;
  const usePurchases = purchasePresent.length > cashPresent.length;
  const selected = usePurchases ? purchasePresent : cashPresent;
  return {amount:round(med(selected)),source:usePurchases?"compras":"caixa",observedMonths:selected.length};
}

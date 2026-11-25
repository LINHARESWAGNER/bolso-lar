import { cashExpenseDate, cashExpensePaid } from "./budget-cash";
import type { HealthData, HealthPeriod, Settings } from "./financial-health";
import { isThirdPartyTransaction } from "./derive";

export type BudgetLine = {
  id: string;
  description: string;
  category: string;
  categoryId: string | null;
  rootId: string;
  rootName: string;
  date: string;
  /** Data da compra: usada apenas para reconhecer o ritmo, nunca para atribuir o mes de caixa. */
  purchaseDate?: string;
  cardId?: string | null;
  amount: number;
  status: string;
  creditCard: boolean;
  recurring: boolean;
  installment?: boolean;
};
export type BudgetCategory = {
  id: string;
  name: string;
  budget: number;
  spent: number;
  difference: number;
  consumption: number | null;
  state: "dentro" | "proxima" | "acima" | "sem_orcamento" | "sem_consumo";
  excessContribution: number;
  lines: BudgetLine[];
};
export type BudgetFinding = { id: string; title: string; evidence: string; categoryId?: string };
export type BudgetAction = {
  id: string;
  priority: "Alta" | "Média" | "Cadastro";
  categoryId?: string;
  category: string;
  finding: string;
  action: string;
  amount: number;
  effect: string;
  deadline: string;
};
export type BudgetSnapshot = {
  period: HealthPeriod;
  budget: number;
  registered: number;
  paid: number;
  pending: number;
  count: number;
  difference: number;
  deviation: number | null;
  status: "saudavel" | "atencao" | "critico" | "insuficiente";
  categories: BudgetCategory[];
  lines: BudgetLine[];
  insideCount: number;
  outsideCount: number;
  excessTotal: number;
  topThreeShare: number | null;
};
export type BudgetComparison = {
  label: string;
  available: boolean;
  missing: string | null;
  spent: number | null;
  deviation: number | null;
  spentChange: number | null;
  deviationChange: number | null;
  improved: string[];
  worsened: string[];
  newlyOver: string[];
};
export type BudgetProjection = {
  expected: number | null;
  additional: number | null;
  confidence: "alta" | "media" | "baixa" | "insuficiente";
  reason: string;
  daysElapsed: number;
  daysTotal: number;
  daysRemaining: number;
  averageDaily: number;
  recommendedDaily: number;
  remaining: number;
  recordedFuture: number;
  risk: boolean;
};
export type BudgetDIKW = {
  closed: BudgetSnapshot;
  current: BudgetSnapshot;
  previous: BudgetComparison;
  averageThree: BudgetComparison;
  findings: BudgetFinding[];
  actions: BudgetAction[];
  currentActions: BudgetAction[];
  projection: BudgetProjection;
  neededReduction: number;
  availableReallocation: number;
  afterActionsDeviation: number | null;
};

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (value: number | string | null) => Number(value ?? 0) || 0;
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const dateMonth = (iso: string) => iso.slice(0, 7);
const shiftMonth = (period: HealthPeriod, offset: number): HealthPeriod => {
  const [year, month] = period.start.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const last = new Date(Date.UTC(y, date.getUTCMonth() + 1, 0)).getUTCDate();
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(last).padStart(2, "0")}`, months: 1 };
};
const dayIndex = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86400000);

/** Um lançamento ou parcela por ID. A fatura e a transferência não são despesas elegíveis. */
export function budgetSnapshot(data: HealthData, period: HealthPeriod, tolerancePct: number): BudgetSnapshot {
  const byCategory = new Map(data.categories.map((c) => [c.id, c]));
  const rootOf = (id: string | null): { id: string; name: string } => {
    let current = id ? byCategory.get(id) : undefined;
    if (!current) return { id: "__uncategorized__", name: "Sem categoria" };
    const visited = new Set<string>();
    while (current.parent_id && !visited.has(current.id)) {
      visited.add(current.id);
      const parent = byCategory.get(current.parent_id);
      if (!parent) break;
      current = parent;
    }
    return { id: current.id, name: current.name };
  };
  const seen = new Set<string>();
  const invoiceById = new Map(data.invoices.map(i => [i.id, i]));
  const lines: BudgetLine[] = data.transactions
    .filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return (
        t.type === "despesa" &&
        t.expense_nature === "variavel" &&
        t.status !== "cancelado" &&
        (cashExpenseDate(t, invoiceById) ?? "") >= period.start &&
        (cashExpenseDate(t, invoiceById) ?? "") <= period.end &&
        !isThirdPartyTransaction(data.categories, t)
      );
    })
    .map((t) => {
      const root = rootOf(t.category_id);
      return {
        id: t.id, description: t.description, category: byCategory.get(t.category_id ?? "")?.name ?? "Sem categoria",
        categoryId: t.category_id, rootId: root.id, rootName: root.name,
        date: cashExpenseDate(t, invoiceById)!, purchaseDate: t.competence_date, cardId: t.credit_card_id, amount: num(t.amount), status: cashExpensePaid(t, invoiceById) ? "pago" : "previsto",
        creditCard: !!t.credit_card_id, recurring: !!t.recurring_id, installment: !!t.installment_group_id || Number(t.installment_total ?? 0) > 1,
      };
    });
  const limits = new Map<string, { name: string; amount: number }>();
  for (const budget of data.budgets.filter((b) => dateMonth(b.reference_month) === dateMonth(period.start))) {
    for (const item of budget.budget_items) {
      const root = rootOf(item.category_id);
      const current = limits.get(root.id);
      limits.set(root.id, { name: root.name, amount: round((current?.amount ?? 0) + num(item.amount)) });
    }
  }
  const categoryLines = new Map<string, BudgetLine[]>();
  for (const line of lines) categoryLines.set(line.rootId, [...(categoryLines.get(line.rootId) ?? []), line]);
  const ids = new Set([...limits.keys(), ...categoryLines.keys()]);
  const categories: BudgetCategory[] = [...ids].map((id) => {
    const budget = limits.get(id)?.amount ?? 0;
    const items = categoryLines.get(id) ?? [];
    const spent = round(items.reduce((total, line) => total + line.amount, 0));
    const difference = round(spent - budget);
    const state: BudgetCategory["state"] = spent === 0 ? "sem_consumo" : budget <= 0 ? "sem_orcamento" : spent > budget ? "acima" : spent >= budget * 0.9 ? "proxima" : "dentro";
    return { id, name: limits.get(id)?.name ?? items[0]?.rootName ?? "Sem categoria", budget, spent,
      difference, consumption: budget > 0 ? (spent / budget) * 100 : null, state, excessContribution: Math.max(0, difference), lines: items };
  });
  categories.sort((a, b) => b.excessContribution - a.excessContribution || b.spent - a.spent);
  const budget = round([...limits.values()].reduce((s, entry) => s + entry.amount, 0));
  const registered = round(lines.reduce((s, item) => s + item.amount, 0));
  const paid = round(lines.filter((t) => t.status === "pago").reduce((s, item) => s + item.amount, 0));
  const pending = round(registered - paid);
  const difference = round(registered - budget);
  const deviation = budget > 0 ? (difference / budget) * 100 : null;
  const status: BudgetSnapshot["status"] = deviation === null ? "insuficiente" : deviation <= tolerancePct ? "saudavel" : deviation <= tolerancePct * 3 ? "atencao" : "critico";
  const excessTotal = round(categories.reduce((sum, cat) => sum + cat.excessContribution, 0));
  const topThree = categories.slice().sort((a,b) => b.spent-a.spent).slice(0,3).reduce((sum,cat)=>sum+cat.spent,0);
  return { period, budget, registered, paid, pending, count: lines.length, difference, deviation, status,
    categories, lines, insideCount: categories.filter(c => c.budget > 0 && c.spent <= c.budget).length,
    outsideCount: categories.filter(c => c.difference > 0).length, excessTotal,
    topThreeShare: registered > 0 ? (topThree / registered) * 100 : null };
}

function compare(base: BudgetSnapshot, history: BudgetSnapshot[], label: string): BudgetComparison {
  const valid = history.filter(s => s.budget > 0 && s.deviation !== null);
  if (valid.length !== history.length) {
    return { label, available: false, missing: `${history.length - valid.length} mês(es) sem orçamento variável válido`,
      spent: null, deviation: null, spentChange: null, deviationChange: null, improved: [], worsened: [], newlyOver: [] };
  }
  const spent = round(valid.reduce((s,v) => s + v.registered,0) / valid.length);
  const deviation = valid.reduce((s,v)=>s+(v.deviation ?? 0),0)/valid.length;
  const categoryMeans = new Map<string, number>();
  const previousOver = new Set<string>();
  for (const month of valid) {
    for (const cat of month.categories) {
      categoryMeans.set(cat.id, (categoryMeans.get(cat.id) ?? 0) + cat.difference / valid.length);
      if (cat.difference > 0) previousOver.add(cat.id);
    }
  }
  const improved = base.categories.filter(c => categoryMeans.has(c.id) && c.difference < (categoryMeans.get(c.id) ?? 0) - 0.01).map(c=>c.name);
  const worsened = base.categories.filter(c => categoryMeans.has(c.id) && c.difference > (categoryMeans.get(c.id) ?? 0) + 0.01).map(c=>c.name);
  const newlyOver = base.categories.filter(c => c.difference > 0 && !previousOver.has(c.id)).map(c=>c.name);
  return { label, available: true, missing: null, spent, deviation,
    spentChange: round(base.registered - spent), deviationChange: base.deviation === null ? null : base.deviation - deviation,
    improved, worsened, newlyOver };
}

export function projectBudgetMonth(current: BudgetSnapshot, today: string): BudgetProjection {
  const daysTotal = dayIndex(current.period.end) - dayIndex(current.period.start) + 1;
  const daysElapsed = Math.min(daysTotal, Math.max(0, dayIndex(today) - dayIndex(current.period.start) + 1));
  const daysRemaining = Math.max(0, daysTotal - daysElapsed);
  const recordedFuture = round(current.lines.filter(l => l.date.slice(0,10) > today).reduce((s,l)=>s+l.amount,0));
  // Parcelas integram o registrado, mas nao demonstram
  // frequencia de novas compras.
  const past = current.lines.filter(
    l => l.date.slice(0,10) <= today && !l.installment
  );
  const routineFuture = current.lines
    .filter(l => l.date.slice(0,10) > today && !l.installment)
    .reduce((s,l) => s + l.amount, 0);
  const observedDates = new Set(past.map(l => l.date.slice(0,10))).size;
  const observed = past.reduce((s,l)=>s+l.amount,0);
  const averageDaily = daysElapsed > 0 ? observed/daysElapsed : 0;
  const remaining = round(current.budget - current.registered);
  const recommendedDaily = daysRemaining ? Math.max(0,remaining/daysRemaining) : 0;
  const confidence: BudgetProjection["confidence"] = daysElapsed < 7 || observedDates < 3 ? "insuficiente" : daysElapsed >= 21 && observedDates >= 10 ? "alta" : daysElapsed >= 14 && observedDates >= 6 ? "media" : "baixa";
  const additional = confidence === "insuficiente" ? null : round(Math.max(0, averageDaily * daysRemaining - routineFuture));
  const expected = additional === null ? null : round(current.registered + additional);
  const reason = confidence === "insuficiente"
    ? `Apenas ${daysElapsed} dia(s) transcorrido(s) e ${observedDates} dia(s) com lançamentos; projeção proporcional indisponível.`
    : `Base: ${daysElapsed} dia(s) transcorrido(s), ${observedDates} dia(s) com gastos. A projeção desconta ${money(routineFuture)} em despesas não parceladas já registradas para datas futuras.`;
  return { expected, additional, confidence, reason, daysElapsed, daysTotal, daysRemaining,
    averageDaily, recommendedDaily, remaining, recordedFuture, risk: current.budget > 0 && (expected ?? current.registered) > current.budget };
}

export function buildBudgetDIKW(data: HealthData, settings: Settings, closedPeriod: HealthPeriod, currentPeriod: HealthPeriod, today: string): BudgetDIKW {
  const closed = budgetSnapshot(data, closedPeriod, settings.budget_tolerance_pct);
  const current = budgetSnapshot(data, currentPeriod, settings.budget_tolerance_pct);
  const history = [-1,-2,-3].map(offset => budgetSnapshot(data, shiftMonth(closedPeriod,offset), settings.budget_tolerance_pct));
  const previous = compare(closed,[history[0]],"Mês anterior");
  const averageThree = compare(closed,history,"Média dos três meses anteriores");
  const projection = projectBudgetMonth(current,today);
  const findings: BudgetFinding[] = [];
  const actions: BudgetAction[] = [];
  const currentActions: BudgetAction[] = [];
  const missing = closed.categories.filter(c=>c.state==="sem_orcamento" && c.spent>0);
  for (const category of closed.categories.filter(c=>c.difference>0)) {
    const share = closed.excessTotal > 0 ? category.excessContribution/closed.excessTotal*100 : 0;
    findings.push({id:`over-${category.id}`,title:`${category.name}: ${money(category.difference)} de excesso`,evidence:`Registrou ${money(category.spent)} contra ${money(category.budget)} planejados; representa ${share.toFixed(1)}% da soma dos estouros por categoria.`,categoryId:category.id});
    actions.push({id:`action-${category.id}`,priority:category.excessContribution>=closed.excessTotal*0.3?"Alta":"Média",category:category.name,categoryId:category.id,
      finding:`Excesso confirmado de ${money(category.difference)} no último mês fechado.`,
      action: category.budget === 0 ? `Definir um limite para ${category.name} a partir dos ${money(category.spent)} registrados, ou reduzir esse gasto no próximo mês.`
        : `Reduzir ${money(category.difference)} do consumo de ${category.name} no próximo mês para retornar ao limite de ${money(category.budget)}, ou ajustar conscientemente esse limite no planejamento.`,
      amount:category.difference,effect:`Redução desse valor elimina ${money(category.difference)} do excesso nessa categoria; não altera gastos já ocorridos.`,deadline:"Próximo planejamento"});
  }
  if (missing.length) findings.push({id:"unplanned",title:`${missing.length} categoria(s) com gastos sem limite`,evidence:missing.map(c=>`${c.name}: ${money(c.spent)}`).join("; ")});
  const withoutCategory = closed.lines.filter(l=>l.categoryId===null);
  if(withoutCategory.length){
    const total = round(withoutCategory.reduce((s,l)=>s+l.amount,0));
    findings.push({id:"no-category",title:`${money(total)} sem categoria`,evidence:`${withoutCategory.length} lançamento(s) sem classificação impedem atribuir corretamente o excesso.`});
    actions.unshift({id:"categorize",priority:"Cadastro",category:"Sem categoria",categoryId:"__uncategorized__",finding:`${money(total)} sem categoria.`,
      action:`Classificar os ${withoutCategory.length} lançamento(s) que somam ${money(total)} antes de redefinir os limites por categoria.`,amount:total,
      effect:`Os ${money(total)} passam a ter categoria identificada, sem alterar o total registrado.`,deadline:"Agora"});
  }
  const recurring = closed.lines.filter(l=>l.recurring);
  if(recurring.length) findings.push({id:"recurring",title:"Despesas recorrentes nas variáveis",evidence:`${recurring.length} ocorrência(s) somam ${money(recurring.reduce((s,l)=>s+l.amount,0))}; confirmar se seus limites já as contemplam.`});
  if (closed.lines.length >= 5 && closed.registered > 0) {
    const largest = [...closed.lines].sort((a, b) => b.amount - a.amount).slice(0, 3);
    const concentration = largest.reduce((total, line) => total + line.amount, 0) / closed.registered * 100;
    if (concentration >= 50) findings.push({
      id: "concentrated-purchases", title: `Três lançamentos concentram ${concentration.toFixed(1)}% dos gastos`,
      evidence: largest.map(l => `${l.description} (${l.rootName}): ${money(l.amount)}`).join("; "),
    });
  }
  const highPending = closed.pending;
  if (highPending > 0) findings.push({id:"pending",title:`${money(highPending)} ainda constam como previstos`,evidence:`Total registrado: ${money(closed.registered)}; marcado como pago: ${money(closed.paid)}. O orçamento considera ambos.`});
  for(const cat of closed.categories){
    const amounts = cat.lines.map(l=>l.amount).sort((a,b)=>a-b);
    if(amounts.length>=5){
      const median = amounts[Math.floor(amounts.length/2)];
      const atypical = cat.lines.filter(l=>median>0 && l.amount>=3*median && l.amount>median);
      if(atypical.length) findings.push({id:`atypical-${cat.id}`,title:`Valor atípico em ${cat.name}`,categoryId:cat.id,
        evidence:`Mediana de ${amounts.length} lançamentos: ${money(median)}. ${atypical.slice(0,2).map(l=>`${l.description}: ${money(l.amount)}`).join("; ")}.`});
    }
  }
  if(previous.available){
    const past = history[0];
    for(const cat of closed.categories.filter(c=>c.difference>0)) {
      const p=past.categories.find(x=>x.id===cat.id);
      if(p && p.difference>0) findings.push({id:`repeated-${cat.id}`,title:`Estouro repetido em ${cat.name}`,categoryId:cat.id,
        evidence:`Excesso atual ${money(cat.difference)} e excesso no mês anterior ${money(p.difference)}.`});
    }
  }
  if(averageThree.available){
    for(const cat of closed.categories){
      const past=history.map(s=>s.categories.find(x=>x.id===cat.id));
      if(past.every(p=>p && p.budget>0 && p.difference>0) && cat.difference>0){
        findings.push({id:`persistent-${cat.id}`,title:`Limite insuficiente por quatro meses: ${cat.name}`,categoryId:cat.id,
          evidence:`Excesso no mês fechado: ${money(cat.difference)}. Excesso também em cada um dos três meses anteriores.`});
      }
      if(cat.budget>0 && cat.spent < cat.budget*0.6 && past.every(p=>p && p.budget>0 && p.spent<p.budget*0.6)){
        findings.push({id:`oversized-${cat.id}`,title:`Limite acima do consumo recorrente: ${cat.name}`,categoryId:cat.id,
          evidence:`Consumo do mês: ${money(cat.spent)} de ${money(cat.budget)}; abaixo de 60% em quatro meses fechados.`});
      }
    }
  }
  const overCurrent = current.categories.filter(c=>c.difference>0);
  for(const c of overCurrent){
    currentActions.push({id:`now-${c.id}`,priority:"Alta",category:c.name,categoryId:c.id,finding:`Já excedeu o limite em ${money(c.difference)}.`,
      action:`Suspender novos gastos variáveis de ${c.name} até o fechamento e replanejar os ${money(c.difference)} já excedidos.`,amount:c.difference,
      effect:`Evitar novas compras impede ampliar o excesso de ${money(c.difference)}; valores registrados não podem ser desfeitos.`,deadline:"Agora"});
  }
  for(const c of current.categories.filter(c=>c.budget>0 && c.spent>=c.budget*0.9 && c.spent<=c.budget)){
    const left = round(c.budget-c.spent);
    currentActions.push({id:`near-${c.id}`,priority:"Média",category:c.name,categoryId:c.id,finding:`Já usou ${(c.consumption??0).toFixed(1)}% do limite.`,
      action:`Limitar novas compras de ${c.name} a ${money(left)} até o fim do mês.`,amount:left,effect:`Manter novas compras dentro de ${money(left)} evita ultrapassar ${money(c.budget)}.`,deadline:"Até o fim do mês"});
  }
  actions.sort((a,b)=>(a.priority==="Cadastro"?-1:b.priority==="Cadastro"?1: b.amount-a.amount));
  const neededReduction = Math.max(0,round(closed.registered - closed.budget));
  const freeBudgets = closed.categories.filter(c=>c.budget>0).reduce((s,c)=>s+Math.max(0,c.budget-c.spent),0);
  const availableReallocation = round(Math.min(closed.excessTotal,freeBudgets));
  const plannedReduction = Math.min(neededReduction,actions.filter(a=>a.priority!=="Cadastro").reduce((s,a)=>s+a.amount,0));
  const afterActionsDeviation = closed.budget>0 ? ((closed.registered-plannedReduction-closed.budget)/closed.budget)*100 : null;
  return {closed,current,previous,averageThree,findings,actions,currentActions,projection,neededReduction,
    availableReallocation,afterActionsDeviation};
}

import { budgetSnapshot, type BudgetSnapshot, type BudgetLine } from "./budget-dikw";
import type { HealthData, HealthPeriod } from "./financial-health";
import { type ProjectionPreference } from "./budget-forecast";
import { analyzeConsumptionPatterns, isActiveWeeklyRoutine, isActiveDirectMonthly, isActiveManagedConsumption, managedMonthlyReference } from "./budget-patterns";

/** Projecoes virtuais: nao gravam lancamentos nem faturas no banco. */
export type HorizonOccurrence = {
  categoryId: string;
  rootId: string;
  category: string;
  purchaseDate: string;
  paymentDate: string;
  amount: number;
  channel: "cartao" | "direto";
  cardName: string | null;
  cycleSource: "fatura_real" | "ciclo_estimado" | "vencimento_direto";
};
/** Memoria de calculo formada com os MESMOS snapshots e compras usados pelo motor. */
export type HorizonAuditLine = {
  id: string;
  description: string;
  purchaseDate: string;
  cashDate: string;
  amount: number;
  channel: "cartao" | "direto";
  status: string;
};
export type HorizonAuditMonth = {
  month: string;
  cashTotal: number;
  purchaseTotal: number;
  cashCount: number;
  purchaseCount: number;
  includedInMedian: boolean;
};
export type HorizonAudit = {
  asOf: string;
  method: "caixa" | "compras" | "cadencia" | "sem_projecao";
  sourceMonths: HorizonAuditMonth[];
  sourceLines: HorizonAuditLine[];
  cashSourceLines: HorizonAuditLine[];
  historyCount: number;
  excludedInstallmentCount: number;
  excludedFutureCount: number;
  excludedUnpaidDirectCount: number;
  monthlyReference: number | null;
  observedMonths: number;
  note: string;
};
export type HorizonRhythm = {
  categoryId: string;
  category: string;
  rootId: string;
  intervalDays: number | null;
  lastPurchase: string | null;
  nextPurchase: string | null;
  referenceCard: string | null;
  confidence: "alta" | "media" | "baixa" | "insuficiente";
  status: "rotina" | "mensal" | "eventual" | "sem_padrao" | "sem_cartao";
  monthlyReference?: number | null;
  note: string;
  patterns?: { name: string; ticket: number; intervalDays: number; count: number }[];
  audit?: HorizonAudit;
  calibration?: { method: "unico" | "segmentado"; monthlyReference: number | null; backtestSingleError: number | null; backtestSplitError: number | null };
};
export type HorizonMonthlyEstimate = { categoryId: string; rootId: string; category: string; reference: number; additional: number };
export type HorizonMonth = {
  period: HealthPeriod;
  snapshot: BudgetSnapshot;
  plannedBudget: number;
  inheritedBudget: boolean;
  registered: number;
  projectedAdditional: number;
  projected: number;
  occurrences: HorizonOccurrence[];
  monthlyEstimates: HorizonMonthlyEstimate[];
  byRoot: { id: string; name: string; budget: number; registered: number; additional: number; projected: number }[];
};
export type BudgetHorizon = { months: HorizonMonth[]; rhythms: HorizonRhythm[]; occurrences: HorizonOccurrence[] };

const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const epoch = (v: string) => Math.floor(Date.parse(`${v.slice(0, 10)}T00:00:00Z`) / 86400000);
const isoDay = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
const monthOffset = (start: string, offset: number): HealthPeriod => {
  const [year = 2000, month = 1] = start.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + offset, 1));
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return {
    start: `${y}-${String(m + 1).padStart(2, "0")}-01`,
    end: `${y}-${String(m + 1).padStart(2, "0")}-${String(new Date(Date.UTC(y, m + 1, 0)).getUTCDate()).padStart(2, "0")}`,
    months: 1,
  };
};
const dateAtDay = (year: number, monthIndex: number, day: number) => {
  const max = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(max, day))).toISOString().slice(0, 10);
};
const median = (items: number[]) => {
  if (!items.length) return 0;
  const ordered = [...items].sort((a,b)=>a-b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? (ordered[middle] ?? 0) : ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
};
const avg = (items: number[]) => items.length ? items.reduce((a,b)=>a+b, 0) / items.length : 0;
const uniqueDays = (lines: BudgetLine[]) => {
  const totals = new Map<string, number>();
  for (const line of lines) {
    const date = (line.creditCard ? (line.purchaseDate ?? line.date) : line.date).slice(0,10);
    totals.set(date, (totals.get(date) ?? 0) + line.amount);
  }
  return [...totals].sort(([a],[b])=>a.localeCompare(b)).map(([date,amount])=>({date, amount}));
};
function paymentForCard(data: HealthData, cardId: string, purchaseDate: string) {
  const actual = data.invoices.filter(invoice => invoice.credit_card_id === cardId &&
    invoice.closing_date.slice(0,10) >= purchaseDate && invoice.due_date.slice(0,10) >= purchaseDate)
    .sort((a,b)=>a.closing_date.localeCompare(b.closing_date))[0];
  if (actual) return { paymentDate: actual.due_date.slice(0,10), source: "fatura_real" as const };
  const card = data.cards.find(row => row.id === cardId);
  if (!card || !card.closing_day || !card.due_day) return null;
  const d = new Date(`${purchaseDate}T00:00:00Z`);
  const closeDay = Number(card.closing_day);
  const dueDay = Number(card.due_day);
  if (!(closeDay >= 1 && closeDay <= 31 && dueDay >= 1 && dueDay <= 31)) return null;
  let closing = dateAtDay(d.getUTCFullYear(), d.getUTCMonth(), closeDay);
  if (closing < purchaseDate) {
    closing = dateAtDay(d.getUTCFullYear(), d.getUTCMonth() + 1, closeDay);
  }
  const closingDate = new Date(`${closing}T00:00:00Z`);
  // Vencimento depois do fechamento: no mesmo mes se o dia for posterior,
  // ou no mes subsequente quando o dia for anterior/igual.
  const dueOffset = dueDay <= closeDay ? 1 : 0;
  let paymentDate = dateAtDay(closingDate.getUTCFullYear(), closingDate.getUTCMonth()+dueOffset, dueDay);
  if (paymentDate <= closing) {
    paymentDate = dateAtDay(closingDate.getUTCFullYear(), closingDate.getUTCMonth()+dueOffset+1, dueDay);
  }
  return { paymentDate, source: "ciclo_estimado" as const };
}

export function buildBudgetHorizon(
  data: HealthData,
  nextPeriodStart: string,
  today: string,
  preferences: Record<string, ProjectionPreference> = {},
): BudgetHorizon {
  const periods = Array.from({length: 6}, (_,i)=>monthOffset(nextPeriodStart,i));
  const months = periods.map(period=>({period, snapshot: budgetSnapshot(data,period,5)}));
  // Fonte unica: compras reais que podem estar em faturas de meses diferentes.
  const snapshots = Array.from({length: 10},(_,i)=>budgetSnapshot(data,monthOffset(nextPeriodStart,i-9),5));
  const allLines = [...snapshots.flatMap(s=>s.lines), ...months.flatMap(m=>m.snapshot.lines)];
  const byId = new Map(allLines.map(line=>[line.id,line]));
  const lines = [...byId.values()].filter(line=>!line.installment);
  const grouped = new Map<string,BudgetLine[]>();
  for (const line of lines) {
    const categoryId = line.categoryId ?? "__uncategorized__";
    grouped.set(categoryId,[...(grouped.get(categoryId)??[]),line]);
  }
  const occurrences: HorizonOccurrence[] = [];
  const managedCategories = new Map<string,{rootId:string;category:string;reference:number}>();
  const rhythms: HorizonRhythm[] = [];
  const lastDay = epoch(periods[5]!.end);
  const todayN = epoch(today);
  for (const [categoryId, categoryLines] of grouped) {
    const sample = categoryLines[0]!;
    const purchaseDateOf = (line: BudgetLine) => (line.creditCard ? (line.purchaseDate ?? line.date) : line.date).slice(0,10);
    const actualLines = categoryLines.filter(line => (line.creditCard || line.status === "pago") && purchaseDateOf(line) <= today);
    const observed = uniqueDays(actualLines);
    const analysis = analyzeConsumptionPatterns(actualLines.map(line => ({ date:purchaseDateOf(line), amount:line.amount })),today);
    const preference = preferences[categoryId] ?? "auto";
    const allPurchaseHistory = actualLines.map(line=>({date:purchaseDateOf(line),amount:line.amount}));
    const weekly = isActiveWeeklyRoutine(allPurchaseHistory,today);
    // Apenas vencimentos mensais diretos comprovados contornam o filtro semanal.
    const directHistory = actualLines.filter(line=>!line.creditCard).map(line=>({date:purchaseDateOf(line),amount:line.amount}));
    const actualCards = actualLines.filter(line=>line.creditCard && !!line.cardId)
      .sort((a,b)=>purchaseDateOf(b).localeCompare(purchaseDateOf(a)));
    const referenceCardId = actualCards[0]?.cardId ?? null;
    const referenceCardName = data.cards.find(card=>card.id===referenceCardId)?.name??null;
    // Uma conta exclusivamente direta mensal continua no vencimento. Contas
    // variaveis mistas sao projetadas somente no ultimo cartao utilizado.
    const onlyDirectMonthly = actualCards.length===0 && isActiveDirectMonthly(directHistory,today);
    const validPatterns = analysis.patterns.filter(pattern => onlyDirectMonthly
      ? pattern.intervalDays>=24 && pattern.intervalDays<=36
      : weekly && pattern.intervalDays>=5 && pattern.intervalDays<=10);
    const patterns = preference === "pontual" ? [] : validPatterns;
    const managed = preference !== "pontual" && !onlyDirectMonthly && !weekly &&
      isActiveManagedConsumption(allPurchaseHistory,today);
    // Consumo administravel: referencia dos tres meses completos anteriores,
    // apurada pelo pagamento/vencimento, nunca pelo orcamento definido.
    const closedMonthStart = `${today.slice(0,7)}-01`;
    const historicalMonths = [-3,-2,-1].map(offset=>
      budgetSnapshot(data,monthOffset(closedMonthStart,offset),5));
    const cashValues=historicalMonths.map(snapshot=>round(snapshot.lines
      .filter(line=>line.categoryId===categoryId && !line.installment)
      .reduce((total,line)=>total+line.amount,0)));
    const reference = managed ? managedMonthlyReference(cashValues,allPurchaseHistory,today) : null;
    const monthlyReference = reference?.amount ?? null;
    // A memoria usa exatamente os tres snapshots fechados e a amostra de
    // compras elegiveis que alimentam a escolha entre caixa e data da compra.
    // Valores no caixa podem estar em mes diferente da compra no cartao.
    const historyMonthKeys = historicalMonths.map(h => h.period.start.slice(0,7));
    const purchaseHistory = actualLines.filter(line => {
      const date = purchaseDateOf(line);
      return date >= isoDay(epoch(today)-185) && date <= today;
    });
    const sourceMonths: HorizonAuditMonth[] = historicalMonths.map((historical, index) => {
      const month = historyMonthKeys[index]!;
      const cashLines = historical.lines.filter(line=>line.categoryId===categoryId && !line.installment);
      const purchaseLines = purchaseHistory.filter(line=>purchaseDateOf(line).slice(0,7)===month);
      const cashTotal = round(cashLines.reduce((total,line)=>total+line.amount,0));
      const purchaseTotal = round(purchaseLines.reduce((total,line)=>total+line.amount,0));
      return {month,cashTotal,purchaseTotal,cashCount:cashLines.length,
        purchaseCount:purchaseLines.length,
        includedInMedian: (reference?.source === "caixa" ? cashTotal : purchaseTotal)>0};
    });
    const sourceLines = purchaseHistory.map(line=>({
      id:line.id,description:line.description,purchaseDate:purchaseDateOf(line),
      cashDate:line.date.slice(0,10),amount:round(line.amount),
      channel:line.creditCard?"cartao" as const:"direto" as const,status:line.status,
    })).sort((a,b)=>b.purchaseDate.localeCompare(a.purchaseDate)||a.id.localeCompare(b.id));
    const cashSourceLines = historicalMonths.flatMap(historical=>historical.lines
      .filter(line=>line.categoryId===categoryId && !line.installment))
      .map(line=>({id:line.id,description:line.description,purchaseDate:purchaseDateOf(line),
        cashDate:line.date.slice(0,10),amount:round(line.amount),
        channel:line.creditCard?"cartao" as const:"direto" as const,status:line.status}))
      .sort((a,b)=>b.cashDate.localeCompare(a.cashDate)||a.id.localeCompare(b.id));
    const audit: HorizonAudit = {
      asOf:today,method:reference?.source ?? (patterns.length ? "cadencia":"sem_projecao"),
      sourceMonths,sourceLines,cashSourceLines,historyCount:purchaseHistory.length,
      excludedInstallmentCount:[...byId.values()].filter(line=>line.categoryId===categoryId && line.installment).length,
      excludedFutureCount:categoryLines.filter(line=>purchaseDateOf(line)>today).length,
      excludedUnpaidDirectCount:categoryLines.filter(line=>!line.creditCard && line.status!=="pago" && purchaseDateOf(line)<=today).length,
      monthlyReference:reference?.amount??null,observedMonths:reference?.observedMonths??0,
      note:reference?.source==="compras"
        ? "Mediana dos meses fechados com compras: usada quando as faturas deixam a serie de caixa incompleta. A estimativa continua alocada por caixa."
        :reference?.source==="caixa"
          ? "Mediana dos meses fechados com valores de caixa positivos; meses sem valor nao entram na mediana."
          :patterns.length ? "Frequencia e ticket dos padroes aprovados; cada nova ocorrencia e atribuida ao vencimento correspondente."
          : "Sem referencia automatica elegivel ou rotina comprovada; nenhum valor adicional e gerado.",
    };
    if (monthlyReference!==null) {
      managedCategories.set(categoryId,{rootId:sample.rootId,category:sample.category,reference:monthlyReference});
    }
    const lastPurchase = observed[observed.length-1]?.date??null;
    const nextDays = patterns.map(pattern=>{
      if (onlyDirectMonthly) {
        const last = new Date(`${pattern.lastDate}T00:00:00Z`);
        return epoch(dateAtDay(last.getUTCFullYear(),last.getUTCMonth()+1,last.getUTCDate()));
      }
      return epoch(pattern.lastDate)+pattern.intervalDays;
    });
    const nextPurchase = nextDays.length ? isoDay(Math.min(...nextDays)):null;
    const intervalDays = patterns.length === 1 ? patterns[0]!.intervalDays : null;
    const confidence = patterns.length===0?"insuficiente" as const:
      patterns.every(p=>p.observedMonths>=4 && p.count>=9)?"alta" as const:
      patterns.some(p=>p.observedMonths>=3)?"media" as const:"baixa" as const;
    const noCard = patterns.length>0 && !onlyDirectMonthly && !referenceCardId;
    rhythms.push({categoryId,category:sample.category,rootId:sample.rootId,intervalDays,lastPurchase,nextPurchase,
      referenceCard:referenceCardName,confidence,
      status:monthlyReference!==null?"mensal":!patterns.length?(managed?"eventual":"sem_padrao"):noCard?"sem_cartao":"rotina",
      monthlyReference,
      note:monthlyReference!==null?`Consumo administrável: referência de ${reference?.observedMonths ?? 0} meses fechados (${reference?.source==="compras"?"datas reais das compras; valor projetado no caixa":"vencimentos/pagamentos"}), sem criar compras ou datas fictícias.`:
        !patterns.length?(managed?"Histórico mensal ainda insuficiente para estimar sem extrapolação; nenhuma compra futura foi inventada.":"Sem rotina semanal ativa de quatro compras no mês, ou conta direta mensal comprovada. Gasto eventual: sem projeção automática."):
        noCard?"Rotina reconhecida, mas ainda não existe cartão de referência.":
        `${analysis.explanation} ${onlyDirectMonthly ? "Conta direta: vencimento estimado." :
          `Compras futuras no cartão ${referenceCardName??"de referência"}, pelo vencimento da fatura.`}`,
      audit,
      patterns:patterns.map(p=>({name:p.name,ticket:p.ticket,intervalDays:p.intervalDays,count:p.count})),
      calibration:{method:analysis.method,monthlyReference:analysis.monthlyReference,
        backtestSingleError:analysis.backtestSingleError,backtestSplitError:analysis.backtestSplitError}});
    if (!patterns.length || noCard) continue;
    const futureActual = categoryLines.filter(line=>purchaseDateOf(line)>today);
    const recordedPurchaseDates = futureActual.map(line=>({date:epoch(purchaseDateOf(line)),amount:line.amount}));
    const toleranceDays = (interval:number) => Math.max(1,Math.floor(interval/3));
    // O historico real (de qualquer forma de pagamento) ancora cada padrao.
    // Ocorrencias de subgrupos diferentes nao se anulam pelo simples fato
    // de ocorrerem no mesmo dia: o valor e usado para conciliar o grupo.
    for (const pattern of patterns) {
      const anchor = epoch(pattern.lastDate);
      const predictedDays:number[] = [];
      if (onlyDirectMonthly) {
        const last = new Date(`${pattern.lastDate}T00:00:00Z`);
        for (let offset=1;offset<=9;offset++) {
          const candidate=epoch(dateAtDay(last.getUTCFullYear(),last.getUTCMonth()+offset,last.getUTCDate()));
          if(candidate>todayN && candidate<=lastDay) predictedDays.push(candidate);
        }
      } else {
        const firstStep = Math.max(1,Math.floor((todayN-anchor)/pattern.intervalDays)+1);
        for(let candidate=anchor+firstStep*pattern.intervalDays;candidate<=lastDay && predictedDays.length<400;candidate+=pattern.intervalDays) {
          predictedDays.push(candidate);
        }
      }
      for(const dateNumber of predictedDays) {
        const purchaseDate=isoDay(dateNumber);
        const recorded = recordedPurchaseDates.find(actual=>
          Math.abs(actual.date-dateNumber)<=toleranceDays(pattern.intervalDays) &&
          (patterns.length===1 || (pattern.id==="pequenas" ? actual.amount<=(pattern.valueBoundary ?? Infinity) : actual.amount>(pattern.valueBoundary ?? 0))));
        if (recorded) {
          recordedPurchaseDates.splice(recordedPurchaseDates.indexOf(recorded),1);
          continue;
        }
        const payment=onlyDirectMonthly
          ? {paymentDate:purchaseDate,source:"vencimento_direto" as const}
          : paymentForCard(data,referenceCardId!,purchaseDate);
        if (!payment || payment.paymentDate<periods[0]!.start || payment.paymentDate>periods[5]!.end) continue;
        occurrences.push({categoryId,rootId:sample.rootId,category:sample.category,purchaseDate,
          paymentDate:payment.paymentDate,amount:pattern.ticket,channel:onlyDirectMonthly?"direto":"cartao",
          cardName:onlyDirectMonthly?null:referenceCardName,cycleSource:payment.source});
      }
    }
  }
  occurrences.sort((a,b)=>a.purchaseDate.localeCompare(b.purchaseDate)||a.category.localeCompare(b.category));
  const referenceBudget = months[0]?.snapshot;
  const monthlyResults: HorizonMonth[] = months.map(({period,snapshot})=>{
    const monthlyEstimates:HorizonMonthlyEstimate[]=[];
    // Baseline mensal e apenas a diferenca frente ao ja registrado;
    // se o comprometido supera a referencia, nao reduz o valor real.
    for(const [categoryId,managed] of managedCategories) {
      const registered=snapshot.lines.filter(line=>line.categoryId===categoryId)
        .reduce((total,line)=>total+line.amount,0);
      const additional=round(Math.max(0,managed.reference-registered));
      if(additional>0) monthlyEstimates.push({categoryId,rootId:managed.rootId,
        category:managed.category,reference:managed.reference,additional});
    }
    const selected=occurrences.filter(item=>item.paymentDate.slice(0,7)===period.start.slice(0,7));
    const byRoot = new Map<string,{id:string;name:string;budget:number;registered:number;additional:number;projected:number}>();
    const budgetSource = snapshot.budget>0?snapshot:referenceBudget;
    for(const category of budgetSource?.categories??[]) {
      byRoot.set(category.id,{id:category.id,name:category.name,budget:category.budget,registered:0,additional:0,projected:0});
    }
    for(const category of snapshot.categories){
      const existing=byRoot.get(category.id);
      byRoot.set(category.id,{id:category.id,name:category.name,budget:existing?.budget??category.budget,
        registered:category.spent,additional:0,projected:category.spent});
    }
    for(const occurrence of selected){
      const root=byRoot.get(occurrence.rootId)??{id:occurrence.rootId,name:occurrence.category,budget:0,registered:0,additional:0,projected:0};
      root.additional=round(root.additional+occurrence.amount);
      root.projected=round(root.registered+root.additional);
      byRoot.set(root.id,root);
    }
    for (const estimate of monthlyEstimates) {
      const root=byRoot.get(estimate.rootId)??{id:estimate.rootId,name:estimate.category,
        budget:0,registered:0,additional:0,projected:0};
      root.additional=round(root.additional+estimate.additional);
      root.projected=round(root.registered+root.additional);
      byRoot.set(root.id,root);
    }
    const plannedBudget=round([...byRoot.values()].reduce((sum,root)=>sum+root.budget,0));
    const projectedAdditional=round(selected.reduce((sum,item)=>sum+item.amount,0)+
      monthlyEstimates.reduce((sum,item)=>sum+item.additional,0));
    return {period,snapshot,plannedBudget,inheritedBudget:snapshot.budget===0&&plannedBudget>0,
      registered:snapshot.registered,projectedAdditional,projected:round(snapshot.registered+projectedAdditional),
      occurrences:selected,monthlyEstimates,byRoot:[...byRoot.values()]};
  });
  return {months:monthlyResults,rhythms,occurrences};
}

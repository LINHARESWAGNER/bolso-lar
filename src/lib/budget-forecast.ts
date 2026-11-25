import type { HealthData } from "./financial-health";
import type { HorizonAudit } from "./budget-horizon";
import { analyzeConsumptionPatterns, isActiveWeeklyRoutine, isActiveDirectMonthly, isActiveManagedConsumption, managedMonthlyReference } from "./budget-patterns";
import {
  budgetSnapshot,
  type BudgetCategory,
  type BudgetDIKW,
  type BudgetLine,
  type BudgetSnapshot,
} from "./budget-dikw";

export type ProjectionPreference = "auto" | "rotina" | "pontual";
export type ProjectionConfidence = "alta" | "media" | "baixa" | "insuficiente";
export type CategoryRhythm = {
  id: string;
  name: string;
  rootId: string;
  preference: ProjectionPreference;
  kind: "recorrente" | "pontual" | "incerto";
  confidence: ProjectionConfidence;
  intervalDays: number | null;
  observedEvents: number;
  historicalEvents: number;
  monthsWithHistory: number;
  historicalMonthlyAverage: number;
  historicalTicket: number;
  currentTicket: number | null;
  estimatedTicket: number | null;
  expectedOccurrences: number;
  registered: number;
  alreadyScheduled: number;
  projectedAdditional: number;
  description: string;
  audit?: HorizonAudit;
};
export type RootForecast = {
  id: string;
  name: string;
  budget: number;
  registered: number;
  additional: number;
  projected: number;
  excess: number;
  coverage: number;
  rhythms: CategoryRhythm[];
};
export type CategoryComparison = {
  id: string;
  name: string;
  current: number;
  previous: number | null;
  averageThree: number | null;
  changePrevious: number | null;
  changeAverage: number | null;
  consecutiveOver: number;
  insight: string;
};
export type BudgetForecast = {
  roots: RootForecast[];
  rhythms: CategoryRhythm[];
  comparisons: CategoryComparison[];
  registered: number;
  additional: number;
  projected: number;
  overBudget: number;
  unmodeledAverage: number;
  confidence: ProjectionConfidence;
  disclaimer: string;
  recommended: {
    title: string;
    explanation: string;
    action: string;
    effect: string;
    categoryId: string | null;
  };
};

const round = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const money = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dayNumber = (value: string) =>
  Math.floor(Date.parse(`${value.slice(0, 10)}T00:00:00Z`) / 86400000);
const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const average = (values: number[]) =>
  values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
const monthPeriod = (start: string, offset: number) => {
  const [year, month] = start.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + offset, 1));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return {
    start: `${y}-${m}-01`,
    end: `${y}-${m}-${String(new Date(Date.UTC(y, d.getUTCMonth() + 1, 0)).getUTCDate()).padStart(2, "0")}`,
    months: 1,
  };
};
const byDay = (lines: BudgetLine[]) => {
  const map = new Map<string, number>();
  for (const item of lines) {
    const day = item.date.slice(0, 10);
    map.set(day, (map.get(day) ?? 0) + item.amount);
  }
  return [...map]
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
};
const names = (root: BudgetSnapshot, history: BudgetSnapshot[], current: BudgetSnapshot) =>
  new Map(
    [...current.lines, ...root.lines, ...history.flatMap((month) => month.lines)].map((line) => [
      line.categoryId ?? "__uncategorized__",
      line.category,
    ]),
  );

/** Projeta apenas séries com evidência de periodicidade; não inventa comportamento para compras pontuais. */
export function buildBudgetForecast(
  data: HealthData,
  report: BudgetDIKW,
  today: string,
  preferences: Record<string, ProjectionPreference> = {},
): BudgetForecast {
  const history = [-1, -2, -3, -4, -5, -6].map((offset) =>
    budgetSnapshot(data, monthPeriod(report.current.period.start, offset), 5),
  );
  const current = report.current;
  const rootNames = new Map(current.categories.map((category) => [category.id, category.name]));
  const categoryNames = names(report.closed, history, current);
  const all = [...current.lines, ...history.flatMap((h) => h.lines)];
  // O historico e agrupado por categoria e mes de PAGAMENTO (budgetSnapshot),
  // mas cada rotina conserva a data da COMPRA para inferir cadencia sem colapsar
  // todas as compras no dia de vencimento da fatura.
  // As compras no cartao usam o ciclo da fatura; contas diretas com vencimento
  // mensal (Agua, Energia etc.) continuam sendo despesas de caixa e tambem
  // precisam de previsao quando nao ha lancamento para o proximo mes.
  // Regra historica: identificar cada rotina exclusivamente pela categoria/subcategoria.
  // O canal (direto ou cartao) e o cartao individual sao subdivisoes tecnicas
  // para nao misturar vencimentos diretos com ciclos de faturas diferentes.
  // A descricao do lancamento NAO faz parte da chave de agrupamento.
  const leafKey = (line: BudgetLine) => line.creditCard && line.cardId
    ? `${line.categoryId ?? "__uncategorized__"}::${line.cardId}`
    : !line.creditCard
      ? `${line.categoryId ?? "__uncategorized__"}::direct`
      : null;
  const leafIds = new Set(all.map(leafKey).filter((id): id is string => id !== null));
  const invoiceByCard = new Map<string, { closing: string; due: string }>();
  const targetMonth = current.period.start.slice(0, 7);
  for (const invoice of data.invoices) {
    if (invoice.status === "paga" || invoice.closing_date.slice(0, 10) <= today || invoice.due_date.slice(0, 7) !== targetMonth) continue;
    const known = invoiceByCard.get(invoice.credit_card_id);
    if (!known || invoice.closing_date < known.closing) {
      invoiceByCard.set(invoice.credit_card_id, { closing: invoice.closing_date.slice(0, 10), due: invoice.due_date.slice(0, 10) });
    }
  }
  const rhythms: CategoryRhythm[] = [];
  const todayDay = dayNumber(today);
  // O horizonte para cada rotina e o fechamento real da fatura que vence no mes alvo.

  for (const id of leafIds) {
    const [categoryId, cardId] = id.split("::");
    const isDirect = cardId === "direct";
    const leaf = (line: BudgetLine) => leafKey(line) === id;
    // Cartao: ritmo pela data da compra, impacto no vencimento da fatura.
    // Pagamento direto: ritmo e impacto pela data do vencimento/pagamento.
    const toPurchaseDay = (line: BudgetLine): BudgetLine => ({
      ...line, date: line.creditCard ? (line.purchaseDate ?? line.date) : line.date,
    });
    const pastLines = history.flatMap((h) => h.lines.filter(leaf).map(toPurchaseDay));
    const present = current.lines.filter(leaf).map(toPurchaseDay);
    const rootId = present[0]?.rootId ?? pastLines[0]?.rootId ?? "__uncategorized__";
    const cycle = !isDirect && cardId ? invoiceByCard.get(cardId) : undefined;
    const endDay = cycle ? dayNumber(cycle.closing) : dayNumber(current.period.end);
    const daysRemaining = Math.max(0, endDay - todayDay);
    const preference = preferences[categoryId ?? "__uncategorized__"] ?? preferences[id] ?? "auto";
    // Parcelas nao representam novas compras recorrentes.
    const historicalHabitLines = pastLines.filter(
      (line) => !line.installment
    );
    const presentHabitLines = present.filter(
      (line) => !line.installment
    );
    const visits = byDay(historicalHabitLines);
    const seenMonths = new Set(visits.map((v) => v.date.slice(0, 7))).size;
    const gaps = visits
      .slice(1)
      .map((visit, index) => dayNumber(visit.date) - dayNumber(visits[index].date));
    const interval = gaps.length ? median(gaps) : 0;
    const dispersion =
      interval > 0 && gaps.length
        ? median(gaps.map((gap) => Math.abs(gap - interval))) / interval
        : Infinity;
    const isStable =
      seenMonths >= 3 && visits.length >= 6 && interval >= 2 && interval <= 16 && dispersion <= 0.5;
    const isMonthly =
      seenMonths >= 3 &&
      visits.length >= 3 &&
      interval >= 24 &&
      interval <= 35 &&
      dispersion <= 0.3;
    const weakCadence =
      preference === "rotina" &&
      seenMonths >= 2 &&
      visits.length >= 3 &&
      interval >= 2 &&
      interval <= 35 &&
      dispersion <= 0.65;
    const completeHistory = [...pastLines, ...present]
      .filter(line => !line.installment && (line.creditCard || line.status === "pago") && line.date.slice(0,10)<=today)
      .map(line => ({date:line.date.slice(0,10),amount:line.amount}));
    const routine = preference !== "pontual" && (isDirect
      ? isActiveDirectMonthly(completeHistory,today) && isMonthly
      : isActiveWeeklyRoutine(completeHistory,today) && (interval ?? 0)>=5 && (interval ?? 0)<=10);
    const intervalDays = routine ? Math.max(1, Math.round(interval)) : null;
    // Compras no cartao ja efetuadas continuam "previstas" ate a fatura ser paga.
    // Elas sao observacoes validas quando a competencia ja passou. Compromissos
    // nao pagos fora do cartao nao provam que uma nova compra aconteceu.
    const pastVisits = byDay(
      presentHabitLines.filter(
        (line) => dayNumber(line.date) <= todayDay && (line.status === "pago" || line.creditCard),
      ),
    );
    const futureVisits = byDay(presentHabitLines.filter((line) => dayNumber(line.date) > todayDay));
    const registered = round(present.reduce((total, line) => total + line.amount, 0));
    const alreadyScheduled = round(futureVisits.reduce((total, visit) => total + visit.amount, 0));
    const monthlyTotals = history.map((h) =>
      round(h.lines.filter((line) => leaf(line) && !line.installment).reduce((total, line) => total + line.amount, 0)),
    );
    const historicalMonthlyAverage = round(average(monthlyTotals.slice(0, 3)));
    const historicalTicket = round(average(visits.map((visit) => visit.amount)));
    const currentTicket = pastVisits.length
      ? round(average(pastVisits.map((visit) => visit.amount)))
      : null;
    const estimatedTicket = routine
      ? round(
          currentTicket === null ? historicalTicket : 0.6 * currentTicket + 0.4 * historicalTicket,
        )
      : null;
    let expectedOccurrences = 0;
    if (isDirect) {
      // Conta mensal direta: projetar 1 vencimento no mes-alvo se ha pelo
      // menos tres meses com cadencia mensal, sem lancamento conhecido nesse
      // mes e sem data prevista ja ultrapassada. Nao exigir fatura de cartao.
      const last = visits.length ? visits[visits.length - 1] : undefined;
      const typicalDueDay = last ? Number(last.date.slice(8, 10)) : 1;
      const dueDay = Math.min(typicalDueDay, Number(current.period.end.slice(8, 10)));
      const predictedDue = `${targetMonth}-${String(dueDay).padStart(2, "0")}`;
      if (routine && isMonthly && present.length === 0 && predictedDue >= today) {
        expectedOccurrences = 1;
      } else if (routine && !isMonthly && intervalDays && estimatedTicket && daysRemaining > 0 &&
                 !all.some((line) => line.creditCard && line.cardId &&
                   (line.categoryId ?? "__uncategorized__") === categoryId)) {
        // Frequencias curtas de pagamentos diretos tambem sao rotina de caixa.
        // Nao exigir fatura de cartao, nem replicar compromissos ja registrados.
        const lastSeen = pastVisits.length
          ? dayNumber(pastVisits[pastVisits.length - 1]!.date)
          : visits.length ? dayNumber(visits[visits.length - 1]!.date) : todayDay;
        const firstStep = Math.max(1, Math.floor((todayDay - lastSeen) / intervalDays) + 1);
        const registeredUpcoming = futureVisits.map((visit) => dayNumber(visit.date));
        let checked = 0;
        for (let due = lastSeen + firstStep * intervalDays;
             due <= endDay && checked < 60; due += intervalDays, checked++) {
          if (!registeredUpcoming.some((date) =>
            Math.abs(date - due) <= Math.max(1, Math.floor(intervalDays / 3)))) {
            expectedOccurrences++;
          }
        }
      }
    } else if (routine && intervalDays && estimatedTicket && daysRemaining > 0 && cycle) {
      // A cadencia fica ancorada na ultima compra realmente observada (inclui
      // compra no cartao ainda nao paga). Sem compra nova, nao deslocar eventos
      // vencidos para a frente: cada janela perdida deixa de compor o fechamento.
      const anchor = pastVisits.length
        ? dayNumber(pastVisits[pastVisits.length - 1].date)
        : visits.length
          ? dayNumber(visits[visits.length - 1].date)
          : todayDay;
      const registeredUpcoming = futureVisits.map((visit) => dayNumber(visit.date));
      // Salta datas passadas sem criar um novo ciclo ancorado no dia de hoje.
      const firstStep = Math.max(1, Math.floor((todayDay - anchor) / intervalDays) + 1);
      for (let due = anchor + firstStep * intervalDays; due <= endDay; due += intervalDays) {
        if (
          registeredUpcoming.some(
            (date) => Math.abs(date - due) <= Math.max(1, Math.floor(intervalDays / 3)),
          )
        )
          continue;
        expectedOccurrences++;
      }
    }
    const projectedAdditional = round(expectedOccurrences * (estimatedTicket ?? 0));
    const confidence: ProjectionConfidence = !routine
      ? "insuficiente"
      : seenMonths >= 4 && visits.length >= 10 && dispersion <= 0.3
        ? "alta"
        : seenMonths >= 3 && visits.length >= 6
          ? "media"
          : "baixa";
    const kind = preference === "pontual" ? "pontual" : routine ? "recorrente" : "incerto";
    const cycleText = isDirect
      ? (expectedOccurrences > 0
        ? ` Pagamento direto: vencimentos adicionais estimados em ${targetMonth.slice(5, 7)}/${targetMonth.slice(0, 4)}, com base nos vencimentos anteriores. Nao depende do ciclo do cartao.`
        : ` Pagamento direto: previsao condicionada ao padrao historico e aos vencimentos ainda futuros, sem repetir lancamentos cadastrados.`)
      : cycle
        ? ` Projecao atribuida a fatura que vence em ${cycle.due.slice(8, 10)}/${cycle.due.slice(5, 7)}/${cycle.due.slice(0, 4)} (fecha em ${cycle.closing.slice(8, 10)}/${cycle.closing.slice(5, 7)}).`
        : " Sem fatura aberta identificada com vencimento no mes analisado: nenhuma nova compra no cartao extrapolada.";
    const description =
      preference === "pontual"
        ? "Marcado como pontual nesta sessão: nenhuma recorrência extrapolada."
        : routine
          ? `Histórico de ${visits.length} ocorrências em ${seenMonths} meses; intervalo típico de ${intervalDays} dias (dispersão ${(dispersion * 100).toFixed(0)}%). Valor médio anterior ${money(historicalTicket)}${currentTicket === null ? "" : `; valor observado neste mês ${money(currentTicket)}`}. ${expectedOccurrences} próxima(s) ocorrência(s) estimada(s); ${money(alreadyScheduled)} já previsto(s) não é duplicado.`
          : `Sem cadência consistente: ${visits.length} ocorrência(s) em ${seenMonths} mês(es). Gastos pontuais não foram extrapolados.`;
    const cashDescription = `${description}${cycleText}`;
    rhythms.push({
      id,
      name: categoryNames.get(categoryId ?? "") ??
        present[0]?.category ?? pastLines[0]?.category ?? "Sem categoria",
      rootId,
      preference,
      kind,
      confidence,
      intervalDays,
      observedEvents: pastVisits.length,
      historicalEvents: visits.length,
      monthsWithHistory: seenMonths,
      historicalMonthlyAverage,
      historicalTicket,
      currentTicket,
      estimatedTicket,
      expectedOccurrences,
      registered,
      alreadyScheduled,
      projectedAdditional,
      description: cashDescription,
    });
  }

  // A chave financeira (subcategoria + canal/cartao) continua interna: ela
  // determina o vencimento correto da fatura e evita misturar seus ciclos.
  // A analise visivel, no entanto, e UMA por category_id, independentemente
  // de cartao, pagamento direto ou texto da descricao dos lancamentos.
  const componentsByCategory = new Map<string, CategoryRhythm[]>();
  for (const component of rhythms) {
    const categoryId = component.id.split("::")[0] ?? "__uncategorized__";
    const group = componentsByCategory.get(categoryId) ?? [];
    group.push(component);
    componentsByCategory.set(categoryId, group);
  }
  // Etapa 6I: consumo e um habito da SUBCATEGORIA, nao do cartao.
  // Historico inclui compras pagas diretamente (Gift/debito), que atualizam
  // a ultima data real e a cadencia. Novas compras simuladas sao SEMPRE no
  // ultimo cartao efetivamente usado nesta subcategoria. Se ele nao tiver
  // fatura elegivel para o mes-alvo, NAO transferir a previsao a outro
  // cartao ou ao pagamento direto: ela pertenceria a outro mes de caixa.
  // Contas mensais diretas sem habito de compras no cartao (Agua/Energia)
  // continuam com sua projecao propria por vencimento.
  for (const [categoryId, components] of componentsByCategory) {
    const cardComponents = components.filter((part) => !part.id.endsWith("::direct"));
    if (!cardComponents.length) continue;
    const sameCategoryExpense = (line: BudgetLine) =>
      !line.installment && (line.categoryId ?? "__uncategorized__") === categoryId;
    const historicalPurchases = history.flatMap((month) => month.lines.filter(sameCategoryExpense));
    const currentPurchases = current.lines.filter(sameCategoryExpense);
    const purchaseDateOf = (line: BudgetLine) => line.creditCard
      ? (line.purchaseDate ?? line.date) : line.date;
    const toPurchaseDate = (line: BudgetLine) => ({
      ...line, date: purchaseDateOf(line),
    });
    // Data real do ultimo gasto (inclusive Gift/debito) ancora a proxima
    // compra. Gastos futuros ainda nao realizados nao ancoram o ritmo.
    const observed = byDay([...historicalPurchases, ...currentPurchases]
      .filter((line) => line.creditCard || line.status === "pago")
      .map(toPurchaseDate)
      .filter((line) => line.date.slice(0, 10) <= today));
    const historyDays = byDay(historicalPurchases
      .filter((line) => line.creditCard || line.status === "pago")
      .map(toPurchaseDate));
    const analysis = analyzeConsumptionPatterns(
      [...historicalPurchases, ...currentPurchases]
        .filter(line => (line.creditCard || line.status === "pago") &&
          purchaseDateOf(line).slice(0, 10) <= today)
        .map(line => ({date:purchaseDateOf(line).slice(0,10), amount:line.amount})),
      today,
    );
    const preference = preferences[categoryId] ?? "auto";
    const consolidatedHistory = [...historicalPurchases,...currentPurchases]
      .filter(line=>(line.creditCard||line.status==="pago") && purchaseDateOf(line).slice(0,10)<=today)
      .map(line=>({date:purchaseDateOf(line).slice(0,10),amount:line.amount}));
    const validWeekly=isActiveWeeklyRoutine(consolidatedHistory,today);
    const patterns = preference === "pontual" || !validWeekly ? [] :
      analysis.patterns.filter(p=>p.intervalDays>=5 && p.intervalDays<=10);
    const months = new Set(historyDays.map(visit => visit.date.slice(0,7))).size;
    const detected = patterns.length > 0;
    const typical = patterns.length===1 ? patterns[0]!.intervalDays : 0;
    const dispersion = 0;
    // Recalcula todas as previsoes de cartao para esta categoria, porque a
    // consolidacao deve substituir, e nunca somar, as antigas previsoes por canal.
    for (const part of cardComponents) {
      part.expectedOccurrences = 0;
      part.projectedAdditional = 0;
      part.kind = preference === "pontual" ? "pontual" : detected ? "recorrente" : "incerto";
    }
    const cardPurchases = [...historicalPurchases, ...currentPurchases]
      .filter((line) => line.creditCard && !!line.cardId &&
        purchaseDateOf(line).slice(0, 10) <= today)
      .sort((a, b) => purchaseDateOf(b).localeCompare(purchaseDateOf(a)) ||
        String(b.id).localeCompare(String(a.id)));
    const referenceCardId = cardPurchases[0]?.cardId;
    // A escolha e FIXA pelo ultimo cartao real da subcategoria, mesmo se
    // outro cartao tiver fatura aberta mais conveniente no mes-alvo.
    const referencePart = cardComponents.find((part) =>
      part.id === `${categoryId}::${referenceCardId}`);
    const referenceCycle = referenceCardId ? invoiceByCard.get(referenceCardId) : undefined;
    const candidates = referencePart && referenceCycle
      ? [{ cardId: referenceCardId!, part: referencePart, cycle: referenceCycle }]
      : [];
    const meanTicket = round(average(historyDays.map(visit => visit.amount)));
    const currentDays = byDay(currentPurchases.map(toPurchaseDate)
      .filter(line => line.date.slice(0,10) <= today));
    const recentTicket = currentDays.length ? round(average(currentDays.map(day => day.amount))) : null;
    const ticket = patterns.length ? round(average(patterns.map(p => p.ticket))) : 0;
    const intervals = patterns.length===1 ? patterns[0]!.intervalDays : null;
    if (detected && candidates.length) {
      const maxClosing = Math.max(...candidates.map(candidate => dayNumber(candidate.cycle.closing)));
      const registeredFuture = currentPurchases
        .filter(line => dayNumber(purchaseDateOf(line)) > todayDay)
        .map(line => ({ date:dayNumber(purchaseDateOf(line)), amount:line.amount }));
      // Cada grupo possui propria cadencia, ancora e ticket robusto.
      for (const pattern of patterns) {
        const anchor = dayNumber(pattern.lastDate);
        const first = Math.max(1, Math.floor((todayDay-anchor)/pattern.intervalDays)+1);
        let generated=0;
        for (let forecastDay=anchor+first*pattern.intervalDays;
             forecastDay<=maxClosing && generated<60;
             forecastDay+=pattern.intervalDays) {
          generated++;
          const duplicate=registeredFuture.find(actual =>
            Math.abs(actual.date-forecastDay)<=Math.max(1,Math.floor(pattern.intervalDays/3)) &&
            (patterns.length===1 || (pattern.id==="pequenas" ? actual.amount<=(pattern.valueBoundary ?? Infinity) : actual.amount>(pattern.valueBoundary ?? 0))));
          if (duplicate) { registeredFuture.splice(registeredFuture.indexOf(duplicate),1); continue; }
          const chosen = candidates.find(candidate => forecastDay<=dayNumber(candidate.cycle.closing));
          if (!chosen) continue;
          chosen.part.expectedOccurrences++;
          chosen.part.projectedAdditional=round(chosen.part.projectedAdditional+pattern.ticket);
          chosen.part.kind="recorrente";
          chosen.part.confidence=pattern.observedMonths>=4&&pattern.count>=9?"alta":
            pattern.observedMonths>=3?"media":"baixa";
        }
      }
    }
    // O relato detalhado sera consolidado abaixo: o ritmo pertence a categoria,
    // enquanto as datas de fechamento determinam apenas sua alocacao no caixa.
    for (const part of cardComponents) {
      part.historicalEvents = historyDays.length;
      part.monthsWithHistory = months;
      part.intervalDays = detected ? intervals : null;
      part.historicalTicket = meanTicket;
      part.currentTicket = recentTicket;
      part.estimatedTicket = detected ? ticket : null;
      part.description = detected
        ? `Cadencia consolidada da subcategoria: ${historyDays.length} dias com compras em ${months} meses; ${analysis.method === "segmentado" ? "padroes de compras pequenas e maiores" : "padrao unico robusto"}. ${patterns.map(p=>`${p.name}: ${p.intervalDays} dias, ${money(p.ticket)}`).join("; ")}. Impacto atribuido a faturas abertas que vencem no mes analisado.`
        : `Sem cadencia consolidada suficiente: ${historyDays.length} dias de compras em ${months} meses.`;
    }
  }

  // 6L: gastos administraveis frequentes usam REFERENCIA MENSAL de caixa,
  // e nao novas datas inventadas. Os valores ja registrados prevalecem.
  const managedCashByCategory = new Map<string,number>();
  const managedAuditByCategory = new Map<string,HorizonAudit>();
  const threeClosed = [-2,-1,0].map(offset=>budgetSnapshot(data,monthPeriod(report.closed.period.start,offset),5));
  for (const [categoryId, components] of componentsByCategory) {
    if(preferences[categoryId]==="pontual" || components.some(part=>part.kind==="recorrente")) continue;
    const matching = (line:BudgetLine)=>!line.installment && (line.categoryId??"__uncategorized__")===categoryId;
    const purchaseDateOf=(line:BudgetLine)=>line.creditCard?(line.purchaseDate??line.date):line.date;
    const source=[...history.flatMap(month=>month.lines.filter(matching)),...current.lines.filter(matching)]
      .filter(line=>(line.creditCard||line.status==="pago") && purchaseDateOf(line).slice(0,10)<=today)
      .map(line=>({date:purchaseDateOf(line).slice(0,10),amount:line.amount}));
    if(!isActiveManagedConsumption(source,today)) continue;
    const cashAmounts=threeClosed.map(month=>round(month.lines.filter(matching).reduce((sum,line)=>sum+line.amount,0)));
    const reference=managedMonthlyReference(cashAmounts,source,today);
    if(!reference) continue;
    const baseline=reference.amount;
    const registered=round(current.lines.filter(line=>(line.categoryId??"__uncategorized__")===categoryId).reduce((sum,line)=>sum+line.amount,0));
    const remaining=round(Math.max(0,baseline-registered));
    managedCashByCategory.set(categoryId,baseline);
    // Memoria de calculo fiel ao proprio motor de curto prazo (dezembro).
    // Este conjunto NAO e substituido pela amostra do horizonte de janeiro.
    const eligibleHistory=[...history.flatMap(month=>month.lines.filter(matching)),
      ...current.lines.filter(matching)]
      .filter(line=>(line.creditCard||line.status==="pago") && purchaseDateOf(line).slice(0,10)<=today);
    const auditMonths=threeClosed.map((month)=>{
      const cashLines=month.lines.filter(matching);
      const key=month.period.start.slice(0,7);
      const purchaseLines=eligibleHistory.filter(line=>purchaseDateOf(line).slice(0,7)===key);
      const cashTotal=round(cashLines.reduce((sum,line)=>sum+line.amount,0));
      const purchaseTotal=round(purchaseLines.reduce((sum,line)=>sum+line.amount,0));
      return {month:key,cashTotal,purchaseTotal,cashCount:cashLines.length,
        purchaseCount:purchaseLines.length,
        includedInMedian:(reference.source==="caixa"?cashTotal:purchaseTotal)>0};
    });
    const auditLine=(line:BudgetLine)=>({id:line.id,description:line.description,
      purchaseDate:purchaseDateOf(line).slice(0,10),cashDate:line.date.slice(0,10),
      amount:round(line.amount),channel:line.creditCard?"cartao" as const:"direto" as const,status:line.status});
    managedAuditByCategory.set(categoryId,{
      asOf:today,method:reference.source,sourceMonths:auditMonths,
      sourceLines:eligibleHistory.map(auditLine).sort((a,b)=>b.purchaseDate.localeCompare(a.purchaseDate)),
      cashSourceLines:threeClosed.flatMap(month=>month.lines.filter(matching)).map(auditLine)
        .sort((a,b)=>b.cashDate.localeCompare(a.cashDate)),
      historyCount:eligibleHistory.length,
      excludedInstallmentCount:[...history.flatMap(month=>month.lines),...current.lines]
        .filter(line=>(line.categoryId??"__uncategorized__")===categoryId && !!line.installment).length,
      excludedFutureCount:[...history.flatMap(month=>month.lines),...current.lines]
        .filter(line=>matching(line) && purchaseDateOf(line).slice(0,10)>today).length,
      excludedUnpaidDirectCount:[...history.flatMap(month=>month.lines),...current.lines]
        .filter(line=>matching(line) && !line.creditCard && line.status!=="pago" && purchaseDateOf(line).slice(0,10)<=today).length,
      monthlyReference:baseline,observedMonths:reference.observedMonths,
      note:reference.source==="compras"
        ? "Dezembro: mediana dos meses com compras elegiveis; faturas deixaram lacunas na serie de caixa."
        : "Dezembro: mediana dos meses fechados com valores financeiros positivos."
    });

    if(remaining>0) {
      components[0]!.projectedAdditional=remaining;
      components[0]!.expectedOccurrences=0;
      components[0]!.description=`Consumo administravel: referencia mensal ${money(baseline)} de ${reference.observedMonths} meses fechados (${reference.source==="compras"?"datas reais das compras; alocacao estimada no caixa":"vencimento/pagamento"}). Estimativa adicional ${money(remaining)}, sem criar compras ou vencimentos ficticios.`;
    }
  }

  const categoryRhythms: CategoryRhythm[] = [...componentsByCategory].map(([id, components]) => {
    const sample = components[0]!;
    const ofCategory = (line: BudgetLine) =>
      (line.categoryId ?? "__uncategorized__") === id && !line.installment;
    const historicalLines = history.flatMap((h) => h.lines.filter(ofCategory));
    const historicalDays = byDay(historicalLines.map((line) => ({
      ...line, date: line.creditCard ? (line.purchaseDate ?? line.date) : line.date,
    })));
    const monthsWithHistory = new Set(historicalLines.map((line) => line.date.slice(0, 7))).size;
    const intervals = historicalDays.slice(1).map((day, i) =>
      dayNumber(day.date) - dayNumber(historicalDays[i]!.date));
    const typicalInterval = intervals.length ? Math.round(median(intervals) ?? 0) : null;
    const projectedAdditional = round(components.reduce((total, r) => total + r.projectedAdditional, 0));
    const registered = round(components.reduce((total, r) => total + r.registered, 0));
    const expectedOccurrences = components.reduce((total, r) => total + r.expectedOccurrences, 0);
    const alreadyScheduled = round(components.reduce((total, r) => total + r.alreadyScheduled, 0));
    const historicalMonthlyAverage = round(components.reduce((total, r) => total + r.historicalMonthlyAverage, 0));
    const detected = components.filter((r) => r.kind === "recorrente");
    const active = detected.filter((r) => r.expectedOccurrences > 0);
    const kind: CategoryRhythm["kind"] = detected.length ? "recorrente"
      : components.every((r) => r.kind === "pontual") ? "pontual" : "incerto";
    const confidence: ProjectionConfidence = !detected.length ? "insuficiente"
      : detected.some((r) => r.confidence === "baixa") ? "baixa"
      : detected.every((r) => r.confidence === "alta") ? "alta" : "media";
    const currentObserved = components.filter((r) => r.currentTicket !== null);
    const currentVisits = currentObserved.reduce((total, r) => total + r.observedEvents, 0);
    const currentTicket = currentVisits
      ? round(currentObserved.reduce((total, r) => total + (r.currentTicket ?? 0) * r.observedEvents, 0) / currentVisits)
      : null;
    const historicalTicket = historicalDays.length
      ? round(average(historicalDays.map((day) => day.amount))) : 0;
    const estimatedTicket = expectedOccurrences > 0
      ? round(projectedAdditional / expectedOccurrences) : null;
    const sourceDetail = components.length > 1
      ? ` Calculo interno: ${components.length} ciclos/canais de pagamento considerados, consolidados sem duplicar compras e parcelas.`
      : "";
    const partialDetails = active.map((r) =>
      `${r.id.includes("::direct") ? "Pagamento direto" : "Cartao"}: ${r.expectedOccurrences} ocorrencia(s), ${money(r.projectedAdditional)}`);
    const managedReference=managedCashByCategory.get(id);
    const description = managedReference!==undefined
      ? `Consumo administrável pelo histórico mensal de caixa (${money(managedReference)}), descontando compromissos registrados. Sem datas de compras artificiais.`
      : kind === "pontual"
      ? "Marcada como despesa pontual nesta analise: nenhuma nova ocorrencia extrapolada."
      : `Historico consolidado de ${historicalDays.length} dia(s) com despesas em ${monthsWithHistory} mes(es). ` +
        `${detected.length ? "Rotina detectada" : "Sem cadencia consistente"}` +
        `${typicalInterval === null ? "" : `; intervalo tipico entre compras/vencimentos de ${typicalInterval} dia(s)`}. ` +
        `Valor medio historico por dia com gasto ${money(historicalTicket)}. ` +
        `${expectedOccurrences} ocorrencia(s) adicional(is) estimada(s): ${money(projectedAdditional)}; ` +
        `${money(alreadyScheduled)} de ocorrencias futuras ja cadastradas nao sao duplicadas.` +
        `${sourceDetail}${partialDetails.length ? ` Detalhe por canal: ${partialDetails.join("; ")}.` : ""}`;
    return {
      id, name: categoryNames.get(id) ?? sample.name,
      rootId: sample.rootId,
      preference: preferences[id] ?? "auto",
      kind, confidence,
      intervalDays: typicalInterval,
      observedEvents: currentVisits,
      historicalEvents: historicalDays.length,
      monthsWithHistory,
      historicalMonthlyAverage,
      historicalTicket,
      currentTicket,
      estimatedTicket,
      expectedOccurrences,
      registered,
      alreadyScheduled,
      projectedAdditional,
      description,
      ...(managedAuditByCategory.has(id) ? { audit: managedAuditByCategory.get(id)! } : {}),
    };
  });

  const rootCatalog = new Map<string, BudgetCategory>(
    current.categories.map((cat) => [cat.id, cat]),
  );
  // Inclui categorias que ainda não possuem lançamentos nem limite no mês atual,
  // mas têm uma rotina histórica que pode produzir despesa neste mês.
  for (const rhythm of rhythms) {
    if (!rootCatalog.has(rhythm.rootId))
      rootCatalog.set(rhythm.rootId, {
        id: rhythm.rootId,
        name:
          rhythm.rootId === "__uncategorized__"
            ? "Sem categoria"
            : (history.flatMap((h) => h.categories).find((c) => c.id === rhythm.rootId)?.name ??
              rhythm.name),
        budget: 0,
        spent: 0,
        difference: 0,
        consumption: null,
        state: "sem_consumo",
        excessContribution: 0,
        lines: [],
      });
  }
  const roots: RootForecast[] = [...rootCatalog.values()]
    .map((cat: BudgetCategory) => {
      const group = rhythms.filter((r) => r.rootId === cat.id);
      const additional = round(group.reduce((total, r) => total + r.projectedAdditional, 0));
      const projected = round(cat.spent + additional);
      const weight = group.reduce((total, r) => total + r.historicalMonthlyAverage, 0);
      const modeled = group
        .filter((r) => r.kind === "recorrente")
        .reduce((total, r) => total + r.historicalMonthlyAverage, 0);
      return {
        id: cat.id,
        name: rootNames.get(cat.id) ?? cat.name,
        budget: cat.budget,
        registered: cat.spent,
        additional,
        projected,
        excess: round(Math.max(0, projected - cat.budget)),
        coverage: weight ? modeled / weight : 0,
        rhythms: categoryRhythms.filter((r) => r.rootId === cat.id),
      };
    })
    .sort((a, b) => b.excess - a.excess || b.additional - a.additional);
  const previousClosed = budgetSnapshot(data, monthPeriod(report.closed.period.start, -1), 5);
  const lastThreeClosed = [-1, -2, -3].map((offset) =>
    budgetSnapshot(data, monthPeriod(report.closed.period.start, offset), 5),
  );
  const comparisons: CategoryComparison[] = report.closed.categories
    .map((cat) => {
      const previous =
        previousClosed.budget > 0
          ? (previousClosed.categories.find((c) => c.id === cat.id)?.spent ?? 0)
          : null;
      const completeHistory = lastThreeClosed.every((month) => month.budget > 0);
      const avg = completeHistory
        ? average(
            lastThreeClosed.map(
              (month) => month.categories.find((c) => c.id === cat.id)?.spent ?? 0,
            ),
          )
        : null;
      const consecutiveOver = lastThreeClosed.filter((month) =>
        month.categories.some((c) => c.id === cat.id && c.difference > 0),
      ).length;
      const changePrevious = previous === null ? null : round(cat.spent - previous);
      const changeAverage = avg === null ? null : round(cat.spent - avg);
      const insight =
        changeAverage !== null
          ? `${cat.name} registrou ${money(cat.spent)}; ${changeAverage > 0 ? money(changeAverage) + " acima" : money(Math.abs(changeAverage)) + " abaixo"} da média de ${money(avg ?? 0)} dos três meses anteriores.${cat.difference > 0 ? ` Estouro de ${money(cat.difference)} neste fechamento.` : ""}${consecutiveOver >= 2 ? ` Também excedeu o limite em ${consecutiveOver} dos três meses anteriores.` : ""}`
          : `${cat.name}: faltam orçamentos de meses anteriores para comparar a média com consistência.`;
      return {
        id: cat.id,
        name: cat.name,
        current: cat.spent,
        previous,
        averageThree: avg === null ? null : round(avg),
        changePrevious,
        changeAverage,
        consecutiveOver,
        insight,
      };
    })
    .sort(
      (a, b) =>
        Math.abs(b.changeAverage ?? b.changePrevious ?? 0) -
        Math.abs(a.changeAverage ?? a.changePrevious ?? 0),
    );
  const additional = round(roots.reduce((total, root) => total + root.additional, 0));
  const projected = round(current.registered + additional);
  const overBudget = round(Math.max(0, projected - current.budget));
  const monthlyHistorical = rhythms.reduce((total, r) => total + r.historicalMonthlyAverage, 0);
  const unmodeledAverage = round(
    rhythms
      .filter((r) => r.kind !== "recorrente")
      .reduce((total, r) => total + r.historicalMonthlyAverage, 0),
  );
  const coverRatio = monthlyHistorical ? 1 - unmodeledAverage / monthlyHistorical : 0;
  const estimates = rhythms.filter((r) => r.kind === "recorrente");
  const confidence: ProjectionConfidence = !estimates.length
    ? "insuficiente"
    : coverRatio >= 0.75 && estimates.every((r) => r.confidence !== "baixa")
      ? "alta"
      : coverRatio >= 0.5
        ? "media"
        : "baixa";
  const disclaimer = `${(coverRatio * 100).toFixed(0)}% do gasto médio histórico possui rotina identificada. ${money(unmodeledAverage)}/mês em categorias sem padrão não foram extrapolados. Compras no cartão seguem o vencimento da fatura; contas diretas mensais seguem seu vencimento/pagamento histórico. Compras no cartão exigem fatura aberta identificada; contas diretas mensais não. Estimativa parcial, não é previsão garantida.`;

  const leading =
    roots.find((r) => r.budget > 0 && r.excess > 0 && r.additional > 0) ??
    roots.find((r) => r.budget > 0 && r.excess > 0) ??
    roots.find((r) => r.excess > 0 && r.additional > 0) ??
    roots.find((r) => r.excess > 0);
  const rhythmic = leading?.rhythms
    .filter((r) => r.projectedAdditional > 0)
    .sort((a, b) => b.projectedAdditional - a.projectedAdditional)[0];
  const accelerating = rhythms
    .filter(
      (r) =>
        r.expectedOccurrences > 0 &&
        r.currentTicket !== null &&
        r.historicalTicket > 0 &&
        r.currentTicket > r.historicalTicket * 1.2,
    )
    .sort(
      (a, b) =>
        (b.currentTicket! - b.historicalTicket) * b.expectedOccurrences -
        (a.currentTicket! - a.historicalTicket) * a.expectedOccurrences,
    )[0];
  const acceleratingRoot = accelerating && roots.find((r) => r.id === accelerating.rootId);
  const recommended = leading
    ? {
        title: `${leading.name}: risco de ${money(leading.excess)} acima do limite`,
        explanation: `${money(leading.registered)} já registrados, mais ${money(leading.additional)} projetados por rotina; limite de ${money(leading.budget)}. ${rhythmic ? `${rhythmic.name}: ${rhythmic.expectedOccurrences} ocorrência(s) adicional(is) a cada ~${rhythmic.intervalDays} dias.` : "O limite já foi ultrapassado pelos registros existentes."}`,
        action:
          rhythmic && leading.budget >= leading.registered
            ? `Para não ultrapassar ${money(leading.budget)}, limite as novas despesas de ${leading.name} a ${money(Math.max(0, leading.budget - leading.registered))} no restante do mês. A rotina de ${rhythmic.name} sugere ${money(rhythmic.projectedAdditional)} adicionais; reduzir ou adiar ${money(leading.excess)} desse valor evita o estouro projetado.`
            : `Não é possível desfazer os ${money(leading.registered)} já registrados. Evite ampliar o excesso de ${leading.name} e ajuste a rotina do próximo mês em pelo menos ${money(leading.excess)}.`,
        effect: `Se conseguir evitar ${money(leading.excess)} de novos gastos estimados, a projeção desta categoria volta a ${money(leading.projected - leading.excess)}.`,
        categoryId: leading.id,
      }
    : accelerating && acceleratingRoot
      ? {
          title: `${accelerating.name}: compras ${(100 * (accelerating.currentTicket! / accelerating.historicalTicket - 1)).toFixed(0)}% acima do tíquete histórico`,
          explanation: `${accelerating.observedEvents} compra(s) neste mês com média de ${money(accelerating.currentTicket!)}; histórico de ${money(accelerating.historicalTicket)} por ocorrência, a cada ~${accelerating.intervalDays} dias. Mais ${accelerating.expectedOccurrences} ocorrência(s) esperada(s).`,
          action: `Manter as próximas ${accelerating.expectedOccurrences} compras de ${accelerating.name} próximas de ${money(accelerating.historicalTicket)} em vez de ${money(accelerating.estimatedTicket ?? accelerating.currentTicket!)} reduz a previsão em ${money(Math.max(0, accelerating.expectedOccurrences * ((accelerating.estimatedTicket ?? 0) - accelerating.historicalTicket)))}. O grupo ${acceleratingRoot.name} tem limite de ${money(acceleratingRoot.budget)}.`,
          effect: `Projeção do grupo ${acceleratingRoot.name} de ${money(acceleratingRoot.projected)}, antes da redução sugerida; valores pontuais continuam não estimados.`,
          categoryId: acceleratingRoot.id,
        }
      : {
          title:
            overBudget > 0
              ? `Risco de ${money(overBudget)} acima do orçamento`
              : "Sem estouro projetado nas rotinas detectadas",
          explanation: `${money(current.registered)} registrados e ${money(additional)} estimados de compras periódicas. ${disclaimer}`,
          action: `Para não superar o limite global de ${money(current.budget)}, não registre mais de ${money(Math.max(0, current.budget - current.registered))} em novas despesas variáveis.`,
          effect: `Gastos pontuais permanecem fora da projeção: média histórica de ${money(unmodeledAverage)} ao mês.`,
          categoryId: null,
        };
  return {
    roots,
    rhythms: categoryRhythms,
    comparisons,
    registered: current.registered,
    additional,
    projected,
    overBudget,
    unmodeledAverage,
    confidence,
    disclaimer,
    recommended,
  };
}

/** Mês fechado contra meses anteriores, com diferenças por categoria e evidências numéricas. */
export function budgetTrendInsights(report: BudgetDIKW): string[] {
  const base = report.closed;
  const results: string[] = [];
  for (const item of [report.previous, report.averageThree]) {
    if (
      !item.available ||
      item.spent === null ||
      item.spentChange === null ||
      item.deviationChange === null
    ) {
      results.push(`${item.label}: ${item.missing ?? "sem orçamento comparável"}.`);
      continue;
    }
    const direction =
      item.spentChange > 0
        ? "aumentaram"
        : item.spentChange < 0
          ? "diminuíram"
          : "permaneceram estáveis";
    results.push(
      `${item.label}: gastos ${direction} ${money(Math.abs(item.spentChange))}; desvio ${item.deviationChange > 0 ? "piorou" : item.deviationChange < 0 ? "melhorou" : "ficou igual"} ${Math.abs(item.deviationChange).toFixed(1)} p.p. versus o referencial. ${item.newlyOver.length ? `Novos estouros: ${item.newlyOver.join(", ")}.` : "Sem novos estouros identificados."}`,
    );
  }
  if (report.previous.available) {
    if (report.previous.worsened.length)
      results.push(
        `Categorias com piora de saldo frente ao mês anterior: ${report.previous.worsened.slice(0, 4).join(", ")}.`,
      );
    if (report.previous.improved.length)
      results.push(
        `Categorias que melhoraram o saldo frente ao mês anterior: ${report.previous.improved.slice(0, 4).join(", ")}.`,
      );
  }
  return results;
}

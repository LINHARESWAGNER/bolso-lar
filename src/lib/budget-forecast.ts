import type { HealthData } from "./financial-health";
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
  const leafIds = new Set(all.map((line) => line.categoryId ?? "__uncategorized__"));
  const rhythms: CategoryRhythm[] = [];
  const todayDay = dayNumber(today);
  const endDay = dayNumber(current.period.end);
  const daysRemaining = Math.max(0, endDay - todayDay);

  for (const id of leafIds) {
    const leaf = (line: BudgetLine) => (line.categoryId ?? "__uncategorized__") === id;
    const pastLines = history.flatMap((h) => h.lines.filter(leaf));
    const present = current.lines.filter(leaf);
    const rootId = present[0]?.rootId ?? pastLines[0]?.rootId ?? "__uncategorized__";
    const preference = preferences[id] ?? "auto";
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
    const routine = preference !== "pontual" && (isStable || isMonthly || weakCadence);
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
    if (routine && intervalDays && estimatedTicket && daysRemaining > 0) {
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
    const description =
      preference === "pontual"
        ? "Marcado como pontual nesta sessão: nenhuma recorrência extrapolada."
        : routine
          ? `Histórico de ${visits.length} ocorrências em ${seenMonths} meses; intervalo típico de ${intervalDays} dias (dispersão ${(dispersion * 100).toFixed(0)}%). Valor médio anterior ${money(historicalTicket)}${currentTicket === null ? "" : `; valor observado neste mês ${money(currentTicket)}`}. ${expectedOccurrences} próxima(s) ocorrência(s) estimada(s); ${money(alreadyScheduled)} já previsto(s) não é duplicado.`
          : `Sem cadência consistente: ${visits.length} ocorrência(s) em ${seenMonths} mês(es). Gastos pontuais não foram extrapolados.`;
    rhythms.push({
      id,
      name: categoryNames.get(id) ?? "Sem categoria",
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
      description,
    });
  }

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
        rhythms: group,
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
  const disclaimer = `${(coverRatio * 100).toFixed(0)}% do gasto médio histórico possui rotina identificada. ${money(unmodeledAverage)}/mês em categorias sem padrão não foram extrapolados. Projeção parcial, não é previsão garantida de fechamento.`;

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
    rhythms,
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

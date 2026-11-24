/** Alertas de cobertura do orçamento essencial variável. Não altera valores do gráfico. */
import { isThirdPartyTransaction } from "./derive";
import type { HealthData } from "./financial-health";
import type { EssentialPlanProjection } from "./essential-planning-projection";

type Category = HealthData["categories"][number];
export type PlanningAlert = {
  categoryId: string;
  category: string;
  kind: "sem_orcamento" | "abaixo_do_habitual" | "sem_classificacao";
  baseline: number;
  planned: number;
  description: string;
};
export type PlanningQuality = {
  month: string;
  alerts: PlanningAlert[];
  coveragePct: number | null;
  baseline: number;
  planned: number;
};

const cents = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const addMonth = (key: string, offset: number) => {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const d = new Date(year, month - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const rootId = (categoryId: string, byId: Map<string, Category>) => {
  let current = byId.get(categoryId);
  const seen = new Set<string>();
  while (current?.parent_id && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parent_id);
    if (!parent) break;
    current = parent;
  }
  return current?.id ?? categoryId;
};

/** Compara o planejamento da competência com os últimos 3 meses FECHADOS. */
export function auditEssentialPlanning(
  data: HealthData,
  currentMonth: string,
  targetMonth: string,
  projection: EssentialPlanProjection | null,
): PlanningQuality {
  const key = targetMonth.slice(0, 7);
  const history = [-3, -2, -1].map((offset) => addMonth(currentMonth.slice(0, 7), offset));
  const byId = new Map(data.categories.map((category) => [category.id, category]));
  const essentialRoots = new Set(
    data.essentials
      .filter(
        (rule) =>
          rule.is_essential && byId.has(rule.category_id) && !byId.get(rule.category_id)?.parent_id,
      )
      .map((rule) => rule.category_id),
  );
  const monthsByRoot = new Map<string, Map<string, number>>();
  for (const tx of data.transactions) {
    if (
      tx.type !== "despesa" ||
      tx.expense_nature !== "variavel" ||
      tx.status === "cancelado" ||
      !tx.category_id ||
      !history.includes(tx.competence_date.slice(0, 7)) ||
      isThirdPartyTransaction(data.categories, tx)
    )
      continue;
    const root = rootId(tx.category_id, byId);
    if (!essentialRoots.has(root)) continue;
    const records = monthsByRoot.get(root) ?? new Map<string, number>();
    const month = tx.competence_date.slice(0, 7);
    records.set(month, (records.get(month) ?? 0) + (Number(tx.amount) || 0));
    monthsByRoot.set(root, records);
  }
  const budgetRows = new Map((projection?.rows ?? []).map((row) => [row.categoryId, row.planned]));
  const alerts: PlanningAlert[] = [];
  let baselineTotal = 0;
  let plannedTotal = 0;
  for (const root of essentialRoots) {
    const records = monthsByRoot.get(root);
    if (!records) continue;
    const values = history.map((month) => cents(records.get(month) ?? 0));
    if (values.filter((value) => value > 0).length < 2) continue;
    const baseline = cents(median(values));
    if (baseline < 200) continue;
    const planned = cents(budgetRows.get(root) ?? 0);
    baselineTotal += baseline;
    plannedTotal += planned;
    const category = byId.get(root)?.name ?? "Categoria sem nome";
    if (!projection?.hasBudget || !budgetRows.has(root)) {
      alerts.push({
        categoryId: root,
        category,
        kind: "sem_orcamento",
        baseline,
        planned: 0,
        description: "Sem orçamento nesta categoria raiz",
      });
    } else if (planned < baseline * 0.5) {
      alerts.push({
        categoryId: root,
        category,
        kind: "abaixo_do_habitual",
        baseline,
        planned,
        description: "Orçamento inferior a 50% da mediana dos últimos 3 meses fechados",
      });
    }
  }
  for (const issue of projection?.issues ?? []) {
    if (issue.reason !== "classificacao_pendente") continue;
    alerts.push({
      categoryId: issue.categoryId,
      category: issue.category,
      kind: "sem_classificacao",
      baseline: 0,
      planned: issue.amount,
      description: "Categoria raiz sem classificação essencial definida",
    });
  }
  return {
    month: key,
    alerts,
    baseline: cents(baselineTotal),
    planned: cents(plannedTotal),
    coveragePct: baselineTotal > 0 ? cents((plannedTotal / baselineTotal) * 100) : null,
  };
}

/**
 * Complemento orçamentário para o comprometimento com essenciais nos meses
 * abertos/futuros. Nunca altera a apuração dos meses fechados.
 *
 * A natureza essencial do orçamento é determinada exclusivamente pela regra
 * cadastrada na categoria RAIZ. Divergências nas filhas não bloqueiam o orçamento.
 * Raízes sem classificação explícita permanecem pendentes e não são estimadas.
 */
import { isThirdPartyTransaction } from "./derive";
import { resolveEssential, type HealthData } from "./financial-health";

type Category = HealthData["categories"][number];
type MonthBudget = HealthData["budgets"][number];

export type EssentialPlanIssue = {
  categoryId: string;
  category: string;
  reason: "classificacao_mista" | "classificacao_pendente" | "sem_planejamento";
  amount: number;
};
export type EssentialPlanRow = {
  categoryId: string;
  category: string;
  planned: number;
  registered: number;
  complement: number;
};
export type EssentialPlanSourceRow = {
  budgetId: string;
  categoryId: string;
  category: string;
  rootId: string;
  rootCategory: string;
  amount: number;
  status: "essencial" | "nao_essencial" | "mista" | "pendente";
};
export type EssentialPlanProjection = {
  month: string;
  hasBudget: boolean;
  budgetCount: number;
  budgetItemCount: number;
  availableBudgetMonths: string[];
  sources: EssentialPlanSourceRow[];
  plannedEssential: number;
  registeredVariableEssential: number;
  complement: number;
  rows: EssentialPlanRow[];
  issues: EssentialPlanIssue[];
};

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const amount = (value: number | string | null | undefined) => Number(value ?? 0) || 0;

function investmentCategory(categoryId: string | null, byId: Map<string, Category>) {
  let category = categoryId ? byId.get(categoryId) : undefined;
  const seen = new Set<string>();
  while (category && !seen.has(category.id)) {
    seen.add(category.id);
    if (/^(investimentos?|aportes?)(\b|\s|$)/i.test(category.name)) return true;
    category = category.parent_id ? byId.get(category.parent_id) : undefined;
  }
  return false;
}

/** A mesma raiz agrega orçamento e lançamentos de suas categorias filhas. */
function rootId(categoryId: string, byId: Map<string, Category>) {
  let category = byId.get(categoryId);
  const seen = new Set<string>();
  while (category?.parent_id && !seen.has(category.id)) {
    seen.add(category.id);
    category = byId.get(category.parent_id) ?? category;
    if (!byId.has(category.parent_id ?? "")) break;
  }
  return category?.id ?? categoryId;
}

/**
 * Planejamento variável é cadastrado por raiz. A classificação da raiz prevalece
 * para o orçamento, mesmo quando há filhas com marcações diferentes.
 * Não utilizar resolveEssential(filha) para decidir o valor planejado.
 */
function plannedRootStatus(
  rootCategoryId: string,
  rules: HealthData["essentials"],
): boolean | null {
  const explicit = rules.find((rule) => rule.category_id === rootCategoryId);
  return explicit ? explicit.is_essential : null;
}

export function projectEssentialVariableBudget(
  data: HealthData,
  month: string,
): EssentialPlanProjection {
  const key = month.slice(0, 7);
  const byId = new Map(data.categories.map((category) => [category.id, category]));
  const budgets: MonthBudget[] = data.budgets.filter((budget) =>
    budget.reference_month.startsWith(key),
  );
  const planned = new Map<string, number>();
  const sources: EssentialPlanSourceRow[] = [];
  const registered = new Map<string, number>();
  const unknown = new Map<string, { reason: EssentialPlanIssue["reason"]; amount: number }>();

  for (const budget of budgets) {
    for (const item of budget.budget_items) {
      if (!item.category_id || investmentCategory(item.category_id, byId)) continue;
      const root = rootId(item.category_id, byId);
      const value = Math.max(0, amount(item.amount));
      const status = plannedRootStatus(root, data.essentials);
      sources.push({
        budgetId: budget.id,
        categoryId: item.category_id,
        category: byId.get(item.category_id)?.name ?? "Categoria não identificada",
        rootId: root,
        rootCategory: byId.get(root)?.name ?? "Categoria raiz não identificada",
        amount: cents(value),
        status: status === true ? "essencial" : status === false ? "nao_essencial" : "pendente",
      });
      if (status === true) {
        planned.set(root, (planned.get(root) ?? 0) + value);
      } else if (status === null) {
        const previous = unknown.get(root);
        unknown.set(root, {
          reason: "classificacao_pendente",
          amount: (previous?.amount ?? 0) + value,
        });
      }
    }
  }

  for (const transaction of data.transactions) {
    if (
      !transaction.competence_date.startsWith(key) ||
      transaction.type !== "despesa" ||
      transaction.expense_nature !== "variavel" ||
      transaction.status === "cancelado" ||
      !transaction.category_id ||
      isThirdPartyTransaction(data.categories, transaction) ||
      investmentCategory(transaction.category_id, byId) ||
      resolveEssential(transaction.category_id, data.categories, data.essentials) !== true
    )
      continue;
    const root = rootId(transaction.category_id, byId);
    registered.set(root, (registered.get(root) ?? 0) + amount(transaction.amount));
  }

  const roots = [...new Set([...planned.keys(), ...registered.keys()])];
  const rows = roots
    .map((id) => {
      const plan = cents(planned.get(id) ?? 0);
      const recorded = cents(registered.get(id) ?? 0);
      return {
        categoryId: id,
        category: byId.get(id)?.name ?? "Categoria não identificada",
        planned: plan,
        registered: recorded,
        complement: cents(Math.max(0, plan - recorded)),
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category, "pt-BR"));
  const issues: EssentialPlanIssue[] = [...unknown.entries()].map(([id, item]) => ({
    categoryId: id,
    category: byId.get(id)?.name ?? "Categoria não identificada",
    reason: item.reason,
    amount: cents(item.amount),
  }));
  // Sem orçamento para uma raiz com gasto registrado não implica gasto futuro igual a zero.
  for (const row of rows) {
    if (!planned.has(row.categoryId) && row.registered > 0) {
      issues.push({
        categoryId: row.categoryId,
        category: row.category,
        reason: "sem_planejamento",
        amount: row.registered,
      });
    }
  }
  return {
    month: key,
    hasBudget: budgets.length > 0,
    budgetCount: budgets.length,
    budgetItemCount: sources.length,
    availableBudgetMonths: [
      ...new Set(data.budgets.map((item) => item.reference_month.slice(0, 7))),
    ].sort(),
    sources,
    plannedEssential: cents(rows.reduce((sum, row) => sum + row.planned, 0)),
    registeredVariableEssential: cents(rows.reduce((sum, row) => sum + row.registered, 0)),
    complement: cents(rows.reduce((sum, row) => sum + row.complement, 0)),
    rows,
    issues,
  };
}

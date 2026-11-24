/**
 * Projeção de alterações em compromissos essenciais.
 * Fontes: parcela final estruturada e limites explícitos de recorrências.
 * Nenhum vínculo é inferido por descrição ou por semelhança de valor.
 */
import type { Tables } from "./finance";

type Recurrence = Tables["recurring_transactions"]["Row"];
type Transaction = Tables["transactions"]["Row"];
type Category = Tables["categories"]["Row"];
type EssentialRule = Tables["financial_health_essential_categories"]["Row"];
type InstallmentGroup = Tables["installment_groups"]["Row"];

export type CashEvent = {
  id: string;
  description: string;
  category: string;
  effectiveMonth: string;
  /** Positivo = elevação de despesa, negativo = redução. */
  delta: number;
  origin: "ultima_parcela" | "recorrencia";
  detail: string;
};
export type CashMilestone = {
  month: string;
  start: string;
  events: CashEvent[];
  /** Variação desde a faixa anterior; positivo = aumento de despesa. */
  delta: number;
  /** Variação total em relação ao mês atual. */
  accumulatedDelta: number;
};

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const monthIndex = (month: string) =>
  Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const monthAt = (month: string, offset: number) => {
  const n = monthIndex(month) + offset;
  const y = Math.floor(n / 12);
  return `${y}-${String(n - y * 12 + 1).padStart(2, "0")}`;
};
const plusMonth = (month: string) => monthAt(month, 1);

function categoryIsEssential(
  categoryId: string | null,
  byCategory: Map<string, Category>,
  flags: Map<string, boolean>,
) {
  let id = categoryId;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    if (flags.has(id)) return flags.get(id) === true;
    id = byCategory.get(id)?.parent_id ?? null;
  }
  return false;
}
function excludedCategory(id: string | null, byCategory: Map<string, Category>) {
  let current = id;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const cat = byCategory.get(current);
    if (!cat) break;
    const name = cat.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (name.includes("terceir") || /^(investimentos?|aportes?)(\b|\s|$)/i.test(name)) return true;
    current = cat.parent_id;
  }
  return false;
}
const displayCategory = (categoryId: string | null, byCategory: Map<string, Category>) =>
  (categoryId && byCategory.get(categoryId)?.name) || "Sem categoria";

/** Última competência gerada pelo padrão mensal, respeitando end_date e occurrences. */
function lastMonthlyMonth(row: Recurrence): string | null {
  const first = row.start_date.slice(0, 7);
  // Sem limite explícito, não se afirma encerramento.
  if (!row.end_date && !(row.occurrences && row.occurrences > 0)) return null;
  let last = row.end_date?.slice(0, 7) ?? null;
  if (row.end_date && row.end_date < row.start_date) return null;
  if (row.end_date && row.end_date.slice(8, 10) < row.start_date.slice(8, 10)) {
    // Para fevereiro e meses curtos, a geração usa dia ajustado ao fim do mês.
    const y = Number(row.end_date.slice(0, 4));
    const m = Number(row.end_date.slice(5, 7));
    const finalDay = new Date(y, m, 0).getDate();
    if (
      Number(row.end_date.slice(8, 10)) < Math.min(Number(row.start_date.slice(8, 10)), finalDay)
    ) {
      last = monthAt(last!, -1);
    }
  }
  if (row.occurrences && row.occurrences > 0) {
    const occurrenceEnd = monthAt(first, row.occurrences - 1);
    last = last === null || occurrenceEnd < last ? occurrenceEnd : last;
  }
  return last && last >= first ? last : null;
}

export function buildEssentialCashTimeline(args: {
  today: string;
  categories: Category[];
  essentials: EssentialRule[];
  recurrences: Recurrence[];
  transactions: Transaction[];
  groups: InstallmentGroup[];
}): CashMilestone[] {
  const current = args.today.slice(0, 7);
  const final = monthAt(current, 10);
  const byCategory = new Map(args.categories.map((c) => [c.id, c]));
  const flags = new Map(args.essentials.map((e) => [e.category_id, e.is_essential]));
  const eligible = (categoryId: string | null) =>
    categoryIsEssential(categoryId, byCategory, flags) && !excludedCategory(categoryId, byCategory);
  const events: CashEvent[] = [];

  // Recorrência: considera início/fim declarados; continuidade somente pelo ID explícito.
  const recurrenceById = new Map(args.recurrences.map((r) => [r.id, r]));
  for (const r of args.recurrences) {
    if (
      !r.is_active ||
      r.type !== "despesa" ||
      r.frequency !== "mensal" ||
      !eligible(r.category_id)
    )
      continue;
    const amount = Math.abs(Number(r.amount));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const first = r.start_date.slice(0, 7);
    const last = lastMonthlyMonth(r);
    const startInWindow = first > current && first <= final;
    const endEffective = last ? plusMonth(last) : null;
    const endInWindow = endEffective && endEffective > current && endEffective <= final;
    const predecessor = r.predecessor_recurrence_id
      ? recurrenceById.get(r.predecessor_recurrence_id)
      : null;
    const predecessorInfo = predecessor
      ? `Continuação vinculada: ${predecessor.description}`
      : "Início programado sem continuidade vinculada";
    if (startInWindow)
      events.push({
        id: `rec-start:${r.id}`,
        description: r.description,
        category: displayCategory(r.category_id, byCategory),
        effectiveMonth: first,
        delta: cents(amount),
        origin: "recorrencia",
        detail: predecessorInfo,
      });
    if (endInWindow)
      events.push({
        id: `rec-end:${r.id}`,
        description: r.description,
        category: displayCategory(r.category_id, byCategory),
        effectiveMonth: endEffective!,
        delta: -cents(amount),
        origin: "recorrencia",
        detail: `Fim programado: ${last} · ${args.recurrences.some((s) => s.predecessor_recurrence_id === r.id) ? "há continuação explícita" : "sem continuação vinculada"}`,
      });
  }

  // Parcelas: usa campos estruturados N/Total; não extrai números de descrições.
  const groupById = new Map(args.groups.map((g) => [g.id, g]));
  const finalParcels = new Map<string, Transaction>();
  for (const t of args.transactions) {
    if (
      t.type !== "despesa" ||
      t.status === "cancelado" ||
      t.recurring_id ||
      !t.installment_group_id ||
      !eligible(t.category_id)
    )
      continue;
    const group = groupById.get(t.installment_group_id);
    if (group?.deleted_at) continue;
    const total = group?.installments ?? t.installment_total;
    if (
      !total ||
      total < 2 ||
      t.installment_number !== total ||
      (t.installment_total != null && t.installment_total !== total)
    )
      continue;
    const previous = finalParcels.get(t.installment_group_id);
    if (!previous || t.competence_date > previous.competence_date)
      finalParcels.set(t.installment_group_id, t);
  }
  for (const [groupId, last] of finalParcels) {
    const effectiveMonth = plusMonth(last.competence_date.slice(0, 7));
    if (effectiveMonth <= current || effectiveMonth > final) continue;
    const amount = Math.abs(Number(last.amount));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    events.push({
      id: `installment-end:${groupId}`,
      description: groupById.get(groupId)?.description ?? last.description,
      category: displayCategory(last.category_id, byCategory),
      effectiveMonth,
      delta: -cents(amount),
      origin: "ultima_parcela",
      detail: `Última parcela cadastrada ${last.installment_number}/${last.installment_total ?? groupById.get(groupId)?.installments} em ${last.competence_date.slice(0, 7)}`,
    });
  }

  events.sort(
    (a, b) =>
      a.effectiveMonth.localeCompare(b.effectiveMonth) ||
      a.description.localeCompare(b.description),
  );
  return [1, 4, 7, 10].map((offset, index) => {
    const month = monthAt(current, offset);
    const start = monthAt(current, index === 0 ? 1 : offset - 2);
    const within = events.filter(
      (event) => event.effectiveMonth >= start && event.effectiveMonth <= month,
    );
    const all = events.filter((event) => event.effectiveMonth <= month);
    return {
      month,
      start,
      events: within,
      delta: cents(within.reduce((s, e) => s + e.delta, 0)),
      accumulatedDelta: cents(all.reduce((s, e) => s + e.delta, 0)),
    };
  });
}

import {
  accountBalance,
  monthRange,
  type Account,
  type Category,
  type Transaction,
} from "./finance";

export type OutflowKind = "recorrente" | "parcelado" | "pontual";

/** Classifica uma saída prevista para o fluxo de caixa. */
export function outflowKind(t: Transaction): OutflowKind {
  if (t.installment_group_id) return "parcelado";
  if (t.recurring_id) return "recorrente";
  return "pontual";
}

export const inMonth = (iso: string | null, year: number, month: number) => {
  if (!iso) return false;
  const { start, end } = monthRange(year, month);
  return iso >= start && iso <= end;
};

export const notCancelled = (t: Transaction) => t.status !== "cancelado";

export function cashBalance(accounts: Account[], txs: Transaction[]) {
  return accounts
    .filter((a) => a.is_active && a.include_in_cash)
    .reduce((sum, a) => sum + accountBalance(a, txs), 0);
}

export function monthTotals(
  txs: Transaction[],
  year: number,
  month: number,
) {
  const scoped = txs.filter(
    (t) => notCancelled(t) && inMonth(t.competence_date, year, month),
  );
  const receitas = scoped
    .filter((t) => t.type === "receita")
    .reduce((s, t) => s + Number(t.amount), 0);
  const despesas = scoped
    .filter((t) => t.type === "despesa")
    .reduce((s, t) => s + Number(t.amount), 0);

  const aPagar = txs
    .filter(
      (t) =>
        t.type === "despesa" &&
        notCancelled(t) &&
        t.status !== "pago" &&
        inMonth(t.due_date ?? t.competence_date, year, month),
    )
    .reduce((s, t) => s + Number(t.amount), 0);

  const aReceber = txs
    .filter(
      (t) =>
        t.type === "receita" &&
        notCancelled(t) &&
        t.status !== "pago" &&
        inMonth(t.due_date ?? t.competence_date, year, month),
    )
    .reduce((s, t) => s + Number(t.amount), 0);

  return { receitas, despesas, resultado: receitas - despesas, aPagar, aReceber };
}

/** Rótulo "Categoria › Subcategoria". */
export function categoryPath(categories: Category[], id: string | null) {
  if (!id) return "Sem categoria";
  const cat = categories.find((c) => c.id === id);
  if (!cat) return "Sem categoria";
  const parent = cat.parent_id
    ? categories.find((c) => c.id === cat.parent_id)
    : null;
  return parent ? `${parent.name} › ${cat.name}` : cat.name;
}

/** Agrupa despesas por categoria raiz. */
export function expensesByRootCategory(
  txs: Transaction[],
  categories: Category[],
) {
  const map = new Map<string, { name: string; value: number }>();
  for (const t of txs) {
    if (t.type !== "despesa" || !notCancelled(t)) continue;
    const cat = categories.find((c) => c.id === t.category_id);
    const root = cat?.parent_id
      ? categories.find((c) => c.id === cat.parent_id)
      : cat;
    const key = root?.id ?? "sem";
    const name = root?.name ?? "Sem categoria";
    const current = map.get(key) ?? { name, value: 0 };
    current.value += Number(t.amount);
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

/** Soma das despesas (competência) de uma categoria e suas subcategorias. */
export function realizedForCategory(
  txs: Transaction[],
  categories: Category[],
  categoryId: string,
  year: number,
  month: number,
) {
  const ids = new Set<string>([categoryId]);
  for (const c of categories) if (c.parent_id === categoryId) ids.add(c.id);
  const scoped = txs.filter(
    (t) =>
      t.type === "despesa" &&
      notCancelled(t) &&
      t.category_id &&
      ids.has(t.category_id) &&
      inMonth(t.competence_date, year, month),
  );
  return {
    realizado: scoped
      .filter((t) => t.status === "pago")
      .reduce((s, t) => s + Number(t.amount), 0),
    comprometido: scoped
      .filter((t) => t.status !== "pago")
      .reduce((s, t) => s + Number(t.amount), 0),
  };
}
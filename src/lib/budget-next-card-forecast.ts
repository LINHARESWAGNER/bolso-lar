import type { HealthData } from "./financial-health";
import type { BudgetSnapshot } from "./budget-dikw";
import { cashExpenseDate } from "./budget-cash";
import { isThirdPartyTransaction } from "./derive";

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const toDay = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / 86400000;
const monthShift = (month: string, delta: number) => {
  const date = new Date(`${month.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
};

type Cycle = {
  cardId: string;
  cardName: string;
  closing: string;
  due: string;
  daysRemaining: number;
  estimated: number;
};
export type NextCardProjection = {
  known: number;
  additional: number;
  projected: number;
  byRoot: Map<string, number>;
  cycles: Cycle[];
  noCycleCards: number;
  note: string;
};

/**
 * Projeta apenas compras NOVAS em cartões com fatura REAL identificada,
 * com vencimento no mês seguinte e fechamento ainda futuro.
 * O histórico de três meses anteriores ao mês atual é atribuído pelo
 * vencimento da fatura. Parcelas e compras de terceiros não geram rotina.
 * Registros já existentes permanecem exclusivamente no valor comprometido.
 */
export function projectNextCardCashMonth(
  data: HealthData,
  next: BudgetSnapshot,
  today: string,
): NextCardProjection {
  const targetMonth = next.period.start.slice(0, 7);
  const currentMonth = today.slice(0, 7);
  const previousMonths = new Set([-1, -2, -3].map(offset => monthShift(currentMonth, offset)));
  const invoiceById = new Map(data.invoices.map(invoice => [invoice.id, invoice]));
  const categoriesById = new Map(data.categories.map(category => [category.id, category]));
  const rootOf = (id: string | null): string => {
    let category = id ? categoriesById.get(id) : undefined;
    const visited = new Set<string>();
    while (category?.parent_id && !visited.has(category.id)) {
      visited.add(category.id);
      category = categoriesById.get(category.parent_id) ?? category;
    }
    return category?.id ?? "__uncategorized__";
  };
  const eligible = data.transactions.filter(tx =>
    tx.type === "despesa" && tx.expense_nature === "variavel" &&
    tx.status !== "cancelado" && Boolean(tx.credit_card_id) && Boolean(tx.invoice_id) &&
    !tx.installment_group_id && Number(tx.installment_total ?? 0) <= 1 &&
    !isThirdPartyTransaction(data.categories, tx)
  );
  const byCardRoot = new Map<string, number>();
  for (const tx of eligible) {
    const cashDate = cashExpenseDate(tx, invoiceById);
    if (!cashDate || !previousMonths.has(cashDate.slice(0, 7))) continue;
    const key = `${tx.credit_card_id}:${rootOf(tx.category_id)}`;
    byCardRoot.set(key, (byCardRoot.get(key) ?? 0) + Number(tx.amount));
  }
  const roots = new Map<string, number>();
  const cycles: Cycle[] = [];
  let withoutCycle = 0;
  for (const card of data.cards.filter(card => card.is_active)) {
    const currentInvoice = data.invoices
      .filter(invoice => invoice.credit_card_id === card.id &&
        invoice.due_date.slice(0, 7) === targetMonth &&
        invoice.closing_date.slice(0, 10) > today &&
        invoice.status !== "paga")
      .sort((a, b) => a.closing_date.localeCompare(b.closing_date))[0];
    if (!currentInvoice) {
      if (!data.invoices.some(invoice => invoice.credit_card_id === card.id && invoice.due_date.slice(0, 7) === targetMonth)) withoutCycle++;
      continue;
    }
    const remainingDays = Math.max(0, toDay(currentInvoice.closing_date) - toDay(today));
    // A média mensal por cartão é distribuída por uma janela de 30 dias.
    // Consideramos somente os dias que ainda podem gerar novas compras.
    const fraction = Math.min(1, remainingDays / 30);
    let estimated = 0;
    for (const [key, history] of byCardRoot) {
      const prefix = `${card.id}:`;
      if (!key.startsWith(prefix)) continue;
      const root = key.slice(prefix.length);
      const expected = round((history / 3) * fraction);
      // Compra futura cadastrada no mesmo ciclo já faz parte de 'known'.
      const scheduled = eligible
        .filter(tx => tx.credit_card_id === card.id && rootOf(tx.category_id) === root &&
          tx.invoice_id === currentInvoice.id && tx.competence_date > today &&
          tx.competence_date.slice(0, 10) <= currentInvoice.closing_date.slice(0, 10))
        .reduce((sum, tx) => sum + Number(tx.amount), 0);
      const additional = round(Math.max(0, expected - scheduled));
      if (additional <= 0) continue;
      estimated += additional;
      roots.set(root, round((roots.get(root) ?? 0) + additional));
    }
    cycles.push({
      cardId: card.id,
      cardName: card.name,
      closing: currentInvoice.closing_date.slice(0, 10),
      due: currentInvoice.due_date.slice(0, 10),
      daysRemaining: remainingDays,
      estimated: round(estimated),
    });
  }
  const additional = round([...roots.values()].reduce((a, b) => a + b, 0));
  return {
    known: next.registered,
    additional,
    projected: round(next.registered + additional),
    byRoot: roots,
    cycles,
    noCycleCards: withoutCycle,
    note: cycles.length
      ? `Estimativa parcial das compras que ainda podem entrar nas faturas de ${targetMonth.slice(5)}/${targetMonth.slice(0, 4)}. Base: média das compras não parceladas dos três meses anteriores ao atual, por cartão e categoria, proporcional aos dias restantes até o fechamento real. Não inclui compras pontuais sem padrão nem cartões sem fatura identificada.`
      : "Sem fatura aberta com vencimento no próximo mês e fechamento futuro identificados. Não é possível estimar compras adicionais por ciclo de cartão com segurança.",
  };
}

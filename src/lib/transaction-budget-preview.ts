import { budgetSnapshot } from "./budget-dikw";
import { resolveInvoicePeriod, type Tables } from "./finance";
import type { HealthData, HealthPeriod } from "./financial-health";

type Category = Tables["categories"]["Row"];
type Card = Tables["credit_cards"]["Row"];
type Invoice = Tables["credit_card_invoices"]["Row"];
type Transaction = Tables["transactions"]["Row"];
type Budget = HealthData["budgets"][number];

type PreviewInput = {
  familyId: string;
  categoryId: string;
  purchaseDate: string;
  amount: number;
  paymentMethod: "conta" | "cartao";
  cardId: string | null;
  installments: number;
  recurring: boolean;
  categories: Category[];
  cards: Card[];
  invoices: Invoice[];
  transactions: Transaction[];
  budgets: Budget[];
};

export type TransactionBudgetPreview = {
  month: string;
  category: string;
  planned: number;
  registered: number;
  remaining: number;
  after: number;
};

function periodOf(date: string): HealthPeriod {
  const [year, month] = date.slice(0, 7).split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${date.slice(0, 7)}-01`,
    end: `${date.slice(0, 7)}-${String(last).padStart(2, "0")}`,
    months: 1,
  };
}

/** Prévia de caixa registrada, usando o mesmo snapshot da Saúde Financeira.
 * Não altera a atribuição de faturas nem simula projeções. */
export function transactionBudgetPreview(input: PreviewInput): TransactionBudgetPreview | null {
  if (!input.familyId || !input.categoryId || !/^\d{4}-\d{2}-\d{2}$/.test(input.purchaseDate)) return null;
  // A prévia de uma parcela não representa todas as parcelas ou recorrências.
  if (input.recurring || input.installments !== 1) return null;
  const categories = input.categories.filter(row => row.family_id === input.familyId);
  const category = categories.find(row => row.id === input.categoryId);
  if (!category || category.kind !== "despesa") return null;

  let root = category;
  const visited = new Set<string>();
  while (root.parent_id && !visited.has(root.id)) {
    visited.add(root.id);
    const parent = categories.find(row => row.id === root.parent_id);
    if (!parent) break;
    root = parent;
  }

  let referenceDate = input.purchaseDate;
  if (input.paymentMethod === "cartao") {
    const card = input.cards.find(row => row.id === input.cardId && row.family_id === input.familyId);
    if (!card) return null;
    const period = resolveInvoicePeriod(input.purchaseDate, card.closing_day, card.due_day);
    // createEntry passa o primeiro dia da referência a ensureInvoice.
    const predicted = resolveInvoicePeriod(period.reference_month, card.closing_day, card.due_day);
    const invoice = input.invoices.find(row => row.credit_card_id === card.id && row.reference_month.slice(0, 7) === period.reference_month.slice(0, 7) && row.family_id === input.familyId);
    // createEntry ainda não trata uma fatura previamente fechada/paga como um novo ciclo.
    if (invoice && invoice.status !== "aberta") return null;
    referenceDate = invoice?.due_date ?? predicted.due_date;
  }

  const data: HealthData = {
    categories,
    transactions: input.transactions.filter(row => row.family_id === input.familyId),
    invoices: input.invoices.filter(row => row.family_id === input.familyId),
    budgets: input.budgets.filter(row => row.family_id === input.familyId),
    cards: [], assets: [], movements: [], groups: [], essentials: [], debtKinds: [],
  };
  const snapshot = budgetSnapshot(data, periodOf(referenceDate), 0);
  const line = snapshot.categories.find(row => row.id === root.id);
  if (!line || line.budget <= 0) return null;
  const remaining = Math.round((line.budget - line.spent) * 100) / 100;
  return {
    month: referenceDate.slice(0, 7), category: root.name,
    planned: line.budget, registered: line.spent, remaining,
    after: Math.round((remaining - input.amount) * 100) / 100,
  };
}

import type { HealthData } from "./financial-health";
import type { Tables } from "./finance";

type Tx = Tables["transactions"]["Row"];
type Invoice = Tables["credit_card_invoices"]["Row"];

/** Mes de caixa: compras no cartao seguem a fatura real; diretas seguem pagamento/vencimento. */
export function cashExpenseDate(tx: Tx, invoiceById: Map<string, Invoice>): string | null {
  if (tx.type !== "despesa" || tx.status === "cancelado") return null;
  if (tx.credit_card_id || tx.invoice_id) {
    if (!tx.invoice_id) return null;
    const invoice = invoiceById.get(tx.invoice_id);
    if (!invoice || (tx.credit_card_id && invoice.credit_card_id !== tx.credit_card_id)) return null;
    return (invoice.status === "paga" && invoice.paid_at ? invoice.paid_at : invoice.due_date).slice(0, 10);
  }
  return (tx.status === "pago" ? (tx.paid_date ?? tx.due_date ?? tx.competence_date) : (tx.due_date ?? tx.competence_date)).slice(0, 10);
}

export function cashExpensePaid(tx: Tx, invoiceById: Map<string, Invoice>): boolean {
  if (tx.credit_card_id || tx.invoice_id) {
    const invoice = tx.invoice_id ? invoiceById.get(tx.invoice_id) : undefined;
    return !!invoice && invoice.status === "paga";
  }
  return tx.status === "pago";
}

export function cashUnassignedCards(data: HealthData): number {
  const invoiceById = new Map(data.invoices.map(i => [i.id, i]));
  return data.transactions.filter(t => t.type === "despesa" && t.expense_nature === "variavel" && t.status !== "cancelado" && (t.credit_card_id || t.invoice_id) && !cashExpenseDate(t, invoiceById)).length;
}

import { toISODate } from "./format";
import type { Database } from "@/integrations/supabase/types";

export type Tables = Database["public"]["Tables"];
export type Account = Tables["accounts"]["Row"];
export type Category = Tables["categories"]["Row"];
export type Transaction = Tables["transactions"]["Row"];
export type CreditCard = Tables["credit_cards"]["Row"];
export type Invoice = Tables["credit_card_invoices"]["Row"];
export type FamilyMember = Tables["family_members"]["Row"];
export type TransactionType = Database["public"]["Enums"]["transaction_type"];
export type TransactionStatus = Database["public"]["Enums"]["transaction_status"];
export type AccountType = Database["public"]["Enums"]["account_type"];
export type RecurrenceFrequency =
  Database["public"]["Enums"]["recurrence_frequency"];

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  corrente: "Conta corrente",
  digital: "Conta digital",
  poupanca: "Poupança",
  dinheiro: "Dinheiro",
  carteira: "Carteira",
  investimento: "Conta investimento",
  outros: "Outros",
};

export const STATUS_LABEL: Record<TransactionStatus, string> = {
  previsto: "Previsto",
  pendente: "Pendente",
  pago: "Pago/Recebido",
  atrasado: "Atrasado",
  cancelado: "Cancelado",
};

export const TYPE_LABEL: Record<TransactionType, string> = {
  receita: "Receita",
  despesa: "Despesa",
  transferencia: "Transferência",
  pagamento_fatura: "Pagamento de fatura",
};

export const FREQUENCY_LABEL: Record<RecurrenceFrequency, string> = {
  semanal: "Semanal",
  mensal: "Mensal",
  bimestral: "Bimestral",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
};

export const FREQUENCY_MONTHS: Record<RecurrenceFrequency, number> = {
  semanal: 0,
  mensal: 1,
  bimestral: 2,
  trimestral: 3,
  semestral: 6,
  anual: 12,
};

export function addMonthsClamped(date: Date, months: number): Date {
  const d = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(date.getDate(), lastDay));
  return d;
}

export function monthRange(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return { start: toISODate(start), end: toISODate(end) };
}

export function dayInMonth(year: number, month: number, day: number) {
  const last = new Date(year, month, 0).getDate();
  return new Date(year, month - 1, Math.min(day, last));
}

/**
 * Determina em qual fatura uma compra entra, considerando o dia de fechamento.
 * Compras feitas até (inclusive) o dia de fechamento entram na fatura que
 * fecha no mês corrente; depois disso, entram na fatura do mês seguinte.
 */
export function resolveInvoicePeriod(
  purchaseISO: string,
  closingDay: number,
  dueDay: number,
) {
  const parts = purchaseISO.slice(0, 10).split("-").map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  let refYear = y;
  let refMonth = m;
  if (d > closingDay) {
    const next = new Date(y, m, 1);
    refYear = next.getFullYear();
    refMonth = next.getMonth() + 1;
  }
  const closing = dayInMonth(refYear, refMonth, closingDay);
  let due = dayInMonth(refYear, refMonth, dueDay);
  if (dueDay <= closingDay) {
    const nextMonth = new Date(refYear, refMonth, 1);
    due = dayInMonth(nextMonth.getFullYear(), nextMonth.getMonth() + 1, dueDay);
  }
  return {
    reference_month: toISODate(new Date(refYear, refMonth - 1, 1)),
    closing_date: toISODate(closing),
    due_date: toISODate(due),
  };
}

/** Movimentações que afetam o caixa de uma conta (apenas realizadas). */
export function accountBalance(account: Account, txs: Transaction[]): number {
  let balance = Number(account.initial_balance);
  for (const t of txs) {
    if (t.account_id !== account.id) continue;
    if (t.status !== "pago") continue;
    if (t.paid_date && t.paid_date < account.initial_balance_date) continue;
    const amount = Number(t.amount);
    if (t.type === "receita") balance += amount;
    else if (t.type === "despesa" || t.type === "pagamento_fatura")
      balance -= amount;
    else if (t.type === "transferencia")
      balance += t.transfer_role === "destino" ? amount : -amount;
  }
  return balance;
}

/** Uma compra no cartão é despesa reconhecida na compra, sem conta bancária. */
export const isCardPurchase = (t: Transaction) =>
  t.type === "despesa" && !!t.credit_card_id;

export const isRealized = (t: Transaction) => t.status === "pago";
export const isOpen = (t: Transaction) =>
  t.status === "previsto" || t.status === "pendente" || t.status === "atrasado";

export function statusTone(status: TransactionStatus) {
  switch (status) {
    case "pago":
      return "bg-success/15 text-success border-success/30";
    case "atrasado":
      return "bg-destructive/15 text-destructive border-destructive/30";
    case "pendente":
      return "bg-warning/15 text-warning border-warning/30";
    case "cancelado":
      return "bg-muted text-muted-foreground border-border";
    default:
      return "bg-primary/15 text-primary border-primary/30";
  }
}
import { supabase } from "@/integrations/supabase/client";
import { toISODate } from "./format";
import {
  addMonthsClamped,
  resolveInvoicePeriod,
  FREQUENCY_MONTHS,
  type RecurrenceFrequency,
  type TransactionStatus,
  type Tables,
} from "./finance";

type TxInsert = Tables["transactions"]["Insert"];

export type NewEntryInput = {
  familyId: string;
  kind: "despesa" | "receita" | "transferencia" | "cartao";
  description: string;
  amount: number;
  competenceDate: string;
  dueDate: string | null;
  paidDate: string | null;
  status: TransactionStatus;
  categoryId: string | null;
  accountId: string | null;
  toAccountId: string | null;
  creditCardId: string | null;
  memberId: string | null;
  notes: string | null;
  expenseNature: "fixo" | "variavel" | null;
  installments: number;
  recurring: boolean;
  frequency: RecurrenceFrequency;
  /** Data final da recorrência (inclusive). */
  recurrenceEnd: string;
};

function clean<T extends Record<string, unknown>>(row: T): T {
  return row;
}

/** Garante que a fatura do cartão para aquele mês exista e devolve seus dados. */
export async function ensureInvoice(
  familyId: string,
  card: Tables["credit_cards"]["Row"],
  purchaseISO: string,
) {
  const period = resolveInvoicePeriod(purchaseISO, card.closing_day, card.due_day);
  const { data: existing } = await supabase
    .from("credit_card_invoices")
    .select("*")
    .eq("credit_card_id", card.id)
    .eq("reference_month", period.reference_month)
    .maybeSingle();
  if (existing) return existing;

  const { data, error } = await supabase
    .from("credit_card_invoices")
    .insert({
      family_id: familyId,
      credit_card_id: card.id,
      reference_month: period.reference_month,
      closing_date: period.closing_date,
      due_date: period.due_date,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function createEntry(input: NewEntryInput, cards: Tables["credit_cards"]["Row"][]) {
  const base = {
    family_id: input.familyId,
    description: input.description,
    amount: input.amount,
    category_id: input.categoryId,
    member_id: input.memberId,
    notes: input.notes,
    expense_nature:
      input.kind === "despesa" || input.kind === "cartao" ? input.expenseNature : null,
  };

  // ---- Transferência entre contas: duas pernas ligadas, sem receita/despesa
  if (input.kind === "transferencia") {
    const groupId = crypto.randomUUID();
    const rows: TxInsert[] = [
      {
        ...base,
        category_id: null,
        type: "transferencia",
        account_id: input.accountId,
        transfer_group_id: groupId,
        transfer_role: "origem",
        competence_date: input.competenceDate,
        due_date: input.dueDate,
        paid_date: input.paidDate,
        status: input.status,
      },
      {
        ...base,
        category_id: null,
        type: "transferencia",
        account_id: input.toAccountId,
        transfer_group_id: groupId,
        transfer_role: "destino",
        competence_date: input.competenceDate,
        due_date: input.dueDate,
        paid_date: input.paidDate,
        status: input.status,
      },
    ];
    const { error } = await supabase.from("transactions").insert(rows);
    if (error) throw error;
    return;
  }

  // ---- Compra no cartão: despesa reconhecida na compra, alocada em faturas
  if (input.kind === "cartao") {
    const card = cards.find((c) => c.id === input.creditCardId);
    if (!card) throw new Error("Selecione um cartão");
    const parcels = Math.max(1, input.installments);
    const value = Number((input.amount / parcels).toFixed(2));
    let groupId: string | null = null;

    if (parcels > 1) {
      const { data, error } = await supabase
        .from("installment_groups")
        .insert({
          family_id: input.familyId,
          description: input.description,
          total_amount: input.amount,
          installments: parcels,
          first_due_date: input.competenceDate,
          credit_card_id: card.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      groupId = data.id;
    }

    const rows: TxInsert[] = [];
    for (let i = 0; i < parcels; i++) {
      const date = toISODate(addMonthsClamped(new Date(input.competenceDate + "T00:00:00"), i));
      const invoice = await ensureInvoice(input.familyId, card, date);
      rows.push(
        clean({
          ...base,
          amount: value,
          type: "despesa" as const,
          credit_card_id: card.id,
          invoice_id: invoice.id,
          account_id: null,
          competence_date: date,
          due_date: invoice.due_date,
          paid_date: null,
          status: "previsto" as TransactionStatus,
          installment_group_id: groupId,
          installment_number: parcels > 1 ? i + 1 : null,
          installment_total: parcels > 1 ? parcels : null,
          description:
            parcels > 1 ? `${input.description} (${i + 1}/${parcels})` : input.description,
        }),
      );
    }
    const { error } = await supabase.from("transactions").insert(rows);
    if (error) throw error;
    return;
  }

  // ---- Receita / despesa em conta
  const type = input.kind;
  const parcels = Math.max(1, input.installments);

  if (input.recurring) {
    const { data: rec, error: recError } = await supabase
      .from("recurring_transactions")
      .insert({
        family_id: input.familyId,
        description: input.description,
        type,
        amount: input.amount,
        category_id: input.categoryId,
        account_id: input.accountId,
        member_id: input.memberId,
        frequency: input.frequency,
        start_date: input.competenceDate,
        end_date: input.recurrenceEnd,
        notes: input.notes,
        expense_nature: input.expenseNature,
      })
      .select("id")
      .single();
    if (recError) throw recError;

    const rows = buildRecurrenceRows({
      familyId: input.familyId,
      recurringId: rec.id,
      base: {
        ...base,
        type,
        account_id: input.accountId,
      },
      startDate: input.competenceDate,
      dueDate: input.dueDate ?? input.competenceDate,
      frequency: input.frequency,
      endDate: input.recurrenceEnd,
    });
    const { error } = await supabase.from("transactions").insert(rows);
    if (error) throw error;
    return;
  }

  if (parcels > 1) {
    const value = Number((input.amount / parcels).toFixed(2));
    const { data: group, error: gErr } = await supabase
      .from("installment_groups")
      .insert({
        family_id: input.familyId,
        description: input.description,
        total_amount: input.amount,
        installments: parcels,
        first_due_date: input.dueDate ?? input.competenceDate,
        account_id: input.accountId,
      })
      .select("id")
      .single();
    if (gErr) throw gErr;

    const rows: TxInsert[] = [];
    for (let i = 0; i < parcels; i++) {
      const comp = toISODate(addMonthsClamped(new Date(input.competenceDate + "T00:00:00"), i));
      const due = toISODate(
        addMonthsClamped(new Date((input.dueDate ?? input.competenceDate) + "T00:00:00"), i),
      );
      rows.push({
        ...base,
        amount: value,
        type,
        account_id: input.accountId,
        competence_date: comp,
        due_date: due,
        paid_date: null,
        status: "previsto",
        installment_group_id: group.id,
        installment_number: i + 1,
        installment_total: parcels,
        description: `${input.description} (${i + 1}/${parcels})`,
      });
    }
    const { error } = await supabase.from("transactions").insert(rows);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("transactions").insert({
    ...base,
    type,
    account_id: input.accountId,
    competence_date: input.competenceDate,
    due_date: input.dueDate,
    paid_date: input.paidDate,
    status: input.status,
  });
  if (error) throw error;
}

export function buildRecurrenceRows(args: {
  familyId: string;
  recurringId: string;
  base: Record<string, unknown>;
  startDate: string;
  dueDate: string;
  frequency: RecurrenceFrequency;
  endDate: string;
}): TxInsert[] {
  const rows: TxInsert[] = [];
  const months = FREQUENCY_MONTHS[args.frequency];
  const MAX = 240;
  for (let i = 0; i < MAX; i++) {
    const start = new Date(args.startDate + "T00:00:00");
    const due = new Date(args.dueDate + "T00:00:00");
    const comp =
      months === 0
        ? new Date(start.getTime() + i * 7 * 86400000)
        : addMonthsClamped(start, i * months);
    if (toISODate(comp) > args.endDate) break;
    const dueDate =
      months === 0 ? new Date(due.getTime() + i * 7 * 86400000) : addMonthsClamped(due, i * months);
    rows.push({
      ...(args.base as TxInsert),
      competence_date: toISODate(comp),
      due_date: toISODate(dueDate),
      status: "previsto",
      recurring_id: args.recurringId,
    });
  }
  return rows;
}

/** Marca como pago/recebido na data informada. */
export type RecurrenceInput = {
  familyId: string;
  id?: string | undefined;
  description: string;
  type: "receita" | "despesa";
  amount: number;
  categoryId: string | null;
  accountId: string | null;
  creditCardId: string | null;
  memberId: string | null;
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate: string;
  dayOfMonth: number | null;
  /** Base para o vencimento/recebimento das ocorrências (contas). */
  dueBaseDate?: string | null;
  notes: string | null;
  expenseNature: "fixo" | "variavel" | null;
  isActive: boolean;
};

/**
 * Cria ou atualiza uma recorrência e regenera os lançamentos futuros
 * ainda não quitados dentro do intervalo informado.
 */
export async function saveRecurrence(input: RecurrenceInput) {
  const payload = {
    family_id: input.familyId,
    description: input.description,
    type: input.type,
    amount: input.amount,
    category_id: input.categoryId,
    account_id: input.accountId,
    credit_card_id: input.creditCardId,
    member_id: input.memberId,
    frequency: input.frequency,
    start_date: input.startDate,
    end_date: input.endDate,
    day_of_month: input.dayOfMonth,
    notes: input.notes,
    expense_nature: input.type === "despesa" ? input.expenseNature : null,
    is_active: input.isActive,
  };

  let recurringId = input.id;
  const settledCompetenceDates = new Set<string>();
  if (recurringId) {
    // Lançamentos quitados são históricos e não podem ser removidos. Guardamos
    // suas competências para não criar uma nova previsão para o mesmo período.
    const { data: settledRows, error: settledError } = await supabase
      .from("transactions")
      .select("competence_date")
      .eq("recurring_id", recurringId)
      .eq("status", "pago");
    if (settledError) throw settledError;
    for (const row of settledRows ?? []) settledCompetenceDates.add(row.competence_date);

    const { error } = await supabase
      .from("recurring_transactions")
      .update(payload)
      .eq("id", recurringId);
    if (error) throw error;
    // remove lançamentos futuros ainda não pagos para regerar
    const { error: delError } = await supabase
      .from("transactions")
      .delete()
      .eq("recurring_id", recurringId)
      .neq("status", "pago");
    if (delError) throw delError;
  } else {
    const { data, error } = await supabase
      .from("recurring_transactions")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw error;
    recurringId = data.id;
  }

  if (!input.isActive) return;

  const rows = buildRecurrenceRows({
    familyId: input.familyId,
    recurringId,
    base: {
      family_id: input.familyId,
      description: input.description,
      amount: input.amount,
      type: input.type,
      category_id: input.categoryId,
      account_id: input.accountId,
      credit_card_id: input.creditCardId,
      member_id: input.memberId,
      notes: input.notes,
      expense_nature: input.type === "despesa" ? input.expenseNature : null,
    },
    startDate: input.startDate,
    dueDate: input.dueBaseDate || input.startDate,
    frequency: input.frequency,
    endDate: input.endDate,
  }).filter((row) => !settledCompetenceDates.has(String(row.competence_date)));
  if (rows.length === 0) return;

  // Recorrência no cartão: cada ocorrência entra na fatura conforme o fechamento
  if (input.creditCardId) {
    const { data: card, error: cardError } = await supabase
      .from("credit_cards")
      .select("*")
      .eq("id", input.creditCardId)
      .maybeSingle();
    if (cardError) throw cardError;
    if (card) {
      for (const row of rows) {
        const invoice = await ensureInvoice(input.familyId, card, String(row.competence_date));
        row.invoice_id = invoice.id;
        row.due_date = invoice.due_date;
        row.account_id = null;
      }
    }
  }

  const { error } = await supabase.from("transactions").insert(rows);
  if (error) throw error;
}

export async function markAsPaid(id: string, date: string) {
  const { error } = await supabase
    .from("transactions")
    .update({ status: "pago", paid_date: date })
    .eq("id", id);
  if (error) throw error;
}

/** Alterna a quitação de um lançamento (pago/recebido <-> previsto). */
export async function setPaid(tx: Tables["transactions"]["Row"], paid: boolean, date: string) {
  let query = supabase
    .from("transactions")
    .update(
      paid
        ? { status: "pago" as TransactionStatus, paid_date: date }
        : { status: "previsto" as TransactionStatus, paid_date: null },
    );
  query = tx.transfer_group_id
    ? query.eq("transfer_group_id", tx.transfer_group_id)
    : query.eq("id", tx.id);
  const { error } = await query;
  if (error) throw error;
}

/** Exclui um lançamento — transferências removem as duas pernas. */
export async function deleteTransaction(tx: Tables["transactions"]["Row"]) {
  if (tx.transfer_group_id) {
    const { error } = await supabase
      .from("transactions")
      .delete()
      .eq("transfer_group_id", tx.transfer_group_id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("transactions").delete().eq("id", tx.id);
  if (error) throw error;
}

/**
 * Pagamento de fatura: saída da conta bancária que quita a fatura.
 * Não gera nova despesa — a despesa já foi reconhecida na compra.
 */
export async function payInvoice(args: {
  familyId: string;
  invoice: Tables["credit_card_invoices"]["Row"];
  cardName: string;
  accountId: string;
  amount: number;
  paidDate: string;
}) {
  const { error } = await supabase.from("transactions").insert({
    family_id: args.familyId,
    description: `Pagamento fatura ${args.cardName}`,
    type: "pagamento_fatura",
    amount: args.amount,
    account_id: args.accountId,
    credit_card_id: args.invoice.credit_card_id,
    invoice_id: args.invoice.id,
    competence_date: args.paidDate,
    due_date: args.invoice.due_date,
    paid_date: args.paidDate,
    status: "pago",
  });
  if (error) throw error;
  // todos os lançamentos que compõem a fatura passam a "pago"
  const { error: txError } = await supabase
    .from("transactions")
    .update({ status: "pago", paid_date: args.paidDate })
    .eq("invoice_id", args.invoice.id)
    .eq("type", "despesa");
  if (txError) throw txError;
  const { error: invError } = await supabase
    .from("credit_card_invoices")
    .update({ status: "paga", paid_at: args.paidDate })
    .eq("id", args.invoice.id);
  if (invError) throw invError;
}

/** Estorna o pagamento de uma fatura: devolve o saldo e reabre os lançamentos. */
export async function reverseInvoicePayment(invoice: Tables["credit_card_invoices"]["Row"]) {
  const { error: delError } = await supabase
    .from("transactions")
    .delete()
    .eq("invoice_id", invoice.id)
    .eq("type", "pagamento_fatura");
  if (delError) throw delError;

  const { error: txError } = await supabase
    .from("transactions")
    .update({ status: "previsto", paid_date: null })
    .eq("invoice_id", invoice.id)
    .eq("type", "despesa");
  if (txError) throw txError;

  const { error: invError } = await supabase
    .from("credit_card_invoices")
    .update({ status: "aberta", paid_at: null })
    .eq("id", invoice.id);
  if (invError) throw invError;
}

export type InstallmentGroupInput = {
  familyId: string;
  id: string;
  description: string;
  totalAmount: number;
  installments: number;
  firstDate: string;
  categoryId: string | null;
  memberId: string | null;
  notes: string | null;
  card: Tables["credit_cards"]["Row"];
};

/**
 * Reescreve um parcelamento inteiro: apaga as parcelas atuais e regera
 * todas conforme os novos dados, preservando quantas já estavam pagas.
 */
export async function updateInstallmentGroup(input: InstallmentGroupInput) {
  const { data: current, error: readError } = await supabase
    .from("transactions")
    .select("*")
    .eq("installment_group_id", input.id)
    .order("installment_number");
  if (readError) throw readError;

  const paid = (current ?? []).filter((t) => t.status === "pago");
  const paidCount = paid.length;

  const { error: delError } = await supabase
    .from("transactions")
    .delete()
    .eq("installment_group_id", input.id);
  if (delError) throw delError;

  const parcels = Math.max(1, input.installments);
  const value = Number((input.totalAmount / parcels).toFixed(2));
  const rows: TxInsert[] = [];
  for (let i = 0; i < parcels; i++) {
    const date = toISODate(addMonthsClamped(new Date(input.firstDate + "T00:00:00"), i));
    const invoice = await ensureInvoice(input.familyId, input.card, date);
    const wasPaid = i < paidCount;
    rows.push({
      family_id: input.familyId,
      description: parcels > 1 ? `${input.description} (${i + 1}/${parcels})` : input.description,
      amount: value,
      type: "despesa",
      category_id: input.categoryId,
      member_id: input.memberId,
      notes: input.notes,
      credit_card_id: input.card.id,
      invoice_id: invoice.id,
      account_id: null,
      competence_date: date,
      due_date: invoice.due_date,
      paid_date: wasPaid ? (paid[i]?.paid_date ?? invoice.due_date) : null,
      status: wasPaid ? "pago" : "previsto",
      installment_group_id: input.id,
      installment_number: parcels > 1 ? i + 1 : null,
      installment_total: parcels > 1 ? parcels : null,
    });
  }
  const { error } = await supabase.from("transactions").insert(rows);
  if (error) throw error;

  const { error: gErr } = await supabase
    .from("installment_groups")
    .update({
      description: input.description,
      total_amount: input.totalAmount,
      installments: parcels,
      first_due_date: input.firstDate,
      credit_card_id: input.card.id,
    })
    .eq("id", input.id);
  if (gErr) throw gErr;
}

/** Apaga o parcelamento e todas as suas parcelas. */
export async function deleteInstallmentGroup(id: string) {
  const { error: txError } = await supabase
    .from("transactions")
    .delete()
    .eq("installment_group_id", id);
  if (txError) throw txError;
  const { error } = await supabase.from("installment_groups").delete().eq("id", id);
  if (error) throw error;
}

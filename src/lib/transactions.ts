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

export async function createEntry(
  input: NewEntryInput,
  cards: Tables["credit_cards"]["Row"][],
) {
  const base = {
    family_id: input.familyId,
    description: input.description,
    amount: input.amount,
    category_id: input.categoryId,
    member_id: input.memberId,
    notes: input.notes,
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
      const date = toISODate(
        addMonthsClamped(new Date(input.competenceDate + "T00:00:00"), i),
      );
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
            parcels > 1
              ? `${input.description} (${i + 1}/${parcels})`
              : input.description,
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
      const comp = toISODate(
        addMonthsClamped(new Date(input.competenceDate + "T00:00:00"), i),
      );
      const due = toISODate(
        addMonthsClamped(
          new Date((input.dueDate ?? input.competenceDate) + "T00:00:00"),
          i,
        ),
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
      months === 0
        ? new Date(due.getTime() + i * 7 * 86400000)
        : addMonthsClamped(due, i * months);
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
  notes: string | null;
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
    is_active: input.isActive,
  };

  let recurringId = input.id;
  if (recurringId) {
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
    },
    startDate: input.startDate,
    dueDate: input.startDate,
    frequency: input.frequency,
    endDate: input.endDate,
  });
  if (rows.length === 0) return;
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
  const { error: invError } = await supabase
    .from("credit_card_invoices")
    .update({ status: "paga", paid_at: args.paidDate })
    .eq("id", args.invoice.id);
  if (invError) throw invError;
}
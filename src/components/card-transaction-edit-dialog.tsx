import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CurrencyInput } from "@/components/currency-input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { FREQUENCY_LABEL, STATUS_VALUES, statusLabel, type RecurrenceFrequency, type Transaction, type TransactionStatus, type TransactionType } from "@/lib/finance";
import { useAccounts, useCards, useCategories, useInvoices, useMembers, useTransactions } from "@/lib/queries";
import { ensureInvoice, saveRecurrence } from "@/lib/transactions";
const NONE = "__none__";

export function CardTransactionEditDialog({
  transaction,
  onClose,
  onSaved,
}: {
  transaction: Transaction | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { data: members = [] } = useMembers();
  const { data: cards = [] } = useCards();
  const { data: invoices = [] } = useInvoices();
  const { data: allTransactions = [] } = useTransactions();
  const paidInvoice = Boolean(
    transaction?.invoice_id && invoices.some(
      (invoice) => invoice.id === transaction.invoice_id && invoice.status === "paga",
    ),
  );
  // Uma compra parcelada com qualquer parcela liquidada não admite edição do valor.
  const paidInstallmentInGroup = Boolean(transaction?.installment_group_id &&
    allTransactions.some((item) =>
      item.family_id === transaction.family_id &&
      item.installment_group_id === transaction.installment_group_id &&
      (item.status === "pago" || Boolean(item.invoice_id &&
        invoices.some((invoice) => invoice.id === item.invoice_id && invoice.status === "paga"))),
    ));

  const [type, setType] = useState<TransactionType>("despesa");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(0);
  const [competenceDate, setCompetenceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [paidDate, setPaidDate] = useState("");
  const [status, setStatus] = useState<TransactionStatus>("pendente");
  const [categoryId, setCategoryId] = useState(NONE);
  const [accountId, setAccountId] = useState(NONE);
  const [cardId, setCardId] = useState(NONE);
  const [memberId, setMemberId] = useState(NONE);
  const [notes, setNotes] = useState("");
  const [expenseNature, setExpenseNature] = useState<"fixo" | "variavel">("variavel");
  const [createRecurrence, setCreateRecurrence] = useState(false);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("mensal");
  const [recurrenceEnd, setRecurrenceEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  if (transaction && transaction.id !== loadedId) {
    setLoadedId(transaction.id);
    setType(transaction.type);
    setDescription(transaction.description);
    setAmount(Number(transaction.amount));
    setCompetenceDate(transaction.competence_date);
    setDueDate(transaction.due_date ?? "");
    setPaidDate(transaction.paid_date ?? "");
    setStatus(transaction.status);
    setCategoryId(transaction.category_id ?? NONE);
    setAccountId(transaction.account_id ?? NONE);
    setCardId(transaction.credit_card_id ?? NONE);
    setMemberId(transaction.member_id ?? NONE);
    setNotes(transaction.notes ?? "");
    setExpenseNature(transaction.expense_nature ?? "variavel");
    setCreateRecurrence(false);
    setFrequency("mensal");
    setRecurrenceEnd(`${transaction.competence_date.slice(0, 4)}-12-31`);
  }

  const categoryOptions = useMemo(() => {
    const wanted = type === "receita" ? "receita" : "despesa";
    const parents = categories.filter((c) => c.kind === wanted && !c.parent_id);
    return parents.flatMap((p) => [
      { id: p.id, label: p.name, child: false },
      ...categories
        .filter((c) => c.parent_id === p.id)
        .map((c) => ({ id: c.id, label: c.name, child: true })),
    ]);
  }, [categories, type]);

  const isTransfer = type === "transferencia";
  const canChangeType = type === "receita" || type === "despesa";
  const canCreateRecurrence =
    canChangeType &&
    !transaction?.recurring_id &&
    !transaction?.installment_group_id &&
    !transaction?.transfer_group_id;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!transaction) return;
    const value = amount;
    // Conferência no banco antes de salvar: uma parcela pode ter sido paga
    // depois da abertura deste editor. Não confiar apenas no estado da interface.
    if (transaction.installment_group_id && Math.abs(value - Number(transaction.amount)) > 0.005) {
      const { data: groupRows, error: groupError } = await supabase
        .from("transactions")
        .select("id, status, invoice_id")
        .eq("family_id", transaction.family_id)
        .eq("installment_group_id", transaction.installment_group_id);
      if (groupError || !groupRows) {
        toast.error("Não foi possível verificar as parcelas da compra");
        return;
      }
      const groupInvoiceIds = [...new Set(groupRows.map((item) => item.invoice_id).filter((id): id is string => Boolean(id)))];
      const hasPaidRow = groupRows.some((item) => item.status === "pago");
      let hasPaidInvoice = false;
      if (groupInvoiceIds.length > 0) {
        const { data: settled, error: invoiceError } = await supabase
          .from("credit_card_invoices")
          .select("id")
          .eq("family_id", transaction.family_id)
          .in("id", groupInvoiceIds)
          .eq("status", "paga");
        if (invoiceError) {
          toast.error("Não foi possível verificar pagamentos de parcelas");
          return;
        }
        hasPaidInvoice = Boolean(settled?.length);
      }
      if (hasPaidRow || hasPaidInvoice) {
        toast.error("Valor bloqueado: esta compra já possui parcelas pagas. Categoria e classificação podem ser corrigidas.");
        return;
      }
    }
    if (!value || value <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    if (createRecurrence && (!recurrenceEnd || recurrenceEnd < competenceDate)) {
      toast.error("Informe uma data final da recorrência igual ou posterior à competência");
      return;
    }

    // Mesmo que a fatura tenha sido paga após a abertura do formulário,
    // jamais altere valor, datas, origem ou status de suas compras.
    if (transaction.invoice_id) {
      const { data: freshInvoice, error: invoiceError } = await supabase
        .from("credit_card_invoices")
        .select("status")
        .eq("id", transaction.invoice_id)
        .eq("family_id", transaction.family_id)
        .single();
      if (invoiceError || !freshInvoice) {
        toast.error("Não foi possível confirmar a situação da fatura");
        return;
      }
      if (freshInvoice.status === "paga") {
        if (!paidInvoice) {
          toast.error("A fatura foi paga enquanto você editava. Reabra para alterar somente categoria e classificação.");
          return;
        }
        setSaving(true);
        const { error: classificationError } = await supabase
          .from("transactions")
          .update({
            category_id: categoryId === NONE ? null : categoryId,
            expense_nature: transaction.type === "despesa" ? expenseNature : null,
          })
          .eq("id", transaction.id)
          .eq("family_id", transaction.family_id);
        setSaving(false);
        if (classificationError) {
          toast.error("Não foi possível salvar a classificação");
          return;
        }
        toast.success("Classificação atualizada, sem alterar a fatura paga");
        onSaved();
        return;
      }
    }
    setSaving(true);
    let targetInvoiceId: string | null = null;
    let targetDueDate = dueDate || null;
    const targetCardId = type === "despesa" && cardId !== NONE ? cardId : null;
    if (type === "despesa" && targetCardId) {
      const card = cards.find((item) => item.id === targetCardId);
      if (!card) {
        setSaving(false);
        toast.error("Cartão não encontrado");
        return;
      }
      try {
        const invoice = await ensureInvoice(transaction.family_id, card, competenceDate);
        if (invoice.status === "paga" && invoice.id !== transaction.invoice_id) {
          setSaving(false);
          toast.error("A fatura de destino já está paga");
          return;
        }
        targetInvoiceId = invoice.id;
        targetDueDate = invoice.due_date;
      } catch {
        setSaving(false);
        toast.error("Não foi possível localizar a fatura correta");
        return;
      }
    }
    if (
      transaction.invoice_id &&
      transaction.status === "pago" &&
      targetInvoiceId !== transaction.invoice_id
    ) {
      setSaving(false);
      toast.error("Estorne o pagamento da fatura antes de alterar cartão ou data da compra");
      return;
    }
    const shared = {
      type,
      description,
      amount: value,
      competence_date: competenceDate,
      due_date: targetDueDate,
      paid_date: status === "pago" ? paidDate || targetDueDate || competenceDate : null,
      status,
      category_id: isTransfer || categoryId === NONE ? null : categoryId,
      member_id: memberId === NONE ? null : memberId,
      notes: notes || null,
      expense_nature: type === "despesa" ? expenseNature : null,
    };
    const { error } = transaction.transfer_group_id
      ? await supabase
          .from("transactions")
          .update(shared)
          .eq("transfer_group_id", transaction.transfer_group_id)
      : await supabase
          .from("transactions")
          .update({
            ...shared,
            account_id: targetCardId ? null : accountId === NONE ? null : accountId,
            credit_card_id: targetCardId,
            invoice_id: targetInvoiceId,
          })
          .eq("id", transaction.id);
    if (error) {
      setSaving(false);
      toast.error("Não foi possível salvar");
      return;
    }

    if (createRecurrence && canCreateRecurrence) {
      try {
        await saveRecurrence({
          familyId: transaction.family_id,
          sourceTransactionId: transaction.id,
          description,
          type: type as "receita" | "despesa",
          amount: value,
          categoryId: categoryId === NONE ? null : categoryId,
          accountId: targetCardId || accountId === NONE ? null : accountId,
          creditCardId: targetCardId,
          memberId: memberId === NONE ? null : memberId,
          frequency,
          startDate: competenceDate,
          endDate: recurrenceEnd,
          dayOfMonth: targetCardId
            ? null
            : Number((targetDueDate ?? competenceDate).slice(8, 10)) || null,
          dueBaseDate: targetCardId ? null : targetDueDate || competenceDate,
          notes: notes || null,
          expenseNature: type === "despesa" ? expenseNature : null,
          isActive: true,
        });
      } catch (recurrenceError) {
        setSaving(false);
        toast.error("Lançamento atualizado, mas não foi possível criar a recorrência", {
          description: recurrenceError instanceof Error ? recurrenceError.message : undefined,
        });
        return;
      }
    }

    if (transaction.invoice_id && transaction.invoice_id !== targetInvoiceId) {
      const { count } = await supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("invoice_id", transaction.invoice_id)
        .eq("type", "despesa");
      if (count === 0) {
        await supabase
          .from("credit_card_invoices")
          .delete()
          .eq("id", transaction.invoice_id)
          .neq("status", "paga");
      }
    }
    setSaving(false);
    toast.success(
      createRecurrence ? "Lançamento atualizado e recorrência criada" : "Lançamento atualizado",
    );
    onSaved();
  }

  return (
    <Dialog open={!!transaction} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar lançamento</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          {paidInvoice ? (
            <div className="space-y-4">
              <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-muted-foreground">
                Esta fatura está paga. Somente Categoria e Classificação podem ser alteradas.
                Valor, datas, origem e situação permanecem protegidos.
              </p>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem categoria</SelectItem>
                    {categoryOptions.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.child ? `— ${category.label}` : category.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {transaction?.type === "despesa" && (
                <div className="space-y-2">
                  <Label>Classificação da despesa</Label>
                  <Select value={expenseNature} onValueChange={(value) => setExpenseNature(value as "fixo" | "variavel")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixo">Fixo</SelectItem>
                      <SelectItem value="variavel">Variável</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="ed">Descrição</Label>
              <Input id="ed" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            {canChangeType && (
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={type} onValueChange={(v) => setType(v as TransactionType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="despesa">Despesa</SelectItem>
                    <SelectItem value="receita">Receita</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="ev">Valor (R$)</Label>
              <CurrencyInput id="ev" value={amount} onValueChange={setAmount} disabled={paidInstallmentInGroup} />
              {paidInstallmentInGroup && <p className="text-xs text-amber-500">Valor bloqueado: já existem parcelas pagas desta compra.</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ecomp">Competência</Label>
              <Input
                id="ecomp"
                type="date"
                value={competenceDate}
                onChange={(e) => setCompetenceDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="evenc">Vencimento</Label>
              <Input
                id="evenc"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            {!isTransfer && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Categoria</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem categoria</SelectItem>
                    {categoryOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.child ? `— ${c.label}` : c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {type === "despesa" && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Classificação da despesa</Label>
                <Select
                  value={expenseNature}
                  onValueChange={(v) => setExpenseNature(v as "fixo" | "variavel")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixo">Fixo</SelectItem>
                    <SelectItem value="variavel">Variável</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Conta</Label>
              <Select
                value={accountId}
                onValueChange={(value) => {
                  setAccountId(value);
                  if (value !== NONE) setCardId(NONE);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem conta</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {type === "despesa" && (
              <div className="space-y-2">
                <Label>Cartão</Label>
                <Select
                  value={cardId}
                  onValueChange={(value) => {
                    setCardId(value);
                    if (value !== NONE) setAccountId(NONE);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem cartão</SelectItem>
                    {cards.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Membro</Label>
              <Select value={memberId} onValueChange={setMemberId}>
                <SelectTrigger>
                  <SelectValue placeholder="Opcional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem membro</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Situação</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TransactionStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_VALUES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {statusLabel(s, type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {status === "pago" && (
              <div className="space-y-2">
                <Label htmlFor="epg">
                  {type === "receita" ? "Data do recebimento" : "Data do pagamento"}
                </Label>
                <Input
                  id="epg"
                  type="date"
                  value={paidDate}
                  onChange={(e) => setPaidDate(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="eobs">Observação</Label>
              <Textarea
                id="eobs"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {transaction?.recurring_id ? (
              <div className="rounded-lg border border-border bg-surface-2/40 p-3 text-sm text-muted-foreground sm:col-span-2">
                Este lançamento já pertence a uma recorrência. As próximas ocorrências podem ser
                ajustadas na tela de Recorrências.
              </div>
            ) : (
              canCreateRecurrence && (
                <div className="space-y-3 rounded-lg border border-border p-3 sm:col-span-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label htmlFor="edit-rec" className="cursor-pointer">
                        Tornar este lançamento recorrente
                      </Label>
                      <p className="mt-1 text-xs text-muted-foreground">
                        O lançamento atual será preservado e apenas as próximas ocorrências serão
                        criadas.
                      </p>
                    </div>
                    <Switch
                      id="edit-rec"
                      checked={createRecurrence}
                      onCheckedChange={(checked) => {
                        setCreateRecurrence(checked);
                        if (checked && recurrenceEnd < competenceDate) {
                          setRecurrenceEnd(`${competenceDate.slice(0, 4)}-12-31`);
                        }
                      }}
                    />
                  </div>
                  {createRecurrence && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Periodicidade</Label>
                        <Select
                          value={frequency}
                          onValueChange={(value) => setFrequency(value as RecurrenceFrequency)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(FREQUENCY_LABEL).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-rec-end">Data final</Label>
                        <Input
                          id="edit-rec-end"
                          type="date"
                          min={competenceDate}
                          value={recurrenceEnd}
                          onChange={(event) => setRecurrenceEnd(event.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            )}
          </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

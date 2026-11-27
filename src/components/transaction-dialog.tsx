import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/currency-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WalletCards } from "lucide-react";
import { transactionBudgetPreview } from "@/lib/transaction-budget-preview";
import { brl } from "@/lib/format";
import { toISODate } from "@/lib/format";
import {
  FREQUENCY_LABEL,
  statusLabel,
  type RecurrenceFrequency,
  type TransactionStatus,
} from "@/lib/finance";
import {
  useAccounts,
  useBudgets,
  useCards,
  useInvoices,
  useCategories,
  useMembers,
  useProfile,
  useTransactions,
  useInvalidateFinance,
} from "@/lib/queries";
import { createEntry, type NewEntryInput } from "@/lib/transactions";
import {
  isThirdPartyCategory,
  isThirdPartyTransaction,
  orderedCategoryOptions,
} from "@/lib/derive";

type Kind = NewEntryInput["kind"];

const NONE = "__none__";

export function TransactionDialog({
  open,
  onOpenChange,
  defaultKind = "despesa",
  thirdPartyOnly = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultKind?: Kind;
  thirdPartyOnly?: boolean;
}) {
  const { data: profile } = useProfile();
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: members = [] } = useMembers();
  const { data: cards = [] } = useCards();
  const { data: budgets = [], isLoading: budgetsLoading, isError: budgetsError } = useBudgets();
  const { data: invoices = [], isLoading: invoicesLoading, isError: invoicesError } = useInvoices();
  const { data: transactions = [], isLoading: transactionsLoading, isError: transactionsError } = useTransactions();
  const invalidate = useInvalidateFinance();

  const today = toISODate(new Date());
  const [kind, setKind] = useState<Kind>(defaultKind);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(0);
  const [competenceDate, setCompetenceDate] = useState(today);
  const [status, setStatus] = useState<TransactionStatus>("pago");
  const [categoryId, setCategoryId] = useState(NONE);
  const [accountId, setAccountId] = useState(NONE);
  const [creditCardId, setCreditCardId] = useState(NONE);
  const [paymentMethod, setPaymentMethod] = useState<"conta" | "cartao">("conta");
  const [memberId, setMemberId] = useState(NONE);
  const [notes, setNotes] = useState("");
  const [expenseNature, setExpenseNature] = useState<"fixo" | "variavel">("variavel");
  const [installments, setInstallments] = useState("1");
  const [recurring, setRecurring] = useState(false);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("mensal");
  const [recurrenceEnd, setRecurrenceEnd] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(defaultKind === "receita" ? "receita" : "despesa");
    setPaymentMethod(defaultKind === "cartao" ? "cartao" : "conta");
    setDescription("");
    setAmount(0);
    setCompetenceDate(today);
    setStatus("pago");
    setCategoryId(NONE);
    setNotes("");
    setExpenseNature("variavel");
    setInstallments("1");
    setRecurring(false);
    setRecurrenceEnd(toISODate(new Date(new Date().getFullYear(), 11, 31)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const active = accounts.filter((a) => a.is_active);
    if (accountId === NONE && active[0]) setAccountId(active[0].id);
    if (creditCardId === NONE && cards[0]) setCreditCardId(cards[0].id);
  }, [accounts, cards, accountId, creditCardId]);

  const categoryOptions = useMemo(() => {
    const wanted = kind === "receita" ? "receita" : "despesa";
    const available = categories.filter((category) =>
      category.kind === wanted && (!thirdPartyOnly || isThirdPartyCategory(categories, category.id)),
    );
    return orderedCategoryOptions(available, wanted).map((category) => ({
      id: category.id,
      label: category.label,
      child: Boolean(categories.find((item) => item.id === category.id)?.parent_id),
    }));
  }, [categories, kind, thirdPartyOnly]);

  // Na tela de terceiros, a categoria é obrigatória e selecionada por regra, nunca por ID fixo.
  useEffect(() => {
    if (!open || !thirdPartyOnly) return;
    if (!categoryOptions.some((option) => option.id === categoryId)) {
      setCategoryId(categoryOptions[0]?.id ?? NONE);
    }
  }, [open, thirdPartyOnly, categoryOptions, categoryId]);

  const showCard = kind === "despesa" && paymentMethod === "cartao";
  const showAccount = kind === "receita" || (kind === "despesa" && !showCard);
  const variableBudgetContext = useMemo(() => {
    if (
      !profile?.family_id || kind !== "despesa" || expenseNature !== "variavel" ||
      categoryId === NONE || isThirdPartyCategory(categories, categoryId) ||
      invoicesLoading || invoicesError || budgetsLoading || budgetsError ||
      transactionsLoading || transactionsError || (showCard && creditCardId === NONE)
    ) return null;
    return transactionBudgetPreview({
      familyId: profile.family_id,
      categoryId,
      purchaseDate: competenceDate,
      amount,
      paymentMethod,
      cardId: showCard ? creditCardId : null,
      installments: showCard ? Number(installments) : 1,
      recurring,
      categories, cards, invoices, transactions, budgets,
    });
  }, [profile?.family_id, kind, expenseNature, categoryId, competenceDate, amount,
    paymentMethod, showCard, creditCardId, installments, recurring, categories,
    cards, invoices, invoicesLoading, invoicesError, transactions, budgets,
    budgetsLoading, budgetsError, transactionsLoading, transactionsError]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile?.family_id) return;
    const value = amount;
    if (thirdPartyOnly && (
      (kind !== "receita" && kind !== "despesa") ||
      categoryId === NONE ||
      !categories.some((category) =>
        category.id === categoryId && category.kind === kind && isThirdPartyCategory(categories, category.id),
      )
    )) {
      toast.error("Selecione uma categoria de terceiros correspondente ao lançamento");
      return;
    }
    if (!value || value <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    if (kind === "despesa" && !expenseNature) {
      toast.error("Informe se a despesa é fixa ou variável");
      return;
    }
    if (showCard && creditCardId === NONE) {
      toast.error("Selecione um cartão");
      return;
    }
    if (showAccount && accountId === NONE) {
      toast.error("Selecione uma conta");
      return;
    }
    if (showCard && (!Number.isInteger(Number(installments)) || Number(installments) < 1 || Number(installments) > 72)) {
      toast.error("Informe entre 1 e 72 parcelas");
      return;
    }
    if (recurring && showCard && Number(installments) > 1) {
      toast.error("Parcelamento e repetição automática não podem ser combinados");
      return;
    }
    if (recurring && (!recurrenceEnd || recurrenceEnd < competenceDate)) {
      toast.error("Informe uma data final da recorrência posterior à inicial");
      return;
    }
    setSaving(true);
    try {
      await createEntry(
        {
          familyId: profile.family_id,
          kind: showCard ? "cartao" : kind,
          description,
          amount: value,
          competenceDate,
          dueDate: competenceDate,
          paidDate: !showCard && status === "pago" ? competenceDate : null,
          status: showCard ? "previsto" : status,
          categoryId: categoryId === NONE ? null : categoryId,
          accountId: showAccount && accountId !== NONE ? accountId : null,
          toAccountId: null,
          creditCardId: showCard ? creditCardId : null,
          memberId: memberId === NONE ? null : memberId,
          notes: notes || null,
          expenseNature: kind === "despesa" ? expenseNature : null,
          installments: showCard && !recurring ? Number(installments) || 1 : 1,
          recurring,
          frequency,
          recurrenceEnd,
        },
        cards,
      );
      invalidate();
      toast.success(recurring ? "Recorrência criada" : "Lançamento salvo");
      onOpenChange(false);
    } catch (error) {
      toast.error("Erro ao salvar", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{thirdPartyOnly ? (kind === "receita" ? "Registrar devolução" : "Nova compra para terceiro") : "Novo lançamento"}</DialogTitle>
        </DialogHeader>

        {!thirdPartyOnly && <Tabs value={kind} onValueChange={(v) => { setKind(v as Kind); setCategoryId(NONE); }}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="despesa">Despesa</TabsTrigger>
            <TabsTrigger value="receita">Receita</TabsTrigger>
          </TabsList>
        </Tabs>}

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="desc">Descrição</Label>
              <Input
                id="desc"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Supermercado, salário, aluguel…"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="valor">Valor (R$)</Label>
              <CurrencyInput id="valor" required value={amount} onValueChange={setAmount} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="comp">{kind === "receita" ? "Data da receita" : "Data da compra"}</Label>
              <Input
                id="comp"
                type="date"
                value={competenceDate}
                onChange={(e) => setCompetenceDate(e.target.value)}
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
                <Label>Categoria</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {!thirdPartyOnly && <SelectItem value={NONE}>Sem categoria</SelectItem>}
                    {categoryOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.child ? `— ${c.label}` : c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

            {kind === "despesa" && (
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

            {variableBudgetContext && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 sm:col-span-2">
                <div className="flex items-start gap-2">
                  <WalletCards className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Orçamento variável · {variableBudgetContext.month.slice(5, 7)}/{variableBudgetContext.month.slice(0, 4)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {variableBudgetContext.category} · Planejado {brl(variableBudgetContext.planned)} · registrado {brl(variableBudgetContext.registered)}
                    </p>
                    <p className={`mt-2 text-sm font-semibold ${variableBudgetContext.remaining < 0 ? "text-destructive" : "text-primary"}`}>
                      Saldo antes da compra: {brl(variableBudgetContext.remaining)}
                    </p>
                    {amount > 0 && (
                      <p className={`mt-1 text-xs ${variableBudgetContext.after < 0 ? "text-destructive" : "text-primary"}`}>
                        Se registrar agora: {brl(variableBudgetContext.after)}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">Somente valores registrados; sem projeções.</p>
                  </div>
                </div>
              </div>
            )}

            {kind === "despesa" && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Forma de pagamento</Label>
                <Select value={paymentMethod} onValueChange={(value) => {
                  setPaymentMethod(value as "conta" | "cartao");
                  setInstallments("1");
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="conta">Conta</SelectItem>
                    <SelectItem value="cartao">Cartão</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {showCard && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Cartão</Label>
                <Select value={creditCardId} onValueChange={setCreditCardId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o cartão" />
                  </SelectTrigger>
                  <SelectContent>
                    {cards.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {showAccount && (
              <div className="space-y-2">
                <Label>Conta</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
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

            {showCard && (
              <div className="space-y-2">
                <Label htmlFor="parc">Parcelas</Label>
                <Input
                  id="parc"
                  type="number"
                  min={1}
                  max={72}
                  value={installments}
                  onChange={(e) => {
                    setInstallments(e.target.value);
                    if (Number(e.target.value) > 1) setRecurring(false);
                  }}
                />
              </div>
            )}

            {!showCard && (
              <div className="space-y-2">
                <Label>Situação</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as TransactionStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="previsto">Previsto</SelectItem>
                    <SelectItem value="pago">{statusLabel("pago", kind)}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="obs">Observação</Label>
              <Textarea
                id="obs"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {(kind === "despesa" || kind === "receita") && (
              <div className="space-y-3 rounded-lg border border-border p-3 sm:col-span-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="rec" className="cursor-pointer">
                    Repetir automaticamente
                  </Label>
                  <Switch id="rec" checked={recurring} disabled={showCard && Number(installments) > 1} onCheckedChange={(checked) => {
                    setRecurring(checked);
                    if (checked) setInstallments("1");
                  }} />
                </div>
                {showCard && Number(installments) > 1 && (
                  <p className="text-xs text-muted-foreground">Parcelamento divide uma compra em faturas; não pode ser repetido automaticamente.</p>
                )}
                {recurring && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Periodicidade</Label>
                      <Select
                        value={frequency}
                        onValueChange={(v) => setFrequency(v as RecurrenceFrequency)}
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
                      <Label htmlFor="fim">Data final</Label>
                      <Input
                        id="fim"
                        type="date"
                        min={competenceDate}
                        value={recurrenceEnd}
                        onChange={(e) => setRecurrenceEnd(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
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

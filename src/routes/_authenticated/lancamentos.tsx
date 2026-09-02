import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Check, MoreHorizontal, RotateCcw, Search, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MonthSelector } from "@/components/month-selector";
import { usePeriod } from "@/components/period-context";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui-bits";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CurrencyInput } from "@/components/currency-input";
import { brl, formatDateBR, round2, toISODate } from "@/lib/format";
import { Textarea } from "@/components/ui/textarea";
import {
  STATUS_LABEL,
  STATUS_VALUES,
  statusLabel,
  TYPE_LABEL,
  accountBalance,
  type Account,
  type Category,
  type CreditCard,
  type Transaction,
  type TransactionStatus,
  type TransactionType,
} from "@/lib/finance";
import { categoryMatches, categoryPath, inMonth, orderedCategoryOptions } from "@/lib/derive";
import {
  useAccounts,
  useCards,
  useCategories,
  useDeletedTransactions,
  useInvalidateFinance,
  useMembers,
  useTransactions,
} from "@/lib/queries";
import { deleteTransaction, ensureInvoice, restoreTransaction, setPaid } from "@/lib/transactions";

const searchSchema = z.object({
  type: z
    .enum(["todos", "receita", "despesa", "transferencia", "pagamento_fatura"])
    .default("todos"),
  status: z.enum(["todos", "aberto", ...STATUS_VALUES]).default("todos"),
  nature: z.enum(["todos", "fixo", "variavel", "nao_classificado"]).default("todos"),
});

export const Route = createFileRoute("/_authenticated/lancamentos")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Lançamentos — Finanças da Família" },
      { name: "description", content: "Receitas, despesas e transferências com filtros e busca." },
      { property: "og:title", content: "Lançamentos — Finanças da Família" },
      {
        property: "og:description",
        content: "Receitas, despesas e transferências com filtros e busca.",
      },
    ],
  }),
  component: Lancamentos,
});

const ALL = "todos";
const NONE = "__none__";

function Lancamentos() {
  const { month, year } = usePeriod();
  const { data: transactions = [] } = useTransactions();
  const { data: deletedTransactions = [] } = useDeletedTransactions();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { data: members = [] } = useMembers();
  const { data: cards = [] } = useCards();
  const invalidate = useInvalidateFinance();

  const searchParams = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(searchParams.status);
  const [nature, setNature] = useState(searchParams.nature);
  const [accountFilter, setAccountFilter] = useState(ALL);
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [memberFilter, setMemberFilter] = useState(ALL);
  const [cardFilter, setCardFilter] = useState(ALL);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [settling, setSettling] = useState<Transaction | null>(null);
  const [tab, setTab] = useState("ativos");

  const type = searchParams.type;
  function handleTypeChange(value: string) {
    void navigate({ search: (prev) => ({ ...prev, type: value as typeof type }) });
  }
  function handleStatusChange(value: string) {
    setStatus(value);
    void navigate({ search: (prev) => ({ ...prev, status: value as typeof searchParams.status }) });
  }
  function handleNatureChange(value: string) {
    setNature(value);
    void navigate({ search: (prev) => ({ ...prev, nature: value as typeof searchParams.nature }) });
  }

  const rows = useMemo(() => {
    const refDate = (t: Transaction) => t.paid_date ?? t.due_date ?? t.competence_date;
    return transactions
      .filter((t) => inMonth(refDate(t), year, month))
      .filter((t) => (type === ALL ? true : t.type === type))
      .filter((t) =>
        status === ALL
          ? true
          : status === "aberto"
            ? t.status !== "pago" && t.status !== "cancelado"
            : t.status === status,
      )
      .filter((t) =>
        nature === ALL
          ? true
          : nature === "nao_classificado"
            ? !t.expense_nature
            : t.expense_nature === nature,
      )
      .filter((t) => (accountFilter === ALL ? true : t.account_id === accountFilter))
      .filter((t) =>
        categoryFilter === ALL ? true : categoryMatches(categories, t.category_id, categoryFilter),
      )
      .filter((t) => (memberFilter === ALL ? true : t.member_id === memberFilter))
      .filter((t) => (cardFilter === ALL ? true : t.credit_card_id === cardFilter))
      .filter((t) => (search ? t.description.toLowerCase().includes(search.toLowerCase()) : true))
      .sort((a, b) => refDate(b).localeCompare(refDate(a)));
  }, [
    transactions,
    year,
    month,
    type,
    status,
    nature,
    accountFilter,
    categoryFilter,
    categories,
    memberFilter,
    cardFilter,
    search,
  ]);

  const somaRaw = rows.reduce(
    (acc, t) => {
      if (t.status !== "pago") return acc;
      if (t.type === "receita") acc.receitas += Number(t.amount);
      if (t.type === "despesa") acc.despesas += Number(t.amount);
      return acc;
    },
    { receitas: 0, despesas: 0 },
  );
  const soma = {
    receitas: round2(somaRaw.receitas),
    despesas: round2(somaRaw.despesas),
    total: round2(somaRaw.receitas - somaRaw.despesas),
  };

  async function handleTogglePaid(t: Transaction) {
    const paid = t.status === "pago";
    if (!paid && t.type === "despesa" && t.credit_card_id) {
      toast.info("Quite esta despesa pelo pagamento da fatura na tela de Cartões");
      return;
    }
    if (!paid && (t.type === "receita" || t.type === "despesa")) {
      setSettling(t);
      return;
    }
    try {
      await setPaid(t, !paid, toISODate(new Date()));
      invalidate();
      toast.success(
        paid
          ? "Quitação desfeita"
          : t.type === "receita"
            ? "Marcado como recebido"
            : "Marcado como pago",
      );
    } catch {
      toast.error("Não foi possível atualizar");
    }
  }

  async function handleDuplicate(t: Transaction) {
    const { id: _id, created_at: _c, updated_at: _u, transfer_group_id: _tg, ...rest } = t;
    const { error } = await supabase.from("transactions").insert({
      ...rest,
      status: "previsto",
      paid_date: null,
    });
    if (error) toast.error("Não foi possível duplicar");
    else {
      invalidate();
      toast.success("Lançamento duplicado");
    }
  }

  async function handleDelete(t: Transaction) {
    try {
      await deleteTransaction(t);
      invalidate();
      toast.success("Lançamento movido para Excluídos");
    } catch {
      toast.error("Não foi possível excluir");
    }
  }

  async function handleRestore(t: Transaction) {
    try {
      await restoreTransaction(t);
      invalidate();
      toast.success("Lançamento restaurado");
    } catch {
      toast.error("Não foi possível restaurar");
    }
  }

  return (
    <div>
      <PageHeader
        title="Lançamentos"
        subtitle={`${rows.length} registro(s) · Recebido ${brl(soma.receitas)} · Pago ${brl(soma.despesas)} · Total ${brl(soma.total)}`}
        actions={<MonthSelector />}
      />

      <Tabs value={tab} onValueChange={setTab} className="mb-4">
        <TabsList>
          <TabsTrigger value="ativos">Lançamentos</TabsTrigger>
          <TabsTrigger value="excluidos">Excluídos ({deletedTransactions.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "ativos" ? (
        <>
          <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
            <div className="relative sm:col-span-2 lg:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Pesquisar descrição"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={type} onValueChange={handleTypeChange}>
              <SelectTrigger>
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os tipos</SelectItem>
                {Object.entries(TYPE_LABEL).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={handleStatusChange}>
              <SelectTrigger>
                <SelectValue placeholder="Situação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as situações</SelectItem>
                <SelectItem value="aberto">Somente em aberto</SelectItem>
                {Object.entries(STATUS_LABEL).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={nature} onValueChange={handleNatureChange}>
              <SelectTrigger>
                <SelectValue placeholder="Classificação da despesa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as classificações</SelectItem>
                <SelectItem value="fixo">Fixa</SelectItem>
                <SelectItem value="variavel">Variável</SelectItem>
                <SelectItem value="nao_classificado">Não classificada</SelectItem>
              </SelectContent>
            </Select>
            <Select value={accountFilter} onValueChange={setAccountFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Conta" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as contas</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as categorias</SelectItem>
                {orderedCategoryOptions(categories).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={memberFilter} onValueChange={setMemberFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Membro" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os membros</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={cardFilter} onValueChange={setCardFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Cartão" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os cartões</SelectItem>
                {cards.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title="Nenhum lançamento no período"
              hint="Use o botão “Novo lançamento” para começar."
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-sm">
                  <thead className="bg-surface-2/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Descrição</th>
                      <th className="px-4 py-3 font-medium">Categoria</th>
                      <th className="px-4 py-3 font-medium">Conta</th>
                      <th className="px-4 py-3 font-medium">Cartão</th>
                      <th className="px-4 py-3 font-medium">Vencimento</th>
                      <th className="px-4 py-3 font-medium">Situação</th>
                      <th className="px-4 py-3 text-right font-medium">Valor</th>
                      <th className="px-4 py-3 font-medium">Quitação</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => (
                      <tr key={t.id} className="border-t border-border/60">
                        <td className="max-w-[240px] px-4 py-3">
                          <p className="truncate font-medium text-foreground">{t.description}</p>
                          <p className="text-xs text-muted-foreground">{TYPE_LABEL[t.type]}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {categoryPath(categories, t.category_id)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {accounts.find((a) => a.id === t.account_id)?.name ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {cards.find((c) => c.id === t.credit_card_id)?.name ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatDateBR(t.due_date)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={t.status} type={t.type} />
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-medium ${
                            t.type === "receita"
                              ? "text-success"
                              : t.type === "despesa"
                                ? "text-destructive"
                                : "text-foreground"
                          }`}
                        >
                          {brl(Number(t.amount))}
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            size="sm"
                            variant={t.status === "pago" ? "secondary" : "outline"}
                            className="gap-1"
                            onClick={() => handleTogglePaid(t)}
                          >
                            {t.status === "pago" ? (
                              <Undo2 className="h-3.5 w-3.5" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                            {t.status === "pago"
                              ? "Desfazer"
                              : t.type === "receita"
                                ? "Recebido"
                                : "Pago"}
                          </Button>
                        </td>
                        <td className="px-2 py-3">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label="Ações">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setEditing(t)}>
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDuplicate(t)}>
                                Duplicar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => handleDelete(t)}
                              >
                                Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-surface-2/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr className="border-t border-border">
                      <td className="px-4 py-3 font-medium" colSpan={6}>
                        {rows.length} lançamento{rows.length === 1 ? "" : "s"}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-semibold ${
                          soma.receitas - soma.despesas >= 0 ? "text-success" : "text-destructive"
                        }`}
                      >
                        {brl(soma.receitas - soma.despesas)}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        <DeletedTransactionsTable
          rows={deletedTransactions}
          categories={categories}
          accounts={accounts}
          cards={cards}
          onRestore={handleRestore}
        />
      )}

      <EditDialog
        transaction={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          invalidate();
        }}
      />
      <SettlementDialog
        transaction={settling}
        accounts={accounts}
        transactions={transactions}
        onClose={() => setSettling(null)}
        onConfirmed={() => {
          setSettling(null);
          invalidate();
        }}
      />
    </div>
  );
}

function SettlementDialog({
  transaction,
  accounts,
  transactions,
  onClose,
  onConfirmed,
}: {
  transaction: Transaction | null;
  accounts: Account[];
  transactions: Transaction[];
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const activeAccounts = accounts.filter((account) => account.is_active);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(NONE);
  const [paidDate, setPaidDate] = useState(toISODate(new Date()));
  const [saving, setSaving] = useState(false);

  const transactionId = transaction?.id ?? null;
  if (transactionId !== loadedId) {
    setLoadedId(transactionId);
    setAccountId(
      transaction?.account_id ?? activeAccounts.find((account) => account.is_active)?.id ?? NONE,
    );
    setPaidDate(toISODate(new Date()));
  }

  const selectedAccount = activeAccounts.find((account) => account.id === accountId);
  const availableBalance = selectedAccount ? accountBalance(selectedAccount, transactions) : 0;
  const requiresBalance = transaction?.type === "despesa";

  async function confirm() {
    if (!transaction) return;
    if (accountId === NONE || !selectedAccount) {
      toast.error("Selecione a conta da quitação");
      return;
    }
    if (!paidDate) {
      toast.error("Informe a data da quitação");
      return;
    }
    if (requiresBalance && availableBalance < Number(transaction.amount)) {
      toast.error("Saldo insuficiente na conta selecionada", {
        description: `Disponível: ${brl(availableBalance)} · Necessário: ${brl(Number(transaction.amount))}`,
      });
      return;
    }

    setSaving(true);
    try {
      await setPaid(transaction, true, paidDate, accountId);
      toast.success(
        transaction.type === "receita" ? "Recebimento confirmado" : "Pagamento confirmado",
      );
      onConfirmed();
    } catch {
      toast.error("Não foi possível confirmar a quitação");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!transaction} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Confirmar {transaction?.type === "receita" ? "recebimento" : "pagamento"}
          </DialogTitle>
        </DialogHeader>
        {transaction && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="font-medium text-foreground">{transaction.description}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {brl(Number(transaction.amount))}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Conta</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a conta" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Selecione a conta</SelectItem>
                  {activeAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name} · {brl(accountBalance(account, transactions))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedAccount && (
                <p
                  className={`text-xs ${
                    requiresBalance && availableBalance < Number(transaction.amount)
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }`}
                >
                  Saldo disponível: {brl(availableBalance)}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="settlement-date">
                Data de {transaction.type === "receita" ? "recebimento" : "pagamento"}
              </Label>
              <Input
                id="settlement-date"
                type="date"
                required
                value={paidDate}
                onChange={(event) => setPaidDate(event.target.value)}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={confirm}
            disabled={
              saving ||
              accountId === NONE ||
              !paidDate ||
              (requiresBalance && availableBalance < Number(transaction?.amount ?? 0))
            }
          >
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeletedTransactionsTable({
  rows,
  categories,
  accounts,
  cards,
  onRestore,
}: {
  rows: Transaction[];
  categories: Category[];
  accounts: Account[];
  cards: CreditCard[];
  onRestore: (transaction: Transaction) => void;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nenhum lançamento excluído"
        hint="Os lançamentos removidos aparecerão aqui e poderão ser restaurados."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-surface-2/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Descrição</th>
              <th className="px-4 py-3 font-medium">Categoria</th>
              <th className="px-4 py-3 font-medium">Conta/Cartão</th>
              <th className="px-4 py-3 font-medium">Vencimento</th>
              <th className="px-4 py-3 font-medium">Excluído em</th>
              <th className="px-4 py-3 text-right font-medium">Valor</th>
              <th className="px-4 py-3 text-right font-medium">Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((transaction) => (
              <tr key={transaction.id} className="border-t border-border/60">
                <td className="max-w-[260px] px-4 py-3">
                  <p className="truncate font-medium text-foreground">{transaction.description}</p>
                  <p className="text-xs text-muted-foreground">{TYPE_LABEL[transaction.type]}</p>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {categoryPath(categories ?? [], transaction.category_id)}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {accounts?.find((item) => item.id === transaction.account_id)?.name ??
                    cards?.find((item) => item.id === transaction.credit_card_id)?.name ??
                    "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {formatDateBR(transaction.due_date)}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {transaction.deleted_at
                    ? new Date(transaction.deleted_at).toLocaleString("pt-BR")
                    : "—"}
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  {brl(Number(transaction.amount))}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => onRestore(transaction)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Restaurar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditDialog({
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

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!transaction) return;
    const value = amount;
    if (!value || value <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    setSaving(true);
    let targetInvoiceId: string | null = null;
    let targetDueDate = dueDate || null;
    const targetCardId = cardId === NONE ? null : cardId;
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
    setSaving(false);
    if (error) toast.error("Não foi possível salvar");
    else {
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
      toast.success("Lançamento atualizado");
      onSaved();
    }
  }

  return (
    <Dialog open={!!transaction} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar lançamento</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
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
              <CurrencyInput id="ev" value={amount} onValueChange={setAmount} />
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
              <Select value={accountId} onValueChange={setAccountId}>
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

            <div className="space-y-2">
              <Label>Cartão</Label>
              <Select value={cardId} onValueChange={setCardId}>
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
          </div>

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

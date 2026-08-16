import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Check, MoreHorizontal, Search, Undo2 } from "lucide-react";
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
import { CurrencyInput } from "@/components/currency-input";
import { brl, formatDateBR, toISODate } from "@/lib/format";
import { Textarea } from "@/components/ui/textarea";
import {
  STATUS_LABEL,
  STATUS_VALUES,
  statusLabel,
  TYPE_LABEL,
  type Transaction,
  type TransactionStatus,
  type TransactionType,
} from "@/lib/finance";
import { categoryPath, inMonth } from "@/lib/derive";
import {
  useAccounts,
  useCards,
  useCategories,
  useInvalidateFinance,
  useMembers,
  useTransactions,
} from "@/lib/queries";
import { deleteTransaction, setPaid } from "@/lib/transactions";

const searchSchema = z.object({
  type: z.enum(["todos", "receita", "despesa", "transferencia", "pagamento_fatura"]).default("todos"),
});

export const Route = createFileRoute("/_authenticated/lancamentos")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Lançamentos — Finanças da Família" },
      { name: "description", content: "Receitas, despesas e transferências com filtros e busca." },
      { property: "og:title", content: "Lançamentos — Finanças da Família" },
      { property: "og:description", content: "Receitas, despesas e transferências com filtros e busca." },
    ],
  }),
  component: Lancamentos,
});

const ALL = "todos";
const NONE = "__none__";

function Lancamentos() {
  const { month, year } = usePeriod();
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { data: members = [] } = useMembers();
  const { data: cards = [] } = useCards();
  const invalidate = useInvalidateFinance();

  const searchParams = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [accountFilter, setAccountFilter] = useState(ALL);
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [memberFilter, setMemberFilter] = useState(ALL);
  const [cardFilter, setCardFilter] = useState(ALL);
  const [editing, setEditing] = useState<Transaction | null>(null);

  const type = searchParams.type;
  function handleTypeChange(value: string) {
    void navigate({ search: { type: value } });
  }

  const rows = useMemo(() => {
    const refDate = (t: Transaction) => t.paid_date ?? t.due_date ?? t.competence_date;
    return transactions
      .filter((t) => inMonth(refDate(t), year, month))
      .filter((t) => (type === ALL ? true : t.type === type))
      .filter((t) => (status === ALL ? true : t.status === status))
      .filter((t) => (accountFilter === ALL ? true : t.account_id === accountFilter))
      .filter((t) => (categoryFilter === ALL ? true : t.category_id === categoryFilter))
      .filter((t) => (memberFilter === ALL ? true : t.member_id === memberFilter))
      .filter((t) => (cardFilter === ALL ? true : t.credit_card_id === cardFilter))
      .filter((t) =>
        search ? t.description.toLowerCase().includes(search.toLowerCase()) : true,
      )
      .sort((a, b) => refDate(b).localeCompare(refDate(a)));
  }, [transactions, year, month, type, status, accountFilter, categoryFilter, memberFilter, cardFilter, search]);

  const soma = rows.reduce(
    (acc, t) => {
      if (t.type === "receita") acc.receitas += Number(t.amount);
      if (t.type === "despesa") acc.despesas += Number(t.amount);
      return acc;
    },
    { receitas: 0, despesas: 0 },
  );

  async function handleTogglePaid(t: Transaction) {
    const paid = t.status === "pago";
    try {
      await setPaid(t.id, !paid, toISODate(new Date()));
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
    const {
      id: _id,
      created_at: _c,
      updated_at: _u,
      transfer_group_id: _tg,
      ...rest
    } = t;
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
      toast.success("Lançamento excluído");
    } catch {
      toast.error("Não foi possível excluir");
    }
  }

  return (
    <div>
      <PageHeader
        title="Lançamentos"
        subtitle={`${rows.length} registro(s) · Receitas ${brl(soma.receitas)} · Despesas ${brl(soma.despesas)}`}
        actions={<MonthSelector />}
      />

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
        <Select value={type} onValueChange={setType}>
          <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os tipos</SelectItem>
            {Object.entries(TYPE_LABEL).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger><SelectValue placeholder="Situação" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as situações</SelectItem>
            {Object.entries(STATUS_LABEL).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={accountFilter} onValueChange={setAccountFilter}>
          <SelectTrigger><SelectValue placeholder="Conta" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as contas</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger><SelectValue placeholder="Categoria" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as categorias</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>{categoryPath(categories, c.id)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={memberFilter} onValueChange={setMemberFilter}>
          <SelectTrigger><SelectValue placeholder="Membro" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os membros</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={cardFilter} onValueChange={setCardFilter}>
          <SelectTrigger><SelectValue placeholder="Cartão" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os cartões</SelectItem>
            {cards.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nenhum lançamento no período" hint="Use o botão “Novo lançamento” para começar." />
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
                    <td className="px-4 py-3 text-muted-foreground">{formatDateBR(t.due_date)}</td>
                    <td className="px-4 py-3"><StatusBadge status={t.status} type={t.type} /></td>
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
                          <DropdownMenuItem onClick={() => setEditing(t)}>Editar</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDuplicate(t)}>Duplicar</DropdownMenuItem>
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
            </table>
          </div>
        </div>
      )}

      <EditDialog
        transaction={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          invalidate();
        }}
      />
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
    const { error } = await supabase
      .from("transactions")
      .update({
        type,
        description,
        amount: value,
        competence_date: competenceDate,
        due_date: dueDate || null,
        paid_date: status === "pago" ? paidDate || dueDate || competenceDate : null,
        status,
        category_id: isTransfer || categoryId === NONE ? null : categoryId,
        account_id: accountId === NONE ? null : accountId,
        credit_card_id: cardId === NONE ? null : cardId,
        member_id: memberId === NONE ? null : memberId,
        notes: notes || null,
      })
      .eq("id", transaction.id);
    setSaving(false);
    if (error) toast.error("Não foi possível salvar");
    else {
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
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
              <Input id="evenc" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>

            {!isTransfer && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Categoria</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
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

            <div className="space-y-2">
              <Label>Conta</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem conta</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Cartão</Label>
              <Select value={cardId} onValueChange={setCardId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem cartão</SelectItem>
                  {cards.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Membro</Label>
              <Select value={memberId} onValueChange={setMemberId}>
                <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem membro</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Situação</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TransactionStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_VALUES.map((s) => (
                    <SelectItem key={s} value={s}>{statusLabel(s, type)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {status === "pago" && (
              <div className="space-y-2">
                <Label htmlFor="epg">
                  {type === "receita" ? "Data do recebimento" : "Data do pagamento"}
                </Label>
                <Input id="epg" type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
              </div>
            )}

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="eobs">Observação</Label>
              <Textarea id="eobs" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MoreHorizontal, Search } from "lucide-react";
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
import { brl, formatDateBR, toISODate } from "@/lib/format";
import { STATUS_LABEL, TYPE_LABEL, type Transaction, type TransactionStatus } from "@/lib/finance";
import { categoryPath, inMonth } from "@/lib/derive";
import {
  useAccounts,
  useCategories,
  useInvalidateFinance,
  useMembers,
  useTransactions,
} from "@/lib/queries";
import { deleteTransaction, markAsPaid } from "@/lib/transactions";

export const Route = createFileRoute("/_authenticated/lancamentos")({
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

function Lancamentos() {
  const { month, year } = usePeriod();
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { data: members = [] } = useMembers();
  const invalidate = useInvalidateFinance();

  const [search, setSearch] = useState("");
  const [type, setType] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [accountFilter, setAccountFilter] = useState(ALL);
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [memberFilter, setMemberFilter] = useState(ALL);
  const [editing, setEditing] = useState<Transaction | null>(null);

  const rows = useMemo(() => {
    return transactions
      .filter((t) => inMonth(t.competence_date, year, month))
      .filter((t) => (type === ALL ? true : t.type === type))
      .filter((t) => (status === ALL ? true : t.status === status))
      .filter((t) => (accountFilter === ALL ? true : t.account_id === accountFilter))
      .filter((t) => (categoryFilter === ALL ? true : t.category_id === categoryFilter))
      .filter((t) => (memberFilter === ALL ? true : t.member_id === memberFilter))
      .filter((t) =>
        search ? t.description.toLowerCase().includes(search.toLowerCase()) : true,
      )
      .sort((a, b) => b.competence_date.localeCompare(a.competence_date));
  }, [transactions, year, month, type, status, accountFilter, categoryFilter, memberFilter, search]);

  const soma = rows.reduce(
    (acc, t) => {
      if (t.type === "receita") acc.receitas += Number(t.amount);
      if (t.type === "despesa") acc.despesas += Number(t.amount);
      return acc;
    },
    { receitas: 0, despesas: 0 },
  );

  async function handlePay(t: Transaction) {
    try {
      await markAsPaid(t.id, toISODate(new Date()));
      invalidate();
      toast.success("Lançamento quitado");
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
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nenhum lançamento no período" hint="Use o botão “Novo lançamento” para começar." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-surface-2/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Descrição</th>
                  <th className="px-4 py-3 font-medium">Categoria</th>
                  <th className="px-4 py-3 font-medium">Conta</th>
                  <th className="px-4 py-3 font-medium">Vencimento</th>
                  <th className="px-4 py-3 font-medium">Situação</th>
                  <th className="px-4 py-3 text-right font-medium">Valor</th>
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
                    <td className="px-4 py-3 text-muted-foreground">{formatDateBR(t.due_date)}</td>
                    <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
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
                    <td className="px-2 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Ações">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(t)}>Editar</DropdownMenuItem>
                          {t.status !== "pago" && (
                            <DropdownMenuItem onClick={() => handlePay(t)}>
                              Marcar como pago
                            </DropdownMenuItem>
                          )}
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
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [paidDate, setPaidDate] = useState("");
  const [status, setStatus] = useState<TransactionStatus>("pendente");
  const [loadedId, setLoadedId] = useState<string | null>(null);

  if (transaction && transaction.id !== loadedId) {
    setLoadedId(transaction.id);
    setDescription(transaction.description);
    setAmount(String(transaction.amount));
    setDueDate(transaction.due_date ?? "");
    setPaidDate(transaction.paid_date ?? "");
    setStatus(transaction.status);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!transaction) return;
    const { error } = await supabase
      .from("transactions")
      .update({
        description,
        amount: Number(amount.replace(",", ".")),
        due_date: dueDate || null,
        paid_date: status === "pago" ? paidDate || dueDate || null : null,
        status,
      })
      .eq("id", transaction.id);
    if (error) toast.error("Não foi possível salvar");
    else {
      toast.success("Lançamento atualizado");
      onSaved();
    }
  }

  return (
    <Dialog open={!!transaction} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar lançamento</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ed">Descrição</Label>
            <Input id="ed" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ev">Valor</Label>
              <Input id="ev" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="evenc">Vencimento</Label>
              <Input id="evenc" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Situação</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TransactionStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABEL).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {status === "pago" && (
              <div className="space-y-2">
                <Label htmlFor="epg">Pagamento</Label>
                <Input id="epg" type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit">Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
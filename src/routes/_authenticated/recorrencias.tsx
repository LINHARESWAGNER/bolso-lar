import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageHeader } from "@/components/ui-bits";
import { CurrencyInput } from "@/components/currency-input";
import { brl, formatDateBR, shortMonth, toISODate } from "@/lib/format";
import { FREQUENCY_LABEL, type RecurrenceFrequency } from "@/lib/finance";
import { categoryPath } from "@/lib/derive";
import {
  useAccounts,
  useCards,
  useCategories,
  useInvalidateFinance,
  useMembers,
  useProfile,
  useRecurrences,
  useTransactions,
} from "@/lib/queries";
import { saveRecurrence } from "@/lib/transactions";
import type { Database } from "@/integrations/supabase/types";

type Recurrence = Database["public"]["Tables"]["recurring_transactions"]["Row"];

export const Route = createFileRoute("/_authenticated/recorrencias")({
  head: () => ({
    meta: [
      { title: "Recorrências — Finanças da Família" },
      {
        name: "description",
        content: "Cadastre e edite receitas e despesas recorrentes com data inicial e final.",
      },
      { property: "og:title", content: "Recorrências — Finanças da Família" },
      {
        property: "og:description",
        content: "Cadastre e edite receitas e despesas recorrentes com data inicial e final.",
      },
    ],
  }),
  component: Recorrencias,
});

const NONE = "__none__";
const ALL = "__all__";

function Recorrencias() {
  const { data: recurrences = [] } = useRecurrences();
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const invalidate = useInvalidateFinance();
  const [editing, setEditing] = useState<Recurrence | null>(null);
  const [creating, setCreating] = useState(false);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);

  const yearOptions = useMemo(() => {
    const years = new Set<number>([currentYear]);
    for (const recurrence of recurrences) {
      years.add(Number(recurrence.start_date.slice(0, 4)));
      if (recurrence.end_date) years.add(Number(recurrence.end_date.slice(0, 4)));
    }
    for (const transaction of transactions) {
      if (transaction.recurring_id) years.add(Number(transaction.competence_date.slice(0, 4)));
    }
    return [...years].filter(Number.isFinite).sort((a, b) => b - a);
  }, [recurrences, transactions, currentYear]);

  const filteredRecurrences = useMemo(() => {
    const startsBeforeYearEnds = (r: Recurrence) => r.start_date <= `${year}-12-31`;
    const endsAfterYearStarts = (r: Recurrence) => !r.end_date || r.end_date >= `${year}-01-01`;
    return recurrences.filter((r) => {
      if (!startsBeforeYearEnds(r) || !endsAfterYearStarts(r)) return false;
      if (typeFilter !== ALL && r.type !== typeFilter) return false;
      if (categoryFilter !== ALL && (r.category_id ?? NONE) !== categoryFilter) return false;
      if (statusFilter === "ativas" && !r.is_active) return false;
      if (statusFilter === "inativas" && r.is_active) return false;
      return true;
    });
  }, [recurrences, year, typeFilter, categoryFilter, statusFilter]);

  const filteredIds = useMemo(
    () => new Set(filteredRecurrences.map((recurrence) => recurrence.id)),
    [filteredRecurrences],
  );

  const recurringRows = useMemo(
    () =>
      transactions.filter(
        (transaction) =>
          transaction.recurring_id &&
          filteredIds.has(transaction.recurring_id) &&
          transaction.status !== "cancelado" &&
          transaction.competence_date.startsWith(`${year}-`),
      ),
    [transactions, filteredIds, year],
  );

  const monthlyChart = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => {
        const month = String(index + 1).padStart(2, "0");
        const rows = recurringRows.filter((row) =>
          row.competence_date.startsWith(`${year}-${month}`),
        );
        return {
          name: shortMonth(index + 1),
          receitas: rows
            .filter((row) => row.type === "receita")
            .reduce((sum, row) => sum + Number(row.amount), 0),
          despesas: rows
            .filter((row) => row.type === "despesa")
            .reduce((sum, row) => sum + Number(row.amount), 0),
        };
      }),
    [recurringRows, year],
  );

  const categoryChart = useMemo(() => {
    const grouped = new Map<string, { name: string; receitas: number; despesas: number }>();
    for (const row of recurringRows) {
      const name = categoryPath(categories, row.category_id);
      const item = grouped.get(name) ?? { name, receitas: 0, despesas: 0 };
      if (row.type === "receita") item.receitas += Number(row.amount);
      if (row.type === "despesa") item.despesas += Number(row.amount);
      grouped.set(name, item);
    }
    return [...grouped.values()].sort(
      (a, b) => b.receitas + b.despesas - (a.receitas + a.despesas),
    );
  }, [recurringRows, categories]);

  async function toggle(id: string, isActive: boolean) {
    await supabase.from("recurring_transactions").update({ is_active: isActive }).eq("id", id);
    invalidate();
  }

  async function remove(r: Recurrence) {
    const { error: txError } = await supabase
      .from("transactions")
      .delete()
      .eq("recurring_id", r.id)
      .neq("status", "pago");
    if (txError) {
      toast.error("Não foi possível excluir os lançamentos futuros");
      return;
    }
    const { error } = await supabase.from("recurring_transactions").delete().eq("id", r.id);
    if (error) toast.error("Não foi possível excluir");
    else {
      invalidate();
      toast.success("Recorrência excluída");
    }
  }

  return (
    <div>
      <PageHeader
        title="Recorrências"
        subtitle="Lançamentos que se repetem entre uma data inicial e uma data final"
        actions={
          <Button onClick={() => setCreating(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Nova recorrência
          </Button>
        }
      />

      <section className="mb-5 rounded-xl border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TopFilter
            label="Ano"
            value={year}
            setValue={setYear}
            items={yearOptions.map((item) => [String(item), String(item)])}
          />
          <TopFilter
            label="Tipo"
            value={typeFilter}
            setValue={setTypeFilter}
            items={[
              [ALL, "Receitas e despesas"],
              ["receita", "Receitas"],
              ["despesa", "Despesas"],
            ]}
          />
          <TopFilter
            label="Categoria"
            value={categoryFilter}
            setValue={setCategoryFilter}
            items={[
              [ALL, "Todas as categorias"],
              [NONE, "Sem categoria"],
              ...categories.map((category) => [category.id, categoryPath(categories, category.id)]),
            ]}
          />
          <TopFilter
            label="Situação"
            value={statusFilter}
            setValue={setStatusFilter}
            items={[
              [ALL, "Ativas e inativas"],
              ["ativas", "Ativas"],
              ["inativas", "Inativas"],
            ]}
          />
        </div>
      </section>

      <section className="mb-5 grid gap-4 xl:grid-cols-2">
        <RecurrenceChart title={`Recorrências por mês — ${year}`} data={monthlyChart} />
        <RecurrenceChart
          title={`Recorrências por categoria — ${year}`}
          data={categoryChart}
          layout="vertical"
        />
      </section>

      {recurrences.length === 0 ? (
        <EmptyState
          title="Nenhuma recorrência cadastrada"
          hint="Crie uma recorrência para gerar automaticamente os lançamentos do período."
        />
      ) : filteredRecurrences.length === 0 ? (
        <EmptyState
          title="Nenhuma recorrência encontrada"
          hint="Altere os filtros para consultar outras recorrências."
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {filteredRecurrences.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{r.description}</p>
                <p className="text-xs text-muted-foreground">
                  {r.type === "receita" ? "Receita" : "Despesa"} · {FREQUENCY_LABEL[r.frequency]} ·{" "}
                  {formatDateBR(r.start_date)} até{" "}
                  {r.end_date ? formatDateBR(r.end_date) : "sem fim"} ·{" "}
                  {categoryPath(categories, r.category_id)}
                </p>
              </div>
              <span className="shrink-0 text-sm font-medium text-foreground">
                {brl(Number(r.amount))}
              </span>
              <Switch checked={r.is_active} onCheckedChange={(v) => toggle(r.id, v)} />
              <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => setEditing(r)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => remove(r)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <RecurrenceDialog
        open={creating || !!editing}
        recurrence={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function TopFilter({
  label,
  value,
  setValue,
  items,
}: {
  label: string;
  value: string;
  setValue: (value: string) => void;
  items: string[][];
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map(([itemValue, itemLabel]) => (
            <SelectItem key={itemValue} value={itemValue}>
              {itemLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function RecurrenceChart({
  title,
  data,
  layout = "horizontal",
}: {
  title: string;
  data: { name: string; receitas: number; despesas: number }[];
  layout?: "horizontal" | "vertical";
}) {
  const vertical = layout === "vertical";
  const height = vertical ? Math.max(320, data.length * 44) : 320;
  const hasData = data.some((item) => item.receitas > 0 || item.despesas > 0);

  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      {!hasData ? (
        <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
          Nenhum lançamento recorrente no período selecionado.
        </div>
      ) : (
        <div className={vertical ? "mt-4 max-h-[520px] overflow-y-auto" : "mt-4"}>
          <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                layout={layout}
                margin={vertical ? { left: 20, right: 24 } : { bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                {vertical ? (
                  <>
                    <XAxis type="number" tickFormatter={(value) => brl(Number(value))} />
                    <YAxis type="category" dataKey="name" width={190} tick={{ fontSize: 12 }} />
                  </>
                ) : (
                  <>
                    <XAxis dataKey="name" />
                    <YAxis tickFormatter={(value) => brl(Number(value))} width={100} />
                  </>
                )}
                <Tooltip formatter={(value) => brl(Number(value))} />
                <Legend />
                <Bar
                  dataKey="receitas"
                  name="Receitas"
                  fill="var(--color-success, #22c55e)"
                  radius={4}
                />
                <Bar
                  dataKey="despesas"
                  name="Despesas"
                  fill="var(--color-destructive, #ef4444)"
                  radius={4}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </article>
  );
}

function RecurrenceDialog({
  open,
  recurrence,
  onClose,
}: {
  open: boolean;
  recurrence: Recurrence | null;
  onClose: () => void;
}) {
  const { data: profile } = useProfile();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { data: members = [] } = useMembers();
  const { data: cards = [] } = useCards();
  const invalidate = useInvalidateFinance();

  const today = toISODate(new Date());
  const defaultEnd = toISODate(new Date(new Date().getFullYear(), 11, 31));

  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [type, setType] = useState<"receita" | "despesa">("despesa");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(0);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("mensal");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [dueDate, setDueDate] = useState(today);
  const [categoryId, setCategoryId] = useState(NONE);
  const [accountId, setAccountId] = useState(NONE);
  const [cardId, setCardId] = useState(NONE);
  const [memberId, setMemberId] = useState(NONE);
  const [notes, setNotes] = useState("");
  const [expenseNature, setExpenseNature] = useState<"fixo" | "variavel">("fixo");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const key = open ? (recurrence?.id ?? "new") : null;
  if (key !== loadedKey) {
    setLoadedKey(key);
    if (recurrence) {
      setType(recurrence.type === "receita" ? "receita" : "despesa");
      setDescription(recurrence.description);
      setAmount(Number(recurrence.amount));
      setFrequency(recurrence.frequency);
      setStartDate(recurrence.start_date);
      setEndDate(recurrence.end_date ?? defaultEnd);
      setDueDate(recurrence.start_date);
      setCategoryId(recurrence.category_id ?? NONE);
      setAccountId(recurrence.account_id ?? NONE);
      setCardId(recurrence.credit_card_id ?? NONE);
      setMemberId(recurrence.member_id ?? NONE);
      setNotes(recurrence.notes ?? "");
      setExpenseNature(recurrence.expense_nature ?? "fixo");
      setIsActive(recurrence.is_active);
    } else if (open) {
      setType("despesa");
      setExpenseNature("fixo");
      setDescription("");
      setAmount(0);
      setFrequency("mensal");
      setStartDate(today);
      setEndDate(defaultEnd);
      setDueDate(today);
      setCategoryId(NONE);
      setAccountId(NONE);
      setCardId(NONE);
      setMemberId(NONE);
      setNotes("");
      setIsActive(true);
    }
  }

  const categoryOptions = useMemo(() => {
    const parents = categories.filter((c) => c.kind === type && !c.parent_id);
    return parents.flatMap((p) => [
      { id: p.id, label: p.name, child: false },
      ...categories
        .filter((c) => c.parent_id === p.id)
        .map((c) => ({ id: c.id, label: c.name, child: true })),
    ]);
  }, [categories, type]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile?.family_id) return;
    const value = amount;
    if (!value || value <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    if (endDate < startDate) {
      toast.error("A data final deve ser posterior à data inicial");
      return;
    }
    const usesCard = type === "despesa" && cardId !== NONE;
    if (type === "despesa") {
      if (accountId === NONE && cardId === NONE) {
        toast.error("Selecione uma conta ou um cartão");
        return;
      }
      if (accountId !== NONE && cardId !== NONE) {
        toast.error("Escolha apenas conta OU cartão");
        return;
      }
      if (!usesCard && !dueDate) {
        toast.error("Informe a data de vencimento");
        return;
      }
    }
    setSaving(true);
    try {
      await saveRecurrence({
        familyId: profile.family_id,
        id: recurrence?.id,
        description,
        type,
        amount: value,
        categoryId: categoryId === NONE ? null : categoryId,
        accountId: usesCard || accountId === NONE ? null : accountId,
        creditCardId: type === "receita" || cardId === NONE ? null : cardId,
        memberId: memberId === NONE ? null : memberId,
        frequency,
        startDate,
        endDate,
        dayOfMonth: usesCard ? null : Number(dueDate.slice(8, 10)) || null,
        dueBaseDate: usesCard ? null : dueDate,
        notes: notes || null,
        expenseNature: type === "despesa" ? expenseNature : null,
        isActive,
      });
      invalidate();
      toast.success(recurrence ? "Recorrência atualizada" : "Recorrência criada");
      onClose();
    } catch (error) {
      toast.error("Erro ao salvar", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{recurrence ? "Editar recorrência" : "Nova recorrência"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="rd">Descrição</Label>
              <Input
                id="rd"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Aluguel, salário, mensalidade…"
              />
            </div>

            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={type} onValueChange={(v) => setType(v as "receita" | "despesa")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="despesa">Despesa</SelectItem>
                  <SelectItem value="receita">Receita</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {type === "despesa" && (
              <div className="space-y-2">
                <Label>Classificação</Label>
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
              <Label htmlFor="rv">Valor (R$)</Label>
              <CurrencyInput id="rv" required value={amount} onValueChange={setAmount} />
            </div>

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

            {!(type === "despesa" && cardId !== NONE) && (
              <div className="space-y-2">
                <Label htmlFor="rdia">
                  {type === "receita" ? "Data de recebimento" : "Data de vencimento"}
                </Label>
                <Input
                  id="rdia"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="rini">Data inicial</Label>
              <Input
                id="rini"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="rfim">Data final</Label>
              <Input
                id="rfim"
                type="date"
                min={startDate}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>

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

            <div className="space-y-2">
              <Label>Conta</Label>
              <Select
                value={accountId}
                onValueChange={(v) => {
                  setAccountId(v);
                  if (v !== NONE) setCardId(NONE);
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
                  onValueChange={(v) => {
                    setCardId(v);
                    if (v !== NONE) setAccountId(NONE);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Opcional" />
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
                <p className="text-xs text-muted-foreground">
                  Despesa recorrente: informe conta <strong>ou</strong> cartão. No cartão, cada
                  ocorrência entra na fatura conforme o fechamento.
                </p>
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

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <Label htmlFor="rat" className="cursor-pointer">
                Ativa
              </Label>
              <Switch id="rat" checked={isActive} onCheckedChange={setIsActive} />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="robs">Observação</Label>
              <Textarea
                id="robs"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Ao salvar, os lançamentos futuros ainda não quitados desta recorrência são regerados
            entre a data inicial e a data final.
          </p>

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

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { History, Pencil, Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui-bits";
import { CurrencyInput } from "@/components/currency-input";
import { brl, formatDateBR } from "@/lib/format";
import { categoryPath } from "@/lib/derive";

import {
  useCards,
  useCategories,
  useInstallmentGroups,
  useInvalidateFinance,
  useMembers,
  useProfile,
  useTransactions,
} from "@/lib/queries";
import { deleteInstallmentGroup, updateInstallmentGroup } from "@/lib/transactions";
import type { Tables } from "@/lib/finance";

type Group = Tables["installment_groups"]["Row"];

export const Route = createFileRoute("/_authenticated/parcelados")({
  head: () => ({
    meta: [
      { title: "Compras parceladas — Finanças da Família" },
      {
        name: "description",
        content: "Acompanhe, edite e exclua compras parceladas no cartão de crédito.",
      },
      { property: "og:title", content: "Compras parceladas — Finanças da Família" },
      {
        property: "og:description",
        content: "Acompanhe, edite e exclua compras parceladas no cartão de crédito.",
      },
    ],
  }),
  component: Parcelados,
});

const NONE = "__none__";

function Parcelados() {
  const { data: groups = [] } = useInstallmentGroups();
  const { data: transactions = [] } = useTransactions();
  const { data: cards = [] } = useCards();
  const { data: categories = [] } = useCategories();
  const invalidate = useInvalidateFinance();
  const [editing, setEditing] = useState<Group | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const cardGroups = groups.filter((g) => g.credit_card_id);

  const parcelsByGroup = useMemo(() => {
    const grouped = new Map<string, typeof transactions>();
    for (const transaction of transactions) {
      if (!transaction.installment_group_id) continue;
      const current = grouped.get(transaction.installment_group_id) ?? [];
      current.push(transaction);
      grouped.set(transaction.installment_group_id, current);
    }
    return grouped;
  }, [transactions]);

  const activeGroups = cardGroups.filter((group) =>
    (parcelsByGroup.get(group.id) ?? []).some(
      (parcel) => parcel.status !== "pago" && parcel.status !== "cancelado",
    ),
  );
  const historicalGroups = cardGroups.filter(
    (group) =>
      (parcelsByGroup.get(group.id) ?? []).length > 0 &&
      !(parcelsByGroup.get(group.id) ?? []).some(
        (parcel) => parcel.status !== "pago" && parcel.status !== "cancelado",
      ),
  );
  const visibleGroups = showHistory ? historicalGroups : activeGroups;

  const chartTransactions = useMemo(() => {
    const ids = new Set(cardGroups.map((group) => group.id));
    return transactions.filter(
      (transaction) =>
        transaction.installment_group_id &&
        ids.has(transaction.installment_group_id) &&
        transaction.status !== "cancelado",
    );
  }, [cardGroups, transactions]);

  const byCategory = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const transaction of chartTransactions) {
      const name = categoryPath(categories, transaction.category_id);
      grouped.set(name, (grouped.get(name) ?? 0) + Number(transaction.amount));
    }
    return [...grouped].map(([name, valor]) => ({ name, valor })).sort((a, b) => b.valor - a.valor);
  }, [categories, chartTransactions]);

  const byMonth = useMemo(() => {
    const grouped = new Map<string, { month: string; pago: number; aberto: number }>();
    for (const transaction of chartTransactions) {
      const key = transaction.due_date.slice(0, 7);
      const [year, month] = key.split("-");
      const current = grouped.get(key) ?? {
        month: `${month}/${year.slice(2)}`,
        pago: 0,
        aberto: 0,
      };
      if (transaction.status === "pago") current.pago += Number(transaction.amount);
      else current.aberto += Number(transaction.amount);
      grouped.set(key, current);
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, values]) => values);
  }, [chartTransactions]);

  const totals = useMemo(() => {
    const ids = new Set(cardGroups.map((g) => g.id));
    let restante = 0;
    let pago = 0;
    for (const t of transactions) {
      if (!t.installment_group_id || !ids.has(t.installment_group_id)) continue;
      if (t.status === "cancelado") continue;
      if (t.status === "pago") pago += Number(t.amount);
      else restante += Number(t.amount);
    }
    return { restante, pago };
  }, [cardGroups, transactions]);

  async function remove(g: Group) {
    try {
      await deleteInstallmentGroup(g.id);
      invalidate();
      toast.success("Parcelamento excluído com todas as parcelas");
    } catch {
      toast.error("Não foi possível excluir");
    }
  }

  return (
    <div>
      <PageHeader
        title="Compras parceladas"
        subtitle="Parcelamentos no cartão — editar ou excluir afeta todas as parcelas"
      />

      {cardGroups.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Falta pagar</p>
            <p className="mt-1 text-2xl font-semibold text-destructive">{brl(totals.restante)}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Já pago</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{brl(totals.pago)}</p>
          </div>
        </div>
      )}

      {cardGroups.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <CategoryChart data={byCategory} />
          <MonthlyChart data={byMonth} />
        </div>
      )}

      {cardGroups.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-foreground">
              {showHistory ? "Histórico de parcelamentos" : "Parcelamentos em aberto"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {showHistory
                ? `${historicalGroups.length} parcelamento(s) sem saldo pendente`
                : `${activeGroups.length} parcelamento(s) com valores a pagar`}
            </p>
          </div>
          <Button variant="outline" onClick={() => setShowHistory((current) => !current)}>
            <History className="mr-2 h-4 w-4" />
            {showHistory ? "Voltar aos parcelamentos em aberto" : "Acessar histórico"}
          </Button>
        </div>
      )}

      {cardGroups.length === 0 ? (
        <EmptyState
          title="Nenhuma compra parcelada"
          hint="Lance uma compra no cartão com mais de uma parcela."
        />
      ) : visibleGroups.length === 0 ? (
        <EmptyState
          title={showHistory ? "Nenhum parcelamento no histórico" : "Nenhum parcelamento em aberto"}
          hint={
            showHistory
              ? "Os parcelamentos totalmente quitados aparecerão aqui."
              : "Todos os parcelamentos cadastrados já foram quitados."
          }
        />
      ) : (
        <div className="space-y-3">
          {visibleGroups.map((g) => {
            const parcels = [...(parcelsByGroup.get(g.id) ?? [])].sort(
              (a, b) => (a.installment_number ?? 0) - (b.installment_number ?? 0),
            );
            const pagas = parcels.filter((p) => p.status === "pago").length;
            const restanteGrupo = parcels
              .filter((p) => p.status !== "pago" && p.status !== "cancelado")
              .reduce((s, p) => s + Number(p.amount), 0);
            const card = cards.find((c) => c.id === g.credit_card_id);
            return (
              <div key={g.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-card-foreground">{g.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {card?.name ?? "Cartão"} · {g.installments}x · 1ª em{" "}
                      {formatDateBR(g.first_due_date)} · {pagas}/{parcels.length} pagas
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-foreground">
                    {brl(Number(g.total_amount))}
                  </span>
                  <span className="shrink-0 text-sm font-medium text-destructive">
                    Falta {brl(restanteGrupo)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpanded(expanded === g.id ? null : g.id)}
                  >
                    {expanded === g.id ? "Ocultar parcelas" : "Ver parcelas"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Editar"
                    onClick={() => setEditing(g)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Excluir"
                    onClick={() => remove(g)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>

                {expanded === g.id && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="py-2 font-medium">Parcela</th>
                          <th className="py-2 font-medium">Competência</th>
                          <th className="py-2 font-medium">Vencimento</th>
                          <th className="py-2 font-medium">Situação</th>
                          <th className="py-2 text-right font-medium">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parcels.map((p) => (
                          <tr key={p.id} className="border-t border-border/60">
                            <td className="py-2 text-foreground">
                              {p.installment_number ?? 1}/{p.installment_total ?? 1}
                            </td>
                            <td className="py-2 text-muted-foreground">
                              {formatDateBR(p.competence_date)}
                            </td>
                            <td className="py-2 text-muted-foreground">
                              {formatDateBR(p.due_date)}
                            </td>
                            <td className="py-2">
                              <StatusBadge status={p.status} type={p.type} />
                            </td>
                            <td className="py-2 text-right font-medium text-foreground">
                              {brl(Number(p.amount))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <GroupDialog group={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function CategoryChart({ data }: { data: { name: string; valor: number }[] }) {
  const maxValue = Math.max(...data.map((item) => item.valor), 1);
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="font-semibold">Valores parcelados por categoria</h2>
      <div className="mt-4 max-h-[340px] space-y-4 overflow-y-auto pr-1">
        {data.map((item) => (
          <div key={item.name}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-foreground" title={item.name}>
                {item.name}
              </span>
              <span className="shrink-0 text-muted-foreground">{brl(item.valor)}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.max((item.valor / maxValue) * 100, 2)}%` }}
              />
            </div>
          </div>
        ))}
        {data.length === 0 && (
          <p className="text-sm text-muted-foreground">Sem dados para exibir.</p>
        )}
      </div>
    </section>
  );
}

function MonthlyChart({ data }: { data: { month: string; pago: number; aberto: number }[] }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="font-semibold">Parcelas pagas e em aberto por mês</h2>
      <div className="mt-4 h-[300px]">
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem dados para exibir.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(value) => brl(Number(value))}
                width={82}
              />
              <Tooltip formatter={(value) => brl(Number(value))} />
              <Legend />
              <Bar dataKey="pago" name="Pago" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="aberto" name="Em aberto" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

function GroupDialog({ group, onClose }: { group: Group | null; onClose: () => void }) {
  const { data: profile } = useProfile();
  const { data: cards = [] } = useCards();
  const { data: categories = [] } = useCategories();
  const { data: members = [] } = useMembers();
  const { data: transactions = [] } = useTransactions();
  const invalidate = useInvalidateFinance();

  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [total, setTotal] = useState(0);
  const [installments, setInstallments] = useState("1");
  const [firstDate, setFirstDate] = useState("");
  const [cardId, setCardId] = useState("");
  const [categoryId, setCategoryId] = useState(NONE);
  const [memberId, setMemberId] = useState(NONE);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const first = group ? transactions.find((t) => t.installment_group_id === group.id) : undefined;

  if (group && group.id !== loadedId) {
    setLoadedId(group.id);
    setDescription(group.description);
    setTotal(Number(group.total_amount));
    setInstallments(String(group.installments));
    setFirstDate(group.first_due_date);
    setCardId(group.credit_card_id ?? "");
    setCategoryId(first?.category_id ?? NONE);
    setMemberId(first?.member_id ?? NONE);
    setNotes(first?.notes ?? "");
  }

  const categoryOptions = useMemo(() => {
    const parents = categories.filter((c) => c.kind === "despesa" && !c.parent_id);
    return parents.flatMap((p) => [
      { id: p.id, label: p.name, child: false },
      ...categories
        .filter((c) => c.parent_id === p.id)
        .map((c) => ({ id: c.id, label: c.name, child: true })),
    ]);
  }, [categories]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!group || !profile?.family_id) return;
    const card = cards.find((c) => c.id === cardId);
    if (!card) {
      toast.error("Selecione o cartão");
      return;
    }
    if (total <= 0) {
      toast.error("Informe o valor total");
      return;
    }
    setSaving(true);
    try {
      await updateInstallmentGroup({
        familyId: profile.family_id,
        id: group.id,
        description,
        totalAmount: total,
        installments: Number(installments) || 1,
        firstDate,
        categoryId: categoryId === NONE ? null : categoryId,
        memberId: memberId === NONE ? null : memberId,
        notes: notes || null,
        card,
      });
      invalidate();
      toast.success("Parcelamento atualizado");
      onClose();
    } catch (error) {
      toast.error("Não foi possível atualizar", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!group} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar compra parcelada</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="pd">Descrição</Label>
              <Input
                id="pd"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pt">Valor total (R$)</Label>
              <CurrencyInput id="pt" value={total} onValueChange={setTotal} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pn">Parcelas</Label>
              <Input
                id="pn"
                type="number"
                min={1}
                max={72}
                value={installments}
                onChange={(e) => setInstallments(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pf">Dia da compra (1ª parcela)</Label>
              <Input
                id="pf"
                type="date"
                value={firstDate}
                onChange={(e) => setFirstDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Cartão</Label>
              <Select value={cardId} onValueChange={setCardId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
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
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="pobs">Observação</Label>
              <Textarea
                id="pobs"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Todas as parcelas são regeradas e realocadas nas faturas do cartão. As parcelas que já
            estavam pagas continuam pagas.
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

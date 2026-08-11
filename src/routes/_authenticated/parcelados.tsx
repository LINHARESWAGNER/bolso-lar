import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Pencil, Trash2 } from "lucide-react";
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
import {
  deleteInstallmentGroup,
  updateInstallmentGroup,
} from "@/lib/transactions";
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
  const invalidate = useInvalidateFinance();
  const [editing, setEditing] = useState<Group | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const cardGroups = groups.filter((g) => g.credit_card_id);

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

      {cardGroups.length === 0 ? (
        <EmptyState
          title="Nenhuma compra parcelada"
          hint="Lance uma compra no cartão com mais de uma parcela."
        />
      ) : (
        <div className="space-y-3">
          {cardGroups.map((g) => {
            const parcels = transactions
              .filter((t) => t.installment_group_id === g.id)
              .sort((a, b) => (a.installment_number ?? 0) - (b.installment_number ?? 0));
            const pagas = parcels.filter((p) => p.status === "pago").length;
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpanded(expanded === g.id ? null : g.id)}
                  >
                    {expanded === g.id ? "Ocultar parcelas" : "Ver parcelas"}
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => setEditing(g)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => remove(g)}>
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
                            <td className="py-2 text-muted-foreground">{formatDateBR(p.due_date)}</td>
                            <td className="py-2"><StatusBadge status={p.status} type={p.type} /></td>
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

  const first = group
    ? transactions.find((t) => t.installment_group_id === group.id)
    : undefined;

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
              <Input id="pd" required value={description} onChange={(e) => setDescription(e.target.value)} />
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
              <Input id="pf" type="date" value={firstDate} onChange={(e) => setFirstDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Cartão</Label>
              <Select value={cardId} onValueChange={setCardId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {cards.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="pobs">Observação</Label>
              <Textarea id="pobs" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Todas as parcelas são regeradas e realocadas nas faturas do cartão. As parcelas
            que já estavam pagas continuam pagas.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
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
import { toISODate } from "@/lib/format";
import {
  FREQUENCY_LABEL,
  STATUS_LABEL,
  type RecurrenceFrequency,
  type TransactionStatus,
} from "@/lib/finance";
import {
  useAccounts,
  useCards,
  useCategories,
  useMembers,
  useProfile,
  useInvalidateFinance,
} from "@/lib/queries";
import { createEntry, type NewEntryInput } from "@/lib/transactions";

type Kind = NewEntryInput["kind"];

const NONE = "__none__";

export function TransactionDialog({
  open,
  onOpenChange,
  defaultKind = "despesa",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultKind?: Kind;
}) {
  const { data: profile } = useProfile();
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: members = [] } = useMembers();
  const { data: cards = [] } = useCards();
  const invalidate = useInvalidateFinance();

  const today = toISODate(new Date());
  const [kind, setKind] = useState<Kind>(defaultKind);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [competenceDate, setCompetenceDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [paidDate, setPaidDate] = useState<string>("");
  const [status, setStatus] = useState<TransactionStatus>("pago");
  const [categoryId, setCategoryId] = useState(NONE);
  const [accountId, setAccountId] = useState(NONE);
  const [toAccountId, setToAccountId] = useState(NONE);
  const [creditCardId, setCreditCardId] = useState(NONE);
  const [memberId, setMemberId] = useState(NONE);
  const [notes, setNotes] = useState("");
  const [installments, setInstallments] = useState("1");
  const [recurring, setRecurring] = useState(false);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("mensal");
  const [recurrenceCount, setRecurrenceCount] = useState("12");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(defaultKind);
    setDescription("");
    setAmount("");
    setCompetenceDate(today);
    setDueDate(today);
    setPaidDate(today);
    setStatus("pago");
    setCategoryId(NONE);
    setToAccountId(NONE);
    setNotes("");
    setInstallments("1");
    setRecurring(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const active = accounts.filter((a) => a.is_active);
    if (accountId === NONE && active[0]) setAccountId(active[0].id);
    if (creditCardId === NONE && cards[0]) setCreditCardId(cards[0].id);
  }, [accounts, cards, accountId, creditCardId]);

  const categoryOptions = useMemo(() => {
    const wanted = kind === "receita" ? "receita" : "despesa";
    const parents = categories.filter((c) => c.kind === wanted && !c.parent_id);
    return parents.flatMap((p) => [
      { id: p.id, label: p.name, child: false },
      ...categories
        .filter((c) => c.parent_id === p.id)
        .map((c) => ({ id: c.id, label: c.name, child: true })),
    ]);
  }, [categories, kind]);

  const showCategory = kind !== "transferencia";
  const showCard = kind === "cartao";
  const showAccount = kind !== "cartao";
  const showInstallments = kind === "cartao" || kind === "despesa";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile?.family_id) return;
    const value = Number(amount.replace(/\./g, "").replace(",", "."));
    if (!value || value <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    if (kind === "transferencia" && (accountId === NONE || toAccountId === NONE)) {
      toast.error("Selecione a conta de origem e destino");
      return;
    }
    setSaving(true);
    try {
      await createEntry(
        {
          familyId: profile.family_id,
          kind,
          description,
          amount: value,
          competenceDate,
          dueDate: dueDate || null,
          paidDate: status === "pago" ? paidDate || competenceDate : null,
          status,
          categoryId: categoryId === NONE ? null : categoryId,
          accountId: accountId === NONE ? null : accountId,
          toAccountId: toAccountId === NONE ? null : toAccountId,
          creditCardId: creditCardId === NONE ? null : creditCardId,
          memberId: memberId === NONE ? null : memberId,
          notes: notes || null,
          installments: Number(installments) || 1,
          recurring,
          frequency,
          recurrenceCount: Number(recurrenceCount) || 12,
        },
        cards,
      );
      invalidate();
      toast.success("Lançamento salvo");
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
          <DialogTitle>Novo lançamento</DialogTitle>
        </DialogHeader>

        <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="despesa">Despesa</TabsTrigger>
            <TabsTrigger value="receita">Receita</TabsTrigger>
            <TabsTrigger value="cartao">Cartão</TabsTrigger>
            <TabsTrigger value="transferencia">Transf.</TabsTrigger>
          </TabsList>
        </Tabs>

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
              <Input
                id="valor"
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="comp">Competência</Label>
              <Input
                id="comp"
                type="date"
                value={competenceDate}
                onChange={(e) => setCompetenceDate(e.target.value)}
              />
            </div>

            {showCategory && (
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
                <Label>{kind === "transferencia" ? "Conta de origem" : "Conta"}</Label>
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

            {kind === "transferencia" && (
              <div className="space-y-2">
                <Label>Conta de destino</Label>
                <Select value={toAccountId} onValueChange={setToAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts
                      .filter((a) => a.id !== accountId)
                      .map((a) => (
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

            {showInstallments && (
              <div className="space-y-2">
                <Label htmlFor="parc">Parcelas</Label>
                <Input
                  id="parc"
                  type="number"
                  min={1}
                  max={72}
                  value={installments}
                  onChange={(e) => setInstallments(e.target.value)}
                />
              </div>
            )}

            {kind !== "cartao" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="venc">Vencimento</Label>
                  <Input
                    id="venc"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Situação</Label>
                  <Select
                    value={status}
                    onValueChange={(v) => setStatus(v as TransactionStatus)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        ["previsto", "pendente", "pago", "atrasado", "cancelado"] as const
                      ).map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {status === "pago" && (
                  <div className="space-y-2">
                    <Label htmlFor="pgto">Data do pagamento</Label>
                    <Input
                      id="pgto"
                      type="date"
                      value={paidDate}
                      onChange={(e) => setPaidDate(e.target.value)}
                    />
                  </div>
                )}
              </>
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
                  <Switch id="rec" checked={recurring} onCheckedChange={setRecurring} />
                </div>
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
                      <Label htmlFor="ocor">Ocorrências</Label>
                      <Input
                        id="ocor"
                        type="number"
                        min={1}
                        max={60}
                        value={recurrenceCount}
                        onChange={(e) => setRecurrenceCount(e.target.value)}
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
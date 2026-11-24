import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeftRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/currency-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { JourneyBackLink } from "@/components/journey-header";
import { brl, formatDateBR, toISODate } from "@/lib/format";
import {
  ACCOUNT_TYPE_LABEL,
  accountBalance,
  type Account,
  type AccountType,
} from "@/lib/finance";
import { cashBalance } from "@/lib/derive";
import { createEntry } from "@/lib/transactions";
import { useAccounts, useInvalidateFinance, useProfile, useTransactions } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/contas")({
  head: () => ({
    meta: [
      { title: "Contas — Finanças da Família" },
      { name: "description", content: "Contas bancárias, carteira e investimentos com saldo consolidado." },
      { property: "og:title", content: "Contas — Finanças da Família" },
      { property: "og:description", content: "Contas bancárias, carteira e investimentos com saldo consolidado." },
    ],
  }),
  component: Contas,
});

function Contas() {
  const { data: accounts = [] } = useAccounts();
  const { data: transactions = [] } = useTransactions();
  const { data: profile } = useProfile();
  const invalidate = useInvalidateFinance();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const total = useMemo(
    () => cashBalance(accounts, transactions),
    [accounts, transactions],
  );

  return (
    <div>
      <JourneyBackLink />
      <PageHeader
        title="Contas"
        subtitle={`Saldo consolidado ${brl(total)}`}
        actions={
          <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setTransferOpen(true)}>
            <ArrowLeftRight className="mr-2 h-4 w-4" /> Transferir entre contas
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Nova conta
          </Button>
          </div>
        }
      />

      {accounts.length === 0 ? (
        <EmptyState title="Nenhuma conta cadastrada" hint="Crie sua primeira conta para começar a lançar." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {accounts.map((a) => {
            const saldo = accountBalance(a, transactions);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setEditing(a);
                  setOpen(true);
                }}
                className="rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-card-foreground">{a.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {ACCOUNT_TYPE_LABEL[a.type]}
                      {a.institution ? ` · ${a.institution}` : ""}
                    </p>
                  </div>
                  {!a.is_active && (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      Inativa
                    </span>
                  )}
                </div>
                <p
                  className={`mt-4 text-xl font-semibold ${Math.round((Number(saldo) + Number.EPSILON) * 100) < 0 ? "text-destructive" : "text-foreground"}`}
                >
                  {brl(saldo)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Saldo inicial {brl(Number(a.initial_balance))} em {formatDateBR(a.initial_balance_date)}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {accounts.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Lançamentos de saldo inicial
          </h2>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Conta</th>
                  <th className="px-4 py-2 font-medium">Data</th>
                  <th className="px-4 py-2 text-right font-medium">Saldo inicial</th>
                  <th className="px-4 py-2 text-right font-medium">Ação</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-t border-border/60">
                    <td className="px-4 py-2 text-foreground">{a.name}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {formatDateBR(a.initial_balance_date)}
                    </td>
                    <td className="px-4 py-2 text-right font-medium text-foreground">
                      {brl(Number(a.initial_balance))}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(a);
                          setOpen(true);
                        }}
                      >
                        Editar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <TransferDialog open={transferOpen} onClose={() => setTransferOpen(false)} />
      <AccountDialog
        open={open}
        account={editing}
        familyId={profile?.family_id ?? null}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          invalidate();
        }}
      />
    </div>
  );
}

function TransferDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: profile } = useProfile();
  const { data: accounts = [] } = useAccounts();
  const invalidate = useInvalidateFinance();
  const [description, setDescription] = useState("Transferência entre contas");
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(toISODate(new Date()));
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [status, setStatus] = useState<"previsto" | "pago">("pago");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!profile?.family_id) return;
    if (!origin || !destination || origin === destination) {
      toast.error("Selecione duas contas diferentes");
      return;
    }
    if (!(amount > 0)) {
      toast.error("Informe um valor válido");
      return;
    }
    setSaving(true);
    try {
      await createEntry({
        familyId: profile.family_id,
        kind: "transferencia",
        description,
        amount,
        competenceDate: date,
        dueDate: date,
        paidDate: status === "pago" ? date : null,
        status,
        categoryId: null,
        accountId: origin,
        toAccountId: destination,
        creditCardId: null,
        memberId: null,
        notes: null,
        expenseNature: null,
        installments: 1,
        recurring: false,
        frequency: "mensal",
        recurrenceEnd: date,
      }, []);
      invalidate();
      toast.success("Transferência registrada");
      onClose();
    } catch (error) {
      toast.error("Erro ao transferir", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Transferir entre contas</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="transfer-desc">Descrição</Label>
            <Input id="transfer-desc" required value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <div className="space-y-2"><Label>Valor</Label><CurrencyInput required value={amount} onValueChange={setAmount} /></div>
          <div className="space-y-2"><Label htmlFor="transfer-date">Data</Label>
            <Input id="transfer-date" type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
          <div className="space-y-2"><Label>Conta de origem</Label>
            <Select value={origin} onValueChange={setOrigin}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{accounts.filter((a) => a.is_active).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Conta de destino</Label>
            <Select value={destination} onValueChange={setDestination}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{accounts.filter((a) => a.is_active && a.id !== origin).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Situação</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as "previsto" | "pago")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="previsto">Previsto</SelectItem><SelectItem value="pago">Realizado</SelectItem></SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>Transferir</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AccountDialog({
  open,
  account,
  familyId,
  onClose,
  onSaved,
}: {
  open: boolean;
  account: Account | null;
  familyId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("corrente");
  const [institution, setInstitution] = useState("");
  const [initial, setInitial] = useState(0);
  const [initialDate, setInitialDate] = useState(toISODate(new Date()));
  const [includeInCash, setIncludeInCash] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  const key = account?.id ?? "new";
  if (open && key !== loadedId) {
    setLoadedId(key);
    setName(account?.name ?? "");
    setType(account?.type ?? "corrente");
    setInstitution(account?.institution ?? "");
    setInitial(Number(account?.initial_balance ?? 0));
    setInitialDate(account?.initial_balance_date ?? toISODate(new Date()));
    setIncludeInCash(account?.include_in_cash ?? true);
    setIsActive(account?.is_active ?? true);
  }
  if (!open && loadedId !== null) setLoadedId(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!familyId) return;
    const payload = {
      name,
      type,
      institution: institution || null,
      initial_balance: initial || 0,
      initial_balance_date: initialDate,
      include_in_cash: includeInCash,
      is_active: isActive,
    };
    const { error } = account
      ? await supabase.from("accounts").update(payload).eq("id", account.id)
      : await supabase.from("accounts").insert({ ...payload, family_id: familyId });
    if (error) toast.error("Não foi possível salvar a conta");
    else {
      toast.success(account ? "Conta atualizada" : "Conta criada");
      onSaved();
    }
  }

  async function remove() {
    if (!account) return;
    const { error } = await supabase.from("accounts").delete().eq("id", account.id);
    if (error) toast.error("Conta possui lançamentos e não pode ser excluída");
    else {
      toast.success("Conta excluída");
      onSaved();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{account ? "Editar conta" : "Nova conta"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="an">Nome</Label>
            <Input id="an" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={type} onValueChange={(v) => setType(v as AccountType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ACCOUNT_TYPE_LABEL).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai">Instituição</Label>
              <Input id="ai" value={institution} onChange={(e) => setInstitution(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ab">Saldo inicial</Label>
              <CurrencyInput id="ab" value={initial} onValueChange={setInitial} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ad">Data do saldo</Label>
              <Input id="ad" type="date" value={initialDate} onChange={(e) => setInitialDate(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <Label htmlFor="acash" className="text-sm font-normal">Somar no saldo em caixa</Label>
            <Switch id="acash" checked={includeInCash} onCheckedChange={setIncludeInCash} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <Label htmlFor="aact" className="text-sm font-normal">Conta ativa</Label>
            <Switch id="aact" checked={isActive} onCheckedChange={setIsActive} />
          </div>
          <DialogFooter className="gap-2">
            {account && (
              <Button type="button" variant="ghost" className="text-destructive" onClick={remove}>
                Excluir
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit">Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

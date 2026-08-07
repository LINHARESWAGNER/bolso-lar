import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { brl, formatDateBR, toISODate } from "@/lib/format";
import {
  ACCOUNT_TYPE_LABEL,
  accountBalance,
  type Account,
  type AccountType,
} from "@/lib/finance";
import { cashBalance } from "@/lib/derive";
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

  const total = useMemo(
    () => cashBalance(accounts, transactions),
    [accounts, transactions],
  );

  return (
    <div>
      <PageHeader
        title="Contas"
        subtitle={`Saldo consolidado ${brl(total)}`}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Nova conta
          </Button>
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
                  className={`mt-4 text-xl font-semibold ${saldo < 0 ? "text-destructive" : "text-foreground"}`}
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
  const [initial, setInitial] = useState("0");
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
    setInitial(String(account?.initial_balance ?? 0));
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
      initial_balance: Number(initial.replace(",", ".")) || 0,
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
              <Input id="ab" value={initial} onChange={(e) => setInitial(e.target.value)} />
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
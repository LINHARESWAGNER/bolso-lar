import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, ArrowLeftRight, Pencil, Plus, Wallet, TrendingUp, TrendingDown } from "lucide-react";
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
import { AccountInstitutionLogo, ACCOUNT_INSTITUTION_SUGGESTIONS, isSpecialAccountInstitution } from "@/components/account-institution-logo";
import { JourneyBackLink } from "@/components/journey-header";
import { brl, formatDateBR, toISODate } from "@/lib/format";
import {
  ACCOUNT_TYPE_LABEL,
  accountBalance,
  type Account,
  type AccountType,
  type Transaction,
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
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);

  const total = useMemo(
    () => cashBalance(accounts, transactions),
    [accounts, transactions],
  );

  // Mantém a mesma função homologada para saldos; os agregados não
  // inventam lançamentos nem incluem contas fora do caixa consolidado.
  const accountRows = accounts.map((account) => ({ account, balance: accountBalance(account, transactions) }));
  const includedRows = accountRows.filter(({ account }) => account.is_active && account.include_in_cash);
  const positiveTotal = includedRows.reduce((sum, row) => sum + Math.max(0, row.balance), 0);
  const negativeTotal = includedRows.reduce((sum, row) => sum + Math.min(0, row.balance), 0);
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? null;

  function openEdit(account: Account) {
    setEditing(account);
    setOpen(true);
  }

  return (
    <div className="space-y-5">
      <JourneyBackLink />
      {selectedAccount ? (
        <AccountDetail
          account={selectedAccount}
          transactions={transactions}
          monthKey={selectedMonthKey}
          onMonthChange={setSelectedMonthKey}
          onBack={() => { setSelectedAccountId(null); setSelectedMonthKey(null); }}
          onEdit={() => openEdit(selectedAccount)}
        />
      ) : (
        <>
          <PageHeader
            title="Contas"
            subtitle="Acompanhe saldos e movimentações das suas contas em um só lugar"
            actions={
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setTransferOpen(true)}>
                  <ArrowLeftRight className="mr-2 h-4 w-4" /> Transferir entre contas
                </Button>
                <Button onClick={() => { setEditing(null); setOpen(true); }}>
                  <Plus className="mr-2 h-4 w-4" /> Nova conta
                </Button>
              </div>
            }
          />
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <AccountMetric title="Contas cadastradas" value={String(accounts.length)} />
            <AccountMetric title="Saldo consolidado" value={brl(total)} />
            <AccountMetric title="Saldos positivos" value={brl(positiveTotal)} tone="positive" />
            <AccountMetric title="Saldos negativos" value={brl(negativeTotal)} tone={negativeTotal < 0 ? "negative" : undefined} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <h2 className="text-lg font-semibold">Minhas contas</h2>
            <p className="text-xs text-muted-foreground">Selecione uma conta para acompanhar sua movimentação</p>
          </div>
          {accounts.length === 0 ? (
            <EmptyState title="Nenhuma conta cadastrada" hint="Crie sua primeira conta para começar a lançar." />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {accountRows.map(({ account, balance }) => (
                <article key={account.id} className="flex min-h-[228px] flex-col rounded-2xl border border-border bg-gradient-to-br from-card to-card/80 p-4 shadow-sm transition-colors hover:border-primary/50">
                  <div className="flex items-start gap-3">
                    <AccountEmblem name={account.institution || account.name} type={account.type} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-muted-foreground">{account.institution || ACCOUNT_TYPE_LABEL[account.type]}</p>
                      <h3 className="truncate text-sm font-semibold" title={account.name}>{account.name}</h3>
                    </div>
                    <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Editar ${account.name}`} title="Editar conta" onClick={() => openEdit(account)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-7 flex-1">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Saldo atual</p>
                    <p className={`mt-1 text-2xl font-bold tabular-nums ${balance < 0 ? "text-destructive" : "text-foreground"}`}>{brl(balance)}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{ACCOUNT_TYPE_LABEL[account.type]}{!account.is_active ? " · Inativa" : ""}</p>
                    {!account.include_in_cash && <p className="mt-1 text-xs text-amber-500">Fora do saldo consolidado</p>}
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-2 border-t border-border/70 pt-3">
                    <div className="min-w-0 text-xs text-muted-foreground">
                      <span className="block">Saldo inicial</span>
                      <span className="font-semibold text-foreground">{brl(Number(account.initial_balance))}</span>
                    </div>
                    <button type="button" className="shrink-0 text-xs font-semibold text-primary hover:underline" onClick={() => { setSelectedAccountId(account.id); setSelectedMonthKey(null); }}>
                      Abrir conta →
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
      <TransferDialog open={transferOpen} onClose={() => setTransferOpen(false)} />
      <AccountDialog
        open={open}
        account={editing}
        familyId={profile?.family_id ?? null}
        onClose={() => setOpen(false)}
        onSaved={() => { setOpen(false); invalidate(); }}
      />
    </div>
  );
}

function AccountMetric({ title, value, tone }: { title: string; value: string; tone?: "positive" | "negative" | undefined }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-4">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className={`mt-2 text-xl font-bold tabular-nums ${tone === "positive" ? "text-emerald-500" : tone === "negative" ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}

function AccountEmblem({ name, type }: { name: string; type: AccountType }) {
  // Mesmo catalogo de logotipos e fallback de iniciais utilizado nos cartoes.
  // Dinheiro/carteira continuam com o icone de carteira, sem buscar banco.
  if ((type === "dinheiro" || type === "carteira") && !isSpecialAccountInstitution(name)) {
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary" title={name}>
        <Wallet className="h-5 w-5" />
      </div>
    );
  }
  return <AccountInstitutionLogo institution={name || "Instituicao nao informada"} className="h-12 w-12" />;
}

function accountMoneySigned(transaction: Transaction): number {
  const amount = Number(transaction.amount);
  if (transaction.type === "receita") return amount;
  if (transaction.type === "despesa" || transaction.type === "pagamento_fatura") return -amount;
  if (transaction.type === "transferencia") return transaction.transfer_role === "destino" ? amount : -amount;
  return 0;
}

function accountPaidOn(transaction: Transaction): string {
  return transaction.paid_date ?? transaction.due_date ?? transaction.competence_date;
}

function accountHistory(account: Account, transactions: Transaction[]) {
  const now = new Date();
  const months = Array.from({ length: 8 }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 7 + i, 1);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return { key: `${year}-${month}`, label: new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" }).format(date) };
  });
  const paidTransactions = transactions.filter((t) => t.account_id === account.id && t.status === "pago" && accountPaidOn(t) >= account.initial_balance_date);
  return months.map((m) => {
    const end = `${m.key}-31`;
    const balance = (account.initial_balance_date <= end ? Number(account.initial_balance) : 0) +
      paidTransactions.filter((t) => accountPaidOn(t) <= end).reduce((sum, t) => sum + accountMoneySigned(t), 0);
    return { ...m, balance, entries: paidTransactions.filter((t) => accountPaidOn(t).slice(0, 7) === m.key).sort((a, b) => accountPaidOn(b).localeCompare(accountPaidOn(a))) };
  });
}

function AccountDetail({ account, transactions, monthKey, onMonthChange, onBack, onEdit }: {
  account: Account;
  transactions: Transaction[];
  monthKey: string | null;
  onMonthChange: (month: string) => void;
  onBack: () => void;
  onEdit: () => void;
}) {
  const currentBalance = accountBalance(account, transactions);
  const history = accountHistory(account, transactions);
  const selected = history.find((m) => m.key === monthKey) ?? history[history.length - 1];
  if (!selected) return null;
  const values = history.map((m) => m.balance);
  const low = Math.min(...values, 0);
  const high = Math.max(...values, 0);
  const range = Math.max(high - low, 1);
  const chartX = (index: number) => 70 + (index * 940) / 7;
  const chartY = (value: number) => 235 - ((value - low) / range) * 155;
  const points = values.map((value, index) => `${chartX(index)},${chartY(value)}`).join(" ");

  return (
    <div className="space-y-4">
      <button className="inline-flex items-center gap-2 text-sm font-medium hover:text-primary" type="button" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Voltar para contas</button>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5">
        <div className="flex min-w-0 items-center gap-3">
          <AccountEmblem name={account.institution || account.name} type={account.type} />
          <div><p className="text-xs text-muted-foreground">{account.institution || "Instituição não informada"}</p><h2 className="text-lg font-bold">{account.name}</h2><p className="text-xs text-muted-foreground">{ACCOUNT_TYPE_LABEL[account.type]} · {account.is_active ? "Ativa" : "Inativa"}</p></div>
        </div>
        <div><p className="text-xs text-muted-foreground">Saldo atual</p><p className={`text-xl font-bold tabular-nums ${currentBalance < 0 ? "text-destructive" : "text-emerald-500"}`}>{brl(currentBalance)}</p></div>
        <div><p className="text-xs text-muted-foreground">Saldo inicial</p><p className="font-semibold tabular-nums">{brl(Number(account.initial_balance))}</p><p className="text-xs text-muted-foreground">{formatDateBR(account.initial_balance_date)}</p></div>
        <Button variant="outline" onClick={onEdit}><Pencil className="mr-2 h-4 w-4" /> Editar conta</Button>
      </div>
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-3"><h3 className="font-semibold">Evolução do saldo · 8 meses</h3><p className="text-xs text-muted-foreground">Saldos realizados por mês, sem projeções. Clique no mês ou no ponto para consultar as movimentações.</p></div>
        <div className="w-full overflow-x-auto">
          <svg viewBox="0 0 1080 290" className="min-w-[720px] w-full" role="img" aria-label="Evolução do saldo realizado da conta">
            {[0, 0.5, 1].map((fraction) => (
              <g key={fraction}><line x1="60" y1={chartY(low + range * fraction)} x2="1030" y2={chartY(low + range * fraction)} stroke="currentColor" opacity="0.12" strokeDasharray="4 4" /><text x="55" y={chartY(low + range * fraction) - 4} fontSize="11" textAnchor="end" fill="currentColor" opacity="0.7">{brl(low + range * fraction)}</text></g>
            ))}
            <polyline fill="none" stroke="#38bdf8" strokeWidth="3" points={points} />
            {history.map((m, index) => (
              <g key={m.key} onClick={() => onMonthChange(m.key)} className="cursor-pointer" role="button" aria-label={`Selecionar ${m.label}: ${brl(m.balance)}`}>
                <circle cx={chartX(index)} cy={chartY(m.balance)} r={selected.key === m.key ? 8 : 5} fill={selected.key === m.key ? "#10b981" : "#38bdf8"} stroke="#0f172a" strokeWidth="2"><title>{m.label}: {brl(m.balance)}</title></circle>
                <text x={chartX(index)} y={Math.max(17, chartY(m.balance) - 16)} textAnchor="middle" fill="currentColor" fontSize="11">{brl(m.balance)}</text>
                <text x={chartX(index)} y="273" textAnchor="middle" fill={selected.key === m.key ? "#10b981" : "currentColor"} fontSize="12">{m.label}</text>
              </g>
            ))}
          </svg>
        </div>
      </section>
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between gap-2"><div><h3 className="font-semibold">Movimentações · {selected.label}</h3><p className="text-xs text-muted-foreground">Somente operações realizadas desta conta no mês selecionado</p></div>{selected.balance >= 0 ? <TrendingUp className="h-5 w-5 text-emerald-500" /> : <TrendingDown className="h-5 w-5 text-destructive" />}</div>
        {selected.entries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">Nenhuma movimentação realizada nesse mês.</p>
        ) : (
          <div className="divide-y divide-border/70">
            {selected.entries.map((entry) => {
              const signed = accountMoneySigned(entry);
              return <div key={entry.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{entry.description}</p><p className="text-xs text-muted-foreground">{formatDateBR(accountPaidOn(entry))} · {entry.type === "transferencia" ? "Transferência" : entry.type === "receita" ? "Entrada" : "Saída"}</p></div><strong className={`shrink-0 text-sm tabular-nums ${signed < 0 ? "text-destructive" : "text-emerald-500"}`}>{signed > 0 ? "+" : ""}{brl(signed)}</strong></div>;
            })}
          </div>
        )}
      </section>
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
              <div className="flex items-center gap-2">
                <div className="shrink-0">
                  <AccountEmblem name={institution || "Outra"} type={type} />
                </div>
                <Input
                  id="ai"
                  list="account-institution-suggestions"
                  autoComplete="off"
                  placeholder="Busque ou digite a instituição"
                  value={institution}
                  onChange={(e) => setInstitution(e.target.value)}
                />
              </div>
              <datalist id="account-institution-suggestions">
                {ACCOUNT_INSTITUTION_SUGGESTIONS.map((bank) => <option key={bank} value={bank} />)}
              </datalist>
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

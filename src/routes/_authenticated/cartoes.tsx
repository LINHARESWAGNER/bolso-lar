import { useState } from "react";
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
import { CurrencyInput } from "@/components/currency-input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { brl, formatDateBR, toISODate } from "@/lib/format";
import { accountBalance, type CreditCard, type Invoice } from "@/lib/finance";
import { categoryPath, notCancelled } from "@/lib/derive";
import {
  useAccounts,
  useCards,
  useCategories,
  useInvalidateFinance,
  useInvoices,
  useProfile,
  useTransactions,
} from "@/lib/queries";
import { payInvoice, reverseInvoicePayment } from "@/lib/transactions";

export const Route = createFileRoute("/_authenticated/cartoes")({
  head: () => ({
    meta: [
      { title: "Cartões — Finanças da Família" },
      { name: "description", content: "Faturas, limites e pagamento de cartões de crédito da família." },
      { property: "og:title", content: "Cartões — Finanças da Família" },
      { property: "og:description", content: "Faturas, limites e pagamento de cartões de crédito da família." },
    ],
  }),
  component: Cartoes,
});

function Cartoes() {
  const { data: cards = [] } = useCards();
  const { data: invoices = [] } = useInvoices();
  const { data: transactions = [] } = useTransactions();
  const { data: accounts = [] } = useAccounts();
  const { data: profile } = useProfile();
  const invalidate = useInvalidateFinance();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CreditCard | null>(null);
  const [filter, setFilter] = useState<"apagar" | "pagas">("apagar");
  const [paying, setPaying] = useState<{ invoice: Invoice; card: CreditCard; total: number } | null>(null);
  const [viewing, setViewing] = useState<{ invoice: Invoice; card: CreditCard } | null>(null);

  const invoiceTotal = (invoiceId: string) =>
    transactions
      .filter((t) => t.invoice_id === invoiceId && t.type === "despesa" && notCancelled(t))
      .reduce((s, t) => s + Number(t.amount), 0);

  async function handleReverse(invoice: Invoice) {
    try {
      await reverseInvoicePayment(invoice);
      invalidate();
      toast.success("Pagamento estornado");
    } catch {
      toast.error("Não foi possível estornar");
    }
  }

  return (
    <div>
      <PageHeader
        title="Cartões de crédito"
        subtitle="Faturas por competência, limite disponível e pagamento"
        actions={
          <>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as "apagar" | "pagas")}>
            <TabsList>
              <TabsTrigger value="apagar">A pagar</TabsTrigger>
              <TabsTrigger value="pagas">Pagas</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Novo cartão
          </Button>
          </>
        }
      />

      {cards.length === 0 ? (
        <EmptyState title="Nenhum cartão cadastrado" hint="Cadastre um cartão para lançar compras parceladas." />
      ) : (
        <div className="space-y-4">
          {cards.map((card) => {
            const cardInvoices = invoices
              .filter((i) => i.credit_card_id === card.id)
              .filter((i) => (filter === "pagas" ? i.status === "paga" : i.status !== "paga"))
              .sort((a, b) => b.reference_month.localeCompare(a.reference_month))
              .slice(0, 12);
            const emAberto = invoices
              .filter((i) => i.credit_card_id === card.id && i.status !== "paga")
              .reduce((s, i) => s + invoiceTotal(i.id), 0);
            const disponivel = Number(card.credit_limit) - emAberto;
            return (
              <div key={card.id} className="rounded-xl border border-border bg-card p-4">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-card-foreground">{card.name}</h2>
                    <p className="text-xs text-muted-foreground">
                      Fecha dia {card.closing_day} · Vence dia {card.due_day}
                      {card.brand ? ` · ${card.brand}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-foreground">{brl(disponivel)}</p>
                    <p className="text-xs text-muted-foreground">
                      disponível de {brl(Number(card.credit_limit))}
                    </p>
                    <Button
                      variant="link"
                      className="h-auto p-0 text-xs"
                      onClick={() => {
                        setEditing(card);
                        setOpen(true);
                      }}
                    >
                      Editar cartão
                    </Button>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {cardInvoices.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {filter === "pagas" ? "Nenhuma fatura paga." : "Nenhuma fatura em aberto."}
                    </p>
                  )}
                  {cardInvoices.map((inv) => {
                    const total = invoiceTotal(inv.id);
                    return (
                      <div
                        key={inv.id}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">
                            Fatura {formatDateBR(inv.reference_month).slice(3)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Fechamento {formatDateBR(inv.closing_date)} · Vencimento {formatDateBR(inv.due_date)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="font-semibold text-foreground">{brl(total)}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setViewing({ invoice: inv, card })}
                          >
                            Ver fatura
                          </Button>
                          {inv.status === "paga" ? (
                            <>
                              <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">
                                Paga
                              </span>
                              <Button size="sm" variant="outline" onClick={() => handleReverse(inv)}>
                                Estornar
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={total <= 0}
                              onClick={() => setPaying({ invoice: inv, card, total })}
                            >
                              Pagar
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CardDialog
        open={open}
        card={editing}
        familyId={profile?.family_id ?? null}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          invalidate();
        }}
      />

      <PayInvoiceDialog
        data={paying}
        familyId={profile?.family_id ?? null}
        onClose={() => setPaying(null)}
        onPaid={() => {
          setPaying(null);
          invalidate();
        }}
      />

      <InvoiceDetailsDialog data={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

function PayInvoiceDialog({
  data,
  familyId,
  onClose,
  onPaid,
}: {
  data: { invoice: Invoice; card: CreditCard; total: number } | null;
  familyId: string | null;
  onClose: () => void;
  onPaid: () => void;
}) {
  const { data: accounts = [] } = useAccounts();
  const { data: transactions = [] } = useTransactions();
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState(0);
  const [paidDate, setPaidDate] = useState(toISODate(new Date()));
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const key = data?.invoice.id ?? null;
  if (key !== loadedId) {
    setLoadedId(key);
    if (data) {
      setAccountId(data.card.payment_account_id ?? accounts[0]?.id ?? "");
      setAmount(data.total);
      setPaidDate(toISODate(new Date()));
    }
  }

  const account = accounts.find((a) => a.id === accountId);
  const saldo = account ? accountBalance(account, transactions) : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!data || !familyId) return;
    if (!accountId) {
      toast.error("Selecione a conta de débito");
      return;
    }
    if (amount <= 0) {
      toast.error("Informe o valor do pagamento");
      return;
    }
    if (amount > saldo) {
      toast.error("Saldo insuficiente nessa conta", {
        description: `Saldo disponível: ${brl(saldo)}`,
      });
      return;
    }
    setSaving(true);
    try {
      await payInvoice({
        familyId,
        invoice: data.invoice,
        cardName: data.card.name,
        accountId,
        amount,
        paidDate,
      });
      toast.success("Fatura paga");
      onPaid();
    } catch {
      toast.error("Não foi possível pagar a fatura");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!data} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pagar fatura {data?.card.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label>Conta de débito</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Selecione a conta" /></SelectTrigger>
              <SelectContent>
                {accounts
                  .filter((a) => a.is_active)
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} · {brl(accountBalance(a, transactions))}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Saldo disponível: {brl(saldo)}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="pv">Valor</Label>
              <CurrencyInput id="pv" value={amount} onValueChange={setAmount} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pd">Data do pagamento</Label>
              <Input id="pd" type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Ao confirmar, o valor é debitado da conta e todos os lançamentos da fatura
            passam para “pago”.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>Confirmar pagamento</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InvoiceDetailsDialog({
  data,
  onClose,
}: {
  data: { invoice: Invoice; card: CreditCard } | null;
  onClose: () => void;
}) {
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const rows = data
    ? transactions
        .filter((t) => t.invoice_id === data.invoice.id && t.type === "despesa" && notCancelled(t))
        .sort((a, b) => a.competence_date.localeCompare(b.competence_date))
    : [];
  const total = rows.reduce((s, t) => s + Number(t.amount), 0);

  return (
    <Dialog open={!!data} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Fatura {data?.card.name} · {formatDateBR(data?.invoice.reference_month).slice(3)}
          </DialogTitle>
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum lançamento nesta fatura.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Descrição</th>
                <th className="py-2 font-medium">Categoria</th>
                <th className="py-2 font-medium">Compra</th>
                <th className="py-2 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-t border-border/60">
                  <td className="py-2 text-foreground">{t.description}</td>
                  <td className="py-2 text-muted-foreground">
                    {categoryPath(categories, t.category_id)}
                  </td>
                  <td className="py-2 text-muted-foreground">{formatDateBR(t.competence_date)}</td>
                  <td className="py-2 text-right font-medium text-foreground">
                    {brl(Number(t.amount))}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-border">
                <td className="py-2 font-medium text-foreground" colSpan={3}>Total</td>
                <td className="py-2 text-right font-semibold text-foreground">{brl(total)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CardDialog({
  open,
  card,
  familyId,
  onClose,
  onSaved,
}: {
  open: boolean;
  card: CreditCard | null;
  familyId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: accounts = [] } = useAccounts();
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [limit, setLimit] = useState(0);
  const [closingDay, setClosingDay] = useState("1");
  const [dueDay, setDueDay] = useState("10");
  const [paymentAccount, setPaymentAccount] = useState("none");
  const [isActive, setIsActive] = useState(true);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  const key = card?.id ?? "new";
  if (open && key !== loadedId) {
    setLoadedId(key);
    setName(card?.name ?? "");
    setBrand(card?.brand ?? "");
    setLimit(Number(card?.credit_limit ?? 0));
    setClosingDay(String(card?.closing_day ?? 1));
    setDueDay(String(card?.due_day ?? 10));
    setPaymentAccount(card?.payment_account_id ?? "none");
    setIsActive(card?.is_active ?? true);
  }
  if (!open && loadedId !== null) setLoadedId(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!familyId) return;
    const payload = {
      name,
      brand: brand || null,
      credit_limit: limit || 0,
      closing_day: Number(closingDay),
      due_day: Number(dueDay),
      payment_account_id: paymentAccount === "none" ? null : paymentAccount,
      is_active: isActive,
    };
    const { error } = card
      ? await supabase.from("credit_cards").update(payload).eq("id", card.id)
      : await supabase.from("credit_cards").insert({ ...payload, family_id: familyId });
    if (error) toast.error("Não foi possível salvar o cartão");
    else {
      toast.success(card ? "Cartão atualizado" : "Cartão criado");
      onSaved();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{card ? "Editar cartão" : "Novo cartão"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cn">Nome</Label>
            <Input id="cn" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="cb">Bandeira</Label>
              <Input id="cb" value={brand} onChange={(e) => setBrand(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cl">Limite</Label>
              <CurrencyInput id="cl" value={limit} onValueChange={setLimit} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cf">Dia de fechamento</Label>
              <Input id="cf" type="number" min={1} max={31} value={closingDay} onChange={(e) => setClosingDay(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cv">Dia de vencimento</Label>
              <Input id="cv" type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Conta de pagamento</Label>
            <Select value={paymentAccount} onValueChange={setPaymentAccount}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Definir na hora do pagamento</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <Label htmlFor="cact" className="text-sm font-normal">Cartão ativo</Label>
            <Switch id="cact" checked={isActive} onCheckedChange={setIsActive} />
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
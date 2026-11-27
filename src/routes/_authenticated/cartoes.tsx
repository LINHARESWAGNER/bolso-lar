import { Fragment, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, LabelList, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
import { JourneyBackLink } from "@/components/journey-header";
import { CurrencyInput } from "@/components/currency-input";
import { brl, formatDateBR, toISODate } from "@/lib/format";
import { accountBalance, type CreditCard, type Invoice, type Transaction } from "@/lib/finance";
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
import { deleteTransaction, payInvoice, reverseInvoicePayment } from "@/lib/transactions";
import { CreditCardDetailDashboard } from "@/components/credit-card-detail-dashboard";
import { CardTransactionEditDialog } from "@/components/card-transaction-edit-dialog";
import { BankLogo, BrandLogo, BANK_SUGGESTIONS, BRAND_SUGGESTIONS, issuerForDisplay } from "@/components/card-brand-logo";

export const Route = createFileRoute("/_authenticated/cartoes")({
  head: () => ({
    meta: [
      { title: "Cartões — Finanças da Família" },
      {
        name: "description",
        content: "Faturas, limites e pagamento de cartões de crédito da família.",
      },
      { property: "og:title", content: "Cartões — Finanças da Família" },
      {
        property: "og:description",
        content: "Faturas, limites e pagamento de cartões de crédito da família.",
      },
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
  const [detailCardId, setDetailCardId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editing, setEditing] = useState<CreditCard | null>(null);
  const [paying, setPaying] = useState<{
    invoice: Invoice;
    card: CreditCard;
    total: number;
  } | null>(null);
  const [viewing, setViewing] = useState<{ invoice: Invoice; card: CreditCard } | null>(null);

  const invoiceTotal = (invoiceId: string) =>
    transactions
      .filter((t) => t.invoice_id === invoiceId && t.type === "despesa" && notCancelled(t))
      .reduce((s, t) => s + Number(t.amount), 0);

  // Visão executiva: somar somente as faturas cadastradas; não incluir previsões fictícias.
  const overviewChartData = useMemo(() => {
    const now = new Date();
    const totals = new Map<string, number>();
    const invoiceIdsByMonth = new Map<string, string[]>();
    for (const invoice of invoices) {
      if (!cards.some((card) => card.id === invoice.credit_card_id)) continue;
      const key = invoice.due_date.slice(0, 7);
      const ids = invoiceIdsByMonth.get(key) ?? [];
      ids.push(invoice.id);
      invoiceIdsByMonth.set(key, ids);
    }
    const sumByInvoice = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.invoice_id && tx.type === "despesa" && notCancelled(tx)) {
        sumByInvoice.set(tx.invoice_id, (sumByInvoice.get(tx.invoice_id) ?? 0) + Number(tx.amount));
      }
    }
    for (const [monthKey, ids] of invoiceIdsByMonth) {
      totals.set(monthKey, ids.reduce((sum, id) => sum + (sumByInvoice.get(id) ?? 0), 0));
    }
    return Array.from({ length: 8 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - 3 + index, 1);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      return {
        monthKey,
        label: new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" }).format(date).replace(" de ", "/"),
        total: totals.get(monthKey) ?? 0,
        hasInvoice: invoiceIdsByMonth.has(monthKey),
        future: date.getFullYear() > now.getFullYear() || (date.getFullYear() === now.getFullYear() && date.getMonth() > now.getMonth()),
      };
    });
  }, [cards, invoices, transactions]);

  async function handleReverse(invoice: Invoice) {
    try {
      await reverseInvoicePayment(invoice);
      invalidate();
      toast.success("Pagamento estornado");
    } catch {
      toast.error("Não foi possível estornar");
    }
  }

  const detailCard = cards.find((card) => card.id === detailCardId);
  async function confirmDelete() {
    if (!deleting) return;
    try {
      // Consulta o estado atual, não apenas o status carregado no navegador.
      // Uma fatura paga não pode perder lançamentos financeiros.
      if (!deleting.invoice_id) {
        toast.error("Lançamento sem fatura identificada; exclusão indisponível neste fluxo.");
        setDeleting(null);
        return;
      }
      const { data: currentInvoice, error: invoiceError } = await supabase
        .from("credit_card_invoices")
        .select("status")
        .eq("id", deleting.invoice_id)
        .single();
      if (invoiceError || !currentInvoice) throw invoiceError ?? new Error("Não foi possível verificar a situação da fatura.");
      if (currentInvoice.status === "paga") {
        toast.error("Fatura paga: exclusão bloqueada. Você pode ajustar categoria e classificação.");
        setDeleting(null);
        return;
      }
      await deleteTransaction(deleting);
      invalidate();
      toast.success("Lançamento enviado à lixeira");
      setDeleting(null);
    } catch (error) {
      toast.error("Não foi possível excluir o lançamento", { description: error instanceof Error ? error.message : undefined });
    }
  }

  return (
    <div>
      {!detailCard && <JourneyBackLink />}
      {detailCard ? <CreditCardDetailDashboard
        card={detailCard}
        invoices={invoices}
        transactions={transactions}
        onBack={() => setDetailCardId(null)}
        onEditCard={() => { setEditing(detailCard); setOpen(true); }}
        onPay={(invoice, total) => setPaying({ invoice, card: detailCard, total })}
        onReverse={(invoice) => void handleReverse(invoice)}
        onEditTransaction={(transaction) => setEditingTransaction(transaction)}
        onDeleteTransaction={setDeleting}
      /> : <>

      <PageHeader
        title="Cartões de crédito"
        subtitle="Faturas por competência, limite disponível e pagamento"
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Novo cartão
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Cartões cadastrados</p><p className="mt-1 text-2xl font-semibold">{cards.length}</p></div>
        <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Limite total</p><p className="mt-1 text-2xl font-semibold">{brl(cards.reduce((s, card) => s + Number(card.credit_limit), 0))}</p></div>
        <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Compromissos em aberto</p><p className="mt-1 text-2xl font-semibold">{brl(invoices.filter((i) => i.status !== "paga").reduce((sum, invoice) => sum + invoiceTotal(invoice.id), 0))}</p></div>
        <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Limite disponível estimado</p><p className="mt-1 text-2xl font-semibold text-emerald-500">{brl(cards.reduce((s, card) => s + Number(card.credit_limit), 0) - invoices.filter((i) => i.status !== "paga").reduce((sum, invoice) => sum + invoiceTotal(invoice.id), 0))}</p></div>
      </div>

      {cards.length === 0 ? (
        <EmptyState
          title="Nenhum cartão cadastrado"
          hint="Cadastre um cartão para lançar compras parceladas."
        />
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Meus cartões</h2>
            <span className="text-xs text-muted-foreground">Selecione um cartão para visualizar a evolução de suas faturas</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {cards.map((card) => {
              const allUnpaid = invoices.filter((i) => i.credit_card_id === card.id && i.status !== "paga");
              const utilized = allUnpaid.reduce((sum, inv) => sum + invoiceTotal(inv.id), 0);
              const limit = Number(card.credit_limit);
              const available = limit - utilized;
              const utilizationPercent = limit > 0 ? Math.max(0, Math.min(100, (utilized / limit) * 100)) : 0;
              // Não exibir como próxima fatura uma fatura sem despesas registradas.
              const today = toISODate(new Date());
              const withRegisteredAmount = allUnpaid
                .filter((invoice) => invoiceTotal(invoice.id) > 0)
                .sort((a, b) => a.due_date.localeCompare(b.due_date));
              const upcoming = withRegisteredAmount.find((invoice) => invoice.due_date >= today)
                ?? withRegisteredAmount[0];
              return (
                <article key={card.id} className="group relative flex min-w-0 flex-col overflow-hidden rounded-[19px] border border-sky-500/30 bg-gradient-to-br from-[#11254a] via-[#0c1b37] to-[#061126] p-4 text-slate-50 shadow-sm transition-colors hover:border-sky-400/70">
                  <div className="pointer-events-none absolute -right-20 -top-24 h-44 w-44 rounded-full border-[31px] border-sky-400/5" aria-hidden="true" />
                  <div className="relative flex items-start gap-2.5">
                    <BankLogo issuer={issuerForDisplay(card.institution, card.name) ?? card.name} className="h-12 w-12 shrink-0" />
                    <div className="min-w-0 flex-1 pt-1">
                      <p className="truncate text-xs text-sky-200/80">{issuerForDisplay(card.institution, card.name) ?? "Emissor não informado"}</p>
                      <h3 className="truncate text-sm font-bold" title={card.name}>{card.name}</h3>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-slate-300 hover:text-white" aria-label={`Editar ${card.name}`} title="Editar cartão" onClick={() => { setEditing(card); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                  </div>
                  <p className="relative mt-4 whitespace-nowrap font-mono text-[13px] tracking-[0.12em] text-slate-200" aria-label={card.last_four_digits ? `Cartão final ${card.last_four_digits}` : "Últimos dígitos não informados"}>•••• •••• •••• {card.last_four_digits ?? "••••"}</p>
                  <div className="relative mt-3 flex items-end justify-between gap-3 pr-1">
                    <div className="flex gap-5">
                      <div><p className="text-[10px] uppercase tracking-wide text-sky-200/70">Fechamento</p><p className="text-xs font-semibold">Dia {card.closing_day}</p></div>
                      <div><p className="text-[10px] uppercase tracking-wide text-sky-200/70">Vencimento</p><p className="text-xs font-semibold">Dia {card.due_day}</p></div>
                    </div>
                    <BrandLogo brand={card.brand} className="h-8 w-14 shrink-0" />
                  </div>
                  <div className="relative mt-3 rounded-xl border border-white/5 bg-white/[0.045] px-3 py-2.5">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="min-w-0"><p className="text-[10px] uppercase tracking-wide text-sky-200/70">Limite total</p><p className="truncate text-sm font-bold" title={brl(limit)}>{brl(limit)}</p></div>
                      <div className="min-w-0"><p className="text-[10px] uppercase tracking-wide text-sky-200/70">Utilizado</p><p className="truncate text-sm font-bold" title={brl(utilized)}>{brl(utilized)}</p></div>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-600/50" role="progressbar" aria-label={`Limite utilizado de ${card.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(utilizationPercent)}>
                      <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500" style={{ width: `${utilizationPercent}%` }} />
                    </div>
                    <p className="mt-1.5 text-[11px] text-emerald-400">Disponível: <strong>{brl(available)}</strong></p>
                  </div>
                  <div className="relative mt-3 flex items-end justify-between gap-3 border-t border-sky-300/15 pt-2.5">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wide text-sky-200/75">Próxima fatura{upcoming ? ` · ${formatDateBR(upcoming.due_date).slice(3)}` : ""}</p>
                      <p className="text-base font-bold">{brl(upcoming ? invoiceTotal(upcoming.id) : 0)}</p>
                      <p className="text-[10px] text-slate-400">{upcoming ? `Vence ${formatDateBR(upcoming.due_date)}` : "Sem fatura com valor registrado"}</p>
                    </div>
                    <Button variant="ghost" size="sm" className="shrink-0 px-1 text-xs text-sky-200 hover:text-white" onClick={() => setDetailCardId(card.id)}>Abrir cartão <ChevronRight className="ml-1 h-4 w-4" /></Button>
                  </div>
                </article>
              );
            })}
          </div>
          <section className="mt-5 min-w-0 rounded-2xl border border-border bg-card p-4 shadow-sm lg:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-lg font-semibold">Evolução consolidada</h2><p className="text-xs text-muted-foreground">Faturas registradas de todos os cartões · histórico e próximos vencimentos</p></div>
              <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">8 meses</span>
            </div>
            <div className="h-72 w-full" role="img" aria-label="Evolução consolidada de faturas por mês">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={overviewChartData} margin={{ top: 38, right: 30, left: 10, bottom: 10 }}>
                  <CartesianGrid stroke="currentColor" strokeOpacity={0.1} vertical={false} strokeDasharray="3 5" />
                  <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                  <YAxis width={85} tick={{ fill: "#94a3b8", fontSize: 12 }} tickFormatter={(v: number) => `R$ ${Math.round(v).toLocaleString("pt-BR")}`} />
                  <Tooltip formatter={(value) => brl(Number(value))} contentStyle={{ background: "#0f172a", color: "#f8fafc", border: "1px solid #334155", borderRadius: 12 }} />
                  <Area dataKey="total" type="linear" fill="#38bdf8" fillOpacity={0.08} stroke="none" legendType="none" tooltipType="none" />
                  <Line dataKey="total" type="linear" stroke="#38bdf8" strokeWidth={3} dot={{ r: 4, fill: "#38bdf8" }} activeDot={{ r: 6 }} isAnimationActive={false}>
                    <LabelList dataKey="total" position="top" offset={12} fontSize={11} fill="#cbd5e1" content={(props) => {
                      const x = Number(props.x);
                      const y = Number(props.y);
                      const value = Number(props.value);
                      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(value)) return null;
                      return <text x={x} y={y - 12} textAnchor="middle" fill="#cbd5e1" fontSize={11}>{brl(value)}</text>;
                    }} />
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground">Meses sem fatura cadastrada são exibidos como zero; não são projeções de novas compras.</p>
          </section>
        </>
      )}

      </>}

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Excluir lançamento?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">A compra “{deleting?.description}” será enviada à lixeira. A ação afeta este lançamento; outras parcelas ou recorrências não serão excluídas automaticamente.</p>
          <DialogFooter><Button variant="outline" onClick={() => setDeleting(null)}>Cancelar</Button><Button variant="destructive" onClick={() => void confirmDelete()}><Trash2 className="mr-2 h-4 w-4" />Excluir lançamento</Button></DialogFooter>
        </DialogContent>
      </Dialog>

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
      <CardTransactionEditDialog
        transaction={editingTransaction}
        onClose={() => setEditingTransaction(null)}
        onSaved={() => { setEditingTransaction(null); invalidate(); }}
      />
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
              <SelectTrigger>
                <SelectValue placeholder="Selecione a conta" />
              </SelectTrigger>
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
              <Input
                id="pd"
                type="date"
                value={paidDate}
                onChange={(e) => setPaidDate(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Ao confirmar, o valor é debitado da conta e todos os lançamentos da fatura passam para
            “pago”.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              Confirmar pagamento
            </Button>
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
  const invalidate = useInvalidateFinance();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftCategory, setDraftCategory] = useState("__none__");
  const [draftNature, setDraftNature] = useState<"fixo" | "variavel">("variavel");
  const [saving, setSaving] = useState(false);

  const rows = data
    ? transactions
        .filter((t) => t.invoice_id === data.invoice.id && t.type === "despesa" && notCancelled(t))
        .sort((a, b) => a.competence_date.localeCompare(b.competence_date))
    : [];
  const total = rows.reduce((s, t) => s + Number(t.amount), 0);
  const categoryOptions = categories
    .filter((category) => category.kind === "despesa" && !category.parent_id)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .flatMap((parent) => [
      { id: parent.id, label: parent.name },
      ...categories
        .filter((category) => category.parent_id === parent.id && category.kind === "despesa")
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
        .map((category) => ({ id: category.id, label: `— ${category.name}` })),
    ]);

  function beginEdit(transaction: Transaction) {
    setEditingId(transaction.id);
    setDraftCategory(transaction.category_id ?? "__none__");
    setDraftNature(transaction.expense_nature === "fixo" ? "fixo" : "variavel");
  }

  async function saveClassification(transaction: Transaction) {
    if (!data || saving) return;
    setSaving(true);
    try {
      // Somente classificação: preserva fatura paga, valor, datas, situação e cartão.
      const { error } = await supabase
        .from("transactions")
        .update({
          category_id: draftCategory === "__none__" ? null : draftCategory,
          expense_nature: draftNature,
        })
        .eq("id", transaction.id)
        .eq("family_id", transaction.family_id)
        .eq("invoice_id", data.invoice.id)
        .eq("type", "despesa");
      if (error) throw error;
      invalidate();
      setEditingId(null);
      toast.success("Classificação da compra atualizada");
    } catch (error) {
      toast.error("Não foi possível atualizar a classificação", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  function close() {
    if (saving) return;
    setEditingId(null);
    onClose();
  }

  return (
    <Dialog open={!!data} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Fatura {data?.card.name} · {formatDateBR(data?.invoice.due_date).slice(3)}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Corrija a categoria e a classificação fixa/variável de compras antigas, inclusive em
          faturas pagas. O pagamento, os valores e as datas não serão alterados.
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum lançamento nesta fatura.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 font-medium">Descrição</th>
                  <th className="py-2 font-medium">Categoria</th>
                  <th className="py-2 font-medium">Classificação</th>
                  <th className="py-2 font-medium">Compra</th>
                  <th className="py-2 text-right font-medium">Valor</th>
                  <th className="py-2 text-right font-medium">Ação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((transaction) => (
                  <Fragment key={transaction.id}>
                    <tr className="border-t border-border/60">
                      <td className="py-2 text-foreground">{transaction.description}</td>
                      <td className="py-2 text-muted-foreground">
                        {categoryPath(categories, transaction.category_id)}
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {transaction.expense_nature === "fixo"
                          ? "Fixa"
                          : transaction.expense_nature === "variavel"
                            ? "Variável"
                            : "Sem classificação"}
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {formatDateBR(transaction.competence_date)}
                      </td>
                      <td className="py-2 text-right font-medium text-foreground">
                        {brl(Number(transaction.amount))}
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={saving}
                          onClick={() =>
                            editingId === transaction.id ? setEditingId(null) : beginEdit(transaction)
                          }
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
                        </Button>
                      </td>
                    </tr>
                    {editingId === transaction.id && (
                      <tr key={`${transaction.id}-edit`} className="bg-muted/30">
                        <td colSpan={6} className="p-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label>Categoria da compra</Label>
                              <Select value={draftCategory} onValueChange={setDraftCategory}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">Sem categoria</SelectItem>
                                  {categoryOptions.map((category) => (
                                    <SelectItem key={category.id} value={category.id}>
                                      {category.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label>Tipo de despesa</Label>
                              <Select
                                value={draftNature}
                                onValueChange={(value) =>
                                  setDraftNature(value as "fixo" | "variavel")
                                }
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="fixo">Fixa</SelectItem>
                                  <SelectItem value="variavel">Variável</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="mt-3 flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={saving}
                              onClick={() => setEditingId(null)}
                            >
                              Cancelar
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              disabled={saving}
                              onClick={() => void saveClassification(transaction)}
                            >
                              {saving ? "Salvando..." : "Salvar classificação"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                <tr className="border-t border-border">
                  <td className="py-2 font-medium text-foreground" colSpan={4}>Total</td>
                  <td className="py-2 text-right font-semibold text-foreground">{brl(total)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
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
  const [institution, setInstitution] = useState("");
  const [brand, setBrand] = useState("");
  const [lastFourDigits, setLastFourDigits] = useState("");
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
    setInstitution(card?.institution ?? "");
    setBrand(card?.brand ?? "");
    setLastFourDigits(card?.last_four_digits ?? "");
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
    if (lastFourDigits && !/^\d{4}$/.test(lastFourDigits)) {
      toast.error("Informe exatamente 4 dígitos ou deixe em branco.");
      return;
    }
    const payload = {
      name: name.trim(),
      institution: institution.trim() || null,
      brand: brand.trim() || null,
      last_four_digits: lastFourDigits || null,
      credit_limit: limit || 0,
      closing_day: Number(closingDay),
      due_day: Number(dueDay),
      payment_account_id: paymentAccount === "none" ? null : paymentAccount,
      is_active: isActive,
    };
    const { error } = card
      ? await supabase.from("credit_cards").update(payload).eq("id", card.id)
      : await supabase.from("credit_cards").insert({ ...payload, family_id: familyId });
    if (error) {
      const details = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
      const missingColumn = /last_four_digits/i.test(details) && (/column|schema cache|not find|does not exist|unknown/i.test(details));
      toast.error("Não foi possível salvar o cartão", {
        description: missingColumn
          ? "O Supabase ainda não possui a coluna last_four_digits. Aplique a migração 20261126153000 antes de salvar os quatro dígitos."
          : error.message || "Verifique o acesso ao banco e os dados do cartão.",
        duration: 10000,
      });
    }
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
            <Label htmlFor="ci">Banco emissor / Instituição</Label>
            <div className="flex items-center gap-2">
              <BankLogo issuer={institution || "Outro"} className="h-10 w-10" />
              <Input id="ci" list="card-institution-suggestions" placeholder="Busque ou digite. Ex.: Itaú, Riachuelo" value={institution} onChange={(e) => setInstitution(e.target.value)} />
            </div>
            <datalist id="card-institution-suggestions">{BANK_SUGGESTIONS.map((bank) => <option key={bank} value={bank} />)}</datalist>
            <p className="text-xs text-muted-foreground">Escolha uma sugestão ou digite livremente. Emissores sem logo recebem iniciais.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cn">Nome do cartão</Label>
            <Input id="cn" required placeholder="Ex.: Infinity, Latam Pass, Cartão da loja" value={name} onChange={(e) => setName(e.target.value)} />
            <p className="text-xs text-muted-foreground">Identifica o cartão separadamente do banco. Você pode ter vários cartões do mesmo emissor.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="card-last-four">Últimos 4 dígitos</Label>
            <Input
              id="card-last-four"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              autoComplete="off"
              placeholder="Ex.: 9960"
              value={lastFourDigits}
              onChange={(e) => setLastFourDigits(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
            <p className="text-xs text-muted-foreground">Opcional. Somente os quatro últimos números serão armazenados e exibidos no cartão.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="cb">Bandeira</Label>
              <div className="flex items-center gap-2"><Input id="cb" list="card-brand-suggestions" placeholder="Ex.: Visa" value={brand} onChange={(e) => setBrand(e.target.value)} /><BrandLogo brand={brand} /></div>
              <datalist id="card-brand-suggestions">{BRAND_SUGGESTIONS.map((item) => <option key={item} value={item} />)}</datalist>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cl">Limite</Label>
              <CurrencyInput id="cl" value={limit} onValueChange={setLimit} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cf">Dia de fechamento</Label>
              <Input
                id="cf"
                type="number"
                min={1}
                max={31}
                value={closingDay}
                onChange={(e) => setClosingDay(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cv">Dia de vencimento</Label>
              <Input
                id="cv"
                type="number"
                min={1}
                max={31}
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Conta de pagamento</Label>
            <Select value={paymentAccount} onValueChange={setPaymentAccount}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Definir na hora do pagamento</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <Label htmlFor="cact" className="text-sm font-normal">
              Cartão ativo
            </Label>
            <Switch id="cact" checked={isActive} onCheckedChange={setIsActive} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit">Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

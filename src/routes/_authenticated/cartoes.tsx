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
import { brl, formatDateBR, toISODate } from "@/lib/format";
import type { CreditCard } from "@/lib/finance";
import { notCancelled } from "@/lib/derive";
import {
  useAccounts,
  useCards,
  useInvalidateFinance,
  useInvoices,
  useProfile,
  useTransactions,
} from "@/lib/queries";
import { payInvoice } from "@/lib/transactions";

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

  const invoiceTotal = (invoiceId: string) =>
    transactions
      .filter((t) => t.invoice_id === invoiceId && t.type === "despesa" && notCancelled(t))
      .reduce((s, t) => s + Number(t.amount), 0);

  async function handlePay(invoiceId: string, cardId: string, amount: number) {
    const card = cards.find((c) => c.id === cardId);
    const accountId = card?.payment_account_id ?? accounts[0]?.id;
    if (!accountId) {
      toast.error("Cadastre uma conta para pagar a fatura");
      return;
    }
    try {
      await payInvoice({
        invoiceId,
        accountId,
        amount,
        date: toISODate(new Date()),
        familyId: profile?.family_id ?? "",
        description: `Pagamento fatura ${card?.name ?? ""}`.trim(),
      });
      invalidate();
      toast.success("Fatura paga");
    } catch {
      toast.error("Não foi possível pagar a fatura");
    }
  }

  return (
    <div>
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

      {cards.length === 0 ? (
        <EmptyState title="Nenhum cartão cadastrado" hint="Cadastre um cartão para lançar compras parceladas." />
      ) : (
        <div className="space-y-4">
          {cards.map((card) => {
            const cardInvoices = invoices
              .filter((i) => i.credit_card_id === card.id)
              .sort((a, b) => b.reference_month.localeCompare(a.reference_month))
              .slice(0, 6);
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
                    <p className="text-sm text-muted-foreground">Nenhuma fatura gerada ainda.</p>
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
                          {inv.status === "paga" ? (
                            <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">
                              Paga
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={total <= 0}
                              onClick={() => handlePay(inv.id, card.id, total)}
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
    </div>
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
  const [limit, setLimit] = useState("0");
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
    setLimit(String(card?.credit_limit ?? 0));
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
      credit_limit: Number(limit.replace(",", ".")) || 0,
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
              <Input id="cl" value={limit} onChange={(e) => setLimit(e.target.value)} />
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
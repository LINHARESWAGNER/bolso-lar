import { useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, ChevronRight, CreditCard as CreditCardIcon, Pencil, ReceiptText, Trash2 } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, LabelList, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { brl, formatDateBR } from "@/lib/format";
import type { CreditCard, Invoice, Transaction } from "@/lib/finance";
import { notCancelled } from "@/lib/derive";
import { BankLogo, BrandLogo, issuerForDisplay } from "@/components/card-brand-logo";

type Props = {
  card: CreditCard;
  invoices: Invoice[];
  transactions: Transaction[];
  onBack: () => void;
  onEditCard: () => void;
  onPay: (invoice: Invoice, total: number) => void;
  onReverse: (invoice: Invoice) => void;
  onEditTransaction: (transaction: Transaction) => void;
  onDeleteTransaction: (transaction: Transaction) => void;
};

function monthLabel(date: string) {
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" })
    .format(new Date(`${date.slice(0, 7)}-01T12:00:00Z`))
    .replace(" de ", "/");
}
function statusLabel(value: Invoice["status"]) {
  return value === "paga" ? "Paga" : value === "fechada" ? "Fechada" : "Aberta";
}

export function CreditCardDetailDashboard({
  card, invoices, transactions, onBack, onEditCard, onPay, onReverse,
  onEditTransaction, onDeleteTransaction,
}: Props) {
  const cardInvoices = useMemo(() => invoices
    .filter((invoice) => invoice.credit_card_id === card.id)
    .sort((a, b) => a.due_date.localeCompare(b.due_date)), [invoices, card.id]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const current = cardInvoices.find((i) => i.id === selectedId)
    ?? cardInvoices.find((i) => i.status !== "paga" && i.due_date >= today)
    ?? cardInvoices.find((i) => i.status !== "paga")
    ?? cardInvoices[cardInvoices.length - 1];
  const expenseRows = useMemo(() => transactions.filter((t) =>
    t.type === "despesa" && notCancelled(t) && !!t.invoice_id,
  ), [transactions]);
  const totalById = useMemo(() => {
    const totals = new Map<string, number>();
    for (const tx of expenseRows) totals.set(tx.invoice_id!, (totals.get(tx.invoice_id!) ?? 0) + Number(tx.amount));
    return totals;
  }, [expenseRows]);
  const chartData = cardInvoices.map((invoice) => ({
    id: invoice.id,
    month: monthLabel(invoice.due_date),
    total: totalById.get(invoice.id) ?? 0,
    status: invoice.status,
    due: invoice.due_date,
    selected: invoice.id === current?.id,
  }));
  const selectedRows = expenseRows
    .filter((tx) => tx.invoice_id === current?.id)
    .filter((tx) => !search || tx.description.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")))
    .sort((a, b) => b.competence_date.localeCompare(a.competence_date));
  const outstanding = cardInvoices.filter((i) => i.status !== "paga")
    .reduce((sum, i) => sum + (totalById.get(i.id) ?? 0), 0);
  const available = Number(card.credit_limit) - outstanding;
  const total = current ? totalById.get(current.id) ?? 0 : 0;
  const selectedStatus = current?.status;

  return (
    <div className="space-y-4 pb-6">
      <Button variant="ghost" onClick={onBack} className="gap-2"><ArrowLeft className="h-4 w-4" /> Voltar à visão geral</Button>
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm lg:p-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex min-w-[220px] items-center gap-3">
            <BankLogo issuer={issuerForDisplay(card.institution, card.name) ?? card.name} className="h-14 w-14" />
            <div><p className="text-xs text-muted-foreground">{issuerForDisplay(card.institution, card.name) ?? "Emissor não informado"}</p><h2 className="text-lg font-semibold">{card.name}</h2><p className="text-xs text-muted-foreground">Cartão {card.is_active ? "ativo" : "inativo"}{card.last_four_digits ? ` · Final ${card.last_four_digits}` : ""}</p></div>
            <BrandLogo brand={card.brand} className="h-8 w-12" />
          </div>
          <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
            <div><p className="text-xs text-muted-foreground">Fatura selecionada</p><p className="font-semibold">{current ? monthLabel(current.due_date) : "Sem faturas"}</p><p className="text-xl font-bold">{brl(total)}</p><p className="text-xs text-emerald-500">{current ? statusLabel(current.status) : "—"}</p></div>
            <div><p className="text-xs text-muted-foreground">Fechamento</p><p className="font-semibold">{current ? formatDateBR(current.closing_date) : `Dia ${card.closing_day}`}</p></div>
            <div><p className="text-xs text-muted-foreground">Vencimento</p><p className="font-semibold">{current ? formatDateBR(current.due_date) : `Dia ${card.due_day}`}</p></div>
            <div><p className="text-xs text-muted-foreground">Limite disponível</p><p className="font-semibold text-emerald-500">{brl(available)}</p><p className="text-xs text-muted-foreground">de {brl(Number(card.credit_limit))}</p></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onEditCard}><Pencil className="mr-2 h-4 w-4" />Editar cartão</Button>
            {current && (selectedStatus === "paga"
              ? <Button variant="outline" onClick={() => onReverse(current)}>Estornar</Button>
              : <Button disabled={total <= 0} onClick={() => onPay(current, total)}>Pagar fatura</Button>)}
          </div>
        </div>
      </section>

      <section className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-sm lg:p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div><h3 className="text-lg font-semibold">Evolução das Faturas <span className="text-xs font-normal text-muted-foreground">· {chartData.length} meses</span></h3>
            <p className="text-xs text-muted-foreground">Histórico e lançamentos futuros cadastrados. Clique no mês ou ponto do gráfico para ver as movimentações.</p></div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground"><span className="text-sky-400">● Pagas</span><span className="text-emerald-500">● Aberta/fechada</span><span className="text-amber-500">● Vencimentos futuros</span></div>
        </div>
        {chartData.length ? <div className="h-[350px] w-full" role="region" aria-label="Gráfico das faturas por mês">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 44, right: 22, left: 12, bottom: 10 }} onClick={(state) => {
              const row = state?.activePayload?.[0]?.payload as (typeof chartData)[number] | undefined;
              if (row?.id) setSelectedId(row.id);
            }}>
              <CartesianGrid stroke="currentColor" strokeOpacity={0.10} vertical={false} strokeDasharray="3 5" />
              <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 12 }} interval={0} />
              <YAxis width={85} tick={{ fill: "#94a3b8", fontSize: 12 }} tickFormatter={(v: number) => `R$ ${Math.round(v).toLocaleString("pt-BR")}`} />
              <Tooltip formatter={(value) => brl(Number(value))} labelFormatter={(_, payload) => {
                const row = payload?.[0]?.payload as (typeof chartData)[number] | undefined;
                return row ? `${monthLabel(row.due)} · ${statusLabel(row.status)}` : "";
              }} contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 12, color: "#f8fafc" }} />
              <Area dataKey="total" type="linear" fill="#38bdf8" fillOpacity={0.09} stroke="none" legendType="none" tooltipType="none" />
              <Line type="linear" dataKey="total" stroke="#38bdf8" strokeWidth={3} isAnimationActive={false}
                activeDot={{ r: 8, stroke: "#fff", strokeWidth: 2 }}
                dot={(props: { cx?: number; cy?: number; payload?: (typeof chartData)[number] }) => {
                  const { cx = 0, cy = 0, payload } = props;
                  const selected = payload?.selected;
                  const fill = payload?.status === "paga" ? "#38bdf8" : payload?.due && payload.due > today ? "#f59e0b" : "#10b981";
                  return <circle key={payload?.id} cx={cx} cy={cy} r={selected ? 7 : 5} fill={fill} stroke={selected ? "white" : "#0f172a"} strokeWidth={selected ? 3 : 2} style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); if (payload?.id) setSelectedId(payload.id); }} />;
                }}>
                <LabelList dataKey="total" content={(props) => {
                  const index = Number(props.index ?? -1);
                  const entry = chartData[index];
                  if (!entry || !(entry.selected || chartData.length <= 12 || index % 2 === 0)) return null;
                  const x = Number(props.x);
                  const y = Number(props.y);
                  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                  const amount = Number(props.value ?? entry.total);
                  return <text key={entry.id} x={x} y={y - 13} textAnchor="middle" fontSize={10} fontWeight={entry.selected ? 700 : 500} fill={entry.selected ? "#6ee7b7" : "#cbd5e1"}>{brl(amount)}</text>;
                }} />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
        </div> : <p className="py-16 text-center text-sm text-muted-foreground">Ainda não há faturas para apresentar no gráfico.</p>}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm lg:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="text-lg font-semibold">Movimentações da Fatura {current ? monthLabel(current.due_date) : ""}</h3><p className="text-xs text-muted-foreground">Compras e parcelas efetivamente registradas neste ciclo</p></div>
          <Input className="w-full sm:w-60" aria-label="Buscar lançamento" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar lançamento..." />
        </div>
        {selectedRows.length ? <div className="divide-y divide-border/60">
          {selectedRows.map((tx) => <div key={tx.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><ReceiptText className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{tx.description}</p><p className="text-xs text-muted-foreground">Compra {formatDateBR(tx.competence_date)} · {tx.status === "pago" ? "Pago" : "Previsto"}</p></div>
            <strong className="text-sm">{brl(Number(tx.amount))}</strong>
            <div className="flex gap-1"><Button size="icon" variant="ghost" aria-label={`Editar ${tx.description}`} title="Editar lançamento" onClick={() => onEditTransaction(tx)}><Pencil className="h-4 w-4" /></Button>
              {current?.status !== "paga" && <Button size="icon" variant="ghost" aria-label={`Excluir ${tx.description}`} title="Excluir lançamento" onClick={() => onDeleteTransaction(tx)}><Trash2 className="h-4 w-4" /></Button>}</div>
          </div>)}
        </div> : <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><CreditCardIcon className="h-4 w-4" />Nenhum lançamento nesta fatura{search ? " com essa busca" : ""}.</div>}
        {current && <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-4 text-sm"><span className="text-muted-foreground">Total registrado na fatura</span><strong>{brl(total)}</strong></div>}
        <p className="mt-3 text-xs text-muted-foreground">{current?.status === "paga"
          ? "Fatura paga: não é permitido excluir lançamentos ou alterar valores. Você ainda pode ajustar categoria e classificação pelo ícone de edição."
          : "Fatura em andamento: editar abre o lançamento completo. Compras parceladas com parcelas já pagas têm o valor protegido."}</p>
      </section>
    </div>
  );
}

import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight, HandCoins, Scale } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, StatusBadge } from "@/components/ui-bits";
import { brl, formatDateBR, toISODate } from "@/lib/format";
import { categoryPath, isThirdPartyTransaction, notCancelled } from "@/lib/derive";
import { useCategories, useTransactions } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/terceiros")({
  head: () => ({ meta: [{ title: "Compras para terceiros — Finanças da Família" }] }),
  component: Terceiros,
});

function Terceiros() {
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const now = new Date();
  const [from, setFrom] = useState(toISODate(new Date(now.getFullYear(), 0, 1)));
  const [to, setTo] = useState(toISODate(new Date(now.getFullYear(), 11, 31)));

  const rows = useMemo(
    () =>
      transactions
        .filter((transaction) => {
          if (!notCancelled(transaction) || !isThirdPartyTransaction(categories, transaction))
            return false;
          const date = transaction.paid_date ?? transaction.due_date ?? transaction.competence_date;
          return date >= from && date <= to;
        })
        .sort((a, b) => {
          const left = a.paid_date ?? a.due_date ?? a.competence_date;
          const right = b.paid_date ?? b.due_date ?? b.competence_date;
          return right.localeCompare(left);
        }),
    [transactions, categories, from, to],
  );

  const purchases = rows
    .filter((transaction) => transaction.type === "despesa")
    .reduce((total, transaction) => total + Number(transaction.amount), 0);
  const reimbursements = rows
    .filter((transaction) => transaction.type === "receita")
    .reduce((total, transaction) => total + Number(transaction.amount), 0);
  const outstanding = purchases - reimbursements;

  return (
    <div>
      <PageHeader
        title="Compras para terceiros"
        subtitle="Valores de passagem, separados da jornada financeira da família"
        actions={
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="third-from" className="text-xs">
                De
              </Label>
              <Input
                id="third-from"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="third-to" className="text-xs">
                Até
              </Label>
              <Input
                id="third-to"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
          </div>
        }
      />

      <section className="mb-5 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
        <div className="flex items-start gap-3">
          <HandCoins className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="font-medium">Como funciona</p>
            <p className="mt-1 text-muted-foreground">
              Despesas e receitas categorizadas como “Compra para terceiros” aparecem aqui. Elas não
              entram no planejamento, orçamento, painel, fluxo de caixa ou relatórios da família.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Compras registradas"
          value={purchases}
          icon={ArrowUpRight}
          tone="negative"
        />
        <SummaryCard
          label="Devoluções registradas"
          value={reimbursements}
          icon={ArrowDownLeft}
          tone="positive"
        />
        <SummaryCard
          label="Diferença a receber"
          value={outstanding}
          icon={Scale}
          tone={outstanding > 0 ? "warning" : "default"}
        />
      </section>

      <section className="mt-5 overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-2 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Movimentações de terceiros</h2>
            <p className="text-sm text-muted-foreground">{rows.length} registro(s) no período</p>
          </div>
          <Link
            to="/lancamentos"
            search={{ type: "todos", status: "todos", nature: "todos" }}
            className="text-sm font-medium text-primary"
          >
            Registrar ou editar movimentação
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-3">Data</th>
                <th className="p-3">Descrição</th>
                <th className="p-3">Categoria</th>
                <th className="p-3">Situação</th>
                <th className="p-3 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((transaction) => (
                <tr key={transaction.id} className="border-t border-border">
                  <td className="p-3">
                    {formatDateBR(
                      transaction.paid_date ?? transaction.due_date ?? transaction.competence_date,
                    )}
                  </td>
                  <td className="p-3">
                    <p className="font-medium">{transaction.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {transaction.type === "receita" ? "Devolução recebida" : "Compra realizada"}
                    </p>
                  </td>
                  <td className="p-3">{categoryPath(categories, transaction.category_id)}</td>
                  <td className="p-3">
                    <StatusBadge status={transaction.status} />
                  </td>
                  <td
                    className={`p-3 text-right font-medium ${transaction.type === "receita" ? "text-success" : "text-destructive"}`}
                  >
                    {brl(Number(transaction.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Nenhuma compra ou devolução para terceiros neste período.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Scale;
  tone: "positive" | "negative" | "warning" | "default";
}) {
  const toneClass =
    tone === "positive"
      ? "text-success"
      : tone === "negative"
        ? "text-destructive"
        : tone === "warning"
          ? "text-warning"
          : "";
  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className={`mt-2 text-xl font-semibold ${toneClass}`}>{brl(value)}</p>
    </article>
  );
}

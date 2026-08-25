import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/ui-bits";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brl, brlCompact, shortMonth, toISODate } from "@/lib/format";
import { monthRange } from "@/lib/finance";
import {
  cashBalance,
  notCancelled,
  outflowKind,
  variableBudgetForMonth,
  variableExpensesForMonth,
} from "@/lib/derive";
import { useAccounts, useTransactions, useVariableBudgets } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/fluxo-de-caixa")({
  head: () => ({
    meta: [
      { title: "Fluxo de caixa — Finanças da Família" },
      {
        name: "description",
        content: "Projeção de saldo futuro com base em lançamentos previstos.",
      },
      { property: "og:title", content: "Fluxo de caixa — Finanças da Família" },
      {
        property: "og:description",
        content: "Projeção de saldo futuro com base em lançamentos previstos.",
      },
    ],
  }),
  component: FluxoDeCaixa,
});

function FluxoDeCaixa() {
  const { data: accounts = [] } = useAccounts();
  const { data: transactions = [] } = useTransactions();
  const { data: variableBudgets = [] } = useVariableBudgets();
  const now = new Date();
  const [from, setFrom] = useState(toISODate(now));
  const [to, setTo] = useState(toISODate(new Date(now.getFullYear(), now.getMonth() + 7, 0)));

  const saldoInicial = useMemo(() => cashBalance(accounts, transactions), [accounts, transactions]);

  const rows = useMemo(() => {
    const now = new Date();
    const currentKey = now.getFullYear() * 12 + now.getMonth();
    const fromDate = new Date(`${from}T00:00:00`);
    const toDate = new Date(`${to}T00:00:00`);
    if (toDate < fromDate) return [];
    const firstKey = fromDate.getFullYear() * 12 + fromDate.getMonth();
    const lastKey = toDate.getFullYear() * 12 + toDate.getMonth();
    let running = saldoInicial;
    const out: {
      key: string;
      label: string;
      entradas: number;
      recorrente: number;
      pontual: number;
      parcelado: number;
      orcamento: number;
      saidas: number;
      resultado: number;
      saldo: number;
    }[] = [];
    for (let key = firstKey; key <= lastKey; key++) {
      const d = new Date(Math.floor(key / 12), key % 12, 1);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const { start, end } = monthRange(year, month);
      const scoped = transactions.filter((t) => {
        if (!notCancelled(t) || t.status === "pago") return false;
        const day = t.due_date ?? t.competence_date;
        return day >= start && day <= end && day >= from && day <= to;
      });
      const entradas = scoped
        .filter((t) => t.type === "receita")
        .reduce((s, t) => s + Number(t.amount), 0);
      const saidasTx = scoped.filter((t) => t.type === "despesa" || t.type === "pagamento_fatura");
      const sum = (kind: "recorrente" | "parcelado" | "pontual") =>
        saidasTx.filter((t) => outflowKind(t) === kind).reduce((s, t) => s + Number(t.amount), 0);
      const recorrente = sum("recorrente");
      const parcelado = sum("parcelado");
      const pontual = sum("pontual");
      // Orçamento entra apenas em meses posteriores ao corrente, usando a
      // sobra planejada, para não contar duas vezes o que já foi lançado.
      const orcamento =
        year * 12 + (month - 1) >= currentKey
          ? Math.max(
              variableBudgetForMonth(variableBudgets, year, month).amount -
                variableExpensesForMonth(transactions, year, month).reduce(
                  (sum, t) => sum + Number(t.amount),
                  0,
                ),
              0,
            )
          : 0;
      const saidas = recorrente + parcelado + pontual + orcamento;
      running += entradas - saidas;
      out.push({
        key: start,
        label: `${shortMonth(month)}/${String(year).slice(2)}`,
        entradas,
        recorrente,
        pontual,
        parcelado,
        orcamento,
        saidas,
        resultado: entradas - saidas,
        saldo: running,
      });
    }
    return out;
  }, [transactions, variableBudgets, saldoInicial, from, to]);

  const negativos = rows.filter((r) => r.saldo < 0);

  return (
    <div>
      <PageHeader
        title="Fluxo de caixa"
        subtitle={`Saldo atual ${brl(saldoInicial)} · projeção com lançamentos previstos`}
        actions={
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="fluxo-de" className="text-xs">
                De
              </Label>
              <Input
                id="fluxo-de"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="fluxo-ate" className="text-xs">
                Até
              </Label>
              <Input
                id="fluxo-ate"
                type="date"
                min={from}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
        }
      />

      {negativos.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-sm text-foreground">
            Saldo projetado fica negativo em {negativos.length} mês(es), a partir de{" "}
            <strong>{negativos[0]?.label}</strong>.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows}>
              <defs>
                <linearGradient id="saldoFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" stroke="var(--color-muted-foreground)" fontSize={12} />
              <YAxis
                stroke="var(--color-muted-foreground)"
                fontSize={12}
                width={70}
                tickFormatter={(v) => brlCompact(Number(v))}
              />
              <Tooltip
                formatter={(v) => brl(Number(v))}
                contentStyle={{
                  background: "var(--color-popover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  color: "var(--color-popover-foreground)",
                }}
              />
              <Area
                type="monotone"
                dataKey="saldo"
                name="Saldo projetado"
                stroke="var(--color-chart-1)"
                fill="url(#saldoFill)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Mês</th>
                <th className="py-2 text-right font-medium">Entradas</th>
                <th className="py-2 text-right font-medium">Recorrente</th>
                <th className="py-2 text-right font-medium">Pontual</th>
                <th className="py-2 text-right font-medium">Parcelado cartão</th>
                <th className="py-2 text-right font-medium">Orçamento</th>
                <th className="py-2 text-right font-medium">Saídas</th>
                <th className="py-2 text-right font-medium">Resultado</th>
                <th className="py-2 text-right font-medium">Saldo projetado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-border/60">
                  <td className="py-2 text-foreground">{r.label}</td>
                  <td className="py-2 text-right text-success">{brl(r.entradas)}</td>
                  <td className="py-2 text-right text-muted-foreground">{brl(r.recorrente)}</td>
                  <td className="py-2 text-right text-muted-foreground">{brl(r.pontual)}</td>
                  <td className="py-2 text-right text-muted-foreground">{brl(r.parcelado)}</td>
                  <td className="py-2 text-right text-muted-foreground">{brl(r.orcamento)}</td>
                  <td className="py-2 text-right text-destructive">{brl(r.saidas)}</td>
                  <td
                    className={`py-2 text-right ${r.resultado >= 0 ? "text-foreground" : "text-destructive"}`}
                  >
                    {brl(r.resultado)}
                  </td>
                  <td
                    className={`py-2 text-right font-medium ${r.saldo < 0 ? "text-destructive" : "text-foreground"}`}
                  >
                    {brl(r.saldo)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

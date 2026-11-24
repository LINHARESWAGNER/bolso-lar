import { useMemo, useState } from "react";

type MonthlyCash = {
  key: string;
  revenue: number;
  expenses: number;
  adjustments: number;
  balance: number;
  past: boolean;
  current: boolean;
};

type CashView = {
  opening: number;
  rows: MonthlyCash[];
};

type ViewKey = "familia" | "terceiros" | "geral";

type Props = {
  year: number;
  views: Record<ViewKey, CashView>;
};

const money = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const shortMoney = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { maximumFractionDigits: 0, notation: "compact" });
const labels = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function PlanAResults({ year, views }: Props) {
  const [selectedView, setSelectedView] = useState<ViewKey>("geral");
  const { opening, rows } = views[selectedView];

  const points = useMemo(
    () => rows.map((row) => ({
      ...row,
      result: row.revenue - row.expenses + row.adjustments,
    })),
    [rows],
  );

  if (points.length !== 12) return null;

  const width = 1140;
  const height = 360;
  const left = 70;
  const right = 75;
  const top = 28;
  const bottom = 58;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const maxCash = Math.max(1, ...points.map((p) => Math.max(p.revenue, p.expenses)));
  const balances = [opening, ...points.map((p) => p.balance)];
  const minBalance = Math.min(0, ...balances);
  const maxBalance = Math.max(0, ...balances);
  const range = Math.max(100, maxBalance - minBalance);
  const balanceMin = minBalance - range * 0.12;
  const balanceMax = maxBalance + range * 0.12;
  const x = (i: number) => left + (i + 0.5) * plotW / 12;
  const yBar = (v: number) => top + plotH - Math.max(0, v) / maxCash * plotH;
  const yBalance = (v: number) => top + plotH - (v - balanceMin) / (balanceMax - balanceMin) * plotH;
  const barW = 16;

  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-label={`Resultados financeiros de ${year}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">
            4. Resultados · {year}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Receitas, pagamentos e saldo acumulado por mês.
          </p>
        </div>

        <div
          className="inline-flex rounded-lg border border-border bg-muted/40 p-1"
          role="group"
          aria-label="Selecionar visão financeira"
        >
          {([
            ["familia", "Família"],
            ["terceiros", "Terceiros"],
            ["geral", "Geral"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={selectedView === value}
              onClick={() => setSelectedView(value)}
              className={
                "rounded-md px-4 py-2 text-sm font-medium transition-colors " +
                (selectedView === value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background hover:text-foreground")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        {selectedView === "geral"
          ? "Geral: família e terceiros consolidados."
          : selectedView === "familia"
            ? "Família: movimentações familiares e reservas do orçamento variável."
            : "Terceiros: movimentações classificadas como terceiros; saldo líquido acumulado desde os registros disponíveis."}
      </p>
      <div className="overflow-x-auto">
        <svg className="min-w-[760px] w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Gráfico de receitas, pagamentos e saldo acumulado mês a mês">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const yy = top + plotH * (1 - t);
            return (
              <g key={t}>
                <line x1={left} x2={width - right} y1={yy} y2={yy} stroke="currentColor" opacity="0.10" strokeDasharray="4 4" />
                <text x={left - 10} y={yy + 4} textAnchor="end" fill="currentColor" opacity="0.60" fontSize="11">{shortMoney(maxCash * t)}</text>
                <text x={width - right + 12} y={yy + 4} textAnchor="start" fill="#60a5fa" opacity="0.75" fontSize="11">
                  {shortMoney(balanceMin + (balanceMax - balanceMin) * t)}
                </text>
              </g>
            );
          })}
          {points.map((p, i) => {
            const center = x(i);
            const colorRevenue = p.past ? "#16a34a" : "#4ade80";
            const colorExpenses = p.past ? "#dc2626" : "#fb7185";
            return (
              <g key={p.key}>
                {p.current && <rect x={center - 37} y={top} width="74" height={plotH} fill="#3b82f6" fillOpacity="0.07" rx="6" />}
                <rect x={center - barW - 2} y={yBar(p.revenue)} width={barW} height={top + plotH - yBar(p.revenue)} rx="2" fill={colorRevenue} opacity={p.past ? 1 : 0.7} />
                <rect x={center + 2} y={yBar(p.expenses)} width={barW} height={top + plotH - yBar(p.expenses)} rx="2" fill={colorExpenses} opacity={p.past ? 1 : 0.7} />
                <text x={center} y={height - 33} textAnchor="middle" fill="currentColor" opacity="0.8" fontSize="12" fontWeight={p.current ? 700 : 400}>{labels[i]}</text>
                {p.current && <text x={center} y={height - 17} textAnchor="middle" fill="#60a5fa" fontSize="9">Atual</text>}
                <title>{`${labels[i]}/${year} · ${p.past ? "Realizado" : p.current ? "Mês atual" : "Planejado"}\nReceitas: ${money(p.revenue)}\nPagamentos: ${money(p.expenses)}\nResultado: ${money(p.result)}\nSaldo acumulado: ${money(p.balance)}`}</title>
              </g>
            );
          })}
          {points.map((p, i) => {
            if (i === 0) return null;
            const previous = points[i - 1];
            if (!previous) return null;
            return <line key={`line-${p.key}`} x1={x(i - 1)} y1={yBalance(previous.balance)} x2={x(i)} y2={yBalance(p.balance)} stroke="#60a5fa" strokeWidth="2.8" strokeDasharray={p.past ? undefined : "6 5"} />;
          })}
          {points.map((p, i) => <circle key={`point-${p.key}`} cx={x(i)} cy={yBalance(p.balance)} r={p.current ? 5 : 3.5} stroke="#dbeafe" strokeWidth="1" fill="#3b82f6"><title>{`Saldo ${labels[i]}: ${money(p.balance)}`}</title></circle>)}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-green-500" /> Receitas</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-rose-500" /> Pagamentos</span>
        <span><span className="mr-1 inline-block h-0.5 w-5 align-middle bg-blue-400" /> Saldo acumulado</span>
        <span>Tracejado: estimativa</span>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Valores baseados nos registros e orçamentos atualmente disponíveis. Compras no cartão entram no mês de pagamento da fatura; terceiros compõem o caixa integral.
        As reservas variáveis aprovadas são consideradas na projeção familiar. O saldo de terceiros representa seu movimento líquido acumulado e não um saldo bancário separado.
      </p>
    </section>
  );
}

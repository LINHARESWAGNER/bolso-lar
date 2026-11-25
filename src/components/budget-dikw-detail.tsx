import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight as ArrowNextMonth,
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Info,
  ListFilter,
  Target,
  X,
} from "lucide-react";
import { brl } from "@/lib/format";
import {
  buildBudgetForecast,
  type BudgetForecast,
  type ProjectionPreference,
  type RootForecast,
} from "@/lib/budget-forecast";
import type { HealthData } from "@/lib/financial-health";
import { buildBudgetHorizon, type HorizonAudit, type HorizonRhythm } from "@/lib/budget-horizon";
import type {
  BudgetAction,
  BudgetCategory,
  BudgetComparison,
  BudgetDIKW,
  BudgetLine,
  BudgetSnapshot,
} from "@/lib/budget-dikw";

type PeriodMode = "closed" | "current";
type EvidenceMode = "transactions" | "history" | "calculation" | "forecast";
type LineFilter = "all" | "pago" | "previsto";

const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${brl(Math.abs(n))}`;
const monthName = (start: string) => {
  const [year, month] = start.split("-");
  return `${month}/${year}`;
};
const confidenceText = {
  alta: "alta",
  media: "média",
  baixa: "baixa",
  insuficiente: "insuficiente",
} as const;
const stateClasses: Record<BudgetCategory["state"], string> = {
  dentro: "border-success/40 bg-success/5",
  proxima: "border-warning/50 bg-warning/5",
  acima: "border-destructive/50 bg-destructive/5",
  sem_orcamento: "border-warning/50 bg-warning/5",
  sem_consumo: "border-border bg-card",
};
const stateInk: Record<BudgetCategory["state"], string> = {
  dentro: "text-success",
  proxima: "text-warning",
  acima: "text-destructive",
  sem_orcamento: "text-warning",
  sem_consumo: "text-muted-foreground",
};

function summaryStatus(status: BudgetSnapshot["status"]) {
  if (status === "critico") return "Crítico";
  if (status === "atencao") return "Atenção";
  if (status === "saudavel") return "Saudável";
  return "Dados insuficientes";
}

function getProjectedState(
  category: BudgetCategory,
  mode: PeriodMode,
  forecast?: RootForecast,
): BudgetCategory["state"] {
  if (mode === "closed" || !forecast) return category.state;
  const projected = forecast.projected;
  const budget = forecast.budget;
  if (projected <= 0) return budget > 0 ? "sem_consumo" : "sem_consumo";
  if (budget <= 0) return "sem_orcamento";
  if (projected > budget) return "acima";
  if (projected >= budget * 0.9) return "proxima";
  return "dentro";
}

/** Evidencias lidas do mesmo resultado usado para compor a projecao. */
function ForecastAudit({ audit, rhythm, registered, additional, period }: {
  audit: HorizonAudit;
  rhythm: HorizonRhythm;
  registered: number;
  additional: number;
  period: string;
}) {
  const used = audit.sourceMonths.filter(month => month.includedInMedian);
  const method = audit.method === "caixa" ? "Mediana mensal por vencimento/pagamento"
    : audit.method === "compras" ? "Mediana mensal por data original da compra"
    : audit.method === "cadencia" ? "Frequência e valor típico de rotina comprovada"
    : "Sem modelo de projeção elegível";
  return <details className="mt-3 rounded-lg border border-border/70 bg-muted/10 p-3">
    <summary className="cursor-pointer font-semibold">Memória de cálculo · fontes e conciliação</summary>
    <div className="mt-3 space-y-3">
      <p><strong>Método:</strong> {method}. <strong>Data de referência:</strong> {audit.asOf}.</p>
      <p className="text-muted-foreground">{audit.note}</p>
      <div className="overflow-x-auto rounded-md border border-border/70">
        <table className="w-full min-w-[480px] text-left text-xs">
          <thead className="bg-muted/30"><tr><th className="p-2">Mês fechado</th><th className="p-2 text-right">Caixa</th><th className="p-2 text-right">Compras</th><th className="p-2 text-right">Lanç. caixa / compra</th><th className="p-2">Na mediana</th></tr></thead>
          <tbody>{audit.sourceMonths.map(month => <tr key={month.month} className="border-t border-border/60">
            <td className="p-2">{month.month.slice(5,7)}/{month.month.slice(0,4)}</td>
            <td className="p-2 text-right">{brl(month.cashTotal)}</td>
            <td className="p-2 text-right">{brl(month.purchaseTotal)}</td>
            <td className="p-2 text-right">{month.cashCount} / {month.purchaseCount}</td>
            <td className="p-2">{month.includedInMedian ? "Sim" : "Não"}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p><strong>Amostra selecionada:</strong> {used.length} mês(es) para a mediana mensal de três meses fechados.
        {audit.monthlyReference !== null ? ` Referência = ${brl(audit.monthlyReference)}.` : " Sem referência mensal calculada."}</p>
      {rhythm.patterns && rhythm.patterns.length > 0 && <div>
        <strong>Rotina e calibração</strong>
        {rhythm.patterns.map((pattern,index)=><p key={index} className="text-muted-foreground">{pattern.name}: {pattern.count} dia(s) observado(s), intervalo {pattern.intervalDays} dias, valor típico {brl(pattern.ticket)}</p>)}
        <p className="text-muted-foreground">Modelo: {rhythm.calibration?.method === "segmentado" ? "dois grupos de valores" : "um grupo"}; erro retroativo: {rhythm.calibration?.backtestSingleError === null || rhythm.calibration?.backtestSingleError === undefined ? "amostra insuficiente" : `${(rhythm.calibration.backtestSingleError*100).toFixed(1)}%`}.</p>
      </div>}
      <div className="rounded-md border border-border/70 p-2">
        <p><strong>Conciliação do mês {period}:</strong> registrados {brl(registered)} + adicional {brl(additional)} = {brl(registered+additional)}.</p>
        {audit.method === "caixa" || audit.method === "compras" ? <p className="text-muted-foreground">Estimativa adicional = máximo entre zero e (referência mensal − lançamentos registrados da subcategoria). Lançamentos já cadastrados não são substituídos.</p> : <p className="text-muted-foreground">O adicional soma apenas ocorrências futuras conciliadas e atribuídas a este mês de pagamento.</p>}
        <p className="text-muted-foreground">Cartão de referência: {rhythm.referenceCard??"não aplicável"}. Compras no cartão impactam o vencimento da fatura; contas diretas, o vencimento próprio.</p>
      </div>
      <p className="text-muted-foreground">Filtros aplicados: somente despesas consideradas por budgetSnapshot; sem parcelas na amostra de novas compras; cartão e pagamentos diretos quitados no histórico. Terceiros, cancelados, faturas/transferências e outras exclusões são tratados previamente na montagem do snapshot. Os totais abaixo não incluem registros excluídos nessa etapa anterior.</p>
      <p className="text-muted-foreground">Na amostra reunida: {audit.historyCount} lançamento(s) histórico(s) elegível(is); {audit.excludedInstallmentCount} parcela(s) e {audit.excludedFutureCount} compra(s) após a data-base fora da amostra de consumo; {audit.excludedUnpaidDirectCount} pagamento(s) direto(s) não quitado(s) fora da amostra histórica.</p>
      <details className="rounded-md border border-border/70 p-2">
        <summary className="cursor-pointer font-medium">Ver lançamentos dos meses de caixa ({audit.cashSourceLines.length})</summary>
        <p className="mt-2 text-muted-foreground">Estas são as linhas efetivas dos três snapshots fechados usados para calcular a coluna Caixa acima; podem representar compras realizadas em meses anteriores.</p>
        <div className="mt-2 max-h-72 overflow-auto">
          {audit.cashSourceLines.map((line,index)=><div key={`${line.id}-${index}`} className="flex justify-between gap-3 border-t border-border/60 py-2">
            <div><p className="font-medium">{line.description}</p><p className="text-muted-foreground">Caixa {line.cashDate} · compra {line.purchaseDate} · {line.channel === "cartao" ? "cartão" : "direto"} · {line.status}</p><p className="break-all text-muted-foreground">ID: {line.id}</p></div>
            <strong className="shrink-0">{brl(line.amount)}</strong>
          </div>)}
        </div>
      </details>
      <details className="rounded-md border border-border/70 p-2">
        <summary className="cursor-pointer font-medium">Ver lançamentos por data de compra ({audit.sourceLines.length})</summary>
        {audit.sourceLines.length ? <div className="mt-2 max-h-72 overflow-auto">
          {audit.sourceLines.map(line=><div key={line.id} className="flex justify-between gap-3 border-t border-border/60 py-2">
            <div><p className="font-medium">{line.description}</p><p className="text-muted-foreground">Compra {line.purchaseDate} · mês de caixa {line.cashDate} · {line.channel === "cartao" ? "cartão" : "direto"} · {line.status}</p><p className="break-all text-muted-foreground">ID: {line.id}</p></div>
            <strong className="shrink-0">{brl(line.amount)}</strong>
          </div>)}
        </div> : <p className="mt-2 text-muted-foreground">Sem lançamentos elegíveis.</p>}
      </details>
      <p className="text-muted-foreground">Esta auditoria é somente leitura e não cria lançamentos nem altera categorias. O mês atual usa o motor original de curto prazo; os seis meses futuros usam o cálculo do horizonte.</p>
    </div>
  </details>;
}

function SummaryValue({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-background/60 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold tabular-nums ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

function CategoryCard({
  category,
  mode,
  forecast,
  onEvidence,
  onForecast,
}: {
  category: BudgetCategory;
  mode: PeriodMode;
  forecast?: RootForecast | undefined;
  onEvidence: () => void;
  onForecast: () => void;
}) {
  const state = getProjectedState(category, mode, forecast);
  const value = mode === "current" && forecast ? forecast.projected : category.spent;
  const balance = category.budget - value;
  const utilization = category.budget > 0 ? (value / category.budget) * 100 : null;
  // Registrado inclui compras no cartao mesmo que a fatura ainda esteja prevista.
  // No mes atual, a marca indica o gasto cadastrado e a barra indica a projecao.
  const registered = mode === "current" ? (forecast?.registered ?? category.spent) : category.spent;
  const registeredPct = category.budget > 0 ? (registered / category.budget) * 100 : null;
  const tone =
    state === "acima"
      ? "bg-destructive"
      : state === "proxima" || state === "sem_orcamento"
        ? "bg-warning"
        : "bg-success";

  return (
    <article className={`min-w-0 rounded-xl border px-3 py-3 ${stateClasses[state]}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-sm font-semibold" title={category.name}>
          {category.name}
        </h3>
        <span className={`shrink-0 text-[11px] font-semibold ${stateInk[state]}`}>
          {utilization === null ? "Sem limite" : pct(utilization)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          Limite <strong className="text-foreground">{brl(category.budget)}</strong>
        </span>
        <span>
          {mode === "current" && forecast ? "Projeção" : "Registrado"}{" "}
          <strong className="text-foreground">{brl(value)}</strong>
        </span>
      </div>
      <div
        className="relative mt-2 h-1.5 rounded-full bg-muted"
        role="img"
        aria-label={`${category.name}: comprometido ${brl(value)}; limite ${brl(category.budget)}`}
      >
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: `${Math.max(0, Math.min(100, utilization ?? 0))}%` }}
        />
        {mode === "current" && forecast && registeredPct !== null && registered > 0 && (
          <span
            className="absolute top-1/2 z-10 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-sm border border-[#0b1728] bg-white shadow-[0_0_0_1px_rgba(255,255,255,0.7)]"
            style={{ left: `${Math.min(99.5, Math.max(0.5, registeredPct))}%` }}
            title={`Registrado até agora: ${brl(registered)} (${pct(registeredPct)} do limite). Inclui compras no cartão.`}
          />
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <strong
          className={
            balance < 0 || (category.budget === 0 && value > 0)
              ? "text-destructive"
              : "text-success"
          }
        >
          {category.budget <= 0 && value > 0
            ? `Sem limite · ${brl(value)}`
            : balance < 0
              ? `Excesso ${brl(-balance)}`
              : `Saldo ${brl(balance)}`}
        </strong>
        <div className="flex items-center gap-3">
          {mode === "current" && forecast && (
            <button
              type="button"
              onClick={onForecast}
              className="font-medium text-primary hover:underline"
            >
              Projeção
            </button>
          )}
          <button
            type="button"
            onClick={onEvidence}
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            Detalhar <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </article>
  );
}

function ComparisonRow({ item }: { item: BudgetComparison }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="font-semibold">{item.label}</p>
      {item.available ? (
        <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
          <p>
            Gasto de referência: <strong>{brl(item.spent ?? 0)}</strong>
          </p>
          <p>
            Diferença nos gastos: <strong>{signed(item.spentChange ?? 0)}</strong>
          </p>
          <p>Desvio de referência: {pct(item.deviation)}</p>
          <p>Variação do desvio: {item.deviationChange?.toFixed(1) ?? "—"} p.p.</p>
          <p>Melhoraram: {item.improved.join(", ") || "nenhuma identificada"}.</p>
          <p>Pioraram: {item.worsened.join(", ") || "nenhuma identificada"}.</p>
          <p className="sm:col-span-2">
            Novos estouros: {item.newlyOver.join(", ") || "nenhum identificado"}.
          </p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Comparação indisponível: {item.missing}.
        </p>
      )}
    </div>
  );
}

export function BudgetDIKWDetail({
  report,
  data,
  today,
  onBack,
  settingsPanel,
}: {
  report: BudgetDIKW;
  data: HealthData;
  today: string;
  onBack: () => void;
  settingsPanel?: import("react").ReactNode;
}) {
  const { closed, current, projection } = report;
  const [mode, setMode] = useState<PeriodMode>("current");
  const [futureIndex, setFutureIndex] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceMode | null>(null);
  const [chosenCategory, setChosenCategory] = useState<string | null>(null);
  const [filter, setFilter] = useState<LineFilter>("all");
  const [preferences, setPreferences] = useState<Record<string, ProjectionPreference>>({});

  const forecast: BudgetForecast = useMemo(
    () => buildBudgetForecast(data, report, today, preferences),
    [data, report, today, preferences],
  );

  const horizon = useMemo(
    () => buildBudgetHorizon(data, current.period.start, today, preferences),
    [data, current.period.start, today, preferences],
  );
  const futureMonth = mode === "current" && futureIndex > 0 ? horizon.months[futureIndex] : undefined;

  // Mesmo motor original de rotinas; o historico e a projecao financeira
  // usam o mes de caixa, e o padrao utiliza somente datas de compra observadas.
  const snapshot = mode === "closed" ? closed : (futureMonth?.snapshot ?? current);
  const sorted = [...snapshot.categories];
  if (mode === "current") {
    for (const root of (futureMonth ? futureMonth.byRoot : forecast.roots)) {
      if (sorted.some(category => category.id === root.id)) continue;
      sorted.push({
        id: root.id, name: root.name, budget: root.budget, spent: root.registered,
        difference: root.registered - root.budget, consumption: null,
        state: "sem_orcamento", excessContribution: 0, lines: [],
      });
    }
  }
  const futureRoots: RootForecast[] = futureMonth ? futureMonth.byRoot.map(root => ({
    ...root,
    excess: Math.max(0, root.projected - root.budget),
    coverage: root.budget > 0 ? root.projected / root.budget : 0,
    rhythms: [],
  })) : [];
  const forecastByRoot = new Map<string, RootForecast>(
    (futureMonth ? futureRoots : forecast.roots).map(root => [root.id, root] as const),
  );
  const currentSorted = [...sorted].sort((a, b) => {
    if (mode === "current") {
      const left = forecastByRoot.get(a.id);
      const right = forecastByRoot.get(b.id);
      return (right?.excess ?? 0) - (left?.excess ?? 0) ||
        (right?.projected ?? b.spent) - (left?.projected ?? a.spent);
    }
    return b.excessContribution - a.excessContribution || b.spent - a.spent;
  });

  const selectedRoot = chosenCategory ? (forecastByRoot.get(chosenCategory) ?? null) : null;
  const selectedFutureRhythms = horizon.rhythms.filter(rhythm =>
    !chosenCategory || rhythm.rootId === chosenCategory);
  const selectedFutureOccurrences = horizon.occurrences.filter(occurrence =>
    !chosenCategory || occurrence.rootId === chosenCategory);
  const selectedName = chosenCategory
    ? (snapshot.categories.find((category) => category.id === chosenCategory)?.name ??
      selectedRoot?.name ??
      null)
    : null;
  const filteredLines = snapshot.lines
    .filter(
      (line) =>
        (!chosenCategory || line.rootId === chosenCategory) &&
        (filter === "all" || (filter === "pago" ? line.status === "pago" : line.status !== "pago")),
    )
    .sort((a, b) => b.amount - a.amount);

  const openEvidence = (section: EvidenceMode, category: string | null = null) => {
    setChosenCategory(category);
    setFilter("all");
    setEvidence(section);
  };

  const selectAction = (action: BudgetAction) => {
    setMode(report.currentActions.some((item) => item.id === action.id) ? "current" : "closed");
    openEvidence("transactions", action.categoryId ?? null);
  };

  const elapsedPct = projection.daysTotal
    ? (projection.daysElapsed / projection.daysTotal) * 100
    : 0;
  // Compras futuras sem fatura nao sao inventadas para o mes seguinte.
  const projectedTotal = forecast.projected;
  const projectedOver = Math.max(0, projectedTotal - current.budget);
  const projectedUtilizationPct =
    current.budget > 0 ? (projectedTotal / current.budget) * 100 : null;
  // Datas reais: usamos apenas faturas identificadas; dias configurados nao garantem o ciclo.
  const nextCashMonth = current.period.start.slice(0, 7);
  const cardCycles = data.cards.filter(card => card.is_active).flatMap(card => {
    const actual = data.invoices
      .filter(inv => inv.credit_card_id === card.id && inv.closing_date >= today && inv.due_date.slice(0, 7) === nextCashMonth)
      .sort((a, b) => a.closing_date.localeCompare(b.closing_date))[0];
    return actual ? [{ name: card.name, closing: actual.closing_date, due: actual.due_date }] : [];
  }).sort((a, b) => a.closing.localeCompare(b.closing));
  const nextCardCycle = cardCycles[0];
  const projectedAvailable = current.budget - projectedTotal;
  const dateBR = (date: string) => date.slice(0, 10).split("-").reverse().join("/");
  const cardAdvice = nextCardCycle
    ? `O cartão ${nextCardCycle.name} fecha em ${dateBR(nextCardCycle.closing)} e vence em ${dateBR(nextCardCycle.due)}. Compras ainda feitas antes do fechamento podem impactar ${monthName(current.period.start)}; confirme o ciclo da fatura.`
    : "Antes de comprar no cartão, confirme a fatura em que a compra será cobrada e o mês do vencimento.";
  const adviceTitle = current.budget <= 0
    ? `Defina o orçamento de ${monthName(current.period.start)}`
    : projectedAvailable < 0
      ? `Próximo mês projeta excesso de ${brl(Math.max(0, -projectedAvailable))}`
      : `Próximo mês: ${brl(Math.max(0, projectedAvailable))} de margem projetada`;
  const adviceBody = `${cardAdvice} Adiar para outra fatura muda o mês do pagamento, mas não diminui a despesa. A projeção adicional de ${brl(forecast.additional)} considera apenas rotinas identificadas, atribuídas ao vencimento das faturas abertas, e pode variar.`;
  const hasBudget = current.budget > 0;
  const projectedMargin = Math.max(0, current.budget - projectedTotal);
  const isProjectedOverBudget = hasBudget && projectedOver > 0;

  const historyHighlights = forecast.comparisons.slice(0, 6);
  const leadingWorsened = forecast.comparisons
    .filter((item) => (item.changeAverage ?? item.changePrevious ?? 0) > 0)
    .slice(0, 3);

  return (
    <main
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background text-foreground"
      aria-label="Detalhamento em tela cheia da aderência ao orçamento variável"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
            aria-label="Voltar para Saúde financeira"
          >
            <ArrowLeft size={17} />
            <span className="hidden sm:inline">Voltar para Saúde financeira</span>
            <span className="sm:hidden">Voltar</span>
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold sm:text-lg">
              Análise e previsão do orçamento
            </h1>
            <p className="text-xs text-muted-foreground">
              Decisão financeira · dados e evidências sob demanda
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => openEvidence("calculation")}
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs hover:bg-muted"
        >
          <Info size={15} /> Como foi calculado
        </button>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs hover:bg-muted"
          onClick={() => setSettingsOpen(true)}
        >
          <span aria-hidden="true">⚙</span> Configurar indicador
        </button>
      </header>
      {settingsOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-3"
          role="dialog"
          aria-modal="true"
          aria-label="Configurar indicador"
        >
          <div className="max-h-[90vh] w-full max-w-3xl space-y-3 overflow-y-auto rounded-xl border bg-background p-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Configuração deste indicador</h2>
              <button
                type="button"
                className="rounded border px-3 py-1 text-sm"
                onClick={() => setSettingsOpen(false)}
              >
                Fechar
              </button>
            </div>
            {settingsPanel}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-5">
        <div className="space-y-4">
          <section className="grid gap-3 xl:grid-cols-3" aria-label="Decisão imediata">
            <article className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Mês atual · {monthName(closed.period.start)}
                </p>
                <span
                  className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${closed.status === "critico" ? "border-destructive/40 bg-destructive/10 text-destructive" : closed.status === "atencao" ? "border-warning/40 bg-warning/10 text-warning" : "border-success/40 bg-success/10 text-success"}`}
                >
                  {summaryStatus(closed.status)} · {pct(closed.deviation)}
                </span>
              </div>
              <h2 className="mt-3 text-lg font-bold leading-snug">
                {closed.difference > 0 ? (
                  <>
                    O orçamento do mês atual já ultrapassou o limite em{" "}
                    <span className="text-destructive">{brl(closed.difference)}</span>.
                  </>
                ) : closed.difference < 0 ? (
                  <>
                    O orçamento ficou{" "}
                    <span className="text-success">{brl(-closed.difference)}</span> abaixo do
                    limite.
                  </>
                ) : (
                  "O valor registrado está exatamente no limite."
                )}
              </h2>
              <p className="mt-2 text-xs text-muted-foreground">
                Registrado {brl(closed.registered)} · {closed.outsideCount} categoria(s) acima do
                limite.
              </p>
              <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                <span>
                  Previsto <strong>{brl(closed.budget)}</strong>
                </span>
                <span>
                  Registrado <strong>{brl(closed.registered)}</strong>
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${closed.difference > 0 ? "bg-destructive" : "bg-success"}`}
                  style={{
                    width: `${Math.min(100, Math.max(0, closed.budget > 0 ? (closed.registered / closed.budget) * 100 : 0))}%`,
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setMode("closed");
                  openEvidence("transactions");
                }}
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                Ver causas e lançamentos <ChevronRight size={13} />
              </button>
            </article>

            <article
              className={`rounded-xl border p-4 ${!hasBudget ? "bg-card" : isProjectedOverBudget ? "border-destructive/40 bg-destructive/5" : "bg-card"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Próximo mês · {monthName(current.period.start)}
                </p>
                <span
                  className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${!hasBudget ? "text-warning" : isProjectedOverBudget ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-success/40 bg-success/10 text-success"}`}
                >
                  {!hasBudget
                    ? "Sem orçamento"
                    : isProjectedOverBudget
                      ? "Limite já excedido"
                      : "Projeção por caixa"}
                </span>
              </div>

              <div data-budget-summary="budget-registered-projection-v1">
                <h2
                  className={`mt-3 text-lg font-bold leading-snug ${isProjectedOverBudget ? "text-destructive" : "text-success"}`}
                >
                  {!hasBudget
                    ? "Orçamento ainda não cadastrado"
                    : isProjectedOverBudget
                      ? `Limite excedido em ${brl(projectedOver)}`
                      : `Margem projetada: ${brl(projectedMargin)}`}
                </h2>
                <div className="mt-3 grid grid-cols-3 gap-2" aria-label="Projeção do próximo mês">
                  <div className="min-w-0 rounded-lg border border-border/50 bg-background/40 px-2.5 py-2">
                    <p className="text-[11px] text-muted-foreground">Orçamento</p>
                    <strong className="mt-0.5 block text-sm tabular-nums">
                      {brl(current.budget)}
                    </strong>
                  </div>
                  <div className="min-w-0 rounded-lg border border-border/50 bg-background/40 px-2.5 py-2">
                    <p className="text-[11px] text-muted-foreground">Comprometido</p>
                    <strong className="mt-0.5 block text-sm tabular-nums">
                      {brl(current.registered)}
                    </strong>
                  </div>
                  <div className="min-w-0 rounded-lg border border-border/50 bg-background/40 px-2.5 py-2">
                    <p className="text-[11px] text-muted-foreground">Projeção final</p>
                    <strong
                      className={`mt-0.5 block text-sm tabular-nums ${isProjectedOverBudget ? "text-destructive" : ""}`}
                    >
                      {hasBudget ? brl(projectedTotal) : "Sem limite"}
                    </strong>
                  </div>
                </div>
                <div
                  className="relative mt-3 h-2 rounded-full bg-muted"
                  role="img"
                  aria-label={`Orçamento ${brl(current.budget)}; comprometido ${brl(current.registered)}; adicional estimado ${brl(forecast.additional)}; projeção final ${brl(projectedTotal)}`}
                >
                  <div
                    className={`h-full rounded-full ${isProjectedOverBudget ? "bg-destructive" : "bg-success"}`}
                    style={{
                      width: `${Math.min(100, Math.max(0, projectedUtilizationPct ?? 0))}%`,
                    }}
                  />
                  {hasBudget && current.registered > 0 && (
                    <span
                      className="absolute top-1/2 z-10 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-sm border border-[#0b1728] bg-white"
                      style={{
                        left: `${Math.min(99.5, Math.max(0.5, (current.registered / current.budget) * 100))}%`,
                      }}
                      title={`Compromissos cadastrados: ${brl(current.registered)}, atribuídos pelo mês de pagamento.`}
                    />
                  )}
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Barra: projeção total de {pct(projectedUtilizationPct)} do limite; marca branca = compromissos registrados. Estimativa de novas compras: {brl(forecast.additional)}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMode("current");
                  openEvidence("forecast");
                }}
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                Ver compromissos e projeção <ChevronRight size={13} />
              </button>
            </article>

            <article className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                  O que fazer agora
                </p>
                <span className="rounded-md border border-primary/30 px-2 py-1 text-[11px] text-muted-foreground">
                  Mês atual e próximo
                </span>
              </div>
              <h2 className="mt-3 text-lg font-bold leading-snug">{adviceTitle}</h2>
              <p className="mt-2 text-sm leading-relaxed">{adviceBody}</p>
              <button
                type="button"
                onClick={() => {
                  setMode("current");
                  openEvidence("transactions");
                }}
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                Ver evidências da decisão <ChevronRight size={13} />
              </button>
            </article>
          </section>

          <section className="rounded-xl border bg-card p-4" aria-label="Categorias e decisão">
            <div className="mb-3 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Onde estão os riscos</h2>
                  <p className="text-xs text-muted-foreground">
                    Verde: dentro do limite · amarelo: atenção ou sem orçamento · vermelho: acima do
                    limite
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openEvidence("history")}
                    className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-muted"
                  >
                    Comparações <ChevronRight size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => openEvidence("transactions")}
                    className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-muted"
                  >
                    Todos os lançamentos <ChevronRight size={13} />
                  </button>
                </div>
              </div>

              <div
                className="grid gap-2 sm:grid-cols-2"
                role="group"
                aria-label="Período apresentado nos cards de categorias"
              >
                <button
                  type="button"
                  aria-pressed={mode === "closed"}
                  onClick={() => setMode("closed")}
                  className={`min-w-0 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${mode === "closed" ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border bg-background/40 hover:border-primary/50 hover:bg-muted/40"}`}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-sm font-semibold">
                      <CalendarCheck2
                        size={17}
                        className={mode === "closed" ? "text-primary" : "text-muted-foreground"}
                      />
                      {monthName(closed.period.start)} · Mês atual
                    </span>
                    {mode === "closed" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
                        <CheckCircle2 size={13} /> Visão selecionada
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Acompanhamento · valores cadastrados para pagamento no mês
                  </span>
                </button>

                <button
                  type="button"
                  aria-pressed={mode === "current" && futureIndex === 0}
                  onClick={() => { setFutureIndex(0); setMode("current"); }}
                  className={`min-w-0 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${mode === "current" && futureIndex === 0 ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border bg-background/40 hover:border-primary/50 hover:bg-muted/40"}`}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-sm font-semibold">
                      <CalendarClock
                        size={17}
                        className={mode === "current" && futureIndex === 0 ? "text-primary" : "text-muted-foreground"}
                      />
                      {monthName(current.period.start)} · Próximo mês
                    </span>
                    {mode === "current" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
                        <CheckCircle2 size={13} /> Visão selecionada
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Compromissos conhecidos pelo mês de vencimento/pagamento
                  </span>
                </button>
              </div>
              <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold">Horizonte de projeção · seis meses</p>
                    <p className="text-[11px] text-muted-foreground">Compras pela data prevista; impacto no mês de vencimento/pagamento</p>
                  </div>
                  <div className="flex gap-1">
                    <button type="button" aria-label="Mês anterior" disabled={mode === "closed" || futureIndex === 0}
                      onClick={() => {setMode("current");setFutureIndex(i => Math.max(0,i-1));}}
                      className="rounded-md border p-1.5 disabled:opacity-40 hover:bg-muted"><ChevronLeft size={16}/></button>
                    <button type="button" aria-label="Próximo mês" disabled={futureIndex === 5}
                      onClick={() => {setMode("current");setFutureIndex(i => Math.min(5,i+1));}}
                      className="rounded-md border p-1.5 disabled:opacity-40 hover:bg-muted"><ArrowNextMonth size={16}/></button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1.5 md:grid-cols-6">
                  {horizon.months.map((month, i) => (
                    <button type="button" key={month.period.start}
                      aria-pressed={mode === "current" && futureIndex === i}
                      onClick={() => {setFutureIndex(i);setMode("current");setEvidence(null);}}
                      className={`rounded-lg border px-2 py-2 text-center text-xs transition-colors ${mode === "current" && futureIndex === i ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border hover:bg-muted"}`}>
                      {monthName(month.period.start)}
                    </button>
                  ))}
                </div>
                {futureMonth && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-4" aria-live="polite">
                    <SummaryValue label="Orçamento" value={brl(futureMonth.plannedBudget)}/>
                    <SummaryValue label="Registrado" value={brl(futureMonth.registered)}/>
                    <SummaryValue label="Projeção adicional" value={brl(futureMonth.projectedAdditional)}/>
                    <SummaryValue label="Projeção final" value={brl(futureMonth.projected)}
                      tone={futureMonth.projected > futureMonth.plannedBudget ? "text-destructive" : "text-success"}/>
                  </div>
                )}
                {futureMonth?.inheritedBudget && <p className="mt-2 text-[11px] text-warning">Sem orçamento cadastrado para este mês: limite de dezembro usado apenas como referência comparativa.</p>}
                {futureMonth && <p className="mt-2 text-[11px] text-muted-foreground">As faturas futuras sem registro usam fechamento e vencimento configurados do cartão como estimativa. Nenhum lançamento fictício é gravado.</p>}
              </div>
              <p
                className="flex items-start gap-2 text-xs text-muted-foreground"
                aria-live="polite"
              >
                <Info size={14} className="mt-0.5 shrink-0" />
                {mode === "closed"
                  ? `Os cards abaixo mostram as despesas variáveis registradas em ${monthName(closed.period.start)}, incluindo previsões com pagamento no mês.`
                  : `Os cards mostram a projeção de ${monthName(snapshot.period.start)}: compromissos por vencimento ou pagamento, mais compras futuras simuladas no cartão de referência.`}
              </p>
            </div>

            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {currentSorted.map((category) => (
                <CategoryCard
                  key={category.id}
                  category={category}
                  mode={mode}
                  forecast={mode === "current" ? forecastByRoot.get(category.id) : undefined}
                  onForecast={() => openEvidence("forecast", category.id)}
                  onEvidence={() => openEvidence("transactions", category.id)}
                />
              ))}
            </div>

            {!currentSorted.length ? (
              <p className="mt-3 rounded-lg border p-5 text-sm text-muted-foreground">
                Não há categorias ou limites nesse mês. Cadastre o orçamento e os lançamentos para
                ver os cards.
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {currentSorted.length} categoria(s) · {snapshot.count} lançamento(s) ·{" "}
                {futureMonth ? currentSorted.filter(c => (forecastByRoot.get(c.id)?.projected ?? c.spent) > c.budget).length : snapshot.outsideCount} acima do limite
              </span>
            </div>
          </section>
        </div>
      </div>

      {evidence ? (
        <div
          className="absolute inset-0 z-10 flex justify-end bg-black/60"
          onClick={() => setEvidence(null)}
        >
          <aside
            className="flex h-full w-full max-w-[760px] flex-col border-l bg-background shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            aria-label="Evidências do orçamento"
          >
            <div className="flex items-center justify-between gap-2 border-b p-4">
              <div>
                <p className="text-sm font-bold">
                  {evidence === "transactions"
                    ? `Lançamentos · ${monthName(snapshot.period.start)}`
                    : evidence === "history"
                      ? "Comparações inteligentes"
                      : evidence === "forecast"
                        ? "Rotinas e previsões"
                        : "Memória do cálculo"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {evidence === "transactions"
                    ? (selectedName ?? "Todas as categorias")
                    : evidence === "forecast" && selectedRoot
                      ? selectedRoot.name
                      : "Informações auditáveis"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEvidence(null)}
                aria-label="Fechar evidências"
                className="rounded-lg border p-2 hover:bg-muted"
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm">
              {evidence === "transactions" ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <ListFilter size={15} />
                    {(["all", "pago", "previsto"] as const).map((item) => (
                      <button
                        key={item}
                        type="button"
                        aria-pressed={filter === item}
                        onClick={() => setFilter(item)}
                        className={`rounded-lg border px-3 py-1.5 text-xs ${filter === item ? "border-primary bg-primary/10 text-primary" : ""}`}
                      >
                        {item === "all" ? "Todos" : item === "pago" ? "Pagos" : "Previstos"}
                      </button>
                    ))}
                    {chosenCategory ? (
                      <button
                        type="button"
                        className="ml-auto text-xs text-primary underline"
                        onClick={() => setChosenCategory(null)}
                      >
                        Limpar categoria
                      </button>
                    ) : null}
                  </div>
                  <div className="rounded-lg border">
                    <div className="flex justify-between border-b p-3 text-xs">
                      <span>{filteredLines.length} lançamento(s)</span>
                      <strong>
                        {brl(filteredLines.reduce((sum, line) => sum + line.amount, 0))}
                      </strong>
                    </div>
                    {filteredLines.map((line: BudgetLine) => (
                      <div
                        key={line.id}
                        className="flex items-center justify-between gap-3 border-b p-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-medium">{line.description}</p>
                          <p className="text-muted-foreground">
                            {line.category} · {line.date.slice(0, 10)} · {line.status}
                            {line.creditCard ? " · cartão" : ""}
                          </p>
                        </div>
                        <strong className="shrink-0">{brl(line.amount)}</strong>
                      </div>
                    ))}
                    {!filteredLines.length ? (
                      <p className="p-4 text-xs text-muted-foreground">
                        Nenhum lançamento corresponde aos filtros.
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}

              {evidence === "history" ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ComparisonRow item={report.previous} />
                    <ComparisonRow item={report.averageThree} />
                  </div>

                  <div className="rounded-xl border p-3">
                    <h3 className="font-semibold">Leituras que explicam o desvio</h3>
                    <div className="mt-3 space-y-3">
                      {leadingWorsened.length ? (
                        leadingWorsened.map((item) => (
                          <div key={item.id} className="rounded-lg border p-3 text-xs">
                            <p className="font-semibold">{item.name}</p>
                            <p className="mt-1">{item.insight}</p>
                            <button
                              type="button"
                              onClick={() => {
                                setMode("closed");
                                openEvidence("transactions", item.id);
                              }}
                              className="mt-2 text-primary underline"
                            >
                              Ver registros dessa categoria
                            </button>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Não há categorias com piora material em relação ao histórico disponível.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border p-3">
                    <h3 className="font-semibold">Categorias com maior variação histórica</h3>
                    <div className="mt-3 space-y-2">
                      {historyHighlights.map((item) => (
                        <div key={item.id} className="rounded-lg border p-3 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <strong>{item.name}</strong>
                            <span>
                              {item.changeAverage !== null
                                ? `vs média 3m: ${signed(item.changeAverage)}`
                                : item.changePrevious !== null
                                  ? `vs mês anterior: ${signed(item.changePrevious)}`
                                  : "Sem base comparável"}
                            </span>
                          </div>
                          <p className="mt-1 text-muted-foreground">{item.insight}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border p-3">
                    <h3 className="font-semibold">Ações rastreáveis</h3>
                    <div className="mt-2 space-y-2">
                      {[...report.currentActions, ...report.actions].map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => selectAction(item)}
                          className="block w-full rounded-lg border p-2 text-left text-xs hover:border-primary"
                        >
                          <strong>
                            {item.priority} · {item.category} · {brl(item.amount)}
                          </strong>
                          <p className="mt-1">{item.action}</p>
                          <p className="text-muted-foreground">
                            {item.deadline} · {item.effect}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}

              {evidence === "forecast" && futureMonth ? (
                <div className="space-y-3">
                  <div className="rounded-xl border p-3">
                    <h3 className="font-semibold">Projeção de {monthName(futureMonth.period.start)}</h3>
                    <p className="mt-1 text-xs">Registrado {brl(futureMonth.registered)} + estimativas adicionais {brl(futureMonth.projectedAdditional)} = {brl(futureMonth.projected)}.</p>
                    <p className="mt-2 text-xs text-muted-foreground">Somente rotinas semanais comprovadas geram novas datas de compra. Consumo administrável utiliza referência mensal por caixa; contas mensais diretas mantêm vencimento próprio. Nenhuma previsão cria lançamento real.</p>
                  </div>
                  {selectedFutureRhythms.map(rhythm => {
                    const monthOccurrences = futureMonth.occurrences.filter(item=>item.categoryId===rhythm.categoryId);
                    const otherMonths = selectedFutureOccurrences.filter(item=>item.categoryId===rhythm.categoryId && item.paymentDate.slice(0,7)!==futureMonth.period.start.slice(0,7));
                    return <div key={rhythm.categoryId} className="rounded-xl border p-3 text-xs">
                      <div className="flex items-center justify-between gap-2"><strong>{rhythm.category}</strong><span>{rhythm.status==="rotina"?"Rotina semanal":rhythm.status==="mensal"?"Estimativa mensal":rhythm.status==="eventual"?"Gasto administrável":"Sem projeção"}</span></div>
                      <p className="mt-2">{rhythm.note}</p>
                      {rhythm.patterns && rhythm.patterns.length>0 && (
                        <div className="mt-2 space-y-1 rounded-md border border-border/70 bg-muted/20 p-2">
                          <strong>Calibração automática · {rhythm.calibration?.method==="segmentado"?"2 padrões":"padrão único"}</strong>
                          {rhythm.patterns.map((pattern,i)=><p key={i} className="text-muted-foreground">{pattern.name}: {pattern.count} dias observados · a cada {pattern.intervalDays} dias · valor típico {brl(pattern.ticket)}</p>)}
                          {rhythm.calibration?.monthlyReference!=null && <p>Referência dos 3 últimos meses fechados: {brl(rhythm.calibration.monthlyReference)}</p>}
                          {rhythm.calibration?.backtestSingleError!=null && <p className="text-muted-foreground">Erro retroativo padrão único: {(rhythm.calibration.backtestSingleError*100).toFixed(1)}%{rhythm.calibration.backtestSplitError!=null?` · dois padrões: ${(rhythm.calibration.backtestSplitError*100).toFixed(1)}%`:""}</p>}
                        </div>
                      )}
                      {rhythm.status==="mensal" && <p className="mt-1 font-semibold">Referência mensal de caixa: {brl(rhythm.monthlyReference??0)} · adicional neste mês: {brl(futureMonth.monthlyEstimates.find(item=>item.categoryId===rhythm.categoryId)?.additional??0)}. Sem datas de compras inventadas.</p>}
                      <p className="mt-1">Última compra: {rhythm.lastPurchase??"—"} · Próxima compra: {rhythm.nextPurchase??"—"} · Intervalo: {rhythm.intervalDays??"—"} dias.</p>
                      {rhythm.status!=="mensal" && <p className="mt-1 font-semibold">Impacto neste mês: {brl(monthOccurrences.reduce((sum,item)=>sum+item.amount,0))} · {monthOccurrences.length} ocorrência(s).</p>}
                      {!monthOccurrences.length && otherMonths.length>0 && <p className="mt-1 text-muted-foreground">Esta rotina tem compras previstas com pagamento em outros meses; veja as datas abaixo.</p>}
                      {selectedFutureOccurrences.filter(item=>item.categoryId===rhythm.categoryId).slice(0,18).map((item,index)=><div key={`${item.purchaseDate}-${index}`} className="mt-2 flex flex-wrap justify-between gap-2 rounded-md border border-border/70 p-2">
                        <div>{item.channel==="direto"?"Vencimento":"Compra"} {item.purchaseDate.split("-").reverse().join("/")}<span className="ml-2 text-muted-foreground">{item.channel==="direto"?"Conta direta":item.cardName??"Cartão"}</span><p className="text-muted-foreground">Pagamento {item.paymentDate.split("-").reverse().join("/")} · {item.cycleSource==="ciclo_estimado"?"ciclo estimado":item.cycleSource==="fatura_real"?"fatura cadastrada":"vencimento direto"}</p></div>
                        <strong>{brl(item.amount)}</strong>
                      </div>)}
                      {rhythm.audit && <ForecastAudit
                        audit={rhythm.audit}
                        rhythm={rhythm}
                        registered={futureMonth.snapshot.lines.filter(line=>line.categoryId===rhythm.categoryId).reduce((sum,line)=>sum+line.amount,0)}
                        additional={futureMonth.monthlyEstimates.find(item=>item.categoryId===rhythm.categoryId)?.additional ?? monthOccurrences.reduce((sum,item)=>sum+item.amount,0)}
                        period={monthName(futureMonth.period.start)}
                      />}
                      <label className="mt-2 flex flex-wrap items-center gap-2">Tratamento nesta análise:
                        <select value={preferences[rhythm.categoryId]??"auto"} onChange={event=>setPreferences(prev=>({...prev,[rhythm.categoryId]:event.target.value as ProjectionPreference}))} className="rounded-md border bg-background px-2 py-1">
                          <option value="auto">Automático</option><option value="pontual">Pontual (não projetar)</option><option value="rotina">Rotina (quando houver histórico)</option>
                        </select>
                      </label>
                    </div>;
                  })}
                  <p className="text-xs text-muted-foreground">A classificação manual vale apenas enquanto a tela estiver aberta.</p>
                </div>
              ) : evidence === "forecast" ? (
                <>
                  {selectedRoot ? (
                    <div className="rounded-xl border p-3">
                      <h3 className="font-semibold">Resumo da categoria</h3>
                      <div className="mt-3 grid gap-2 sm:grid-cols-4">
                        <SummaryValue label="Previsto" value={brl(selectedRoot.budget)} />
                        <SummaryValue label="Registrado" value={brl(selectedRoot.registered)} />
                        <SummaryValue label="Projeção" value={brl(selectedRoot.projected)} />
                        <SummaryValue
                          label={selectedRoot.excess > 0 ? "Excesso projetado" : "Saldo projetado"}
                          value={brl(
                            selectedRoot.excess > 0
                              ? selectedRoot.excess
                              : Math.max(0, selectedRoot.budget - selectedRoot.projected),
                          )}
                          tone={selectedRoot.excess > 0 ? "text-destructive" : "text-success"}
                        />
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">
                        Confiança {confidenceText[forecast.confidence]} · apenas esta categoria está
                        detalhada abaixo.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border p-3">
                      <h3 className="font-semibold">Como o sistema prevê o mês</h3>
                      <p className="mt-1 text-xs">
                        Recupera o padrão de ocorrências dos últimos seis meses, usando a data da
                        compra para medir intervalos e valores típicos. O valor previsto é lançado
                        no mês de pagamento da fatura; parcelas e compras já cadastradas não são duplicadas.
                      </p>
                      <p className="mt-2 text-xs font-medium">
                        Total registrado {brl(forecast.registered)} + projeção adicional{" "}
                        {brl(forecast.additional)} = {brl(forecast.projected)}.
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{forecast.disclaimer}</p>
                    </div>
                  )}

                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                    <h3 className="text-sm font-semibold">Próximas compras e destino das faturas</h3>
                    <p className="mt-1 text-xs text-muted-foreground">As compras que não impactam dezembro não desaparecem: veja as primeiras datas previstas e o mês de pagamento.</p>
                    {selectedFutureRhythms.filter(r=>r.status==="rotina").map(rhythm=>{
                      const next = selectedFutureOccurrences.filter(o=>o.categoryId===rhythm.categoryId).slice(0,5);
                      return <div key={rhythm.categoryId} className="mt-3 border-t border-border/60 pt-2 text-xs">
                        <p className="font-semibold">{rhythm.category} · {rhythm.intervalDays??"—"} dias · próximo gasto {rhythm.nextPurchase??"—"}</p>
                        <p className="mt-0.5 text-muted-foreground">{rhythm.note}</p>
                        {next.map((item,i)=><p key={`${item.purchaseDate}-${i}`} className="mt-1">{item.channel==="direto"?"Vencimento":"Compra"} {item.purchaseDate.split("-").reverse().join("/")} → pagamento {item.paymentDate.split("-").reverse().join("/")} · {brl(item.amount)}{item.cardName?` · ${item.cardName}`:""}</p>)}
                        {!next.length&&<p className="mt-1 text-muted-foreground">Sem nova ocorrência atribuída ao horizonte de seis meses.</p>}
                      </div>;
                    })}
                  </div>

                  {(selectedRoot ? selectedRoot.rhythms : forecast.rhythms).map((rhythm) => (
                    <div key={rhythm.id} className="rounded-xl border p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <strong>{rhythm.name}</strong>
                        <span>
                          {rhythm.kind === "recorrente"
                            ? "Rotina detectada"
                            : rhythm.kind === "pontual"
                              ? "Pontual"
                              : "Sem padrão"}
                        </span>
                      </div>
                      <p className="mt-1">{rhythm.description}</p>
                      <p className="mt-1">
                        Registrado: {brl(rhythm.registered)} · Adicional projetado:{" "}
                        {brl(rhythm.projectedAdditional)} · Confiança{" "}
                        {confidenceText[rhythm.confidence]}.
                      </p>
                      {(rhythm.audit ?? horizon.rhythms.find(item=>item.categoryId===rhythm.id)?.audit) &&
                        horizon.rhythms.find(item=>item.categoryId===rhythm.id) && <ForecastAudit
                          audit={(rhythm.audit ?? horizon.rhythms.find(item=>item.categoryId===rhythm.id)!.audit)!}
                          rhythm={horizon.rhythms.find(item=>item.categoryId===rhythm.id)!}
                          registered={rhythm.registered}
                          additional={rhythm.projectedAdditional}
                          period={monthName(current.period.start)}
                        />}
                      <label className="mt-2 flex flex-wrap items-center gap-2">
                        Tratamento nesta análise:
                        <select
                          className="rounded-md border bg-background px-2 py-1"
                          value={rhythm.preference}
                          onChange={(event) =>
                            setPreferences((prev) => ({
                              ...prev,
                              [rhythm.id]: event.target.value as ProjectionPreference,
                            }))
                          }
                        >
                          <option value="auto">Automático</option>
                          <option value="pontual">Gasto pontual (não projetar)</option>
                          <option value="rotina">Rotina (quando houver histórico)</option>
                        </select>
                      </label>
                    </div>
                  ))}

                  <p className="text-xs text-muted-foreground">
                    A classificação manual vale somente enquanto esta tela estiver aberta. Não
                    modifica lançamentos, categorias ou banco.
                  </p>
                </>
              ) : null}

              {evidence === "calculation" ? (
                <>
                  <div className="rounded-xl border p-3">
                    <h3 className="flex items-center gap-2 font-semibold">
                      <ClipboardList size={16} /> Mês atual
                    </h3>
                    <p className="mt-2">
                      Fórmula: (despesa variável registrada − limite variável planejado) / limite
                      planejado × 100.
                    </p>
                    <p className="mt-2">
                      {brl(closed.registered)} registrados = {brl(closed.paid)} pagos +{" "}
                      {brl(closed.pending)} previstos; {closed.count} lançamentos.
                    </p>
                    <p>
                      Orçamento: {brl(closed.budget)} · Diferença: {signed(closed.difference)} ·
                      Desvio: {pct(closed.deviation)}.
                    </p>
                  </div>
                  <div className="rounded-xl border p-3">
                    <h3 className="flex items-center gap-2 font-semibold">
                      <Target size={16} /> Compromissos do próximo mês
                    </h3>
                    <p className="mt-2">
                      Compromissos conhecidos: {brl(forecast.registered)} · Compras de rotina
                      estimadas: {brl(forecast.additional)} · Projeção final:
                      {" "}{brl(forecast.projected)}.
                    </p>
                    <p>
                      As compras projetadas seguem as faturas com vencimento no próximo mês,
                      com base no histórico dos cartões e dias restantes até o fechamento.
                      A estimativa não duplica parcelas já registradas e é parcial quando
                      faltam faturas ou histórico.
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Confira a fatura efetiva e seu vencimento para atribuir cada compra ao mês correto.
                    </p>
                  </div>
                  <div className="rounded-xl border p-3">
                    <h3 className="font-semibold">Limites do mês atual</h3>
                    {closed.categories
                      .filter((category) => category.budget > 0)
                      .map((category) => (
                        <p
                          key={category.id}
                          className="flex justify-between gap-2 border-b py-2 text-xs"
                        >
                          <span>{category.name}</span>
                          <strong>{brl(category.budget)}</strong>
                        </p>
                      ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Despesas variáveis pagas e previstas são consideradas por competência.
                    Cancelados, terceiros, transferências e pagamentos de fatura são excluídos.
                    Compras e parcelas entram uma vez por ID.
                  </p>
                </>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </main>
  );
}

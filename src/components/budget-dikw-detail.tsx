import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
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
          {mode === "current" ? "Projeção" : "Registrado"}{" "}
          <strong className="text-foreground">{brl(value)}</strong>
        </span>
      </div>
      <div
        className="relative mt-2 h-1.5 rounded-full bg-muted"
        role="img"
        aria-label={`${category.name}: projeção ${brl(value)}; registrado ${brl(registered)}; limite ${brl(category.budget)}`}
      >
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: `${Math.max(0, Math.min(100, utilization ?? 0))}%` }}
        />
        {mode === "current" && registeredPct !== null && registered > 0 && (
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
          {mode === "current" && (
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceMode | null>(null);
  const [chosenCategory, setChosenCategory] = useState<string | null>(null);
  const [filter, setFilter] = useState<LineFilter>("all");
  const [preferences, setPreferences] = useState<Record<string, ProjectionPreference>>({});

  const forecast: BudgetForecast = useMemo(
    () => buildBudgetForecast(data, report, today, preferences),
    [data, report, today, preferences],
  );

  const snapshot = mode === "closed" ? closed : current;
  const sorted = [...snapshot.categories];
  if (mode === "current") {
    for (const root of forecast.roots) {
      if (!sorted.some((category) => category.id === root.id)) {
        sorted.push({
          id: root.id,
          name: root.name,
          budget: root.budget,
          spent: root.registered,
          difference: root.registered - root.budget,
          consumption: root.budget > 0 ? (root.registered / root.budget) * 100 : null,
          state: root.registered > 0 ? "sem_orcamento" : "sem_consumo",
          excessContribution: 0,
          lines: [],
        });
      }
    }
  }

  const forecastByRoot = new Map(forecast.roots.map((root) => [root.id, root]));
  const currentSorted = [...sorted].sort((a, b) => {
    if (mode === "current") {
      const left = forecastByRoot.get(a.id);
      const right = forecastByRoot.get(b.id);
      const leftPressure = (left?.excess ?? 0) + (left?.additional ?? 0);
      const rightPressure = (right?.excess ?? 0) + (right?.additional ?? 0);
      return (
        rightPressure - leftPressure || (right?.projected ?? b.spent) - (left?.projected ?? a.spent)
      );
    }
    return b.excessContribution - a.excessContribution || b.spent - a.spent;
  });

  const selectedRoot = chosenCategory ? (forecastByRoot.get(chosenCategory) ?? null) : null;
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
  const projectedTotal = forecast.projected;
  const projectedOver = Math.max(0, projectedTotal - current.budget);
  const projectedUtilizationPct =
    current.budget > 0 ? (projectedTotal / current.budget) * 100 : null;
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
                  Conclusão do mês fechado · {monthName(closed.period.start)}
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
                    O orçamento do mês passado estourou{" "}
                    <span className="text-destructive">{brl(closed.difference)}</span>.
                  </>
                ) : closed.difference < 0 ? (
                  <>
                    O orçamento ficou{" "}
                    <span className="text-success">{brl(-closed.difference)}</span> abaixo do
                    limite.
                  </>
                ) : (
                  "O orçamento terminou exatamente no limite."
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
                  Agora · {monthName(current.period.start)}
                </p>
                <span
                  className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${!hasBudget ? "text-warning" : isProjectedOverBudget ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-success/40 bg-success/10 text-success"}`}
                >
                  {!hasBudget
                    ? "Sem orçamento"
                    : isProjectedOverBudget
                      ? "Risco de estouro"
                      : "Em acompanhamento"}
                </span>
              </div>

              <div data-budget-summary="budget-registered-projection-v1">
                <h2
                  className={`mt-3 text-lg font-bold leading-snug ${isProjectedOverBudget ? "text-destructive" : "text-success"}`}
                >
                  {!hasBudget
                    ? "Projeção parcial · orçamento não cadastrado"
                    : isProjectedOverBudget
                      ? `Risco de estouro: ${brl(projectedOver)}`
                      : `Dentro do orçamento: margem de ${brl(projectedMargin)}`}
                </h2>
                <div className="mt-3 grid grid-cols-3 gap-2" aria-label="Resumo do orçamento atual">
                  <div className="min-w-0 rounded-lg border border-border/50 bg-background/40 px-2.5 py-2">
                    <p className="text-[11px] text-muted-foreground">Orçamento</p>
                    <strong className="mt-0.5 block text-sm tabular-nums">
                      {brl(current.budget)}
                    </strong>
                  </div>
                  <div className="min-w-0 rounded-lg border border-border/50 bg-background/40 px-2.5 py-2">
                    <p className="text-[11px] text-muted-foreground">Gasto registrado</p>
                    <strong className="mt-0.5 block text-sm tabular-nums">
                      {brl(current.registered)}
                    </strong>
                  </div>
                  <div className="min-w-0 rounded-lg border border-border/50 bg-background/40 px-2.5 py-2">
                    <p className="text-[11px] text-muted-foreground">Projeção final</p>
                    <strong
                      className={`mt-0.5 block text-sm tabular-nums ${isProjectedOverBudget ? "text-destructive" : ""}`}
                    >
                      {brl(projectedTotal)}
                    </strong>
                  </div>
                </div>
                <div
                  className="relative mt-3 h-2 rounded-full bg-muted"
                  role="img"
                  aria-label={`Orçamento ${brl(current.budget)}; gasto registrado ${brl(current.registered)}; projeção ${brl(projectedTotal)}`}
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
                      title={`Gasto registrado: ${brl(current.registered)}. Inclui compras no cartão ainda não pagas.`}
                    />
                  )}
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Barra: fechamento projetado · traço branco: gasto registrado ·{" "}
                  {pct(projectedUtilizationPct)} do orçamento
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
                Entender a projeção <ChevronRight size={13} />
              </button>
            </article>

            <article className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                  O que fazer agora
                </p>
                <span className="rounded-md border border-primary/30 px-2 py-1 text-[11px] text-muted-foreground">
                  Mês corrente
                </span>
              </div>
              <h2 className="mt-3 text-lg font-bold leading-snug">{forecast.recommended.title}</h2>
              <p className="mt-2 text-sm leading-relaxed">{forecast.recommended.action}</p>
              <button
                type="button"
                onClick={() => {
                  setMode("current");
                  openEvidence("forecast", forecast.recommended.categoryId);
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
                      {monthName(closed.period.start)} · Mês fechado
                    </span>
                    {mode === "closed" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
                        <CheckCircle2 size={13} /> Visão selecionada
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Resultado definitivo · despesas registradas no mês
                  </span>
                </button>

                <button
                  type="button"
                  aria-pressed={mode === "current"}
                  onClick={() => setMode("current")}
                  className={`min-w-0 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${mode === "current" ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border bg-background/40 hover:border-primary/50 hover:bg-muted/40"}`}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-sm font-semibold">
                      <CalendarClock
                        size={17}
                        className={mode === "current" ? "text-primary" : "text-muted-foreground"}
                      />
                      {monthName(current.period.start)} · Mês atual
                    </span>
                    {mode === "current" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
                        <CheckCircle2 size={13} /> Visão selecionada
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Acompanhamento · valores projetados até o fechamento
                  </span>
                </button>
              </div>
              <p
                className="flex items-start gap-2 text-xs text-muted-foreground"
                aria-live="polite"
              >
                <Info size={14} className="mt-0.5 shrink-0" />
                {mode === "closed"
                  ? `Os cards abaixo mostram o resultado definitivo de ${monthName(closed.period.start)}, com gastos registrados e limites do período.`
                  : `Os cards abaixo mostram a projeção de encerramento de ${monthName(current.period.start)}. As cores consideram o risco projetado. Barra = projeção; traço branco = gasto já registrado (inclui compras no cartão).`}
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
                {snapshot.outsideCount} acima do limite
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

              {evidence === "forecast" ? (
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
                        Detecta intervalos entre dias de compra e valores típicos nos últimos seis
                        meses. Desconta ocorrências futuras já cadastradas e não extrapola gastos
                        sem padrão confiável.
                      </p>
                      <p className="mt-2 text-xs font-medium">
                        Total registrado {brl(forecast.registered)} + projeção adicional{" "}
                        {brl(forecast.additional)} = {brl(forecast.projected)}.
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{forecast.disclaimer}</p>
                    </div>
                  )}

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
                      <ClipboardList size={16} /> Mês fechado
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
                      <Target size={16} /> Projeção do mês corrente
                    </h3>
                    <p className="mt-2">
                      Já registrado: {brl(current.registered)} · Compromissos futuros já
                      registrados: {brl(projection.recordedFuture)}.
                    </p>
                    <p>
                      Gasto diário observado: {brl(projection.averageDaily)} · teto diário restante:{" "}
                      {brl(projection.recommendedDaily)}.
                    </p>
                    <p>
                      Projeção por periodicidade: adicional {brl(forecast.additional)} · total
                      projetado {brl(forecast.projected)}.
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Confiança {confidenceText[forecast.confidence]}: {forecast.disclaimer}
                    </p>
                  </div>
                  <div className="rounded-xl border p-3">
                    <h3 className="font-semibold">Limites do mês fechado</h3>
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

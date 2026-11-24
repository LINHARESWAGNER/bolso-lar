import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Settings2, TrendingUp } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { JourneyHeader } from "@/components/journey-header";
import { BudgetDIKWDetail } from "@/components/budget-dikw-detail";
import { EssentialCommitmentDetail } from "@/components/essential-commitment-detail";
import { HealthIndicatorSettings } from "@/components/health-indicator-settings";
import { buildBudgetDIKW } from "@/lib/budget-dikw";
import { buildBudgetForecast } from "@/lib/budget-forecast";
import { brl } from "@/lib/format";
import { isThirdPartyCategory } from "@/lib/derive";
import {
  buildFinancialHealth,
  variableBudgetMonitor,
  familyInstallmentGroups,
  resolveEssential,
  DEFAULT_HEALTH_SETTINGS,
  shiftPeriod,
  type HealthData,
  type HealthMetric,
  type HealthPeriod,
  type HealthStatus,
  type HealthMetricId,
  type Settings,
} from "@/lib/financial-health";
import {
  useBudgets,
  useCards,
  useCategories,
  useFinancialHealthDebts,
  useFinancialHealthEssentials,
  useFinancialHealthIncome,
  useFinancialHealthSettings,
  useInstallmentGroups,
  useInvestmentAssets,
  useInvestmentMovements,
  useInvalidateFinance,
  useInvoices,
  useProfile,
  useRecurrences,
  useTransactions,
} from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/saude-financeira")({
  head: () => ({ meta: [{ title: "Saúde financeira — Finanças da Família" }] }),
  component: FinancialHealthPage,
});

const statusLabel: Record<HealthStatus, string> = {
  saudavel: "Saudável",
  atencao: "Em atenção",
  critico: "Crítico",
  insuficiente: "Dados insuficientes",
};
const statusClass: Record<HealthStatus, string> = {
  saudavel: "text-success border-success/40 bg-success/5",
  atencao: "text-warning border-warning/40 bg-warning/5",
  critico: "text-destructive border-destructive/40 bg-destructive/5",
  insuficiente: "text-muted-foreground border-border bg-muted/30",
};
const money = (n: number | null) => (n === null ? "—" : brl(n));
const iso = (year: number, month: number, day = 1) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const monthEnd = (year: number, month: number) =>
  iso(year, month, new Date(year, month, 0).getDate());
function periodFor(_range: "mes", year: number, month: number): HealthPeriod {
  return { start: iso(year, month), end: monthEnd(year, month), months: 1 };
}
function FinancialHealthPage() {
  const { data: profile } = useProfile();
  const { data: transactions = [], isLoading: txLoading, isError: txError } = useTransactions();
  const { data: categories = [], isLoading: catLoading } = useCategories();
  const { data: cards = [], isLoading: cardsLoading } = useCards();
  const { data: invoices = [], isLoading: invoicesLoading } = useInvoices();
  const { data: assets = [], isLoading: assetsLoading } = useInvestmentAssets();
  const { data: movements = [], isLoading: movementsLoading } = useInvestmentMovements();
  const { data: budgets = [], isLoading: budgetsLoading } = useBudgets();
  const { data: groups = [], isLoading: groupsLoading } = useInstallmentGroups();
  const {
    data: recurrences = [],
    isLoading: recurrencesLoading,
    isError: recurrencesError,
  } = useRecurrences();
  const {
    data: essentials = [],
    isLoading: essentialsLoading,
    isError: essentialsError,
  } = useFinancialHealthEssentials();
  const {
    data: incomeClassifications = [],
    isLoading: incomeLoading,
    isError: incomeError,
  } = useFinancialHealthIncome();
  const {
    data: debts = [],
    isLoading: debtsLoading,
    isError: debtsError,
  } = useFinancialHealthDebts();
  const {
    data: storedSettings,
    isLoading: settingsLoading,
    isError: settingsError,
  } = useFinancialHealthSettings();
  const invalidate = useInvalidateFinance();
  const [selected, setSelected] = useState<HealthMetric | null>(null);
  const [budgetDetailOpen, setBudgetDetailOpen] = useState(false);
  const [essentialDetailOpen, setEssentialDetailOpen] = useState(false);
  const [configuration, setConfiguration] = useState(false);
  const [saving, setSaving] = useState(false);
  const [today, setToday] = useState(() => {
    const d = new Date();
    return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  });
  useEffect(() => {
    const refreshDate = () => {
      const d = new Date();
      const next = iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
      setToday((previous) => (previous === next ? previous : next));
    };
    // Recalcula na virada do dia e ao voltar para a aba, inclusive se o
    // navegador suspender temporariamente os intervalos em segundo plano.
    const timer = window.setInterval(refreshDate, 30_000);
    document.addEventListener("visibilitychange", refreshDate);
    window.addEventListener("focus", refreshDate);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshDate);
      window.removeEventListener("focus", refreshDate);
    };
  }, []);
  const [currentYear, currentMonth] = today.split("-").map(Number);
  const period = periodFor("mes", currentYear, currentMonth);
  const lastMonthDate = new Date(currentYear, currentMonth - 2, 1);
  const closedPeriod = periodFor("mes", lastMonthDate.getFullYear(), lastMonthDate.getMonth() + 1);
  const settings: Settings = { ...DEFAULT_HEALTH_SETTINGS, ...storedSettings };
  const [draft, setDraft] = useState<Settings | null>(null);
  const effectiveDraft = draft ?? settings;
  const data: HealthData = {
    transactions,
    categories,
    cards,
    invoices,
    assets,
    movements,
    budgets,
    groups,
    essentials,
    incomeClassifications,
    debtKinds: debts,
  };
  const liveMetrics = buildFinancialHealth(data, settings, period, today);
  const closedMetrics = buildFinancialHealth(data, settings, closedPeriod, today);
  const closedBudget = closedMetrics[0];
  const closedEssential = closedMetrics.find((m) => m.id === "essential");
  const monitor = variableBudgetMonitor(data, period, today);
  const budgetAnalysis = buildBudgetDIKW(data, settings, closedPeriod, period, today);
  // Mesma projeção por periodicidade utilizada no detalhamento, sem alterar o resultado fechado.
  const budgetForecast = buildBudgetForecast(data, budgetAnalysis, today);
  const projectedBudget = budgetAnalysis.current.budget;
  const projectedDeviation =
    projectedBudget > 0
      ? ((budgetForecast.projected - projectedBudget) / projectedBudget) * 100
      : null;
  // A projeção que ultrapassa a tolerância já representa risco crítico,
  // sem aplicar o multiplicador de três utilizado na classificação anterior.
  const projectedStatus: HealthStatus =
    projectedDeviation === null
      ? "insuficiente"
      : projectedDeviation > settings.budget_tolerance_pct
        ? "critico"
        : projectedDeviation > 0
          ? "atencao"
          : budgetForecast.confidence === "insuficiente"
            ? "insuficiente"
            : "saudavel";
  const projectedBudgetMetric: HealthMetric = {
    ...closedBudget,
    title: "Controle do orçamento · projeção",
    value: projectedDeviation,
    status: projectedStatus,
    note:
      projectedDeviation === null
        ? `Sem orçamento variável definido para ${String(currentMonth).padStart(2, "0")}/${currentYear}.`
        : projectedDeviation > settings.budget_tolerance_pct
          ? `Esse mês o orçamento poderá estourar em ${brl(Math.max(0, budgetForecast.projected - projectedBudget))}. Projeção de ${String(currentMonth).padStart(2, "0")}/${currentYear}, acima da meta de ${settings.budget_tolerance_pct}%.`
          : projectedDeviation > 0
            ? `Esse mês o orçamento poderá ultrapassar o limite em ${brl(Math.max(0, budgetForecast.projected - projectedBudget))}, dentro da tolerância de ${settings.budget_tolerance_pct}%. Projeção ainda não definitiva.`
            : `Projeção parcial de ${String(currentMonth).padStart(2, "0")}/${currentYear}: ${brl(budgetForecast.projected)} sobre ${brl(projectedBudget)} planejados. Confiança ${budgetForecast.confidence}.`,
  };
  const metrics = liveMetrics.map((m) =>
    m.id === "budget"
      ? projectedBudgetMetric
      : m.id === "essential" && closedEssential
        ? {
            ...closedEssential,
            title: "Comprometimento com essenciais · mês fechado",
            note: `${closedEssential.note} Referência: ${closedPeriod.start.slice(5, 7)}/${closedPeriod.start.slice(0, 4)}.`,
          }
        : m,
  );
  const previous = buildFinancialHealth(data, settings, shiftPeriod(period), today);
  const previousClosedEssential = buildFinancialHealth(
    data,
    settings,
    shiftPeriod(closedPeriod),
    today,
  ).find((m) => m.id === "essential");
  const compared = metrics.map((m, i) => ({
    ...m,
    comparison:
      m.id === "budget" || m.id === "cards" || m.id === "reserve" || m.value === null
        ? null
        : m.id === "essential"
          ? previousClosedEssential?.value == null
            ? null
            : m.value - previousClosedEssential.value
          : previous[i]?.value == null
            ? null
            : m.value - previous[i].value,
  }));
  const summary = {
    saudavel: metrics.filter((m) => m.status === "saudavel").length,
    atencao: metrics.filter((m) => m.status === "atencao").length,
    critico: metrics.filter((m) => m.status === "critico").length,
    insuficiente: metrics.filter((m) => m.status === "insuficiente").length,
  };
  const history = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(currentYear, currentMonth - 12 + i, 1);
    const p = periodFor("mes", d.getFullYear(), d.getMonth() + 1);
    const rows = buildFinancialHealth(data, settings, p, today);
    return {
      month: `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`,
      budget: rows[0].value,
      essential: p.end < today ? rows[1].value : null,
      debt: rows[2].value,
      investment: rows[3].value,
      cards: rows[5].value,
    };
  });
  const quality: string[] = [];
  const usedCategoryIds = new Set(
    transactions
      .filter(
        (t) =>
          t.type === "despesa" &&
          t.status !== "cancelado" &&
          t.competence_date >= closedPeriod.start &&
          t.competence_date <= closedPeriod.end &&
          !isThirdPartyCategory(categories, t.category_id),
      )
      .map((t) => t.category_id)
      .filter((id): id is string => !!id),
  );
  const missingEssentialCategories = [...usedCategoryIds].filter(
    (id) => resolveEssential(id, categories, essentials) === null,
  );
  if (missingEssentialCategories.length)
    quality.push(
      `${missingEssentialCategories.length} categoria(s) usada(s) em despesas sem definição efetiva de essencial (nem própria nem herdada).`,
    );
  const cardsWithoutLimit = cards.filter((c) => c.is_active && Number(c.credit_limit) <= 0);
  if (cardsWithoutLimit.length)
    quality.push(`${cardsWithoutLimit.length} cartão(ões) ativo(s) sem limite válido.`);
  const visibleGroups = familyInstallmentGroups(groups, transactions, categories).filter(
    (g) => !g.deleted_at,
  );
  const debtsWithoutKind = visibleGroups.filter(
    (g) => !g.credit_card_id && !debts.some((d) => d.installment_group_id === g.id),
  );
  if (debtsWithoutKind.length)
    quality.push(
      `${debtsWithoutKind.length} parcelamento(s) fora do cartão sem classificação de compromisso parcelado.`,
    );
  if (
    assets.some(
      (a) =>
        a.is_active &&
        (!a.liquidity || !["imediata", "d_1", "d_2_mais", "carencia"].includes(a.liquidity)),
    )
  )
    quality.push("Investimento sem liquidez definida.");
  const missingCategories = transactions.filter(
    (t) =>
      t.status !== "cancelado" &&
      (t.type === "receita" || t.type === "despesa") &&
      !isThirdPartyCategory(categories, t.category_id) &&
      !t.category_id,
  );
  if (missingCategories.length)
    quality.push(`${missingCategories.length} lançamento(s) sem categoria.`);
  const missingNature = transactions.filter(
    (t) =>
      t.type === "despesa" &&
      !t.expense_nature &&
      !t.installment_group_id &&
      t.status !== "cancelado" &&
      !isThirdPartyCategory(categories, t.category_id),
  );
  if (missingNature.length)
    quality.push(`${missingNature.length} despesa(s) sem classificação fixa/variável.`);
  if (settingsError)
    quality.push("Não foi possível consultar as configurações. d migração pode estar pendente.");
  const actionable = compared.filter((m) => m.status === "critico" || m.status === "atencao");
  async function saveSettings() {
    if (!profile?.family_id) return;
    if (effectiveDraft.debt_critical_pct <= effectiveDraft.debt_healthy_pct) {
      toast.error("Faixa crítica deve ser maior que a saudável.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("financial_health_settings")
      .upsert({ family_id: profile.family_id, ...effectiveDraft }, { onConflict: "family_id" });
    setSaving(false);
    if (error) {
      toast.error("Não foi possível salvar metas", { description: error.message });
      return;
    }
    invalidate();
    setDraft(null);
    toast.success("Metas atualizadas");
  }
  async function setEssential(categoryId: string, value: string) {
    if (!profile?.family_id) return;
    const { error } =
      value === ""
        ? await supabase
            .from("financial_health_essential_categories")
            .delete()
            .eq("family_id", profile.family_id)
            .eq("category_id", categoryId)
        : await supabase.from("financial_health_essential_categories").upsert(
            {
              family_id: profile.family_id,
              category_id: categoryId,
              is_essential: value === "sim",
            },
            { onConflict: "family_id,category_id" },
          );
    if (error) toast.error(error.message);
    else invalidate();
  }
  async function setIncomeClassification(
    transactionId: string,
    classification: "habitual" | "extraordinaria" | "ajuste_tecnico",
  ) {
    if (!profile?.family_id) return;
    const { error } =
      classification === "habitual"
        ? await supabase
            .from("financial_health_income_classifications")
            .delete()
            .eq("family_id", profile.family_id)
            .eq("transaction_id", transactionId)
        : await supabase.from("financial_health_income_classifications").upsert(
            {
              family_id: profile.family_id,
              transaction_id: transactionId,
              classification,
            },
            { onConflict: "family_id,transaction_id" },
          );
    if (error) toast.error("Falha ao classificar receita", { description: error.message });
    else {
      invalidate();
      toast.success("Classificação da receita salva");
    }
  }
  async function setDebt(groupId: string, kind: string) {
    if (!profile?.family_id) return;
    const { error } = await supabase
      .from("financial_health_debt_groups")
      .upsert(
        { family_id: profile.family_id, installment_group_id: groupId, debt_kind: kind },
        { onConflict: "family_id,installment_group_id" },
      );
    if (error) toast.error(error.message);
    else invalidate();
  }
  function indicatorSettings(indicator: HealthMetricId) {
    return (
      <HealthIndicatorSettings
        indicator={indicator}
        data={data}
        settings={settings}
        draft={draft}
        setDraft={setDraft}
        saving={saving}
        onSave={saveSettings}
        onEssential={setEssential}
        onDebt={setDebt}
      />
    );
  }
  if (
    txLoading ||
    catLoading ||
    cardsLoading ||
    invoicesLoading ||
    assetsLoading ||
    movementsLoading ||
    budgetsLoading ||
    groupsLoading ||
    essentialsLoading ||
    incomeLoading ||
    debtsLoading ||
    settingsLoading
  )
    return (
      <div className="p-6 text-sm text-muted-foreground">Carregando informações financeiras…</div>
    );
  if (settingsError || essentialsError || incomeError || debtsError)
    return (
      <div className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">
        Configurações de saúde financeira indisponíveis. Aplique primeiro a migração versionada e
        confira as permissões RLS.
      </div>
    );
  if (txError)
    return (
      <div className="text-destructive">
        Não foi possível carregar os lançamentos. Verifique a conexão.
      </div>
    );
  if (essentialDetailOpen && closedEssential)
    return (
      <EssentialCommitmentDetail
        metric={closedEssential}
        previous={previousClosedEssential}
        period={closedPeriod}
        data={data}
        recurrences={recurrences}
        recurrencesLoading={recurrencesLoading}
        recurrencesError={recurrencesError}
        settings={settings}
        today={today}
        settingsPanel={indicatorSettings("essential")}
        onIncomeClassification={setIncomeClassification}
        onBack={() => setEssentialDetailOpen(false)}
      />
    );
  if (budgetDetailOpen)
    return (
      <BudgetDIKWDetail
        report={budgetAnalysis}
        data={data}
        today={today}
        settingsPanel={indicatorSettings("budget")}
        onBack={() => setBudgetDetailOpen(false)}
      />
    );
  return (
    <div className="space-y-5">
      <JourneyHeader
        step={4}
        title="Verificação"
        subtitle="Avalie equilíbrio, segurança e crescimento para decidir as próximas ações"
      />
      <section className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="font-semibold">
          Orçamento variável · acompanhamento de {String(currentMonth).padStart(2, "0")}/
          {currentYear}
        </h2>
        <p className="text-xs text-muted-foreground">
          O indicador Controle do orçamento apresenta o desvio projetado para{" "}
          {String(currentMonth).padStart(2, "0")}/{currentYear}, ainda não definitivo. O resultado
          fechado de {closedPeriod.start.slice(5, 7)}/{closedPeriod.start.slice(0, 4)} permanece no
          detalhamento.
        </p>
        {monitor.hasBudget ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 text-sm">
              <div>
                <span className="block text-muted-foreground">Limite do mês</span>
                <strong>{brl(monitor.budget)}</strong>
              </div>
              <div>
                <span className="block text-muted-foreground">Já realizado</span>
                <strong>{brl(monitor.realized)}</strong>
              </div>
              <div>
                <span className="block text-muted-foreground">Compromissos conhecidos</span>
                <strong>{brl(monitor.committed)}</strong>
              </div>
              <div>
                <span className="block text-muted-foreground">Saldo disponível estimado</span>
                <strong className={Math.round((Number(monitor.remaining) + Number.EPSILON) * 100) < 0 ? "text-destructive" : "text-success"}>
                  {brl(monitor.remaining)}
                </strong>
              </div>
            </div>
            <p
              className={`text-sm ${Math.round((Number(monitor.remaining) + Number.EPSILON) * 100) < 0 ? "text-destructive" : "text-muted-foreground"}`}
            >
              {monitor.remaining < 0
                ? `Atenção: os gastos e compromissos variáveis já ultrapassam o limite em ${brl(-monitor.remaining)}. Reveja os gastos restantes.`
                : "Ainda há limite, mas novas despesas podem ocorrer. Acompanhe o consumo até o fechamento."}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Cadastre e salve o orçamento variável deste mês em Planejamento para acompanhar
            possíveis desvios.
          </p>
        )}
      </section>
      <section
        className="grid gap-3 grid-cols-2 md:grid-cols-4"
        aria-label="Resumo dos indicadores"
      >
        {(
          [
            ["Saudáveis", summary.saudavel, "text-success"],
            ["Em atenção", summary.atencao, "text-warning"],
            ["Críticos", summary.critico, "text-destructive"],
            ["Dados insuficientes", summary.insuficiente, "text-muted-foreground"],
          ] as const
        ).map(([name, count, color]) => (
          <div key={name} className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{name}</p>
            <p className={`text-3xl font-semibold ${color}`}>{count}</p>
          </div>
        ))}
      </section>
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {compared.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() =>
              m.id === "budget"
                ? setBudgetDetailOpen(true)
                : m.id === "essential"
                  ? setEssentialDetailOpen(true)
                  : setSelected(m)
            }
            className={`rounded-xl border p-4 text-left transition hover:border-primary focus-visible:outline-2 focus-visible:outline-primary ${statusClass[m.status]}`}
          >
            <div className="flex justify-between items-start gap-2">
              <h2 className="font-semibold text-foreground">{m.title}</h2>
              <span className="text-xs font-medium">
                {m.id === "budget"
                  ? m.status === "insuficiente"
                    ? "Sem projeção"
                    : `Projeção · ${statusLabel[m.status]}`
                  : statusLabel[m.status]}
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold">
              {m.value === null
                ? "—"
                : `${m.id === "budget" && m.value > 0 ? "+" : ""}${m.value.toFixed(1)} ${m.unit}`}
            </p>
            <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{m.note}</p>
            {m.comparison !== null && m.comparison !== undefined && (
              <p className="mt-2 text-xs text-muted-foreground">
                Anterior: {m.comparison >= 0 ? "+" : ""}
                {m.comparison.toFixed(1)} {m.unit === "%" ? "p.p." : "meses"}
              </p>
            )}
            <p className="mt-3 text-xs font-medium text-primary">
              {m.id === "budget"
                ? "Ver projeção, mês fechado e lançamentos →"
                : "Ver cálculo e lançamentos →"}
            </p>
          </button>
        ))}
      </section>
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Evolução dos últimos 12 meses
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Percentuais mensais; a reserva é medida em meses e aparece separadamente no cartão acima.
          Lacunas representam dados insuficientes.
        </p>
        <div className="mt-4 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis tickFormatter={(n) => `${n}%`} fontSize={11} />
              <Tooltip
                formatter={(v, name) => [
                  v === null ? "—" : `${Number(v).toFixed(1)}%`,
                  String(name),
                ]}
              />
              <Legend />
              <Line
                dataKey="budget"
                name="Orçamento"
                stroke="var(--color-chart-1)"
                connectNulls={false}
              />
              <Line
                dataKey="essential"
                name="Essenciais"
                stroke="var(--color-chart-2)"
                connectNulls={false}
              />
              <Line
                dataKey="debt"
                name="Dívidas"
                stroke="var(--color-chart-3)"
                connectNulls={false}
              />
              <Line
                dataKey="investment"
                name="Investimento"
                stroke="var(--color-chart-4)"
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-semibold flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Próximas ações · Act
          </h2>
          <div className="mt-3 space-y-2 text-sm">
            {actionable.length ? (
              actionable.map((m) => (
                <button
                  key={m.id}
                  className="block w-full rounded-lg border p-3 text-left hover:border-primary"
                  onClick={() =>
                    m.id === "budget"
                      ? setBudgetDetailOpen(true)
                      : m.id === "essential"
                        ? setEssentialDetailOpen(true)
                        : setSelected(m)
                  }
                >
                  <strong>{m.title}:</strong>{" "}
                  {m.id === "budget"
                    ? `Projeção de ${brl(budgetForecast.projected)} para um limite de ${brl(projectedBudget)}. Abra o detalhamento para identificar as categorias e rotinas de maior impacto.`
                    : m.recommendation}
                </button>
              ))
            ) : (
              <p className="text-muted-foreground">
                {summary.insuficiente
                  ? "Complete os cadastros indicados para obter recomendações confiáveis."
                  : "Sem ações corretivas prioritárias no período."}
              </p>
            )}
          </div>
        </section>
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-semibold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Qualidade dos dados
          </h2>
          {quality.length ? (
            <ul className="mt-3 space-y-2 text-sm list-disc pl-5">
              {quality.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Nenhum problema de cadastro detectado pelas verificações disponíveis.
            </p>
          )}
        </section>
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setConfiguration(false);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.title}</DialogTitle>
          </DialogHeader>
          {selected && (
            <button
              type="button"
              className="inline-flex items-center gap-2 self-start rounded-lg border px-3 py-2 text-xs hover:bg-muted"
              onClick={() => setConfiguration((v) => !v)}
            >
              <Settings2 className="h-4 w-4" />{" "}
              {configuration ? "Ocultar parâmetros" : "Configurar indicador"}
            </button>
          )}
          {selected && configuration && indicatorSettings(selected.id)}
          {selected && (
            <div className="space-y-4 text-sm">
              <p className="font-medium">
                {statusLabel[selected.status]} ·{" "}
                {selected.value === null
                  ? "Dados insuficientes"
                  : `${selected.value.toFixed(2)} ${selected.unit}`}
              </p>
              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Fórmula</p>
                <p>{selected.formula}</p>
                <p className="mt-2">
                  Numerador: {money(selected.numerator)} · Denominador:{" "}
                  {money(selected.denominator)}
                </p>
              </div>
              <p>{selected.note}</p>
              <p>
                <strong>Meta:</strong> {selected.target}
              </p>
              <p>
                <strong>Comparação anterior:</strong>{" "}
                {selected.comparison === null || selected.comparison === undefined
                  ? "Não comparável neste período"
                  : `${selected.comparison >= 0 ? "+" : ""}${selected.comparison.toFixed(2)} ${selected.unit === "%" ? "p.p." : "meses"}`}
              </p>
              {selected.extra?.map((x) => (
                <p key={x}>{x}</p>
              ))}
              <div>
                <h3 className="font-semibold">Lançamentos / componentes do cálculo</h3>
                <div className="mt-2 max-h-64 overflow-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        <th className="p-2 text-left">Descrição / Categoria</th>
                        <th className="p-2">Data</th>
                        <th className="p-2 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.lines
                        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
                        .map((l) => (
                          <tr key={l.id} className="border-b">
                            <td className="p-2">
                              {l.description}
                              <span className="block text-muted-foreground">{l.category}</span>
                            </td>
                            <td className="p-2">{l.date}</td>
                            <td className="p-2 text-right whitespace-nowrap">{brl(l.amount)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {!selected.lines.length && (
                    <p className="p-3 text-muted-foreground">
                      Nenhum lançamento identificado. Verifique os cadastros e o período.
                    </p>
                  )}
                </div>
              </div>
              {selected.denominatorLines && (
                <div>
                  <h3 className="font-semibold">Componentes do denominador</h3>
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border">
                    {selected.denominatorLines.length ? (
                      selected.denominatorLines.map((l) => (
                        <div key={l.id} className="flex justify-between gap-2 border-b p-2 text-xs">
                          <span>
                            {l.description} · {l.category}
                          </span>
                          <span className="whitespace-nowrap">{brl(l.amount)}</span>
                        </div>
                      ))
                    ) : (
                      <p className="p-3 text-muted-foreground">
                        Não há componentes registrados para o denominador.
                      </p>
                    )}
                  </div>
                </div>
              )}
              {selected.lines.length > 0 && (
                <div>
                  <h3 className="font-semibold">Maiores impactos por categoria</h3>
                  {Object.entries(
                    selected.lines.reduce(
                      (acc, l) => ({ ...acc, [l.category]: (acc[l.category] ?? 0) + l.amount }),
                      {} as Record<string, number>,
                    ),
                  )
                    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                    .slice(0, 5)
                    .map(([category, value]) => (
                      <p key={category} className="flex justify-between gap-2 py-1 text-xs">
                        <span>{category}</span>
                        <span>{brl(value)}</span>
                      </p>
                    ))}
                </div>
              )}
              <p className="rounded-lg border p-3">
                <strong>Ação recomendada:</strong> {selected.recommendation}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

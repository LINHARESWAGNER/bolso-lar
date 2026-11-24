import { isThirdPartyTransaction } from "@/lib/derive";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Info, Settings2, Target, TrendingDown } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { brl } from "@/lib/format";
import { buildEssentialCashTimeline } from "@/lib/essential-cash-timeline";
import { projectEssentialVariableBudget } from "@/lib/essential-planning-projection";
import { auditEssentialPlanning } from "@/lib/essential-planning-quality";
import type { Tables } from "@/lib/finance";
import {
  buildFinancialHealth,
  type HealthData,
  type HealthMetric,
  type HealthPeriod,
  type Settings,
} from "@/lib/financial-health";

type CategoryGroup = {
  id: string;
  name: string;
  amount: number;
  lines: HealthMetric["lines"];
  children: { id: string; name: string; amount: number; lines: HealthMetric["lines"] }[];
};
const fmtPercent = (n: number | null | undefined) =>
  n == null ? "—" : `${n.toFixed(2).replace(".", ",")}%`;
const shortMonth = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
const longMonth = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const moneyValue = (n: number | null | undefined) => brl(n ?? 0);
const newPeriod = (year: number, monthIndex: number): HealthPeriod => {
  const d = new Date(year, monthIndex, 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return {
    start: `${d.getFullYear()}-${month}-01`,
    end: `${d.getFullYear()}-${month}-${String(end.getDate()).padStart(2, "0")}`,
    months: 1,
  };
};

export function EssentialCommitmentDetail({
  metric,
  previous,
  period,
  data,
  recurrences,
  recurrencesLoading,
  recurrencesError,
  settings,
  today,
  onBack,
  settingsPanel,
  onIncomeClassification,
}: {
  metric: HealthMetric;
  previous: HealthMetric | undefined;
  period: HealthPeriod;
  data: HealthData;
  recurrences: Tables["recurring_transactions"]["Row"][];
  recurrencesLoading: boolean;
  recurrencesError: boolean;
  settings: Settings;
  today: string;
  onBack: () => void;
  settingsPanel?: import("react").ReactNode;
  onIncomeClassification?: (
    id: string,
    classification: "habitual" | "extraordinaria" | "ajuste_tecnico",
  ) => void | Promise<void>;
}) {
  const [showFormula, setShowFormula] = useState(false);
  const [showAllMonths, setShowAllMonths] = useState(false);
  const [chartRangeOpen, setChartRangeOpen] = useState(false);
  const [chartRange, setChartRange] = useState<{ start: string; end: string } | null>(null);
  const [draftChartStart, setDraftChartStart] = useState(() =>
    newPeriod(Number(period.start.slice(0, 4)), Number(period.start.slice(5, 7)) - 12).start.slice(
      0,
      7,
    ),
  );
  const [draftChartEnd, setDraftChartEnd] = useState(() =>
    newPeriod(Number(period.start.slice(0, 4)), Number(period.start.slice(5, 7)) + 2).start.slice(
      0,
      7,
    ),
  );
  const [auditOpen, setAuditOpen] = useState(false);
  const [showExcludedAuditTransactions, setShowExcludedAuditTransactions] = useState(false);
  const [auditMonth, setAuditMonth] = useState("");
  const [auditTransactionType, setAuditTransactionType] = useState<"despesa" | "receita">(
    "despesa",
  );
  const [incomeConfigMonth, setIncomeConfigMonth] = useState(today.slice(0, 7));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expandedMilestone, setExpandedMilestone] = useState<number | null>(null);
  const milestoneGridRef = useRef<HTMLDivElement | null>(null);
  const [milestoneGridHeight, setMilestoneGridHeight] = useState(0);

  // Exibe somente anos com lançamentos ou orçamentos carregados.
  // Um planejamento futuro (ex.: 2028) entra automaticamente nas opções.
  const chartAvailableYears = useMemo(() => {
    const years = new Set<string>();
    const include = (value: string | null | undefined) => {
      if (value && /^\d{4}-(0[1-9]|1[0-2])(?:-\d{2})?$/.test(value)) {
        years.add(value.slice(0, 4));
      }
    };
    for (const transaction of data.transactions) include(transaction.competence_date);
    for (const budget of data.budgets) include(budget.reference_month);
    return Array.from(years).sort();
  }, [data.transactions, data.budgets]);

  const income = metric.denominator ?? 0;
  const essentials = metric.numerator ?? 0;
  const target = settings.essential_max_pct;
  const targetValue = (income * target) / 100;
  const excess = Math.max(0, essentials - targetValue);
  const variation =
    metric.value != null && previous?.value != null ? metric.value - previous.value : null;
  const valid = metric.value !== null;

  // Agrupamento feito exclusivamente pelos lançamentos aceitos no numerador do indicador.
  // Nunca recalcula o indicador nem soma novamente o pagamento da fatura.
  const groups = useMemo<CategoryGroup[]>(() => {
    const categoriesById = new Map(data.categories.map((c) => [c.id, c]));
    const txById = new Map(data.transactions.map((t) => [t.id, t]));
    const roots = new Map<
      string,
      {
        id: string;
        name: string;
        amount: number;
        lines: HealthMetric["lines"];
        children: Map<
          string,
          { id: string; name: string; amount: number; lines: HealthMetric["lines"] }
        >;
      }
    >();
    for (const line of metric.lines) {
      const transaction = txById.get(line.id);
      const leaf = transaction?.category_id
        ? categoriesById.get(transaction.category_id)
        : undefined;
      let root = leaf;
      const seen = new Set<string>();
      while (root?.parent_id && !seen.has(root.id)) {
        seen.add(root.id);
        const parent = categoriesById.get(root.parent_id);
        if (!parent) break;
        root = parent;
      }
      const rootId = root?.id ?? "__sem_raiz__";
      const rootName = root?.name ?? "Categoria raiz não identificada";
      const childId = leaf?.id ?? "__sem_categoria__";
      const childName = leaf?.name ?? line.category;
      let group = roots.get(rootId);
      if (!group) {
        group = { id: rootId, name: rootName, amount: 0, lines: [], children: new Map() };
        roots.set(rootId, group);
      }
      group.amount += line.amount;
      group.lines.push(line);
      let child = group.children.get(childId);
      if (!child) {
        child = { id: childId, name: childName, amount: 0, lines: [] };
        group.children.set(childId, child);
      }
      child.amount += line.amount;
      child.lines.push(line);
    }
    return [...roots.values()]
      .map((g) => ({
        id: g.id,
        name: g.name,
        amount: g.amount,
        lines: g.lines,
        children: [...g.children.values()].sort((a, b) => b.amount - a.amount),
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [data.categories, data.transactions, metric.lines]);

  const trend = useMemo(() => {
    const [yearText, monthText] = period.start.split("-");
    const year = Number(yearText);
    const monthIndex = Number(monthText) - 1;
    const firstKnown = data.transactions
      .map((t) => t.competence_date)
      .filter(Boolean)
      .sort()[0];
    const points: {
      month: string;
      label: string;
      historico: number | null;
      cadastrados: number | null;
      complemento: number;
      meta: number;
    }[] = [];
    const firstOffset = firstKnown
      ? (Number(firstKnown.slice(0, 4)) - year) * 12 +
        Number(firstKnown.slice(5, 7)) -
        1 -
        monthIndex
      : -11;
    const monthOffset = (key: string) =>
      (Number(key.slice(0, 4)) - year) * 12 + Number(key.slice(5, 7)) - 1 - monthIndex;
    const fromOffset = chartRange
      ? monthOffset(chartRange.start)
      : showAllMonths
        ? Math.min(-11, firstOffset)
        : -11;
    const toOffset = chartRange ? monthOffset(chartRange.end) : 3;
    for (let offset = fromOffset; offset <= toOffset; offset++) {
      const p = newPeriod(year, monthIndex + offset);
      if (!chartRange && firstKnown && p.end < firstKnown) continue;
      const essential = buildFinancialHealth(data, settings, p, today).find(
        (m) => m.id === "essential",
      );
      const isFuture = offset > 0;
      const projection = isFuture ? projectEssentialVariableBudget(data, p.start) : null;
      const complemento = projection?.complement ?? 0;
      // Mes fechado: base auditada. Mes aberto/futuro: registrados + complemento orcamentario.
      // Nao soma duas vezes a parte variavel que ja esta em transactions.
      const projected =
        essential?.value != null && (essential.denominator ?? 0) > 0
          ? (((essential.numerator ?? 0) + complemento) / (essential.denominator ?? 1)) * 100
          : null;
      points.push({
        month: p.start,
        label: shortMonth(p.start),
        historico: isFuture ? null : (essential?.value ?? null),
        // Futuro: receitas cadastradas e despesas registradas com complemento orçamentário essencial.
        // Orçamento ausente ou misto permanece sem estimativa automática; auditar a origem.
        cadastrados: isFuture ? projected : null,
        complemento,
        meta: target,
      });
    }
    return points;
  }, [chartRange, data, period.start, settings, showAllMonths, target, today]);

  // Auditoria: reaproveita exatamente a função e as competências do gráfico.
  // Os IDs nas linhas identificam os lançamentos incluídos no numerador e no denominador.
  const auditMonths = useMemo(
    () =>
      trend.map((point) => {
        const monthPeriod = newPeriod(
          Number(point.month.slice(0, 4)),
          Number(point.month.slice(5, 7)) - 1,
        );
        const metric = buildFinancialHealth(data, settings, monthPeriod, today).find(
          (item) => item.id === "essential",
        );
        const projection =
          point.month.slice(0, 7) >= period.start.slice(0, 7)
            ? projectEssentialVariableBudget(data, point.month)
            : null;
        const registeredNumerator = metric?.numerator ?? 0;
        const plannedComplement = point.complemento;
        const numerator = registeredNumerator + plannedComplement;
        const denominator = metric?.denominator ?? 0;
        const recalculated =
          denominator > 0 && metric?.value !== null ? (numerator / denominator) * 100 : null;
        return {
          month: point.month,
          label: point.label,
          period: monthPeriod,
          numerator,
          registeredNumerator,
          plannedComplement,
          projection,
          denominator,
          plottedValue: point.historico ?? point.cadastrados,
          recalculated,
          metric,
          future: point.month.slice(0, 7) > period.start.slice(0, 7),
          quality: auditEssentialPlanning(data, today, point.month, projection),
        };
      }),
    [trend, data, settings, today, period.start],
  );
  // A interface alerta apenas sobre o planejamento do mês corrente.
  // O diagnóstico dos meses futuros permanece disponível na auditoria técnica/CSV.
  const currentPlanningAudit = auditMonths.find((month) => month.month === today.slice(0, 7));
  const currentPlanningAlerts = currentPlanningAudit?.quality.alerts ?? [];
  const selectedAudit =
    auditMonths.find((month) => month.month === auditMonth) ?? auditMonths[auditMonths.length - 1];
  const auditTransactions = useMemo(() => {
    if (!selectedAudit?.metric) return [];
    const numeratorIds = new Set(selectedAudit.metric.lines.map((line) => line.id));
    const denominatorIds = new Set(
      (selectedAudit.metric.denominatorLines ?? []).map((line) => line.id),
    );
    const names = new Map(data.categories.map((category) => [category.id, category.name]));
    return data.transactions
      .filter(
        (tx) =>
          tx.competence_date >= selectedAudit.period.start &&
          tx.competence_date <= selectedAudit.period.end,
      )
      .map((tx) => ({
        id: tx.id,
        description: tx.description,
        date: tx.competence_date,
        type: tx.type,
        status: tx.status,
        amount: Number(tx.amount) || 0,
        category: names.get(tx.category_id ?? "") ?? "Sem categoria",
        inNumerator: numeratorIds.has(tx.id),
        inDenominator: denominatorIds.has(tx.id),
        thirdParty: isThirdPartyTransaction(data.categories, tx),
      }))
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) || a.description.localeCompare(b.description, "pt-BR"),
      );
  }, [selectedAudit, data.transactions, data.categories]);
  const displayedAuditTransactions = auditTransactions.filter(
    (tx) =>
      tx.type === auditTransactionType &&
      (showExcludedAuditTransactions || tx.inNumerator || tx.inDenominator),
  );
  const auditCountByType = (type: "despesa" | "receita") =>
    auditTransactions.filter(
      (tx) =>
        tx.type === type && (showExcludedAuditTransactions || tx.inNumerator || tx.inDenominator),
    ).length;
  const excludedAuditTransactionCount = auditTransactions.filter(
    (tx) => tx.type === auditTransactionType && !tx.inNumerator && !tx.inDenominator,
  ).length;
  const downloadAuditCsv = () => {
    const escapeCsv = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows: (string | number)[][] = [
      [
        "competencia",
        "descricao",
        "data_competencia",
        "tipo",
        "situacao",
        "categoria",
        "valor",
        "numerador_essenciais",
        "denominador_receitas",
        "id_lancamento",
        "total_essenciais_mes",
        "total_receitas_mes",
        "complemento_orcamento_essencial",
        "essenciais_registrados",
        "percentual_grafico",
        "percentual_recalculado",
        "ponto_futuro_parcial",
        "origem_linha",
        "categoria_raiz_planejada",
        "valor_orcado",
        "variavel_essencial_registrada_raiz",
        "complemento_raiz",
        "situacao_classificacao",
        "orcamentos_mes",
        "itens_orcamento_mes",
      ],
    ];
    for (const month of auditMonths) {
      const numeratorIds = new Set(month.metric?.lines.map((line) => line.id) ?? []);
      const denominatorIds = new Set(month.metric?.denominatorLines?.map((line) => line.id) ?? []);
      const names = new Map(data.categories.map((category) => [category.id, category.name]));
      const txs = data.transactions.filter(
        (tx) => tx.competence_date >= month.period.start && tx.competence_date <= month.period.end,
      );
      if (txs.length === 0) {
        rows.push([
          month.label,
          "[sem lançamentos]",
          "",
          "",
          "",
          "",
          "",
          0,
          0,
          "",
          month.numerator,
          month.denominator,
          month.plannedComplement,
          month.registeredNumerator,
          month.plottedValue ?? "",
          month.recalculated ?? "",
          month.future ? "SIM" : "NÃO",
          "lancamento",
          "",
          "",
          "",
          "",
          "",
          month.projection?.budgetCount ?? "",
          month.projection?.budgetItemCount ?? "",
        ]);
      }
      for (const tx of txs) {
        rows.push([
          month.label,
          tx.description,
          tx.competence_date,
          tx.type,
          tx.status,
          names.get(tx.category_id ?? "") ?? "Sem categoria",
          Number(tx.amount) || 0,
          numeratorIds.has(tx.id) ? "SIM" : "NÃO",
          denominatorIds.has(tx.id) ? "SIM" : "NÃO",
          tx.id,
          month.numerator,
          month.denominator,
          month.plannedComplement,
          month.registeredNumerator,
          month.plottedValue ?? "",
          month.recalculated ?? "",
          month.future ? "SIM" : "NÃO",
          "lancamento",
          "",
          "",
          "",
          "",
          "",
          month.projection?.budgetCount ?? "",
          month.projection?.budgetItemCount ?? "",
        ]);
      }
      if (month.future && month.projection) {
        for (const source of month.projection.sources) {
          const root = month.projection.rows.find((row) => row.categoryId === source.rootId);
          rows.push([
            month.label,
            `[PLANEJAMENTO] ${source.category}`,
            month.period.start,
            "planejamento",
            "",
            source.category,
            source.amount,
            "",
            "",
            "",
            month.numerator,
            month.denominator,
            month.plannedComplement,
            month.registeredNumerator,
            month.plottedValue ?? "",
            month.recalculated ?? "",
            "SIM",
            "budget_items",
            source.rootCategory,
            source.amount,
            root?.registered ?? 0,
            root?.complement ?? 0,
            source.status,
            month.projection.budgetCount,
            month.projection.budgetItemCount,
          ]);
        }
        if (!month.projection.hasBudget) {
          rows.push([
            month.label,
            "[AUDITORIA] Sem orçamento na competência",
            month.period.start,
            "planejamento",
            "",
            "",
            "",
            "",
            "",
            "",
            month.numerator,
            month.denominator,
            month.plannedComplement,
            month.registeredNumerator,
            month.plottedValue ?? "",
            month.recalculated ?? "",
            "SIM",
            "ausencia_orcamento",
            "",
            "",
            "",
            "",
            "sem_orcamento_mes",
            0,
            0,
          ]);
        }
      }
    }
    rows[0].push("alertas_qualidade", "cobertura_orcamento_pct");
    for (const row of rows.slice(1)) {
      const audit = auditMonths.find((item) => item.label === row[0]);
      row.push(
        audit?.quality.alerts
          .map((alert) => `${alert.category}: ${alert.description}`)
          .join(" | ") ?? "",
      );
      row.push(audit?.quality.coveragePct ?? "");
    }
    rows[0].push("classificacao_receita");
    for (const row of rows.slice(1)) {
      const transactionId = String(row[9] ?? "");
      row.push(
        row[3] === "receita" &&
          !isThirdPartyTransaction(
            data.categories,
            data.transactions.find((tx) => tx.id === transactionId) ?? { category_id: null },
          )
          ? (data.incomeClassifications?.find((item) => item.transaction_id === transactionId)
              ?.classification ?? "habitual")
          : "",
      );
    }
    const content = "\uFEFF" + rows.map((row) => row.map(escapeCsv).join(";")).join("\r\n");
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `auditoria-grafico-essenciais-${today}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Reconcilia eventos cadastrados de parcelas finais e recorrências com continuidade explícita.
  // Um aumento programado compensa uma redução, inclusive quando é uma nova fase vinculada.
  const milestones = useMemo(
    () =>
      buildEssentialCashTimeline({
        today,
        categories: data.categories,
        essentials: data.essentials,
        recurrences,
        transactions: data.transactions,
        groups: data.groups,
      }),
    [today, data.categories, data.essentials, data.transactions, data.groups, recurrences],
  );
  // Ordenação apenas visual: utiliza IDs explícitos das recorrências, nunca nomes parecidos
  // para deduzir continuidade. Sem vínculo, ordena alfabeticamente.
  const orderedMilestones = useMemo(() => {
    const byId = new Map(recurrences.map((recurrence) => [recurrence.id, recurrence]));
    const linkedPreviousIds = new Set(
      recurrences
        .map((recurrence) => recurrence.predecessor_recurrence_id)
        .filter((id): id is string => id !== null),
    );

    const rootRecurrence = (id: string) => {
      let current = byId.get(id);
      const visited = new Set<string>();
      while (current?.predecessor_recurrence_id && !visited.has(current.id)) {
        visited.add(current.id);
        const previous = byId.get(current.predecessor_recurrence_id);
        if (!previous) break;
        current = previous;
      }
      return current;
    };

    const eventOrder = (event: (typeof milestones)[number]["events"][number]) => {
      const match = /^rec-(?:start|end):(.+)$/.exec(event.id);
      const recurrence = match ? byId.get(match[1]) : undefined;
      if (recurrence) {
        const isLinked =
          recurrence.predecessor_recurrence_id !== null || linkedPreviousIds.has(recurrence.id);
        if (isLinked) {
          const root = rootRecurrence(recurrence.id) ?? recurrence;
          return {
            group: root.description,
            key: `linked:${root.id}`,
            priority: event.delta < 0 ? 0 : 1,
          };
        }
      }
      return { group: event.description, key: `single:${event.id}`, priority: 0 };
    };

    return milestones.map((milestone) => ({
      ...milestone,
      events: [...milestone.events].sort((a, b) => {
        const left = eventOrder(a);
        const right = eventOrder(b);
        const nameOrder = left.group.localeCompare(right.group, "pt-BR", {
          sensitivity: "base",
        });
        if (nameOrder) return nameOrder;
        if (left.key === right.key) {
          if (left.priority !== right.priority) return left.priority - right.priority;
          const dateOrder = a.effectiveMonth.localeCompare(b.effectiveMonth);
          if (dateOrder) return dateOrder;
        }
        return (
          a.description.localeCompare(b.description, "pt-BR", { sensitivity: "base" }) ||
          a.id.localeCompare(b.id)
        );
      }),
    }));
  }, [milestones, recurrences]);

  // Mede a altura real reservada aos marcos: o limite de itens depende do espaco,
  // nao de uma quantidade fixa de lancamentos.
  useEffect(() => {
    const element = milestoneGridRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const height = Math.floor(entries[0]?.contentRect.height ?? 0);
      setMilestoneGridHeight((previous) => (Math.abs(previous - height) > 1 ? height : previous));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const milestoneRows = useMemo(() => {
    const desired = orderedMilestones.map((m) => Math.ceil(m.events.length / 2));
    if (!milestoneGridHeight) return desired;

    const compact = milestoneGridHeight <= 500;
    const gap = compact ? 6 : 8;
    // Reserva por marco: bordas, cabecalho, resumo de variacao e respiro interno.
    // 16px por linha com dois lancamentos, para preservar a legibilidade.
    const base = compact ? 50 : 66;
    const rowHeight = compact ? 14 : 16;
    const extraButton = compact ? 18 : 19;
    const available = Math.max(0, milestoneGridHeight - gap * (orderedMilestones.length - 1));
    if (desired.reduce((sum, n) => sum + n * rowHeight + base, 0) <= available) {
      return desired;
    }

    const allocate = (capacity: number) => {
      const rows = desired.map(() => 0);
      while (rows.reduce((sum, n) => sum + n, 0) < capacity) {
        const options = desired
          .map((want, i) => ({ i, remaining: want - rows[i], filled: rows[i] }))
          .filter(({ remaining }) => remaining > 0)
          .sort((a, b) => a.filled - b.filled || b.remaining - a.remaining);
        if (!options.length) break;
        rows[options[0].i] += 1;
      }
      return rows;
    };

    let capacity = Math.max(
      0,
      Math.floor((available - orderedMilestones.length * base) / rowHeight),
    );
    let rows = allocate(capacity);
    // Se houver ocultacao, reservar a linha do botao no proprio calculo de altura.
    for (let attempt = 0; attempt < 3; attempt++) {
      const moreCount = desired.filter((want, i) => rows[i] < want).length;
      const nextCapacity = Math.max(
        0,
        Math.floor(
          (available - orderedMilestones.length * base - moreCount * extraButton) / rowHeight,
        ),
      );
      if (nextCapacity >= capacity) break;
      capacity = nextCapacity;
      rows = allocate(capacity);
    }
    return rows;
  }, [orderedMilestones, milestoneGridHeight]);

  const matrixSum = groups.reduce((sum, group) => sum + group.amount, 0);
  const difference = matrixSum - essentials;
  const rootColors = [
    "#438eff",
    "#15c9de",
    "#7775ff",
    "#22c79c",
    "#eda61f",
    "#b35bff",
    "#8ea5c6",
    "#559ee2",
    "#a3b1c3",
  ];

  return (
    <main
      className="essential-detail-root fixed inset-0 z-50 flex flex-col overflow-x-hidden overflow-y-auto bg-[#090f1b] text-foreground"
      aria-label="Detalhamento do comprometimento com essenciais"
    >
      <style>{`
        /* Estilos restritos ao detalhamento dos essenciais. */
        .essential-detail-content { min-height: calc(100dvh - 64px); }
        .essential-detail-panels { min-height: 420px; }

        /* O notebook usa densidade semelhante ao zoom de 90%, sem alterar o zoom. */
        @media (max-height: 850px) and (min-width: 1100px) {
          .essential-detail-header > div { padding-top: 7px; padding-bottom: 7px; }
          .essential-detail-content { min-height: calc(100dvh - 58px); gap: 6px; padding-top: 6px; padding-bottom: 6px; }
          .essential-detail-summary > article { min-height: 98px; padding-top: 7px; padding-bottom: 7px; }
          .essential-detail-summary > article .mt-2 { margin-top: 5px; }
          .essential-detail-chart { padding-top: 7px; padding-bottom: 7px; }
          .essential-detail-chart-plot { height: 82px; }
          .essential-detail-panels { min-height: 386px; gap: 8px; }
          .essential-detail-panels > article { padding: 10px; }
          .essential-detail-milestones { gap: 6px; }
          .essential-detail-milestone { padding-top: 5px; padding-bottom: 5px; }
        }

        /* Quando a largura física útil é pequena, empilhar em vez de cortar. */
        @media (max-width: 1099px) {
          .essential-detail-content { min-height: 0; }
          .essential-detail-panels { grid-template-columns: minmax(0, 1fr); min-height: 0; }
          .essential-detail-panels > article { min-height: 420px; }
        }
        @media (max-width: 800px) {
          .essential-detail-summary { grid-template-columns: minmax(0, 1fr); }
          .essential-detail-panels > article { min-height: 400px; }
        }
        @media (max-width: 660px) {
          .essential-detail-matrix-header { display: none; }
          .essential-detail-matrix-row {
            grid-template-columns: minmax(0, 1fr) 70px 88px;
            grid-auto-rows: auto;
            gap: 2px 8px;
            padding-top: 6px;
            padding-bottom: 6px;
          }
          .essential-detail-matrix-row > :nth-child(1) { grid-column: 1; grid-row: 1; }
          .essential-detail-matrix-row > :nth-child(2) { grid-column: 2; grid-row: 1; }
          .essential-detail-matrix-row > :nth-child(3) { grid-column: 3; grid-row: 1; }
          .essential-detail-matrix-row > :nth-child(4) { grid-column: 1 / -1; grid-row: 2; }
          .essential-detail-matrix-row > :nth-child(5) { grid-column: 3; grid-row: 3; }
          .essential-detail-matrix-row > :nth-child(4) { white-space: normal; overflow-wrap: anywhere; }
        }
      `}</style>
      <header className="essential-detail-header sticky top-0 z-20 shrink-0 border-b border-[#25364e] bg-[#0c1526]">
        <div className="mx-auto flex w-full max-w-[1536px] items-center justify-between gap-4 px-5 py-3">
          <div className="flex min-w-0 items-center gap-4">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft size={15} /> Voltar
            </button>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[.17em] text-primary">
                Etapa 4 · Verificação
              </div>
              <h1 className="truncate text-lg font-semibold">
                Comprometimento com essenciais{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  · Visão de conciliação
                </span>
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFormula((v) => !v)}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-[#2c4365] px-3 py-1.5 text-xs hover:bg-muted"
            >
              <Info size={13} /> Como foi calculado
            </button>
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#2c4365] px-3 py-1.5 text-xs hover:bg-muted"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={13} /> Configurar indicador
            </button>
          </div>
        </div>
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
            <section className="rounded-lg border p-3 space-y-2">
              <h3 className="text-sm font-semibold">Composição da renda de referência</h3>
              <p className="text-xs text-muted-foreground">
                Classifique as receitas deste indicador. Habitual entra no denominador;
                extraordinária e ajuste técnico não entram. Todos os lançamentos continuam no fluxo
                de caixa.
              </p>
              <label className="block text-xs">
                Competência
                <input
                  type="month"
                  className="ml-2 rounded border bg-background px-2 py-1"
                  value={incomeConfigMonth}
                  onChange={(e) => setIncomeConfigMonth(e.target.value)}
                />
              </label>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {data.transactions
                  .filter(
                    (tx) =>
                      tx.type === "receita" &&
                      tx.competence_date.startsWith(incomeConfigMonth) &&
                      !isThirdPartyTransaction(data.categories, tx),
                  )
                  .sort((a, b) => a.description.localeCompare(b.description, "pt-BR"))
                  .map((tx) => (
                    <div
                      key={tx.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b py-1.5 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="truncate" title={tx.description}>
                          {tx.description}
                        </div>
                        <span className="text-muted-foreground">{brl(Number(tx.amount) || 0)}</span>
                      </div>
                      <select
                        aria-label={`Classificação de ${tx.description}`}
                        className="max-w-[170px] rounded border bg-background p-1 text-xs"
                        value={
                          data.incomeClassifications?.find((row) => row.transaction_id === tx.id)
                            ?.classification ?? "habitual"
                        }
                        onChange={(e) =>
                          void onIncomeClassification?.(
                            tx.id,
                            e.target.value as "habitual" | "extraordinaria" | "ajuste_tecnico",
                          )
                        }
                      >
                        <option value="habitual">Habitual</option>
                        <option value="extraordinaria">Extraordinária</option>
                        <option value="ajuste_tecnico">Ajuste técnico</option>
                      </select>
                    </div>
                  ))}
                {!data.transactions.some(
                  (tx) =>
                    tx.type === "receita" &&
                    tx.competence_date.startsWith(incomeConfigMonth) &&
                    !isThirdPartyTransaction(data.categories, tx),
                ) && (
                  <p className="text-xs text-muted-foreground">Sem receitas nesta competência.</p>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {auditOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-3"
          role="dialog"
          aria-modal="true"
          aria-label="Auditoria do gráfico de comprometimento com essenciais"
        >
          <div className="flex max-h-[94vh] w-full max-w-6xl flex-col gap-3 overflow-hidden rounded-xl border border-[#315577] bg-[#101d32] p-4 shadow-2xl">
            <div className="flex shrink-0 items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Auditoria · Evolução mensal</h2>
                <p className="text-[10px] text-amber-300">
                  Meses futuros: essenciais = registrados + complemento planejado. O CSV registra o
                  total consolidado.
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Percentual do gráfico, totais mensais e rastreamento dos lançamentos por
                  competência.
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={downloadAuditCsv}
                  className="rounded-md border border-[#315577] px-3 py-1.5 text-xs text-[#a9d1ff] hover:bg-[#203b59]"
                >
                  Exportar CSV completo
                </button>
                <button
                  type="button"
                  onClick={() => setAuditOpen(false)}
                  className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  Fechar
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
              {selectedAudit &&
                selectedAudit.month === today.slice(0, 7) &&
                selectedAudit.quality.alerts.length > 0 && (
                  <section
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
                    aria-label="Divergências de planejamento do mês atual"
                  >
                    <h3 className="text-sm font-semibold text-amber-200">
                      Possíveis divergências no planejamento de {selectedAudit.label}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Ajuste os valores na Etapa 3 · Planejamento. Esta auditoria apenas identifica
                      diferenças; não confirma nem modifica seu orçamento.
                    </p>
                    <ul className="mt-2 space-y-1 text-xs">
                      {selectedAudit.quality.alerts.map((alert) => (
                        <li key={`${alert.categoryId}-${alert.kind}`}>
                          <strong>{alert.category}</strong>: {alert.description} · referência
                          histórica {brl(alert.baseline)} · orçamento {brl(alert.planned)}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              <div className="overflow-x-auto rounded-lg border border-[#2b3d58]">
                <table className="w-full min-w-[760px] table-fixed text-left text-[11px]">
                  <thead className="bg-[#152b43] text-[#b5c8e4]">
                    <tr>
                      <th className="p-2">Competência</th>
                      <th className="p-2 text-right">Receitas</th>
                      <th className="p-2 text-right">Essenciais (com plano)</th>
                      <th className="p-2 text-right">Gráfico</th>
                      <th className="p-2 text-right">Recalculado</th>
                      <th className="p-2">Tipo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditMonths.map((month) => (
                      <tr
                        key={month.month}
                        onClick={() => setAuditMonth(month.month)}
                        className={`cursor-pointer border-t border-[#2b3d58] hover:bg-[#1b314e] ${selectedAudit?.month === month.month ? "bg-[#203b59]" : ""}`}
                      >
                        <td className="p-2 font-medium">{month.label}</td>
                        <td className="p-2 text-right tabular-nums">{brl(month.denominator)}</td>
                        <td className="p-2 text-right tabular-nums">{brl(month.numerator)}</td>
                        <td className="p-2 text-right tabular-nums">
                          {fmtPercent(month.plottedValue)}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {fmtPercent(month.recalculated)}
                        </td>
                        <td className="p-2">{month.future ? "Futuro parcial" : "Histórico"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {selectedAudit?.future && selectedAudit.projection && (
                <div className="space-y-2 rounded-lg border border-[#2b3d58] p-3">
                  <h3 className="text-sm font-semibold">
                    Origem do planejamento · {selectedAudit.label}
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    Orçamentos encontrados: {selectedAudit.projection.budgetCount} · Itens:{" "}
                    {selectedAudit.projection.budgetItemCount} · Complemento aplicado:{" "}
                    {brl(selectedAudit.projection.complement)}. Os itens não essenciais, mistos ou
                    pendentes não são incluídos automaticamente.
                  </p>
                  {!selectedAudit.projection.hasBudget && (
                    <p className="text-xs text-amber-300">
                      Nenhum planejamento mensal encontrado em budgets/budget_items para esta
                      competência. Meses com orçamento carregado:{" "}
                      {selectedAudit.projection.availableBudgetMonths.join(", ") || "nenhum"}. Não
                      foi copiado orçamento de outro mês.
                    </p>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[700px] text-left text-[11px]">
                      <thead className="text-[#b5c8e4]">
                        <tr>
                          <th className="p-2">Categoria do orçamento</th>
                          <th className="p-2">Raiz</th>
                          <th className="p-2 text-right">Orçado</th>
                          <th className="p-2">Classificação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedAudit.projection.sources.map((item) => (
                          <tr
                            key={`${item.budgetId}-${item.categoryId}`}
                            className="border-t border-[#2b3d58]"
                          >
                            <td className="p-2">{item.category}</td>
                            <td className="p-2">{item.rootCategory}</td>
                            <td className="p-2 text-right tabular-nums">{brl(item.amount)}</td>
                            <td
                              className={`p-2 ${item.status === "essencial" ? "text-emerald-300" : "text-amber-300"}`}
                            >
                              {item.status}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {selectedAudit.projection.issues.length > 0 && (
                    <p className="text-xs text-amber-300">
                      Verificar:{" "}
                      {selectedAudit.projection.issues
                        .map((issue) => `${issue.category} (${issue.reason})`)
                        .join(" · ")}
                    </p>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] text-left text-[11px]">
                      <thead className="text-[#b5c8e4]">
                        <tr>
                          <th className="p-2">Categoria raiz</th>
                          <th className="p-2 text-right">Orçado essencial</th>
                          <th className="p-2 text-right">Variável registrada</th>
                          <th className="p-2 text-right">Complemento</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedAudit.projection.rows.map((row) => (
                          <tr key={row.categoryId} className="border-t border-[#2b3d58]">
                            <td className="p-2">{row.category}</td>
                            <td className="p-2 text-right">{brl(row.planned)}</td>
                            <td className="p-2 text-right">{brl(row.registered)}</td>
                            <td className="p-2 text-right">{brl(row.complement)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {selectedAudit && (
                <div className="space-y-2 rounded-lg border border-[#2b3d58] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">Lançamentos · {selectedAudit.label}</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <div
                        className="inline-flex rounded-md border border-[#315577] bg-[#0b1728] p-0.5"
                        aria-label="Tipo de lançamento"
                      >
                        <button
                          type="button"
                          aria-pressed={auditTransactionType === "despesa"}
                          onClick={() => setAuditTransactionType("despesa")}
                          className={`rounded px-3 py-1 text-xs ${auditTransactionType === "despesa" ? "bg-[#244d74] text-white" : "text-[#b5c8e4] hover:bg-[#203b59]"}`}
                        >
                          Despesas ({auditCountByType("despesa")})
                        </button>
                        <button
                          type="button"
                          aria-pressed={auditTransactionType === "receita"}
                          onClick={() => setAuditTransactionType("receita")}
                          className={`rounded px-3 py-1 text-xs ${auditTransactionType === "receita" ? "bg-[#244d74] text-white" : "text-[#b5c8e4] hover:bg-[#203b59]"}`}
                        >
                          Receitas ({auditCountByType("receita")})
                        </button>
                      </div>
                      <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={showExcludedAuditTransactions}
                          onChange={(event) =>
                            setShowExcludedAuditTransactions(event.target.checked)
                          }
                          className="h-3.5 w-3.5 accent-blue-500"
                        />
                        Mostrar excluídos ({excludedAuditTransactionCount})
                      </label>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    SIM indica entrada no cálculo; NÃO indica que o lançamento não contribui para o
                    numerador ou denominador. Confira categoria, status e possíveis exclusões. Os
                    meses futuros representam apenas dados cadastrados.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-left text-[11px]">
                      <thead className="text-[#b5c8e4]">
                        <tr>
                          <th className="p-2">Descrição</th>
                          <th className="p-2">Categoria</th>
                          <th className="p-2">Competência</th>
                          <th className="p-2">Status</th>
                          <th className="p-2 text-right">Valor</th>
                          <th className="p-2 text-center">Essencial</th>
                          <th className="p-2 text-center">Receita</th>
                          <th className="p-2">Classificação da renda</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedAuditTransactions.map((tx) => (
                          <tr key={tx.id} className="border-t border-[#2b3d58]">
                            <td className="p-2" title={tx.id}>
                              {tx.description}
                            </td>
                            <td className="p-2">{tx.category}</td>
                            <td className="p-2">{tx.date}</td>
                            <td className="p-2">{tx.status}</td>
                            <td className="p-2 text-right tabular-nums">{brl(tx.amount)}</td>
                            <td
                              className={`p-2 text-center ${tx.inNumerator ? "text-emerald-300" : "text-muted-foreground"}`}
                            >
                              {tx.inNumerator ? "SIM" : "NÃO"}
                            </td>
                            <td
                              className={`p-2 text-center ${tx.inDenominator ? "text-emerald-300" : "text-muted-foreground"}`}
                            >
                              {tx.inDenominator ? "SIM" : "NÃO"}
                            </td>
                            <td className="p-2">
                              {tx.type === "receita" && !tx.thirdParty ? (
                                <select
                                  aria-label={`Classificação de ${tx.description}`}
                                  className="rounded border bg-background p-1 text-xs"
                                  value={
                                    data.incomeClassifications?.find(
                                      (row) => row.transaction_id === tx.id,
                                    )?.classification ?? "habitual"
                                  }
                                  onChange={(e) =>
                                    void onIncomeClassification?.(
                                      tx.id,
                                      e.target.value as
                                        "habitual" | "extraordinaria" | "ajuste_tecnico",
                                    )
                                  }
                                >
                                  <option value="habitual">Habitual</option>
                                  <option value="extraordinaria">Extraordinária</option>
                                  <option value="ajuste_tecnico">Ajuste técnico</option>
                                </select>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                        {displayedAuditTransactions.length === 0 && (
                          <tr>
                            <td colSpan={8} className="p-3 text-center text-muted-foreground">
                              Nenhum lançamento neste grupo com o filtro selecionado.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="essential-detail-content mx-auto flex w-full max-w-[1536px] flex-1 flex-col gap-2 px-5 py-2">
        <section
          className="essential-detail-summary grid shrink-0 grid-cols-3 gap-2"
          aria-label="Resumo"
        >
          <article className="flex min-h-[108px] flex-col rounded-xl border border-[#263955] bg-[#101d32] px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                Comprometimento · {longMonth(period.start)}
              </span>
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-semibold ${metric.status === "critico" ? "bg-destructive/15 text-destructive" : "bg-muted"}`}
              >
                {metric.status === "critico"
                  ? "Crítico"
                  : metric.status === "insuficiente"
                    ? "Dados insuficientes"
                    : metric.status === "atencao"
                      ? "Atenção"
                      : "Saudável"}
              </span>
            </div>
            <div className="mt-2 flex items-end gap-2">
              <strong
                className={`text-3xl tabular-nums ${metric.status === "critico" ? "text-destructive" : ""}`}
              >
                {fmtPercent(metric.value)}
              </strong>
              <span className="pb-1 text-xs text-muted-foreground">Meta: {fmtPercent(target)}</span>
            </div>
            <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full ${metric.status === "critico" ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${Math.min(100, Math.max(0, metric.value ?? 0))}%` }}
              />
              <div
                className="absolute inset-y-0 w-px bg-foreground"
                style={{ left: `${Math.min(100, Math.max(0, target))}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {variation === null
                ? "Sem comparação anterior"
                : `${variation >= 0 ? "+" : ""}${variation.toFixed(2).replace(".", ",")} p.p. em relação ao mês anterior`}
            </p>
          </article>
          <article className="flex min-h-[108px] flex-col rounded-xl border border-[#263955] bg-[#101d32] px-3.5 py-2.5">
            <div className="text-xs text-muted-foreground">Composição da renda · competência</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <p className="text-[11px] text-muted-foreground">Receitas registradas</p>
                <strong className="text-lg tabular-nums">{moneyValue(income)}</strong>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Despesas essenciais</p>
                <strong className="text-lg tabular-nums">{moneyValue(essentials)}</strong>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Teto ({fmtPercent(target)})</p>
                <strong className="text-sm">{moneyValue(targetValue)}</strong>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Excedente da meta</p>
                <strong className="text-sm text-destructive">
                  {valid ? moneyValue(excess) : "—"}
                </strong>
              </div>
            </div>
          </article>
          <article className="flex min-h-[108px] flex-col rounded-xl border border-[#263955] bg-[#101d32] px-3.5 py-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
              <Target size={14} /> Decisão recomendada
            </div>
            <strong className="mt-2 block text-sm">
              {!valid
                ? "Validar as classificações para concluir o indicador"
                : excess > 0
                  ? `Diferença para a meta: ${brl(excess)}`
                  : "Comprometimento dentro da meta"}
            </strong>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {!valid
                ? metric.note
                : excess > 0
                  ? `As despesas essenciais representam ${fmtPercent(metric.value)} das receitas de ${longMonth(period.start)}, ante a referência de ${fmtPercent(target)}.`
                  : `As despesas essenciais permanecem dentro da referência de ${fmtPercent(target)}.`}
            </p>
          </article>
        </section>

        {showFormula && (
          <section className="shrink-0 rounded-xl border bg-card p-3 text-xs">
            <strong>Memória do cálculo</strong>
            <p className="mt-1">
              {metric.formula} · {brl(essentials)} ÷ {brl(income)}. {metric.note}
            </p>
            <p className="mt-1 text-muted-foreground">
              Pagas e previstas pela competência. Terceiros, transferências, pagamentos de fatura,
              cancelamentos e investimentos são excluídos pela regra do indicador.
            </p>
          </section>
        )}

        <section
          className="essential-detail-chart shrink-0 rounded-xl border border-[#263955] bg-[#101d32] px-3.5 py-2"
          aria-label="Evolução mensal"
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-xs font-semibold">
                Evolução mensal · histórico e registros futuros
              </h2>
              <p className="text-[10px] text-muted-foreground">
                Linha contínua: meses fechados · futuro: registros + complemento variável essencial,
                sujeito à cobertura do planejamento
              </p>
              {currentPlanningAlerts.length > 0 && currentPlanningAudit && (
                <button
                  type="button"
                  className="mt-1 rounded border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-200"
                  onClick={() => {
                    setAuditMonth(currentPlanningAudit.month);
                    setAuditOpen(true);
                  }}
                >
                  Atenção: {currentPlanningAlerts.length} possível(is) divergência(s) no
                  planejamento de {shortMonth(currentPlanningAudit.month)} · ver detalhes
                </button>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-[#315577] bg-[#152b43] px-2 py-1 text-[11px] text-[#a9d1ff] hover:bg-[#203b59]"
                onClick={() => {
                  setAuditMonth(period.start);
                  setAuditOpen(true);
                }}
              >
                Auditar gráfico
              </button>
              <button
                type="button"
                className="rounded-md border px-2 py-1 text-[11px] hover:bg-muted"
                onClick={() => {
                  setChartRange(null);
                  setShowAllMonths((v) => !v);
                }}
              >
                {showAllMonths ? "Últimos 12 meses" : "Todo o histórico"}
              </button>
              <div className="relative">
                <button
                  type="button"
                  className="rounded-md border border-[#315577] bg-[#152b43] px-2 py-1 text-[11px] text-[#a9d1ff] hover:bg-[#203b59]"
                  onClick={() => setChartRangeOpen((open) => !open)}
                >
                  {chartRange
                    ? `${shortMonth(chartRange.start)} a ${shortMonth(chartRange.end)}`
                    : "Selecionar datas"}
                </button>
                {chartRangeOpen && (
                  <div className="absolute right-0 top-full z-50 mt-2 w-[280px] rounded-lg border border-[#315577] bg-[#13253b] p-3 shadow-2xl">
                    <p className="mb-2 text-xs font-semibold">Período do gráfico e auditoria</p>
                    <label className="mb-2 block text-[11px]">
                      Mês inicial
                      <div
                        data-month-year-picker="essential-chart"
                        className="mt-1 grid grid-cols-2 gap-2"
                      >
                        <select
                          aria-label="Mês Mês inicial do gráfico"
                          value={draftChartStart.slice(5, 7)}
                          onChange={(event) =>
                            setDraftChartStart(
                              draftChartStart.slice(0, 4) + "-" + event.target.value,
                            )
                          }
                          className="min-w-0 w-full rounded border border-[#315577] bg-[#0b1728] px-2 py-2 text-xs text-foreground"
                        >
                          {[
                            "Jan",
                            "Fev",
                            "Mar",
                            "Abr",
                            "Mai",
                            "Jun",
                            "Jul",
                            "Ago",
                            "Set",
                            "Out",
                            "Nov",
                            "Dez",
                          ].map((name, index) => (
                            <option key={name} value={String(index + 1).padStart(2, "0")}>
                              {name}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="Ano Mês inicial do gráfico"
                          value={draftChartStart.slice(0, 4)}
                          onChange={(event) =>
                            setDraftChartStart(
                              event.target.value + "-" + draftChartStart.slice(5, 7),
                            )
                          }
                          className="min-w-0 w-full rounded border border-[#315577] bg-[#0b1728] px-2 py-2 text-xs text-foreground"
                        >
                          {chartAvailableYears.map((year) => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </select>
                      </div>
                    </label>
                    <label className="mb-2 block text-[11px]">
                      Mês final
                      <div
                        data-month-year-picker="essential-chart"
                        className="mt-1 grid grid-cols-2 gap-2"
                      >
                        <select
                          aria-label="Mês Mês final do gráfico"
                          value={draftChartEnd.slice(5, 7)}
                          onChange={(event) =>
                            setDraftChartEnd(draftChartEnd.slice(0, 4) + "-" + event.target.value)
                          }
                          className="min-w-0 w-full rounded border border-[#315577] bg-[#0b1728] px-2 py-2 text-xs text-foreground"
                        >
                          {[
                            "Jan",
                            "Fev",
                            "Mar",
                            "Abr",
                            "Mai",
                            "Jun",
                            "Jul",
                            "Ago",
                            "Set",
                            "Out",
                            "Nov",
                            "Dez",
                          ].map((name, index) => (
                            <option key={name} value={String(index + 1).padStart(2, "0")}>
                              {name}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="Ano Mês final do gráfico"
                          value={draftChartEnd.slice(0, 4)}
                          onChange={(event) =>
                            setDraftChartEnd(event.target.value + "-" + draftChartEnd.slice(5, 7))
                          }
                          className="min-w-0 w-full rounded border border-[#315577] bg-[#0b1728] px-2 py-2 text-xs text-foreground"
                        >
                          {chartAvailableYears.map((year) => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </select>
                      </div>
                    </label>
                    <p className="mb-2 text-[10px] text-muted-foreground">
                      Até 60 meses; os meses sem dados aparecem sem percentual.
                    </p>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setChartRange(null);
                          setChartRangeOpen(false);
                        }}
                        className="rounded border px-2 py-1 text-[11px]"
                      >
                        Padrão
                      </button>
                      <button
                        type="button"
                        disabled={
                          !/^\d{4}-(0[1-9]|1[0-2])$/.test(draftChartStart) ||
                          !/^\d{4}-(0[1-9]|1[0-2])$/.test(draftChartEnd) ||
                          draftChartStart > draftChartEnd ||
                          (Number(draftChartEnd.slice(0, 4)) -
                            Number(draftChartStart.slice(0, 4))) *
                            12 +
                            Number(draftChartEnd.slice(5, 7)) -
                            Number(draftChartStart.slice(5, 7)) >
                            59
                        }
                        onClick={() => {
                          setChartRange({ start: draftChartStart, end: draftChartEnd });
                          setChartRangeOpen(false);
                        }}
                        className="rounded bg-[#244d74] px-2 py-1 text-[11px] text-white disabled:opacity-40"
                      >
                        Aplicar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="essential-detail-chart-plot h-[98px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 5, right: 8, bottom: 0, left: -30 }}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} opacity={0.25} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(n: number) => `${n}%`} />
                <Tooltip
                  formatter={(value, name) => [
                    value == null ? "—" : `${Number(value).toFixed(2)}%`,
                    name ?? "",
                  ]}
                  labelFormatter={(_, items) =>
                    items?.[0]?.payload?.month ? longMonth(String(items[0].payload.month)) : ""
                  }
                />
                <Line
                  dataKey="meta"
                  name="Meta"
                  stroke="var(--color-chart-3)"
                  strokeDasharray="3 5"
                  dot={false}
                  strokeWidth={1.2}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="historico"
                  name="Histórico"
                  stroke="var(--color-chart-1)"
                  strokeWidth={2}
                  connectNulls={false}
                  dot={{ r: 2 }}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="cadastrados"
                  name="Futuro: registros + planejamento variável"
                  stroke="var(--color-chart-2)"
                  strokeDasharray="4 4"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section
          className="essential-detail-panels grid min-h-0 flex-1 grid-cols-[minmax(0,1.42fr)_minmax(0,0.98fr)] gap-2.5"
          aria-label="Matriz e marcos trimestrais"
        >
          <article
            className="flex min-h-0 min-w-0 flex-col rounded-xl border border-[#263955] bg-[#101d32] p-3.5"
            aria-label="Matriz de categorias raiz e vinculadas"
          >
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">Matriz de categorias e subcategorias</h2>
                <p className="text-[10px] text-muted-foreground">
                  Todos os grupos na mesma tabela, sem expandir ou navegar · {groups.length} raízes
                  · {metric.lines.length} lançamentos
                </p>
              </div>
              <span className="rounded border border-[#28517d] px-2 py-1 text-[10px] text-[#82b5fa]">
                Visão direta
              </span>
            </div>
            <div className="essential-detail-matrix-header grid shrink-0 grid-cols-[minmax(110px,1.05fr)_minmax(88px,0.65fr)_minmax(100px,0.7fr)_minmax(130px,1.8fr)_minmax(95px,0.8fr)] items-center gap-2 border-b border-[#2b3d58] px-1.5 pb-2 text-[9px] font-semibold uppercase tracking-wide text-[#8da5c5]">
              <span>Categoria raiz</span>
              <span className="min-w-0 text-right leading-tight">Participação</span>
              <span className="min-w-0 text-right leading-tight">Lançamentos</span>
              <span className="min-w-0 leading-tight">Vinculadas identificadas</span>
              <span className="text-right">Valor</span>
            </div>
            <div
              className="grid min-h-0 flex-1"
              style={{ gridTemplateRows: `repeat(${Math.max(groups.length, 1)}, minmax(0, 1fr))` }}
            >
              {groups.map((group, i) => {
                const share = essentials > 0 ? (group.amount / essentials) * 100 : 0;
                const color = rootColors[i % rootColors.length];
                return (
                  <div
                    key={group.id}
                    className="essential-detail-matrix-row grid min-h-0 grid-cols-[minmax(110px,1.05fr)_minmax(88px,0.65fr)_minmax(100px,0.7fr)_minmax(130px,1.8fr)_minmax(95px,0.8fr)] items-center gap-2 border-b border-[#263955] px-1.5 py-1 last:border-b-0"
                  >
                    <div
                      className="min-w-0 truncate text-[11px] font-bold"
                      style={{ color }}
                      title={group.name}
                    >
                      {group.name}
                    </div>
                    <span className="text-right text-[10px] tabular-nums text-[#a9bdd8]">
                      {share.toFixed(1).replace(".", ",")}%
                    </span>
                    <span className="text-right text-[10px] tabular-nums text-[#a9bdd8]">
                      {group.lines.length}
                    </span>
                    <div
                      className="min-w-0 truncate whitespace-nowrap text-[10px] text-[#c2d0e6]"
                      title={group.children.map((c) => `${c.name}: ${brl(c.amount)}`).join(" · ")}
                    >
                      {group.children.map((child, j) => (
                        <span key={child.id}>
                          {j > 0 ? " · " : ""}
                          {child.name}
                        </span>
                      ))}
                    </div>
                    <strong className="whitespace-nowrap text-right text-[11px] tabular-nums">
                      {brl(group.amount)}
                    </strong>
                  </div>
                );
              })}
              {!groups.length && (
                <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  Não há categorias essenciais identificadas para o mês fechado.
                </div>
              )}
            </div>
            <div className="mt-1 flex shrink-0 items-center justify-between gap-2 border-t border-[#2b3d58] pt-2 text-[10px] text-muted-foreground">
              <span>
                Soma auditada: <strong className="text-foreground">{brl(matrixSum)}</strong>
              </span>
              <span
                className={Math.abs(difference) > 0.01 ? "text-destructive" : "text-emerald-400"}
              >
                {Math.abs(difference) > 0.01
                  ? `Divergência de ${brl(difference)}`
                  : "Conciliado com o numerador"}
              </span>
            </div>
          </article>
          <article
            className="flex min-h-0 min-w-0 flex-col rounded-xl border border-[#263955] bg-[#101d32] p-3.5"
            aria-label="Quando as despesas podem diminuir"
          >
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <TrendingDown size={15} className="text-emerald-400" />
                  <h2 className="text-sm font-semibold">Quando as despesas podem diminuir</h2>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Quatro marcos automáticos, de três em três meses · eventos no intervalo
                </p>
              </div>
              <span className="rounded border border-[#28517d] px-2 py-1 text-[10px] text-[#82b5fa]">
                Atualização automática
              </span>
            </div>
            <div
              ref={milestoneGridRef}
              className="essential-detail-milestones grid min-h-0 flex-1 gap-2"
              style={{
                // Distribui a area proporcionalmente as linhas exibidas em cada marco.
                // Todos aparecem se couberem; so reduz a lista quando faltar altura.
                gridTemplateRows: orderedMilestones
                  .map((m, i) => {
                    const visibleRows = milestoneRows[i] ?? 0;
                    const hasMore = visibleRows * 2 < m.events.length;
                    const weight = 66 + visibleRows * 16 + (hasMore ? 19 : 0);
                    return `minmax(0, ${Math.max(1, weight)}fr)`;
                  })
                  .join(" "),
              }}
            >
              {orderedMilestones.map((milestone, i) => {
                const reduction = milestone.delta < -0.005;
                const increase = milestone.delta > 0.005;
                return (
                  <div
                    key={milestone.month}
                    className={`essential-detail-milestone relative flex min-h-0 flex-col justify-start rounded-lg border px-2.5 py-1.5 ${increase ? "border-amber-700/60 bg-[#2b2116]" : reduction ? "border-emerald-700/70 bg-[#0b2530]" : "border-[#29415f] bg-[#0a182b]"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <strong className="text-[11px] font-bold text-[#76b5ff]">
                          {longMonth(`${milestone.month}-01`)}
                        </strong>
                        <span className="text-[10px] text-muted-foreground">
                          {i === 0 ? "Primeiro marco" : `Marco trimestral ${i + 1}`}
                        </span>
                      </div>
                      <span
                        className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${increase ? "border-amber-700/70 text-amber-300" : reduction ? "border-emerald-700/70 text-emerald-300" : "border-[#314a68] text-[#9bb0cf]"}`}
                      >
                        {recurrencesLoading
                          ? "Carregando"
                          : recurrencesError
                            ? "Sem dados"
                            : increase
                              ? "Aumento previsto"
                              : reduction
                                ? "Redução prevista"
                                : milestone.events.length
                                  ? "Mudanças compensadas"
                                  : "Sem alteração"}
                      </span>
                    </div>
                    <div className="mt-0.5 min-h-0 text-[10px] leading-tight">
                      {recurrencesLoading ? (
                        <span className="text-muted-foreground">
                          Consultando recorrências cadastradas…
                        </span>
                      ) : recurrencesError ? (
                        <span className="text-muted-foreground">
                          Não foi possível consultar as recorrências. Projeção indisponível.
                        </span>
                      ) : milestone.events.length ? (
                        <div className="grid grid-cols-2 gap-x-2 gap-y-0">
                          {milestone.events
                            .slice(0, (milestoneRows[i] ?? 0) * 2)
                            .map((event, eventIndex) => {
                              const isIncrease = event.delta > 0;
                              return (
                                <div
                                  key={`${event.effectiveMonth}-${event.description}-${eventIndex}`}
                                  style={{
                                    gridColumn:
                                      Math.floor(eventIndex / Math.max(1, milestoneRows[i] ?? 1)) +
                                      1,
                                    gridRow: (eventIndex % Math.max(1, milestoneRows[i] ?? 1)) + 1,
                                  }}
                                  className="flex min-w-0 items-baseline gap-1"
                                  title={`${event.description} · ${shortMonth(`${event.effectiveMonth}-01`)} · ${isIncrease ? "aumento" : "redução"} de ${brl(Math.abs(event.delta))}`}
                                >
                                  <span
                                    className={`shrink-0 font-bold ${isIncrease ? "text-amber-300" : "text-emerald-300"}`}
                                    aria-label={isIncrease ? "Aumento" : "Redução"}
                                  >
                                    {isIncrease ? "↑" : "↓"}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                                    {event.description}
                                  </span>
                                  <span
                                    className={`shrink-0 font-semibold ${isIncrease ? "text-amber-300" : "text-emerald-300"}`}
                                  >
                                    {brl(Math.abs(event.delta))}
                                  </span>
                                  <span className="shrink-0 text-[9px] text-muted-foreground">
                                    {shortMonth(`${event.effectiveMonth}-01`)}
                                  </span>
                                </div>
                              );
                            })}
                          {milestone.events.length > (milestoneRows[i] ?? 0) * 2 && (
                            <div className="relative col-span-2 mt-1">
                              <button
                                type="button"
                                aria-expanded={expandedMilestone === i}
                                onClick={() =>
                                  setExpandedMilestone(expandedMilestone === i ? null : i)
                                }
                                className="rounded border border-[#315577] bg-[#152b43] px-2 py-0.5 text-[10px] font-semibold text-[#82b5fa] hover:bg-[#203b59] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
                              >
                                +{milestone.events.length - (milestoneRows[i] ?? 0) * 2} lançamentos
                              </button>
                              {expandedMilestone === i && (
                                <div
                                  role="dialog"
                                  aria-label={`Mais lançamentos do marco ${longMonth(`${milestone.month}-01`)}`}
                                  className="absolute bottom-full left-0 z-50 mb-1 w-[min(490px,90vw)] rounded-lg border border-[#41618b] bg-[#101d32] p-3 text-[11px] shadow-2xl"
                                >
                                  <div className="mb-2 flex items-center justify-between gap-2">
                                    <strong>
                                      Outros {milestone.events.length - (milestoneRows[i] ?? 0) * 2}{" "}
                                      lançamentos
                                    </strong>
                                    <button
                                      type="button"
                                      onClick={() => setExpandedMilestone(null)}
                                      aria-label="Fechar lançamentos adicionais"
                                      className="rounded border border-[#315577] px-2 py-0.5 text-[10px] hover:bg-[#203b59]"
                                    >
                                      Fechar
                                    </button>
                                  </div>
                                  <div className="grid max-h-60 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto">
                                    {milestone.events
                                      .slice((milestoneRows[i] ?? 0) * 2)
                                      .map((event, extraIndex) => {
                                        const isIncrease = event.delta > 0;
                                        return (
                                          <div
                                            key={`${event.effectiveMonth}-${event.description}-extra-${extraIndex}`}
                                            className="flex min-w-0 items-baseline gap-1"
                                            title={`${event.description} · ${shortMonth(`${event.effectiveMonth}-01`)} · ${brl(Math.abs(event.delta))}`}
                                          >
                                            <span
                                              className={
                                                isIncrease ? "text-amber-300" : "text-emerald-300"
                                              }
                                            >
                                              {isIncrease ? "↑" : "↓"}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate">
                                              {event.description}
                                            </span>
                                            <span
                                              className={`shrink-0 font-semibold ${isIncrease ? "text-amber-300" : "text-emerald-300"}`}
                                            >
                                              {brl(Math.abs(event.delta))}
                                            </span>
                                            <span className="shrink-0 text-[9px] text-muted-foreground">
                                              {shortMonth(`${event.effectiveMonth}-01`)}
                                            </span>
                                          </div>
                                        );
                                      })}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">
                          Nenhuma variação cadastrada neste intervalo
                        </span>
                      )}
                    </div>
                    {!recurrencesLoading && !recurrencesError && (
                      <div className="mt-auto pt-0.5 text-[9px] leading-none text-muted-foreground">
                        Variação no intervalo:{" "}
                        <span
                          className={
                            increase ? "text-amber-300" : reduction ? "text-emerald-300" : ""
                          }
                        >
                          {milestone.delta > 0 ? "+" : ""}
                          {brl(milestone.delta)}
                        </span>
                        {" · "}Efeito acumulado:{" "}
                        <span
                          className={
                            milestone.accumulatedDelta > 0
                              ? "text-amber-300"
                              : milestone.accumulatedDelta < 0
                                ? "text-emerald-300"
                                : ""
                          }
                        >
                          {milestone.accumulatedDelta > 0 ? "+" : ""}
                          {brl(milestone.accumulatedDelta)}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}

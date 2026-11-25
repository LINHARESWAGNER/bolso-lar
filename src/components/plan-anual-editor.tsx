import { useEffect, useMemo, useState } from "react";
import { JourneyHeader } from "@/components/journey-header";
import { RecurrenceDialog } from "@/routes/_authenticated/recorrencias";
import type { Database } from "@/integrations/supabase/types";
import { CurrencyInput } from "@/components/currency-input";
import { Button } from "@/components/ui/button";
import { Copy, Lightbulb, LockKeyhole, Save, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  useBudgets,
  useBudgetPlanVersions,
  useInvalidateFinance,
  useCategories,
  useDeletedTransactions,
  useInvoices,
  useProfile,
  useRecurrences,
  useTransactions,
} from "@/lib/queries";
import { variableBudgetSuggestions } from "@/lib/planning";
import { isThirdPartyCategory, isThirdPartyTransaction } from "@/lib/derive";
import { brl } from "@/lib/format";

const MONTHS = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

type Section = "receita" | "fixo";
type RecurrenceRow =
  Database["public"]["Tables"]["recurring_transactions"]["Row"];
type PlanningDetail = {
  id: string;
  month: number;
  date: string;
  value: number;
  status: string;
  source: "registro" | "estimativa";
};

type PlanningItem = {
  id: string;
  description: string;
  category: string;
  value: number;
  frequency: string;
  active: boolean;
  monthly: { value: number; state: "none" | "planned" | "paid" }[];
  details: PlanningDetail[];
};

const frequencyLabel: Record<string, string> = {
  semanal: "Semanal",
  mensal: "Mensal",
  bimestral: "Bimestral",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
};

const sum = (numbers: number[]) =>
  numbers.reduce((total, value) => total + value, 0);

const round = (n: number) => Math.round(n * 100) / 100;

function expectedOccurrence(
  start: string,
  end: string | null,
  frequency: string,
  year: number,
  month: number,
) {
  const first = start.slice(0, 7);
  const current = `${year}-${String(month + 1).padStart(2, "0")}`;

  if (current < first || (end && current > end.slice(0, 7))) {
    return false;
  }

  if (frequency === "semanal") return true;

  const startYear = Number(start.slice(0, 4));
  const startMonth = Number(start.slice(5, 7));
  const difference = (year - startYear) * 12 + (month + 1 - startMonth);

  const interval: Record<string, number> = {
    mensal: 1,
    bimestral: 2,
    trimestral: 3,
    semestral: 6,
    anual: 12,
  };

  return difference >= 0 && difference % (interval[frequency] ?? 1) === 0;
}

export function PlanAnualEditor({ focus }: { focus?: "variavel" } = {}) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [open, setOpen] = useState({
    receita: true,
    fixo: true,
    variavel: true,
  });
  const [variableDraft, setVariableDraft] = useState<Record<string, string>>({});
  const [draftChanged, setDraftChanged] = useState(false);
  const [variableMonth, setVariableMonth] = useState(new Date().getMonth() + 1);
  const [savingVariable, setSavingVariable] = useState(false);
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  const [managing, setManaging] = useState<Section | null>(null);
  const [creatingRecurrence, setCreatingRecurrence] = useState<Section | null>(null);
  const [editingRecurrence, setEditingRecurrence] = useState<RecurrenceRow | null>(null);

  const profile = useProfile();
  const recurrences = useRecurrences();
  const transactions = useTransactions();
  const deletedTransactions = useDeletedTransactions();
  const invoices = useInvoices();
  const categories = useCategories();
  const budgets = useBudgets();
  const versions = useBudgetPlanVersions();
  const invalidateFinance = useInvalidateFinance();

  const familyId = profile.data?.family_id;

  const familyCategories = useMemo(
    () => (categories.data ?? []).filter(c => c.family_id === familyId),
    [categories.data, familyId],
  );

  const allTransactions = useMemo(
    () => (transactions.data ?? []).filter(t =>
      t.family_id === familyId && t.status !== "cancelado"
    ),
    [transactions.data, familyId],
  );

  const familyTransactions = useMemo(
    () => allTransactions.filter(t =>
      !isThirdPartyTransaction(familyCategories, t)
    ),
    [allTransactions, familyCategories],
  );

  const familyRecurrences = useMemo(
    () => (recurrences.data ?? []).filter(r =>
      r.family_id === familyId
    ),
    [recurrences.data, familyId],
  );
  const names = useMemo(
    () => new Map(familyCategories.map(c => [c.id, c.name])),
    [familyCategories],
  );

  // ETAPA 4G-A
  // Historico variavel pelo mes do pagamento/vencimento.
  // Somente leitura: nao altera transacoes ou faturas.
  const variableHistoryTransactions = useMemo(() => {
    const invoiceLookup = new Map(
      (invoices.data ?? [])
        .filter(invoice => invoice.family_id === familyId)
        .map(invoice => [invoice.id, invoice] as const)
    );

    return familyTransactions
      .filter(transaction =>
        transaction.type === "despesa" &&
        transaction.expense_nature === "variavel" &&
        transaction.status !== "cancelado"
      )
      .flatMap(transaction => {
        let referenceDate: string;
        let effectiveStatus = transaction.status;

        if (transaction.credit_card_id) {
          // Nao atribuir uma compra sem fatura a um
          // mes de pagamento que nao podemos confirmar.
          if (!transaction.invoice_id) return [];

          const invoice = invoiceLookup.get(transaction.invoice_id);

          if (!invoice) return [];

          const invoicePaid =
            invoice.status === "paga" &&
            Boolean(invoice.paid_at);

          referenceDate = (
            invoicePaid
              ? invoice.paid_at!
              : invoice.due_date
          ).slice(0, 10);

          effectiveStatus = invoicePaid
            ? "pago"
            : "previsto";
        } else {
          // Despesa fora do cartao:
          // pagamento efetivo ou vencimento previsto.
          referenceDate = (
            transaction.status === "pago"
              ? transaction.paid_date ??
                transaction.due_date ??
                transaction.competence_date
              : transaction.due_date ??
                transaction.competence_date
          ).slice(0, 10);
        }

        return [{
          ...transaction,
          competence_date: referenceDate,
          status: effectiveStatus,
        }];
      });
  }, [familyTransactions, invoices.data, familyId]);

  // Ultimos tres meses fechados, independentemente
  // do ano selecionado para editar o planejamento.
  const latestVariableHistory = useMemo(() => {
    const today = new Date();

    return variableBudgetSuggestions(
      variableHistoryTransactions,
      familyCategories,
      today.getFullYear(),
      today.getMonth() + 1,
    );
  }, [variableHistoryTransactions, familyCategories]);
  const variableRoots = useMemo(
    () => familyCategories
      .filter(c => c.kind === "despesa" && !c.parent_id)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [familyCategories],
  );

  const rootOf = (id: string | null): string | null => {
    if (!id) return null;
    let current = familyCategories.find(c => c.id === id);
    const seen = new Set<string>();
    while (current?.parent_id && !seen.has(current.id)) {
      seen.add(current.id);
      current = familyCategories.find(c => c.id === current?.parent_id);
    }
    return current?.id ?? id;
  };

  const monthlySaved = useMemo(() => {
    const result: Record<string, number> = {};
    for (const budget of budgets.data ?? []) {
      if (budget.family_id !== familyId ||
          Number(budget.reference_month.slice(0, 4)) !== year) continue;

      const month = Number(budget.reference_month.slice(5, 7)) - 1;
      for (const item of budget.budget_items) {
        const root = rootOf(item.category_id);
        if (!root) continue;
        const key = `${root}:${month}`;
        result[key] = round((result[key] ?? 0) + Number(item.amount));
      }
    }
    return result;
  }, [budgets.data, familyId, year, familyCategories]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(monthlySaved)) {
      next[key] = String(value);
    }
    setVariableDraft(previous => draftChanged ? { ...next, ...previous } : next);
    if (!draftChanged) setDraftChanged(false);
  }, [monthlySaved]);

  const variableValue = (id: string, month: number) => {
    const raw = variableDraft[`${id}:${month}`];
    const numeric = Number((raw ?? "").replace(",", "."));
    return raw !== undefined && Number.isFinite(numeric) && numeric >= 0
      ? numeric
      : 0;
  };

  const setVariableValue = (id: string, month: number, raw: string) => {
    if (raw && !/^\d*([,.]\d{0,2})?$/.test(raw)) return;
    setVariableDraft(previous => ({
      ...previous,
      [`${id}:${month}`]: raw,
    }));
    setDraftChanged(true);
  };

  const replicate = (id: string, value: number) => {
    setVariableDraft(previous => {
      const next = { ...previous };
      MONTHS.forEach((_, month) => {
        next[`${id}:${month}`] = String(round(value));
      });
      return next;
    });
    setDraftChanged(true);
  };

  // Modelo original: um mes de cada vez, com historico e subcategorias.
  const selectedVariableKey = `${year}-${String(variableMonth).padStart(2, "0")}`;
  const variableSuggestion = useMemo(
    () => variableBudgetSuggestions(
      variableHistoryTransactions, familyCategories, year, variableMonth,
    ),
    [variableHistoryTransactions, familyCategories, year, variableMonth],
  );
  const approvedVariableMonth = (versions.data ?? []).some(v =>
    v.family_id === familyId &&
    v.reference_month.startsWith(selectedVariableKey)
  );
  const savedVariableBudget = (budgets.data ?? []).find(b =>
    b.family_id === familyId &&
    b.reference_month.startsWith(selectedVariableKey)
  );
  const legacyVariableMonth = Boolean(savedVariableBudget && !approvedVariableMonth);
  const lockedVariableMonth = approvedVariableMonth || legacyVariableMonth ||
    versions.isLoading || savingVariable;

  const variableInstallmentsByRoot = useMemo(() => {
    const totals = new Map<string, number>();
    const categoryLookup = new Map(familyCategories.map(c => [c.id, c]));
    for (const tx of variableHistoryTransactions) {
      if (
        !tx.competence_date.startsWith(selectedVariableKey) ||
        !tx.installment_group_id ||
        !tx.category_id
      ) continue;
      let current = categoryLookup.get(tx.category_id);
      const seen = new Set<string>();
      while (current?.parent_id && !seen.has(current.id)) {
        seen.add(current.id);
        current = categoryLookup.get(current.parent_id);
      }
      const rootId = current?.id ?? tx.category_id;
      totals.set(rootId, round((totals.get(rootId) ?? 0) + Number(tx.amount)));
    }
    return totals;
  }, [variableHistoryTransactions, familyCategories, selectedVariableKey]);

  const copyPreviousVariable = () => {
    if (lockedVariableMonth) return;
    const previous = new Date(year, variableMonth - 2, 1);
    const previousKey = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`;
    const source = (budgets.data ?? []).find(b =>
      b.family_id === familyId && b.reference_month.startsWith(previousKey)
    );
    if (!source) {
      toast.error("O mes anterior nao possui orcamento variavel salvo.");
      return;
    }
    const values = new Map<string, number>();
    for (const item of source.budget_items) {
      const id = rootOf(item.category_id);
      if (id) values.set(id, round((values.get(id) ?? 0) + Number(item.amount)));
    }
    for (const root of variableRoots) {
      setVariableValue(root.id, variableMonth - 1,
        String(values.get(root.id) ?? 0));
    }
    toast.info("Valores copiados para edicao. Salve o mes para confirmar.");
  };

  const applyVariableSuggestions = () => {
    if (lockedVariableMonth || !variableSuggestion.hasEnoughHistory) return;
    for (const root of variableRoots) {
      setVariableValue(root.id, variableMonth - 1,
        String(variableSuggestion.suggestions.get(root.id) ?? 0));
    }
  };

  const applyVariableTo12 = () => {
    if (lockedVariableMonth) return;
    const sourceIndex = variableMonth - 1;
    const blocked = new Set<number>();
    for (let month = 0; month < 12; month++) {
      const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
      const approved = (versions.data ?? []).some(v =>
        v.family_id === familyId && v.reference_month.startsWith(monthKey)
      );
      const legacy = (budgets.data ?? []).some(b =>
        b.family_id === familyId && b.reference_month.startsWith(monthKey)
      );
      if (approved || legacy) blocked.add(month);
    }
    const editableMonths = MONTHS.map((_, i) => i).filter(i => !blocked.has(i));
    if (!editableMonths.length) {
      toast.error("Todos os meses ja possuem orcamentos salvos ou aprovados.");
      return;
    }
    const sourceValues = new Map(variableRoots.map(root =>
      [root.id, variableValue(root.id, sourceIndex)] as const
    ));
    if (!window.confirm(
      `Aplicar os valores de ${MONTHS[sourceIndex]} aos ${editableMonths.length} meses editaveis de ${year}? ` +
      "Esta acao prepara os campos, mas nao salva nem aprova os meses."
    )) return;
    setVariableDraft(previous => {
      const next = { ...previous };
      for (const i of editableMonths) {
        for (const [id, value] of sourceValues) next[`${id}:${i}`] = String(round(value));
      }
      return next;
    });
    setDraftChanged(true);
    toast.info(`Aplicado a ${editableMonths.length} meses para edicao. Meses ja salvos foram preservados.`);
  };

  const saveVariableMonth = async () => {
    if (!familyId || lockedVariableMonth) return;
    const monthIndex = variableMonth - 1;
    const items = variableRoots
      .map(root => ({ category_id: root.id, amount: variableValue(root.id, monthIndex) }))
      .filter(item => item.amount > 0);
    if (!items.length) {
      toast.error("Informe ao menos um limite variavel antes de salvar.");
      return;
    }
    if (!window.confirm(
      `Salvar e aprovar o orcamento de ${MONTHS[monthIndex]}/${year}? ` +
      "Depois, revisoes precisam seguir o fluxo Action."
    )) return;
    setSavingVariable(true);
    try {
      const total = sum(items.map(item => item.amount));
      const { error } = await supabase.rpc("save_budget_plan_version", {
        p_reference_month: `${selectedVariableKey}-01`,
        p_items: items,
        p_context: {
          income: incomeMonths[monthIndex] ?? 0,
          fixed: fixedMonths[monthIndex] ?? 0,
          variable: total,
        },
        p_expected_version: 0,
        p_change_kind: null,
        p_justification: null,
      });
      if (error) throw error;
      await Promise.all([versions.refetch(), budgets.refetch()]);
      invalidateFinance();
      toast.success("Orcamento mensal salvo e aprovado.");
    } catch (error) {
      toast.error("Falha ao aprovar o orcamento", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSavingVariable(false);
    }
  };

  // Para compras em cartao, o mes do planejamento e
  // o do pagamento efetivo ou vencimento da fatura.
  const invoiceById = new Map(
    (invoices.data ?? [])
      .filter(invoice => invoice.family_id === familyId)
      .map(invoice => [invoice.id, invoice] as const)
  );

  const planningDate = (transaction: {
    competence_date: string;
    invoice_id: string | null;
    credit_card_id: string | null;
  }) => {
    if (transaction.credit_card_id && transaction.invoice_id) {
      const invoice = invoiceById.get(transaction.invoice_id);

      if (invoice) {
        if (invoice.status === "paga" && invoice.paid_at) {
          return invoice.paid_at.slice(0, 10);
        }

        return invoice.due_date.slice(0, 10);
      }
    }

    return transaction.competence_date;
  };

  const planningStatus = (transaction: {
    status: string;
    invoice_id: string | null;
    credit_card_id: string | null;
  }) => {
    if (transaction.credit_card_id && transaction.invoice_id) {
      const invoice = invoiceById.get(transaction.invoice_id);

      if (invoice) {
        return invoice.status === "paga"
          ? "pago"
          : "previsto";
      }
    }

    return transaction.status;
  };
  const itemsFor = (
    kind: Section,
    thirdParty: boolean,
  ): PlanningItem[] => {
    const validType = (type: string, nature: string | null) =>
      kind === "receita"
        ? type === "receita"
        : type === "despesa" && nature === "fixo";

    const normalize = (text: string) =>
      text.normalize("NFKC").trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("pt-BR");

    // Remove apenas indicadores de parcela no fim da descricao.
    // Exemplos: (1/10), (2/10), [4/4] ou 3/12.
    // Os dados originais dos lancamentos nao sao alterados.
    const cleanDescription = (description: string) =>
      description
        .replace(/\s*(?:\(\s*\d+\s*\/\s*\d+\s*\)|\[\s*\d+\s*\/\s*\d+\s*\]|\d+\s*\/\s*\d+)\s*$/, "")
        .trim() || description.trim();

    const groupKey = (description: string, categoryId: string | null) =>
      `${categoryId ?? "sem-categoria"}|${normalize(cleanDescription(description))}`;

    const groups = new Map<string, {
      id: string;
      description: string;
      category: string;
      frequencies: Set<string>;
      details: PlanningDetail[];
    }>();

    const getGroup = (
      description: string,
      categoryId: string | null,
    ) => {
      const key = groupKey(description, categoryId);
      let group = groups.get(key);

      if (!group) {
        group = {
          id: key,
          description: cleanDescription(description),
          category: names.get(categoryId ?? "") ?? "Sem categoria",
          frequencies: new Set<string>(),
          details: [],
        };
        groups.set(key, group);
      }

      return group;
    };

    const relevantRecurrences = familyRecurrences.filter(r =>
      validType(r.type, r.expense_nature) &&
      isThirdPartyCategory(familyCategories, r.category_id) === thirdParty
    );

    const selectedTransactions = allTransactions.filter(t =>
      validType(t.type, t.expense_nature) &&
      isThirdPartyTransaction(familyCategories, t) === thirdParty &&
      planningDate(t).startsWith(`${year}-`)
    );

    for (const t of selectedTransactions) {
      const date = planningDate(t);
      const month = Number(date.slice(5, 7)) - 1;

      if (month < 0 || month > 11) continue;

      const group = getGroup(t.description, t.category_id);

      group.details.push({
        id: t.id,
        month,
        date,
        value: Number(t.amount),
        status: planningStatus(t),
        source: "registro",
      });
    }

    // useDeletedTransactions ja retorna somente registros excluidos.
    // Nao verificar deleted_at: esse campo nao consta
    // nos tipos TypeScript atualmente gerados.
    const deleted = (deletedTransactions.data ?? []).filter(t =>
      t.family_id === familyId &&
      validType(t.type, t.expense_nature) &&
      planningDate(t).startsWith(`${year}-`)
    );

    const suppressedMonths = new Set<string>();

    for (const t of deleted) {
      const month = planningDate(t).slice(0, 7);
      const identity = groupKey(t.description, t.category_id);

      suppressedMonths.add(`grupo:${identity}:${month}`);

      if (t.recurring_id) {
        suppressedMonths.add(`origem:${t.recurring_id}:${month}`);
      }
    }

    for (const r of relevantRecurrences) {
      // Recorrencia de cartao sem fatura nao possui
      // data de pagamento confiavel para projetar.
      // As parcelas ja registradas seguem aparecendo.
      if (r.credit_card_id) continue;

      const group = getGroup(r.description, r.category_id);

      group.frequencies.add(
        frequencyLabel[r.frequency] ?? r.frequency
      );

      for (let month = 0; month < 12; month++) {
        const monthKey =
          `${year}-${String(month + 1).padStart(2, "0")}`;

        if (
          !r.is_active ||
          !expectedOccurrence(
            r.start_date,
            r.end_date,
            r.frequency,
            year,
            month,
          )
        ) continue;

        const hasRegistered = group.details.some(d =>
          d.month === month && d.source === "registro"
        );

        const excluded =
          suppressedMonths.has(`origem:${r.id}:${monthKey}`) ||
          suppressedMonths.has(
            `grupo:${groupKey(r.description, r.category_id)}:${monthKey}`
          );

        if (hasRegistered || excluded) continue;

        group.details.push({
          id: `estimativa:${r.id}:${monthKey}`,
          month,
          date: `${monthKey}-01`,
          value: Number(r.amount),
          status: "estimativa",
          source: "estimativa",
        });
      }
    }

    const result: PlanningItem[] = [];

    for (const group of groups.values()) {
      if (!group.details.length) continue;

      group.details.sort((a, b) =>
        a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
      );

      const monthly = MONTHS.map((_, month) => {
        const entries = group.details.filter(d => d.month === month);

        if (!entries.length) {
          return { value: 0, state: "none" as const };
        }

        return {
          value: round(sum(entries.map(d => d.value))),
          state: entries.every(d =>
            d.source === "registro" && d.status === "pago"
          )
            ? "paid" as const
            : "planned" as const,
        };
      });

      result.push({
        id: group.id,
        description: group.description,
        category: group.category,
        value: round(sum(group.details.map(d => d.value))),
        frequency: group.frequencies.size
          ? [...group.frequencies].join(", ")
          : "Lançamentos individuais",
        active: true,
        monthly,
        details: group.details,
      });
    }

    return result.sort((a, b) =>
      a.description.localeCompare(b.description, "pt-BR") ||
      a.category.localeCompare(b.category, "pt-BR")
    );
  };

  const incomeItems = itemsFor("receita", false);
  const incomeThirdItems = itemsFor("receita", true);
  const fixedItems = itemsFor("fixo", false);
  const fixedThirdItems = itemsFor("fixo", true);

  const totalsByMonth = (items: PlanningItem[]) =>
    MONTHS.map((_, month) =>
      sum(items.map(item => item.monthly[month]?.value ?? 0))
    );

  const incomeMonths = totalsByMonth(incomeItems);
  const fixedMonths = totalsByMonth(fixedItems);
  const thirdIncomeMonths = totalsByMonth(incomeThirdItems);
  const thirdFixedMonths = totalsByMonth(fixedThirdItems);

  const variableMonths = MONTHS.map((_, month) =>
    sum(variableRoots.map(root => variableValue(root.id, month)))
  );

  const incomeTotal = sum(incomeMonths);
  const fixedTotal = sum(fixedMonths);
  const variableTotal = sum(variableMonths);

  const thirdIncomeTotal = sum(thirdIncomeMonths);
  const thirdFixedTotal = sum(thirdFixedMonths);

  const thirdVariableTransactions = allTransactions.filter(t =>
    t.type === "despesa" &&
    t.expense_nature !== "fixo" &&
    isThirdPartyTransaction(familyCategories, t) &&
    t.competence_date.startsWith(`${year}-`) &&
    !t.invoice_id &&
    !t.credit_card_id
  );

  const thirdVariableTotal = sum(
    thirdVariableTransactions.map(t => Number(t.amount))
  );

  const resultTotal = incomeTotal - fixedTotal - variableTotal;
  const thirdResultTotal =
    thirdIncomeTotal - thirdFixedTotal - thirdVariableTotal;
  const pending = invoices.isLoading || deletedTransactions.isLoading || profile.isLoading || recurrences.isLoading ||
    transactions.isLoading || categories.isLoading || budgets.isLoading;

  const failed = invoices.isError || deletedTransactions.isError || profile.isError || recurrences.isError ||
    transactions.isError || categories.isError || budgets.isError;

  const sectionHeader = (
    key: keyof typeof open,
    title: string,
    subtitle: string,
    value: number,
    href?: string,
  ) => (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={() => setOpen(previous => ({
          ...previous, [key]: !previous[key],
        }))}
      >
        <span className="rounded-lg bg-muted px-3 py-2">
          {open[key] ? "▾" : "▸"}
        </span>
        <span>
          <strong className="block text-base">{title}</strong>
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        </span>
      </button>
      <div className="flex items-center gap-4">
        <strong className="text-lg tabular-nums">{brl(value)}</strong>
        {href && (
          <button
            type="button"
            onClick={() => {
              const section: Section =
                key === "receita" ? "receita" : "fixo";
              setManaging(previous =>
                previous === section ? null : section
              );
              setEditingRecurrence(null);
              setCreatingRecurrence(null);
            }}
            aria-expanded={managing === key}
            className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
          >
            {managing === key ? "Fechar gestão" : "Gerenciar"}
          </button>
        )}
      </div>
    </div>
  );

  const renderPlanningLines = (
    items: PlanningItem[],
    prefix: string,
  ) => (
    <>
      {items.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">
          Nenhum lançamento neste grupo para o ano selecionado.
        </p>
      ) : items.map(item => {
        const rowKey = `${prefix}:${item.id}`;
        const expanded = Boolean(expandedDetails[rowKey]);

        return (
          <div key={rowKey} className="border-b border-border/60 last:border-0">
            <div className="grid items-center gap-2 px-2 py-2 lg:grid-cols-[220px_150px_minmax(350px,1fr)_130px]">
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 text-left"
                onClick={() => setExpandedDetails(previous => ({
                  ...previous,
                  [rowKey]: !previous[rowKey],
                }))}
                aria-expanded={expanded}
                title="Consultar lançamentos individuais"
              >
                <span className="shrink-0 text-muted-foreground">
                  {expanded ? "▾" : "▸"}
                </span>
                <span className="min-w-0">
                  <span
                    className="block truncate text-sm font-semibold"
                    title={item.description}
                  >
                    {item.description}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {item.details.length} ocorrência(s)
                  </span>
                </span>
              </button>

              <div
                className="truncate text-xs text-muted-foreground"
                title={item.category}
              >
                {item.category}
              </div>

              <div className="grid grid-cols-12 gap-1">
                {MONTHS.map((month, index) => {
                  const entries = item.details.filter(d => d.month === index);
                  const estimated = entries.some(d => d.source === "estimativa");

                  return (
                    <div
                      key={month}
                      title={`${item.description} · ${month}/${year} · ${
                        entries.length
                          ? `${brl(item.monthly[index]?.value ?? 0)} · ${
                              estimated ? "Contém estimativa" : "Registrado"
                            }`
                          : "Sem lançamento"
                      }`}
                      className={`h-3 rounded-sm ${
                        item.monthly[index]?.state === "paid"
                          ? "bg-blue-500/70"
                          : estimated
                            ? "bg-amber-500/70"
                            : item.monthly[index]?.state === "planned"
                              ? "bg-green-600/65"
                              : "bg-muted"
                      }`}
                    />
                  );
                })}
              </div>

              <div className="text-right">
                <strong className="text-sm tabular-nums">
                  {brl(item.value)}
                </strong>
              </div>
            </div>

            {expanded && (
              <div className="mb-2 ml-5 mr-2 overflow-hidden rounded-md border border-border bg-muted/20">
                <div className="grid grid-cols-[90px_minmax(120px,1fr)_100px_120px] gap-2 border-b px-3 py-2 text-[11px] font-semibold text-muted-foreground">
                  <span>Pagamento / vencimento</span>
                  <span>Situação</span>
                  <span>Origem</span>
                  <span className="text-right">Valor</span>
                </div>

                {item.details.map(detail => (
                  <div
                    key={detail.id}
                    title={`Identificador: ${detail.id}`}
                    className="grid grid-cols-[90px_minmax(120px,1fr)_100px_120px] gap-2 border-b border-border/40 px-3 py-2 text-xs last:border-0"
                  >
                    <span>
                      {detail.date.slice(8, 10)}/
                      {detail.date.slice(5, 7)}/
                      {detail.date.slice(0, 4)}
                    </span>
                    <span>
                      {detail.source === "estimativa"
                        ? "Estimado, não registrado"
                        : detail.status === "pago"
                          ? "Pago / recebido"
                          : detail.status}
                    </span>
                    <span className="text-muted-foreground">
                      {detail.source === "estimativa"
                        ? "Projeção"
                        : "Lançamento"}
                    </span>
                    <span className="text-right tabular-nums">
                      {brl(detail.value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
  const recurrenceManager = (section: Section) => {
    const isIncome = section === "receita";

    const records = familyRecurrences
      .filter(record =>
        isIncome
          ? record.type === "receita"
          : record.type === "despesa" &&
            record.expense_nature === "fixo"
      )
      .sort((a, b) =>
        a.description.localeCompare(b.description, "pt-BR")
      );

    const dialogOpen =
      creatingRecurrence === section ||
      Boolean(editingRecurrence);

    return (
      <div className="border-t border-border bg-muted/10 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">
              {isIncome
                ? "Gerenciar receitas planejadas"
                : "Gerenciar despesas fixas"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Cadastre ou edite planejamentos diretamente nesta página.
              As regras e os vínculos existentes serão preservados.
            </p>
          </div>

          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={() => {
              setEditingRecurrence(null);
              setCreatingRecurrence(section);
            }}
          >
            + {isIncome ? "Nova receita" : "Nova despesa fixa"}
          </button>
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          {records.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Nenhum planejamento periódico cadastrado.
            </p>
          ) : (
            records.map(record => (
              <div
                key={record.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 p-3 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">
                      {record.description}
                    </strong>

                    <span className={`rounded px-2 py-0.5 text-[10px] ${
                      record.is_active
                        ? "bg-green-500/10 text-green-500"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {record.is_active ? "Ativo" : "Inativo"}
                    </span>

                    {isThirdPartyCategory(
                      familyCategories,
                      record.category_id
                    ) && (
                      <span className="rounded border px-2 py-0.5 text-[10px]">
                        Terceiros
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-xs text-muted-foreground">
                    {frequencyLabel[record.frequency] ?? record.frequency}
                    {" · "}
                    {record.start_date.slice(8, 10)}/
                    {record.start_date.slice(5, 7)}/
                    {record.start_date.slice(0, 4)}
                    {" até "}
                    {record.end_date
                      ? `${record.end_date.slice(8, 10)}/${record.end_date.slice(5, 7)}/${record.end_date.slice(0, 4)}`
                      : "sem data final"}
                  </p>
                </div>

                <strong className="text-sm tabular-nums">
                  {brl(Number(record.amount))}
                </strong>

                <button
                  type="button"
                  onClick={() => {
                    setCreatingRecurrence(null);
                    setEditingRecurrence(record);
                  }}
                  className="rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted"
                >
                  Editar
                </button>
              </div>
            ))
          )}
        </div>

        <RecurrenceDialog
          open={dialogOpen}
          recurrence={editingRecurrence}
          scopedType={isIncome ? "receita" : "despesa"}
          fixedExpenseOnly={!isIncome}
          excludeThirdParty={false}
          onClose={() => {
            setCreatingRecurrence(null);
            setEditingRecurrence(null);
          }}
        />
      </div>
    );
  };
  const planningSection = (
    key: "receita" | "fixo",
    title: string,
    items: PlanningItem[],
    thirdItems: PlanningItem[],
    href: string,
  ) => {
    const familyValue = sum(
      items.flatMap(item => item.monthly.map(m => m.value))
    );

    const thirdValue = sum(
      thirdItems.flatMap(item => item.monthly.map(m => m.value))
    );

    return (
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        {sectionHeader(
          key,
          title,
          "Planejamentos e lançamentos pontuais · Jan a Dez",
          familyValue,
          href,
        )}

        {managing === key && recurrenceManager(key)}

        {open[key] && (
          <div className="border-t border-border p-3">
            <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span>🟩 Registrado e previsto</span>
              <span>🟦 Pago ou recebido</span>
              <span>🟨 Estimativa</span>
              <span>⬜ Sem ocorrência</span>
            </div>

            <div className="mb-1 grid gap-2 px-2 text-[10px] text-muted-foreground lg:grid-cols-[220px_150px_minmax(350px,1fr)_130px]">
              <span>PLANEJAMENTO</span>
              <span>CATEGORIA</span>
              <div className="grid grid-cols-12 gap-1 text-center">
                {MONTHS.map(m => <span key={m}>{m}</span>)}
              </div>
              <span className="text-right">TOTAL ANUAL</span>
            </div>

            <div className="flex items-center justify-between bg-primary/10 px-3 py-2 text-xs font-semibold">
              <span>Família · {items.length} registros</span>
              <span>{brl(familyValue)}</span>
            </div>

            {renderPlanningLines(items, "familia")}

            {thirdItems.length > 0 && (
              <details className="mt-3 overflow-hidden rounded-md border border-border">
                <summary className="flex cursor-pointer items-center justify-between bg-muted/40 px-3 py-3 text-xs font-semibold">
                  <span>Movimentações de terceiros · {thirdItems.length} registros</span>
                  <span>{brl(thirdValue)}</span>
                </summary>
                {renderPlanningLines(thirdItems, "terceiros")}
              </details>
            )}

            <p className="mt-3 text-xs text-muted-foreground">
              Os totais familiares excluem terceiros. Lançamentos pontuais
              e valores já registrados aparecem junto aos planejamentos
              periódicos, sem criar novos registros no banco.
            </p>
          </div>
        )}
      </section>
    );
  };
  return (
    <div className="space-y-5">
      {focus === "variavel" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
          <div><a className="text-xs text-primary" href="/planejamento?modelo=A">← Voltar ao Planejamento</a><h1 className="mt-2 text-xl font-semibold">Gerenciar despesas variáveis</h1><p className="text-xs text-muted-foreground">Orçamento mensal por categoria, histórico e aplicação anual</p></div>
          <select aria-label="Ano do planejamento" value={year} onChange={event => { setDraftChanged(false);setVariableDraft({});setYear(Number(event.target.value)); }} className="rounded-md border bg-background px-3 py-2 text-sm">{Array.from({length:7},(_,i)=>new Date().getFullYear()-1+i).map(y=><option key={y} value={y}>{y}</option>)}</select>
        </div>
      ) : <JourneyHeader
        step={2}
        title="Planejamento financeiro"
        subtitle="Receitas, despesas fixas e variáveis em uma única visão anual."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Ano do planejamento"
              value={year}
              onChange={event => {
                setDraftChanged(false);
                setVariableDraft({});
                setYear(Number(event.target.value));
              }}
              className="rounded-md border border-border bg-card px-3 py-2"
            >
              {Array.from({ length: 7 }, (_, i) =>
                new Date().getFullYear() - 1 + i
              ).map(value =>
                <option key={value} value={value}>{value}</option>
              )}
            </select>
            <a
              href="/planejamento?modelo=A"
              className="rounded-md border px-3 py-2 text-sm"
            >
              Modelo anterior
            </a>
          </div>
        }
      />}

      {focus !== "variavel" && <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
        Visualização integrada aos dados existentes. A edição e aprovação
        anual ainda não gravam alterações no banco.
      </div>}

      {pending ? (
        <p className="rounded-xl border p-6">Carregando planejamentos...</p>
      ) : failed ? (
        <p className="rounded-xl border border-destructive p-6">
          Não foi possível carregar todos os dados do planejamento.
        </p>
      ) : !familyId ? (
        <p className="rounded-xl border p-6">Família não identificada.</p>
      ) : (
        <>
          {focus !== "variavel" && <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Receitas", incomeTotal],
              ["Despesas fixas", fixedTotal],
              ["Despesas variáveis", variableTotal],
              ["Resultado", resultTotal],
            ].map(([title, value]) => (
              <div key={title} className="rounded-xl border bg-card p-4">
                <p className="text-xs text-muted-foreground">{title}</p>
                <strong className="mt-2 block text-xl tabular-nums">
                  {brl(Number(value))}
                </strong>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <strong className="text-sm">
                  Movimentações de terceiros
                </strong>
                <p className="text-xs text-muted-foreground">
                  Receitas e despesas de terceiros não compõem o resultado familiar.
                </p>
              </div>
              <div className="flex flex-wrap gap-5 text-right text-xs">
                <div>
                  <p className="text-muted-foreground">Entradas</p>
                  <strong>{brl(thirdIncomeTotal)}</strong>
                </div>
                <div>
                  <p className="text-muted-foreground">Saídas registradas / previstas</p>
                  <strong>{brl(thirdFixedTotal + thirdVariableTotal)}</strong>
                </div>
                <div>
                  <p className="text-muted-foreground">Saldo líquido</p>
                  <strong>{brl(thirdResultTotal)}</strong>
                </div>
              </div>
            </div>
          </div>
          {planningSection(
            "receita",
            "Receitas planejadas",
            incomeItems,
            incomeThirdItems,
            "/recorrencias?visao=receitas&origem=planejamento",
          )}

          {planningSection(
            "fixo",
            "Despesas fixas",
            fixedItems,
            fixedThirdItems,
            "/recorrencias?visao=despesas-fixas&origem=planejamento",
          )}

          </>}
          <section className="overflow-hidden rounded-xl border bg-card">
            {sectionHeader(
              "variavel",
              "Despesas variáveis",
              "Orçamento mensal por categoria, com histórico e subcategorias",
              variableTotal,
            )}
            {open.variavel && (
              <div className="border-t border-border p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-2xl">
                    <div className="flex items-center gap-2">
                      <WalletCards className="h-5 w-5 text-primary" />
                      <h2 className="font-semibold">Orçamento das despesas variáveis</h2>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      O orçamento é um limite por categoria. Ele não cria uma despesa; o valor é
                      consumido quando você registra uma compra ou pagamento variável. Digite o limite
                      somente na categoria principal; todas as subcategorias usam o mesmo valor.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Mês do orçamento variável"
                      value={variableMonth}
                      onChange={event => setVariableMonth(Number(event.target.value))}
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {MONTHS.map((month, index) => (
                        <option key={month} value={index + 1}>{month}/{year}</option>
                      ))}
                    </select>
                    <Button variant="outline" onClick={copyPreviousVariable} disabled={lockedVariableMonth}>
                      <Copy className="h-4 w-4" /> Copiar planejamento do mês anterior
                    </Button>
                    {variableSuggestion.hasEnoughHistory && (
                      <Button variant="outline" onClick={applyVariableSuggestions} disabled={lockedVariableMonth}>
                        <Lightbulb className="h-4 w-4" /> Aplicar sugestão de 3 meses
                      </Button>
                    )}
                    <Button variant="outline" onClick={applyVariableTo12} disabled={lockedVariableMonth}>
                      Aplicar para 12 meses
                    </Button>
                    {approvedVariableMonth ? (
                      <a href="/agir" className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">
                        <LockKeyhole className="h-4 w-4" /> Revisar no Action
                      </a>
                    ) : legacyVariableMonth ? (
                      <span className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
                        Orçamento anterior: incorporação pendente
                      </span>
                    ) : (
                      <Button onClick={saveVariableMonth} disabled={lockedVariableMonth}>
                        <Save className="h-4 w-4" /> Salvar e aprovar orçamento
                      </Button>
                    )}
                  </div>
                </div>
                {variableSuggestion.hasEnoughHistory ? (
                  <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                    <strong>Sugestão disponível.</strong> Calculada pela média real de{" "}
                    {variableSuggestion.months.join(", ")}. Você pode aceitar tudo ou ajustar cada categoria.
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                    A sugestão será liberada quando houver despesas variáveis registradas em três meses consecutivos.
                  </div>
                )}
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[960px] text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="py-2">Categoria</th>
                        {variableSuggestion.months.map(key => (
                          <th key={key} className="py-2 text-right">
                            {key.slice(5)}/{key.slice(2, 4)}
                          </th>
                        ))}
                        <th className="py-2 text-right">Média dos 3 meses</th>
                        <th className="py-2 pl-5">Orçamento do mês</th>
                        <th className="py-2 text-right">Parcelas comprometidas</th>
                        <th className="py-2 text-right">Restante antes dos demais gastos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variableRoots.map(root => (
                        <VariableTreeBudgetRows
                          key={root.id}
                          root={root}
                          children={familyCategories.filter(c =>
                            c.kind === "despesa" && c.parent_id === root.id
                          ).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))}
                          hasHistory={variableSuggestion.hasEnoughHistory}
                          rootAverage={variableSuggestion.suggestions.get(root.id) ?? 0}
                          rootMonths={variableSuggestion.rootMonths.get(root.id) ?? [0, 0, 0]}
                          categoryMonths={variableSuggestion.categoryMonths}
                          categoryAverages={variableSuggestion.categoryAverages}
                          value={variableValue(root.id, variableMonth - 1)}
                          installmentCommitted={variableInstallmentsByRoot.get(root.id) ?? 0}
                          onValueChange={value => setVariableValue(root.id, variableMonth - 1, String(value))}
                          readOnly={lockedVariableMonth}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                {draftChanged && (
                  <p className="mt-3 rounded-lg border border-amber-500/30 p-3 text-sm">
                    Existem valores em edição. Aplicar para 12 meses não grava nem aprova os outros meses.
                  </p>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function VariableTreeBudgetRows({
  root,
  children,
  hasHistory,
  rootAverage,
  rootMonths,
  categoryMonths,
  categoryAverages,
  value,
  installmentCommitted,
  onValueChange,
  readOnly = false,
}: {
  root: { id: string; name: string };
  children: { id: string; name: string }[];
  hasHistory: boolean;
  rootAverage: number;
  rootMonths: number[];
  categoryMonths: Map<string, number[]>;
  categoryAverages: Map<string, number>;
  value: number;
  installmentCommitted: number;
  onValueChange: (value: number) => void;
  readOnly?: boolean;
}) {
  const remaining = round(value - installmentCommitted);
  return (
    <>
      <tr className="border-t border-border bg-muted/25">
        <td className="py-3 font-semibold">
          <span>{root.name}</span>
          <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Categoria principal
          </span>
        </td>
        {rootMonths.map((amount, index) => (
          <td key={index} className="py-3 text-right tabular-nums">{brl(amount)}</td>
        ))}
        <td className="py-3 text-right font-medium">
          {hasHistory ? brl(rootAverage) : "Aguardando histórico"}
        </td>
        <td className="py-3 pl-5">
          <CurrencyInput
            aria-label={`Orçamento de ${root.name}`}
            className="ml-auto max-w-[180px]"
            value={value}
            onValueChange={onValueChange}
            disabled={readOnly}
          />
        </td>
        <td className="py-3 text-right tabular-nums">{brl(installmentCommitted)}</td>
        <td className={`py-3 text-right font-medium tabular-nums ${
          Math.round((remaining + Number.EPSILON) * 100) < 0 ? "text-destructive" : ""
        }`}>{brl(remaining)}</td>
      </tr>
      {children.map((category, index) => (
        <tr key={category.id} className="border-t border-border/70 text-muted-foreground">
          <td className="relative py-2.5 pl-8">
            <span
              aria-hidden="true"
              className={`absolute left-3 top-0 w-3 border-b border-l border-border ${
                index === children.length - 1 ? "h-1/2" : "h-full"
              }`}
            />
            {category.name}
          </td>
          {(categoryMonths.get(category.id) ?? [0, 0, 0]).map((amount, index) => (
            <td key={index} className="py-2.5 text-right tabular-nums">{brl(amount)}</td>
          ))}
          <td className="py-2.5 text-right">
            {hasHistory ? brl(categoryAverages.get(category.id) ?? 0) : "—"}
          </td>
          <td colSpan={3} className="py-2.5 pl-5 text-sm">
            Usa o limite da categoria principal
          </td>
        </tr>
      ))}
    </>
  );
}

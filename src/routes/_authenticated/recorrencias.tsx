import { planningFixedMonth } from "@/lib/planning";
import { useInvoices } from "@/lib/queries";
import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import { JourneyBackLink } from "@/components/journey-header";
import { CurrencyInput } from "@/components/currency-input";
import { brl, formatDateBR, shortMonth, toISODate } from "@/lib/format";
import { FREQUENCY_LABEL, type RecurrenceFrequency } from "@/lib/finance";
import {
  categoryMatches,
  categoryPath,
  isThirdPartyCategory,
  isThirdPartyTransaction,
  orderedCategoryOptions,
} from "@/lib/derive";
import {
  useAccounts,
  useCards,
  useCategories,
  useInvalidateFinance,
  useMembers,
  useProfile,
  useRecurrences,
  useTransactions,
} from "@/lib/queries";
import { deleteTransaction, saveRecurrence } from "@/lib/transactions";
import type { Database } from "@/integrations/supabase/types";

type Recurrence = Database["public"]["Tables"]["recurring_transactions"]["Row"];

export const Route = createFileRoute("/_authenticated/recorrencias")({
  validateSearch: (search: Record<string, unknown>) => ({
    visao:
      search["visao"] === "receitas" || search["visao"] === "despesas-fixas"
        ? search["visao"]
        : undefined,
    origem: search["origem"] === "planejamento" ? "planejamento" : undefined,
    ano:
      typeof search["ano"] === "string" &&
      /^\d{4}$/.test(search["ano"]) &&
      Number(search["ano"]) >= 2000 &&
      Number(search["ano"]) <= 2100
        ? search["ano"]
        : undefined,
    mes:
      typeof search["mes"] === "string" &&
      /^(0?[1-9]|1[0-2])$/.test(search["mes"])
        ? search["mes"].padStart(2, "0")
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Recorrências — Finanças da Família" },
      {
        name: "description",
        content: "Cadastre e edite receitas e despesas recorrentes com data inicial e final.",
      },
      { property: "og:title", content: "Recorrências — Finanças da Família" },
      {
        property: "og:description",
        content: "Cadastre e edite receitas e despesas recorrentes com data inicial e final.",
      },
    ],
  }),
  component: Recorrencias,
});

const NONE = "__none__";
const ALL = "__all__";

function Recorrencias() {
  const { visao, origem, ano, mes } = Route.useSearch();
  const isIncomeView = visao === "receitas";
  const isFixedExpenseView = visao === "despesas-fixas";
  const isPlanningView = isIncomeView || isFixedExpenseView;
  const scopedType = isIncomeView ? "receita" : isFixedExpenseView ? "despesa" : null;
  const pageTitle = isIncomeView
    ? "Receitas planejadas"
    : isFixedExpenseView
      ? "Despesas planejadas"
      : "Recorrências";
  const newButtonLabel = isIncomeView
    ? "Nova receita planejada"
    : isFixedExpenseView
      ? "Nova despesa planejada"
      : "Nova recorrência";
  const { data: recurrences = [] } = useRecurrences();
  // Sinaliza ambos os lados de uma continuidade explicitamente cadastrada.
  const linkedRecurrenceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of recurrences) {
      if (item.predecessor_recurrence_id) {
        ids.add(item.id);
        ids.add(item.predecessor_recurrence_id);
      }
    }
    return ids;
  }, [recurrences]);
  const { data: profile } = useProfile();
  const { data: transactions = [] } = useTransactions();
  const { data: invoices = [] } = useInvoices();
  const [fixedCardMonth, setFixedCardMonth] = useState(
    mes ? Number(mes) : new Date().getMonth() + 1
  );
  const { data: categories = [] } = useCategories();
  const invalidate = useInvalidateFinance();
  const [editing, setEditing] = useState<Recurrence | null>(null);
  const [editingExtra, setEditingExtra] =
    useState<(typeof transactions)[number] | null>(null);
  const [extraDescription, setExtraDescription] = useState("");
  const [extraAmount, setExtraAmount] = useState("");
  const [extraCategoryId, setExtraCategoryId] = useState(NONE);
  const [extraCompetence, setExtraCompetence] = useState("");
  const [extraPaidDate, setExtraPaidDate] = useState("");
  const [savingExtra, setSavingExtra] = useState(false);

  const [creating, setCreating] = useState(false);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(ano ?? String(currentYear));
  const [extraMonth, setExtraMonth] = useState(
    mes ?? String(new Date().getMonth() + 1).padStart(2, "0")
  );
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);

  const yearOptions = useMemo(() => {
    const years = new Set<number>([currentYear, Number(year)]);
    for (const recurrence of recurrences) {
      years.add(Number(recurrence.start_date.slice(0, 4)));
      if (recurrence.end_date) years.add(Number(recurrence.end_date.slice(0, 4)));
    }
    for (const transaction of transactions) {
      if (transaction.recurring_id) years.add(Number(transaction.competence_date.slice(0, 4)));
    }
    return [...years].filter(Number.isFinite).sort((a, b) => b - a);
  }, [recurrences, transactions, currentYear, year]);

  const filteredRecurrences = useMemo(() => {
    const startsBeforeYearEnds = (r: Recurrence) => r.start_date <= `${year}-12-31`;
    const endsAfterYearStarts = (r: Recurrence) => !r.end_date || r.end_date >= `${year}-01-01`;
    return recurrences.filter((r) => {
      if (!startsBeforeYearEnds(r) || !endsAfterYearStarts(r)) return false;
      if (scopedType && r.type !== scopedType) return false;
      if (isPlanningView && isThirdPartyCategory(categories, r.category_id)) return false;
      if (isFixedExpenseView && r.expense_nature !== "fixo") return false;
      if (!scopedType && typeFilter !== ALL && r.type !== typeFilter) return false;
      if (
        categoryFilter !== ALL &&
        (categoryFilter === NONE
          ? r.category_id !== null
          : !categoryMatches(categories, r.category_id, categoryFilter))
      )
        return false;
      if (statusFilter === "ativas" && !r.is_active) return false;
      if (statusFilter === "inativas" && r.is_active) return false;
      return true;
    });
  }, [
    recurrences,
    year,
    typeFilter,
    categoryFilter,
    statusFilter,
    categories,
    scopedType,
    isFixedExpenseView,
    isPlanningView,
  ]);

  const filteredIds = useMemo(
    () => new Set(filteredRecurrences.map((recurrence) => recurrence.id)),
    [filteredRecurrences],
  );

  const recurringRows = useMemo(
    () =>
      transactions.filter(
        (transaction) =>
          transaction.recurring_id &&
          filteredIds.has(transaction.recurring_id) &&
          transaction.status !== "cancelado" &&
          transaction.competence_date.startsWith(`${year}-`),
      ),
    [transactions, filteredIds, year],
  );

  const fixedFamilyInvoices = useMemo(
    () =>
      invoices.filter(
        (invoice) => invoice.family_id === profile?.family_id
      ),
    [invoices, profile?.family_id]
  );

  const fixedCardTransactions = useMemo(() => {
    if (!profile?.family_id) return [];

    const key = `${year}-${String(fixedCardMonth).padStart(2, "0")}`;

    return transactions
      .filter(
        (transaction) =>
          transaction.family_id === profile.family_id &&
          transaction.type === "despesa" &&
          transaction.expense_nature === "fixo" &&
          transaction.credit_card_id !== null &&
          transaction.status !== "cancelado" &&
          !isThirdPartyTransaction(categories, transaction) &&
          planningFixedMonth(
            transaction,
            fixedFamilyInvoices
          ) === key
      )
      .sort((a, b) =>
        a.description.localeCompare(b.description, "pt-BR")
      );
  }, [
    transactions,
    profile?.family_id,
    categories,
    fixedFamilyInvoices,
    year,
    fixedCardMonth
  ]);

  const fixedCardSum = fixedCardTransactions.reduce(
    (total, transaction) => total + Number(transaction.amount),
    0
  );
  const incomeChartRows = useMemo(() => {
    if (!profile?.family_id) return [];

    return transactions.filter((transaction) =>
      transaction.family_id === profile.family_id &&
      transaction.type === "receita" &&
      transaction.status !== "cancelado" &&
      transaction.competence_date.startsWith(`${year}-`) &&
      !isThirdPartyTransaction(categories, transaction)
    );
  }, [transactions, profile?.family_id, categories, year]);

  const chartRows = isIncomeView ? incomeChartRows : recurringRows;

  const extraIncomeRows = incomeChartRows
    .filter(
      (transaction) =>
        transaction.recurring_id == null &&
        transaction.status === "pago" &&
        transaction.competence_date.startsWith(`${year}-${extraMonth}`)
    )
    .sort((a, b) => b.competence_date.localeCompare(a.competence_date));

  const extraIncomeTotal = extraIncomeRows.reduce(
    (total, transaction) => total + Number(transaction.amount),
    0
  );
  const monthlyChart = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => {
        const month = String(index + 1).padStart(2, "0");
        const rows = chartRows.filter((row) =>
          row.competence_date.startsWith(`${year}-${month}`),
        );
        return {
          name: shortMonth(index + 1),
          receitas: rows
            .filter((row) => row.type === "receita")
            .reduce((sum, row) => sum + Number(row.amount), 0),
          despesas: rows
            .filter((row) => row.type === "despesa")
            .reduce((sum, row) => sum + Number(row.amount), 0),
        };
      }),
    [chartRows, year],
  );

  const categoryChart = useMemo(() => {
    const grouped = new Map<
      string,
      { name: string; receitas: number; despesas: number; valor: number }
    >();
    for (const row of chartRows) {
      const name = categoryPath(categories, row.category_id);
      const item = grouped.get(name) ?? { name, receitas: 0, despesas: 0, valor: 0 };
      if (row.type === "receita") item.receitas += Number(row.amount);
      if (row.type === "despesa") item.despesas += Number(row.amount);
      item.valor += Number(row.amount);
      grouped.set(name, item);
    }
    return [...grouped.values()].sort(
      (a, b) => b.receitas + b.despesas - (a.receitas + a.despesas),
    );
  }, [chartRows, categories]);

  function openExtraEditor(transaction: (typeof transactions)[number]) {
    if (!profile?.family_id || transaction.family_id !== profile.family_id) return;
    if (
      transaction.type !== "receita" ||
      transaction.recurring_id !== null ||
      transaction.status !== "pago" ||
      isThirdPartyTransaction(categories, transaction)
    ) return;

    setEditingExtra(transaction);
    setExtraDescription(transaction.description);
    setExtraAmount(String(transaction.amount));
    setExtraCategoryId(transaction.category_id ?? NONE);
    setExtraCompetence(transaction.competence_date);
    setExtraPaidDate(transaction.paid_date ?? transaction.competence_date);
  }

  async function saveExtraIncome() {
    if (!editingExtra || !profile?.family_id) return;
    if (editingExtra.family_id !== profile.family_id) return;
    if (
      editingExtra.type !== "receita" ||
      editingExtra.recurring_id !== null ||
      editingExtra.status !== "pago" ||
      isThirdPartyTransaction(categories, editingExtra)
    ) return;

    const amount = Number(extraAmount.trim().replace(",", "."));
    if (!extraDescription.trim() || !Number.isFinite(amount) || amount <= 0) {
      toast.error("Informe descrição e valor válido");
      return;
    }
    if (!extraCompetence || !extraPaidDate) {
      toast.error("Informe a competência e a data de recebimento");
      return;
    }

    if (
      extraCategoryId !== NONE &&
      !categories.some(
        (category) =>
          category.id === extraCategoryId &&
          category.family_id === profile.family_id &&
          category.kind === "receita" &&
          !isThirdPartyCategory(categories, category.id)
      )
    ) {
      toast.error("Selecione uma categoria válida da família");
      return;
    }

    setSavingExtra(true);
    try {
      const { error } = await supabase
        .from("transactions")
        .update({
          description: extraDescription.trim(),
          amount,
          category_id: extraCategoryId === NONE ? null : extraCategoryId,
          competence_date: extraCompetence,
          paid_date: extraPaidDate,
        })
        .eq("id", editingExtra.id)
        .eq("family_id", profile.family_id)
        .eq("type", "receita")
        .is("recurring_id", null)
        .eq("status", "pago");

      if (error) throw error;
      invalidate();
      setEditingExtra(null);
      toast.success("Receita extra atualizada");
    } catch (error) {
      toast.error("Não foi possível atualizar a receita", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSavingExtra(false);
    }
  }

  async function removeExtraIncome(transaction: (typeof transactions)[number]) {
    if (!profile?.family_id || transaction.family_id !== profile.family_id) return;
    if (
      transaction.type !== "receita" ||
      transaction.recurring_id !== null ||
      transaction.status !== "pago" ||
      isThirdPartyTransaction(categories, transaction)
    ) return;

    if (!window.confirm(
      `Mover a receita "${transaction.description}" para Excluídos?`
    )) return;

    try {
      await deleteTransaction(transaction);
      invalidate();
      toast.success("Receita movida para Excluídos");
    } catch (error) {
      toast.error("Não foi possível excluir a receita", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }
  async function toggle(id: string, isActive: boolean) {
    await supabase.from("recurring_transactions").update({ is_active: isActive }).eq("id", id);
    invalidate();
  }

  async function remove(r: Recurrence) {
    // Nunca apagar lançamentos de uma recorrência ainda referenciada por uma continuação.
    if (recurrences.some((other) => other.predecessor_recurrence_id === r.id)) {
      toast.error("Esta recorrência possui uma continuação vinculada", {
        description: "Remova primeiro o vínculo na recorrência seguinte.",
      });
      return;
    }
    const { error: txError } = await supabase
      .from("transactions")
      .delete()
      .eq("recurring_id", r.id)
      .neq("status", "pago");
    if (txError) {
      toast.error("Não foi possível excluir os lançamentos futuros");
      return;
    }
    const { error } = await supabase.from("recurring_transactions").delete().eq("id", r.id);
    if (error) toast.error("Não foi possível excluir");
    else {
      invalidate();
      toast.success("Recorrência excluída");
    }
  }

  return (
    <div>
      <JourneyBackLink {...(origem === "planejamento" ? { origin: "planejamento" as const } : {})} />
      <PageHeader
        title={pageTitle}
        subtitle={
          isIncomeView
            ? "Organize os recebimentos planejados da família"
            : isFixedExpenseView
              ? "Organize os compromissos fixos planejados da família"
              : "Lançamentos que se repetem entre uma data inicial e uma data final"
        }
        actions={
          <Button onClick={() => setCreating(true)} className="gap-2">
            <Plus className="h-4 w-4" /> {newButtonLabel}
          </Button>
        }
      />

      <section className="mb-5 rounded-xl border border-border bg-card p-4">
        <div
          className={`grid gap-3 sm:grid-cols-2 ${isPlanningView ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}
        >
          <TopFilter
            label="Ano"
            value={year}
            setValue={setYear}
            items={yearOptions.map((item) => [String(item), String(item)])}
          />
          {!isPlanningView && (
            <TopFilter
              label="Tipo"
              value={typeFilter}
              setValue={setTypeFilter}
              items={[
                [ALL, "Receitas e despesas"],
                ["receita", "Receitas"],
                ["despesa", "Despesas"],
              ]}
            />
          )}
          <TopFilter
            label="Categoria"
            value={categoryFilter}
            setValue={setCategoryFilter}
            items={[
              [ALL, "Todas as categorias"],
              [NONE, "Sem categoria"],
              ...orderedCategoryOptions(
                scopedType
                  ? categories.filter(
                      (category) =>
                        category.kind === scopedType &&
                        !isThirdPartyCategory(categories, category.id),
                    )
                  : categories,
              ).map((category) => [category.id, category.label]),
            ]}
          />
          <TopFilter
            label="Situação"
            value={statusFilter}
            setValue={setStatusFilter}
            items={[
              [ALL, "Ativas e inativas"],
              ["ativas", "Ativas"],
              ["inativas", "Inativas"],
            ]}
          />
        </div>
      </section>

      <section className="mb-5 grid gap-4 xl:grid-cols-2">
        <MonthlyRecurrenceChart
          title={`${pageTitle} por mês — ${year}`}
          data={monthlyChart}
          scopedType={scopedType}
        />
        <CategoryRecurrenceChart
          title={`${pageTitle} por categoria — ${year}`}
          data={categoryChart}
        />
      </section>

      {recurrences.length === 0 ? (
        <EmptyState
          title={
            isPlanningView
              ? `Nenhum cadastro de ${isIncomeView ? "receita" : "despesa fixa"} encontrado`
              : "Nenhuma recorrência cadastrada"
          }
          hint={
            isPlanningView
              ? `Use o botão “${newButtonLabel}” para começar.`
              : "Crie uma recorrência para gerar automaticamente os lançamentos do período."
          }
        />
      ) : filteredRecurrences.length === 0 ? (
        <EmptyState
          title={
            isPlanningView
              ? `Nenhuma ${isIncomeView ? "receita" : "despesa fixa"} planejada encontrada`
              : "Nenhuma recorrência encontrada"
          }
          hint="Altere os filtros para consultar outros registros."
        />
      ) : isPlanningView ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[780px] text-sm">
            <thead className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-3">Descrição</th>
                <th className="p-3">Categoria</th>
                <th className="p-3">Periodicidade</th>
                <th className="p-3">Período planejado</th>
                <th className="p-3 text-right">Valor</th>
                <th className="p-3 text-center">Ativa</th>
                <th className="p-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecurrences.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-3 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <span>{r.description}</span>
                      {linkedRecurrenceIds.has(r.id) && (
                        <span
                          className="inline-flex shrink-0 items-center text-primary/80"
                          title="Esta recorrência faz parte de uma continuidade planejada."
                          aria-label="Recorrência vinculada"
                        >
                          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="p-3">{categoryPath(categories, r.category_id)}</td>
                  <td className="p-3">{FREQUENCY_LABEL[r.frequency]}</td>
                  <td className="p-3">
                    {formatDateBR(r.start_date)} até{" "}
                    {r.end_date ? formatDateBR(r.end_date) : "sem fim"}
                  </td>
                  <td className="p-3 text-right font-medium">{brl(Number(r.amount))}</td>
                  <td className="p-3 text-center">
                    <Switch
                      checked={r.is_active}
                      onCheckedChange={(active) => toggle(r.id, active)}
                      aria-label={`Ativar ou desativar ${r.description}`}
                    />
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Editar"
                      onClick={() => setEditing(r)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Excluir"
                      onClick={() => remove(r)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {filteredRecurrences.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
                  <span className="truncate">{r.description}</span>
                  {linkedRecurrenceIds.has(r.id) && (
                    <span
                      className="inline-flex shrink-0 items-center text-primary/80"
                      title="Esta recorrência faz parte de uma continuidade planejada."
                      aria-label="Recorrência vinculada"
                    >
                      <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.type === "receita" ? "Receita" : "Despesa"} · {FREQUENCY_LABEL[r.frequency]} ·{" "}
                  {formatDateBR(r.start_date)} até{" "}
                  {r.end_date ? formatDateBR(r.end_date) : "sem fim"} ·{" "}
                  {categoryPath(categories, r.category_id)}
                </p>
              </div>
              <span className="shrink-0 text-sm font-medium text-foreground">
                {brl(Number(r.amount))}
              </span>
              <Switch checked={r.is_active} onCheckedChange={(v) => toggle(r.id, v)} />
              <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => setEditing(r)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => remove(r)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}

            {isFixedExpenseView && (
        <section className="mt-5 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">
                Despesas fixas no cartão
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Compromissos identificados pelo vencimento da fatura.
                Nenhum novo lançamento é criado.
              </p>
            </div>
            <strong className="text-xl">
              {brl(fixedCardSum)}
            </strong>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label
              htmlFor="fixed-card-month"
              className="text-sm text-muted-foreground"
            >
              Mês de vencimento
            </label>

            <select
              id="fixed-card-month"
              value={fixedCardMonth}
              onChange={(event) =>
                setFixedCardMonth(Number(event.target.value))
              }
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              {Array.from({ length: 12 }, (_, index) => (
                <option key={index + 1} value={index + 1}>
                  {new Date(2026, index, 1).toLocaleDateString(
                    "pt-BR",
                    { month: "long" }
                  )}
                </option>
              ))}
            </select>
          </div>

          {fixedCardTransactions.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              Nenhuma despesa fixa no cartão neste mês.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[580px] text-sm">
                <thead className="bg-muted/30">
                  <tr className="text-left">
                    <th className="p-3">Descrição</th>
                    <th className="p-3">Parcela</th>
                    <th className="p-3">Vencimento</th>
                    <th className="p-3 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {fixedCardTransactions.map((transaction) => {
                    const invoice = fixedFamilyInvoices.find(
                      (item) => item.id === transaction.invoice_id
                    );

                    const due =
                      invoice?.due_date ??
                      transaction.due_date ??
                      transaction.competence_date;

                    return (
                      <tr
                        key={transaction.id}
                        className="border-t border-border"
                      >
                        <td className="p-3">
                          {transaction.description}
                        </td>
                        <td className="p-3">
                          {transaction.installment_number != null &&
                           transaction.installment_total != null
                            ? `${transaction.installment_number}/${transaction.installment_total}`
                            : "À vista"}
                        </td>
                        <td className="p-3">
                          {due.slice(8, 10)}/{due.slice(5, 7)}/{due.slice(0, 4)}
                        </td>
                        <td className="p-3 text-right font-medium">
                          {brl(Number(transaction.amount))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            Edite as compras diretamente na tela Cartões.
          </p>
        </section>
      )}
{isIncomeView && (
        <section className="mt-5 rounded-xl border border-border bg-card p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">
                Receitas extras — {shortMonth(Number(extraMonth))} de {year}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Recebimentos avulsos sem recorrência cadastrada.
                Compras para terceiros não são consideradas.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <select
                aria-label="Mês das receitas extras"
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={extraMonth}
                onChange={(event) => setExtraMonth(event.target.value)}
              >
                {Array.from({ length: 12 }, (_, index) => {
                  const value = String(index + 1).padStart(2, "0");
                  return (
                    <option key={value} value={value}>
                      {shortMonth(index + 1)}
                    </option>
                  );
                })}
              </select>
              <span className="text-lg font-bold text-success">
                {brl(extraIncomeTotal)}
              </span>
            </div>
          </div>

          {extraIncomeRows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
              Nenhuma receita extra recebida neste mês.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-3">Descrição</th>
                    <th className="p-3">Categoria</th>
                    <th className="p-3">Recebimento</th>
                    <th className="p-3 text-right">Valor</th>
                    <th className="p-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {extraIncomeRows.map((transaction) => (
                    <tr key={transaction.id} className="border-t border-border">
                      <td className="p-3 font-medium">
                        {transaction.description}
                      </td>
                      <td className="p-3">
                        {categoryPath(categories, transaction.category_id)}
                      </td>
                      <td className="p-3">
                        {formatDateBR(
                          transaction.paid_date ?? transaction.competence_date
                        )}
                      </td>
                      <td className="p-3 text-right font-medium text-success">
                        {brl(Number(transaction.amount))}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Editar ${transaction.description}`}
                          onClick={() => openExtraEditor(transaction)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Excluir ${transaction.description}`}
                          onClick={() => void removeExtraIncome(transaction)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            As ações afetam apenas o recebimento selecionado e não alteram recorrências.
            Receitas excluídas podem ser restauradas em Do (Executar).
          </p>
        </section>
      )}
      <Dialog
        open={!!editingExtra}
        onOpenChange={(open) => {
          if (!open && !savingExtra) setEditingExtra(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar receita extra</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Input
                value={extraDescription}
                onChange={(event) => setExtraDescription(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Valor (R$)</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={extraAmount}
                onChange={(event) => setExtraAmount(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Categoria</Label>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={extraCategoryId}
                onChange={(event) => setExtraCategoryId(event.target.value)}
              >
                <option value={NONE}>Sem categoria</option>
                {categories
                  .filter(
                    (category) =>
                      category.family_id === profile?.family_id &&
                      category.kind === "receita" &&
                      !isThirdPartyCategory(categories, category.id)
                  )
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {categoryPath(categories, category.id)}
                    </option>
                  ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Competência</Label>
                <Input
                  type="date"
                  value={extraCompetence}
                  onChange={(event) => setExtraCompetence(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Data do recebimento</Label>
                <Input
                  type="date"
                  value={extraPaidDate}
                  onChange={(event) => setExtraPaidDate(event.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={savingExtra}
              onClick={() => setEditingExtra(null)}
            >
              Cancelar
            </Button>
            <Button disabled={savingExtra} onClick={() => void saveExtraIncome()}>
              Salvar alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RecurrenceDialog
        open={creating || !!editing}
        recurrence={editing}
        scopedType={scopedType}
        fixedExpenseOnly={isFixedExpenseView}
        excludeThirdParty={isPlanningView}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function TopFilter({
  label,
  value,
  setValue,
  items,
}: {
  label: string;
  value: string;
  setValue: (value: string) => void;
  items: string[][];
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map(([itemValue, itemLabel]) => (
            <SelectItem key={itemValue ?? ""} value={itemValue ?? ""}>
              {itemLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function MonthlyRecurrenceChart({
  title,
  data,
  scopedType,
}: {
  title: string;
  data: { name: string; receitas: number; despesas: number }[];
  scopedType: "receita" | "despesa" | null;
}) {
  const hasData = data.some((item) => item.receitas > 0 || item.despesas > 0);

  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      {!hasData ? (
        <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
          Nenhum lançamento recorrente no período selecionado.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="mt-3 h-56 min-w-[560px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <XAxis dataKey="name" hide />
                <YAxis
                  fontSize={11}
                  tickLine={false}
                  stroke="var(--color-muted-foreground)"
                  tick={{ fill: "var(--color-muted-foreground)" }}
                />
                <Tooltip formatter={(value) => brl(Number(value))} />
                {scopedType !== "despesa" && (
                  <Bar dataKey="receitas" name="Receitas" fill="var(--color-chart-1)" />
                )}
                {scopedType !== "receita" && (
                  <Bar dataKey="despesas" name="Despesas" fill="var(--color-chart-3)" />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div
            className="mt-1 grid min-w-[560px] text-center text-[11px] text-muted-foreground"
            style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}
          >
            {data.map((item) => (
              <span key={item.name}>{item.name}</span>
            ))}
          </div>
          <div className="mt-3 flex justify-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[var(--color-chart-1)]" /> Receitas
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[var(--color-chart-3)]" /> Despesas
            </span>
          </div>
        </div>
      )}
    </article>
  );
}

function CategoryRecurrenceChart({
  title,
  data,
}: {
  title: string;
  data: { name: string; receitas: number; despesas: number; valor: number }[];
}) {
  const maxValue = Math.max(...data.map((item) => item.valor), 1);
  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-4 max-h-[420px] space-y-4 overflow-y-auto pr-1">
        {data.map((item) => (
          <div key={item.name}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-foreground" title={item.name}>
                {item.name}
              </span>
              <span className="shrink-0 font-medium text-muted-foreground">{brl(item.valor)}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${Math.max((item.valor / maxValue) * 100, item.valor > 0 ? 2 : 0)}%`,
                }}
              />
            </div>
          </div>
        ))}
        {data.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum lançamento recorrente no período selecionado.
          </p>
        )}
      </div>
    </article>
  );
}

function RecurrenceDialog({
  open,
  recurrence,
  scopedType,
  fixedExpenseOnly,
  excludeThirdParty,
  onClose,
}: {
  open: boolean;
  recurrence: Recurrence | null;
  scopedType: "receita" | "despesa" | null;
  fixedExpenseOnly: boolean;
  excludeThirdParty: boolean;
  onClose: () => void;
}) {
  const { data: profile } = useProfile();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { data: members = [] } = useMembers();
  const { data: cards = [] } = useCards();
  const { data: recurrences = [] } = useRecurrences();
  const invalidate = useInvalidateFinance();

  const today = toISODate(new Date());
  const defaultEnd = toISODate(new Date(new Date().getFullYear(), 11, 31));

  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [type, setType] = useState<"receita" | "despesa">("despesa");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(0);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("mensal");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [dueDate, setDueDate] = useState(today);
  const [categoryId, setCategoryId] = useState(NONE);
  const [accountId, setAccountId] = useState(NONE);
  const [cardId, setCardId] = useState(NONE);
  const [memberId, setMemberId] = useState(NONE);
  const [notes, setNotes] = useState("");
  const [predecessorId, setPredecessorId] = useState(NONE);
  const [expenseNature, setExpenseNature] = useState<"fixo" | "variavel">("fixo");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const key = open ? (recurrence?.id ?? "new") : null;
  if (key !== loadedKey) {
    setLoadedKey(key);
    if (recurrence) {
      setType(recurrence.type === "receita" ? "receita" : "despesa");
      setDescription(recurrence.description);
      setAmount(Number(recurrence.amount));
      setFrequency(recurrence.frequency);
      setStartDate(recurrence.start_date);
      setEndDate(recurrence.end_date ?? defaultEnd);
      setDueDate(recurrence.start_date);
      setCategoryId(recurrence.category_id ?? NONE);
      setAccountId(recurrence.account_id ?? NONE);
      setCardId(recurrence.credit_card_id ?? NONE);
      setMemberId(recurrence.member_id ?? NONE);
      setNotes(recurrence.notes ?? "");
      setPredecessorId(recurrence.predecessor_recurrence_id ?? NONE);
      setExpenseNature(recurrence.expense_nature ?? "fixo");
      setIsActive(recurrence.is_active);
    } else if (open) {
      setType(scopedType ?? "despesa");
      setExpenseNature("fixo");
      setDescription("");
      setAmount(0);
      setFrequency("mensal");
      setStartDate(today);
      setEndDate(defaultEnd);
      setDueDate(today);
      setCategoryId(NONE);
      setAccountId(NONE);
      setCardId(NONE);
      setMemberId(NONE);
      setNotes("");
      setPredecessorId(NONE);
      setIsActive(true);
    }
  }

  const categoryOptions = useMemo(() => {
    const canSelectThirdParty = !excludeThirdParty || Boolean(recurrence);
    const parents = categories.filter(
      (category) =>
        category.kind === type &&
        !category.parent_id &&
        (canSelectThirdParty || !isThirdPartyCategory(categories, category.id)),
    );
    return parents.flatMap((p) => [
      { id: p.id, label: p.name, child: false },
      ...categories
        .filter(
          (category) =>
            category.parent_id === p.id &&
            (canSelectThirdParty || !isThirdPartyCategory(categories, category.id)),
        )
        .map((c) => ({ id: c.id, label: c.name, child: true })),
    ]);
  }, [categories, type, excludeThirdParty, recurrence]);

  // Um vínculo representa a continuação informada pelo usuário, nunca inferida por nome.
  // As regras de integridade também são verificadas pela trigger do PostgreSQL.
  const eligiblePredecessors = useMemo(() => {
    return recurrences
      .filter((candidate) => {
        if (!profile?.family_id || candidate.family_id !== profile.family_id) return false;
        if (candidate.id === recurrence?.id || candidate.type !== type) return false;
        if (!candidate.end_date || candidate.end_date >= startDate) return false;
        const alreadyContinued = recurrences.some(
          (other) =>
            other.predecessor_recurrence_id === candidate.id && other.id !== recurrence?.id,
        );
        return !alreadyContinued;
      })
      .sort((a, b) => b.end_date!.localeCompare(a.end_date!));
  }, [recurrences, profile?.family_id, recurrence?.id, type, startDate]);

  const selectedPredecessor =
    predecessorId === NONE ? null : recurrences.find((item) => item.id === predecessorId);
  const predecessorIsEligible =
    predecessorId === NONE || eligiblePredecessors.some((item) => item.id === predecessorId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (savingRef.current) return;
    if (!profile?.family_id) return;
    const value = amount;
    if (scopedType && type !== scopedType) {
      toast.error("O tipo do lançamento não corresponde à tela selecionada");
      return;
    }
    const selectedCategoryId = categoryId === NONE ? null : categoryId;
    const selectedIsThirdParty = isThirdPartyCategory(categories, selectedCategoryId);
    const previousWasThirdParty = isThirdPartyCategory(categories, recurrence?.category_id ?? null);
    const movingToThirdParty =
      excludeThirdParty && Boolean(recurrence) && selectedIsThirdParty && !previousWasThirdParty;

    if (excludeThirdParty && selectedIsThirdParty && !recurrence) {
      toast.error("Categorias de terceiros não pertencem ao planejamento da família");
      return;
    }
    if (
      movingToThirdParty &&
      !window.confirm(
        `Esta ${type === "receita" ? "receita" : "despesa"} será transferida para o controle de Compras para terceiros e não aparecerá mais nesta lista. Deseja continuar?`,
      )
    ) {
      return;
    }
    if (fixedExpenseOnly && expenseNature !== "fixo") {
      toast.error("Esta tela permite somente despesas fixas");
      return;
    }
    if (!value || value <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    if (endDate < startDate) {
      toast.error("A data final deve ser posterior à data inicial");
      return;
    }
    if (!predecessorIsEligible) {
      toast.error("A recorrência anterior não é elegível", {
        description: "Verifique a família, o tipo, a data final e se ela já possui continuação.",
      });
      return;
    }

    const usesCard = type === "despesa" && cardId !== NONE;
    if (type === "despesa") {
      if (accountId === NONE && cardId === NONE) {
        toast.error("Selecione uma conta ou um cartão");
        return;
      }
      if (accountId !== NONE && cardId !== NONE) {
        toast.error("Escolha apenas conta OU cartão");
        return;
      }
      if (!usesCard && !dueDate) {
        toast.error("Informe a data de vencimento");
        return;
      }
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await saveRecurrence({
        familyId: profile.family_id,
        id: recurrence?.id,
        description,
        type,
        amount: value,
        categoryId: selectedCategoryId,
        accountId: usesCard || accountId === NONE ? null : accountId,
        creditCardId: type === "receita" || cardId === NONE ? null : cardId,
        memberId: memberId === NONE ? null : memberId,
        frequency,
        startDate,
        endDate,
        dayOfMonth: usesCard ? null : Number(dueDate.slice(8, 10)) || null,
        dueBaseDate: usesCard ? null : dueDate,
        notes: notes || null,
        expenseNature: type === "despesa" ? expenseNature : null,
        isActive,
        predecessorRecurrenceId: predecessorId === NONE ? null : predecessorId,
      });
      if (movingToThirdParty && recurrence && selectedCategoryId) {
        const { error: transferError } = await supabase
          .from("transactions")
          .update({ category_id: selectedCategoryId })
          .eq("recurring_id", recurrence.id);
        if (transferError) throw transferError;
      }
      invalidate();
      toast.success(recurrence ? "Recorrência atualizada" : "Recorrência criada");
      onClose();
    } catch (error) {
      toast.error("Erro ao salvar", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {scopedType
              ? `${recurrence ? "Editar" : "Nova"} ${scopedType === "receita" ? "receita planejada" : "despesa planejada"}`
              : recurrence
                ? "Editar recorrência"
                : "Nova recorrência"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="rd">Descrição</Label>
              <Input
                id="rd"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Aluguel, salário, mensalidade…"
              />
            </div>

            {!scopedType && (
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={type} onValueChange={(v) => setType(v as "receita" | "despesa")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="despesa">Despesa</SelectItem>
                    <SelectItem value="receita">Receita</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {type === "despesa" && !fixedExpenseOnly && (
              <div className="space-y-2">
                <Label>Classificação</Label>
                <Select
                  value={expenseNature}
                  onValueChange={(v) => setExpenseNature(v as "fixo" | "variavel")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixo">Fixo</SelectItem>
                    <SelectItem value="variavel">Variável</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="rv">Valor (R$)</Label>
              <CurrencyInput id="rv" required value={amount} onValueChange={setAmount} />
            </div>

            <div className="space-y-2">
              <Label>Periodicidade</Label>
              <Select
                value={frequency}
                onValueChange={(v) => setFrequency(v as RecurrenceFrequency)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FREQUENCY_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!(type === "despesa" && cardId !== NONE) && (
              <div className="space-y-2">
                <Label htmlFor="rdia">
                  {type === "receita" ? "Data de recebimento" : "Data de vencimento"}
                </Label>
                <Input
                  id="rdia"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="rini">Data inicial</Label>
              <Input
                id="rini"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="rfim">Data final</Label>
              <Input
                id="rfim"
                type="date"
                min={startDate}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>

            <div className="space-y-2 sm:col-span-2 rounded-lg border border-border p-3">
              <Label htmlFor="recurrence-predecessor">Continua a recorrência</Label>
              <p className="text-xs text-muted-foreground">
                Se esta recorrência substitui uma anterior do mesmo compromisso, selecione-a
                explicitamente. Não são feitos vínculos por descrição semelhante.
              </p>
              <select
                id="recurrence-predecessor"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={predecessorId}
                onChange={(e) => setPredecessorId(e.target.value)}
              >
                <option value={NONE}>Nenhuma — recorrência independente</option>
                {eligiblePredecessors.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.description} · {brl(Number(item.amount))} · termina em{" "}
                    {formatDateBR(item.end_date!)}
                  </option>
                ))}
                {selectedPredecessor && !predecessorIsEligible && (
                  <option value={selectedPredecessor.id} disabled>
                    Vínculo atual indisponível — revise os períodos
                  </option>
                )}
              </select>
              {predecessorId !== NONE && predecessorIsEligible && selectedPredecessor && (
                <p className="text-xs text-muted-foreground">
                  Continuação após {formatDateBR(selectedPredecessor.end_date!)}. Valor anterior:{" "}
                  {brl(Number(selectedPredecessor.amount))}; novo valor: {brl(amount)}. O vínculo
                  não altera automaticamente os lançamentos da recorrência anterior.
                </p>
              )}
              {predecessorId !== NONE && !predecessorIsEligible && (
                <p className="text-xs text-destructive">
                  A recorrência selecionada não atende mais às regras. Ajuste as datas ou remova o
                  vínculo antes de salvar.
                </p>
              )}
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label>Categoria</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem categoria</SelectItem>
                  {categoryOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.child ? `— ${c.label}` : c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Conta</Label>
              <Select
                value={accountId}
                onValueChange={(v) => {
                  setAccountId(v);
                  if (v !== NONE) setCardId(NONE);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem conta</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {type === "despesa" && (
              <div className="space-y-2">
                <Label>Cartão</Label>
                <Select
                  value={cardId}
                  onValueChange={(v) => {
                    setCardId(v);
                    if (v !== NONE) setAccountId(NONE);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Opcional" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem cartão</SelectItem>
                    {cards.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Despesa recorrente: informe conta <strong>ou</strong> cartão. No cartão, cada
                  ocorrência entra na fatura conforme o fechamento.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Membro</Label>
              <Select value={memberId} onValueChange={setMemberId}>
                <SelectTrigger>
                  <SelectValue placeholder="Opcional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem membro</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <Label htmlFor="rat" className="cursor-pointer">
                Ativa
              </Label>
              <Switch id="rat" checked={isActive} onCheckedChange={setIsActive} />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="robs">Observação</Label>
              <Textarea
                id="robs"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Ao salvar, os lançamentos futuros ainda não quitados desta recorrência são regerados
            entre a data inicial e a data final.
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

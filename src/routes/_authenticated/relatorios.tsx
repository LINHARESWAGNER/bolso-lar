import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Search } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/ui-bits";
import { brl, formatDateBR, shortMonth, toISODate } from "@/lib/format";
import {
  STATUS_LABEL,
  TYPE_LABEL,
  type Account,
  type Category,
  type CreditCard,
  type Transaction,
} from "@/lib/finance";
import {
  categoryMatches,
  categoryPath,
  expensesByRootCategory,
  orderedCategoryOptions,
} from "@/lib/derive";
import { useAccounts, useCards, useCategories, useMembers, useTransactions } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios — Finanças da Família" },
      {
        name: "description",
        content: "Análises por categoria, membro e período com exportação em CSV.",
      },
      { property: "og:title", content: "Relatórios — Finanças da Família" },
      {
        property: "og:description",
        content: "Análises por categoria, membro e período com exportação em CSV.",
      },
    ],
  }),
  component: Relatorios,
});

const ALL = "todos";
const referenceDateForReport = (transaction: Transaction) =>
  transaction.paid_date ?? transaction.due_date ?? transaction.competence_date;

function rootCategoryId(categories: Category[], transaction: Transaction) {
  const category = categories.find((item) => item.id === transaction.category_id);
  if (!category) return "sem";
  return category.parent_id ?? category.id;
}

function Relatorios() {
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: members = [] } = useMembers();
  const { data: accounts = [] } = useAccounts();
  const { data: cards = [] } = useCards();

  const today = new Date();
  const [from, setFrom] = useState(
    toISODate(new Date(today.getFullYear(), today.getMonth() - 5, 1)),
  );
  const [to, setTo] = useState(toISODate(new Date(today.getFullYear(), today.getMonth() + 1, 0)));
  const [search, setSearch] = useState("");
  const [type, setType] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [nature, setNature] = useState(ALL);
  const [accountFilter, setAccountFilter] = useState(ALL);
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [memberFilter, setMemberFilter] = useState(ALL);
  const [cardFilter, setCardFilter] = useState(ALL);
  const [chartCategory, setChartCategory] = useState<{
    id: string;
    name: string;
    type: "receita" | "despesa";
  } | null>(null);
  const [chartMonth, setChartMonth] = useState<string | null>(null);

  const scoped = useMemo(() => {
    return transactions.filter((transaction) => {
      const date = referenceDateForReport(transaction);
      if (date < from || date > to) return false;
      if (type !== ALL && transaction.type !== type) return false;
      if (
        status === ALL
          ? transaction.status === "cancelado"
          : status === "aberto"
            ? transaction.status === "pago" || transaction.status === "cancelado"
            : transaction.status !== status
      )
        return false;
      if (
        nature !== ALL &&
        (nature === "nao_classificado"
          ? Boolean(transaction.expense_nature)
          : transaction.expense_nature !== nature)
      )
        return false;
      if (accountFilter !== ALL && transaction.account_id !== accountFilter) return false;
      if (
        categoryFilter !== ALL &&
        !categoryMatches(categories, transaction.category_id, categoryFilter)
      )
        return false;
      if (memberFilter !== ALL && transaction.member_id !== memberFilter) return false;
      if (cardFilter !== ALL && transaction.credit_card_id !== cardFilter) return false;
      if (search && !transaction.description.toLowerCase().includes(search.toLowerCase()))
        return false;
      return true;
    });
  }, [
    transactions,
    from,
    to,
    type,
    status,
    nature,
    accountFilter,
    categoryFilter,
    categories,
    memberFilter,
    cardFilter,
    search,
  ]);

  const categoryScoped = useMemo(
    () =>
      chartCategory
        ? scoped.filter(
            (transaction) =>
              transaction.type === chartCategory.type &&
              rootCategoryId(categories, transaction) === chartCategory.id,
          )
        : scoped,
    [scoped, chartCategory, categories],
  );

  const tableRows = useMemo(
    () =>
      categoryScoped
        .filter((transaction) =>
          chartMonth ? referenceDateForReport(transaction).startsWith(chartMonth) : true,
        )
        .sort((a, b) => referenceDateForReport(b).localeCompare(referenceDateForReport(a))),
    [categoryScoped, chartMonth],
  );

  const receitas = scoped
    .filter((t) => t.type === "receita")
    .reduce((s, t) => s + Number(t.amount), 0);
  const despesas = scoped
    .filter((t) => t.type === "despesa")
    .reduce((s, t) => s + Number(t.amount), 0);

  const porCategoria = useMemo(
    () => expensesByRootCategory(scoped, categories).slice(0, 10),
    [scoped, categories],
  );

  const receitasPorCategoria = useMemo(() => {
    const map = new Map<string, { id: string; name: string; value: number }>();
    for (const t of scoped) {
      if (t.type !== "receita") continue;
      const category = categories.find((item) => item.id === t.category_id);
      const root = category?.parent_id
        ? categories.find((item) => item.id === category.parent_id)
        : category;
      const name = root?.name ?? "Sem categoria";
      const id = root?.id ?? "sem";
      const current = map.get(id) ?? { id, name, value: 0 };
      current.value += Number(t.amount);
      map.set(id, current);
    }
    return [...map.values()].sort((a, b) => b.value - a.value).slice(0, 10);
  }, [scoped, categories]);

  const monthly = useMemo(() => {
    const startKey = from.slice(0, 7);
    const endKey = to.slice(0, 7);
    const startYear = Number(startKey.slice(0, 4));
    const startMonth = Number(startKey.slice(5, 7));
    const spansYears = startKey.slice(0, 4) !== endKey.slice(0, 4);
    const result: { name: string; receitas: number; despesas: number }[] = [];
    let yearCursor = startYear;
    let monthCursor = startMonth;

    while (
      `${yearCursor}-${String(monthCursor).padStart(2, "0")}` <= endKey &&
      result.length < 240
    ) {
      const key = `${yearCursor}-${String(monthCursor).padStart(2, "0")}`;
      const rows = categoryScoped.filter((transaction) =>
        referenceDateForReport(transaction).startsWith(key),
      );
      result.push({
        key,
        name: spansYears
          ? `${shortMonth(monthCursor)}/${String(yearCursor).slice(2)}`
          : shortMonth(monthCursor),
        receitas: rows
          .filter((transaction) => transaction.type === "receita")
          .reduce((sum, transaction) => sum + Number(transaction.amount), 0),
        despesas: rows
          .filter((transaction) => transaction.type === "despesa")
          .reduce((sum, transaction) => sum + Number(transaction.amount), 0),
      });
      monthCursor += 1;
      if (monthCursor === 13) {
        monthCursor = 1;
        yearCursor += 1;
      }
    }
    return result;
  }, [categoryScoped, from, to]);

  function exportCsv() {
    const header = [
      "Data competência",
      "Vencimento",
      "Descrição",
      "Tipo",
      "Categoria",
      "Conta",
      "Membro",
      "Situação",
      "Valor",
    ];
    const lines = tableRows.map((t) =>
      [
        t.competence_date,
        t.due_date ?? "",
        t.description.replace(/;/g, ","),
        TYPE_LABEL[t.type],
        categoryPath(categories, t.category_id),
        accounts.find((a) => a.id === t.account_id)?.name ?? "",
        members.find((m) => m.id === t.member_id)?.name ?? "",
        t.status,
        String(t.amount).replace(".", ","),
      ].join(";"),
    );
    const csv = `\uFEFF${[header.join(";"), ...lines].join("\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `lancamentos-${from}-a-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        title="Relatórios"
        subtitle={`${formatDateBR(from)} a ${formatDateBR(to)} · ${scoped.length} lançamentos`}
        actions={
          <Button variant="outline" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" /> Exportar CSV
          </Button>
        }
      />

      <section className="mb-4 rounded-xl border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1.5">
            <Label htmlFor="de">De</Label>
            <Input id="de" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ate">Até</Label>
            <Input id="ate" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="relative self-end sm:col-span-2 lg:col-span-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Pesquisar descrição"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <ReportFilter
            value={type}
            setValue={setType}
            items={[[ALL, "Todos os tipos"], ...Object.entries(TYPE_LABEL)]}
          />
          <ReportFilter
            value={status}
            setValue={setStatus}
            items={[
              [ALL, "Todas as situações"],
              ["aberto", "Somente em aberto"],
              ...Object.entries(STATUS_LABEL),
            ]}
          />
          <ReportFilter
            value={nature}
            setValue={setNature}
            items={[
              [ALL, "Todas as classificações"],
              ["fixo", "Fixa"],
              ["variavel", "Variável"],
              ["nao_classificado", "Não classificada"],
            ]}
          />
          <ReportFilter
            value={accountFilter}
            setValue={setAccountFilter}
            items={[[ALL, "Todas as contas"], ...accounts.map((item) => [item.id, item.name])]}
          />
          <ReportFilter
            value={categoryFilter}
            setValue={setCategoryFilter}
            items={[
              [ALL, "Todas as categorias"],
              ...orderedCategoryOptions(categories).map((item) => [item.id, item.label]),
            ]}
          />
          <ReportFilter
            value={memberFilter}
            setValue={setMemberFilter}
            items={[[ALL, "Todos os membros"], ...members.map((item) => [item.id, item.name])]}
          />
          <ReportFilter
            value={cardFilter}
            setValue={setCardFilter}
            items={[[ALL, "Todos os cartões"], ...cards.map((item) => [item.id, item.name])]}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Receitas</p>
          <p className="mt-2 text-xl font-semibold text-success">{brl(receitas)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Despesas</p>
          <p className="mt-2 text-xl font-semibold text-destructive">{brl(despesas)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Resultado</p>
          <p
            className={`mt-2 text-xl font-semibold ${receitas - despesas >= 0 ? "text-foreground" : "text-destructive"}`}
          >
            {brl(receitas - despesas)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ReportBars
          title="Despesas por categoria"
          data={porCategoria}
          color="var(--color-chart-3)"
          selectedId={chartCategory?.type === "despesa" ? chartCategory.id : null}
          onSelect={(item) => {
            setChartCategory((current) =>
              current?.type === "despesa" && current.id === item.id
                ? null
                : { id: item.id, name: item.name, type: "despesa" },
            );
          }}
        />
        <ReportBars
          title="Receitas por categoria"
          data={receitasPorCategoria}
          color="var(--color-chart-1)"
          selectedId={chartCategory?.type === "receita" ? chartCategory.id : null}
          onSelect={(item) => {
            setChartCategory((current) =>
              current?.type === "receita" && current.id === item.id
                ? null
                : { id: item.id, name: item.name, type: "receita" },
            );
          }}
        />
      </div>

      <MonthlyReportChart
        data={monthly}
        selectedMonth={chartMonth}
        onMonthSelect={(month) => setChartMonth((current) => (current === month ? null : month))}
      />

      {(chartCategory || chartMonth) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">Filtros dos gráficos:</span>
          {chartCategory && <span>{chartCategory.name}</span>}
          {chartMonth && <span>{monthly.find((item) => item.key === chartMonth)?.name}</span>}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              setChartCategory(null);
              setChartMonth(null);
            }}
          >
            Limpar filtros
          </Button>
        </div>
      )}

      <ReportTransactionsTable
        rows={tableRows}
        categories={categories}
        accounts={accounts}
        cards={cards}
      />
    </div>
  );
}

function ReportFilter({
  value,
  setValue,
  items,
}: {
  value: string;
  setValue: (value: string) => void;
  items: string[][];
}) {
  return (
    <Select value={value} onValueChange={setValue}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map(([itemValue, itemLabel]) => (
          <SelectItem key={itemValue} value={itemValue}>
            {itemLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ReportBars({
  title,
  data,
  color,
  selectedId,
  onSelect,
}: {
  title: string;
  data: { id: string; name: string; value: number }[];
  color: string;
  selectedId: string | null;
  onSelect: (item: { id: string; name: string; value: number }) => void;
}) {
  const maxValue = Math.max(...data.map((item) => item.value), 1);
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-card-foreground">{title}</h2>
      <div className="mt-4 space-y-4">
        {data.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`block w-full rounded-md p-1 text-left transition-colors hover:bg-muted/60 ${
              selectedId === item.id ? "bg-muted ring-1 ring-primary/50" : ""
            }`}
            onClick={() => onSelect(item)}
            aria-pressed={selectedId === item.id}
          >
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-foreground" title={item.name}>
                {item.name}
              </span>
              <span className="shrink-0 font-medium text-muted-foreground">{brl(item.value)}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max((item.value / maxValue) * 100, item.value > 0 ? 2 : 0)}%`,
                  background: color,
                }}
              />
            </div>
          </button>
        ))}
        {data.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum lançamento encontrado no período.
          </p>
        )}
      </div>
    </section>
  );
}

function MonthlyReportChart({
  data,
  selectedMonth,
  onMonthSelect,
}: {
  data: { key: string; name: string; receitas: number; despesas: number }[];
  selectedMonth: string | null;
  onMonthSelect: (month: string) => void;
}) {
  const hasData = data.some((item) => item.receitas > 0 || item.despesas > 0);
  return (
    <section className="mt-4 rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-card-foreground">Receitas e despesas por mês</h2>
      {!hasData ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Nenhum lançamento encontrado no período.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div className="mt-3 h-64 min-w-[680px]">
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
                <Bar
                  dataKey="receitas"
                  name="Receitas"
                  fill="var(--color-chart-1)"
                  cursor="pointer"
                  onClick={(item: { key: string }) => onMonthSelect(item.key)}
                />
                <Bar
                  dataKey="despesas"
                  name="Despesas"
                  fill="var(--color-chart-3)"
                  cursor="pointer"
                  onClick={(item: { key: string }) => onMonthSelect(item.key)}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div
            className="mt-1 grid min-w-[680px] text-center text-[11px] text-muted-foreground"
            style={{ gridTemplateColumns: `repeat(${Math.max(data.length, 1)}, minmax(0, 1fr))` }}
          >
            {data.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`rounded py-1 hover:bg-muted ${selectedMonth === item.key ? "bg-muted font-semibold text-foreground" : ""}`}
                onClick={() => onMonthSelect(item.key)}
              >
                {item.name}
              </button>
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
    </section>
  );
}

function ReportTransactionsTable({
  rows,
  categories,
  accounts,
  cards,
}: {
  rows: Transaction[];
  categories: Category[];
  accounts: Account[];
  cards: CreditCard[];
}) {
  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <h2 className="text-sm font-semibold text-card-foreground">Lançamentos do relatório</h2>
        <span className="text-xs text-muted-foreground">{rows.length} registro(s)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-surface-2/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Data</th>
              <th className="px-4 py-3 font-medium">Descrição</th>
              <th className="px-4 py-3 font-medium">Tipo</th>
              <th className="px-4 py-3 font-medium">Categoria</th>
              <th className="px-4 py-3 font-medium">Conta/Cartão</th>
              <th className="px-4 py-3 font-medium">Situação</th>
              <th className="px-4 py-3 text-right font-medium">Valor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((transaction) => (
              <tr key={transaction.id} className="border-t border-border/60">
                <td className="px-4 py-3 text-muted-foreground">
                  {formatDateBR(referenceDateForReport(transaction))}
                </td>
                <td className="max-w-[260px] px-4 py-3 font-medium">
                  <p className="truncate">{transaction.description}</p>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{TYPE_LABEL[transaction.type]}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {categoryPath(categories ?? [], transaction.category_id)}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {accounts?.find((item) => item.id === transaction.account_id)?.name ??
                    cards?.find((item) => item.id === transaction.credit_card_id)?.name ??
                    "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {STATUS_LABEL[transaction.status]}
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  {brl(Number(transaction.amount))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum lançamento encontrado para os filtros selecionados.
          </p>
        )}
      </div>
    </section>
  );
}

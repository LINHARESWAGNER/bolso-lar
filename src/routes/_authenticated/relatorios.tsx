import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Search } from "lucide-react";
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
import { brl, formatDateBR, toISODate } from "@/lib/format";
import { STATUS_LABEL, TYPE_LABEL, type Transaction } from "@/lib/finance";
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

  const scoped = useMemo(() => {
    const refDate = (transaction: Transaction) =>
      transaction.paid_date ?? transaction.due_date ?? transaction.competence_date;
    return transactions.filter((transaction) => {
      const date = refDate(transaction);
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

  const porMembro = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of scoped) {
      if (t.type !== "despesa") continue;
      const name = members.find((m) => m.id === t.member_id)?.name ?? "Sem membro";
      map.set(name, (map.get(name) ?? 0) + Number(t.amount));
    }
    return [...map.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [scoped, members]);

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
    const lines = scoped.map((t) =>
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
        <ReportBars title="Despesas por categoria" data={porCategoria} />
        <ReportBars title="Despesas por membro" data={porMembro} />
      </div>
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

function ReportBars({ title, data }: { title: string; data: { name: string; value: number }[] }) {
  const maxValue = Math.max(...data.map((item) => item.value), 1);
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-card-foreground">{title}</h2>
      <div className="mt-4 space-y-4">
        {data.map((item) => (
          <div key={item.name}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-foreground" title={item.name}>
                {item.name}
              </span>
              <span className="shrink-0 font-medium text-muted-foreground">{brl(item.value)}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${Math.max((item.value / maxValue) * 100, item.value > 0 ? 2 : 0)}%`,
                }}
              />
            </div>
          </div>
        ))}
        {data.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma despesa encontrada no período.
          </p>
        )}
      </div>
    </section>
  );
}

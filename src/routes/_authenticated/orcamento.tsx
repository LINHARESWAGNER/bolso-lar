import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MonthSelector } from "@/components/month-selector";
import { usePeriod } from "@/components/period-context";
import { PageHeader } from "@/components/ui-bits";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { brl, monthLabel, shortMonth } from "@/lib/format";
import { categoryPath, variableBudgetForMonth, variableExpensesForMonth } from "@/lib/derive";
import {
  useAccounts,
  useCards,
  useCategories,
  useInvalidateFinance,
  useProfile,
  useTransactions,
  useVariableBudgets,
} from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/orcamento")({
  head: () => ({ meta: [{ title: "Orçamento — Finanças da Família" }] }),
  component: Orcamento,
});

const ALL = "__all__";

function Orcamento() {
  const { month, year } = usePeriod();
  const { data: profile } = useProfile();
  const { data: transactions = [] } = useTransactions();
  const { data: periods = [] } = useVariableBudgets();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { data: cards = [] } = useCards();
  const invalidate = useInvalidateFinance();
  const [nature, setNature] = useState("variavel");
  const [category, setCategory] = useState(ALL);
  const [account, setAccount] = useState(ALL);
  const [card, setCard] = useState(ALL);
  const [startsOn, setStartsOn] = useState(`${year}-01-01`);
  const [endsOn, setEndsOn] = useState(`${year}-12-31`);
  const [amount, setAmount] = useState(3500);
  const [saving, setSaving] = useState(false);

  const budget = variableBudgetForMonth(periods, year, month);
  const variableRows = variableExpensesForMonth(transactions, year, month);
  const spent = variableRows.reduce((sum, t) => sum + Number(t.amount), 0);
  const balance = budget.amount - spent;

  const rows = useMemo(
    () =>
      transactions.filter((t) => {
        if (t.type !== "despesa" || t.status === "cancelado") return false;
        if (!t.competence_date.startsWith(`${year}-${String(month).padStart(2, "0")}`))
          return false;
        if (
          nature === "__null__"
            ? t.expense_nature !== null
            : nature !== ALL && t.expense_nature !== nature
        )
          return false;
        if (category !== ALL && t.category_id !== category) return false;
        if (account !== ALL && t.account_id !== account) return false;
        if (card !== ALL && t.credit_card_id !== card) return false;
        return true;
      }),
    [transactions, year, month, nature, category, account, card],
  );

  const byCategory = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const t of variableRows) {
      const name = categoryPath(categories, t.category_id);
      grouped.set(name, (grouped.get(name) ?? 0) + Number(t.amount));
    }
    return [...grouped].map(([name, valor]) => ({ name, valor })).sort((a, b) => b.valor - a.valor);
  }, [variableRows, categories]);

  const annual = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => {
        const m = index + 1;
        return {
          name: shortMonth(m),
          orcado: variableBudgetForMonth(periods, year, m).amount,
          realizado: variableExpensesForMonth(transactions, year, m).reduce(
            (s, t) => s + Number(t.amount),
            0,
          ),
        };
      }),
    [periods, transactions, year],
  );

  async function savePeriod() {
    if (!profile?.family_id || startsOn > endsOn) {
      toast.error("Informe um período válido");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("variable_budget_periods").insert({
      family_id: profile.family_id,
      starts_on: startsOn,
      ends_on: endsOn,
      monthly_amount: amount,
    });
    setSaving(false);
    if (error)
      toast.error(
        error.message.includes("sobrepõe") ? error.message : "Não foi possível salvar o orçamento",
      );
    else {
      invalidate();
      toast.success("Período de orçamento salvo");
    }
  }

  async function removePeriod(id: string) {
    if (!window.confirm("Excluir esta configuração de orçamento?")) return;
    const { error } = await supabase.from("variable_budget_periods").delete().eq("id", id);
    if (error) toast.error("Não foi possível excluir");
    else {
      invalidate();
      toast.success("Configuração excluída");
    }
  }

  return (
    <div>
      <PageHeader
        title="Orçamento"
        subtitle={`${monthLabel(month, year)} · somente gastos variáveis`}
        actions={<MonthSelector />}
      />
      {budget.usesDefault && (
        <div className="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          Nenhuma configuração cobre este mês. Aplicando o padrão de {brl(3500)}.
        </div>
      )}
      {budget.isPastWithoutBudget && (
        <div className="mb-4 rounded-xl border border-border bg-muted/40 p-3 text-sm">
          Este mês já passou e não possui configuração. O orçamento foi considerado como {brl(0)}.
        </div>
      )}
      <section className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Orçamento do mês" value={budget.amount} />
        <Kpi label="Valor gasto" value={spent} negative />
        <Kpi label="Saldo" value={balance} negative={balance < 0} />
      </section>

      <section className="mt-5 rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold">Configurar vigência</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div>
            <Label>Início</Label>
            <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </div>
          <div>
            <Label>Fim</Label>
            <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </div>
          <div>
            <Label>Valor mensal</Label>
            <CurrencyInput value={amount} onValueChange={setAmount} />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={savePeriod} disabled={saving}>
              Salvar período
            </Button>
          </div>
        </div>
        {periods.length > 0 && (
          <ul className="mt-4 divide-y divide-border text-sm">
            {periods.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <span>
                  {p.starts_on} a {p.ends_on} · {brl(Number(p.monthly_amount))}/mês
                </span>
                <Button variant="ghost" size="sm" onClick={() => removePeriod(p.id)}>
                  Excluir
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        <Chart
          title="Gastos variáveis por categoria"
          data={byCategory}
          bars={[{ key: "valor", name: "Gasto" }]}
        />
        <Chart
          title={`Orçado vs realizado — ${year}`}
          data={annual}
          bars={[
            { key: "orcado", name: "Orçado" },
            { key: "realizado", name: "Realizado" },
          ]}
        />
      </section>

      <section className="mt-5 rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold">Lançamentos do período</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <Filter
            value={nature}
            setValue={setNature}
            items={[
              [ALL, "Todos"],
              ["variavel", "Variável"],
              ["fixo", "Fixo"],
              ["__null__", "Não classificado"],
            ]}
          />
          <Filter
            value={category}
            setValue={setCategory}
            items={[
              [ALL, "Todas as categorias"],
              ...categories.filter((c) => c.kind === "despesa").map((c) => [c.id, c.name]),
            ]}
          />
          <Filter
            value={account}
            setValue={setAccount}
            items={[[ALL, "Todas as contas"], ...accounts.map((a) => [a.id, a.name])]}
          />
          <Filter
            value={card}
            setValue={setCard}
            items={[[ALL, "Todos os cartões"], ...cards.map((c) => [c.id, c.name])]}
          />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="py-2">{t.competence_date}</td>
                  <td>{t.description}</td>
                  <td>{categoryPath(categories, t.category_id)}</td>
                  <td>
                    {t.expense_nature === "fixo"
                      ? "Fixo"
                      : t.expense_nature === "variavel"
                        ? "Variável"
                        : "Não classificado"}
                  </td>
                  <td className="text-right">{brl(Number(t.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="py-6 text-center text-muted-foreground">Nenhum lançamento encontrado.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  negative = false,
}: {
  label: string;
  value: number;
  negative?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className={`mt-2 text-xl font-semibold ${negative ? "text-destructive" : ""}`}>
        {brl(value)}
      </p>
    </div>
  );
}

function Filter({
  value,
  setValue,
  items,
}: {
  value: string;
  setValue: (v: string) => void;
  items: string[][];
}) {
  return (
    <Select value={value} onValueChange={setValue}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map(([v, l]) => (
          <SelectItem key={v ?? ""} value={v ?? ""}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Chart({
  title,
  data,
  bars,
}: {
  title: string;
  data: Record<string, string | number>[];
  bars: { key: string; name: string }[];
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <XAxis dataKey="name" fontSize={11} />
            <YAxis fontSize={11} />
            <Tooltip formatter={(v) => brl(Number(v))} />
            {bars.map((bar, i) => (
              <Bar
                key={bar.key}
                dataKey={bar.key}
                name={bar.name}
                fill={i ? "var(--color-chart-3)" : "var(--color-chart-1)"}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

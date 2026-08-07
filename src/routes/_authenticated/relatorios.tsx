import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui-bits";
import { brl, brlCompact, formatDateBR, toISODate } from "@/lib/format";
import { TYPE_LABEL } from "@/lib/finance";
import { categoryPath, expensesByRootCategory, notCancelled } from "@/lib/derive";
import { useAccounts, useCategories, useMembers, useTransactions } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios — Finanças da Família" },
      { name: "description", content: "Análises por categoria, membro e período com exportação em CSV." },
      { property: "og:title", content: "Relatórios — Finanças da Família" },
      { property: "og:description", content: "Análises por categoria, membro e período com exportação em CSV." },
    ],
  }),
  component: Relatorios,
});

function Relatorios() {
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: members = [] } = useMembers();
  const { data: accounts = [] } = useAccounts();

  const today = new Date();
  const [from, setFrom] = useState(toISODate(new Date(today.getFullYear(), today.getMonth() - 5, 1)));
  const [to, setTo] = useState(toISODate(new Date(today.getFullYear(), today.getMonth() + 1, 0)));

  const scoped = useMemo(
    () =>
      transactions.filter(
        (t) => notCancelled(t) && t.competence_date >= from && t.competence_date <= to,
      ),
    [transactions, from, to],
  );

  const receitas = scoped.filter((t) => t.type === "receita").reduce((s, t) => s + Number(t.amount), 0);
  const despesas = scoped.filter((t) => t.type === "despesa").reduce((s, t) => s + Number(t.amount), 0);

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

  const chartTooltip = {
    background: "var(--color-popover)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    color: "var(--color-popover-foreground)",
  };

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

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="de">De</Label>
          <Input id="de" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ate">Até</Label>
          <Input id="ate" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

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
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-card-foreground">Despesas por categoria</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porCategoria} layout="vertical" margin={{ left: 12 }}>
                <XAxis
                  type="number"
                  stroke="var(--color-muted-foreground)"
                  fontSize={12}
                  tickFormatter={(v) => brlCompact(Number(v))}
                />
                <YAxis type="category" dataKey="name" width={110} stroke="var(--color-muted-foreground)" fontSize={12} />
                <Tooltip formatter={(v) => brl(Number(v))} contentStyle={chartTooltip} />
                <Bar dataKey="value" name="Despesas" fill="var(--color-chart-3)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-card-foreground">Despesas por membro</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porMembro}>
                <XAxis dataKey="name" stroke="var(--color-muted-foreground)" fontSize={12} />
                <YAxis
                  stroke="var(--color-muted-foreground)"
                  fontSize={12}
                  width={70}
                  tickFormatter={(v) => brlCompact(Number(v))}
                />
                <Tooltip formatter={(v) => brl(Number(v))} contentStyle={chartTooltip} />
                <Bar dataKey="value" name="Despesas" fill="var(--color-chart-4)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
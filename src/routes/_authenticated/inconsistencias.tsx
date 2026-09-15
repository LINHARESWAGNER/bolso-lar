import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { PageHeader } from "@/components/ui-bits";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { brl, formatDateBR, toISODate } from "@/lib/format";
import { categoryPath, variableBudgetForMonth, variableExpensesForMonth } from "@/lib/derive";
import { type Transaction } from "@/lib/finance";
import {
  useAccounts,
  useCards,
  useCategories,
  useTransactions,
  useVariableBudgets,
} from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/inconsistencias")({
  head: () => ({ meta: [{ title: "Inconsistências — Finanças da Família" }] }),
  component: Inconsistencias,
});

type Severity = "alta" | "media" | "baixa";
type IssueKind =
  | "orcamento"
  | "categoria"
  | "classificacao"
  | "origem"
  | "vencido"
  | "quitacao"
  | "cartao"
  | "parcelamento"
  | "duplicidade"
  | "valor";

type Issue = {
  id: string;
  kind: IssueKind;
  severity: Severity;
  title: string;
  detail: string;
  transaction?: Transaction;
  date?: string | null;
  amount?: number;
};

const ALL = "__all__";
const KIND_LABEL: Record<IssueKind, string> = {
  orcamento: "Orçamento estourado",
  categoria: "Sem categoria",
  classificacao: "Sem classificação",
  origem: "Sem conta ou cartão",
  vencido: "Vencimento atrasado",
  quitacao: "Quitação inconsistente",
  cartao: "Cartão/fatura inconsistente",
  parcelamento: "Parcelamento inconsistente",
  duplicidade: "Possível duplicidade",
  valor: "Valor inválido",
};

function Inconsistencias() {
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { data: cards = [] } = useCards();
  const { data: periods = [] } = useVariableBudgets();
  const [severity, setSeverity] = useState(ALL);
  const [kind, setKind] = useState(ALL);
  const [search, setSearch] = useState("");

  const issues = useMemo(() => {
    const result: Issue[] = [];
    const today = toISODate(new Date());
    const active = transactions.filter((transaction) => transaction.status !== "cancelado");

    for (const transaction of active) {
      const description = transaction.description || "Lançamento sem descrição";
      const dueDate = transaction.due_date ?? transaction.competence_date;
      const add = (kind: IssueKind, severity: Severity, title: string, detail: string) =>
        result.push({
          id: `${transaction.id}-${kind}`,
          kind,
          severity,
          title,
          detail,
          transaction,
          date: dueDate,
          amount: Number(transaction.amount),
        });

      if (Number(transaction.amount) <= 0)
        add("valor", "alta", description, "O valor deve ser maior que zero.");

      if (
        (transaction.type === "receita" || transaction.type === "despesa") &&
        !transaction.category_id
      )
        add("categoria", "media", description, "O lançamento não possui categoria.");

      if (transaction.type === "despesa" && !transaction.expense_nature)
        add("classificacao", "media", description, "Informe se a despesa é fixa ou variável.");

      if (
        (transaction.type === "receita" && !transaction.account_id) ||
        (transaction.type === "despesa" &&
          !transaction.account_id &&
          !transaction.credit_card_id) ||
        (transaction.type === "transferencia" && !transaction.account_id)
      )
        add(
          "origem",
          "alta",
          description,
          "O lançamento não está vinculado a uma conta ou cartão.",
        );

      if (transaction.account_id && transaction.credit_card_id)
        add(
          "origem",
          "alta",
          description,
          "O lançamento está vinculado simultaneamente a uma conta e a um cartão.",
        );

      if (transaction.status !== "pago" && dueDate < today)
        add("vencido", "alta", description, `Está em aberto desde ${formatDateBR(dueDate)}.`);

      if (transaction.status === "pago" && !transaction.paid_date)
        add("quitacao", "media", description, "Está quitado, mas não possui data de pagamento.");

      if (transaction.status !== "pago" && transaction.paid_date)
        add(
          "quitacao",
          "alta",
          description,
          "Possui data de pagamento, mas a situação não está como paga.",
        );

      if (transaction.type === "despesa" && transaction.credit_card_id && !transaction.invoice_id)
        add("cartao", "alta", description, "A compra no cartão não está vinculada a uma fatura.");

      if (
        transaction.installment_group_id &&
        (!transaction.installment_number ||
          !transaction.installment_total ||
          transaction.installment_number > transaction.installment_total)
      )
        add(
          "parcelamento",
          "alta",
          description,
          "Os dados de número ou total de parcelas estão incompletos.",
        );
    }

    const variableMonths = new Set(
      active
        .filter(
          (transaction) =>
            transaction.type === "despesa" && transaction.expense_nature === "variavel",
        )
        .map((transaction) => transaction.competence_date.slice(0, 7)),
    );
    for (const reference of variableMonths) {
      const [year, month] = reference.split("-").map(Number);
      const budget = variableBudgetForMonth(periods, year, month);
      if (budget.isPastWithoutBudget) continue;
      const spent = variableExpensesForMonth(active, year, month).reduce(
        (sum, transaction) => sum + Number(transaction.amount),
        0,
      );
      if (spent > budget.amount) {
        result.push({
          id: `budget-${reference}`,
          kind: "orcamento",
          severity: "alta",
          title: `Orçamento de ${String(month).padStart(2, "0")}/${year}`,
          detail: `Registrado ${brl(spent)} para um orçamento de ${brl(budget.amount)} — excesso de ${brl(spent - budget.amount)}.`,
          date: `${reference}-01`,
          amount: spent - budget.amount,
        });
      }
    }

    const duplicateGroups = new Map<string, Transaction[]>();
    for (const transaction of active) {
      if (transaction.type === "transferencia" || transaction.type === "pagamento_fatura") continue;
      const key = [
        transaction.type,
        transaction.description.trim().toLocaleLowerCase("pt-BR"),
        Number(transaction.amount).toFixed(2),
        transaction.competence_date,
        transaction.due_date ?? "",
        transaction.account_id ?? "",
        transaction.credit_card_id ?? "",
      ].join("|");
      const group = duplicateGroups.get(key) ?? [];
      group.push(transaction);
      duplicateGroups.set(key, group);
    }
    for (const [key, group] of duplicateGroups) {
      if (group.length < 2) continue;
      const transaction = group[0];
      if (!transaction) continue;
      result.push({
        id: `duplicate-${key}`,
        kind: "duplicidade",
        severity: "media",
        title: transaction.description,
        detail: `${group.length} lançamentos possuem os mesmos dados principais. Confirme se são realmente distintos.`,
        transaction,
        date: transaction.due_date ?? transaction.competence_date,
        amount: Number(transaction.amount) * group.length,
      });
    }

    const severityOrder: Record<Severity, number> = { alta: 0, media: 1, baixa: 2 };
    return result.sort(
      (a, b) =>
        severityOrder[a.severity] - severityOrder[b.severity] ||
        (a.date ?? "").localeCompare(b.date ?? ""),
    );
  }, [transactions, periods]);

  const filtered = issues.filter((issue) => {
    if (severity !== ALL && issue.severity !== severity) return false;
    if (kind !== ALL && issue.kind !== kind) return false;
    if (!search) return true;
    const term = search.toLocaleLowerCase("pt-BR");
    return `${issue.title} ${issue.detail}`.toLocaleLowerCase("pt-BR").includes(term);
  });

  const high = issues.filter((issue) => issue.severity === "alta").length;
  const medium = issues.filter((issue) => issue.severity === "media").length;

  return (
    <div>
      <PageHeader
        title="Inconsistências"
        subtitle="Pontos que merecem revisão — nenhuma correção é feita automaticamente"
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Total identificado" value={issues.length} icon={AlertCircle} />
        <SummaryCard label="Prioridade alta" value={high} icon={AlertTriangle} tone="danger" />
        <SummaryCard label="Prioridade média" value={medium} icon={Info} tone="warning" />
      </section>

      <section className="mt-5 rounded-xl border border-border bg-card p-4">
        <div className="grid gap-2 md:grid-cols-[1fr_220px_260px]">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Pesquisar inconsistência"
          />
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as prioridades</SelectItem>
              <SelectItem value="alta">Prioridade alta</SelectItem>
              <SelectItem value="media">Prioridade média</SelectItem>
              <SelectItem value="baixa">Prioridade baixa</SelectItem>
            </SelectContent>
          </Select>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos os tipos</SelectItem>
              {Object.entries(KIND_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className="mt-5 overflow-hidden rounded-xl border border-border bg-card">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <CheckCircle2 className="h-9 w-9 text-success" />
            <h2 className="mt-3 font-semibold">Nenhuma inconsistência encontrada</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Não há itens que correspondam aos filtros selecionados.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="bg-surface-2/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Prioridade</th>
                  <th className="px-4 py-3 font-medium">Tipo</th>
                  <th className="px-4 py-3 font-medium">Registro</th>
                  <th className="px-4 py-3 font-medium">Detalhe</th>
                  <th className="px-4 py-3 font-medium">Data</th>
                  <th className="px-4 py-3 text-right font-medium">Valor</th>
                  <th className="px-4 py-3 text-right font-medium">Ação</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((issue) => (
                  <tr key={issue.id} className="border-t border-border/60 align-top">
                    <td className="px-4 py-3">
                      <SeverityBadge severity={issue.severity} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{KIND_LABEL[issue.kind]}</td>
                    <td className="max-w-[220px] px-4 py-3">
                      <p className="font-medium text-foreground">{issue.title}</p>
                      {issue.transaction?.category_id && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {categoryPath(categories, issue.transaction.category_id)}
                        </p>
                      )}
                      {issue.transaction?.account_id && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {accounts.find((item) => item.id === issue.transaction?.account_id)?.name}
                        </p>
                      )}
                      {issue.transaction?.credit_card_id && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {
                            cards.find((item) => item.id === issue.transaction?.credit_card_id)
                              ?.name
                          }
                        </p>
                      )}
                    </td>
                    <td className="max-w-[360px] px-4 py-3 text-muted-foreground">
                      {issue.detail}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {issue.date ? formatDateBR(issue.date) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium">
                      {issue.amount === undefined ? "—" : brl(issue.amount)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {issue.transaction ? (
                        <Button asChild size="sm" variant="outline">
                          <Link
                            to="/lancamentos"
                            search={{ type: "todos", status: "todos", nature: "todos" }}
                          >
                            Revisar
                          </Link>
                        </Button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number;
  icon: typeof AlertCircle;
  tone?: "default" | "danger" | "warning";
}) {
  const color =
    tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-primary";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <p className={`mt-2 text-2xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const classes =
    severity === "alta"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : severity === "media"
        ? "border-warning/30 bg-warning/10 text-warning"
        : "border-primary/30 bg-primary/10 text-primary";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
      {severity === "alta" ? "Alta" : severity === "media" ? "Média" : "Baixa"}
    </span>
  );
}

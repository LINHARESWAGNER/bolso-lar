import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  ClipboardCheck,
  Search,
  ShieldCheck,
} from "lucide-react";
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
import { brl, formatDateBR } from "@/lib/format";
import { categoryPath } from "@/lib/derive";
import type { Transaction } from "@/lib/finance";
import { useAccounts, useCards, useCategories, useInvoices, useTransactions } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/inconsistencias")({
  head: () => ({ meta: [{ title: "Qualidade dos registros — Finanças da Família" }] }),
  component: Inconsistencias,
});

type Severity = "critica" | "atencao";
type IssueKind =
  | "valor"
  | "categoria"
  | "classificacao"
  | "origem"
  | "quitacao"
  | "fatura"
  | "parcelamento"
  | "duplicidade";
type Issue = {
  id: string;
  kind: IssueKind;
  severity: Severity;
  title: string;
  detail: string;
  action: string;
  transaction?: Transaction;
  date?: string | null;
  amount?: number;
};
const ALL = "__all__";
const KIND_LABEL: Record<IssueKind, string> = {
  valor: "Valor inválido",
  categoria: "Sem categoria",
  classificacao: "Sem classificação",
  origem: "Vínculo incompleto",
  quitacao: "Pagamento a conferir",
  fatura: "Vínculo de fatura",
  parcelamento: "Dados do parcelamento",
  duplicidade: "Possível duplicidade",
};
const ORDER: Record<Severity, number> = { critica: 0, atencao: 1 };

function Inconsistencias() {
  const txQuery = useTransactions();
  const catsQuery = useCategories();
  const accountsQuery = useAccounts();
  const cardsQuery = useCards();
  const invoicesQuery = useInvoices();
  const transactions = txQuery.data ?? [];
  const categories = catsQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];
  const cards = cardsQuery.data ?? [];
  const invoices = invoicesQuery.data ?? [];
  const [severity, setSeverity] = useState(ALL);
  const [kind, setKind] = useState(ALL);
  const [search, setSearch] = useState("");

  const issues = useMemo(() => {
    const result: Issue[] = [];
      const active = transactions.filter((item) => item.status !== "cancelado");
    const invoiceById = new Map(invoices.map((item) => [item.id, item]));
    const accountIds = new Set(accounts.map((item) => item.id));
    const cardIds = new Set(cards.map((item) => item.id));

    for (const tx of active) {
      const description = tx.description?.trim() || "Lançamento sem descrição";
      const date = tx.due_date ?? tx.competence_date;
      const amount = Number(tx.amount);
      const add = (kind: IssueKind, severity: Severity, detail: string, action: string) => {
        result.push({
          id: `${tx.id}-${kind}`,
          kind,
          severity,
          title: description,
          detail,
          action,
          transaction: tx,
          date,
          amount,
        });
      };

      if (!Number.isFinite(amount) || amount <= 0) {
        add("valor", "critica", "O valor do lançamento não é positivo ou não é válido.", "Conferir valor e origem do lançamento");
      }
      if ((tx.type === "receita" || tx.type === "despesa") && !tx.category_id) {
        add("categoria", "atencao", "Sem categoria: o registro pode ficar fora de análises por categoria.", "Classificar o lançamento");
      }
      if (tx.type === "despesa" && !tx.expense_nature) {
        add("classificacao", "atencao", "Falta indicar se a despesa é fixa ou variável.", "Informar a classificação");
      }

      // Não presumimos que uma compra no cartão seja um pagamento bancário.
      if (tx.type === "despesa" && tx.account_id && tx.credit_card_id) {
        add("origem", "critica", "A despesa aponta simultaneamente para conta e cartão. Confirme a origem antes de conciliá-la.", "Conferir vínculo de pagamento");
      } else if (tx.type === "despesa" && !tx.account_id && !tx.credit_card_id) {
        add("origem", "critica", "A despesa não está vinculada a nenhuma conta ou cartão.", "Informar origem da despesa");
      } else if (tx.type === "receita" && !tx.account_id) {
        add("origem", "atencao", "Receita sem conta de recebimento identificada.", "Conferir conta de recebimento");
      } else if (tx.type === "transferencia" && !tx.account_id) {
        add("origem", "critica", "Transferência sem conta vinculada.", "Conferir origem ou destino da transferência");
      } else if (tx.account_id && !accountIds.has(tx.account_id)) {
        add("origem", "critica", "A conta associada ao lançamento não está disponível na base consultada.", "Conferir conta vinculada");
      } else if (tx.credit_card_id && !cardIds.has(tx.credit_card_id)) {
        add("origem", "critica", "O cartão associado ao lançamento não está disponível na base consultada.", "Conferir cartão vinculado");
      }

      // Data de liquidação é uma evidência de caixa, não uma competência.
      // Compras no cartão podem estar 'previstas' enquanto pertencem a uma fatura paga posteriormente.
      if (tx.type !== "despesa" || !tx.credit_card_id) {
        if (tx.status === "pago" && !tx.paid_date) {
          add("quitacao", "atencao", "Marcado como pago/recebido, mas sem data efetiva de liquidação.", "Verificar data de pagamento");
        } else if (tx.status !== "pago" && !!tx.paid_date) {
          add("quitacao", "critica", "Possui data de liquidação, porém o status não está como pago/recebido.", "Conferir situação do lançamento");
        }
      }

      if (tx.type === "despesa" && tx.credit_card_id) {
        if (!tx.invoice_id) {
          add("fatura", "atencao", "Compra no cartão sem vínculo com uma fatura identificada.", "Conferir fatura da compra");
        } else {
          const invoice = invoiceById.get(tx.invoice_id);
          if (!invoice) {
            add("fatura", "critica", "A fatura associada à compra não foi encontrada na base consultada.", "Revisar vínculo da fatura");
          } else if (invoice.credit_card_id !== tx.credit_card_id) {
            add("fatura", "critica", "A compra aponta para um cartão diferente do cartão da fatura vinculada.", "Corrigir vínculo cartão/fatura");
          }
        }
      }
      if (tx.installment_group_id &&
        (!tx.installment_number || !tx.installment_total || tx.installment_number > tx.installment_total || tx.installment_number < 1)) {
        add("parcelamento", "critica", "Número ou quantidade de parcelas ausente ou fora do intervalo esperado.", "Conferir parcelas da compra");
      }
    }

    // A comparação exata é apenas uma suspeita: lançamentos legítimos podem compartilhar estes dados.
    // Excluímos eventos técnicos de caixa e parcelas, para não confundir recorrência/parcelamento com duplicação.
    const groups = new Map<string, Transaction[]>();
    for (const tx of active) {
      if (tx.type === "transferencia" || tx.type === "pagamento_fatura" || tx.installment_group_id || tx.recurring_id) continue;
      const key = [tx.type, tx.description.trim().toLocaleLowerCase("pt-BR"), Number(tx.amount).toFixed(2), tx.competence_date, tx.due_date ?? "", tx.account_id ?? "", tx.credit_card_id ?? ""].join("|");
      const group = groups.get(key) ?? [];
      group.push(tx);
      groups.set(key, group);
    }
    for (const [key, group] of groups) {
      if (group.length < 2) continue;
      const first = group[0];
      if (!first) continue;
      result.push({
        id: `duplicidade-${key}`,
        kind: "duplicidade",
        severity: "atencao",
        title: first.description,
        detail: `${group.length} registros têm os mesmos dados principais. Isso não comprova duplicação: compare os lançamentos antes de qualquer exclusão.`,
        action: "Comparar registros semelhantes",
        transaction: first,
        date: first.due_date ?? first.competence_date,
        amount: Number(first.amount) * group.length,
      });
    }
    return result.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || (b.date ?? "").localeCompare(a.date ?? ""));
  }, [transactions, accounts, cards, invoices]);

  const queryReady = !txQuery.isLoading && !catsQuery.isLoading && !accountsQuery.isLoading && !cardsQuery.isLoading && !invoicesQuery.isLoading;
  const hasError = txQuery.isError || catsQuery.isError || accountsQuery.isError || cardsQuery.isError || invoicesQuery.isError;
  const filtered = issues.filter((issue) => {
    if (severity !== ALL && issue.severity !== severity) return false;
    if (kind !== ALL && issue.kind !== kind) return false;
    const text = `${issue.title} ${issue.detail} ${KIND_LABEL[issue.kind]}`.toLocaleLowerCase("pt-BR");
    return text.includes(search.trim().toLocaleLowerCase("pt-BR"));
  });
  const critical = issues.filter((item) => item.severity === "critica").length;
  const attention = issues.filter((item) => item.severity === "atencao").length;

  return (
    <div className="space-y-5">
      <PageHeader title="Qualidade dos registros" subtitle="Revise dados que podem comprometer os resultados; nenhuma correção é feita automaticamente." />
      <section className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Erros críticos" value={queryReady && !hasError ? String(critical) : "—"} icon={AlertCircle} tone="danger" caption="Vínculos e valores que exigem correção" />
        <SummaryCard label="Para revisar" value={queryReady && !hasError ? String(attention) : "—"} icon={AlertTriangle} tone="warning" caption="Pendências e possíveis duplicidades" />
        <SummaryCard label="Itens identificados" value={queryReady && !hasError ? String(issues.length) : "—"} icon={ShieldCheck} tone="default" caption="Ocorrências encontradas nesta consulta" />
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <h2 className="font-semibold">O que está sendo verificado</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Valores, categorias, classificação, vínculos de contas e faturas, status de pagamento, parcelas e possíveis registros repetidos.
              Despesas acima do orçamento não são erros cadastrais: acompanhe esses desvios no Planejamento e na Saúde Financeira.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Esta verificação usa os lançamentos retornados pela consulta atual (limite técnico de 5.000 registros) e não certifica ausência de problemas fora desse conjunto.</p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-3">
        <div className="grid gap-2 md:grid-cols-[1fr_200px_240px]">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar por registro ou problema" />
          </div>
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>Todas as prioridades</SelectItem><SelectItem value="critica">Críticas</SelectItem><SelectItem value="atencao">Para revisar</SelectItem></SelectContent>
          </Select>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>Todos os tipos</SelectItem>{Object.entries(KIND_LABEL).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </section>

      {hasError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">Não foi possível carregar todas as fontes. Não é seguro apresentar uma auditoria parcial; atualize a página e confira a conexão.</div>
      ) : !queryReady ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">Conferindo lançamentos, contas, cartões e faturas...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-6 py-12 text-center">
          <CheckCircle2 className="mx-auto h-9 w-9 text-success" />
          <h2 className="mt-3 font-semibold">Nenhum item corresponde aos filtros</h2>
          <p className="mt-1 text-sm text-muted-foreground">{issues.length ? "Ajuste os filtros para consultar as ocorrências detectadas." : "Nenhum dos problemas verificados foi detectado nos registros carregados."}</p>
        </div>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Registros para análise</h2><span className="text-xs text-muted-foreground">{filtered.length} ocorrência(s)</span></div>
          {filtered.map((issue) => (
            <article key={issue.id} className="rounded-xl border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  {issue.severity === "critica" ? <AlertCircle className="mt-1 h-5 w-5 shrink-0 text-destructive" /> : <CircleHelp className="mt-1 h-5 w-5 shrink-0 text-warning" />}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${issue.severity === "critica" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-warning/30 bg-warning/10 text-warning"}`}>{issue.severity === "critica" ? "Crítico" : "Revisar"}</span>
                      <span className="text-xs text-muted-foreground">{KIND_LABEL[issue.kind]}</span>
                    </div>
                    <h3 className="mt-2 font-semibold">{issue.title}</h3>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{issue.detail}</p>
                    <p className="mt-2 text-sm"><span className="font-medium">Próxima ação:</span> {issue.action}.</p>
                    {issue.transaction?.category_id && <p className="mt-1 text-xs text-muted-foreground">Categoria: {categoryPath(categories, issue.transaction.category_id)}</p>}
                    {issue.transaction?.account_id && <p className="mt-1 text-xs text-muted-foreground">Conta: {accounts.find((item) => item.id === issue.transaction?.account_id)?.name ?? "Não localizada"}</p>}
                    {issue.transaction?.credit_card_id && <p className="mt-1 text-xs text-muted-foreground">Cartão: {cards.find((item) => item.id === issue.transaction?.credit_card_id)?.name ?? "Não localizado"}</p>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-3 sm:flex-col sm:items-end">
                  {issue.amount !== undefined && <span className="font-semibold">{brl(issue.amount)}</span>}
                  <span className="text-xs text-muted-foreground">{issue.date ? formatDateBR(issue.date) : "Sem data"}</span>
                  {issue.transaction && <Button asChild variant="outline" size="sm"><Link to="/lancamentos" search={{ type: "todos", status: "todos", nature: "todos", edit: issue.transaction.id, fromAudit: true }}>Revisar lançamento <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link></Button>}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon, tone, caption }: {
  label: string;
  value: string;
  icon: typeof AlertCircle;
  tone: "default" | "danger" | "warning";
  caption: string;
}) {
  const color = tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-primary";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{label}</p><Icon className={`h-4 w-4 ${color}`} /></div>
      <p className={`mt-2 text-2xl font-semibold ${color}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

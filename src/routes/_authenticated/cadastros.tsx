import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, CreditCard, Settings2, Tags, Users, Wallet } from "lucide-react";
import { PageHeader } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { useAccounts, useCards, useCategories, useMembers } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/cadastros")({
  head: () => ({ meta: [{ title: "Cadastros iniciais — Finanças da Família" }] }),
  component: Cadastros,
});

function Cadastros() {
  const { data: accounts = [] } = useAccounts();
  const { data: cards = [] } = useCards();
  const { data: categories = [] } = useCategories();
  const { data: members = [] } = useMembers();

  const items = [
    {
      title: "Contas",
      description: "Onde o dinheiro da família fica e qual é o saldo inicial.",
      count: accounts.length,
      complete: accounts.some((account) => account.is_active),
      href: "/contas",
      icon: Wallet,
      result: `${accounts.length} conta(s) cadastrada(s)`,
      required: true,
    },
    {
      title: "Cartões",
      description: "Limite, fechamento e vencimento das faturas.",
      count: cards.length,
      complete: cards.length > 0,
      href: "/cartoes",
      icon: CreditCard,
      result: cards.length
        ? `${cards.length} cartão(ões) cadastrado(s)`
        : "Informe se a família não usa cartão",
      required: false,
    },
    {
      title: "Categorias",
      description: "Como receitas, despesas e orçamentos serão organizados.",
      count: categories.length,
      complete: categories.length > 0,
      href: "/configuracoes",
      icon: Tags,
      result: categories.length
        ? `${categories.length} categorias disponíveis`
        : "Plano de categorias pendente",
      required: true,
    },
    {
      title: "Membros e acessos",
      description: "Quem participa da família e pode registrar movimentações.",
      count: members.length,
      complete: members.length > 0,
      href: "/configuracoes",
      icon: Users,
      result: members.length
        ? `${members.length} membro(s) cadastrado(s)`
        : "Cadastre ao menos o responsável",
      required: true,
    },
    {
      title: "Preferências",
      description: "Aparência, segurança e dados gerais da família.",
      count: 1,
      complete: true,
      href: "/configuracoes",
      icon: Settings2,
      result: "Pode ser alterado a qualquer momento",
      required: false,
    },
  ];
  const required = items.filter((item) => item.required);
  const completed = required.filter((item) => item.complete).length;
  const progress = required.length ? Math.round((completed / required.length) * 100) : 0;

  return (
    <div>
      <PageHeader
        title="Cadastros iniciais"
        subtitle="Etapa 1 · Prepare a estrutura da família antes do planejamento"
      />

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">
              {completed} de {required.length} itens essenciais concluídos
            </p>
            <p className="text-sm text-muted-foreground">
              Esta etapa é usada principalmente no primeiro acesso, mas os cadastros continuam
              editáveis.
            </p>
          </div>
          <strong className="text-xl text-primary">{progress}%</strong>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
        </div>
      </section>

      <section className="mt-5 grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <a
            key={item.title}
            href={item.href}
            className={`group rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40 ${
              item.required && !item.complete ? "border-warning/60" : "border-border"
            }`}
          >
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <item.icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold">{item.title}</h2>
                  {item.complete ? (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  ) : (
                    <span className="text-xs font-medium text-warning">Pendente</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                <p className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{item.result}</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </p>
              </div>
            </div>
          </a>
        ))}
      </section>

      <section className="mt-5 flex flex-col items-start justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-semibold">Próxima etapa: planejamento</h2>
          <p className="text-sm text-muted-foreground">
            Defina as receitas previstas, despesas fixas, limites variáveis e dívidas parceladas.
          </p>
        </div>
        <Button asChild>
          <a href="/planejamento">
            Ir para o planejamento <ArrowRight className="h-4 w-4" />
          </a>
        </Button>
      </section>
    </div>
  );
}

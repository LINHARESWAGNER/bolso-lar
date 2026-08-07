import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CalendarDays,
  CreditCard,
  LineChart,
  PiggyBank,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const TITLE = "Finanças da Família — controle, orçamento e cartões";
const DESCRIPTION =
  "Controle o dinheiro da família em um só lugar: contas, lançamentos, cartões de crédito, orçamento mensal, calendário e fluxo de caixa.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
    ],
  }),
  component: Index,
});

const FEATURES = [
  { icon: Wallet, title: "Contas e saldos", text: "Saldo real calculado a partir das movimentações." },
  { icon: CreditCard, title: "Cartões e faturas", text: "Compra vira despesa; pagar a fatura não duplica gasto." },
  { icon: PiggyBank, title: "Orçamento mensal", text: "Orçado, realizado, comprometido e disponível por categoria." },
  { icon: CalendarDays, title: "Calendário", text: "Vencimentos, pagamentos e recebimentos do mês." },
  { icon: LineChart, title: "Fluxo de caixa", text: "Projeção de 30 dias a 12 meses com recorrências e parcelas." },
  { icon: ShieldCheck, title: "Dados isolados", text: "Cada família enxerga apenas os próprios dados." },
];

function Index() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">
          Gestão financeira familiar
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-bold leading-tight text-foreground sm:text-5xl">
          Saiba exatamente quanto a família tem, deve e pode gastar.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted-foreground">{DESCRIPTION}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/auth">Entrar / criar conta</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/dashboard">Ir para o painel</Link>
          </Button>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-card p-5">
              <f.icon className="h-5 w-5 text-primary" />
              <h2 className="mt-3 font-semibold text-card-foreground">{f.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

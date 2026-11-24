import { strict as assert } from "node:assert";
import { variableBudgetSuggestions } from "./planning.ts";
import { test } from "node:test";
import {
  buildFinancialHealth,
  variableBudgetMonitor,
  debtBucket,
  familyInstallmentGroups,
  resolveEssential,
  DEFAULT_HEALTH_SETTINGS,
  type HealthData,
} from "./financial-health.ts";

const categories = [
  { id: "casa", parent_id: null, kind: "despesa", name: "Casa" },
  { id: "ipva", parent_id: "casa", kind: "despesa", name: "IPVA" },
  { id: "lazer", parent_id: "casa", kind: "despesa", name: "Lazer" },
  { id: "terceiros", parent_id: null, kind: "despesa", name: "Compras para terceiros" },
];
const rules = [
  { category_id: "casa", is_essential: true },
  { category_id: "lazer", is_essential: false },
];
test("categoria filha herda a classificação da raiz", () => {
  assert.equal(resolveEssential("ipva", categories, rules), true);
});
test("categoria filha sobrescreve a raiz", () => {
  assert.equal(resolveEssential("lazer", categories, rules), false);
});
test("categoria sem definição própria ou herdada é insuficiente", () => {
  assert.equal(resolveEssential("ipva", categories, []), null);
});
test("tipos de compromissos preservam as quatro separações e exclusões", () => {
  assert.equal(debtBucket("emprestimo"), "financial");
  assert.equal(debtBucket("financiamento"), "financial");
  assert.equal(debtBucket("acordo_renegociacao"), "financial");
  assert.equal(debtBucket("cartao_parcelado"), "purchases");
  assert.equal(debtBucket("compra_parcelada"), "purchases");
  assert.equal(debtBucket("imposto_taxa_parcelada"), "taxes");
  assert.equal(debtBucket("outro_compromisso"), "other");
  assert.equal(debtBucket("nao_considerar"), null);
  assert.equal(debtBucket("nao_divida"), null);
});

const tx = (id: string, type: string, amount: number, extras: Record<string, unknown> = {}) => ({
  id,
  type,
  amount,
  category_id: "casa",
  status: "pago",
  competence_date: "2026-10-12",
  paid_date: "2026-10-12",
  due_date: "2026-10-12",
  description: id,
  installment_group_id: null,
  credit_card_id: null,
  invoice_id: null,
  expense_nature: "fixo",
  ...extras,
});
const group = (id: string, card = false) => ({
  id,
  credit_card_id: card ? "card-1" : null,
  deleted_at: null,
  description: id,
});
function exampleData(): HealthData {
  return {
    categories: categories as HealthData["categories"],
    essentials: rules,
    cards: [],
    invoices: [],
    assets: [],
    movements: [],
    budgets: [],
    groups: [
      group("loan"),
      group("purchase"),
      group("tax"),
      group("other"),
      group("excluded"),
      group("card", true),
    ] as HealthData["groups"],
    debtKinds: [
      { installment_group_id: "loan", debt_kind: "emprestimo" },
      { installment_group_id: "purchase", debt_kind: "compra_parcelada" },
      { installment_group_id: "tax", debt_kind: "imposto_taxa_parcelada" },
      { installment_group_id: "other", debt_kind: "outro_compromisso" },
      { installment_group_id: "excluded", debt_kind: "nao_considerar" },
    ],
    transactions: [
      tx("renda", "receita", 2000),
      tx("loan-installment", "despesa", 100, { installment_group_id: "loan" }),
      tx("purchase-installment", "despesa", 80, { installment_group_id: "purchase" }),
      tx("tax-installment", "despesa", 60, { installment_group_id: "tax", category_id: "ipva" }),
      tx("other-installment", "despesa", 40, { installment_group_id: "other" }),
      tx("excluded-installment", "despesa", 500, { installment_group_id: "excluded" }),
      tx("card-installment", "despesa", 70, {
        installment_group_id: "card",
        credit_card_id: "card-1",
      }),
      tx("invoice-payment", "pagamento_fatura", 70),
      tx("transfer", "transferencia", 100),
      tx("third-party", "despesa", 300, {
        category_id: "terceiros",
        installment_group_id: "card",
        credit_card_id: "card-1",
      }),
    ] as HealthData["transactions"],
  };
}
test("dívidas/parcelas: grupos separados, sem fatura, transferências, terceiros ou nao_considerar", () => {
  const metric = buildFinancialHealth(
    exampleData(),
    DEFAULT_HEALTH_SETTINGS,
    { start: "2026-10-01", end: "2026-10-31", months: 1 },
    "2026-11-05",
  ).find((m) => m.id === "debt")!;
  assert.equal(metric.numerator, 350);
  assert.equal(metric.denominator, 2000);
  assert.equal(metric.value, 17.5);
  assert.deepEqual(
    metric.debtBreakdown?.map((item) => item.total),
    [100, 150, 60, 40],
  );
  assert.equal(metric.lines.length, 5);
});
test("classificação essencial filha não inclui terceiros e suporta sobrescrita", () => {
  const metric = buildFinancialHealth(
    exampleData(),
    DEFAULT_HEALTH_SETTINGS,
    { start: "2026-10-01", end: "2026-10-31", months: 1 },
    "2026-11-05",
  ).find((m) => m.id === "essential")!;
  assert.equal(metric.numerator, 850); // despesas normais (inclusive nao_considerar dívida) não são excluídas de essenciais
  assert.equal(
    metric.lines.some((line) => line.description === "third-party"),
    false,
  );
});

test("parcelamento exclusivamente de terceiros não aparece para classificação", () => {
  const data = exampleData();
  const extraGroup = group("only-third", true);
  const transactions = [
    ...data.transactions,
    tx("third-only-1", "despesa", 250, {
      category_id: "terceiros",
      installment_group_id: "only-third",
      credit_card_id: "card-1",
    }),
    tx("third-only-2", "despesa", 250, {
      category_id: "terceiros",
      installment_group_id: "only-third",
      credit_card_id: "card-1",
    }),
  ] as HealthData["transactions"];
  const visible = familyInstallmentGroups(
    [...data.groups, extraGroup as HealthData["groups"][number]],
    transactions,
    data.categories,
  );
  assert.equal(
    visible.some((g) => g.id === "only-third"),
    false,
  );
  assert.equal(
    visible.some((g) => g.id === "card"),
    true,
  ); // grupo misto: manter parcela familiar
  const results = buildFinancialHealth(
    { ...data, transactions, groups: [...data.groups, extraGroup as HealthData["groups"][number]] },
    DEFAULT_HEALTH_SETTINGS,
    { start: "2026-10-01", end: "2026-10-31", months: 1 },
    "2026-11-05",
  );
  assert.equal(results.find((m) => m.id === "debt")?.numerator, 350);
  assert.equal(
    results.find((m) => m.id === "budget")?.lines.some((l) => l.id === "third-only-1"),
    false,
  );
  assert.equal(
    results.find((m) => m.id === "cards")?.lines.some((l) => l.id === "third-only-1"),
    false,
  );
  assert.equal(
    results.find((m) => m.id === "debt")?.lines.some((l) => l.id === "third-only-1"),
    false,
  );
});

test("grupo apenas de terceiros não exige classificação de dívida", () => {
  const data = exampleData();
  const exclusive = group("third-unclassified");
  const dataWithThirdParty = {
    ...data,
    groups: [...data.groups, exclusive as HealthData["groups"][number]],
    transactions: [
      ...data.transactions,
      tx("third-debt", "despesa", 100, {
        category_id: "terceiros",
        installment_group_id: "third-unclassified",
      }),
    ] as HealthData["transactions"],
  };
  const results = buildFinancialHealth(
    dataWithThirdParty,
    DEFAULT_HEALTH_SETTINGS,
    { start: "2026-10-01", end: "2026-10-31", months: 1 },
    "2026-11-05",
  );
  const original = buildFinancialHealth(
    data,
    DEFAULT_HEALTH_SETTINGS,
    { start: "2026-10-01", end: "2026-10-31", months: 1 },
    "2026-11-05",
  );
  assert.equal(
    results.find((m) => m.id === "debt")?.status,
    original.find((m) => m.id === "debt")?.status,
  );
});

test("aderência avalia apenas despesas variáveis no mês fechado, sem punir economia", () => {
  const data = exampleData();
  data.budgets = [
    {
      reference_month: "2026-10-01",
      budget_items: [{ id: "limit", category_id: "casa", amount: 500 }],
    },
  ] as HealthData["budgets"];
  data.transactions = [
    tx("salario", "receita", 2000),
    tx("fixa", "despesa", 1000),
    tx("variavel-paga", "despesa", 200, { expense_nature: "variavel" }),
    tx("variavel-pendente", "despesa", 100, { expense_nature: "variavel", status: "previsto" }),
    tx("terceiro", "despesa", 900, { expense_nature: "variavel", category_id: "terceiros" }),
    tx("fatura", "pagamento_fatura", 200),
  ] as HealthData["transactions"];
  const metric = buildFinancialHealth(
    data,
    DEFAULT_HEALTH_SETTINGS,
    { start: "2026-10-01", end: "2026-10-31", months: 1 },
    "2026-11-05",
  )[0];
  assert.equal(metric.numerator, 300);
  assert.equal(metric.denominator, 500);
  assert.equal(metric.value, -40);
  assert.equal(metric.status, "saudavel");
});

test("aderência do mês aberto é inconclusiva independentemente do gasto inicial", () => {
  const data = exampleData();
  data.budgets = [
    {
      reference_month: "2026-10-01",
      budget_items: [{ id: "limit", category_id: "casa", amount: 500 }],
    },
  ] as HealthData["budgets"];
  const metric = buildFinancialHealth(
    data,
    DEFAULT_HEALTH_SETTINGS,
    { start: "2026-10-01", end: "2026-10-31", months: 1 },
    "2026-10-15",
  )[0];
  assert.equal(metric.value, null);
  assert.equal(metric.status, "insuficiente");
});

test("monitor do mês não duplica fatura nem terceiros e separa pendente de pago", () => {
  const data = exampleData();
  data.budgets = [
    {
      reference_month: "2026-10-01",
      budget_items: [{ id: "1", category_id: "casa", amount: 500 }],
    },
  ] as HealthData["budgets"];
  data.transactions = [
    tx("paga", "despesa", 120, { expense_nature: "variavel" }),
    tx("pendente", "despesa", 80, { expense_nature: "variavel", status: "previsto" }),
    tx("terceiro", "despesa", 500, { expense_nature: "variavel", category_id: "terceiros" }),
    tx("fatura", "pagamento_fatura", 120),
  ] as HealthData["transactions"];
  const result = variableBudgetMonitor(
    data,
    { start: "2026-10-01", end: "2026-10-31", months: 1 },
    "2026-10-15",
  );
  assert.equal(result.realized, 120);
  assert.equal(result.committed, 80);
  assert.equal(result.remaining, 300);
});

// Regressão: a compra no cartão consome o orçamento na competência,
// mesmo quando o status da compra permanece previsto após o pagamento da fatura.
test("orçamento fechado inclui despesas variáveis pagas e previstas sem duplicar cartão, fatura ou terceiros", () => {
  const data = exampleData();
  data.budgets = [
    {
      reference_month: "2026-10-01",
      budget_items: [{ id: "limite", category_id: "casa", amount: 2500 }],
    },
  ] as HealthData["budgets"];
  data.transactions = [
    tx("supermercado-conta", "despesa", 1205.93, { expense_nature: "variavel" }),
    tx("supermercado-cartao", "despesa", 790.49, {
      expense_nature: "variavel",
      status: "previsto",
      paid_date: null,
      credit_card_id: "card-1",
      invoice_id: "invoice-1",
    }),
    tx("conta-nao-paga", "despesa", 150, {
      expense_nature: "variavel",
      status: "previsto",
      paid_date: null,
    }),
    tx("compra-terceiro", "despesa", 300, {
      expense_nature: "variavel",
      status: "previsto",
      paid_date: null,
      credit_card_id: "card-1",
      category_id: "terceiros",
    }),
    tx("fatura-paga", "pagamento_fatura", 790.49),
    tx("transferencia", "transferencia", 50),
    tx("cancelada", "despesa", 100, {
      expense_nature: "variavel",
      credit_card_id: "card-1",
      status: "cancelado",
    }),
  ] as HealthData["transactions"];
  const budget = buildFinancialHealth(
    data,
    DEFAULT_HEALTH_SETTINGS,
    { start: "2026-10-01", end: "2026-10-31", months: 1 },
    "2026-11-05",
  )[0];
  assert.equal(budget.numerator, 2146.42);
  assert.deepEqual(
    budget.lines.map((line) => line.id),
    ["supermercado-conta", "supermercado-cartao", "conta-nao-paga"],
  );
});

test("aderência variável: pago + previsto, competência, exclusões e percentual de outubro", () => {
  const data = exampleData();
  data.budgets = [
    {
      reference_month: "2026-10-01",
      budget_items: [{ id: "limite-outubro", category_id: "casa", amount: 3500 }],
    },
  ] as HealthData["budgets"];
  data.transactions = [
    tx("pagos", "despesa", 3283.19, { expense_nature: "variavel", status: "pago" }),
    tx("previstos", "despesa", 2000, {
      expense_nature: "variavel",
      status: "previsto",
      paid_date: null,
    }),
    tx("parcela-cartao", "despesa", 633.42, {
      expense_nature: "variavel",
      status: "previsto",
      paid_date: null,
      credit_card_id: "card-1",
      invoice_id: "invoice-1",
      installment_group_id: "card",
    }),
    tx("pagamento-fatura", "pagamento_fatura", 633.42, { expense_nature: "variavel" }),
    tx("transferencia", "transferencia", 180, { expense_nature: "variavel" }),
    tx("cancelado", "despesa", 120, { expense_nature: "variavel", status: "cancelado" }),
    tx("terceiro", "despesa", 250, {
      expense_nature: "variavel",
      category_id: "terceiros",
      credit_card_id: "card-1",
    }),
    tx("fixa", "despesa", 900, { expense_nature: "fixo" }),
    tx("receita", "receita", 1000, { expense_nature: "variavel" }),
    tx("fora-do-mes", "despesa", 400, {
      expense_nature: "variavel",
      competence_date: "2026-11-01",
    }),
  ] as HealthData["transactions"];
  const metric = buildFinancialHealth(
    data,
    DEFAULT_HEALTH_SETTINGS,
    { start: "2026-10-01", end: "2026-10-31", months: 1 },
    "2026-11-08",
  ).find((item) => item.id === "budget")!;
  assert.equal(Number(metric.numerator?.toFixed(2)), 5916.61);
  assert.equal(metric.denominator, 3500);
  assert.ok(Math.abs(metric.value! - 69.046) < 0.001);
  assert.equal(metric.status, "critico");
  assert.deepEqual(
    metric.lines.map((line) => line.id),
    ["pagos", "previstos", "parcela-cartao"],
  );
  assert.match(metric.formula, /registrada/);
  assert.match(metric.note, /pagas e previstas/);
});

test("monitor distingue compra já feita no cartão de compromissos futuros", () => {
  const data = exampleData();
  data.budgets = [
    {
      reference_month: "2026-11-01",
      budget_items: [{ id: "limite", category_id: "casa", amount: 2000 }],
    },
  ] as HealthData["budgets"];
  data.transactions = [
    tx("cartao-ja-comprado", "despesa", 100, {
      competence_date: "2026-11-02",
      credit_card_id: "card-1",
      expense_nature: "variavel",
      status: "previsto",
      paid_date: null,
    }),
    tx("cartao-futuro", "despesa", 200, {
      competence_date: "2026-11-20",
      credit_card_id: "card-1",
      expense_nature: "variavel",
      status: "previsto",
      paid_date: null,
    }),
    tx("conta-pendente", "despesa", 50, {
      competence_date: "2026-11-02",
      expense_nature: "variavel",
      status: "previsto",
      paid_date: null,
    }),
    tx("conta-paga", "despesa", 80, {
      competence_date: "2026-11-02",
      paid_date: "2026-11-03",
      expense_nature: "variavel",
    }),
    tx("fatura", "pagamento_fatura", 100),
  ] as HealthData["transactions"];
  const result = variableBudgetMonitor(
    data,
    { start: "2026-11-01", end: "2026-11-30", months: 1 },
    "2026-11-05",
  );
  assert.equal(result.realized, 180);
  assert.equal(result.committed, 250);
  assert.equal(result.remaining, 1570);
});

test("histórico do Planejamento inclui despesas variáveis pagas e previstas", () => {
  const list = [
    tx("agosto", "despesa", 100, { competence_date: "2026-08-10", expense_nature: "variavel" }),
    tx("setembro", "despesa", 200, { competence_date: "2026-09-10", expense_nature: "variavel" }),
    tx("outubro-conta", "despesa", 1205.93, { expense_nature: "variavel" }),
    tx("outubro-cartao", "despesa", 790.49, {
      expense_nature: "variavel",
      status: "previsto",
      credit_card_id: "card-1",
      paid_date: null,
    }),
    tx("outubro-pendente", "despesa", 300, {
      expense_nature: "variavel",
      status: "previsto",
      paid_date: null,
    }),
  ];
  const result = variableBudgetSuggestions(list, categories, 2026, 11);
  assert.equal(result.hasEnoughHistory, true);
  assert.equal(result.rootMonths.get("casa")?.[2], 2296.42);
});

test("essenciais do mês fechado: renda e despesas pagas ou previstas pela competência", () => {
  const data = exampleData();
  data.transactions = [
    tx("renda-paga", "receita", 3000, { paid_date: "2026-11-02" }),
    tx("renda-prevista", "receita", 1000, { status: "previsto", paid_date: null }),
    tx("essencial-pago", "despesa", 800, { paid_date: "2026-11-02" }),
    tx("essencial-previsto", "despesa", 400, { status: "previsto", paid_date: null }),
    tx("cartao", "despesa", 200, { status: "previsto", credit_card_id: "card-1", paid_date: null }),
    tx("fatura", "pagamento_fatura", 200),
    tx("terceiros", "despesa", 500, { category_id: "terceiros" }),
    tx("transferencia", "transferencia", 500),
    tx("cancelada", "despesa", 500, { status: "cancelado" }),
    tx("lazer", "despesa", 600, { category_id: "lazer", status: "previsto" }),
    tx("outra-competencia", "despesa", 999, { competence_date: "2026-11-05" }),
    tx("renda-outra-competencia", "receita", 999, { competence_date: "2026-11-05" }),
  ] as HealthData["transactions"];
  const metric = buildFinancialHealth(
    data,
    DEFAULT_HEALTH_SETTINGS,
    { start: "2026-10-01", end: "2026-10-31", months: 1 },
    "2026-11-10",
  ).find((m) => m.id === "essential")!;
  assert.equal(metric.numerator, 1400);
  assert.equal(metric.denominator, 4000);
  assert.equal(metric.value, 35);
  assert.equal(metric.status, "saudavel");
  assert.deepEqual(
    metric.lines.map((line) => line.id),
    ["essencial-pago", "essencial-previsto", "cartao"],
  );
  assert.deepEqual(
    metric.denominatorLines?.map((line) => line.id),
    ["renda-paga", "renda-prevista"],
  );
});

test("essenciais: configuração filha prevalece e categoria indefinida sinaliza dados insuficientes", () => {
  const data = exampleData();
  data.transactions = [
    tx("renda", "receita", 1000),
    tx("lazer", "despesa", 200, { category_id: "lazer", status: "previsto" }),
    tx("ipva", "despesa", 150, { category_id: "ipva", status: "previsto" }),
  ] as HealthData["transactions"];
  const month = { start: "2026-10-01", end: "2026-10-31", months: 1 };
  assert.equal(
    buildFinancialHealth(data, DEFAULT_HEALTH_SETTINGS, month, "2026-11-10").find(
      (m) => m.id === "essential",
    )?.numerator,
    150,
  );
  data.essentials = [];
  assert.equal(
    buildFinancialHealth(data, DEFAULT_HEALTH_SETTINGS, month, "2026-11-10").find(
      (m) => m.id === "essential",
    )?.status,
    "insuficiente",
  );
});

test("essenciais: sem receita registrada não divide por zero", () => {
  const data = exampleData();
  data.transactions = [
    tx("gasto", "despesa", 400, { status: "previsto" }),
  ] as HealthData["transactions"];
  const metric = buildFinancialHealth(
    data,
    DEFAULT_HEALTH_SETTINGS,
    { start: "2026-10-01", end: "2026-10-31", months: 1 },
    "2026-11-10",
  ).find((m) => m.id === "essential")!;
  assert.equal(metric.numerator, 400);
  assert.equal(metric.denominator, 0);
  assert.equal(metric.value, null);
  assert.equal(metric.status, "insuficiente");
});

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildBudgetDIKW } from "./budget-dikw.ts";
import { buildBudgetForecast } from "./budget-forecast.ts";
import { DEFAULT_HEALTH_SETTINGS, type HealthData, type HealthPeriod } from "./financial-health.ts";

const period = (month: string): HealthPeriod => {
  const [y, m] = month.split("-").map(Number);
  return { start: `${month}-01`, end: `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`, months: 1 };
};
const base = (): HealthData => ({
  categories: [
    { id: "transporte", name: "Transporte", parent_id: null, kind: "despesa" },
    { id: "fuel", name: "Combustível", parent_id: "transporte", kind: "despesa" },
    { id: "reparo", name: "Conserto eventual", parent_id: "transporte", kind: "despesa" },
    { id: "alimentacao", name: "Alimentação", parent_id: null, kind: "despesa" },
    { id: "terceiros", name: "Compra para terceiros", parent_id: null, kind: "despesa" },
  ] as HealthData["categories"],
  transactions: [], budgets: [], cards: [], invoices: [], assets: [], movements: [], groups: [], essentials: [], debtKinds: [],
});
function add(d: HealthData, id: string, date: string, amount: number, category = "fuel", extra = {}) {
  d.transactions.push({
    id, description: id, competence_date: date, amount, category_id: category,
    status: "previsto", type: "despesa", expense_nature: "variavel",
    credit_card_id: "card", recurring_id: null, ...extra,
  } as HealthData["transactions"][number]);
}
function budget(d: HealthData, m: string, total: number) {
  d.budgets.push({ reference_month: `${m}-01`, budget_items: [{ id: m, category_id: "transporte", amount: total }] } as HealthData["budgets"][number]);
}
function historicalFuel(d: HealthData) {
  for (const m of ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]) {
    budget(d, m, 900);
    for (const day of [2, 9, 16, 23]) add(d, `fuel-${m}-${day}`, `${m}-${String(day).padStart(2, "0")}`, 100);
  }
  budget(d, "2026-11", 900);
}
const report = (d: HealthData) => buildBudgetDIKW(d, DEFAULT_HEALTH_SETTINGS, period("2026-10"), period("2026-11"), "2026-11-08");

test("combustível com rotina semanal e tíquete mais alto é projetado além do dia 8", () => {
  const d = base();
  historicalFuel(d);
  add(d, "abastecimento-1", "2026-11-01", 180);
  add(d, "abastecimento-2", "2026-11-08", 180);
  const result = buildBudgetForecast(d, report(d), "2026-11-08");
  const fuel = result.rhythms.find((r) => r.id === "fuel")!;
  assert.equal(fuel.kind, "recorrente");
  assert.equal(fuel.intervalDays, 7);
  assert.equal(fuel.expectedOccurrences, 3);
  assert.equal(fuel.estimatedTicket, 148);
  assert.equal(fuel.projectedAdditional, 444);
  assert.equal(result.projected, 804);
  assert.match(fuel.description, /intervalo típico de 7 dias/);
});

test("compra futura já cadastrada não é extrapolada de novo", () => {
  const d = base();
  historicalFuel(d);
  add(d, "abastecimento-1", "2026-11-01", 180);
  add(d, "abastecimento-2", "2026-11-08", 180);
  add(d, "futuro", "2026-11-15", 170);
  const result = buildBudgetForecast(d, report(d), "2026-11-08");
  const fuel = result.rhythms.find((r) => r.id === "fuel")!;
  assert.equal(fuel.expectedOccurrences, 2);
  assert.equal(fuel.alreadyScheduled, 170);
  assert.equal(result.projected, 826);
});

test("gasto pontual informado pelo usuário sai da projeção, não do registrado", () => {
  const d = base();
  historicalFuel(d);
  add(d, "abastecimento-1", "2026-11-01", 180);
  add(d, "abastecimento-2", "2026-11-08", 180);
  const result = buildBudgetForecast(d, report(d), "2026-11-08", { fuel: "pontual" });
  assert.equal(result.projected, 360);
  assert.equal(result.rhythms.find((r) => r.id === "fuel")?.kind, "pontual");
});

test("gastos sem regularidade não recebem projeção fictícia", () => {
  const d = base();
  budget(d, "2026-11", 500);
  add(d, "conserto", "2026-11-03", 300, "reparo");
  const result = buildBudgetForecast(d, report(d), "2026-11-08");
  assert.equal(result.additional, 0);
  assert.equal(result.confidence, "insuficiente");
  assert.equal(result.projected, 300);
});

test("transferências, faturas e terceiros não entram nem na projeção", () => {
  const d = base();
  historicalFuel(d);
  add(d, "abastecimento-1", "2026-11-01", 180);
  add(d, "abastecimento-2", "2026-11-08", 180);
  add(d, "terceiro", "2026-11-08", 9999, "terceiros");
  add(d, "fatura", "2026-11-08", 9999, "fuel", { type: "pagamento_fatura" });
  add(d, "transferencia", "2026-11-08", 9999, "fuel", { type: "transferencia" });
  add(d, "cancelado", "2026-11-08", 9999, "fuel", { status: "cancelado" });
  const result = buildBudgetForecast(d, report(d), "2026-11-08");
  assert.equal(result.registered, 360);
  assert.equal(result.projected, 804);
});

test("comparações identificam gasto maior que a média histórica sem duplicar meses", () => {
  const d = base();
  historicalFuel(d);
  const computed = report(d);
  const result = buildBudgetForecast(d, computed, "2026-11-08");
  const transport = result.comparisons.find((c) => c.id === "transporte")!;
  assert.equal(transport.previous, 400);
  assert.equal(transport.averageThree, 400);
  assert.equal(transport.changeAverage, 0);
});


test("parcelas encerradas nao geram novas compras", () => {
  const d = base();
  budget(d, "2026-11", 900);

  const months = [
    "2026-05", "2026-06", "2026-07",
    "2026-08", "2026-09", "2026-10"
  ];

  months.forEach((m, index) => {
    add(d, `moveis-${m}`, `${m}-25`, 300, "reparo", {
      installment_group_id: "moveis-encerrado",
      installment_number: index + 1,
      installment_total: 6,
    });
  });

  const result = buildBudgetForecast(
    d, report(d), "2026-11-19"
  );

  assert.equal(result.registered, 0);
  assert.equal(result.additional, 0);
  assert.equal(result.projected, 0);
});

test("parcela ativa permanece registrada sem extrapolacao", () => {
  const d = base();
  budget(d, "2026-11", 199.24);

  for (const m of [
    "2026-05", "2026-06", "2026-07",
    "2026-08", "2026-09", "2026-10"
  ]) {
    add(d, `antigo-${m}`, `${m}-25`, 300, "reparo", {
      installment_group_id: "encerrado",
      installment_total: 6,
    });
  }

  add(d, "parcela-atual", "2026-11-11", 199.24, "reparo", {
    installment_group_id: "ativo",
    installment_total: 12,
  });

  const result = buildBudgetForecast(
    d, report(d), "2026-11-19"
  );

  assert.equal(result.registered, 199.24);
  assert.equal(result.additional, 0);
  assert.equal(result.projected, 199.24);
});

test("parcela futura fica no registrado apenas uma vez", () => {
  const d = base();
  budget(d, "2026-11", 900);

  add(d, "parcela-futura", "2026-11-25", 199.24, "reparo", {
    installment_group_id: "ativo",
    installment_total: 12,
  });

  const result = buildBudgetForecast(
    d, report(d), "2026-11-19"
  );

  assert.equal(result.registered, 199.24);
  assert.equal(result.additional, 0);
  assert.equal(result.projected, 199.24);
});

test("rotina real continua prevista mesmo com parcelas na categoria", () => {
  const d = base();
  historicalFuel(d);

  add(d, "abastecimento-1", "2026-11-01", 180);
  add(d, "abastecimento-2", "2026-11-08", 180);

  for (const m of [
    "2026-05", "2026-06", "2026-07",
    "2026-08", "2026-09", "2026-10"
  ]) {
    add(d, `parcelado-${m}`, `${m}-09`, 500, "fuel", {
      installment_group_id: "encerrado",
      installment_total: 6,
    });
  }

  add(d, "parcela-futura", "2026-11-15", 200, "fuel", {
    installment_group_id: "ativo",
    installment_total: 12,
  });

  const result = buildBudgetForecast(
    d, report(d), "2026-11-08"
  );

  const fuel = result.rhythms.find(r => r.id === "fuel")!;

  assert.equal(fuel.intervalDays, 7);
  assert.equal(fuel.estimatedTicket, 148);
  assert.equal(fuel.projectedAdditional, 444);

  assert.equal(result.registered, 560);
  assert.equal(result.additional, 444);
  assert.equal(result.projected, 1004);
});
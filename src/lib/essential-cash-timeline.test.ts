import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildEssentialCashTimeline } from "./essential-cash-timeline";
import type { Tables } from "./finance";

const category = {
  id: "cat",
  name: "Financiamento",
  parent_id: null,
} as Tables["categories"]["Row"];
const rule = {
  category_id: "cat",
  is_essential: true,
} as Tables["financial_health_essential_categories"]["Row"];
const recurring = (
  id: string,
  amount: number,
  start_date: string,
  end_date: string | null,
  predecessor_recurrence_id: string | null = null,
) =>
  ({
    id,
    family_id: "family",
    description: id,
    category_id: "cat",
    is_active: true,
    type: "despesa",
    frequency: "mensal",
    amount,
    start_date,
    end_date,
    predecessor_recurrence_id,
    occurrences: null,
  }) as Tables["recurring_transactions"]["Row"];
const parcel = (month: string, number: number, total: number) =>
  ({
    id: `p-${number}`,
    type: "despesa",
    category_id: "cat",
    installment_group_id: "group",
    installment_number: number,
    installment_total: total,
    amount: 1898.18,
    description: "Consignado",
    status: "previsto",
    recurring_id: null,
    deleted_at: null,
    competence_date: `${month}-10`,
  }) as Tables["transactions"]["Row"];
const group = {
  id: "group",
  description: "Consignado",
  installments: 24,
} as Tables["installment_groups"]["Row"];
const make = (
  recurrences: Tables["recurring_transactions"]["Row"][] = [],
  transactions: Tables["transactions"]["Row"][] = [],
) =>
  buildEssentialCashTimeline({
    today: "2026-11-11",
    categories: [category],
    essentials: [rule],
    recurrences,
    transactions,
    groups: transactions.length ? [group] : [],
  });

test("consignado com parcela 24/24 em julho reduz a partir de agosto e aparece no marco setembro", () => {
  const m = make([], [parcel("2027-07", 24, 24)]);
  assert.equal(m[3]?.month, "2027-09");
  assert.equal(m[3]?.delta, -1898.18);
  assert.equal(m[2]?.delta, 0);
});

test("recorrência com fim em julho reduz em agosto, sem precisar descrição N/N", () => {
  const m = make([recurring("consignado", 950, "2026-01-10", "2027-07-10")]);
  assert.equal(m[3]?.delta, -950);
  assert.equal(m[3]?.events[0]?.effectiveMonth, "2027-08");
});

test("prestação reduzida com continuação explícita compensa no mês de troca", () => {
  const m = buildEssentialCashTimeline({
    today: "2027-07-11",
    categories: [category],
    essentials: [rule],
    recurrences: [
      recurring("reduzida", 239.61, "2026-09-15", "2027-09-15"),
      recurring("normal", 1200, "2027-10-15", "2027-12-31", "reduzida"),
    ],
    transactions: [],
    groups: [],
  });
  assert.equal(m[0]?.month, "2027-08");
  assert.equal(m[1]?.month, "2027-11");
  assert.equal(m[1]?.delta, 960.39);
  assert.equal(m[1]?.events.length, 2);
});

test("recorrência sem fim informado não gera encerramento", () => {
  const m = make([recurring("indefinida", 200, "2026-01-10", null)]);
  assert.ok(m.every((x) => x.events.length === 0));
});

test("recorrência não essencial não entra no cálculo", () => {
  const m = buildEssentialCashTimeline({
    today: "2026-11-11",
    categories: [category],
    essentials: [],
    recurrences: [recurring("consignado", 300, "2026-01-10", "2027-07-10")],
    transactions: [],
    groups: [],
  });
  assert.ok(m.every((x) => x.events.length === 0));
});

test("última parcela estruturada só é computada uma vez por grupo", () => {
  const m = make(
    [],
    [parcel("2027-07", 24, 24), { ...parcel("2027-07", 24, 24), id: "duplicado" }],
  );
  assert.equal(m[3]?.delta, -1898.18);
});

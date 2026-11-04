import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  annualPlanningRows,
  variableBudgetSuggestions,
  type PlanningTransaction,
} from "./planning.ts";

const transaction = (values: Partial<PlanningTransaction>): PlanningTransaction => ({
  amount: 0,
  category_id: null,
  competence_date: "2026-01-01",
  expense_nature: null,
  installment_group_id: null,
  status: "pendente",
  type: "despesa",
  ...values,
});

test("sugere a média da categoria somente após três meses com histórico", () => {
  const rows = [
    transaction({
      competence_date: "2026-01-10",
      category_id: "alimentacao",
      amount: 900,
      expense_nature: "variavel",
    }),
    transaction({
      competence_date: "2026-02-10",
      category_id: "alimentacao",
      amount: 1200,
      expense_nature: "variavel",
    }),
    transaction({
      competence_date: "2026-03-10",
      category_id: "alimentacao",
      amount: 1500,
      expense_nature: "variavel",
    }),
  ];
  const result = variableBudgetSuggestions(rows, 2026, 4);
  assert.equal(result.hasEnoughHistory, true);
  assert.equal(result.suggestions.get("alimentacao"), 1200);
});

test("separa despesas fixas, variáveis e parceladas no ano", () => {
  const rows = annualPlanningRows(
    [
      transaction({ type: "receita", amount: 10000 }),
      transaction({ expense_nature: "fixo", amount: 3000 }),
      transaction({ expense_nature: "fixo", installment_group_id: "divida", amount: 1000 }),
    ],
    [
      {
        reference_month: "2026-01-01",
        budget_items: [{ category_id: "alimentacao", amount: 2000 }],
      },
    ],
    [],
    2026,
  );
  assert.deepEqual(
    {
      income: rows[0].income,
      fixed: rows[0].fixed,
      variable: rows[0].variable,
      installments: rows[0].installments,
      plannedResult: rows[0].plannedResult,
    },
    { income: 10000, fixed: 3000, variable: 2000, installments: 1000, plannedResult: 4000 },
  );
});

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { projectPortfolio, plannedContribution, type Plan } from "./portfolio-projection.ts";
const asset: Plan = {
  id: "a",
  name: "CDB XP",
  current_balance: 0,
  initial_balance: 0,
  plan_start_date: "2026-01-01",
  plan_end_date: "2027-12-31",
  annual_rate: 12,
  monthly_contribution: 1000,
  contribution_frequency: "mensal",
  reinvest_earnings: true,
};
test("contribution frequencies respect start and end, including year boundaries", () => {
  for (const [frequency, expected] of [
    ["unico", [0]],
    ["mensal", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
    ["semestral", [0, 6, 12]],
    ["anual", [0, 12]],
  ] as const) {
    const p = { ...asset, contribution_frequency: frequency };
    for (let i = 0; i <= 12; i++) {
      const key = i === 12 ? "2027-01" : `2026-${String(i + 1).padStart(2, "0")}`;
      assert.equal(
        plannedContribution(p, key),
        (expected as readonly number[]).includes(i) ? 1000 : 0,
      );
    }
    assert.equal(plannedContribution(p, "2025-12"), 0);
    assert.equal(plannedContribution(p, "2028-01"), 0);
  }
});
test("portfolio equals individual plans with different rates and reinvestment", () => {
  const b = {
    ...asset,
    id: "b",
    annual_rate: 6,
    reinvest_earnings: false,
    contribution_frequency: "anual",
  };
  const all = projectPortfolio([asset, b], [], 1e6, "2026-09");
  const aOnly = projectPortfolio([asset], [], 1e6, "2026-09"),
    bOnly = projectPortfolio([b], [], 1e6, "2026-09");
  all.points.forEach((p, i) =>
    assert.ok(Math.abs(p.previsto - aOnly.points[i]!.previsto - bOnly.points[i]!.previsto) < 1e-6),
  );
  assert.equal(bOnly.points[11]!.previsto, 1000);
  assert.ok(bOnly.points[11]!.distribuidos > 0);
});
test("end date freezes forecast without simulating a withdrawal", () => {
  const result = projectPortfolio([{ ...asset, plan_end_date: "2026-03-31" }], [], 1e6, "2026-09");
  assert.equal(result.points[2]!.previsto, result.points[12]!.previsto);
  assert.equal(result.points[12]!.saque, 0);
});
test("manual ledger alone determines actual, paid-out dividends count once as returns", () => {
  const operations = [
    { investment_id: "a", movement_date: "2026-01-01", type: "aporte", amount: 3000 },
    { investment_id: "a", movement_date: "2026-01-31", type: "dividendo_reaplicado", amount: 30 },
    { investment_id: "a", movement_date: "2026-01-31", type: "dividendo", amount: 20 },
    { investment_id: "a", movement_date: "2026-02-01", type: "resgate", amount: 1000 },
  ];
  const result = projectPortfolio([asset], operations, 1e6, "2026-02");
  assert.equal(result.balance, 2030);
  assert.equal(result.earnings, 50);
  assert.equal(result.contributed, 3000);
  assert.equal(result.withdrawn, 1000);
  assert.equal(result.rows[0]!.planned, 1000);
  assert.equal(result.rows[0]!.actual, 3000);
  assert.equal(result.actualReturn, (50 / 2500) * 100);
  assert.equal(projectPortfolio([asset], [], 1e6, "2026-02").actualReturn, null);
});
test("signed legacy corrections preserve balance and do not count as earnings", () => {
  const result = projectPortfolio(
    [asset],
    [
      { investment_id: "a", movement_date: "2026-01-01", type: "aporte", amount: 3500 },
      { investment_id: "a", movement_date: "2026-01-01", type: "ajuste", amount: -500 },
    ],
    1e6,
    "2026-01",
  );
  assert.equal(result.balance, 3000);
  assert.equal(result.earnings, 0);
});

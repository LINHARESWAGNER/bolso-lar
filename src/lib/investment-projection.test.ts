import { strict as assert } from "node:assert";
import { test } from "node:test";
import { calculateInvestments } from "./investment-projection.ts";

test("confirmed totals include dividends without duplicating detailed movements", () => {
  const result = calculateInvestments(
    [
      { movement_date: "2026-01-01", type: "aporte", amount: 3500 },
      { movement_date: "2026-01-31", type: "dividendo_reaplicado", amount: 35 },
      { movement_date: "2026-02-01", type: "resgate", amount: 100 },
    ],
    [
      {
        reference_month: "2026-01-01",
        is_confirmed: true,
        actual_contribution: 3500,
        reinvested_dividends: 35,
        withdrawals: 0,
        ending_balance: 3535,
      },
    ],
    0,
    12,
    3500,
    1000000,
    true,
    "2026-09",
  );
  assert.equal(result.earnings, 35);
  assert.equal(result.contributed, 3500);
  assert.equal(result.balance, 3435);
  assert.equal(result.points[0]!.rendimentos, 35);
  assert.equal(result.points[1]!.saque, 100);
  assert.ok(result.points.slice(2).every((p) => p.saque === 0));
});

test("effective annual rate, beginning-of-month contributions and exact milestone months", () => {
  const result = calculateInvestments([], [], 0, 12, 3500, 1000000, true, "2025-12");
  assert.equal(result.reachedAt, "2037-07");
  assert.equal(result.crossoverAt, "2032-02");
  assert.ok(result.points[139]!.previsto! >= 1000000);
  assert.ok(result.points[138]!.previsto! < 1000000);
});

test("disabling reinvestment pays earnings outside the projected portfolio", () => {
  const result = calculateInvestments([], [], 1000, 12, 100, 1000000, false, "2026-01");
  assert.equal(result.points[1]!.previsto, 1100);
  assert.equal(result.points[2]!.previsto, 1200);
  assert.ok(result.points[2]!.rendimentos > result.points[1]!.rendimentos);
});

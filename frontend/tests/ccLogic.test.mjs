import assert from "node:assert/strict";
import { computeCcBillWindows } from "../src/ccLogic.js";

const startDate = new Date("2026-01-01T00:00:00");
const state = {
  credit_balance: 453,
  cc_pay_day: 13,
  cc_pay_method_value: "I want to pay my bill in full",
  bills: [
    {
      name: "Groceries",
      amount: 300,
      frequency: "Weekly",
      day: "Monday",
      type: "Credit"
    },
    {
      name: "Fee",
      amount: 50,
      frequency: "Monthly",
      day: 13,
      type: "Credit"
    }
  ]
};

const result = computeCcBillWindows(state, 60, startDate);
assert.equal(result.payDates[0], "2026-01-13");
assert.equal(result.payDates[1], "2026-02-13");

const first = result.windows[0];
const second = result.windows[1];

// Jan 5 and Jan 12 are Mondays before Jan 13: 2 * 300 = 600, plus balance 453.
assert.equal(first.total, 1053);

// Next window includes 4 Mondays (Jan 19, 26, Feb 2, 9) = 1200 plus shifted monthly fee 50.
assert.equal(second.total, 1250);

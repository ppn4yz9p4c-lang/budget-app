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

const first = result.rows[0];
const second = result.rows[1];

// Credit before payment on Jan 13 includes balance + Monday charges before 1/13.
assert.equal(first.payAmount, 1053);

// Credit before payment on Feb 13 includes charges after Jan 13 (including shifted fee).
assert.equal(second.payAmount, 1250);

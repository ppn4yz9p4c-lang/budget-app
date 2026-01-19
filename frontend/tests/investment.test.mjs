import assert from "node:assert/strict";
import { computeSnpProjection } from "../src/investment.js";

function range(value, days) {
  return Array.from({ length: days }, () => value);
}

// Test 1: 0% return -> calculatedReturn = 0
{
  const balances = range(200, 10);
  const result = computeSnpProjection(balances, 100, 0);
  assert.equal(Math.round(result.calculatedReturn), 0);
}

// Test 2: debitFloor >= minProjected -> no transfers
{
  const balances = range(150, 10);
  const result = computeSnpProjection(balances, 150, 0.0001);
  assert.equal(Math.round(result.totalTransferred), 0);
  assert.equal(Math.round(result.calculatedReturn), 0);
}

// Test 3: minProjected - floor = 50 -> transfer 50 total
{
  const balances = [150, 150, 150, 150];
  const result = computeSnpProjection(balances, 100, Math.pow(1.07, 1 / 365) - 1);
  assert.equal(Math.round(result.totalTransferred), 50);
  assert.ok(result.calculatedReturn > 0);
}

import assert from "node:assert/strict";
import { saveState } from "../src/saveState.js";

// Clicking save when dirty should call putState.
{
  let called = 0;
  const putState = async () => {
    called += 1;
    return { ok: true };
  };
  await saveState({
    putState,
    payload: { bills: [] },
    dirty: true,
    log: () => {}
  });
  assert.equal(called, 1);
}

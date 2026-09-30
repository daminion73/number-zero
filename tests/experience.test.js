import assert from "node:assert/strict";
import { test } from "node:test";
import { nextRollMilestone, explorationProgress } from "../experience.js";

test("roll objectives advance at thresholds rather than staying completed", () => {
  assert.equal(nextRollMilestone(0), 1);
  assert.equal(nextRollMilestone(9), 10);
  assert.equal(nextRollMilestone(10), 50);
  assert.equal(nextRollMilestone(9999), 10000);
  assert.equal(nextRollMilestone(10000), 20000);
});
test("discovery counts unique inspected cases, not repeated visits", () => {
  assert.deepEqual(explorationProgress(["nano", "nano", "signal"], 5), {
    value: 2,
    max: 5,
    percent: 40,
  });
  assert.deepEqual(explorationProgress([], 0), {
    value: 0,
    max: 0,
    percent: 0,
  });
});

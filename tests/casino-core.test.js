import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, createHmac } from "node:crypto";
import {
  baccaratPlay, blackjackAction, blackjackStart, blackjackView, crashMultiplierAt, crashPointFromFloat, crashTimeFor,
  fairFloats, handValue, hmacSha256Hex, minesCashout, minesLayout, minesMultiplier, minesReveal, minesStart, minesView, sha256Hex,
} from "../casino-core.js";

// Card index helpers: rank index (0 = A … 12 = K) in spades.
const floatFor = (rank) => (rank + 0.5) / 52;

test("pure SHA-256 and HMAC match node:crypto", () => {
  for (const value of ["", "abc", "a".repeat(55), "a".repeat(64), "ünïcode 🚀".repeat(20)]) {
    assert.equal(sha256Hex(value), createHash("sha256").update(value).digest("hex"));
    assert.equal(hmacSha256Hex("server-seed", value), createHmac("sha256", "server-seed").update(value).digest("hex"));
  }
  const longKey = "k".repeat(100);
  assert.equal(hmacSha256Hex(longKey, "m"), createHmac("sha256", longKey).update("m").digest("hex"));
});

test("fair floats are deterministic, uniform-range and seed-sensitive", () => {
  const a = fairFloats("s", "c", 1, 20);
  assert.deepEqual(a, fairFloats("s", "c", 1, 20));
  assert.notDeepEqual(a, fairFloats("s", "c", 2, 20));
  assert.ok(a.every((f) => f >= 0 && f < 1));
  assert.equal(a.length, 20);
});

test("blackjack natural pays 3:2 and dealer stands on 17", () => {
  // Deal order: hand1, dealer up, hand2, dealer hole.
  const floats = [floatFor(0), floatFor(9), floatFor(12), floatFor(6), floatFor(5)];
  const state = blackjackStart(floats, [1000]);
  assert.equal(state.phase, "settled");
  assert.equal(state.hands[0].result, "blackjack");
  assert.equal(state.payout, 2500);
});

test("blackjack hides the hole card, supports split, double and dealer draws", () => {
  // Player 8,8 vs dealer 6 + 10; split → 8+3 (double → +10 = 21), 8+9 (stand 17); dealer 16 draws 5 → 21? use 2 → 18.
  const ranks = [7, 5, 7, 9, 2, 8, 9, 1];
  const floats = ranks.map(floatFor);
  const state = blackjackStart(floats, [1000]);
  assert.equal(blackjackView(state).dealer[1], null);
  assert.deepEqual(blackjackView(state).actions.sort(), ["double", "hit", "split", "stand"]);
  blackjackAction(state, floats, "split");
  assert.equal(state.hands.length, 2);
  assert.equal(state.wager, 2000);
  blackjackAction(state, floats, "double");
  assert.equal(handValue(state.hands[0].cards).total, 21);
  blackjackAction(state, floats, "stand");
  assert.equal(state.phase, "settled");
  assert.equal(handValue(state.dealer).total, 18);
  assert.equal(state.hands[0].result, "win");
  assert.equal(state.hands[0].payout, 4000);
  assert.equal(state.hands[1].result, "lose");
  assert.equal(state.wager, 3000);
});

test("insurance pays 2:1 when the dealer has blackjack", () => {
  const floats = [floatFor(9), floatFor(0), floatFor(8), floatFor(12)];
  const state = blackjackStart(floats, [1000]);
  assert.equal(state.phase, "insurance");
  blackjackAction(state, floats, "insurance");
  assert.equal(state.phase, "settled");
  assert.equal(state.wager, 1500);
  assert.equal(state.payout, 1500);
});

test("baccarat applies the third-card tableau and commissions", () => {
  // P: 2,3 (5) draws; B: K,4 (4). Player third card 7 → banker (4) draws on 2–7 → draws 5 → 9.
  const floats = [floatFor(1), floatFor(12), floatFor(2), floatFor(3), floatFor(6), floatFor(4)];
  const result = baccaratPlay(floats, { banker: 1000, tie: 100 });
  assert.equal(result.playerTotal, 2);
  assert.equal(result.bankerTotal, 9);
  assert.equal(result.winner, "banker");
  assert.equal(result.payout, 1950);
  assert.equal(result.wager, 1100);
});

test("mines multipliers, layout uniqueness and cash-out", () => {
  assert.equal(minesMultiplier(1, 1), Math.floor(0.99 * 25 / 24 * 10000) / 10000);
  assert.equal(minesMultiplier(24, 1), 24.75);
  const floats = fairFloats("seed", "client", 0, 24);
  const layout = minesLayout(floats, 24);
  assert.equal(new Set(layout).size, 24);
  const state = minesStart(floats, 1000, 3);
  assert.equal(minesView(state).layout, undefined);
  const safe = [...Array(25).keys()].filter((tile) => !state.layout.includes(tile));
  minesReveal(state, safe[0]);
  minesReveal(state, safe[1]);
  minesCashout(state);
  assert.equal(state.payout, Math.floor(1000 * minesMultiplier(3, 2)));
  assert.deepEqual(minesView(state).layout, state.layout);
  const busted = minesStart(floats, 1000, 3);
  minesReveal(busted, busted.layout[0]);
  assert.equal(busted.phase, "busted");
});

test("crash points follow 0.99/x and timing is invertible", () => {
  assert.equal(crashPointFromFloat(0), 1);
  assert.equal(crashPointFromFloat(0.5), 1.98);
  assert.equal(crashPointFromFloat(0.99), 99);
  assert.equal(crashMultiplierAt(0), 1);
  assert.ok(Math.abs(crashMultiplierAt(crashTimeFor(2)) - 2) <= 0.01);
  let wins = 0;
  const floats = fairFloats("rtp", "x", 0, 20000);
  for (const f of floats) if (crashPointFromFloat(f) > 2) wins++;
  assert.ok(Math.abs(wins / floats.length - 0.495) < 0.02);
});

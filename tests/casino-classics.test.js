import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DICE_FLOATS, KENO_FLOATS, KENO_PAYTABLE, PLINKO_FLOATS, PLINKO_TABLES, ROULETTE_RED, SLOT_FLOATS, SLOT_MACHINES, VIDEO_POKER_FLOATS,
  clientView, diceMultiplier, diceRoll, fairFloats, kenoPlay, plinkoDrop, pokerHand, roundFinished, rouletteSpin, slotLinePay, slotRtp,
  slotsSpin, verifyRound, videoPokerDraw, videoPokerStart,
} from "../casino-core.js";

const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return k < 0 || k > n ? 0 : r; };
const card = (rank, suit = 0) => suit * 13 + rank; // rank 0 = A … 12 = K

test("plinko tables return about 99% under the binomial bounce distribution", () => {
  for (const [rows, risks] of Object.entries(PLINKO_TABLES))
    for (const [risk, table] of Object.entries(risks)) {
      assert.equal(table.length, Number(rows) + 1);
      const rtp = table.reduce((sum, multiplier, slot) => sum + (multiplier * choose(+rows, slot)) / 2 ** rows, 0);
      assert.ok(rtp > 0.985 && rtp < 0.995, `${rows}/${risk} rtp ${rtp}`);
    }
  const drop = plinkoDrop(fairFloats("s", "c", 3, PLINKO_FLOATS), 1_000, 12, "medium");
  assert.equal(drop.path.length, 12);
  assert.equal(drop.slot, drop.path.filter(Boolean).length);
  assert.equal(drop.payout, Math.floor(1_000 * PLINKO_TABLES[12].medium[drop.slot]));
  assert.throws(() => plinkoDrop([0.1], 1_000, 10, "low"));
});

test("keno paytables return about 99% under the hypergeometric draw", () => {
  for (const [picks, table] of Object.entries(KENO_PAYTABLE)) {
    const rtp = table.reduce((sum, multiplier, hits) => sum + (multiplier * choose(+picks, hits) * choose(40 - picks, 10 - hits)) / choose(40, 10), 0);
    assert.ok(rtp > 0.985 && rtp < 0.992, `${picks} picks rtp ${rtp}`);
  }
  const round = kenoPlay(fairFloats("s", "c", 1, KENO_FLOATS), 500, [5, 1, 40]);
  assert.equal(new Set(round.drawn).size, 10);
  assert.ok(round.drawn.every((n) => n >= 1 && n <= 40));
  assert.deepEqual(round.hits, [1, 5, 40].filter((n) => round.drawn.includes(n)));
  assert.equal(round.payout, Math.floor(500 * KENO_PAYTABLE[3][round.hits.length]));
  assert.throws(() => kenoPlay([0.5], 500, [1, 1]));
  assert.throws(() => kenoPlay([0.5], 500, Array.from({ length: 11 }, (_, i) => i + 1)));
});

test("roulette pays by bet type on a European wheel", () => {
  const spinOn = (number, bets) => rouletteSpin([(number + 0.5) / 37], bets);
  const round = spinOn(17, [
    { type: "straight", value: 17, amount: 100 },
    { type: "black", amount: 100 },
    { type: "odd", amount: 100 },
    { type: "dozen", value: 2, amount: 100 },
    { type: "column", value: 2, amount: 100 },
    { type: "high", amount: 100 },
  ]);
  assert.equal(round.color, "black");
  assert.deepEqual(round.bets.map((bet) => bet.payout), [3_600, 200, 200, 300, 300, 0]);
  assert.equal(round.payout, 4_600);
  const zero = spinOn(0, [{ type: "red", amount: 100 }, { type: "even", amount: 100 }, { type: "straight", value: 0, amount: 100 }]);
  assert.equal(zero.payout, 3_600);
  assert.equal(ROULETTE_RED.length, 18);
  assert.throws(() => rouletteSpin([0.5], [{ type: "straight", value: 37, amount: 100 }]));
  assert.throws(() => rouletteSpin([0.5], [{ type: "red", value: 3, amount: 100 }]));
});

test("dice chance and multiplier carry a 1% edge with exact hundredths", () => {
  assert.equal(diceMultiplier(50), 1.98);
  assert.equal(diceMultiplier(1), 99);
  const win = diceRoll([0.4999], 1_000, 50, "under");
  assert.equal(win.roll, 49.99);
  assert.ok(win.won);
  assert.equal(win.payout, 1_980);
  const over = diceRoll([0.5], 1_000, 50, "over");
  assert.equal(over.roll, 50);
  assert.ok(over.won);
  assert.equal(diceRoll([0.4999], 1_000, 50, "over").won, false);
  assert.throws(() => diceRoll([0.5], 1_000, 99.5, "under"));
  assert.throws(() => diceRoll([0.5], 1_000, 50.005, "under"));
});

test("video poker evaluates Jacks or Better hands and keeps the draw secret", () => {
  const hand = (...cards) => pokerHand(cards)?.id ?? null;
  assert.equal(hand(card(0), card(9), card(10), card(11), card(12)), "royal-flush");
  assert.equal(hand(card(4), card(5), card(6), card(7), card(8)), "straight-flush");
  assert.equal(hand(card(0, 1), card(1), card(2), card(3), card(4)), "straight");
  assert.equal(hand(card(0, 1), card(9), card(10), card(11), card(12)), "straight");
  assert.equal(hand(card(5), card(5, 1), card(5, 2), card(5, 3), card(1)), "four-kind");
  assert.equal(hand(card(5), card(5, 1), card(5, 2), card(1, 3), card(1)), "full-house");
  assert.equal(hand(card(1), card(4), card(6), card(8), card(11)), "flush");
  assert.equal(hand(card(10), card(10, 1), card(2), card(4, 2), card(6)), "jacks-better");
  assert.equal(hand(card(9), card(9, 1), card(2), card(4, 2), card(6)), null);
  assert.equal(hand(card(0), card(0, 1), card(2), card(4, 2), card(6)), "jacks-better");

  const floats = fairFloats("s", "c", 9, VIDEO_POKER_FLOATS);
  const state = videoPokerStart(floats, 1_000);
  assert.equal(new Set(state.deck).size, 10);
  assert.equal(clientView(state).deck, undefined, "replacement cards stay hidden before the draw");
  assert.equal(roundFinished(state), false);
  const held = [true, false, true, false, false];
  const kept = state.cards.filter((_, index) => held[index]);
  videoPokerDraw(state, held);
  assert.ok(roundFinished(state));
  assert.deepEqual(state.cards.filter((_, index) => held[index]), kept);
  assert.deepEqual(state.cards.filter((_, index) => !held[index]), state.deck.slice(5, 8));
  assert.equal(state.payout, state.hand ? 1_000 * state.hand.returns : 0);
  assert.throws(() => videoPokerDraw(state, held));
  const replay = verifyRound({ game: "video-poker", serverSeed: "s", clientSeed: "c", nonce: 9 });
  assert.deepEqual([...replay.cards, ...replay.replacements], state.deck);
});

test("slot machines return 95–98% and pay left-to-right lines with wilds", () => {
  for (const [id, machine] of Object.entries(SLOT_MACHINES)) {
    const rtp = slotRtp(machine);
    assert.ok(rtp > 0.95 && rtp < 0.98, `${id} rtp ${rtp}`);
    assert.ok(machine.lines.every((line) => line.length === machine.reels.length));
  }
  const gems = SLOT_MACHINES["neon-gems"];
  assert.deepEqual(slotLinePay(["wild", "ruby", "ruby", "emerald", "ruby"], gems), { symbol: "ruby", count: 3, multiplier: 11 });
  assert.deepEqual(slotLinePay(["wild", "wild", "wild", "wild", "wild"], gems), { symbol: "wild", count: 5, multiplier: 3_000 });
  assert.deepEqual(slotLinePay(["wild", "wild", "wild", "crown", "topaz"], gems), { symbol: "crown", count: 4, multiplier: 300 }, "best of wild run vs substituted symbol");
  assert.deepEqual(slotLinePay(["wild", "wild", "wild", "topaz", "crown"], gems), { symbol: "wild", count: 3, multiplier: 80 });
  assert.equal(slotLinePay(["ruby", "emerald", "ruby", "ruby", "ruby"], gems), null);
  assert.deepEqual(slotLinePay(["cherry", "bar", "cherry"], SLOT_MACHINES["lucky-sevens"]), { symbol: "cherry", count: 1, multiplier: 1 });

  const spin = slotsSpin(fairFloats("s", "c", 4, SLOT_FLOATS), 1_000, "neon-gems");
  assert.equal(spin.grid.length, 5);
  assert.ok(spin.grid.every((column) => column.length === 3));
  assert.equal(spin.payout, spin.wins.reduce((sum, win) => sum + win.payout, 0));
  for (const win of spin.wins) assert.equal(win.payout, Math.floor(100 * win.multiplier));
  assert.deepEqual(verifyRound({ game: "slots", serverSeed: "s", clientSeed: "c", nonce: 4, machine: "neon-gems" }).stops, spin.stops);
  assert.throws(() => slotsSpin([0, 0, 0, 0, 0], 1_005, "neon-gems"), /invalid slots bet/);
  assert.throws(() => slotsSpin([0, 0, 0], 1_000, "unknown"));
});

test("verifier replays instant classics from their seeds", () => {
  const seeds = { serverSeed: "srv", clientSeed: "cli", nonce: 7 };
  assert.equal(verifyRound({ game: "roulette", ...seeds }).number, rouletteSpin(fairFloats("srv", "cli", 7, 1), [{ type: "red", amount: 100 }]).number);
  assert.equal(verifyRound({ game: "dice", ...seeds }).roll, diceRoll(fairFloats("srv", "cli", 7, DICE_FLOATS), 100, 50, "under").roll);
  assert.equal(verifyRound({ game: "plinko", rows: 8, ...seeds }).slot, plinkoDrop(fairFloats("srv", "cli", 7, PLINKO_FLOATS), 100, 8, "low").slot);
  assert.deepEqual(verifyRound({ game: "keno", ...seeds }).drawn, kenoPlay(fairFloats("srv", "cli", 7, KENO_FLOATS), 100, [1]).drawn);
});

test("hi-lo: chances, 1% edge per step, skips, busts and cash-outs", async () => {
  const { hiloAction, hiloChance, hiloStart, hiloStep, HILO_FLOATS } = await import("../casino-core.js");
  assert.equal(hiloChance(0, "higher"), 1, "anything is higher-or-same than an ace");
  assert.equal(hiloChance(12, "lower"), 1);
  assert.equal(hiloChance(6, "higher"), 7 / 13);
  assert.equal(hiloStep(7 / 13), 1.8385);
  const stream = (...ranks) => [...ranks.map((rank) => (rank + 0.5) / 52), ...Array(HILO_FLOATS).fill(0.99)]; // ♠ cards of these ranks
  const round = hiloStart(stream(6, 9, 2, 2), 1_000);
  assert.throws(() => hiloAction(round, stream(6, 9, 2, 2), "cashout"), /correct guess/);
  assert.throws(() => hiloAction(hiloStart(stream(0), 100), stream(0), "higher"), /cannot lose/);
  hiloAction(round, stream(6, 9, 2, 2), "higher"); // 7 → 10
  assert.equal(round.multiplier, 1.8385);
  hiloAction(round, stream(6, 9, 2, 2), "skip"); // 10 → 3, free
  assert.equal(round.multiplier, 1.8385);
  hiloAction(round, stream(6, 9, 2, 2), "lower"); // 3 → 3 counts as "same"
  assert.equal(round.multiplier, Math.floor(1.8385 * hiloStep(3 / 13) * 10_000) / 10_000);
  hiloAction(round, stream(6, 9, 2, 2), "cashout");
  assert.equal(round.phase, "cashed");
  assert.equal(round.payout, Math.floor(1_000 * round.multiplier));
  const bust = hiloStart(stream(6, 2), 1_000);
  hiloAction(bust, stream(6, 2), "higher");
  assert.equal(bust.phase, "busted");
  assert.equal(bust.payout, 0);
  assert.deepEqual(clientView(bust).cards, [6, 2]);
  assert.deepEqual(verifyRound({ game: "hilo", serverSeed: "s", clientSeed: "c", nonce: 1 }).cards.slice(0, 1), [hiloStart(fairFloats("s", "c", 1, HILO_FLOATS), 100).cards[0]]);
});

test("sic bo pays the standard table and loses even-money bets on triples", async () => {
  const { sicBoRoll } = await import("../casino-core.js");
  const roll = (dice, bets) => sicBoRoll(dice.map((die) => (die - 0.5) / 6), bets);
  const bets = [
    { type: "small", amount: 100 }, { type: "odd", amount: 100 }, { type: "total", value: 9, amount: 100 },
    { type: "single", value: 3, amount: 100 }, { type: "double", value: 3, amount: 100 }, { type: "combo", value: 34, amount: 100 },
  ];
  const result = roll([3, 3, 3], bets.slice(0, 1));
  assert.equal(result.triple, true);
  assert.equal(result.payout, 0, "small loses on a triple");
  const mixed = roll([3, 3, 3], [{ type: "triple", value: 3, amount: 100 }, { type: "any-triple", amount: 100 }, { type: "single", value: 3, amount: 100 }]);
  assert.deepEqual(mixed.bets.map((bet) => bet.payout), [18_100, 3_100, 400]);
  const hand = roll([3, 4, 2], bets);
  assert.equal(hand.total, 9);
  assert.deepEqual(hand.bets.map((bet) => bet.payout), [200, 200, 700, 200, 0, 600]);
  assert.throws(() => roll([1, 2, 3], [{ type: "combo", value: 33, amount: 100 }]));
  assert.throws(() => roll([1, 2, 3], [{ type: "total", value: 3, amount: 100 }]));
  assert.deepEqual(verifyRound({ game: "sic-bo", serverSeed: "s", clientSeed: "c", nonce: 4 }).dice, sicBoRoll(fairFloats("s", "c", 4, 3), [{ type: "big", amount: 100 }]).dice);
});

test("money wheel: 54 segments, Big Six counts and payouts", async () => {
  const { WHEEL_PAYS, WHEEL_SEGMENTS, wheelSpin } = await import("../casino-core.js");
  const counts = Object.fromEntries(Object.keys(WHEEL_PAYS).map((type) => [type, WHEEL_SEGMENTS.filter((segment) => segment === type).length]));
  assert.deepEqual(counts, { 1: 24, 2: 15, 5: 7, 10: 4, 20: 2, joker: 1, zero: 1 });
  const at = (type) => [(WHEEL_SEGMENTS.indexOf(type) + 0.5) / 54];
  const spin = wheelSpin(at("zero"), [{ type: "zero", amount: 100 }, { type: "1", amount: 100 }]);
  assert.equal(spin.value, "zero");
  assert.deepEqual(spin.bets.map((bet) => bet.payout), [4_100, 0]);
  assert.equal(wheelSpin(at("5"), [{ type: "5", amount: 100 }]).payout, 600);
  assert.throws(() => wheelSpin(at("5"), [{ type: "5", amount: 100 }, { type: "5", amount: 100 }]));
  assert.throws(() => wheelSpin(at("5"), [{ type: "50", amount: 100 }]));
});

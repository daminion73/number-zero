import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { test } from "node:test";
import { fairFloats, sha256Hex } from "../casino-core.js";
import { buildPots, evaluateHand, shuffleDeck } from "../backend/rooms/poker-hands.js";
import { poker, TURN_MS } from "../backend/rooms/poker.js";
import { roomFixture, START } from "./room-fixture.js";

// Cards: rank = i % 13 (0 = A … 12 = K), suit = ⌊i / 13⌋.
const card = (text) => {
  const ranks = "A23456789TJQK";
  return ranks.indexOf(text[0]) + 13 * "shdc".indexOf(text[1]);
};
const hand = (text) => evaluateHand(text.split(" ").map(card));

test("poker hands: categories, wheel, kickers and ties", () => {
  assert.equal(hand("As Ks Qs Js Ts 2h 3d").id, "royal-flush");
  assert.equal(hand("9h 8h 7h 6h 5h Ah Kd").id, "straight-flush");
  assert.equal(hand("Ah 2d 3s 4c 5h Kd Qd").label, "Straight, Five high");
  assert.equal(hand("7s 7h 7d 7c 2h 3d 4s").id, "quads");
  assert.equal(hand("Ks Kh Kd 2c 2h 3d 3s").label, "Full House, Kings over Threes");
  assert.equal(hand("2h 9h Jh Kh 4h As Ad").id, "flush");
  assert.equal(hand("Qs Qh Qd 2c 5h 8d 9s").id, "trips");
  assert.equal(hand("Js Jh 4d 4c 9h 2d 3s").id, "two-pair");
  assert.equal(hand("Ts Th 4d 8c 9h 2d 3s").id, "pair");
  assert.equal(hand("As Th 4d 8c 9h 2d 3c").id, "high-card");
  assert.ok(hand("As Ah Kd 4c 3h").score > hand("Ad Ac Qd 4s 3s").score, "kicker decides");
  assert.equal(hand("As Ah Kd 4c 3h").score, hand("Ad Ac Ks 4h 3s").score, "suits never break ties");
  assert.ok(hand("6s 7h 8d 9c Th").score > hand("Ah 2d 3s 4c 5h").score, "the wheel is the lowest straight");
});

test("poker pots: side pots and dead money", () => {
  const pots = buildPots([
    { seat: 0, committed: 100, live: true },
    { seat: 1, committed: 300, live: true },
    { seat: 2, committed: 300, live: true },
    { seat: 3, committed: 200, live: false },
  ]);
  assert.deepEqual(pots, [
    { amount: 400, eligible: [0, 1, 2] },
    { amount: 500, eligible: [1, 2] },
  ]);
  assert.equal(pots.reduce((sum, pot) => sum + pot.amount, 0), 900);
  const deck = shuffleDeck(fairFloats("seed", "x", 0, 52));
  assert.deepEqual([...deck].sort((a, b) => a - b), Array.from({ length: 52 }, (_, i) => i));
});

// ── Engine simulation: thousands of random decisions, chips and ledgers must always add up ─────────
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

function simTable(seats) {
  const records = [];
  const room = { id: "sim", state: "waiting", config: poker.config({ seats: seats.length, bigBlind: 10, buyIn: 50 }, fail), seats: seats.map(() => null), play: null };
  poker.init(room);
  const t = {
    now: 0,
    fail,
    randomInt,
    debit: async () => {},
    credit: async () => {},
    record: async (userId, wager, payout, extra) => records.push({ userId, wager, payout, ...extra }),
    seed: () => {
      const seed = randomBytes(16).toString("hex");
      return { seed, hash: sha256Hex(seed) };
    },
    floats: (seed, nonce, count) => fairFloats(seed, "number-zero-room-poker", nonce, count),
  };
  return { room, t, records };
}

const tableChips = (room) => {
  const { play } = room;
  const stacks = play.stacks.reduce((sum, stack) => sum + (stack || 0), 0);
  return play.phase === "hand" ? stacks + play.hand.players.reduce((sum, p) => sum + (p ? p.committed : 0), 0) : stacks;
};

function randomMove(you) {
  const roll = Math.random();
  if (you.canRaise && roll < 0.15) {
    const span = Math.round(you.maxRaiseTo - you.minRaiseTo);
    return { type: "raise", amount: you.minRaiseTo + Math.floor(Math.random() * (span + 1)) };
  }
  if (you.canRaise && roll < 0.2) return { type: "allin" };
  if (you.canCheck) return { type: "check" };
  return roll < 0.75 ? { type: "call" } : { type: "fold" };
}

test("poker engine: random play keeps chips conserved, records every hand and never stalls", async () => {
  const env = simTable(["u1", "bot", "u2", "bot"]);
  const { room, t } = env;
  for (const [index, who] of ["u1", "bot", "u2", "bot"].entries()) {
    const player = who === "bot" ? { userId: null, name: `Bot${index}`, bot: true } : { userId: who, name: who, bot: false };
    await poker.join(room, index, player, t);
    room.seats[index] = player;
  }
  let hands = 0, showdowns = 0, sidePots = 0, start = null, startStacks = null;
  for (let step = 0; step < 20_000 && hands < 150; step++) {
    const play = room.play;
    if (play.phase !== "hand" && start === null) {
      // Between hands: rebuy busted humans and sit them back in so the simulation keeps going.
      for (const seat of [0, 2]) if (play.stacks[seat] === 0) await poker.action(room, seat, { type: "rebuy" }, t);
      for (const seat of [0, 2]) if (play.sitOut[seat]) await poker.action(room, seat, { type: "sitin" }, t);
    }
    if (play.phase === "hand" && start === null) {
      start = tableChips(room);
      startStacks = play.stacks.map((stack, seat) => (stack || 0) + (play.hand.players[seat]?.committed || 0));
      env.records.length = 0;
    }
    if (play.phase === "hand") assert.equal(tableChips(room), start, "chips never appear or vanish mid-hand");
    if (play.phase === "done" && start !== null) {
      assert.equal(tableChips(room), start, "settlement pays out exactly the pot");
      for (const [seat, who] of ["u1", null, "u2", null].entries()) {
        if (!who || !play.hand.players[seat]) continue;
        const rec = env.records.filter((r) => r.userId === who);
        assert.equal(rec.length, 1, "one record per human per hand");
        assert.equal(play.stacks[seat] - startStacks[seat], rec[0].payout - rec[0].wager, "the ledger matches the stack change");
      }
      hands++;
      if (play.hand.street === "showdown") showdowns++;
      if (play.hand.result.pots.length > 1) sidePots++;
      start = null;
    }
    // Hidden information: a human's view never contains other unrevealed hole cards.
    if (play.phase === "hand") {
      const view = poker.view(room, 0, t.now);
      view.seats.forEach((seat, index) => {
        if (index !== 0 && seat?.cards && !seat.shown) assert.deepEqual(seat.cards, [null, null]);
      });
      assert.equal(view.seed, null);
    }
    const view = poker.view(room, play.hand?.toAct ?? -1, t.now);
    const actor = play.phase === "hand" && play.hand.pendingAt == null ? play.hand.toAct : -1;
    if (actor >= 0 && !room.seats[actor].bot && view.you && Math.random() < 0.95) {
      await poker.action(room, actor, randomMove(view.you), t);
    } else {
      assert.ok(play.nextAt != null, `table stalled in phase ${play.phase}`);
      t.now = Math.max(t.now, play.nextAt);
      await poker.tick(room, t);
    }
  }
  assert.ok(hands >= 150, `only ${hands} hands finished`);
  assert.ok(showdowns > 10, "some hands reach showdown");
  assert.ok(sidePots > 0, "all-ins create side pots");
});

// ── Server: buy-in, hidden cards, a hand to settlement, cash-out, restart, conservation ─────────────
test("poker table: buy-in, hidden hole cards, timers, restart mid-hand, cash-out and conservation", async (t) => {
  const f = await roomFixture(t);
  const a = await f.login("Alpha");
  const b = await f.login("Bravo");
  assert.equal((await f.create(a, "poker", { seats: 3, bigBlind: 10, buyIn: 100 })).status, 400);
  assert.equal((await f.create(a, "poker", { seats: 2, bigBlind: 7, buyIn: 100 })).status, 400);
  assert.equal((await f.create(a, "poker", { seats: 2, bigBlind: 10, buyIn: 75 })).status, 400);
  const created = await f.create(a, "poker", { seats: 4, bigBlind: 10, buyIn: 100 });
  assert.equal(created.status, 201);
  const id = created.data.room.id;
  assert.equal(await f.balanceCents(a), START - 100_000, "buy-in = 100 big blinds");
  assert.equal(created.data.room.play.phase, "waiting");

  await f.act(b, id, "join");
  f.advance(2_000);
  let room = (await f.room(id, a)).data.room;
  assert.equal(room.play.phase, "hand");
  assert.ok(room.play.seedHash);
  assert.equal(room.play.seed, null);
  const mine = room.play.seats[room.you].cards;
  assert.ok(mine.every((c) => Number.isInteger(c)), "you see your own cards");
  assert.deepEqual(room.play.seats[1].cards, [null, null], "opponent cards stay hidden");
  const spectator = (await f.room(id)).data.room;
  assert.ok(spectator.play.seats.every((seat) => !seat || seat.cards === null || seat.cards.every((c) => c === null)), "spectators see no hole cards");

  // Out-of-turn action is refused; restart mid-hand keeps the hand.
  const toAct = room.play.toAct;
  const tokens = [a, b];
  assert.equal((await f.act(tokens[1 - toAct], id, "act", { type: "check" })).data.error.code, "not_your_turn");
  await f.restart();
  room = (await f.room(id, a)).data.room;
  assert.equal(room.play.toAct, toAct);
  assert.deepEqual(room.play.seats[0].cards, mine);

  // The turn timer folds or checks for an idle player.
  f.advance(TURN_MS);
  room = (await f.room(id, a)).data.room;
  assert.notEqual(room.play.phase === "hand" ? room.play.toAct : -1, toAct);

  // Play several hands: both humans call/check down.
  let finished = 0;
  for (let guard = 0; guard < 400 && finished < 3; guard++) {
    room = (await f.room(id, a)).data.room;
    const play = room.play;
    if (play.phase === "done") {
      finished++;
      if (play.result && !play.result.uncontested) assert.equal(sha256Hex(play.seed), play.seedHash);
      f.advance(play.nextHandAt - play.serverTime);
      continue;
    }
    if (play.phase !== "hand" || play.toAct < 0) {
      f.advance(1_600);
      continue;
    }
    const token = tokens[play.toAct];
    const you = (await f.room(id, token)).data.room.play.you;
    const result = await f.act(token, id, "act", { type: you.canCheck ? "check" : "call" });
    assert.equal(result.status, 200, JSON.stringify(result.data));
  }
  assert.ok(finished >= 3);

  // Bots join between hands; leaving cashes out the stack (folding first if needed).
  assert.equal((await f.act(b, id, "bot")).status, 403);
  assert.equal((await f.act(a, id, "bot")).status, 200);
  for (const [token, seat] of [[a, 0], [b, 1]]) {
    room = (await f.room(id, token)).data.room;
    const stack = Math.round(room.play.seats[seat].stack * 100);
    const committed = room.play.phase === "hand" ? Math.round(room.play.seats[seat].committed * 100) : 0;
    await f.assertConserved(token, stack + committed);
  }
  const stackB = Math.round((await f.room(id, b)).data.room.play.seats[1].stack * 100);
  const beforeB = await f.balanceCents(b);
  assert.equal((await f.act(b, id, "leave")).status, 200);
  assert.equal(await f.balanceCents(b), beforeB + stackB, "leaving cashes out the stack");
  await f.assertConserved(b);

  // Closing the table returns Alpha's chips (a live hand is voided).
  room = (await f.room(id, a)).data.room;
  const held = Math.round((room.play.seats[0].stack + (room.play.phase === "hand" ? room.play.seats[0].committed : 0)) * 100);
  const beforeA = await f.balanceCents(a);
  assert.equal((await f.act(a, id, "close")).status, 200);
  assert.equal(await f.balanceCents(a), beforeA + held);
  await f.assertConserved(a);
});

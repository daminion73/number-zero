import assert from "node:assert/strict";
import { test } from "node:test";
import { cardFromFloat, fairFloats, handValue, sha256Hex } from "../casino-core.js";
import { blackjack, botMove, ALL_IN_MS, BETTING_MS, BOT_THINK_MS } from "../backend/rooms/blackjack.js";
import { roomFixture } from "./room-fixture.js";

// ── Engine-level tests with a scripted shoe ─────────────────────────────────────────────────────
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

/** A fake `tools` whose card stream is `deck` (card ints) and which tracks balances/records. */
function table(deck, seats) {
  const balances = { u1: 100_000, u2: 100_000 };
  const records = [];
  const count = Math.max(2, seats.length);
  const room = { id: "r", state: "waiting", config: blackjack.config({ seats: count, minBet: 10 }, fail), seats: Array(count).fill(null), play: null };
  blackjack.init(room);
  const t = {
    now: 1_000,
    fail,
    async debit(user, cents) {
      if (balances[user] < cents) throw fail(409, "insufficient_balance", "broke");
      balances[user] -= cents;
    },
    async credit(user, cents) {
      balances[user] += cents;
    },
    record: async (userId, wager, payout, extra) => records.push({ userId, wager, payout, ...extra }),
    seed: () => ({ seed: "seed", hash: sha256Hex("seed") }),
    floats: (seed, nonce, count) => Array.from({ length: count }, (_, k) => (deck[k] + 0.5) / 52),
  };
  return { room, t, balances, records };
}

async function sit(env, seats) {
  for (const [index, seat] of seats.entries()) {
    const player = seat === "bot" ? { userId: null, name: `Bot${index}`, bot: true } : { userId: seat, name: seat, bot: false };
    await blackjack.join(env.room, index, player, env.t);
    env.room.seats[index] = player;
  }
}

async function tickAt(env, at) {
  env.t.now = at;
  while (env.room.play.nextAt != null && env.room.play.nextAt <= env.t.now) await blackjack.tick(env.room, env.t);
}

test("blackjack engine: config validation", () => {
  assert.throws(() => blackjack.config({ seats: 6, minBet: 10 }, fail), { code: "invalid_seats" });
  assert.throws(() => blackjack.config({ seats: 3, minBet: 5 }, fail), { code: "invalid_bet" });
  assert.deepEqual(blackjack.config({ seats: "4", minBet: "100" }, fail), { seats: 4, minBet: 100, maxBet: 100_000, minBetCents: 10_000, maxBetCents: 10_000_000 });
  assert.equal(blackjack.seatCount({ seats: 3 }), 3);
});

test("blackjack engine: split, double after split, bot basic strategy, dealer busts", async () => {
  // Deal: s0 8♠, bot 10♠, dealer 6♠, s0 8♥, bot 7♠, hole 10♠ · split → 3♠ / 9♠ · double → 10♠ · dealer 6♠ (bust)
  const env = table([7, 9, 5, 20, 6, 9, 2, 8, 9, 5], ["u1", "bot"]);
  await sit(env, ["u1", "bot"]);
  await blackjack.action(env.room, 0, { type: "bet", amount: 100 }, env.t);
  assert.equal(env.balances.u1, 90_000);
  assert.equal(env.room.play.closesAt, 1_000 + ALL_IN_MS, "everyone in → short countdown");
  assert.equal(env.room.play.bets[1], 1_000, "bot bets the minimum");
  await tickAt(env, 1_000 + ALL_IN_MS);
  const play = env.room.play;
  assert.equal(play.phase, "playing");
  assert.deepEqual(play.turn, { seat: 0, hand: 0 });
  // Hidden information: the hole card never appears before the reveal.
  const view = blackjack.view(env.room, 1, env.t.now);
  assert.deepEqual(view.dealer.cards, [5, null]);
  assert.equal(view.seed, null);
  assert.ok(!JSON.stringify(view).includes('"seed":"seed"'));
  assert.deepEqual(blackjack.view(env.room, 0, env.t.now).actions, ["hit", "stand", "double", "split"]);
  assert.deepEqual(view.actions, [], "only the player on turn gets actions");
  await assert.rejects(blackjack.action(env.room, 1, { type: "hit" }, env.t), { code: "not_your_turn" });

  await blackjack.action(env.room, 0, { type: "split" }, env.t);
  assert.equal(env.balances.u1, 80_000);
  assert.deepEqual(play.hands[0].map((hand) => hand.cards), [[7, 2], [20, 8]]);
  assert.deepEqual(blackjack.view(env.room, 0, env.t.now).actions, ["hit", "stand", "double"], "one split per seat");
  await blackjack.action(env.room, 0, { type: "double" }, env.t);
  assert.equal(env.balances.u1, 70_000);
  assert.deepEqual(play.turn, { seat: 0, hand: 1 });
  await blackjack.action(env.room, 0, { type: "stand" }, env.t);
  assert.deepEqual(play.turn, { seat: 1, hand: 0 });
  await tickAt(env, env.t.now + BOT_THINK_MS + 2_000);
  assert.equal(play.phase, "result");
  assert.deepEqual(play.dealer, [5, 9, 5]);
  assert.deepEqual(play.hands[0].map((hand) => [hand.result, hand.payout]), [["win", 40_000], ["win", 20_000]]);
  assert.equal(play.hands[1][0].result, "win");
  assert.equal(env.balances.u1, 130_000);
  assert.deepEqual(env.records, [{ userId: "u1", wager: 30_000, payout: 60_000, game: "live-blackjack", won: true, natural: false }]);
  const done = blackjack.view(env.room, -1, env.t.now);
  assert.equal(done.seed, "seed");
  assert.equal(done.drawn, 10);
  // Result phase → next betting round with a fresh commitment and a countdown (humans just played).
  await tickAt(env, play.resultEndsAt);
  assert.equal(env.room.play.phase, "betting");
  assert.equal(env.room.play.round, 2);
  assert.equal(env.room.play.closesAt, play.resultEndsAt + BETTING_MS);
  assert.equal(env.room.play.last.seed, "seed");
});

test("blackjack engine: naturals pay 3:2, dealer peek ends the round, pushes return the bet", async () => {
  // Player A♠ K♠ vs dealer 9♠ 8♠ → blackjack, dealer does not draw.
  let env = table([0, 8, 12, 7], ["u1"]);
  await sit(env, ["u1"]);
  await blackjack.action(env.room, 0, { type: "bet", amount: 100 }, env.t);
  await tickAt(env, 1_000 + ALL_IN_MS);
  assert.equal(env.room.play.phase, "result");
  assert.equal(env.room.play.hands[0][0].result, "blackjack");
  assert.equal(env.balances.u1, 115_000, "100 CR bet returns 250 CR");
  assert.equal(env.records[0].natural, true);

  // Dealer A♠ + K♠ (peeked): u1 with 10+9 loses, u2 with a natural pushes.
  env = table([9, 0, 0, 8, 12, 12], ["u1", "u2"]);
  await sit(env, ["u1", "u2"]);
  await blackjack.action(env.room, 0, { type: "bet", amount: 50 }, env.t);
  await blackjack.action(env.room, 1, { type: "bet", amount: 20 }, env.t);
  await tickAt(env, 1_000 + ALL_IN_MS);
  assert.equal(env.room.play.phase, "result");
  assert.equal(env.room.play.peeked, true);
  assert.deepEqual(env.room.play.hands.map((hands) => hands[0].result), ["lose", "push"]);
  assert.equal(env.balances.u1, 95_000);
  assert.equal(env.balances.u2, 100_000);
});

test("blackjack engine: dealer stands on soft 17 and timeouts auto-stand", async () => {
  // Player 10+7; dealer A + 6 = soft 17 — no blackjack, stands.
  const env = table([9, 0, 6, 5], ["u1"]);
  await sit(env, ["u1"]);
  await blackjack.action(env.room, 0, { type: "bet", amount: 10 }, env.t);
  await tickAt(env, 1_000 + ALL_IN_MS);
  assert.equal(env.room.play.phase, "playing");
  await tickAt(env, env.room.play.turnEndsAt - 1);
  assert.equal(env.room.play.phase, "playing");
  await tickAt(env, env.room.play.turnEndsAt);
  assert.equal(env.room.play.phase, "result");
  assert.deepEqual(env.room.play.dealer, [0, 5]);
  assert.equal(env.room.play.hands[0][0].result, "push");
});

test("blackjack bots follow basic strategy", () => {
  const hand = (...cards) => ({ cards });
  assert.equal(botMove(hand(7, 20), 9, 1), "split"); // 8,8 v 10
  assert.equal(botMove(hand(9, 22), 5, 1), "stand"); // 10,10 v 6 → 20
  assert.equal(botMove(hand(5, 17), 9, 1), "double"); // 6+5 = 11 v 10
  assert.equal(botMove(hand(9, 5), 9, 1), "hit"); // 16 v 10
  assert.equal(botMove(hand(9, 5), 4, 1), "stand"); // 16 v 5
  assert.equal(botMove(hand(0, 6), 8, 1), "hit"); // soft 18 v 9
  assert.equal(botMove(hand(0, 7), 5, 1), "stand"); // soft 19
  assert.equal(botMove(hand(9, 1, 3), 2, 1), "stand"); // hard 16 v 3
});

// ── Server tests through the room manager ───────────────────────────────────────────────────────
async function playOut(f, id, token, choose = () => "stand") {
  for (let guard = 0; guard < 80; guard++) {
    const room = (await f.room(id, token)).data.room;
    if (room.play.phase !== "playing") return room;
    if (room.play.turn.seat === room.you) await f.act(token, id, "act", { type: choose(room.play.actions, room) });
    else f.advance(BOT_THINK_MS + 1_000);
  }
  throw new Error("round did not finish");
}

function verifyRound(play) {
  assert.equal(sha256Hex(play.seed), play.seedHash);
  const stream = fairFloats(play.seed, "number-zero-room-blackjack", play.nonce, play.drawn).map(cardFromFloat);
  const shown = [...play.dealer.cards, ...play.hands.flat().flatMap((hand) => hand.cards)];
  assert.deepEqual([...shown].sort((a, b) => a - b), [...stream].sort((a, b) => a - b), "every card comes from the committed stream");
}

test("blackjack table: bets, refunds, hidden hole card, full round with a bot, conservation", async (t) => {
  const f = await roomFixture(t);
  const a = await f.login("Alpha");
  const b = await f.login("Bravo");
  assert.equal((await f.create(a, "blackjack", { seats: 7, minBet: 10 })).status, 400);
  assert.equal((await f.create(a, "blackjack", { seats: 3, minBet: 3 })).status, 400);
  const created = await f.create(a, "blackjack", { seats: 3, minBet: 10 });
  assert.equal(created.status, 201);
  const id = created.data.room.id;
  const p0 = created.data.room.play;
  assert.equal(p0.phase, "betting");
  assert.equal(p0.closesAt, null, "no countdown until somebody bets");
  assert.ok(p0.seedHash);
  assert.equal(p0.seed, null);

  // Bet validation and changing/clearing a bet.
  for (const amount of [5, 10_001, 12.5, "50"]) assert.equal((await f.act(a, id, "act", { type: "bet", amount })).status, 400);
  assert.equal((await f.act(b, id, "act", { type: "bet", amount: 50 })).status, 403, "spectators cannot bet");
  await f.act(a, id, "act", { type: "bet", amount: 50 });
  assert.equal(await f.balanceCents(a), 10_000_000 - 5_000);
  await f.act(a, id, "act", { type: "bet", amount: 20 });
  assert.equal(await f.balanceCents(a), 10_000_000 - 2_000);
  const cleared = (await f.act(a, id, "act", { type: "clear" })).data.room;
  assert.equal(await f.balanceCents(a), 10_000_000);
  assert.equal(cleared.state, "playing");
  assert.equal(cleared.play.bets[0], null);

  // A bot and a second human; Bravo bets then leaves during betting → refund.
  assert.equal((await f.act(b, id, "bot")).status, 403);
  assert.equal((await f.act(a, id, "bot", { seat: 2 })).status, 200);
  await f.act(b, id, "join", { seat: 1 });
  await f.act(b, id, "act", { type: "bet", amount: 30 });
  assert.equal(await f.balanceCents(b), 10_000_000 - 3_000);
  await f.act(b, id, "leave");
  assert.equal(await f.balanceCents(b), 10_000_000);

  // Countdown: the countdown from Alpha's first bet is still running; nobody human has a bet → no deal.
  let room = (await f.room(id, a)).data.room;
  assert.equal(room.play.bets[2], 10, "bot bets the minimum once the countdown runs");
  f.advance(BETTING_MS);
  room = (await f.room(id, a)).data.room;
  assert.equal(room.play.phase, "betting");
  assert.equal(room.play.closesAt, null, "bots never play a round alone");

  // Real round: Alpha bets 100 → everyone in → 3 s → deal.
  await f.act(a, id, "act", { type: "bet", amount: 100 });
  f.advance(ALL_IN_MS);
  await f.tick();
  room = (await f.room(id, b)).data.room;
  assert.equal(room.play.phase === "playing" || room.play.phase === "result", true);
  if (room.play.phase === "playing") {
    assert.equal(room.play.dealer.cards.length, 2);
    assert.equal(room.play.dealer.cards[1], null, "hole card hidden from spectators");
    assert.equal(room.play.seed, null);
    assert.equal(room.play.drawn, null);
    const mine = (await f.room(id, a)).data.room.play;
    assert.equal(mine.dealer.cards[1], null, "hole card hidden from players");
  }
  room = await playOut(f, id, a, (actions, r) => (handValue(r.play.hands[r.you][r.play.turn.hand].cards).total < 12 && actions.includes("hit") ? "hit" : "stand"));
  assert.equal(room.play.phase, "result");
  assert.ok(room.play.dealer.cards.every((card) => card != null));
  verifyRound(room.play);
  const myHands = room.play.hands[0];
  const payout = myHands.reduce((sum, hand) => sum + hand.payout, 0);
  for (const hand of myHands) assert.equal(hand.payout, { bust: 0, lose: 0, push: hand.bet, win: hand.bet * 2, blackjack: hand.bet * 2.5 }[hand.result]);
  assert.ok(payout >= 0);
  await f.assertConserved(a);
  await f.assertConserved(b);

  // Result → next betting round opens with a new commitment and a running countdown.
  f.advance(room.play.resultEndsAt - room.play.serverTime);
  const next = (await f.room(id, a)).data.room.play;
  assert.equal(next.phase, "betting");
  assert.equal(next.round, room.play.nonce + 1);
  assert.notEqual(next.seedHash, room.play.seedHash);
  assert.equal(next.last.seed, room.play.seed);
  assert.ok(next.closesAt);
});

test("blackjack table: turn timer, leaving mid-hand forfeits, closing refunds, restart mid-round", async (t) => {
  const f = await roomFixture(t);
  const a = await f.login("Alpha");
  const b = await f.login("Bravo");
  const id = (await f.create(a, "blackjack", { seats: 2, minBet: 100 })).data.room.id;
  await f.act(b, id, "join");

  // Play rounds until both humans get a live (non-natural) hand, then exercise timers and leaving.
  let tested = { timeout: false, forfeit: false, restart: false };
  for (let round = 0; round < 25 && !(tested.timeout && tested.forfeit && tested.restart); round++) {
    await f.act(a, id, "act", { type: "bet", amount: 100 });
    await f.act(b, id, "act", { type: "bet", amount: 200 });
    let room = (await f.room(id, a)).data.room;
    if (room.play.phase === "betting") {
      f.advance(room.play.closesAt - room.play.serverTime);
      room = (await f.room(id, a)).data.room;
    }
    if (room.play.phase === "playing" && room.play.turn) {
      const turn = room.play.turn;
      if (!tested.restart) {
        await f.restart();
        tested.restart = true;
        room = (await f.room(id, a)).data.room;
        assert.deepEqual(room.play.turn, turn, "the round survives a restart");
      }
      if (!tested.timeout) {
        f.advance(room.play.turnEndsAt - room.play.serverTime);
        room = (await f.room(id, a)).data.room;
        assert.notDeepEqual(room.play.phase === "playing" ? room.play.turn : null, turn, "timeout auto-stands");
        tested.timeout = true;
      } else if (!tested.forfeit) {
        // Alpha stands on every hand so the turn reaches Bravo.
        for (let guard = 0; guard < 4 && room.play.phase === "playing" && room.play.turn?.seat === 0; guard++) room = (await f.act(a, id, "act", { type: "stand" })).data.room;
      }
      if (tested.timeout && !tested.forfeit && room.play.phase === "playing" && room.play.turn?.seat === 1) {
        // Bravo walks away mid-hand: his bet is forfeited (recorded as a loss).
        const left = await f.act(b, id, "leave");
        assert.equal(left.status, 200);
        tested.forfeit = true;
        room = (await f.room(id, a)).data.room;
        assert.equal(room.seats[1], null);
        await f.act(b, id, "join", { seat: 1 }).then((r) => assert.ok([200, 409].includes(r.status)));
      }
    }
    room = await playOut(f, id, a);
    if (room.play.phase === "result") {
      verifyRound(room.play);
      f.advance(room.play.resultEndsAt - room.play.serverTime);
      await f.room(id, a);
    }
    if (!(await f.room(id, b)).data.room.seats[1]) await f.act(b, id, "join", { seat: 1 });
  }
  assert.deepEqual(tested, { timeout: true, forfeit: true, restart: true });
  await f.assertConserved(a, await held(f, id, a));
  await f.assertConserved(b, await held(f, id, b));

  // Host closes while a bet is placed → the unsettled bet is refunded.
  let room = (await f.room(id, a)).data.room;
  if (room.play.phase !== "betting") {
    room = await playOut(f, id, a);
    f.advance(room.play.resultEndsAt - room.play.serverTime);
  }
  await f.act(a, id, "act", { type: "bet", amount: 500 });
  const before = await f.balanceCents(a);
  assert.equal((await f.act(a, id, "close")).status, 200);
  assert.equal(await f.balanceCents(a), before + 50_000);
  assert.equal((await f.room(id)).status, 404);
  await f.assertConserved(a);
  await f.assertConserved(b);
});

/** Credits currently held on the table for the viewer (a placed bet or live hands), in cents. */
async function held(f, id, token) {
  const room = (await f.room(id, token)).data.room;
  if (room.you < 0) return 0;
  if (room.play.phase === "betting") return Math.round((room.play.bets[room.you] || 0) * 100);
  if (room.play.phase === "playing") return Math.round(room.play.hands[room.you].reduce((sum, hand) => sum + hand.bet, 0) * 100);
  return 0;
}

test("blackjack table: empty tables close and refund placed bets", async (t) => {
  const f = await roomFixture(t);
  const a = await f.login("Alpha");
  const id = (await f.create(a, "blackjack", { seats: 2, minBet: 1 })).data.room.id;
  await f.act(a, id, "bot");
  await f.act(a, id, "act", { type: "bet", amount: 5 });
  assert.equal(await f.balanceCents(a), 10_000_000 - 500);
  // Leaving between rounds always works and refunds.
  const left = (await f.act(a, id, "leave")).data.room;
  assert.equal(left.you, -1);
  assert.equal(await f.balanceCents(a), 10_000_000);
  f.advance(61_000);
  await f.tick();
  assert.equal((await f.room(id)).status, 404, "a table with only bots closes after 60 s");
  await f.assertConserved(a);
});

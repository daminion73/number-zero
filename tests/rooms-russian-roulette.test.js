import assert from "node:assert/strict";
import { test } from "node:test";
import { fairFloats, sha256Hex } from "../casino-core.js";
import { roomFixture, START } from "./room-fixture.js";
import { BOT_THINK_MS, COUNTDOWN_MS, TURN_MS } from "../backend/rooms/russian-roulette.js";

const GAME = "russian-roulette";

/** Achievement rewards (cents) a player has unlocked — the first plays unlock some. */
async function rewardCents(f, token) {
  const profile = (await f.request("/api/profile", undefined, token)).data.profile;
  return profile.achievements.filter((a) => a.unlocked).reduce((sum, a) => sum + (a.reward || 0) * 100, 0);
}

/** Independent replay of a finished game from the revealed seed (mirrors what the client verifies). */
function replay(play) {
  const floats = fairFloats(play.seed, `number-zero-room-${GAME}`, 0, 8);
  const bullet = Math.floor(floats[0] * 6);
  const first = play.players[Math.floor(floats[1] * play.players.length)];
  let position = 0;
  let spins = 0;
  let seat = first;
  for (const [index, entry] of play.history.entries()) {
    assert.equal(entry.seat, seat, `pull ${index} is taken in seat order`);
    if (entry.spun) position = Math.floor(floats[2 + spins++] * 6);
    const fired = position === bullet;
    assert.equal(entry.safe, !fired, `pull ${index} matches the seed`);
    if (fired) return { first, shot: seat };
    position = (position + 1) % 6;
    seat = play.players[(play.players.indexOf(seat) + 1) % play.players.length];
  }
  assert.fail("the bullet never fired");
}

function assertSecret(room) {
  const json = JSON.stringify(room);
  assert.equal(room.play.seed, null, "seed stays hidden until the end");
  assert.ok(!/"bullet"|"position"/.test(json), "no bullet/chamber index in the view");
  assert.equal(room.play.shotSeat, null);
  assert.equal(room.play.payouts, null);
}

/** Drives a running game to the end: humans (tokens by seat) pull when it is their turn, bots get time to think. */
async function playOut(f, id, tokens, { spin = new Set(), check } = {}) {
  for (let guard = 0; guard < 100; guard++) {
    const room = (await f.room(id)).data.room;
    if (room.state === "finished") return room;
    check?.(room);
    const play = room.play;
    assert.equal(play.phase, "playing");
    if (play.turnAt > play.serverTime) f.advance(play.turnAt - play.serverTime);
    const token = tokens[play.turnSeat];
    if (token) {
      const result = await f.act(token, id, "act", { type: "pull", spin: spin.has(play.turnSeat) && play.canSpin });
      assert.equal(result.status, 200, JSON.stringify(result.data));
    } else {
      f.advance(BOT_THINK_MS);
      await f.tick();
    }
  }
  assert.fail("game did not finish");
}

test("russian roulette: config validation, join/leave refunds, countdown cancel and close refunds", async (t) => {
  const f = await roomFixture(t);
  const a = await f.login("Alpha");
  const b = await f.login("Bravo");
  for (const config of [{ stake: 0, seats: 2 }, { stake: "5", seats: 2 }, { stake: 10, seats: 1 }, { stake: 10, seats: 7 }, { stake: 10, seats: 2.5 }, { stake: 10 }, { stake: 1e12, seats: 3 }])
    assert.equal((await f.create(a, GAME, config)).status, 400, JSON.stringify(config));

  const created = await f.create(a, GAME, { stake: 250, seats: 3 });
  assert.equal(created.status, 201);
  const room = created.data.room;
  assert.equal(room.seats.length, 3);
  assert.equal(room.play.phase, "waiting");
  assert.equal(room.play.chambers, 6);
  assert.match(room.play.seedHash, /^[0-9a-f]{64}$/);
  assertSecret(room);
  assert.equal(created.data.user.balance, 99_750);

  assert.equal((await f.act(b, room.id, "join")).data.room.you, 1);
  assert.equal(await f.balanceCents(b), START - 25_000);
  assert.equal((await f.act(b, room.id, "leave")).status, 200);
  assert.equal(await f.balanceCents(b), START, "leaving before the start refunds the stake");

  // Filling the table starts a countdown; a seat emptying cancels it (and refunds).
  await f.act(b, room.id, "join");
  const full = (await f.act(a, room.id, "bot")).data.room;
  assert.equal(full.play.phase, "countdown");
  assert.equal(full.state, "waiting");
  assert.equal(full.play.startAt, full.play.serverTime + COUNTDOWN_MS);
  f.advance(2_000);
  const cancelled = (await f.act(b, room.id, "leave")).data.room;
  assert.equal(cancelled.play.phase, "waiting");
  assert.equal(cancelled.play.startAt, null);
  f.advance(10_000);
  assert.equal((await f.room(room.id)).data.room.state, "waiting");
  assert.equal(await f.balanceCents(b), START);

  // Kicking a bot also cancels; closing the room refunds the host.
  await f.act(b, room.id, "join");
  assert.equal((await f.room(room.id)).data.room.play.phase, "countdown");
  const botSeat = full.seats.findIndex((seat) => seat?.bot);
  assert.equal((await f.act(b, room.id, "kick", { seat: botSeat })).status, 403);
  assert.equal((await f.act(a, room.id, "kick", { seat: botSeat })).data.room.play.phase, "waiting");
  assert.equal((await f.act(a, room.id, "close")).status, 200);
  assert.equal(await f.balanceCents(a), START);
  assert.equal(await f.balanceCents(b), START);
  assert.equal((await f.room(room.id)).status, 404);

  // Not enough credits to sit.
  const poor = (await f.create(a, GAME, { stake: 150_000, seats: 2 })).data;
  assert.equal(poor.error.code, "insufficient_balance");
  await f.assertConserved(a);
  await f.assertConserved(b);
});

test("russian roulette: auto-start after the countdown, turn order, timeouts, secrecy and fair settlement", async (t) => {
  const f = await roomFixture(t);
  const a = await f.login("Alpha");
  const b = await f.login("Bravo");
  const room = (await f.create(a, GAME, { stake: 100, seats: 6 })).data.room;
  await f.act(b, room.id, "join");
  for (let i = 0; i < 3; i++) await f.act(a, room.id, "bot");
  assert.equal((await f.act(a, room.id, "bot")).data.room.play.phase, "countdown");
  f.advance(COUNTDOWN_MS - 1);
  assert.equal((await f.room(room.id)).data.room.play.phase, "countdown");
  f.advance(1);
  const started = (await f.room(room.id, a)).data.room;
  assert.equal(started.state, "playing");
  assert.equal(started.play.phase, "playing");
  assert.deepEqual(started.play.players, [0, 1, 2, 3, 4, 5]);
  assert.equal(started.play.pot, 600);
  assert.equal(started.play.turnSeat, started.play.firstSeat);
  assertSecret(started);
  assert.equal((await f.act(b, room.id, "leave")).data.error.code, "in_progress");
  assert.equal((await f.act(a, room.id, "close")).data.error.code, "in_progress");
  assert.equal((await f.act(b, room.id, "join")).data.error.code, "room_full");

  // Out-of-turn and early pulls are rejected; an idle human's trigger pulls itself after TURN_MS.
  const turn = started.play.turnSeat;
  const waiting = [a, b][turn === 0 ? 1 : 0];
  if (turn <= 1) {
    assert.equal((await f.act([a, b][turn], room.id, "act", { type: "pull" })).data.error.code, "too_soon");
    f.advance(started.play.turnAt - started.play.serverTime);
    assert.equal((await f.act(waiting, room.id, "act", { type: "pull" })).data.error.code, "not_your_turn");
    assert.equal((await f.act([a, b][turn], room.id, "act", { type: "dance" })).status, 400);
    f.advance(TURN_MS - 1);
    assert.equal((await f.room(room.id)).data.room.play.pulls, 0);
    f.advance(1);
    const after = (await f.room(room.id)).data.room;
    assert.equal(after.play.pulls, 1, "timeout auto-pulls");
    assert.equal(after.play.history[0].seat, turn);
    assert.equal(after.play.history[0].spun, false);
  }

  const done = await playOut(f, room.id, { 0: a, 1: b }, { check: assertSecret });
  const play = done.play;
  assert.equal(play.phase, "finished");
  assert.equal(sha256Hex(play.seed), play.seedHash);
  const outcome = replay(play);
  assert.equal(outcome.first, play.firstSeat);
  assert.equal(outcome.shot, play.shotSeat);
  assert.equal(play.history.filter((entry) => !entry.safe).length, 1, "one elimination ends the game");
  // 600 CR pot split by 5 survivors: 120 each, nothing left over.
  for (const seat of play.players) assert.equal(play.payouts[seat], seat === play.shotSeat ? 0 : 120);
  for (const [seat, token] of [[0, a], [1, b]]) assert.equal(await f.balanceCents(token), START - 10_000 + Math.round(play.payouts[seat] * 100) + (await rewardCents(f, token)));
  await f.assertConserved(a);
  await f.assertConserved(b);
  assert.equal((await f.request("/api/profile", undefined, a)).data.profile.totals.plays, 1, "one record per human per game");
  assert.equal((await f.request(`/api/rooms?game=${GAME}`)).data.rooms.length, 0, "finished games leave the public feed");
});

test("russian roulette: host can start early, odd pots give the remainder to the earliest survivor", async (t) => {
  const f = await roomFixture(t);
  const a = await f.login("Alpha");
  const b = await f.login("Bravo");
  const c = await f.login("Charlie");
  const room = (await f.create(a, GAME, { stake: 1, seats: 6 })).data.room;
  assert.equal((await f.act(a, room.id, "start")).data.error.code, "cannot_start", "needs two players");
  await f.act(b, room.id, "join");
  await f.act(a, room.id, "bot");
  await f.act(a, room.id, "bot");
  assert.equal((await f.act(b, room.id, "start")).status, 403, "only the host starts");
  const started = (await f.act(a, room.id, "start")).data.room;
  assert.equal(started.state, "playing");
  assert.deepEqual(started.play.players, [0, 1, 2, 3]);
  assert.equal(started.play.pot, 4);
  assert.equal((await f.act(c, room.id, "join")).data.error.code, "not_joinable");

  const done = await playOut(f, room.id, { 0: a, 1: b });
  const play = done.play;
  assert.equal(replay(play).shot, play.shotSeat);
  const survivors = play.players.filter((seat) => seat !== play.shotSeat);
  // 400 cents / 3 survivors = 133 each + 1 cent to the earliest survivor seat.
  assert.equal(play.payouts[survivors[0]], 1.34);
  for (const seat of survivors.slice(1)) assert.equal(play.payouts[seat], 1.33);
  assert.equal(Object.values(play.payouts).reduce((sum, value) => sum + Math.round(value * 100), 0), 400);
  for (const [seat, token] of [[0, a], [1, b]]) assert.equal(await f.balanceCents(token), START - 100 + Math.round(play.payouts[seat] * 100) + (await rewardCents(f, token)));
  await f.assertConserved(a);
  await f.assertConserved(b);
});

test("russian roulette: spins are provably fair and limited to one per player", async (t) => {
  const f = await roomFixture(t);
  const a = await f.login("Alpha");
  const b = await f.login("Bravo");
  const room = (await f.create(a, GAME, { stake: 10, seats: 2 })).data.room;
  await f.act(b, room.id, "join");
  f.advance(COUNTDOWN_MS);
  let current = (await f.room(room.id, a)).data.room;
  assert.equal(current.play.phase, "playing");
  assert.equal(current.play.canSpin, true);
  f.advance(current.play.turnAt - current.play.serverTime);
  const tokens = { 0: a, 1: b };
  current = (await f.act(tokens[current.play.turnSeat], room.id, "act", { type: "pull", spin: true })).data.room;
  assert.equal(current.play.history[0].spun, true);
  if (current.state !== "finished") {
    assert.deepEqual(current.play.spinsUsed, [current.play.history[0].seat]);
    // Back to the spinner on the following turn: a second spin is refused.
    f.advance(current.play.turnAt - current.play.serverTime);
    current = (await f.act(tokens[current.play.turnSeat], room.id, "act", { type: "pull" })).data.room;
    if (current.state !== "finished") {
      f.advance(current.play.turnAt - current.play.serverTime);
      const spinner = (await f.room(room.id, tokens[current.play.turnSeat])).data.room;
      assert.equal(spinner.play.canSpin, false, "the player on turn already spun");
      assert.equal((await f.act(tokens[current.play.turnSeat], room.id, "act", { type: "pull", spin: true })).data.error.code, "spin_used");
    }
  }
  const done = await playOut(f, room.id, tokens, { spin: new Set([0, 1]) });
  assert.equal(replay(done.play).shot, done.play.shotSeat);
  const survivor = done.play.players.find((seat) => seat !== done.play.shotSeat);
  assert.equal(done.play.payouts[survivor], 20);
  await f.assertConserved(a);
  await f.assertConserved(b);
});

test("russian roulette: a bot table plays itself out, survives a restart mid-game and settles once", async (t) => {
  const f = await roomFixture(t);
  const a = await f.login("Alpha");
  const room = (await f.create(a, GAME, { stake: 50, seats: 5 })).data.room;
  assert.equal((await f.act(await f.login("Bravo"), room.id, "bot")).status, 403);
  for (let i = 0; i < 4; i++) await f.act(a, room.id, "bot");
  f.advance(COUNTDOWN_MS);
  await f.tick();
  const started = (await f.room(room.id, a)).data.room;
  assert.equal(started.state, "playing");
  // Let a couple of pulls happen, then restart while a turn is pending.
  let pulls = 0;
  for (let guard = 0; guard < 6 && pulls < 2; guard++) {
    f.advance(BOT_THINK_MS + 1_600);
    await f.tick();
    const view = (await f.room(room.id)).data.room;
    if (view.state === "finished") break;
    pulls = view.play.pulls;
  }
  await f.restart();
  const resumed = (await f.room(room.id, a)).data.room;
  if (resumed.state !== "finished") assertSecret(resumed);
  const done = resumed.state === "finished" ? resumed : await playOut(f, room.id, { 0: a });
  await f.restart();
  f.advance(60_000);
  await Promise.all([f.tick(), f.tick()]);
  const final = (await f.room(room.id)).data.room;
  assert.equal(final.state, "finished");
  assert.deepEqual(final.play.history, done.play.history);
  assert.equal(replay(final.play).shot, final.play.shotSeat);
  assert.equal(await f.balanceCents(a), START - 5_000 + Math.round(final.play.payouts[0] * 100) + (await rewardCents(f, a)), "credited exactly once");
  await f.assertConserved(a);
  assert.equal((await f.request("/api/profile", undefined, a)).data.profile.totals.plays, 1, "recorded exactly once");
});

test("russian roulette: turn timer auto-pulls for idle players and rejects out-of-turn pulls", async (t) => {
  const f = await roomFixture(t);
  const a = await f.login("Alpha");
  const b = await f.login("Bravo");
  const tokens = { 0: a, 1: b };
  const room = (await f.create(a, GAME, { stake: 5, seats: 2 })).data.room;
  await f.act(b, room.id, "join");
  f.advance(COUNTDOWN_MS);
  let view = (await f.room(room.id)).data.room;
  assert.equal(view.state, "playing");
  const first = view.play.turnSeat;
  assert.equal(first, view.play.firstSeat);
  assert.equal((await f.act(tokens[first], room.id, "act", { type: "pull" })).data.error.code, "too_soon");
  f.advance(view.play.turnAt - view.play.serverTime);
  assert.equal((await f.act(tokens[1 - first], room.id, "act", { type: "pull" })).data.error.code, "not_your_turn");
  assert.equal((await f.act(tokens[first], room.id, "act", { type: "dance" })).status, 400);
  assert.equal((await f.act(await f.login("Watcher"), room.id, "act", { type: "pull" })).data.error.code, "not_seated");
  f.advance(TURN_MS - 1);
  assert.equal((await f.room(room.id)).data.room.play.pulls, 0);
  f.advance(1);
  view = (await f.room(room.id)).data.room;
  assert.equal(view.play.pulls, 1, "timeout auto-pulls");
  assert.deepEqual({ seat: view.play.history[0].seat, spun: view.play.history[0].spun }, { seat: first, spun: false });
  // Nobody acts: the timer keeps pulling, alternating seats, until the bullet fires (≤ 6 pulls without spins).
  for (let guard = 0; guard < 10 && view.state !== "finished"; guard++) {
    assert.equal(view.play.turnSeat, view.play.history.at(-1).seat === 0 ? 1 : 0);
    f.advance(view.play.turnEndsAt - view.play.serverTime);
    await f.tick();
    view = (await f.room(room.id)).data.room;
  }
  assert.equal(view.state, "finished");
  assert.ok(view.play.pulls <= 6);
  assert.equal(replay(view.play).shot, view.play.shotSeat);
  await f.assertConserved(a);
  await f.assertConserved(b);
});

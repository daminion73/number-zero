import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server.js";
import {
  BACCARAT_FLOATS,
  BLACKJACK_FLOATS,
  baccaratPlay,
  blackjackAction,
  blackjackStart,
  crashPointFromFloat,
  crashTimeFor,
  fairFloats,
  liveCrashPoint,
  minesLayout,
  sha256Hex,
} from "../casino-core.js";

const START = 10_000_000; // 100,000 CR in cents

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "number-zero-casino-"));
  let time = Date.UTC(2026, 9, 4, 12);
  const options = {
    env: { DEV_AUTH: "1", ROUND_MS: "1000", WAITING_MS: "60000" },
    dbPath: join(directory, "casino.sqlite"),
    noTimer: true,
    now: () => time,
  };
  let server, base;
  async function start() {
    server = await createServer(options);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    await new Promise((resolve) => server.close(resolve));
    await server.closeDatabase();
  }
  await start();
  t.after(async () => {
    await stop();
    await rm(directory, { recursive: true, force: true });
  });
  async function request(path, body, token) {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  }
  const f = {
    request,
    advance: (ms) => {
      time += Math.ceil(ms);
    },
    tick: () => server.tick(),
    restart: async () => {
      await stop();
      await start();
    },
    async login(name) {
      const result = await request("/api/auth/dev", { name });
      assert.equal(result.status, 200);
      return result.data.token;
    },
    async balanceCents(token) {
      return Math.round((await request("/api/me", undefined, token)).data.user.balance * 100);
    },
    async profile(token) {
      return (await request("/api/profile", undefined, token)).data.profile;
    },
    async rewardsCents(token) {
      const profile = await f.profile(token);
      return profile.achievements.filter((a) => a.unlocked).reduce((sum, a) => sum + a.reward * 100, 0);
    },
    /** Asserts wallet = start − Σwager + Σpayout + achievement rewards, using the plays ledger. */
    async assertConserved(token) {
      const profile = await f.profile(token);
      const net = Math.round(profile.totals.net * 100);
      assert.equal(await f.balanceCents(token), START + net + (await f.rewardsCents(token)));
    },
  };
  return f;
}

test("blackjack debits extra stakes, settles, and replays from the revealed seed", async (t) => {
  const f = await fixture(t);
  const token = await f.login("Dealer Test");
  let response = await f.request("/api/casino/blackjack/start", { bets: [100, 50] }, token);
  assert.equal(response.status, 200);
  const first = response.data.round;
  assert.equal(first.dealer[1] ?? null, first.phase === "settled" ? first.dealer[1] : null);
  if (first.phase !== "settled")
    assert.equal((await f.request("/api/casino/blackjack/start", { bets: [10] }, token)).data.error.code, "round_active");
  const actions = [];
  while (response.data.round.phase !== "settled") {
    const legal = response.data.round.actions;
    const action = legal.includes("no-insurance") ? "no-insurance" : legal.includes("double") && !actions.includes("double") ? "double" : "stand";
    actions.push(action);
    response = await f.request("/api/casino/blackjack/action", { action }, token);
    assert.equal(response.status, 200, JSON.stringify(response.data));
  }
  const settled = response.data.round;
  assert.ok(settled.dealer.every((card) => Number.isInteger(card)));
  assert.equal((await f.request("/api/casino/blackjack/action", { action: "hit" }, token)).status, 404);
  await f.assertConserved(token);

  const rotated = (await f.request("/api/fair/rotate", { clientSeed: "my-seed" }, token)).data.fair;
  assert.equal(rotated.clientSeed, "my-seed");
  assert.equal(rotated.nonce, 0);
  const { serverSeed, clientSeed, nonce } = rotated.previous;
  assert.equal(sha256Hex(serverSeed), settled.fair.serverSeedHash);
  const floats = fairFloats(serverSeed, clientSeed, settled.fair.nonce, BLACKJACK_FLOATS);
  const replay = blackjackStart(floats, [10_000, 5_000]);
  for (const action of actions) blackjackAction(replay, floats, action);
  assert.deepEqual(replay.dealer, settled.dealer);
  assert.equal(replay.payout / 100, settled.payout);
  assert.equal(nonce, 1);
});

test("baccarat settles instantly and matches the fair stream", async (t) => {
  const f = await fixture(t);
  const token = await f.login("Punto");
  const { round } = (await f.request("/api/casino/baccarat", { bets: { player: 100, tie: 10 } }, token)).data;
  assert.equal(round.phase, "settled");
  assert.equal(round.wager, 110);
  await f.assertConserved(token);
  const { previous } = (await f.request("/api/fair/rotate", {}, token)).data.fair;
  const replay = baccaratPlay(fairFloats(previous.serverSeed, previous.clientSeed, 0, BACCARAT_FLOATS), {
    player: 10_000,
    tie: 1_000,
  });
  assert.deepEqual([replay.player, replay.banker, replay.payout / 100], [round.player, round.banker, round.payout]);
  assert.equal((await f.request("/api/casino/baccarat", { bets: {} }, token)).status, 400);
  assert.equal((await f.request("/api/casino/baccarat", { bets: { banker: 0.5 } }, token)).status, 400);
});

test("mines hides the layout, cashes out, busts and enforces one active round", async (t) => {
  const f = await fixture(t);
  const token = await f.login("Miner");
  let { round } = (await f.request("/api/casino/mines/start", { bet: 100, mines: 3 }, token)).data;
  assert.equal(round.layout, undefined);
  assert.equal((await f.request("/api/casino/mines/start", { bet: 100, mines: 3 }, token)).data.error.code, "round_active");
  assert.equal((await f.request("/api/casino/mines/cashout", {}, token)).status, 409);
  const fair = (await f.request("/api/fair", undefined, token)).data.fair;
  assert.equal(fair.nonce, 1);
  for (let tile = 0; tile < 25 && round.phase === "playing" && round.revealed.length < 2; tile++)
    round = (await f.request("/api/casino/mines/reveal", { tile }, token)).data.round;
  if (round.phase === "playing") round = (await f.request("/api/casino/mines/cashout", {}, token)).data.round;
  assert.ok(["cashed", "busted"].includes(round.phase));
  assert.equal(round.layout.length, 3);
  await f.assertConserved(token);
  const { previous } = (await f.request("/api/fair/rotate", {}, token)).data.fair;
  assert.deepEqual(minesLayout(fairFloats(previous.serverSeed, previous.clientSeed, 0, 24), 3), round.layout);
  assert.equal((await f.request("/api/casino/mines/start", { bet: 100, mines: 25 }, token)).status, 400);
});

test("crash settles auto and manual cash-outs by server time and finalizes abandoned rounds", async (t) => {
  const f = await fixture(t);
  const token = await f.login("Pilot");
  let { round } = (await f.request("/api/casino/crash/start", { bet: 100, autoCashout: 2 }, token)).data;
  assert.equal(round.phase, "flying");
  assert.equal(round.crashPoint, undefined);
  f.advance(crashTimeFor(2) + 5);
  round = (await f.request("/api/casino/crash", undefined, token)).data.round;
  assert.notEqual(round.phase, "flying");
  if (round.crashPoint > 2) assert.deepEqual([round.phase, round.cashedAt, round.payout], ["cashed", 2, 200]);
  else assert.deepEqual([round.phase, round.payout], ["crashed", 0]);
  // The finished round stays visible to late polls (maintenance may have settled it first).
  assert.equal((await f.request("/api/casino/crash", undefined, token)).data.round.id, round.id);

  round = (await f.request("/api/casino/crash/start", { bet: 100, autoCashout: null }, token)).data.round;
  f.advance(crashTimeFor(1.5));
  round = (await f.request("/api/casino/crash/cashout", {}, token)).data.round;
  if (round.phase === "cashed") {
    assert.ok(round.cashedAt >= 1.49 && round.cashedAt < round.crashPoint);
    assert.equal(round.payout, Math.floor(10_000 * round.cashedAt) / 100);
  } else assert.ok(round.crashPoint <= 1.5);

  const abandoned = (await f.request("/api/casino/crash/start", { bet: 100, autoCashout: null }, token)).data.round;
  f.advance(crashTimeFor(10_000) + 10);
  await f.tick();
  assert.equal((await f.request("/api/casino/active", undefined, token)).data.crash, null);
  const latest = (await f.request("/api/casino/crash", undefined, token)).data.round;
  assert.equal(latest.id, abandoned.id);
  assert.equal(latest.phase, "crashed");
  const { previous } = (await f.request("/api/fair/rotate", {}, token)).data.fair;
  assert.equal(crashPointFromFloat(fairFloats(previous.serverSeed, previous.clientSeed, 2, 1)[0]), latest.crashPoint);
  assert.equal((await f.profile(token)).totals.plays, 3);
  await f.assertConserved(token);
});

test("bets are validated and wallets cannot go negative", async (t) => {
  const f = await fixture(t);
  const token = await f.login("Broke");
  assert.equal((await f.request("/api/casino/mines/start", { bet: 100_001, mines: 1 }, token)).data.error.code, "insufficient_balance");
  assert.equal((await f.request("/api/casino/crash/start", { bet: 0.5, autoCashout: null }, token)).data.error.code, "invalid_bet");
  assert.equal((await f.request("/api/casino/crash/start", { bet: "100", autoCashout: null }, token)).status, 400);
  assert.equal((await f.request("/api/casino/crash/start", { bet: 100, autoCashout: 1 }, token)).status, 400);
  assert.equal((await f.request("/api/casino/blackjack/start", { bets: [10, 10, 10, 10] }, token)).status, 400);
  assert.equal((await f.request("/api/casino/mines/start", { bet: 100, mines: 3 })).status, 401);
  assert.equal(await f.balanceCents(token), START);
  assert.equal((await f.request("/api/fair", undefined, token)).data.fair.nonce, 0);
});

test("live rocket: shared round, bets, cash-outs, settlement and restart recovery", async (t) => {
  const f = await fixture(t);
  const a = await f.login("Alpha");
  const b = await f.login("Bravo");
  let live = (await f.request("/api/live")).data.live;
  assert.equal(live.phase, "betting");
  assert.equal(live.crashPoint, null);
  assert.equal(live.seed, null);
  assert.equal((await f.request("/api/live/bet", { bet: 100, autoCashout: 1.01 })).status, 401);
  let response = await f.request("/api/live/bet", { bet: 100, autoCashout: 1.01 }, a);
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.me, { bet: 100, autoCashout: 1.01, cashedAt: null, payout: 0 });
  assert.equal((await f.request("/api/live/bet", { bet: 100, autoCashout: null }, a)).data.error.code, "already_bet");
  assert.equal((await f.request("/api/live/bet", { bet: 50, autoCashout: null }, b)).status, 200);
  live = (await f.request("/api/live", undefined, a)).data.live;
  assert.equal(live.bets.length, 2);
  assert.equal((await f.request("/api/live/cashout", {}, b)).data.error.code, "not_flying");

  f.advance(live.startedAt - Date.UTC(2026, 9, 4, 12) + crashTimeFor(1.02));
  const cashout = await f.request("/api/live/cashout", {}, b);
  assert.equal((await f.request("/api/live/bet", { bet: 1, autoCashout: null }, b)).status, 409);
  do {
    live = (await f.request("/api/live")).data.live;
    if (live.phase === "flying") f.advance(1_000); // the crashed window lasts 4 s
  } while (live.phase === "flying");
  assert.equal(live.phase, "crashed");
  assert.equal(sha256Hex(live.seed), live.seedHash);
  assert.equal(liveCrashPoint(live.seed, live.roundId), live.crashPoint);
  const alpha = live.bets.find((bet) => bet.name === "Alpha");
  const bravo = live.bets.find((bet) => bet.name === "Bravo");
  if (live.crashPoint > 1.02) {
    assert.equal(cashout.status, 200);
    assert.ok(bravo.cashedAt >= 1.01 && bravo.cashedAt < live.crashPoint);
  } else assert.equal(bravo.cashedAt, null);
  assert.equal(alpha.cashedAt, live.crashPoint > 1.01 ? 1.01 : null);
  assert.equal(live.history[0].roundId, live.roundId);
  await f.assertConserved(a);
  await f.assertConserved(b);

  // Next round: a bet survives a restart and is settled exactly once.
  f.advance(4_000);
  live = (await f.request("/api/live")).data.live;
  assert.equal(live.phase, "betting");
  assert.equal((await f.request("/api/live/bet", { bet: 20, autoCashout: 1.5 }, a)).status, 200);
  await f.restart();
  f.advance(crashTimeFor(10_000) + 20_000);
  await Promise.all([f.tick(), f.tick()]);
  await f.restart();
  await f.tick();
  const profile = await f.profile(a);
  assert.equal(profile.games.find((game) => game.game === "live-rocket").plays, 2);
  await f.assertConserved(a);
  assert.equal((await f.request("/api/live")).data.live.history.length, 2);
});

test("profile analytics, achievements once, winners and case-battle plays", async (t) => {
  const f = await fixture(t);
  const token = await f.login("Analyst");
  const empty = await f.profile(token);
  assert.deepEqual(empty.totals, { wagered: 0, returned: 0, net: 0, plays: 0, wins: 0 });
  assert.equal(empty.series.length, 0);
  assert.equal(empty.achievements.length, 14);
  const first = (await f.request("/api/casino/baccarat", { bets: { banker: 100 } }, token)).data;
  assert.equal(first.achievements[0].id, "first-play");
  for (let index = 0; index < 4; index++) {
    const next = (await f.request("/api/casino/baccarat", { bets: { player: 100 } }, token)).data;
    assert.ok(!next.achievements?.some((a) => a.id === "first-play"));
  }
  const profile = await f.profile(token);
  assert.equal(profile.totals.plays, 5);
  assert.equal(profile.series.length, 5);
  assert.equal(profile.series.at(-1).net, profile.totals.net);
  assert.equal(profile.favourite.game, "baccarat");
  assert.equal(profile.games[0].plays, 5);
  assert.equal(profile.achievements.find((a) => a.id === "first-play").unlocked, true);
  await f.assertConserved(token);

  // Case battle with a bot records a play for the human seat.
  const { battle } = (
    await f.request("/api/battles", { caseIds: ["nano"], mode: "classic", format: "1", speed: "standard", requestId: "battle-play-01" }, token)
  ).data;
  await f.request(`/api/battles/${battle.id}/bot`, { seat: 1 }, token);
  await f.request(`/api/battles/${battle.id}/start`, {}, token);
  f.advance(1_500);
  await f.tick();
  const after = await f.profile(token);
  assert.equal(after.games.find((game) => game.game === "case-battle").plays, 1);
  await f.assertConserved(token);

  const winners = (await f.request("/api/winners")).data.winners;
  assert.ok(winners.every((w) => w.name === "Analyst" && w.payout > 0 && !("email" in w)));
});

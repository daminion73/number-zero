import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server.js";
import { allocate, winningTeams, makeOutcomes } from "../backend/game.js";
import { CASES } from "../economy.js";
import { evaluateBadges } from "../badges.js";

async function fixture(t, extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), "number-zero-test-"));
  let time = Date.UTC(2026, 8, 29, 12);
  const options = {
    env: {
      DEV_AUTH: "1",
      ROUND_MS: "1000",
      WAITING_MS: "60000",
      ALLOWED_ORIGINS: "https://daminion73.github.io",
      ...extra.env,
    },
    dbPath: join(directory, "test.sqlite"),
    noTimer: true,
    now: () => time,
    ...extra,
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
  async function request(path, body, token, headers = {}) {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, data, headers: response.headers };
  }
  async function login(name) {
    const r = await request("/api/auth/dev", { name });
    assert.equal(r.status, 200);
    return r.data;
  }
  return {
    request,
    login,
    advance: (ms) => {
      time += ms;
    },
    restart: async () => {
      await stop();
      await start();
    },
    tick: () => server.tick(),
  };
}
const definition = (requestId = "test-request-001", overrides = {}) => ({
  caseIds: [CASES[0].id, CASES[1].id],
  mode: "classic",
  format: "1",
  speed: "standard",
  requestId,
  ...overrides,
});

test("public lobby, static allowlist, exact CORS and Google credential rejection", async (t) => {
  const f = await fixture(t, {
    env: {
      GOOGLE_CLIENT_ID: "test-client",
      ALLOWED_ORIGINS: "https://daminion73.github.io",
    },
    googleVerifier: {
      verifyIdToken: async () => {
        throw new Error("invalid signature");
      },
    },
  });
  assert.equal((await f.request("/api/battles")).status, 200);
  for (const path of [
    "/server.js",
    "/backend/store.js",
    "/.env",
    "/.git/config",
    "/data/number-zero.sqlite",
    "/assets/%2e%2e%2fserver.js",
  ])
    assert.equal((await f.request(path)).status, 404, path);
  for (const path of [
    "/",
    "/privacy.html",
    "/experience.js",
    "/multiplayer.js",
    "/config.js",
  ])
    assert.equal((await f.request(path)).status, 200, path);
  const blocked = await f.request("/api/config", undefined, null, {
    Origin: "https://evil.example",
  });
  assert.equal(blocked.status, 403);
  assert.equal(
    (
      await f.request("/api/config", undefined, null, {
        Origin: "http://localhost:1234.evil.example",
      })
    ).status,
    403,
  );
  const allowed = await f.request(
    "/api/auth/google",
    { credential: "forged" },
    null,
    { Origin: "https://daminion73.github.io" },
  );
  assert.equal(allowed.status, 401);
  assert.equal(
    allowed.headers.get("access-control-allow-origin"),
    "https://daminion73.github.io",
  );
  assert.equal(
    (await f.request("/api/auth/dev", { name: "No bypass" })).status,
    404,
  );
});

test("Google identity is keyed by verified subject, sessions revoke and expire", async (t) => {
  const f = await fixture(t, {
    env: { GOOGLE_CLIENT_ID: "test-client" },
    googleVerifier: {
      verifyIdToken: async ({ idToken, audience }) => {
        assert.equal(audience, "test-client");
        if (idToken !== "verified-by-test-double") throw new Error();
        return {
          getPayload: () => ({
            sub: "stable-sub",
            name: "Ada",
            email: "private@example.test",
          }),
        };
      },
    },
  });
  const first = (
    await f.request("/api/auth/google", {
      credential: "verified-by-test-double",
      balance: 99999999,
    })
  ).data;
  assert.equal(first.user.balance, 50000);
  assert.equal(first.user.email, undefined);
  const second = (
    await f.request("/api/auth/google", {
      credential: "verified-by-test-double",
    })
  ).data;
  assert.equal(first.user.id, second.user.id);
  assert.notEqual(first.token, second.token);
  await f.request("/api/auth/logout", {}, first.token);
  assert.equal(
    (await f.request("/api/me", undefined, first.token)).status,
    401,
  );
  assert.equal(
    (await f.request("/api/me", undefined, second.token)).status,
    200,
  );
  f.advance(7 * 86400000);
  assert.equal(
    (await f.request("/api/me", undefined, second.token)).status,
    401,
  );
});

test("development authentication is disabled in production even with DEV_AUTH", async (t) => {
  const f = await fixture(t, {
    env: { DEV_AUTH: "1", NODE_ENV: "production" },
  });
  assert.equal((await f.request("/api/config")).data.devAuth, false);
  assert.equal(
    (await f.request("/api/auth/dev", { name: "Nope" })).status,
    404,
  );
});

test("create is idempotent, validates inputs and never imports client wallet", async (t) => {
  const f = await fixture(t),
    a = await f.login("Host");
  for (const body of [
    null,
    [],
    definition("bad-format", { format: "toString" }),
    definition("bad-case", { caseIds: ["custom-untrusted"] }),
    definition("too-many", { caseIds: Array(21).fill(CASES[0].id) }),
  ])
    assert.equal((await f.request("/api/battles", body, a.token)).status, 400);
  const expensive = CASES.reduce((a, b) => (a.cost > b.cost ? a : b));
  assert.equal(
    (
      await f.request(
        "/api/battles",
        definition("forged-wallet", {
          caseIds: Array(20).fill(expensive.id),
          balance: 1e99,
        }),
        a.token,
      )
    ).status,
    409,
  );
  const [one, two] = await Promise.all([
    f.request("/api/battles", definition(), a.token),
    f.request("/api/battles", definition(), a.token),
  ]);
  assert.equal(one.status, 201);
  assert.equal(one.data.battle.id, two.data.battle.id);
  const entry = Math.round((CASES[0].cost + CASES[1].cost) * 100) / 100;
  assert.equal(one.data.battle.entry, entry);
  assert.equal(
    (await f.request("/api/me", undefined, a.token)).data.user.balance,
    50000 - entry,
  );
  assert.equal(
    (
      await f.request(
        "/api/battles",
        definition("test-request-001", { mode: "crazy" }),
        a.token,
      )
    ).status,
    409,
  );
  assert.equal(
    (await f.request("/api/battles", definition("another-battle"), a.token))
      .status,
    409,
  );
});

test("competing joins reserve last seat once; host-only controls and refunds", async (t) => {
  const f = await fixture(t),
    host = await f.login("Host"),
    a = await f.login("Guest A"),
    b = await f.login("Guest B");
  const { battle } = (await f.request("/api/battles", definition(), host.token))
    .data;
  const path = `/api/battles/${battle.id}`;
  const joins = await Promise.all([
    f.request(path + "/join", { seat: 1 }, a.token),
    f.request(path + "/join", { seat: 1 }, b.token),
  ]);
  assert.deepEqual(joins.map((x) => x.status).sort(), [200, 409]);
  const guest = joins[0].status === 200 ? a : b,
    outsider = guest === a ? b : a;
  assert.equal(
    (await f.request("/api/me", undefined, outsider.token)).data.user.balance,
    50000,
  );
  assert.equal((await f.request(path + "/start", {}, guest.token)).status, 403);
  assert.equal(
    (await f.request(path + "/cancel", {}, guest.token)).status,
    403,
  );
  const publicBattle = (await f.request(path)).data.battle;
  assert.equal(publicBattle.players.length, 2);
  assert.equal(publicBattle.hostId, host.user.id);
  assert.equal(JSON.stringify(publicBattle).includes("google_sub"), false);
  assert.equal((await f.request(path + "/leave", {}, guest.token)).status, 200);
  assert.equal((await f.request(path + "/leave", {}, guest.token)).status, 409);
  assert.equal(
    (await f.request("/api/me", undefined, guest.token)).data.user.balance,
    50000,
  );
  assert.equal(
    (await f.request(path + "/bot", { seat: 1 }, outsider.token)).status,
    403,
  );
  assert.equal(
    (await f.request(path + "/bot", { seat: "1" }, host.token)).status,
    400,
  );
  assert.equal(
    (await f.request(path + "/bot", { seat: 1 }, host.token)).status,
    200,
  );
  assert.equal(
    (await f.request(path + "/remove-bot", { seat: 1 }, host.token)).status,
    200,
  );
  assert.equal((await f.request(path + "/cancel", {}, host.token)).status, 200);
  assert.equal((await f.request(path + "/cancel", {}, host.token)).status, 409);
  assert.equal(
    (await f.request("/api/me", undefined, host.token)).data.user.balance,
    50000,
  );
});

test("daily grant is atomic and uses UTC boundary", async (t) => {
  const f = await fixture(t),
    a = await f.login("Daily");
  const responses = await Promise.all([
    f.request("/api/daily", {}, a.token),
    f.request("/api/daily", {}, a.token),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (await f.request("/api/me", undefined, a.token)).data.user.balance,
    70000,
  );
  f.advance(12 * 3600000 - 1);
  assert.equal((await f.request("/api/daily", {}, a.token)).status, 409);
  f.advance(1);
  assert.equal(
    (await f.request("/api/daily", {}, a.token)).data.user.balance,
    90000,
  );
});

test("hidden future rounds, authoritative results and once-only restart settlement", async (t) => {
  const f = await fixture(t),
    a = await f.login("Host"),
    b = await f.login("Guest");
  const { battle } = (
    await f.request(
      "/api/battles",
      definition("restart-battle", { mode: "share" }),
      a.token,
    )
  ).data;
  const path = `/api/battles/${battle.id}`;
  assert.equal((await f.request(path + "/start", {}, a.token)).status, 409);
  await f.request(path + "/join", { seat: 1 }, b.token);
  const starts = await Promise.all([
    f.request(path + "/start", { scores: [1e99] }, a.token),
    f.request(path + "/start", {}, a.token),
  ]);
  assert.deepEqual(starts.map((r) => r.status).sort(), [200, 409]);
  const hidden = (await f.request(path)).data.battle;
  assert.equal(hidden.rounds.length, 0);
  assert.equal(hidden.payouts, undefined);
  assert.equal(hidden.outcomes, undefined);
  f.advance(999);
  assert.equal((await f.request(path)).data.battle.rounds.length, 0);
  f.advance(1);
  const first = (await f.request(path)).data.battle;
  assert.equal(first.rounds.length, 1);
  assert.equal(first.pot, undefined);
  for (const r of first.rounds[0].results)
    assert.equal(
      r.score,
      evaluateBadges(r.number).reduce((n, badge) => n + badge.score, 0),
    );
  await f.restart();
  f.advance(1000);
  const settled = (await f.request(path)).data.battle;
  assert.equal(settled.state, "settled");
  assert.deepEqual(settled.rounds[0], first.rounds[0]);
  const potCents = settled.rounds
    .flatMap((r) => r.results)
    .reduce((s, r) => s + Math.round(r.payout * 100), 0);
  assert.equal(Math.round(settled.pot * 100), potCents);
  assert.equal(
    settled.payouts.reduce((s, p) => s + Math.round(p.amount * 100), 0),
    potCents,
  );
  const balances = [];
  for (const [index, account] of [a, b].entries()) {
    const me = (await f.request("/api/me", undefined, account.token)).data.user;
    assert.equal(
      Math.round(me.balance * 100),
      5000000 -
        Math.round(battle.entry * 100) +
        Math.round(settled.payouts[index].amount * 100),
    );
    assert.equal(me.battlesPlayed, 1);
    assert.equal(me.wins, 0);
    balances.push(me.balance);
  }
  await f.restart();
  await Promise.all([f.tick(), f.tick()]);
  assert.equal(
    (await f.request("/api/me", undefined, a.token)).data.user.balance,
    balances[0],
  );
});

test("expired waiting lobbies refund after restart without requiring a player action", async (t) => {
  const f = await fixture(t),
    a = await f.login("Host"),
    b = await f.login("Guest");
  const { battle } = (await f.request("/api/battles", definition(), a.token))
    .data;
  await f.request(`/api/battles/${battle.id}/join`, { seat: 1 }, b.token);
  await f.restart();
  f.advance(60000);
  await Promise.all([f.tick(), f.tick()]);
  assert.equal(
    (await f.request(`/api/battles/${battle.id}`)).data.battle.state,
    "expired",
  );
  assert.equal(
    (await f.request("/api/me", undefined, a.token)).data.user.balance,
    50000,
  );
  assert.equal(
    (await f.request("/api/me", undefined, b.token)).data.user.balance,
    50000,
  );
});

test("asymmetric team mode semantics and cent-conserving ties exclude losing seats", () => {
  const teams = [
    [0, 1],
    [2, 3],
    [4, 5],
  ];
  const outcomes = [
    [90, 1, 50, 50, 0, 0],
    [1, 1, 1, 1, 20, 25],
  ].map((values) => values.map((score, seat) => ({ score, seat, payout: 17 })));
  assert.deepEqual(winningTeams("classic", outcomes, teams), [1]);
  assert.deepEqual(winningTeams("crazy", outcomes, teams), [2]);
  assert.deepEqual(winningTeams("clutch", outcomes, teams), [0]);
  assert.deepEqual(winningTeams("terminal", outcomes, teams), [2]);
  const tied = {
    mode: "classic",
    teams: [[0], [1], [2]],
    players: [0, 1, 2].map((seat) => ({ seat })),
    outcomes: [
      [
        { score: 20, payout: 11 },
        { score: 20, payout: 13 },
        { score: 1, payout: 17 },
      ],
    ],
  };
  assert.deepEqual(allocate(tied), {
    pot: 41,
    winningTeams: [0, 1],
    payouts: [
      { seat: 0, amount: 21 },
      { seat: 1, amount: 20 },
      { seat: 2, amount: 0 },
    ],
  });
  assert.deepEqual(
    allocate({ ...tied, mode: "share" }).payouts.map((p) => p.amount),
    [14, 14, 13],
  );
});

test("bot shares are not paid to humans; manual bots work in a six-seat format", async (t) => {
  const f = await fixture(t),
    a = await f.login("Host");
  const { battle } = (
    await f.request(
      "/api/battles",
      definition("six-seat-test", {
        mode: "share",
        format: "3v3",
        caseIds: [CASES[0].id],
      }),
      a.token,
    )
  ).data;
  const path = `/api/battles/${battle.id}`;
  for (let seat = 1; seat < 6; seat++)
    assert.equal(
      (await f.request(path + "/bot", { seat }, a.token)).status,
      200,
    );
  assert.equal((await f.request(path + "/start", {}, a.token)).status, 200);
  f.advance(1000);
  const settled = (await f.request(path)).data.battle;
  assert.equal(settled.players.filter((p) => p.bot).length, 5);
  assert.equal(
    Math.round(
      (await f.request("/api/me", undefined, a.token)).data.user.balance * 100,
    ),
    5000000 -
      Math.round(battle.entry * 100) +
      Math.round(settled.payouts[0].amount * 100),
  );
});

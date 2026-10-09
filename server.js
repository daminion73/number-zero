import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash, randomBytes, randomInt as cryptoRandomInt, randomUUID } from "node:crypto";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { OAuth2Client } from "google-auth-library";
import { openStore, transaction } from "./backend/store.js";
import { createCasino } from "./backend/casino.js";
import { recordPlay } from "./backend/achievements.js";
import { createLive } from "./backend/live.js";
import { createLiveRoulette } from "./backend/live-roulette.js";
import { createRooms } from "./backend/rooms.js";
import { ROOM_ENGINES } from "./backend/rooms/index.js";
import { loadProfile, loadWinners } from "./backend/profile.js";
import { COLUMNS, COSMETIC_KINDS, cosmetic, lookOf, ownedKeys } from "./backend/cosmetics.js";
import {
  BOT_NAMES,
  FORMATS,
  MODES,
  allocate,
  caseMap,
  makeOutcomes,
  toCents,
} from "./backend/game.js";

const ROOT = import.meta.dirname;
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".bin": "application/octet-stream",
};
const publicFiles = new Set([
  "index.html",
  "privacy.html",
  "app.js",
  "economy.js",
  "badges.js",
  "styles.css",
  "multiplayer.js",
  "multiplayer.css",
  "config.js",
  "casino-core.js",
  "cosmetics.js",
  "cosmetics.css",
  "casino-demo.js",
  "casino.js",
  "casino.css",
  "home.js",
  "home.css",
  "profile.js",
  "profile.css",
]);
const hash = (token) => createHash("sha256").update(token).digest("hex");
const credits = (cents) => cents / 100;
const loopback = (address) =>
  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    Object.assign(this, { status, code, extra });
  }
}

export async function createServer(options = {}) {
  const env = options.env || process.env,
    now = options.now || Date.now;
  const devAuth = env.DEV_AUTH === "1" && env.NODE_ENV !== "production";
  const roundMs = Math.max(100, Number(env.ROUND_MS || 4000));
  const waitingMs = Math.max(1000, Number(env.WAITING_MS || 900000));
  if (!Number.isFinite(roundMs) || !Number.isFinite(waitingMs))
    throw new Error("Invalid round or waiting duration");
  if (env.RENDER === "true" && !env.TURSO_DATABASE_URL)
    throw new Error(
      "Render requires TURSO_DATABASE_URL; local storage is ephemeral",
    );
  const db = await openStore(
    options.dbPath ||
      env.DATABASE_PATH ||
      join(ROOT, "data", "number-zero.sqlite"),
    { url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN },
  );
  const googleClientId = env.GOOGLE_CLIENT_ID || "";
  const google = options.googleVerifier || new OAuth2Client(googleClientId);
  const origins = new Set(
    (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );
  for (const value of origins)
    if (new URL(value).origin !== value)
      throw new Error(
        "ALLOWED_ORIGINS must contain exact origins, without paths",
      );
  const rates = new Map();
  const publicUser = (row) => ({
    id: String(row.id),
    name: row.name,
    balance: credits(row.balance_cents),
    battlesPlayed: row.battles_played,
    wins: row.wins,
    look: lookOf(row),
    dailyAvailable:
      row.daily_day !== new Date(now()).toISOString().slice(0, 10),
  });
  const fail = (status, code, message, extra) =>
    new ApiError(status, code, message, extra);
  const casino = createCasino({ db, now, publicUser, fail });
  const live = await createLive({ db, now, publicUser, fail });
  const liveRoulette = await createLiveRoulette({ db, now, publicUser, fail });
  const rooms = await createRooms({ db, now, publicUser, fail, engines: ROOM_ENGINES, timers: !options.noTimer });
  // Coinflips moved into rooms: refund any stake still held by the old open-flip lobby.
  await transaction(db, async (tx) => {
    for (const row of (await tx.execute("SELECT id, creator_id, data FROM coinflips WHERE state='open'")).rows) {
      await tx.execute({ sql: "UPDATE users SET balance_cents=balance_cents+? WHERE id=?", args: [JSON.parse(row.data).betCents, row.creator_id] });
      await tx.execute({ sql: "UPDATE coinflips SET state='cancelled', updated_at=? WHERE id=?", args: [now(), row.id] });
    }
  });

  async function auth(req) {
    const match = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(
      req.headers.authorization || "",
    );
    if (!match)
      throw new ApiError(
        401,
        "unauthorized",
        "Sign in to use your online account.",
      );
    const row = (
      await db.execute({
        sql: "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.revoked=0 AND s.expires_at>?",
        args: [hash(match[1]), now()],
      })
    ).rows[0];
    if (!row)
      throw new ApiError(
        401,
        "unauthorized",
        "Your session expired. Please sign in again.",
      );
    return row;
  }
  async function activeFor(store, userId, except) {
    for (const row of (
      await store.execute(
        "SELECT id,data FROM battles WHERE state IN ('waiting','running')",
      )
    ).rows) {
      if (
        row.id !== except &&
        JSON.parse(row.data).players.some((p) => p.userId === userId)
      )
        return row.id;
    }
    return null;
  }
  const save = (store, battle) =>
    store.execute({
      sql: "UPDATE battles SET state=?,data=?,updated_at=? WHERE id=?",
      args: [battle.state, JSON.stringify(battle), now(), battle.id],
    });
  async function refund(store, battle) {
    if (battle.refunded) return;
    for (const p of battle.players.filter((p) => !p.bot))
      await store.execute({
        sql: "UPDATE users SET balance_cents=balance_cents+? WHERE id=?",
        args: [battle.entryCents, p.userId],
      });
    battle.refunded = true;
  }
  let ticking;
  function tick() {
    if (ticking) return ticking;
    ticking = (async () => {
      await casino.maintenance();
      await live.maintenance();
      await liveRoulette.maintenance();
      await rooms.maintenance();
      const rows = (
        await db.execute(
          "SELECT id,data FROM battles WHERE state IN ('waiting','running')",
        )
      ).rows;
      for (const row of rows) {
        const candidate = JSON.parse(row.data);
        if (
          now() <
          (candidate.state === "waiting"
            ? candidate.createdAt + waitingMs
            : candidate.endsAt)
        )
          continue;
        // One transaction per due battle keeps remote transactions short.
        await transaction(db, async (tx) => {
          const battle = await load(tx, row.id);
          if (
            battle.state === "waiting" &&
            now() >= battle.createdAt + waitingMs
          ) {
            await refund(tx, battle);
            battle.state = "expired";
            battle.endedAt = now();
            await save(tx, battle);
          } else if (battle.state === "running" && now() >= battle.endsAt) {
            const result = allocate(battle);
            Object.assign(battle, result, {
              settled: true,
              state: "settled",
              endedAt: battle.endsAt,
            });
            for (const p of battle.players) {
              if (!p.bot) {
                await tx.execute({
                  sql: "UPDATE users SET balance_cents=balance_cents+?, battles_played=battles_played+1, wins=wins+? WHERE id=?",
                  args: [
                    result.payouts[p.seat].amount,
                    battle.mode !== "share" &&
                    result.winningTeams.includes(p.team)
                      ? 1
                      : 0,
                    p.userId,
                  ],
                });
                await recordPlay(tx, {
                  userId: p.userId,
                  game: "case-battle",
                  wager: battle.entryCents,
                  payout: result.payouts[p.seat].amount,
                  at: battle.endsAt,
                  won:
                    battle.mode !== "share" &&
                    result.winningTeams.includes(p.team),
                });
              }
            }
            await save(tx, battle);
          }
        });
      }
    })().finally(() => {
      ticking = null;
    });
    return ticking;
  }
  const timer = options.noTimer
    ? null
    : setInterval(
        async () => {
          try {
            await tick();
          } catch (error) {
            console.error("Battle maintenance failed", error.message);
          }
        },
        Math.min(5000, roundMs),
      ).unref();
  async function load(store, id) {
    const row = (
      await store.execute({
        sql: "SELECT data FROM battles WHERE id=?",
        args: [id],
      })
    ).rows[0];
    if (!row) throw new ApiError(404, "not_found", "Battle not found.");
    return JSON.parse(row.data);
  }
  function snapshot(battle) {
    const interval = battle.intervalMs || roundMs;
    const visible =
      battle.state === "running"
        ? Math.max(
            0,
            Math.min(
              battle.caseIds.length,
              Math.floor((now() - battle.startedAt) / interval),
            ),
          )
        : battle.state === "settled"
          ? battle.caseIds.length
          : 0;
    return {
      id: battle.id,
      hostId: String(battle.hostId),
      state: battle.state,
      mode: battle.mode,
      format: battle.format,
      speed: battle.speed,
      teams: battle.teams,
      caseIds: battle.caseIds,
      entry: credits(battle.entryCents),
      createdAt: battle.createdAt,
      expiresAt: battle.createdAt + waitingMs,
      startedAt: battle.startedAt || null,
      endsAt: battle.endsAt || null,
      endedAt: battle.endedAt || null,
      intervalMs: interval,
      players: battle.players.map(({ userId, ...player }) => ({
        ...player,
        id: userId ? String(userId) : null,
      })),
      rounds: (battle.outcomes || []).slice(0, visible).map((round, index) => ({
        index,
        caseId: battle.caseIds[index],
        scheduledAt: battle.startedAt + (index + 1) * interval,
        results: round.map((r) => ({ ...r, payout: credits(r.payout) })),
      })),
      ...(battle.settled
        ? {
            pot: credits(battle.pot),
            winningTeams: battle.winningTeams,
            payouts: battle.payouts.map((p) => ({
              ...p,
              amount: credits(p.amount),
            })),
          }
        : {}),
    };
  }
  async function body(req) {
    if (!(req.headers["content-type"] || "").startsWith("application/json"))
      throw new ApiError(415, "content_type", "Use application/json.");
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16384)
        throw new ApiError(413, "body_too_large", "Request exceeds 16 KiB.");
      chunks.push(chunk);
    }
    let value;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    } catch {
      throw new ApiError(400, "invalid_json", "Body must be valid JSON.");
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new ApiError(400, "invalid_json", "Body must be an object.");
    return value;
  }
  function allowedOrigin(req) {
    const value = req.headers.origin;
    if (!value) return null;
    try {
      const parsed = new URL(value);
      if (
        origins.has(value) ||
        (["http:", "https:"].includes(parsed.protocol) &&
          parsed.host === req.headers.host)
      )
        return value;
    } catch {}
    throw new ApiError(403, "origin_forbidden", "Origin is not allowed.");
  }
  function send(res, status, data, originValue) {
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin",
    };
    if (originValue) {
      headers["Access-Control-Allow-Origin"] = originValue;
      headers.Vary = "Origin";
    }
    res.writeHead(status, headers).end(JSON.stringify(data));
  }
  async function login(res, originValue, subject, name) {
    const result = await transaction(db, async (tx) => {
      let user = (
        await tx.execute({
          sql: "SELECT * FROM users WHERE google_sub=?",
          args: [subject],
        })
      ).rows[0];
      if (!user) {
        await tx.execute({
          sql: "INSERT INTO users(google_sub,name,balance_cents) VALUES(?,?,10000000)",
          args: [subject, name],
        });
        user = (
          await tx.execute({
            sql: "SELECT * FROM users WHERE google_sub=?",
            args: [subject],
          })
        ).rows[0];
      }
      const token = randomBytes(32).toString("base64url"),
        expiresAt = now() + 7 * 86400000;
      await tx.execute({
        sql: "DELETE FROM sessions WHERE expires_at<=? OR revoked=1",
        args: [now()],
      });
      await tx.execute({
        sql: "INSERT INTO sessions VALUES(?,?,?,0)",
        args: [hash(token), user.id, expiresAt],
      });
      return { token, user: publicUser(user), expiresAt };
    });
    send(res, 200, result, originValue);
  }
  async function roomsApi(req, res, url, originValue) {
    const viewer = () => (req.headers.authorization ? auth(req).catch(() => null) : null);
    if (req.method === "GET" && url.pathname === "/api/rooms")
      return send(res, 200, await rooms.list(url.searchParams.get("game") || null), originValue);
    const roomGet = /^\/api\/rooms\/([A-Za-z0-9-]{1,64})$/.exec(url.pathname);
    if (req.method === "GET" && roomGet) return send(res, 200, await rooms.get(roomGet[1], await viewer()), originValue);
    const roomStream = /^\/api\/rooms\/([A-Za-z0-9-]{1,64})\/stream$/.exec(url.pathname);
    if (req.method === "GET" && roomStream) {
      // Server-sent events: the room is pushed on every change instead of being polled.
      const write = (payload) => {
        if (res.writableEnded) return;
        if (!res.headersSent)
          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-store, no-transform",
            "X-Accel-Buffering": "no",
            "X-Content-Type-Options": "nosniff",
            ...(originValue ? { "Access-Control-Allow-Origin": originValue, Vary: "Origin" } : {}),
          });
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };
      const stop = await rooms.watch(roomStream[1], await viewer(), write, () => res.end());
      const heartbeat = setInterval(() => res.writableEnded || res.write(": ping\n\n"), 20_000);
      heartbeat.unref?.();
      const done = () => {
        clearInterval(heartbeat);
        stop();
      };
      res.on("close", done);
      if (res.destroyed) done();
      return;
    }
    const user = await auth(req);
    if (req.method === "POST" && url.pathname === "/api/rooms")
      return send(res, 201, await rooms.create(user, await body(req)), originValue);
    const roomAction = /^\/api\/rooms\/([A-Za-z0-9-]{1,64})\/(join|leave|bot|kick|start|close|act)$/.exec(url.pathname);
    if (req.method === "POST" && roomAction)
      return send(res, 200, await rooms.act(user, roomAction[1], roomAction[2], await body(req)), originValue);
    throw new ApiError(404, "not_found", "Not found.");
  }

  async function api(req, res, url, originValue) {
    const minute = Math.floor(now() / 60000),
      authRoute = url.pathname.startsWith("/api/auth/");
    for (const [key, value] of rates)
      if (value.minute !== minute) rates.delete(key);
    const key = `${req.socket.remoteAddress}:${authRoute ? "auth" : "api"}`;
    const rate = rates.get(key) || { minute, count: 0 };
    rates.set(key, rate);
    if (++rate.count > (authRoute ? 30 : 1200))
      throw new ApiError(
        429,
        "rate_limited",
        "Too many requests. Please wait a minute.",
      );
    if (req.method === "OPTIONS") {
      res
        .writeHead(204, {
          ...(originValue
            ? { "Access-Control-Allow-Origin": originValue }
            : {}),
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          Vary: "Origin",
        })
        .end();
      return;
    }
    // Rooms keep their own clocks (per-room wakeups + maintenance), so table traffic skips the global sweep.
    if (url.pathname.startsWith("/api/rooms")) return roomsApi(req, res, url, originValue);
    await tick();
    if (req.method === "GET" && url.pathname === "/api/config")
      return send(res, 200, { googleClientId, devAuth, roundMs }, originValue);
    if (req.method === "POST" && url.pathname === "/api/auth/google") {
      if (!googleClientId)
        throw new ApiError(
          503,
          "google_not_configured",
          "Google sign-in has not been configured on this server.",
        );
      const b = await body(req);
      if (typeof b.credential !== "string" || b.credential.length > 12000)
        throw new ApiError(
          400,
          "invalid_credential",
          "A Google credential is required.",
        );
      let payload;
      try {
        payload = (
          await google.verifyIdToken({
            idToken: b.credential,
            audience: googleClientId,
          })
        ).getPayload();
      } catch {
        throw new ApiError(
          401,
          "invalid_credential",
          "Google ID token is invalid.",
        );
      }
      if (!payload?.sub)
        throw new ApiError(
          401,
          "invalid_credential",
          "Google identity could not be verified.",
        );
      return login(
        res,
        originValue,
        `google:${payload.sub}`,
        String(payload.name || "Player").slice(0, 40),
      );
    }
    if (req.method === "POST" && url.pathname === "/api/auth/dev") {
      if (!devAuth || !loopback(req.socket.remoteAddress))
        throw new ApiError(404, "not_found", "Not found.");
      const b = await body(req),
        name = typeof b.name === "string" ? b.name.trim() : "";
      if (!/^[\p{L}\p{N}_ .-]{1,40}$/u.test(name))
        throw new ApiError(
          400,
          "invalid_name",
          "Use 1–40 letters, numbers, spaces or . _ -.",
        );
      return login(res, originValue, `dev:${name.toLowerCase()}`, name);
    }
    if (req.method === "GET" && url.pathname === "/api/battles") {
      const battles = (
        await db.execute(
          "SELECT data FROM battles ORDER BY CASE WHEN state IN ('waiting','running') THEN 0 ELSE 1 END, created_at DESC LIMIT 100",
        )
      ).rows.map((r) => snapshot(JSON.parse(r.data)));
      return send(res, 200, { battles, serverTime: now() }, originValue);
    }
    if (req.method === "GET" && url.pathname === "/api/winners")
      return send(
        res,
        200,
        { winners: await loadWinners(db, now()), serverTime: now() },
        originValue,
      );
    if (req.method === "GET" && url.pathname === "/api/live") {
      const viewer = req.headers.authorization ? await auth(req) : null;
      return send(res, 200, await live.handle(null, viewer), originValue);
    }
    if (req.method === "GET" && url.pathname === "/api/live-roulette") {
      const viewer = req.headers.authorization ? await auth(req) : null;
      return send(res, 200, await liveRoulette.handle(null, viewer), originValue);
    }
    const match =
      /^\/api\/battles\/([^/]+)(?:\/(join|bot|remove-bot|leave|cancel|start))?$/.exec(
        url.pathname,
      );
    if (req.method === "GET" && match && !match[2])
      return send(
        res,
        200,
        { battle: snapshot(await load(db, match[1])), serverTime: now() },
        originValue,
      );
    const user = await auth(req);
    const liveAction = /^\/api\/live\/(bet|cashout)$/.exec(url.pathname);
    if (req.method === "POST" && liveAction)
      return send(
        res,
        200,
        await live.handle(liveAction[1], user, await body(req)),
        originValue,
      );
    if (req.method === "POST" && url.pathname === "/api/live-roulette/bet")
      return send(res, 200, await liveRoulette.handle("bet", user, await body(req)), originValue);
    if (
      url.pathname.startsWith("/api/casino/") ||
      url.pathname.startsWith("/api/fair")
    ) {
      const payload = req.method === "POST" ? await body(req) : {};
      const pending = casino.handle(req.method, url.pathname, user, payload);
      if (pending) return send(res, 200, await pending, originValue);
    }
    if (req.method === "POST" && url.pathname === "/api/profile/cosmetics") {
      // Equip (or with id null, unequip) an owned profile picture, frame, name colour or title.
      const { kind, id } = await body(req);
      if (!COSMETIC_KINDS.includes(kind)) throw fail(400, "invalid_kind", "Unknown cosmetic type.");
      if (id !== null) {
        if (typeof id !== "string" || !cosmetic(kind, id)) throw fail(400, "invalid_cosmetic", "Unknown cosmetic.");
        const unlocked = (await db.execute({ sql: "SELECT id FROM achievements WHERE user_id=?", args: [user.id] })).rows.map((row) => row.id);
        if (!ownedKeys(unlocked).has(`${kind}:${id}`)) throw fail(403, "locked", "Unlock it with its achievement first.");
      }
      await transaction(db, (tx) => tx.execute({ sql: `UPDATE users SET ${COLUMNS[kind]}=? WHERE id=?`, args: [id, user.id] }));
      const row = (await db.execute({ sql: "SELECT * FROM users WHERE id=?", args: [user.id] })).rows[0];
      return send(res, 200, { profile: await loadProfile(db, row, publicUser), user: publicUser(row), serverTime: now() }, originValue);
    }
    if (req.method === "GET" && url.pathname === "/api/profile")
      return send(
        res,
        200,
        { profile: await loadProfile(db, user, publicUser), serverTime: now() },
        originValue,
      );
    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      await transaction(db, (tx) =>
        tx.execute({
          sql: "UPDATE sessions SET revoked=1 WHERE hash=?",
          args: [hash(req.headers.authorization.slice(7))],
        }),
      );
      return send(res, 200, { ok: true }, originValue);
    }
    if (req.method === "GET" && url.pathname === "/api/me")
      return send(
        res,
        200,
        {
          user: publicUser(user),
          activeBattleId: await activeFor(db, user.id),
        },
        originValue,
      );
    if (req.method === "POST" && url.pathname === "/api/daily") {
      const day = new Date(now()).toISOString().slice(0, 10);
      const fresh = await transaction(db, async (tx) => {
        const result = await tx.execute({
          sql: "UPDATE users SET balance_cents=balance_cents+10000000,daily_day=? WHERE id=? AND (daily_day IS NULL OR daily_day<>?)",
          args: [day, user.id, day],
        });
        if (!result.rowsAffected)
          throw new ApiError(
            409,
            "daily_claimed",
            "Online daily credits already claimed. Resets at 00:00 UTC.",
          );
        return (
          await tx.execute({
            sql: "SELECT * FROM users WHERE id=?",
            args: [user.id],
          })
        ).rows[0];
      });
      return send(
        res,
        200,
        { granted: 100000, user: publicUser(fresh) },
        originValue,
      );
    }
    if (req.method === "POST" && url.pathname === "/api/battles") {
      const b = await body(req);
      if (
        !Array.isArray(b.caseIds) ||
        !b.caseIds.length ||
        b.caseIds.length > 20 ||
        b.caseIds.some((id) => typeof id !== "string" || !caseMap.has(id))
      )
        throw new ApiError(
          400,
          "invalid_cases",
          "Choose 1–20 built-in cases for online battles.",
        );
      if (
        !MODES.has(b.mode) ||
        !Object.hasOwn(FORMATS, b.format) ||
        !["standard", "turbo"].includes(b.speed) ||
        typeof b.requestId !== "string" ||
        !/^[A-Za-z0-9_-]{8,80}$/.test(b.requestId)
      )
        throw new ApiError(
          400,
          "invalid_battle",
          "Invalid mode, format, speed or request ID.",
        );
      const battle = await transaction(db, async (tx) => {
        const previous = (
          await tx.execute({
            sql: "SELECT data FROM battles WHERE host_id=? AND request_id=?",
            args: [user.id, b.requestId],
          })
        ).rows[0];
        if (previous) {
          const old = JSON.parse(previous.data);
          if (
            JSON.stringify(old.caseIds) !== JSON.stringify(b.caseIds) ||
            old.mode !== b.mode ||
            old.format !== b.format ||
            old.speed !== b.speed
          )
            throw new ApiError(
              409,
              "request_conflict",
              "This request ID belongs to a different battle.",
            );
          return old;
        }
        const active = await activeFor(tx, user.id);
        if (active)
          throw new ApiError(
            409,
            "active_battle",
            "You already have an active battle.",
            { battleId: active },
          );
        const entryCents = b.caseIds.reduce(
          (sum, id) => sum + toCents(caseMap.get(id).cost),
          0,
        );
        const debit = await tx.execute({
          sql: "UPDATE users SET balance_cents=balance_cents-? WHERE id=? AND balance_cents>=?",
          args: [entryCents, user.id, entryCents],
        });
        if (!debit.rowsAffected)
          throw new ApiError(
            409,
            "insufficient_balance",
            "Not enough online credits. Practice credits cannot be used online.",
          );
        const id = randomUUID(),
          createdAt = now();
        const out = {
          id,
          hostId: user.id,
          requestId: b.requestId,
          state: "waiting",
          mode: b.mode,
          format: b.format,
          speed: b.speed,
          teams: FORMATS[b.format],
          caseIds: b.caseIds,
          entryCents,
          createdAt,
          players: [
            { seat: 0, userId: user.id, name: user.name, look: lookOf(user), bot: false, team: 0 },
          ],
        };
        await tx.execute({
          sql: "INSERT INTO battles VALUES(?,?,?,?,?,?,?)",
          args: [
            id,
            user.id,
            b.requestId,
            "waiting",
            JSON.stringify(out),
            createdAt,
            createdAt,
          ],
        });
        return out;
      });
      return send(
        res,
        201,
        { battle: snapshot(battle), serverTime: now() },
        originValue,
      );
    }
    if (!match) throw new ApiError(404, "not_found", "Not found.");
    const [, id, action] = match;
    if (req.method !== "POST" || !action)
      throw new ApiError(405, "method_not_allowed", "Method not allowed.");
    const b = await body(req);
    const updated = await transaction(db, async (tx) => {
      const battle = await load(tx, id),
        host = battle.hostId === user.id;
      if (battle.state !== "waiting")
        throw new ApiError(
          409,
          "not_waiting",
          "This battle is no longer waiting. Refresh to see its current state.",
        );
      const max = battle.teams.flat().length;
      if (action === "cancel") {
        if (!host)
          throw new ApiError(403, "host_only", "Only the host can cancel.");
        await refund(tx, battle);
        battle.state = "cancelled";
        battle.endedAt = now();
      } else if (action === "leave") {
        const index = battle.players.findIndex((p) => p.userId === user.id);
        if (index < 0)
          throw new ApiError(
            409,
            "not_participant",
            "You have not joined this battle.",
          );
        if (host)
          throw new ApiError(
            409,
            "host_must_cancel",
            "As host, cancel to refund all players.",
          );
        await tx.execute({
          sql: "UPDATE users SET balance_cents=balance_cents+? WHERE id=?",
          args: [battle.entryCents, user.id],
        });
        battle.players.splice(index, 1);
      } else if (action === "start") {
        if (!host)
          throw new ApiError(403, "host_only", "Only the host can start.");
        if (battle.players.length !== max)
          throw new ApiError(
            409,
            "seats_not_full",
            "Fill every seat with a player or bot first.",
          );
      } else {
        const seat = b.seat;
        if (!Number.isInteger(seat) || seat < 0 || seat >= max)
          throw new ApiError(400, "invalid_seat", "Choose a valid seat.");
        const occupied = battle.players.find((p) => p.seat === seat);
        if (action === "remove-bot") {
          if (!host)
            throw new ApiError(
              403,
              "host_only",
              "Only the host can remove bots.",
            );
          if (!occupied?.bot)
            throw new ApiError(
              409,
              "not_bot",
              "That seat does not contain a bot.",
            );
          battle.players = battle.players.filter((p) => p.seat !== seat);
        } else {
          if (occupied)
            throw new ApiError(
              409,
              "seat_taken",
              "Another player has already taken this seat.",
            );
          const team = battle.teams.findIndex((t) => t.includes(seat));
          if (action === "bot") {
            if (!host)
              throw new ApiError(
                403,
                "host_only",
                "Only the host can add bots.",
              );
            const taken = new Set(battle.players.map((p) => p.name));
            const names = BOT_NAMES.filter((name) => !taken.has(name));
            battle.players.push({
              seat,
              name: names[(options.randomInt || cryptoRandomInt)(names.length)],
              bot: true,
              team,
            });
          } else {
            if (battle.players.some((p) => p.userId === user.id))
              throw new ApiError(
                409,
                "already_joined",
                "You already have a seat.",
              );
            const active = await activeFor(tx, user.id, id);
            if (active)
              throw new ApiError(
                409,
                "active_battle",
                "You already have an active battle.",
                { battleId: active },
              );
            const debit = await tx.execute({
              sql: "UPDATE users SET balance_cents=balance_cents-? WHERE id=? AND balance_cents>=?",
              args: [battle.entryCents, user.id, battle.entryCents],
            });
            if (!debit.rowsAffected)
              throw new ApiError(
                409,
                "insufficient_balance",
                "Not enough online credits.",
              );
            battle.players.push({
              seat,
              userId: user.id,
              name: user.name,
              look: lookOf(user),
              bot: false,
              team,
            });
          }
        }
      }
      // A lobby starts by itself as soon as every seat holds a player or bot.
      if (battle.state === "waiting" && battle.players.length === max) {
        battle.players.sort((a, b) => a.seat - b.seat);
        battle.outcomes = makeOutcomes(battle, options.randomInt);
        battle.state = "running";
        battle.startedAt = now();
        battle.intervalMs =
          battle.speed === "turbo"
            ? Math.max(100, Math.floor(roundMs / 2))
            : roundMs;
        battle.endsAt =
          battle.startedAt + battle.intervalMs * battle.caseIds.length;
      }
      await save(tx, battle);
      return battle;
    });
    send(
      res,
      200,
      { battle: snapshot(updated), serverTime: now() },
      originValue,
    );
  }
  const server = createHttpServer(async (req, res) => {
    let originValue;
    try {
      if (devAuth && !loopback(req.socket.remoteAddress))
        throw new ApiError(
          403,
          "development_only",
          "Development server accepts loopback clients only.",
        );
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        originValue = allowedOrigin(req);
        return await api(req, res, url, originValue);
      }
      if (!["GET", "HEAD"].includes(req.method))
        throw new ApiError(405, "method_not_allowed", "Method not allowed.");
      const safe = decodeURIComponent(
        url.pathname === "/" ? "/index.html" : url.pathname,
      ).slice(1);
      if (
        (!publicFiles.has(safe) &&
          !/^(assets|fonts)\/[A-Za-z0-9_./-]+$/.test(safe) && !/^games\/[a-z-]+\.(js|css)$/.test(safe)) ||
        safe.split("/").includes("..") ||
        safe.includes("\\")
      )
        throw new ApiError(404, "not_found", "Not found.");
      const data = await readFile(join(ROOT, safe));
      const policy = `default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com ${[...origins].join(" ")}; img-src 'self' data: https://*.googleusercontent.com; style-src 'self' 'unsafe-inline' https://accounts.google.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`;
      res
        .writeHead(200, {
          "Content-Type": types[extname(safe)] || "application/octet-stream",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "strict-origin-when-cross-origin",
          "Content-Security-Policy": policy,
          "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
        })
        .end(req.method === "HEAD" ? undefined : data);
    } catch (error) {
      const e =
        error instanceof ApiError
          ? error
          : new ApiError(
              error.code === "ENOENT" ? 404 : 500,
              error.code === "ENOENT" ? "not_found" : "internal_error",
              error.code === "ENOENT"
                ? "Not found."
                : "Server error. Please retry.",
            );
      if (e.status === 500) console.error(error);
      if (!res.headersSent)
        send(
          res,
          e.status,
          { error: { code: e.code, message: e.message, ...e.extra } },
          originValue,
        );
    }
  });
  server.requestTimeout = 15000;
  server.db = db;
  server.tick = tick;
  server.endStreams = () => rooms.shutdown();
  server.closeDatabase = async () => {
    if (timer) clearInterval(timer);
    rooms.shutdown();
    try {
      await ticking;
    } finally {
      db.close();
    }
  };
  return server;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const dev =
    process.env.DEV_AUTH === "1" && process.env.NODE_ENV !== "production";
  const host = dev ? "127.0.0.1" : process.env.HOST || "0.0.0.0",
    port = Number(process.env.PORT || 4173);
  const server = await createServer();
  server.listen(port, host, () =>
    console.log(`NUMBER//ZERO running at http://${host}:${port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      server.close(async () => {
        await server.closeDatabase();
        process.exit(0);
      });
      server.endStreams(); // open room streams would otherwise hold the server open
    });
}

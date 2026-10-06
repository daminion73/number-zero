// Server-authoritative single-player originals (Blackjack, Baccarat, Mines, Crash, Roulette,
// Dice, Plinko, Keno, Video Poker, Slots) with
// per-user provably-fair seeds. All game rules come from the shared casino-core.js.
import { randomBytes, randomUUID } from "node:crypto";
import {
  BACCARAT_FLOATS,
  BLACKJACK_FLOATS,
  DICE_FLOATS,
  KENO_FLOATS,
  MINES_FLOATS,
  PLINKO_FLOATS,
  ROULETTE_FLOATS,
  SLOT_FLOATS,
  VIDEO_POKER_FLOATS,
  diceRoll,
  kenoPlay,
  plinkoDrop,
  rouletteSpin,
  slotsSpin,
  videoPokerDraw,
  videoPokerStart,
  baccaratPlay,
  blackjackAction,
  blackjackCost,
  blackjackStart,
  clientView,
  crashCashout,
  crashSettle,
  crashStart,
  fairFloats,
  minesCashout,
  minesReveal,
  minesStart,
  roundFinished,
  sha256Hex,
} from "../casino-core.js";
import { transaction } from "./store.js";
import { recordPlay } from "./achievements.js";

const FLOAT_COUNTS = {
  blackjack: BLACKJACK_FLOATS, baccarat: BACCARAT_FLOATS, mines: MINES_FLOATS, crash: 1, roulette: ROULETTE_FLOATS,
  dice: DICE_FLOATS, plinko: PLINKO_FLOATS, keno: KENO_FLOATS, "video-poker": VIDEO_POKER_FLOATS, slots: SLOT_FLOATS,
};
const RESUMABLE = ["blackjack", "mines", "crash", "video-poker"];
const MAINTENANCE_INTERVAL_MS = 1_000;
const randomHex = (bytes) => randomBytes(bytes).toString("hex");
const toCents = (credits) => (typeof credits === "number" && Number.isFinite(credits) ? Math.round(credits * 100) : NaN);
const validClientSeed = (value) => typeof value === "string" && /^[\w-]{1,64}$/.test(value);

export function createCasino({ db, now, fail, publicUser }) {
  let lastMaintenance = -Infinity;

  async function loadUser(store, userId) {
    const row = (await store.execute({ sql: "SELECT * FROM users WHERE id=?", args: [userId] })).rows[0];
    return publicUser(row);
  }

  async function seedRow(store, userId) {
    const read = () => store.execute({ sql: "SELECT * FROM fair_seeds WHERE user_id=?", args: [userId] });
    let row = (await read()).rows[0];
    if (!row) {
      await store.execute({
        sql: "INSERT INTO fair_seeds(user_id,server_seed,client_seed,nonce,previous) VALUES(?,?,?,0,NULL)",
        args: [userId, randomHex(32), randomHex(6)],
      });
      row = (await read()).rows[0];
    }
    return row;
  }

  function fairPublic(row) {
    return {
      serverSeedHash: sha256Hex(row.server_seed),
      clientSeed: row.client_seed,
      nonce: row.nonce,
      previous: row.previous ? JSON.parse(row.previous) : null,
    };
  }

  function roundView(row, data = JSON.parse(row.data)) {
    return { ...clientView(data.state), id: row.id, fair: data.fair };
  }

  async function findRound(store, userId, game, statusClause = "status='active'") {
    return (
      await store.execute({
        sql: `SELECT * FROM casino_rounds WHERE user_id=? AND game=? AND ${statusClause} ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        args: [userId, game],
      })
    ).rows[0];
  }

  async function debit(tx, userId, cents) {
    if (cents <= 0) return;
    const result = await tx.execute({
      sql: "UPDATE users SET balance_cents=balance_cents-? WHERE id=? AND balance_cents>=?",
      args: [cents, userId, cents],
    });
    if (!result.rowsAffected) throw fail(409, "insufficient_balance", "Not enough online credits.");
  }

  /** Credits the payout, records the play and marks the round finished (exactly once). */
  async function finish(tx, row, data) {
    const state = data.state;
    const update = await tx.execute({
      sql: "UPDATE casino_rounds SET status='finished', data=?, updated_at=? WHERE id=? AND status='active'",
      args: [JSON.stringify(data), now(), row.id],
    });
    if (!update.rowsAffected) return [];
    if (state.payout > 0)
      await tx.execute({
        sql: "UPDATE users SET balance_cents=balance_cents+? WHERE id=?",
        args: [state.payout, row.user_id],
      });
    return recordPlay(tx, {
      userId: row.user_id,
      // Slot plays are recorded per machine so profiles and achievements can tell them apart.
      game: row.game === "slots" ? `slots:${state.machine}` : row.game,
      wager: state.wager,
      payout: state.payout,
      at: now(),
      natural: state.hands?.some((hand) => hand.result === "blackjack"),
      gems: state.revealed?.length,
    });
  }

  async function persist(tx, row, data) {
    if (roundFinished(data.state)) return finish(tx, row, data);
    await tx.execute({
      sql: "UPDATE casino_rounds SET data=?, updated_at=? WHERE id=?",
      args: [JSON.stringify(data), now(), row.id],
    });
    return [];
  }

  async function respond(tx, userId, row, data, achievements) {
    return {
      round: row ? roundView(row, data) : null,
      user: await loadUser(tx, userId),
      serverTime: now(),
      ...(achievements?.length ? { achievements } : {}),
    };
  }

  function startRound(user, game, build) {
    return transaction(db, async (tx) => {
      if (RESUMABLE.includes(game)) {
        const existing = await findRound(tx, user.id, game);
        if (existing)
          throw fail(409, "round_active", "Finish your current round first.", { round: roundView(existing) });
      }
      const seed = await seedRow(tx, user.id);
      const floats = fairFloats(seed.server_seed, seed.client_seed, seed.nonce, FLOAT_COUNTS[game]);
      let state;
      try {
        state = build(floats);
      } catch (error) {
        throw fail(400, "invalid_bet", `Invalid ${game} bet: ${error.message}.`);
      }
      await debit(tx, user.id, state.wager);
      await tx.execute({ sql: "UPDATE fair_seeds SET nonce=nonce+1 WHERE user_id=?", args: [user.id] });
      const row = { id: randomUUID(), user_id: user.id, game };
      const data = {
        state,
        fair: { serverSeedHash: sha256Hex(seed.server_seed), clientSeed: seed.client_seed, nonce: seed.nonce },
        secret: { serverSeed: seed.server_seed, clientSeed: seed.client_seed, nonce: seed.nonce },
      };
      await tx.execute({
        sql: "INSERT INTO casino_rounds(id,user_id,game,status,data,created_at,updated_at) VALUES(?,?,?,'active',?,?,?)",
        args: [row.id, user.id, game, JSON.stringify(data), now(), now()],
      });
      const achievements = roundFinished(state) ? await finish(tx, row, data) : [];
      return respond(tx, user.id, row, data, achievements);
    });
  }

  /** Loads the active round, charges `cost(state)` if any, then applies `run(state, floats)`. */
  function actOnRound(user, game, { cost = () => 0, run }) {
    return transaction(db, async (tx) => {
      const row = await findRound(tx, user.id, game);
      if (!row) throw fail(404, "no_round", "No active round.");
      const data = JSON.parse(row.data);
      const { serverSeed, clientSeed, nonce } = data.secret;
      const floats = fairFloats(serverSeed, clientSeed, nonce, FLOAT_COUNTS[game]);
      let extra;
      try {
        extra = cost(data.state);
      } catch (error) {
        throw fail(409, "illegal_action", error.message);
      }
      await debit(tx, user.id, extra);
      try {
        run(data.state, floats);
      } catch (error) {
        throw fail(409, "illegal_action", error.message);
      }
      const achievements = await persist(tx, row, data);
      return respond(tx, user.id, row, data, achievements);
    });
  }

  /** Returns the latest crash round, settling it by server time first. */
  function crashStatus(user) {
    return transaction(db, async (tx) => {
      const active = await findRound(tx, user.id, "crash");
      if (active) {
        const data = JSON.parse(active.data);
        crashSettle(data.state, now());
        const achievements = roundFinished(data.state) ? await finish(tx, active, data) : [];
        return respond(tx, user.id, active, data, achievements);
      }
      const latest = await findRound(tx, user.id, "crash", "1=1");
      return respond(tx, user.id, latest, latest && JSON.parse(latest.data));
    });
  }

  async function activeRounds(user) {
    await crashStatus(user);
    const rounds = {};
    for (const game of RESUMABLE) {
      const row = await findRound(db, user.id, game);
      rounds[game] = row ? roundView(row) : null;
    }
    return { ...rounds, user: await loadUser(db, user.id), serverTime: now() };
  }

  function rotateSeed(user, body) {
    return transaction(db, async (tx) => {
      for (const game of RESUMABLE) {
        const row = await findRound(tx, user.id, game);
        if (!row) continue;
        const data = JSON.parse(row.data);
        if (game === "crash") crashSettle(data.state, now());
        if (roundFinished(data.state)) await finish(tx, row, data);
        else throw fail(409, "round_active", "Finish active rounds before rotating seeds.");
      }
      const seed = await seedRow(tx, user.id);
      const previous = {
        serverSeed: seed.server_seed,
        serverSeedHash: sha256Hex(seed.server_seed),
        clientSeed: seed.client_seed,
        nonce: seed.nonce,
      };
      const clientSeed = validClientSeed(body.clientSeed) ? body.clientSeed : randomHex(6);
      await tx.execute({
        sql: "UPDATE fair_seeds SET server_seed=?, client_seed=?, nonce=0, previous=? WHERE user_id=?",
        args: [randomHex(32), clientSeed, JSON.stringify(previous), user.id],
      });
      return { fair: fairPublic(await seedRow(tx, user.id)), user: await loadUser(tx, user.id), serverTime: now() };
    });
  }

  const routes = {
    "GET /api/fair": async (user) => ({
      fair: fairPublic(await transaction(db, (tx) => seedRow(tx, user.id))),
      user: await loadUser(db, user.id),
      serverTime: now(),
    }),
    "POST /api/fair/rotate": rotateSeed,
    "GET /api/casino/active": activeRounds,
    "POST /api/casino/blackjack/start": (user, body) =>
      startRound(user, "blackjack", (floats) =>
        blackjackStart(floats, Array.isArray(body.bets) ? body.bets.map(toCents) : []),
      ),
    "POST /api/casino/blackjack/action": (user, body) =>
      actOnRound(user, "blackjack", {
        cost: (state) => blackjackCost(state, body.action),
        run: (state, floats) => blackjackAction(state, floats, body.action),
      }),
    "POST /api/casino/baccarat": (user, body) =>
      startRound(user, "baccarat", (floats) => {
        const bets = body.bets && typeof body.bets === "object" ? body.bets : {};
        return baccaratPlay(floats, {
          player: toCents(bets.player ?? 0),
          banker: toCents(bets.banker ?? 0),
          tie: toCents(bets.tie ?? 0),
        });
      }),
    "POST /api/casino/mines/start": (user, body) =>
      startRound(user, "mines", (floats) => minesStart(floats, toCents(body.bet), body.mines)),
    "POST /api/casino/mines/reveal": (user, body) =>
      actOnRound(user, "mines", { run: (state) => minesReveal(state, body.tile) }),
    "POST /api/casino/mines/cashout": (user) => actOnRound(user, "mines", { run: (state) => minesCashout(state) }),
    "POST /api/casino/crash/start": (user, body) =>
      startRound(user, "crash", (floats) => crashStart(floats, toCents(body.bet), body.autoCashout ?? null, now())),
    // A cash-out that arrives after maintenance already crashed the round reports that result.
    "POST /api/casino/crash/cashout": (user) =>
      actOnRound(user, "crash", { run: (state) => crashCashout(state, now()) }).catch((error) => {
        if (error.code === "no_round") return crashStatus(user);
        throw error;
      }),
    "GET /api/casino/crash": crashStatus,
    "POST /api/casino/roulette": (user, body) =>
      startRound(user, "roulette", (floats) =>
        rouletteSpin(floats, Array.isArray(body.bets) ? body.bets.map((bet) => ({ type: bet?.type, value: bet?.value ?? null, amount: toCents(bet?.amount) })) : []),
      ),
    "POST /api/casino/dice": (user, body) =>
      startRound(user, "dice", (floats) => diceRoll(floats, toCents(body.bet), body.target, body.direction)),
    "POST /api/casino/plinko": (user, body) =>
      startRound(user, "plinko", (floats) => plinkoDrop(floats, toCents(body.bet), body.rows, body.risk)),
    "POST /api/casino/keno": (user, body) => startRound(user, "keno", (floats) => kenoPlay(floats, toCents(body.bet), body.picks)),
    "POST /api/casino/video-poker/deal": (user, body) =>
      startRound(user, "video-poker", (floats) => videoPokerStart(floats, toCents(body.bet))),
    "POST /api/casino/video-poker/draw": (user, body) =>
      actOnRound(user, "video-poker", { run: (state) => videoPokerDraw(state, body.held) }),
    "POST /api/casino/slots": (user, body) => startRound(user, "slots", (floats) => slotsSpin(floats, toCents(body.bet), body.machine)),
  };

  return {
    /** Handles a casino route, or returns null when the path is not a casino route. */
    handle(method, path, user, body = {}) {
      const route = routes[`${method} ${path}`];
      return route ? route(user, body) : null;
    },
    /** Finalizes abandoned crash rounds (auto cash-out or crash reached) for stats and payouts. */
    async maintenance() {
      if (now() - lastMaintenance < MAINTENANCE_INTERVAL_MS) return;
      lastMaintenance = now();
      const rows = (await db.execute("SELECT id FROM casino_rounds WHERE game='crash' AND status='active'")).rows;
      for (const { id } of rows)
        await transaction(db, async (tx) => {
          const row = (
            await tx.execute({ sql: "SELECT * FROM casino_rounds WHERE id=? AND status='active'", args: [id] })
          ).rows[0];
          if (!row) return;
          const data = JSON.parse(row.data);
          crashSettle(data.state, now());
          if (roundFinished(data.state)) await finish(tx, row, data);
        });
    },
  };
}

// Server-wide live rocket: every online player bets on the same provably-fair crash round.
// The current round lives in memory (cheap polling); money movements are persisted in
// transactions so restarts settle each round exactly once.
import { randomBytes, randomUUID } from "node:crypto";
import {
  crashMultiplierAt,
  crashTimeFor,
  liveCrashPoint,
  sha256Hex,
  validAutoCashout,
  validBet,
} from "../casino-core.js";
import { transaction } from "./store.js";
import { recordPlay } from "./achievements.js";

export const LIVE_BETTING_MS = 7_000;
export const LIVE_CRASHED_MS = 4_000;
const HISTORY_SIZE = 20;

export async function createLive({ db, now, fail, publicUser }) {
  let round = null;
  let history = [];
  let queue = Promise.resolve();

  /** Serializes live operations so in-memory checks and DB writes never interleave. */
  function exclusive(fn) {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  }

  function newRound(startAt) {
    const seed = randomBytes(32).toString("hex");
    const id = randomUUID();
    const crashPoint = liveCrashPoint(seed, id);
    const startedAt = startAt + LIVE_BETTING_MS;
    return {
      id,
      seed,
      seedHash: sha256Hex(seed),
      crashPoint,
      bettingEndsAt: startedAt,
      startedAt,
      crashAt: startedAt + crashTimeFor(crashPoint),
      bets: new Map(),
      persisted: false,
      settled: false,
    };
  }

  function phase(target = round, at = now()) {
    if (at < target.startedAt) return "betting";
    if (at < target.crashAt) return "flying";
    return "crashed";
  }

  const nextRoundAt = (target) => target.crashAt + LIVE_CRASHED_MS;

  async function creditBet(tx, target, bet, cashedAt) {
    const payout = Math.floor(bet.wager * cashedAt);
    const update = await tx.execute({
      sql: "UPDATE live_bets SET cashed_at=?, payout_cents=?, settled=1 WHERE round_id=? AND user_id=? AND settled=0",
      args: [cashedAt, payout, target.id, bet.userId],
    });
    if (!update.rowsAffected) return false;
    await tx.execute({ sql: "UPDATE users SET balance_cents=balance_cents+? WHERE id=?", args: [payout, bet.userId] });
    bet.cashedAt = cashedAt;
    bet.payout = payout;
    bet.credited = true;
    return true;
  }

  /** Credits auto cash-outs whose target the rocket has already passed. */
  async function processAutoCashouts(target, at) {
    const reached = target.crashPoint;
    const flightMultiplier = at >= target.crashAt ? reached : crashMultiplierAt(at - target.startedAt);
    const due = [...target.bets.values()].filter(
      (bet) => !bet.credited && bet.autoCashout && bet.autoCashout < reached && bet.autoCashout <= flightMultiplier,
    );
    if (!due.length) return;
    await transaction(db, async (tx) => {
      for (const bet of due) await creditBet(tx, target, bet, bet.autoCashout);
    });
  }

  /** Records plays and achievements for a crashed round, exactly once. */
  async function settle(target) {
    if (target.settled) return;
    if (target.persisted) {
      await processAutoCashouts(target, target.crashAt);
      await transaction(db, async (tx) => {
        const claim = await tx.execute({
          sql: "UPDATE live_rounds SET settled=1, crashed_at=? WHERE id=? AND settled=0",
          args: [Math.round(target.crashAt), target.id],
        });
        if (!claim.rowsAffected) return;
        for (const bet of target.bets.values())
          await recordPlay(tx, {
            userId: bet.userId,
            game: "live-rocket",
            wager: bet.wager,
            payout: bet.credited ? bet.payout : 0,
            at: Math.round(target.crashAt),
          });
      });
    }
    target.settled = true;
    history.unshift({ roundId: target.id, crashPoint: target.crashPoint, seedHash: target.seedHash, seed: target.seed });
    history = history.slice(0, HISTORY_SIZE);
  }

  /** Moves the round loop forward to `now()`. */
  async function advance() {
    const at = now();
    if (phase(round, at) === "flying") await processAutoCashouts(round, at);
    if (phase(round, at) === "crashed") await settle(round);
    if (at >= nextRoundAt(round)) round = newRound(at);
  }

  function restoreRound(row, bets) {
    return {
      id: row.id,
      seed: row.seed,
      seedHash: row.seed_hash,
      crashPoint: row.crash_point,
      bettingEndsAt: row.betting_ends_at,
      startedAt: row.started_at,
      crashAt: row.started_at + crashTimeFor(row.crash_point),
      bets: new Map(
        bets.map((bet) => [
          bet.user_id,
          {
            userId: bet.user_id,
            name: bet.name,
            wager: bet.wager_cents,
            autoCashout: bet.auto_cashout,
            cashedAt: bet.cashed_at,
            payout: bet.payout_cents,
            credited: Boolean(bet.settled),
          },
        ]),
      ),
      persisted: true,
      settled: false,
    };
  }

  async function recover() {
    history = (
      await db.execute(
        `SELECT id, crash_point, seed_hash, seed FROM live_rounds WHERE settled=1 ORDER BY crashed_at DESC LIMIT ${HISTORY_SIZE}`,
      )
    ).rows.map((row) => ({ roundId: row.id, crashPoint: row.crash_point, seedHash: row.seed_hash, seed: row.seed }));
    const open = (await db.execute("SELECT * FROM live_rounds WHERE settled=0 ORDER BY created_at")).rows;
    for (const row of open) {
      const bets = (await db.execute({ sql: "SELECT * FROM live_bets WHERE round_id=?", args: [row.id] })).rows;
      const restored = restoreRound(row, bets);
      if (phase(restored) === "crashed") await settle(restored);
      else round = restored;
    }
    round ||= newRound(now());
  }

  function publicBet(bet, multiplier) {
    const autoPassed =
      !bet.credited && bet.autoCashout && bet.autoCashout < round.crashPoint && multiplier >= bet.autoCashout;
    const cashedAt = bet.credited ? bet.cashedAt : autoPassed ? bet.autoCashout : null;
    return {
      userId: String(bet.userId),
      name: bet.name,
      bet: bet.wager / 100,
      autoCashout: bet.autoCashout,
      cashedAt,
      payout: cashedAt ? Math.floor(bet.wager * cashedAt) / 100 : 0,
    };
  }

  function view(userId) {
    const at = now();
    const current = phase(round, at);
    const multiplier =
      current === "betting" ? 1 : current === "crashed" ? round.crashPoint : crashMultiplierAt(at - round.startedAt);
    const bets = [...round.bets.values()].map((bet) => publicBet(bet, multiplier)).sort((a, b) => b.bet - a.bet);
    const mine = userId == null ? null : bets.find((bet) => bet.userId === String(userId));
    const crashed = current === "crashed";
    return {
      live: {
        roundId: round.id,
        phase: current,
        seedHash: round.seedHash,
        bettingEndsAt: round.bettingEndsAt,
        startedAt: round.startedAt,
        crashedAt: crashed ? Math.round(round.crashAt) : null,
        nextRoundAt: crashed ? Math.round(nextRoundAt(round)) : null,
        multiplier,
        crashPoint: crashed ? round.crashPoint : null,
        seed: crashed ? round.seed : null,
        bets,
        history: history.filter((entry) => entry.roundId !== round.id || crashed),
      },
      me: mine ? { bet: mine.bet, autoCashout: mine.autoCashout, cashedAt: mine.cashedAt, payout: mine.payout } : null,
      serverTime: at,
    };
  }

  async function placeBet(user, body) {
    if (phase() !== "betting") throw fail(409, "betting_closed", "Betting is closed for this launch.");
    const wager = typeof body.bet === "number" ? Math.round(body.bet * 100) : NaN;
    const autoCashout = body.autoCashout ?? null;
    if (!validBet(wager) || !validAutoCashout(autoCashout)) throw fail(400, "invalid_bet", "Invalid bet or auto cash-out.");
    if (round.bets.has(user.id)) throw fail(409, "already_bet", "You already have a bet on this launch.");
    const target = round;
    await transaction(db, async (tx) => {
      const debit = await tx.execute({
        sql: "UPDATE users SET balance_cents=balance_cents-? WHERE id=? AND balance_cents>=?",
        args: [wager, user.id, wager],
      });
      if (!debit.rowsAffected) throw fail(409, "insufficient_balance", "Not enough online credits.");
      if (!target.persisted)
        await tx.execute({
          sql: "INSERT INTO live_rounds(id,seed,seed_hash,crash_point,betting_ends_at,started_at,crashed_at,settled,created_at) VALUES(?,?,?,?,?,?,NULL,0,?)",
          args: [target.id, target.seed, target.seedHash, target.crashPoint, target.bettingEndsAt, target.startedAt, now()],
        });
      await tx.execute({
        sql: "INSERT INTO live_bets(round_id,user_id,name,wager_cents,auto_cashout,cashed_at,payout_cents,settled) VALUES(?,?,?,?,?,NULL,0,0)",
        args: [target.id, user.id, user.name, wager, autoCashout],
      });
    });
    target.persisted = true;
    target.bets.set(user.id, { userId: user.id, name: user.name, wager, autoCashout, cashedAt: null, payout: 0, credited: false });
  }

  async function cashOut(user) {
    if (phase() !== "flying") throw fail(409, "not_flying", "The rocket is not flying.");
    const bet = round.bets.get(user.id);
    if (!bet) throw fail(409, "no_bet", "You have no bet on this launch.");
    if (bet.credited) throw fail(409, "already_cashed", "You already cashed out.");
    const multiplier = crashMultiplierAt(now() - round.startedAt);
    await transaction(db, (tx) => creditBet(tx, round, bet, multiplier));
  }

  await recover();

  return {
    /** action: null (status), "bet" or "cashout". `user` may be null for spectators. */
    handle(action, user, body = {}) {
      return exclusive(async () => {
        await advance();
        if (action) {
          if (!user) throw fail(401, "unauthorized", "Sign in to bet on the live rocket.");
          if (action === "bet") await placeBet(user, body);
          else await cashOut(user);
          await advance();
        }
        const result = view(user?.id);
        if (action) {
          const row = (await db.execute({ sql: "SELECT * FROM users WHERE id=?", args: [user.id] })).rows[0];
          result.user = publicUser(row);
        }
        return result;
      });
    },
    maintenance: () => exclusive(advance),
  };
}

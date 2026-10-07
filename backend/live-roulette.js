// Server-wide live roulette: every online player bets red / black / green on the same
// provably-fair spin. The round lives in memory (cheap polling); bets and settlement are
// persisted in transactions so a restart settles each round exactly once.
import { randomBytes, randomUUID } from "node:crypto";
import { LIVE_ROULETTE_PAYOUTS, liveRouletteColor, liveRouletteRoll, sha256Hex, validBet } from "../casino-core.js";
import { transaction } from "./store.js";
import { recordPlay } from "./achievements.js";

export const ROULETTE_BETTING_MS = 15_000;
export const ROULETTE_SPIN_MS = 6_000;
export const ROULETTE_RESULT_MS = 4_000;
const HISTORY_SIZE = 30;
const COLORS = Object.keys(LIVE_ROULETTE_PAYOUTS);

export async function createLiveRoulette({ db, now, fail, publicUser }) {
  let round = null;
  let history = [];
  let queue = Promise.resolve();

  function exclusive(fn) {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  }

  function timing(bettingEndsAt) {
    return { bettingEndsAt, spinEndsAt: bettingEndsAt + ROULETTE_SPIN_MS, nextAt: bettingEndsAt + ROULETTE_SPIN_MS + ROULETTE_RESULT_MS };
  }

  function newRound(at) {
    const seed = randomBytes(32).toString("hex");
    const id = randomUUID();
    const slot = liveRouletteRoll(seed, id);
    return { id, seed, seedHash: sha256Hex(seed), slot, color: liveRouletteColor(slot), ...timing(at + ROULETTE_BETTING_MS), bets: [], persisted: false, settled: false };
  }

  function phase(target = round, at = now()) {
    if (at < target.bettingEndsAt) return "betting";
    if (at < target.spinEndsAt) return "spinning";
    return "result";
  }

  /** Pays winners and records one play per player, exactly once. */
  async function settle(target) {
    if (target.settled) return;
    if (target.persisted) {
      await transaction(db, async (tx) => {
        const claim = await tx.execute({ sql: "UPDATE live_roulette_rounds SET settled=1 WHERE id=? AND settled=0", args: [target.id] });
        if (!claim.rowsAffected) return;
        const players = new Map();
        for (const bet of target.bets) {
          const payout = bet.color === target.color ? bet.wager * LIVE_ROULETTE_PAYOUTS[bet.color] : 0;
          const entry = players.get(bet.userId) || { wager: 0, payout: 0 };
          entry.wager += bet.wager;
          entry.payout += payout;
          players.set(bet.userId, entry);
        }
        for (const [userId, entry] of players) {
          if (entry.payout) await tx.execute({ sql: "UPDATE users SET balance_cents=balance_cents+? WHERE id=?", args: [entry.payout, userId] });
          await recordPlay(tx, { userId, game: "live-roulette", wager: entry.wager, payout: entry.payout, at: Math.round(target.spinEndsAt) });
        }
      });
    }
    target.settled = true;
    history.unshift({ roundId: target.id, slot: target.slot, color: target.color, seedHash: target.seedHash, seed: target.seed });
    history = history.slice(0, HISTORY_SIZE);
  }

  async function advance() {
    const at = now();
    if (phase(round, at) === "result") await settle(round);
    if (at >= round.nextAt) round = newRound(at);
  }

  async function recover() {
    history = (
      await db.execute(`SELECT id, seed, seed_hash, slot FROM live_roulette_rounds WHERE settled=1 ORDER BY betting_ends_at DESC LIMIT ${HISTORY_SIZE}`)
    ).rows.map((row) => ({ roundId: row.id, slot: row.slot, color: liveRouletteColor(row.slot), seedHash: row.seed_hash, seed: row.seed }));
    const open = (await db.execute("SELECT * FROM live_roulette_rounds WHERE settled=0 ORDER BY betting_ends_at")).rows;
    for (const row of open) {
      const bets = (await db.execute({ sql: "SELECT * FROM live_roulette_bets WHERE round_id=?", args: [row.id] })).rows;
      const restored = {
        id: row.id,
        seed: row.seed,
        seedHash: row.seed_hash,
        slot: row.slot,
        color: liveRouletteColor(row.slot),
        ...timing(row.betting_ends_at),
        bets: bets.map((bet) => ({ userId: bet.user_id, name: bet.name, color: bet.color, wager: bet.wager_cents })),
        persisted: true,
        settled: false,
      };
      if (phase(restored) === "result") await settle(restored);
      else round = restored;
    }
    round ||= newRound(now());
  }

  function view(userId) {
    const at = now();
    const current = phase(round, at);
    const revealed = current !== "betting";
    const bets = round.bets
      .map((bet) => ({
        userId: String(bet.userId),
        name: bet.name,
        color: bet.color,
        bet: bet.wager / 100,
        payout: current === "result" && bet.color === round.color ? (bet.wager * LIVE_ROULETTE_PAYOUTS[bet.color]) / 100 : 0,
      }))
      .sort((a, b) => b.bet - a.bet);
    const totals = Object.fromEntries(COLORS.map((color) => [color, bets.filter((bet) => bet.color === color).reduce((sum, bet) => sum + bet.bet, 0)]));
    return {
      roulette: {
        roundId: round.id,
        phase: current,
        seedHash: round.seedHash,
        bettingEndsAt: round.bettingEndsAt,
        spinEndsAt: round.spinEndsAt,
        nextAt: round.nextAt,
        // Betting is closed once the wheel spins, so the landing slot can be sent for the animation.
        slot: revealed ? round.slot : null,
        color: revealed ? round.color : null,
        seed: current === "result" ? round.seed : null,
        bets,
        totals,
        payouts: LIVE_ROULETTE_PAYOUTS,
        history: history.filter((entry) => entry.roundId !== round.id || current === "result"),
      },
      me: userId == null ? [] : bets.filter((bet) => bet.userId === String(userId)),
      serverTime: at,
    };
  }

  async function placeBet(user, body) {
    if (phase() !== "betting") throw fail(409, "betting_closed", "Betting is closed for this spin.");
    const wager = typeof body.bet === "number" ? Math.round(body.bet * 100) : NaN;
    if (!validBet(wager) || !COLORS.includes(body.color)) throw fail(400, "invalid_bet", "Choose red, black or green and a valid bet.");
    const target = round;
    const existing = target.bets.find((bet) => bet.userId === user.id && bet.color === body.color);
    if (existing && !validBet(existing.wager + wager)) throw fail(400, "invalid_bet", "That bet is over the table limit.");
    await transaction(db, async (tx) => {
      const debit = await tx.execute({ sql: "UPDATE users SET balance_cents=balance_cents-? WHERE id=? AND balance_cents>=?", args: [wager, user.id, wager] });
      if (!debit.rowsAffected) throw fail(409, "insufficient_balance", "Not enough online credits.");
      if (!target.persisted)
        await tx.execute({
          sql: "INSERT INTO live_roulette_rounds(id,seed,seed_hash,slot,betting_ends_at,settled,created_at) VALUES(?,?,?,?,?,0,?)",
          args: [target.id, target.seed, target.seedHash, target.slot, target.bettingEndsAt, now()],
        });
      await tx.execute({
        sql: "INSERT INTO live_roulette_bets(round_id,user_id,name,color,wager_cents) VALUES(?,?,?,?,?) ON CONFLICT(round_id,user_id,color) DO UPDATE SET wager_cents=wager_cents+excluded.wager_cents",
        args: [target.id, user.id, user.name, body.color, wager],
      });
    });
    target.persisted = true;
    if (existing) existing.wager += wager;
    else target.bets.push({ userId: user.id, name: user.name, color: body.color, wager });
  }

  await recover();

  return {
    /** action: null (status) or "bet". `user` may be null for spectators. */
    handle(action, user, body = {}) {
      return exclusive(async () => {
        await advance();
        if (action) {
          if (!user) throw fail(401, "unauthorized", "Sign in to bet on live roulette.");
          await placeBet(user, body);
        }
        const result = view(user?.id);
        if (action) result.user = publicUser((await db.execute({ sql: "SELECT * FROM users WHERE id=?", args: [user.id] })).rows[0]);
        return result;
      });
    },
    maintenance: () => exclusive(advance),
  };
}

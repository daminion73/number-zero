// Coinflip battles: a player opens a flip on heads or tails, anyone (or a house bot) takes the
// other side, and the seed committed at creation decides the coin. Winner takes both stakes.
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { COINFLIP_SIDES, coinflipResult, sha256Hex, validBet } from "../casino-core.js";
import { transaction } from "./store.js";
import { recordPlay } from "./achievements.js";
import { BOT_NAMES } from "./game.js";

const MAX_OPEN_PER_USER = 5;
const RECENT = 30;

export function createCoinflip({ db, now, fail, publicUser }) {
  const load = async (tx, id) => {
    const row = (await tx.execute({ sql: "SELECT data FROM coinflips WHERE id=?", args: [id] })).rows[0];
    if (!row) throw fail(404, "not_found", "Coinflip not found.");
    return JSON.parse(row.data);
  };
  const save = (tx, flip) =>
    tx.execute({ sql: "UPDATE coinflips SET state=?, data=?, updated_at=? WHERE id=?", args: [flip.state, JSON.stringify(flip), now(), flip.id] });

  /** Public shape: the seed stays secret until the coin has been flipped. */
  function snapshot(flip) {
    const settled = flip.state === "flipped";
    return {
      id: flip.id,
      state: flip.state,
      bet: flip.betCents / 100,
      createdAt: flip.createdAt,
      seedHash: flip.seedHash,
      seed: settled ? flip.seed : null,
      creator: { id: String(flip.creatorId), name: flip.creatorName, side: flip.side },
      joiner: flip.joinerName ? { id: flip.joinerId == null ? null : String(flip.joinerId), name: flip.joinerName, bot: flip.joinerBot, side: flip.side === "heads" ? "tails" : "heads" } : null,
      result: settled ? flip.result : null,
      winner: settled ? (flip.result === flip.side ? "creator" : "joiner") : null,
      flippedAt: flip.flippedAt || null,
    };
  }

  async function list() {
    const open = (await db.execute("SELECT data FROM coinflips WHERE state='open' ORDER BY created_at DESC LIMIT 100")).rows;
    const recent = (await db.execute(`SELECT data FROM coinflips WHERE state='flipped' ORDER BY updated_at DESC LIMIT ${RECENT}`)).rows;
    return [...open, ...recent].map((row) => snapshot(JSON.parse(row.data)));
  }

  async function create(user, body) {
    const betCents = typeof body.bet === "number" ? Math.round(body.bet * 100) : NaN;
    if (!validBet(betCents) || !COINFLIP_SIDES.includes(body.side)) throw fail(400, "invalid_bet", "Choose heads or tails and a valid bet.");
    return transaction(db, async (tx) => {
      const open = (await tx.execute({ sql: "SELECT COUNT(*) AS n FROM coinflips WHERE creator_id=? AND state='open'", args: [user.id] })).rows[0].n;
      if (Number(open) >= MAX_OPEN_PER_USER) throw fail(409, "too_many_open", `You can have at most ${MAX_OPEN_PER_USER} open coinflips.`);
      const debit = await tx.execute({ sql: "UPDATE users SET balance_cents=balance_cents-? WHERE id=? AND balance_cents>=?", args: [betCents, user.id, betCents] });
      if (!debit.rowsAffected) throw fail(409, "insufficient_balance", "Not enough online credits.");
      const seed = randomBytes(32).toString("hex");
      const flip = { id: randomUUID(), state: "open", creatorId: user.id, creatorName: user.name, side: body.side, betCents, seed, seedHash: sha256Hex(seed), createdAt: now() };
      await tx.execute({
        sql: "INSERT INTO coinflips(id,creator_id,state,data,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        args: [flip.id, user.id, flip.state, JSON.stringify(flip), flip.createdAt, flip.createdAt],
      });
      return flip;
    });
  }

  async function act(user, id, action) {
    return transaction(db, async (tx) => {
      const flip = await load(tx, id);
      if (flip.state !== "open") throw fail(409, "not_open", "This coinflip is no longer open.");
      const creator = flip.creatorId === user.id;
      if (action === "cancel") {
        if (!creator) throw fail(403, "creator_only", "Only the creator can cancel.");
        await tx.execute({ sql: "UPDATE users SET balance_cents=balance_cents+? WHERE id=?", args: [flip.betCents, user.id] });
        flip.state = "cancelled";
        await save(tx, flip);
        return flip;
      }
      if (action === "bot") {
        if (!creator) throw fail(403, "creator_only", "Only the creator can call a bot.");
        Object.assign(flip, { joinerId: null, joinerName: BOT_NAMES[randomInt(BOT_NAMES.length)], joinerBot: true });
      } else {
        if (creator) throw fail(409, "own_flip", "You cannot join your own coinflip.");
        const debit = await tx.execute({ sql: "UPDATE users SET balance_cents=balance_cents-? WHERE id=? AND balance_cents>=?", args: [flip.betCents, user.id, flip.betCents] });
        if (!debit.rowsAffected) throw fail(409, "insufficient_balance", "Not enough online credits.");
        Object.assign(flip, { joinerId: user.id, joinerName: user.name, joinerBot: false });
      }
      const at = now();
      flip.result = coinflipResult(flip.seed, flip.id);
      flip.state = "flipped";
      flip.flippedAt = at;
      const creatorWon = flip.result === flip.side;
      const pot = flip.betCents * 2;
      const winnerId = creatorWon ? flip.creatorId : flip.joinerId;
      if (winnerId != null) await tx.execute({ sql: "UPDATE users SET balance_cents=balance_cents+? WHERE id=?", args: [pot, winnerId] });
      await recordPlay(tx, { userId: flip.creatorId, game: "coinflip", wager: flip.betCents, payout: creatorWon ? pot : 0, at });
      if (flip.joinerId != null) await recordPlay(tx, { userId: flip.joinerId, game: "coinflip", wager: flip.betCents, payout: creatorWon ? 0 : pot, at });
      await save(tx, flip);
      return flip;
    });
  }

  const withUser = async (result, user) => ({
    ...result,
    user: publicUser((await db.execute({ sql: "SELECT * FROM users WHERE id=?", args: [user.id] })).rows[0]),
  });

  return {
    async list() {
      return { flips: await list(), serverTime: now() };
    },
    async create(user, body) {
      return withUser({ flip: snapshot(await create(user, body)), serverTime: now() }, user);
    },
    async act(user, id, action) {
      return withUser({ flip: snapshot(await act(user, id, action)), serverTime: now() }, user);
    },
  };
}

// Lifetime analytics and public winner feed, aggregated from the `plays` ledger.
import { ACHIEVEMENTS, achievementContext, progressOf } from "./achievements.js";
import { COSMETICS, lookOf, ownedKeys } from "./cosmetics.js";

const ACHIEVEMENT_NAMES = new Map(ACHIEVEMENTS.map((achievement) => [achievement.id, achievement.name]));

const WINNER_LIMIT = 12;
const DAY_MS = 86_400_000;
const credits = (cents) => cents / 100;

export async function loadProfile(db, userRow, publicUser) {
  const userId = userRow.id;
  const query = async (sql) => (await db.execute({ sql, args: [userId] })).rows;
  const [totals] = await query(
    "SELECT COUNT(*) AS plays, COALESCE(SUM(wager_cents),0) AS wagered, COALESCE(SUM(payout_cents),0) AS returned, COALESCE(SUM(CASE WHEN payout_cents>wager_cents THEN 1 ELSE 0 END),0) AS wins FROM plays WHERE user_id=?",
  );
  const games = await query(
    "SELECT game, COUNT(*) AS plays, SUM(wager_cents) AS wagered, SUM(payout_cents) AS returned FROM plays WHERE user_id=? GROUP BY game ORDER BY plays DESC, wagered DESC",
  );
  const [biggestMultiplier] = await query(
    "SELECT * FROM plays WHERE user_id=? AND payout_cents>0 ORDER BY multiplier DESC, payout_cents DESC LIMIT 1",
  );
  const [biggestWin] = await query(
    "SELECT * FROM plays WHERE user_id=? AND payout_cents>wager_cents ORDER BY payout_cents-wager_cents DESC LIMIT 1",
  );
  const unlocked = new Map((await query("SELECT id, unlocked_at FROM achievements WHERE user_id=?")).map((row) => [row.id, row.unlocked_at]));
  const context = await achievementContext(db, userId);

  const lifetimeNet = totals.returned - totals.wagered;
  const publicProfile = publicUser(userRow);

  return {
    user: publicProfile,
    totals: {
      wagered: credits(totals.wagered),
      returned: credits(totals.returned),
      net: credits(lifetimeNet),
      plays: totals.plays,
      wins: totals.wins,
    },
    biggestMultiplier: biggestMultiplier
      ? {
          multiplier: biggestMultiplier.multiplier,
          game: biggestMultiplier.game,
          wager: credits(biggestMultiplier.wager_cents),
          payout: credits(biggestMultiplier.payout_cents),
          at: biggestMultiplier.created_at,
        }
      : null,
    biggestWin: biggestWin
      ? {
          amount: credits(biggestWin.payout_cents - biggestWin.wager_cents),
          game: biggestWin.game,
          multiplier: biggestWin.multiplier,
          at: biggestWin.created_at,
        }
      : null,
    favourite: games.length ? { game: games[0].game, plays: games[0].plays } : null,
    games: games.map((game) => ({
      game: game.game,
      plays: game.plays,
      wagered: credits(game.wagered),
      returned: credits(game.returned),
      net: credits(game.returned - game.wagered),
    })),
    firstPlayAt: (await query("SELECT MIN(created_at) AS at FROM plays WHERE user_id=?"))[0].at ?? null,
    achievements: ACHIEVEMENTS.map((achievement) => ({
      ...achievement,
      unlocked: unlocked.has(achievement.id),
      unlockedAt: unlocked.get(achievement.id) ?? null,
      progress: progressOf(achievement.id, context),
    })),
    cosmetics: (() => {
      const owned = ownedKeys([...unlocked.keys()], publicProfile.admin);
      return {
        equipped: lookOf(userRow),
        items: COSMETICS.map((item) => ({
          ...item,
          owned: owned.has(`${item.kind}:${item.id}`),
          unlock: item.source === "default" ? null : ACHIEVEMENT_NAMES.get(item.source) || item.source,
        })),
      };
    })(),
  };
}

/**
 * Cumulative net P/L between `from` and `to` (ms), in at most `buckets` points. Each point is the
 * running net after the last play of its time bucket; `start` is the net carried in from before `from`.
 */
export async function loadPerformance(db, userId, from, to, buckets) {
  const [before] = (
    await db.execute({ sql: "SELECT COALESCE(SUM(payout_cents-wager_cents),0) AS net FROM plays WHERE user_id=? AND created_at<?", args: [userId, from] })
  ).rows;
  const rows = (
    await db.execute({
      sql: `SELECT MIN(CAST((created_at-?)*?/? AS INTEGER), ?) AS bucket, MAX(created_at) AS at, COUNT(*) AS plays,
        SUM(CASE WHEN payout_cents>wager_cents THEN 1 ELSE 0 END) AS wins, SUM(wager_cents) AS wagered,
        SUM(payout_cents) AS returned, MAX(payout_cents-wager_cents) AS best
        FROM plays WHERE user_id=? AND created_at>=? AND created_at<=? GROUP BY bucket ORDER BY bucket`,
      args: [from, buckets, to - from, buckets - 1, userId, from, to],
    })
  ).rows;
  let running = before.net;
  const totals = { plays: 0, wins: 0, wagered: 0, returned: 0, best: null };
  const points = rows.map((row) => {
    running += row.returned - row.wagered;
    totals.plays += row.plays;
    totals.wins += row.wins;
    totals.wagered += row.wagered;
    totals.returned += row.returned;
    totals.best = Math.max(totals.best ?? -Infinity, row.best);
    return { at: row.at, net: credits(running) };
  });
  return {
    from,
    to,
    start: credits(before.net),
    end: credits(running),
    points,
    totals: {
      plays: totals.plays,
      wins: totals.wins,
      wagered: credits(totals.wagered),
      returned: credits(totals.returned),
      net: credits(totals.returned - totals.wagered),
      best: totals.best === null || totals.best <= 0 ? null : credits(totals.best),
    },
  };
}

export async function loadWinners(db, now) {
  const select = (where, args) =>
    db.execute({
      sql: `SELECT p.game, p.multiplier, p.payout_cents, p.created_at, u.name FROM plays p JOIN users u ON u.id=p.user_id WHERE p.payout_cents>p.wager_cents ${where} ORDER BY p.payout_cents DESC LIMIT ${WINNER_LIMIT}`,
      args,
    });
  let rows = (await select("AND p.created_at>=?", [now - DAY_MS])).rows;
  if (!rows.length) rows = (await select("", [])).rows;
  return rows.map((row) => ({
    name: row.name,
    game: row.game,
    multiplier: row.multiplier,
    payout: credits(row.payout_cents),
    at: row.created_at,
  }));
}

// Lifetime analytics and public winner feed, aggregated from the `plays` ledger.
import { ACHIEVEMENTS } from "./achievements.js";

const SERIES_LIMIT = 250;
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
  const recent = (
    await query(`SELECT wager_cents, payout_cents, created_at FROM plays WHERE user_id=? ORDER BY id DESC LIMIT ${SERIES_LIMIT}`)
  ).reverse();
  const unlocked = new Map((await query("SELECT id, unlocked_at FROM achievements WHERE user_id=?")).map((row) => [row.id, row.unlocked_at]));

  // The series ends at the lifetime net, even when older plays fall outside the window.
  const lifetimeNet = totals.returned - totals.wagered;
  let running = lifetimeNet - recent.reduce((sum, play) => sum + play.payout_cents - play.wager_cents, 0);
  const series = recent.map((play) => {
    running += play.payout_cents - play.wager_cents;
    return { at: play.created_at, net: credits(running) };
  });

  return {
    user: publicUser(userRow),
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
    series,
    achievements: ACHIEVEMENTS.map((achievement) => ({
      ...achievement,
      unlocked: unlocked.has(achievement.id),
      unlockedAt: unlocked.get(achievement.id) ?? null,
    })),
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

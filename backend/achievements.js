// Server-side achievements replace the old local journey milestones. Each unlock is
// granted once and its reward is injected straight into the online wallet.
export const ACHIEVEMENTS = [
  ["first-play", "First Chips", "Finish your first casino play", 10_000],
  ["originals-tour", "Originals Tour", "Play Blackjack, Baccarat, Mines and Crash", 50_000],
  ["classics-tour", "Classics Tour", "Play Roulette, Dice, Plinko, Keno and Video Poker", 50_000],
  ["slot-spinner", "Reel Deal", "Spin all three slot machines", 25_000],
  ["natural", "Natural 21", "Hit a blackjack", 25_000],
  ["gem-hunter", "Gem Hunter", "Cash out Mines with 10+ gems", 50_000],
  ["live-pilot", "Live Pilot", "Cash out in the live rocket", 25_000],
  ["tenfold", "Tenfold", "Win 10× or more", 25_000],
  ["centurion", "Centurion", "Win 100× or more", 100_000],
  ["moonshot", "Moonshot", "Win 1,000× or more", 500_000],
  ["high-roller", "High Roller", "Wager 1,000,000 CR lifetime", 100_000],
  ["whale", "Whale", "Wager 10,000,000 CR lifetime", 500_000],
  ["leviathan", "Leviathan", "Wager 100,000,000 CR lifetime", 2_500_000],
  ["regular", "Regular", "Complete 100 plays", 50_000],
  ["veteran", "Veteran", "Complete 1,000 plays", 250_000],
  ["arena-champion", "Arena Champion", "Win a case battle", 50_000],
].map(([id, name, description, reward]) => ({ id, name, description, reward }));

const ORIGINALS = ["blackjack", "baccarat", "mines", "crash"];
const CLASSICS = ["roulette", "dice", "plinko", "keno", "video-poker"];
const SLOT_GAMES = ["slots:lucky-sevens", "slots:fruit-frenzy", "slots:neon-gems"];
const CENTS_PER_CREDIT = 100;

function earnedIds(play, totals, games) {
  const multiplier = play.wager > 0 ? play.payout / play.wager : 0;
  const wageredCredits = totals.wagered / CENTS_PER_CREDIT;
  const checks = {
    "first-play": true,
    "originals-tour": ORIGINALS.every((game) => games.has(game)),
    "classics-tour": CLASSICS.every((game) => games.has(game)),
    "slot-spinner": SLOT_GAMES.every((game) => games.has(game)),
    natural: Boolean(play.natural),
    "gem-hunter": play.game === "mines" && play.gems >= 10 && play.payout > 0,
    "live-pilot": play.game === "live-rocket" && play.payout > 0,
    tenfold: multiplier >= 10,
    centurion: multiplier >= 100,
    moonshot: multiplier >= 1_000,
    "high-roller": wageredCredits >= 1_000_000,
    whale: wageredCredits >= 10_000_000,
    leviathan: wageredCredits >= 100_000_000,
    regular: totals.plays >= 100,
    veteran: totals.plays >= 1_000,
    "arena-champion": play.game === "case-battle" && Boolean(play.won),
  };
  return new Set(Object.keys(checks).filter((id) => checks[id]));
}

/**
 * Records a finished play and grants any newly earned achievements inside `tx`.
 * `play` = { userId, game, wager (cents), payout (cents), at, natural?, gems?, won? }.
 * Returns the newly unlocked achievements (rewards already credited).
 */
export async function recordPlay(tx, play) {
  await tx.execute({
    sql: "INSERT INTO plays(user_id,game,wager_cents,payout_cents,multiplier,created_at) VALUES(?,?,?,?,?,?)",
    args: [play.userId, play.game, play.wager, play.payout, play.wager > 0 ? play.payout / play.wager : 0, play.at],
  });
  const totals = (
    await tx.execute({
      sql: "SELECT COUNT(*) AS plays, COALESCE(SUM(wager_cents),0) AS wagered FROM plays WHERE user_id=?",
      args: [play.userId],
    })
  ).rows[0];
  const games = new Set(
    (await tx.execute({ sql: "SELECT DISTINCT game FROM plays WHERE user_id=?", args: [play.userId] })).rows.map(
      (row) => row.game,
    ),
  );
  const earned = earnedIds(play, totals, games);
  const unlocked = [];
  for (const achievement of ACHIEVEMENTS) {
    if (!earned.has(achievement.id)) continue;
    const insert = await tx.execute({
      sql: "INSERT OR IGNORE INTO achievements(user_id,id,unlocked_at) VALUES(?,?,?)",
      args: [play.userId, achievement.id, play.at],
    });
    if (!insert.rowsAffected) continue;
    await tx.execute({
      sql: "UPDATE users SET balance_cents=balance_cents+? WHERE id=?",
      args: [achievement.reward * CENTS_PER_CREDIT, play.userId],
    });
    unlocked.push(achievement);
  }
  return unlocked;
}

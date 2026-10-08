// Server-side achievements. Each unlock is stored once in `achievements` and grants cosmetics
// (see backend/cosmetics.js — items whose `source` is the achievement id). Achievements never
// grant credits. Most checks read lifetime aggregates of the `plays` ledger, so they also unlock
// retroactively on a player's next play; a few depend on flags of the play being recorded.
import { cosmeticsFor } from "./cosmetics.js";

const CENTS_PER_CREDIT = 100;
const ORIGINALS = ["blackjack", "baccarat", "mines", "crash"];
const CLASSICS = ["roulette", "dice", "plinko", "keno", "video-poker"];
const SLOT_GAMES = ["slots:lucky-sevens", "slots:fruit-frenzy", "slots:neon-gems"];
const LIVE_GAMES = ["live-rocket", "live-roulette", "case-battle"];
const TABLE_GAMES = ["coinflip", "live-blackjack", "poker", "russian-roulette"];
export const ALL_GAMES = [...ORIGINALS, ...CLASSICS, ...SLOT_GAMES, ...LIVE_GAMES, ...TABLE_GAMES];
const FLUSH_PLUS = new Set(["flush", "full-house", "quads", "straight-flush", "royal-flush"]);
const QUADS_PLUS = new Set(["quads", "straight-flush", "royal-flush"]);
const STREAK_WINDOW = 10;
const EMPTY = Object.freeze({ plays: 0, wins: 0, wagered: 0, returned: 0, best: 0, topProfit: 0, maxWager: 0, minWager: null });

const game = (ctx, id) => ctx.games.get(id) || EMPTY;
const played = (ctx, list) => list.filter((id) => ctx.games.has(id)).length;
const credits = (cents) => cents / CENTS_PER_CREDIT;
const flag = (ctx, id, test) => Boolean(ctx.play && ctx.play.game === id && test(ctx.play));

// Definition helpers. `value(ctx)` → number compared against `target`; it doubles as progress.
const count = (value, target, unit = "") => ({ value, target, unit });
const plays = (id, target) => count((ctx) => game(ctx, id).plays, target);
const wins = (id, target) => count((ctx) => game(ctx, id).wins, target);
const best = (id, target) => count((ctx) => game(ctx, id).best, target, "×");
const once = (check) => ({ check });

const CATEGORIES = { milestones: "Milestones", originals: "Originals", classics: "Classics", live: "Live & battles", tables: "Tables" };

// [id, name, description, category, rule] — ids are stable (existing unlocks keep working).
const DEFINITIONS = [
  ["first-play", "First Chips", "Finish your first casino play", "milestones", count((ctx) => ctx.totals.plays, 1)],
  ["warming-up", "Warming Up", "Complete 25 plays", "milestones", count((ctx) => ctx.totals.plays, 25)],
  ["regular", "Regular", "Complete 100 plays", "milestones", count((ctx) => ctx.totals.plays, 100)],
  ["veteran", "Veteran", "Complete 1,000 plays", "milestones", count((ctx) => ctx.totals.plays, 1_000)],
  ["grinder", "The Grind", "Complete 5,000 plays", "milestones", count((ctx) => ctx.totals.plays, 5_000)],
  ["centum", "Hundred Wins", "Win 100 plays (payout above wager)", "milestones", count((ctx) => ctx.totals.wins, 100)],
  ["big-spender", "Big Spender", "Wager 100,000 CR lifetime", "milestones", count((ctx) => credits(ctx.totals.wagered), 100_000, "CR")],
  ["high-roller", "High Roller", "Wager 1,000,000 CR lifetime", "milestones", count((ctx) => credits(ctx.totals.wagered), 1_000_000, "CR")],
  ["whale", "Whale", "Wager 10,000,000 CR lifetime", "milestones", count((ctx) => credits(ctx.totals.wagered), 10_000_000, "CR")],
  ["leviathan", "Leviathan", "Wager 100,000,000 CR lifetime", "milestones", count((ctx) => credits(ctx.totals.wagered), 100_000_000, "CR")],
  ["max-bet", "All In", "Place a single 100,000 CR wager", "milestones", count((ctx) => credits(ctx.totals.maxWager), 100_000, "CR")],
  ["penny-pincher", "Penny Pincher", "Play a round for exactly 1 CR", "milestones", once((ctx) => ctx.totals.minWager !== null && ctx.totals.minWager <= CENTS_PER_CREDIT)],
  ["tenfold", "Tenfold", "Win 10× or more", "milestones", count((ctx) => ctx.totals.best, 10, "×")],
  ["centurion", "Centurion", "Win 100× or more", "milestones", count((ctx) => ctx.totals.best, 100, "×")],
  ["moonshot", "Moonshot", "Win 1,000× or more", "milestones", count((ctx) => ctx.totals.best, 1_000, "×")],
  ["payday", "Payday", "Profit 10,000 CR in a single play", "milestones", count((ctx) => credits(ctx.totals.topProfit), 10_000, "CR")],
  ["jackpot", "Jackpot", "Profit 1,000,000 CR in a single play", "milestones", count((ctx) => credits(ctx.totals.topProfit), 1_000_000, "CR")],
  ["in-the-green", "In The Green", "Reach +10,000 CR lifetime net profit", "milestones", count((ctx) => credits(ctx.totals.net), 10_000, "CR")],
  ["tycoon", "Tycoon", "Reach +1,000,000 CR lifetime net profit", "milestones", count((ctx) => credits(ctx.totals.net), 1_000_000, "CR")],
  ["hot-streak", "Hot Streak", "Win 3 plays in a row", "milestones", count((ctx) => ctx.streak.wins, 3)],
  ["on-fire", "On Fire", "Win 5 plays in a row", "milestones", count((ctx) => ctx.streak.wins, 5)],
  ["unstoppable", "Unstoppable", "Win 10 plays in a row", "milestones", count((ctx) => ctx.streak.wins, 10)],
  ["rock-bottom", "Rock Bottom", "Lose 10 plays in a row (it happens)", "milestones", count((ctx) => ctx.streak.losses, 10)],
  ["explorer", "Explorer", "Play 10 different games", "milestones", count((ctx) => ctx.games.size, 10)],
  ["completionist", "Completionist", `Play all ${ALL_GAMES.length} games, tables and battles`, "milestones", count((ctx) => played(ctx, ALL_GAMES), ALL_GAMES.length)],

  ["originals-tour", "Originals Tour", "Play Blackjack, Baccarat, Mines and Crash", "originals", count((ctx) => played(ctx, ORIGINALS), ORIGINALS.length)],
  ["natural", "Natural 21", "Hit a blackjack", "originals", once((ctx) => Boolean(ctx.play?.natural))],
  ["card-shark", "Card Shark", "Play 50 rounds of Blackjack", "originals", plays("blackjack", 50)],
  ["punto-banco", "Punto Banco", "Play 50 rounds of Baccarat", "originals", plays("baccarat", 50)],
  ["tie-breaker", "Tie Breaker", "Win 8× or more in Baccarat", "originals", best("baccarat", 8)],
  ["gem-hunter", "Gem Hunter", "Cash out Mines with 10+ gems", "originals", once((ctx) => flag(ctx, "mines", (play) => play.gems >= 10 && play.payout > 0))],
  ["sapper", "Sapper", "Play 50 rounds of Mines", "originals", plays("mines", 50)],
  ["deep-miner", "Deep Miner", "Cash out Mines at 50× or more", "originals", best("mines", 50)],
  ["liftoff", "Liftoff", "Cash out Crash at 10× or more", "originals", best("crash", 10)],
  ["escape-velocity", "Escape Velocity", "Cash out Crash at 100× or more", "originals", best("crash", 100)],

  ["classics-tour", "Classics Tour", "Play Roulette, Dice, Plinko, Keno and Video Poker", "classics", count((ctx) => played(ctx, CLASSICS), CLASSICS.length)],
  ["slot-spinner", "Reel Deal", "Spin all three slot machines", "classics", count((ctx) => played(ctx, SLOT_GAMES), SLOT_GAMES.length)],
  ["one-armed-bandit", "One-Armed Bandit", "Spin the slots 500 times", "classics", count((ctx) => SLOT_GAMES.reduce((sum, id) => sum + game(ctx, id).plays, 0), 500)],
  ["lucky-sevens", "Lucky Sevens", "Line up three 7s on Lucky Sevens (250×)", "classics", best("slots:lucky-sevens", 250)],
  ["fruit-salad", "Fruit Salad", "Win 10× or more on Fruit Frenzy", "classics", best("slots:fruit-frenzy", 10)],
  ["neon-dreams", "Neon Dreams", "Win 25× or more on Neon Gems", "classics", best("slots:neon-gems", 25)],
  ["straight-up", "Straight Up", "Hit a straight-up number in Roulette (36×)", "classics", best("roulette", 35)],
  ["wheel-watcher", "Wheel Watcher", "Spin Roulette 100 times", "classics", plays("roulette", 100)],
  ["sniper", "Sniper", "Win a Dice roll at 49× or more", "classics", best("dice", 49)],
  ["dice-roller", "Dice Roller", "Roll Dice 100 times", "classics", plays("dice", 100)],
  ["plinko-legend", "Plinko Legend", "Land a 100× or better Plinko slot", "classics", best("plinko", 100)],
  ["peg-bouncer", "Peg Bouncer", "Drop 100 Plinko balls", "classics", plays("plinko", 100)],
  ["lucky-numbers", "Lucky Numbers", "Win 100× or more in Keno", "classics", best("keno", 100)],
  ["ball-caller", "Ball Caller", "Play 100 Keno draws", "classics", plays("keno", 100)],
  ["quad-squad", "Quad Squad", "Make four of a kind or better in Video Poker", "classics", best("video-poker", 25)],
  ["royal-flush", "Royal Flush", "Hit a royal flush in Video Poker (800×)", "classics", best("video-poker", 800)],

  ["live-pilot", "Live Pilot", "Cash out in the live rocket", "live", once((ctx) => game(ctx, "live-rocket").best > 0)],
  ["live-wire", "Live Wire", "Cash out the live rocket at 10× or more", "live", best("live-rocket", 10)],
  ["red-or-black", "Red or Black", "Win a Live Roulette round", "live", wins("live-roulette", 1)],
  ["green-machine", "Green Machine", "Win on green in Live Roulette", "live", once((ctx) => flag(ctx, "live-roulette", (play) => play.color === "green" && play.payout > 0))],
  ["arena-champion", "Arena Champion", "Win a case battle", "live", once((ctx) => flag(ctx, "case-battle", (play) => Boolean(play.won)))],
  ["gladiator", "Gladiator", "Complete 25 case battles", "live", plays("case-battle", 25)],
  ["warlord", "Warlord", "Finish 10 case battles in profit", "live", wins("case-battle", 10)],

  ["heads-up", "Heads Up", "Win a Coinflip", "tables", wins("coinflip", 1)],
  ["double-or-nothing", "Double or Nothing", "Win 10 Coinflips", "tables", wins("coinflip", 10)],
  ["table-natural", "Table Natural", "Hit a blackjack at a live Blackjack table", "tables", once((ctx) => flag(ctx, "live-blackjack", (play) => Boolean(play.natural)))],
  ["house-breaker", "House Breaker", "Win 10 hands at live Blackjack tables", "tables", wins("live-blackjack", 10)],
  ["pot-taker", "Pot Taker", "Win a Poker hand", "tables", once((ctx) => game(ctx, "poker").wins > 0 || flag(ctx, "poker", (play) => Boolean(play.won)))],
  ["flush-rush", "Flush Rush", "Win a Poker showdown with a flush or better", "tables", once((ctx) => flag(ctx, "poker", (play) => Boolean(play.won) && FLUSH_PLUS.has(play.hand)))],
  ["quads", "Four of a Kind", "Show down quads or better in Poker", "tables", once((ctx) => flag(ctx, "poker", (play) => QUADS_PLUS.has(play.hand)))],
  ["royal-treatment", "Royal Treatment", "Show down a royal flush in Poker", "tables", once((ctx) => flag(ctx, "poker", (play) => play.hand === "royal-flush"))],
  ["survivor", "Survivor", "Survive a Russian Roulette table", "tables", once((ctx) => flag(ctx, "russian-roulette", (play) => Boolean(play.won)))],
  ["daredevil", "Daredevil", "Win 5 Russian Roulette tables", "tables", wins("russian-roulette", 5)],
  ["bang", "Bang", "Take the bullet in Russian Roulette", "tables", once((ctx) => flag(ctx, "russian-roulette", (play) => Boolean(play.shot)))],
];

const RULES = new Map();
/** Public achievement list. `reward` stays 0: achievements grant cosmetics, never credits. */
export const ACHIEVEMENTS = DEFINITIONS.map(([id, name, description, category, rule]) => {
  RULES.set(id, rule);
  return Object.freeze({
    id,
    name,
    description,
    category,
    categoryName: CATEGORIES[category],
    reward: 0,
    unlocks: cosmeticsFor(id).map(({ id: itemId, kind, name: itemName, rarity }) => ({ id: itemId, kind, name: itemName, rarity })),
  });
});

const passes = (rule, ctx) => (rule.check ? rule.check(ctx) : rule.value(ctx) >= rule.target);

/** Progress `{ value, target, unit }` for count-style achievements (null for one-off feats). */
export function progressOf(id, ctx) {
  const rule = RULES.get(id);
  if (!rule?.value) return null;
  return { value: Math.max(0, Math.min(rule.value(ctx), rule.target)), target: rule.target, unit: rule.unit };
}

/** Lifetime aggregates of a player's plays (3 small queries), shared by recordPlay and the profile. */
export async function achievementContext(store, userId, play = null) {
  const rows = (
    await store.execute({
      sql: `SELECT game, COUNT(*) AS plays, SUM(wager_cents) AS wagered, SUM(payout_cents) AS returned,
        SUM(CASE WHEN payout_cents>wager_cents THEN 1 ELSE 0 END) AS wins,
        MAX(CASE WHEN payout_cents>0 THEN multiplier ELSE 0 END) AS best,
        MAX(payout_cents-wager_cents) AS top_profit, MAX(wager_cents) AS max_wager,
        MIN(CASE WHEN wager_cents>0 THEN wager_cents END) AS min_wager
        FROM plays WHERE user_id=? GROUP BY game`,
      args: [userId],
    })
  ).rows;
  const games = new Map();
  const totals = { plays: 0, wins: 0, wagered: 0, returned: 0, best: 0, topProfit: 0, maxWager: 0, minWager: null, net: 0 };
  for (const row of rows) {
    const entry = {
      plays: Number(row.plays),
      wins: Number(row.wins || 0),
      wagered: Number(row.wagered || 0),
      returned: Number(row.returned || 0),
      best: Number(row.best || 0),
      topProfit: Number(row.top_profit || 0),
      maxWager: Number(row.max_wager || 0),
      minWager: row.min_wager === null || row.min_wager === undefined ? null : Number(row.min_wager),
    };
    games.set(row.game, entry);
    totals.plays += entry.plays;
    totals.wins += entry.wins;
    totals.wagered += entry.wagered;
    totals.returned += entry.returned;
    totals.best = Math.max(totals.best, entry.best);
    totals.topProfit = Math.max(totals.topProfit, entry.topProfit);
    totals.maxWager = Math.max(totals.maxWager, entry.maxWager);
    if (entry.minWager !== null) totals.minWager = totals.minWager === null ? entry.minWager : Math.min(totals.minWager, entry.minWager);
  }
  totals.net = totals.returned - totals.wagered;
  const recent = (
    await store.execute({
      sql: `SELECT wager_cents, payout_cents FROM plays WHERE user_id=? ORDER BY id DESC LIMIT ${STREAK_WINDOW}`,
      args: [userId],
    })
  ).rows;
  const run = (test) => {
    let length = 0;
    while (length < recent.length && test(recent[length])) length++;
    return length;
  };
  const streak = {
    wins: run((row) => row.payout_cents > row.wager_cents),
    losses: run((row) => row.payout_cents < row.wager_cents),
  };
  return { play, games, totals, streak };
}

/**
 * Records a finished play and stores any newly earned achievements inside `tx`.
 * `play` = { userId, game, wager (cents), payout (cents), at, ...flags } where flags may be
 * natural, gems, won, color, hand, shot (see .amp/in/rooms-contract.md).
 * Returns the newly unlocked achievements (each with the cosmetics it `unlocks`). Never touches the balance.
 */
export async function recordPlay(tx, play) {
  await tx.execute({
    sql: "INSERT INTO plays(user_id,game,wager_cents,payout_cents,multiplier,created_at) VALUES(?,?,?,?,?,?)",
    args: [play.userId, play.game, play.wager, play.payout, play.wager > 0 ? play.payout / play.wager : 0, play.at],
  });
  const ctx = await achievementContext(tx, play.userId, play);
  const owned = new Set(
    (await tx.execute({ sql: "SELECT id FROM achievements WHERE user_id=?", args: [play.userId] })).rows.map((row) => row.id),
  );
  const unlocked = [];
  for (const achievement of ACHIEVEMENTS) {
    if (owned.has(achievement.id) || !passes(RULES.get(achievement.id), ctx)) continue;
    const insert = await tx.execute({
      sql: "INSERT OR IGNORE INTO achievements(user_id,id,unlocked_at) VALUES(?,?,?)",
      args: [play.userId, achievement.id, play.at],
    });
    if (insert.rowsAffected) unlocked.push(achievement);
  }
  return unlocked;
}

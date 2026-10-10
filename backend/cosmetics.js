// Cosmetics catalog: profile pictures, avatar frames, name colours and titles.
// Items are unlocked by default or by an achievement (`source` = achievement id). Unlocks are never
// stored separately: a player owns every default item plus the items of their unlocked achievements,
// so new or re-mapped rewards apply retroactively. Equipped items live in users.avatar/frame/name_color/title.
// This module has no imports so the room manager, achievements and profile can all depend on it.

export const COSMETIC_KINDS = ["avatar", "frame", "color", "title"];
export const RARITIES = ["common", "rare", "epic", "legendary"];

// [id, name, rarity, source]
const AVATARS = [
  ["orb", "Plasma Orb", "common", "default"],
  ["bolt", "Volt", "common", "default"],
  ["diamond", "Diamond", "common", "default"],
  ["chip", "House Chip", "common", "default"],
  ["spade", "Spade", "common", "default"],
  ["heart", "Heart", "common", "default"],
  ["club", "Club", "common", "warming-up"],
  ["star", "Supernova", "rare", "tenfold"],
  ["coin", "Gold Coin", "rare", "payday"],
  ["flame", "Wildfire", "rare", "hot-streak"],
  ["ghost", "Ghost", "rare", "rock-bottom"],
  ["planet", "Ringed Planet", "rare", "explorer"],
  ["robot", "Unit-21", "rare", "originals-tour"],
  ["ace", "Ace of Spades", "rare", "natural"],
  ["yinyang", "Balance", "epic", "tie-breaker"],
  ["gem", "Emerald Cut", "rare", "gem-hunter"],
  ["bomb", "Live Wire Bomb", "rare", "sapper"],
  ["rocket", "Rocket", "rare", "liftoff"],
  ["target", "Bullseye", "epic", "straight-up"],
  ["eye", "All-Seeing Eye", "epic", "sniper"],
  ["dice", "Loaded Dice", "common", "dice-roller"],
  ["clover", "Four-Leaf Clover", "epic", "lucky-numbers"],
  ["crown", "Crown", "legendary", "royal-flush"],
  ["joker", "Joker", "epic", "quad-squad"],
  ["seven", "Lucky Seven", "epic", "lucky-sevens"],
  ["cherry", "Cherries", "rare", "fruit-salad"],
  ["moon", "Moonrise", "common", "live-pilot"],
  ["wheel", "Roulette Wheel", "common", "red-or-black"],
  ["sword", "Arena Blade", "rare", "arena-champion"],
  ["cat", "Lucky Cat", "common", "heads-up"],
  ["chips", "Chip Stack", "common", "pot-taker"],
  ["alien", "Visitor", "epic", "quads"],
  ["revolver", "Six-Shooter", "rare", "survivor"],
  ["skull", "Skull", "common", "bang"],
  ["shark", "Shark", "legendary", "whale"],
];

const FRAMES = [
  ["steel", "Brushed Steel", "rare", "centum"],
  ["neon", "Neon Pulse", "rare", "classics-tour"],
  ["gold", "Solid Gold", "epic", "centurion"],
  ["rainbow", "Spectrum", "legendary", "moonshot"],
  ["fire", "Inferno", "epic", "on-fire"],
  ["glitch", "Glitch", "epic", "neon-dreams"],
  ["ice", "Permafrost", "epic", "deep-miner"],
  ["toxic", "Toxic", "epic", "plinko-legend"],
  ["electric", "High Voltage", "epic", "live-wire"],
  ["holo", "Hologram", "legendary", "completionist"],
  ["abyss", "Abyss", "legendary", "leviathan"],
  ["royal", "Royal Laurel", "legendary", "warlord"],
];

const COLORS = [
  ["lime", "Lime", "common", "in-the-green"],
  ["cyan", "Cyan", "common", "big-spender"],
  ["pink", "Hot Pink", "common", "peg-bouncer"],
  ["gold", "Gold Leaf", "epic", "tycoon"],
  ["crimson", "Crimson", "rare", "wheel-watcher"],
  ["violet", "Violet", "rare", "punto-banco"],
  ["emerald", "Emerald", "epic", "green-machine"],
  ["sunset", "Sunset Gradient", "rare", "slot-spinner"],
  ["aurora", "Aurora Gradient", "epic", "double-or-nothing"],
  ["chrome", "Chrome Gradient", "legendary", "max-bet"],
];

const TITLES = [
  ["newcomer", "Newcomer", "common", "default"],
  ["rookie", "Rookie", "common", "first-play"],
  ["regular", "Regular", "common", "regular"],
  ["veteran", "Veteran", "rare", "veteran"],
  ["grinder", "The Grinder", "epic", "grinder"],
  ["high-roller", "High Roller", "rare", "high-roller"],
  ["whale", "Whale", "epic", "whale"],
  ["leviathan", "Leviathan", "legendary", "leviathan"],
  ["jackpot", "Jackpot", "legendary", "jackpot"],
  ["tycoon", "Tycoon", "legendary", "tycoon"],
  ["unstoppable", "Unstoppable", "epic", "unstoppable"],
  ["penny-pincher", "Penny Pincher", "common", "penny-pincher"],
  ["completionist", "Completionist", "legendary", "completionist"],
  ["card-shark", "Card Shark", "rare", "card-shark"],
  ["astronaut", "Astronaut", "epic", "escape-velocity"],
  ["ball-caller", "Ball Caller", "rare", "ball-caller"],
  ["royalty", "Royalty", "legendary", "royal-flush"],
  ["bandit", "One-Armed Bandit", "rare", "one-armed-bandit"],
  ["gladiator", "Gladiator", "rare", "gladiator"],
  ["dealers-bane", "Dealer's Bane", "rare", "table-natural"],
  ["house-breaker", "House Breaker", "epic", "house-breaker"],
  ["poker-face", "Poker Face", "epic", "flush-rush"],
  ["untouchable", "Untouchable", "legendary", "royal-treatment"],
  ["daredevil", "Daredevil", "epic", "daredevil"],
  ["card-counter", "Card Counter", "rare", "card-counter"],
  ["tai-sai", "Tai Sai", "rare", "tai-sai"],
  ["big-six", "Big Six", "epic", "big-six"],
];

export const COSMETICS = [
  ...AVATARS.map((item) => [...item, "avatar"]),
  ...FRAMES.map((item) => [...item, "frame"]),
  ...COLORS.map((item) => [...item, "color"]),
  ...TITLES.map((item) => [...item, "title"]),
].map(([id, name, rarity, source, kind]) => Object.freeze({ id, kind, name, rarity, source }));

const byKey = new Map(COSMETICS.map((item) => [`${item.kind}:${item.id}`, item]));
/** Catalog entry for `kind`/`id`, or undefined. */
export const cosmetic = (kind, id) => byKey.get(`${kind}:${id}`);

/** Cosmetics granted by one achievement. */
export const cosmeticsFor = (achievementId) => COSMETICS.filter((item) => item.source === achievementId);

/** Set of "kind:id" keys owned by a player with the given unlocked achievement ids (admins own everything). */
export function ownedKeys(achievementIds, admin = false) {
  const unlocked = new Set(achievementIds);
  return new Set(
    COSMETICS.filter((item) => admin || item.source === "default" || unlocked.has(item.source)).map((item) => `${item.kind}:${item.id}`),
  );
}

/** users table column holding each kind's equipped id. */
export const COLUMNS = { avatar: "avatar", frame: "frame", color: "name_color", title: "title" };

// Player look (profile picture + cosmetics) shown next to a name in rooms, battles and lobbies.
// `row` is a users table row. Returns a JSON-safe object; every field may be null (= default look).
// `titleName` carries the display text so clients can show titles without the catalog.
export function lookOf(row) {
  const pick = (kind) => {
    const id = row?.[COLUMNS[kind]] ?? null;
    return id && cosmetic(kind, id) ? id : null;
  };
  const title = pick("title");
  return {
    avatar: pick("avatar"),
    frame: pick("frame"),
    color: pick("color"),
    title,
    titleName: title ? cosmetic("title", title).name : null,
  };
}

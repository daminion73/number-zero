export const ALL_ROLL_COUNT = 1_000_001;
export const CASE_RTP = 0.98;
export const EP_PER_CREDIT = 1_000;
export const GOLD_COIN_OUTCOMES = 4_000;
export const GOLD_COIN_CHANCE = GOLD_COIN_OUTCOMES / ALL_ROLL_COUNT;
export const GOLD_MULTIPLIERS = [[50, 60], [75, 22], [100, 12], [250, 4.5], [500, 1.2], [1000, .3]];
export const NESTED_MULTIPLIERS = [[40, 50], [60, 25], [100, 15], [200, 7], [400, 2.5], [800, .5]];

const DROP_ODDS = [
  ["common", 32.5], ["common", 32.5],
  ["uncommon", 12], ["uncommon", 12],
  ["rare", 4], ["rare", 4],
  ["epic", 1.25], ["epic", 1.25],
  ["mythic", 0.25], ["mythic", 0.25],
];
const CASE_RARITIES = new Set(["common", "uncommon", "rare", "epic", "mythic"]);
export const ODDS_PROFILES = {
  steady: [["common", 25], ["common", 25], ["uncommon", 17.5], ["uncommon", 17.5], ["rare", 5], ["rare", 5], ["epic", 2], ["epic", 2], ["mythic", 0.5], ["mythic", 0.5]],
  balanced: DROP_ODDS,
  volatile: [["common", 36], ["common", 36], ["uncommon", 10], ["uncommon", 10], ["rare", 3], ["rare", 3], ["epic", 0.8], ["epic", 0.8], ["mythic", 0.2], ["mythic", 0.2]],
  wild: [["common", 39], ["common", 39], ["uncommon", 7.5], ["uncommon", 7.5], ["rare", 2.5], ["rare", 2.5], ["epic", 0.875], ["epic", 0.875], ["mythic", 0.125], ["mythic", 0.125]],
  extreme: [["common", 43.5], ["common", 43.5], ["uncommon", 4.5], ["uncommon", 4.5], ["rare", 1.5], ["rare", 1.5], ["epic", 0.375], ["epic", 0.375], ["mythic", 0.125], ["mythic", 0.125]],
  maximum: [["common", 48.5], ["common", 48.5], ["uncommon", 1], ["uncommon", 1], ["rare", 0.35], ["rare", 0.35], ["epic", 0.125], ["epic", 0.125], ["mythic", 0.025], ["mythic", 0.025]],
};
export const CASE_IMAGES = ["assets/case-nano.png", "assets/case-signal.png", "assets/case-nova.png", "assets/case-singularity.png"];

const fibonacci = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10946, 17711, 28657, 46368, 75025, 121393, 196418, 317811, 514229, 832040];
const powersOfTwo = Array.from({ length: 20 }, (_, index) => 2 ** index);
const factorials = [1, 2, 6, 24, 120, 720, 5_040, 40_320, 362_880];
const primes = [2, 3, 5, 7, 11, 97, 997, 9_973, 99_991, 999_983];
const cubes = Array.from({ length: 100 }, (_, index) => index ** 3);
const tauValues = [6_283, 62_831, 628_318];
const eulerValues = [271, 2_718, 27_182, 271_828];
const strobogrammaticValues = [11, 69, 88, 96, 101, 111, 609, 808, 906, 1_001, 6_009, 8_008, 9_006];
const spyValues = [22, 123, 132, 213, 231, 312, 321, 1_124];
const blackjackValues = [399, 489, 579, 669, 759, 849, 939, 1_299];

const digitSum = (number) => [...String(number)].reduce((sum, digit) => sum + Number(digit), 0);
const palindrome = (seed) => {
  const length = 3 + seed % 4;
  const halfLength = Math.ceil(length / 2);
  const minimum = 10 ** (halfLength - 1);
  const half = String(minimum + Math.floor(seed / 7) % (9 * minimum));
  return Number(half + [...half.slice(0, Math.floor(length / 2))].reverse().join(""));
};

export const TRAITS = {
  even: ["Even Signal", "Every result is divisible by two", (seed) => seed - seed % 2],
  lowdigits: ["Low Digits", "Every digit is between zero and four", (seed) => Number([...String(seed % 1_000_000).padStart(6, "1")].map((digit) => Number(digit) % 5).join(""))],
  clean: ["Clean Ending", "Every result ends in zero", (seed) => Math.floor(seed / 10) * 10],
  doublezero: ["Double Void", "Every result ends in double zero", (seed) => (1 + Math.floor(seed / 100) % 9_999) * 100],
  pair: ["Twin Digits", "Every result contains an adjacent pair", (seed) => Number(`${1 + Math.floor(seed / 100) % 9}${seed % 10}${seed % 10}${String(Math.floor(seed / 1_000) % 100).padStart(2, "0")}`)],
  five: ["Five Figure", "Every result has exactly five digits", (seed) => 10_000 + seed % 90_000],
  palindrome: ["Mirror Number", "Every result reads the same backwards", palindrome],
  repeatedpair: ["Double Pair", "Every result contains two matching pairs", (seed) => Number(`${1 + seed % 9}${seed % 10}${seed % 10}${Math.floor(seed / 10) % 10}${Math.floor(seed / 10) % 10}`)],
  homogeneous: ["Monochrome", "Every digit is identical", (seed) => Number(String(1 + seed % 9).repeat(2 + Math.floor(seed / 9) % 5))],
  zero: ["Absolute Zero", "The result can only be zero", () => 0],

  odd: ["Odd Signal", "Every result is an odd number", (seed) => seed === 1_000_000 ? 999_999 : seed % 2 ? seed : seed + 1],
  sixdigits: ["Six Figure", "Every result has exactly six digits", (seed) => 100_000 + seed % 900_000],
  seven: ["Sevenfold", "Every result is divisible by seven", (seed) => seed - seed % 7],
  dozen: ["By The Dozen", "Every result is divisible by twelve", (seed) => seed - seed % 12],
  sequence: ["Sequence Seed", "Every result contains 123", (seed) => (seed % 1_000) * 1_000 + 123],
  descending: ["Downfall", "Every result contains descending digits", (seed) => [987_654, 876_543, 765_432, 654_321, 98_765, 9_876][seed % 6]],
  triple: ["Triple Stack", "Every result contains three matching digits", (seed) => Number(`${1 + Math.floor(seed / 10) % 9}${String(seed % 10).repeat(3)}${String(Math.floor(seed / 100) % 100).padStart(2, "0")}`)],
  factorial: ["Factorial File", "Every result is an exact factorial", (seed) => factorials[seed % factorials.length]],
  fibonacci: ["Fibonacci Archive", "Every result belongs to the Fibonacci sequence", (seed) => fibonacci[seed % fibonacci.length]],
  jackpot: ["Jackpot 777", "Every result contains triple seven", (seed) => (seed % 1_000) * 1_000 + 777],

  nozero: ["Voidless", "Every result contains no zeroes", (seed) => Number(String(seed === 1_000_000 ? 111_111 : seed || 1).replaceAll("0", "1"))],
  containszero: ["Ghost Digit", "Every result contains a zero", (seed) => Number(`1${String(seed % 1_000).padStart(3, "1")}0`)],
  harshad: ["Harshad Core", "Every result is divisible by its digit sum", (seed) => {
    for (let offset = 0; offset < 200; offset++) {
      const candidate = (seed + offset) % ALL_ROLL_COUNT;
      const sum = digitSum(candidate);
      if (sum && candidate % sum === 0) return candidate;
    }
    return 12;
  }],
  square: ["Perfect Square", "Every result is an exact square", (seed) => Math.floor(Math.sqrt(seed)) ** 2],
  alternating: ["Alternating Charge", "Odd and even digits alternate", (seed) => Number([...String(seed % 1_000_000).padStart(6, "1")].map((digit, index) => {
    const value = Number(digit);
    const expectedParity = index % 2 === 0 ? 1 : 0;
    return value % 2 === expectedParity ? value : (value + 1) % 10;
  }).join(""))],
  bookend: ["Bookended", "Every result starts and ends alike", (seed) => {
    const edge = 1 + seed % 9;
    return Number(`${edge}${String(Math.floor(seed / 9) % 10_000).padStart(4, "0")}${edge}`);
  }],
  fourtwenty: ["420 Imprint", "Every result contains 420", (seed) => (seed % 1_000) * 1_000 + 420],
  contains69: ["Nice Imprint", "Every result contains 69", (seed) => (seed % 10_000) * 100 + 69],
  prime: ["Prime Vault", "Every result is a prime number", (seed) => primes[seed % primes.length]],
  cube: ["Perfect Cube", "Every result is an exact cube", (seed) => cubes[seed % cubes.length]],

  highdigits: ["High Roller", "Every digit is between five and nine", (seed) => Number([...String(seed % 1_000_000).padStart(6, "1")].map((digit) => 5 + Number(digit) % 5).join(""))],
  eleven: ["Elevenfold", "Every result is divisible by eleven", (seed) => seed - seed % 11],
  ascending: ["Ascending Run", "Every result is a rising digit sequence", (seed) => [12, 123, 1234, 12345, 123456, 23456, 345678, 456789][seed % 8]],
  binary: ["Binary Soul", "Every result uses only zeroes and ones", (seed) => Number((1 + seed % 63).toString(2))],
  power: ["Power of Two", "Every result is an exact power of two", (seed) => powersOfTwo[seed % powersOfTwo.length]],
  pi: ["Pi Sequence", "Every result begins with the digits of pi", (seed) => [314, 3141, 31415, 314159][seed % 4]],
  golden: ["Golden Ratio", "Every result begins with the golden ratio", (seed) => [1618, 16180, 161803][seed % 3]],
  meaning: ["Meaning of Life", "Every result contains forty-two", (seed) => (seed % 10_000) * 100 + 42],
  funny: ["Funny Number", "The result can only be 42069", () => 42_069],
  million: ["The Million", "The only seven-digit result", () => 1_000_000],

  tau: ["Tau Signal", "Every result begins with the digits of tau", (seed) => tauValues[seed % tauValues.length]],
  euler: ["Euler Signal", "Every result begins with Euler's number", (seed) => eulerValues[seed % eulerValues.length]],
  leet: ["Leet Imprint", "Every result contains 1337", (seed) => (seed % 100) * 10_000 + 1_337],
  devil: ["Devil Imprint", "Every result contains triple six", (seed) => (seed % 1_000) * 1_000 + 666],
  emergency: ["Emergency Imprint", "Every result contains 911", (seed) => (seed % 1_000) * 1_000 + 911],
  calendar: ["Calendar Imprint", "Every result contains 365", (seed) => (seed % 1_000) * 1_000 + 365],
  strobogrammatic: ["Rotational Soul", "Every result reads correctly upside down", (seed) => strobogrammaticValues[seed % strobogrammaticValues.length]],
  heavy: ["Heavy Metal", "Every result has a digit sum of at least 45", (seed) => Number(Array.from({ length: 6 }, (_, index) => 8 + (Math.floor(seed / 2 ** index) % 2)).join(""))],
  luckyseven: ["Lucky Presence", "Every result contains a seven", (seed) => Number(`7${String(seed % 100_000).padStart(5, "0")}`)],
  unique: ["Unique Spectrum", "Every result has no repeated digit", (seed) => [123_456, 234_567, 345_678, 456_789, 102_345, 210_987][seed % 6]],
  spy: ["Spy Cache", "Every result has equal digit sum and product", (seed) => spyValues[seed % spyValues.length]],
  blackjack: ["Blackjack Cache", "Every result has a digit sum of exactly 21", (seed) => blackjackValues[seed % blackjackValues.length]],
};

export const TRAIT_ICONS = {
  even: "1f523", lowdigits: "1f523", clean: "1f573", doublezero: "1f573", pair: "1f0cf", five: "1f522", palindrome: "1fa9e", repeatedpair: "1f0cf", homogeneous: "1f523", zero: "1f573",
  odd: "1f523", sixdigits: "1f522", seven: "1f3b0", dozen: "1f522", sequence: "1fa9c", descending: "1f3d4", triple: "1f0cf", factorial: "26a1", fibonacci: "1f9ee", jackpot: "1f3b0",
  nozero: "1f573", containszero: "1f573", harshad: "1f522", square: "26a1", alternating: "1f523", bookend: "1fa9e", fourtwenty: "1f33f", contains69: "1f60f", prime: "1f522", cube: "26a1",
  highdigits: "1f3c5", eleven: "1f522", ascending: "1fa9c", binary: "1f4be", power: "26a1", pi: "1f9ee", golden: "1f9ee", meaning: "1f30c", funny: "1f60f", million: "1f3c5",
  tau: "1f9ee", euler: "1f9ee", leet: "1f4be", devil: "1f608", emergency: "1f6a8", calendar: "1f4c5", strobogrammatic: "1fa9e", heavy: "1f3c5", luckyseven: "1f3b0", unique: "1fa9c", spy: "1f522", blackjack: "1f0cf",
};

// Exact full-pool averages from exhaustively scoring all 1,000,001 seeds.
// Cases use these values to normalize unlike pools to the same long-run RTP.
export const TRAIT_EXPECTED_EP = {
  even: 33480.67054832945, lowdigits: 182273.8040921959, clean: 42517.77412122588, doublezero: 137091.83075516924, pair: 77150.80215419785, five: 37915.99397800602, palindrome: 1840089.6421933577, repeatedpair: 168391.23393876606, homogeneous: 15187187.127325872, zero: 339877711,
  odd: 33484.75166924833, sixdigits: 27506.089995910002, seven: 41668.44219055781, dozen: 42071.43811356189, sequence: 444282.9554320446, descending: 12222765.546441454, triple: 174017.8906951093, factorial: 81832603.91493909, fibonacci: 45712430.67587133, jackpot: 391390.14004086,
  nozero: 37082.012557987444, containszero: 77489.43054756946, harshad: 48538.47772552227, square: 397464.19324780675, alternating: 81398.95428704571, bookend: 32892.571634428365, fourtwenty: 353382.80875119125, contains69: 55997.828595171406, prime: 53588064.35202765, cube: 12515929.491781509,
  highdigits: 144767.32896767103, eleven: 44686.320952679045, ascending: 12064755.926262073, binary: 10872185.2001698, power: 60886078.31471269, pi: 27821362.842057157, golden: 33344564.672337327, meaning: 47160.99590600409, funny: 51707267, million: 134558559,
  tau: 37007011.33817166, euler: 27814190.08861691, leet: 1346081.7754432245, devil: 302611.6517993482, emergency: 250552.75581024418, calendar: 288936.86382413615, strobogrammatic: 21319190.94321206, heavy: 1113780.3009336991, luckyseven: 25298.837904162097, unique: 13957880.115431884, spy: 2934721.063149937, blackjack: 367961.661970338,
};

const THEME_COLLECTIONS = [
  ["Tech", "⌁", ["Nano Cache", "Signal Crate", "Cipher Core", "Circuit Breaker", "Quantum Node", "Data Ghost", "Neon Mainframe", "Chrome Protocol", "Firewall Forge", "Pixel Reactor", "Kernel Panic", "Proxy Pulse", "Byte Bunker", "Cloud Cipher", "Root Access", "Packet Storm", "Silicon Vault", "Neural Link", "Debug Chamber", "Source Code"]],
  ["Cosmic", "✦", ["Nova Vault", "Singularity", "Event Horizon", "Lunar Relay", "Solar Flare", "Comet Tail", "Dark Matter", "Starforge", "Pulsar Rift", "Cosmic Dust", "Nebula Crown", "Orbit Breaker", "Galaxy Gate", "Meteor Cache", "Quasar Core", "Red Giant", "Asteroid Belt", "Moonfall", "Stellar Drift", "Supernova"]],
  ["Lucky", "7", ["Lucky Circuit", "Jackpot 777", "Golden Hour", "Fortune Engine", "Seven Heaven", "Clover Code", "Dice Dynasty", "Wild Card", "Lucky Streak", "Final Bet", "Ace High", "Fortune Cookie", "Loaded Dice", "Lucky Penny", "Triple Crown", "Roulette Rush", "Winning Ticket", "House Edge", "Bonus Round", "Grand Prize"]],
  ["Void", "Ø", ["Void Runner", "Blackout 420", "Absolute Nothing", "Ghost Digit", "Zero Point", "Null Sector", "Deep Space", "Dark Terminal", "Empty Set", "Midnight Error", "Abyss Walker", "Dead Channel", "Lost Packet", "Shadow Realm", "Silent Orbit", "Event Null", "Dark Frequency", "Unknown Signal", "Phantom Core", "Final Silence"]],
  ["Math", "∑", ["Number Theory", "Prime Directive", "Cosmic Constants", "Fibonacci File", "Euler Engine", "Tau Temple", "Perfect Power", "Factorial Lab", "Golden Ratio", "Pi Protocol", "Infinity Proof", "Decimal Drift", "Matrix Vault", "Algebra Core", "Calculus Cache", "Fractal Field", "Vector Space", "Remainder Room", "Logic Gate", "Final Equation"]],
  ["Pattern", "◫", ["Pattern Cache", "Pattern Hunter", "Mirror Maze", "Twin Signal", "Sequence Break", "Monochrome", "Double Vision", "Ascension", "Downfall", "Rotational Soul", "Echo Chamber", "Symmetry Line", "Repeat Offender", "Spiral Code", "Mosaic Vault", "Parallel Path", "Hidden Order", "Rhythm Grid", "Infinite Loop", "Perfect Pattern"]],
  ["Retro", "★", ["Arcade Overdrive", "CRT Static", "Laser Disc", "High Score", "Memory Card", "8-Bit Vault", "Glitch Tape", "Synth Wave", "Coin Slot", "Final Boss", "Pixel Palace", "Joystick Jam", "Floppy Fortune", "VHS Vault", "Turbo Cabinet", "Game Over", "Bonus Stage", "Power Up", "Continue Screen", "Insert Coin"]],
  ["Meme", "!?", ["Meme Machine", "Nice 69", "Devil's Deal", "Meaning 42", "Leet Speak", "Error 404", "Emergency 911", "Calendar 365", "Funny Number", "Internet Legend", "Touch Grass", "Skill Issue", "Main Character", "Plot Twist", "No Context", "Certified Classic", "Viral Moment", "Ratio Box", "Peak Cinema", "Final Form"]],
  ["Elemental", "ϟ", ["High Voltage", "Fire Sequence", "Ice Matrix", "Storm Signal", "Ocean Depths", "Terra Core", "Solar Bloom", "Toxic Pulse", "Crystal Cave", "Gravity Well", "Thunder Crown", "Lava Vault", "Frozen Core", "Wind Tunnel", "Tidal Force", "Earth Shaker", "Plasma Field", "Acid Rain", "Diamond Storm", "Primal Chaos"]],
  ["Prestige", "◆", ["Golden Archive", "Millionaire", "Crown Jewel", "Royal Flush", "Diamond Code", "Platinum Signal", "Black Label", "Apex Cache", "Mythic One", "Endgame Vault", "Sovereign Case", "Legacy Crown", "Masterpiece", "Elite Reserve", "Imperial Vault", "Obsidian Club", "Private Collection", "Ultra Rare", "Hall of Fame", "Ultimate Cache"]],
];

const THEME_COLORS = ["#c7ff36", "#53e7ff", "#ae70ff", "#ff5aa7", "#ffb52e", "#36f0c5", "#7d8cff", "#ff7353", "#72ff74", "#ffd43b"];
const THEME_SECONDARY = ["#53e7ff", "#7d8cff", "#ff4fd8", "#ff7353", "#ffd43b", "#c7ff36", "#ae70ff", "#ff5aa7", "#00f0ff", "#fff1a3"];
const CASE_COSTS = [250, 500, 750, 1_000, 1_500, 2_500, 4_200, 7_500, 15_000, 50_000];
const PROFILE_NAMES = ["steady", "balanced", "volatile", "wild", "extreme"];
const TIER_TRAITS = [
  ["luckyseven", "sixdigits", "bookend", "even", "odd", "nozero", "five", "seven", "dozen", "clean", "eleven", "meaning", "harshad", "contains69", "pair", "containszero", "alternating", "highdigits", "repeatedpair", "lowdigits"],
  ["emergency", "calendar", "devil", "blackjack", "fourtwenty", "jackpot", "square", "sequence", "heavy", "leet", "palindrome", "spy", "doublezero", "triple"],
  ["binary", "ascending", "descending", "cube", "unique", "homogeneous"],
  ["strobogrammatic", "euler", "pi", "golden", "tau"],
  ["fibonacci", "funny", "prime", "power", "factorial", "million"],
];

const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const themedTraits = (index) => TIER_TRAITS.flatMap((pool, tier) => {
  const first = (index * (tier * 2 + 3) + tier) % pool.length;
  const offset = 1 + Math.floor(index / pool.length) % (pool.length - 1);
  return [pool[first], pool[(first + offset) % pool.length]];
});

const standardCaseDefinitions = THEME_COLLECTIONS.flatMap(([category, glyph, names], collectionIndex) => names.map((name, localIndex) => {
  const index = collectionIndex * 20 + localIndex;
  return {
    id: index === 0 ? "nano" : slugify(name),
    name,
    cost: Math.round(CASE_COSTS[(localIndex + collectionIndex * 3) % CASE_COSTS.length] * (1 + collectionIndex * 0.08)) + (index === 71 ? 1 : 0),
    image: CASE_IMAGES[(collectionIndex + localIndex) % CASE_IMAGES.length],
    accent: THEME_COLORS[(collectionIndex + localIndex) % THEME_COLORS.length],
    secondary: THEME_SECONDARY[(collectionIndex * 3 + localIndex) % THEME_SECONDARY.length],
    category,
    glyph,
    themeNumber: index + 1,
    risk: PROFILE_NAMES[(collectionIndex + localIndex) % PROFILE_NAMES.length],
    odds: ODDS_PROFILES[PROFILE_NAMES[(collectionIndex + localIndex) % PROFILE_NAMES.length]],
    traitIds: themedTraits(index),
  };
}));

const HIGH_ROLLER_PREFIXES = ["Apex", "Sovereign", "Titan", "Monarch", "Vanguard", "Eclipse", "Diamond", "Fortune", "Empire", "Omega", "Crown", "Legacy", "Platinum", "Jackpot", "Billionaire"];
const HIGH_ROLLER_SUFFIXES = ["Reserve", "Treasury", "Penthouse", "Exchange", "Fortress"];
const HIGH_ROLLER_ODDS = [
  [["common", 20], ["common", 18], ["uncommon", 15], ["uncommon", 12], ["rare", 10], ["rare", 8], ["epic", 6], ["epic", 5], ["mythic", 4], ["mythic", 2]],
  [["common", 35], ["common", 25], ["uncommon", 15], ["uncommon", 10], ["rare", 6], ["rare", 4], ["epic", 2], ["epic", 1.5], ["mythic", 1], ["mythic", .5]],
  Array.from({ length: 10 }, (_, index) => [DROP_ODDS[index][0], 10]),
];
const HIGH_VALUE_TRAITS = Object.keys(TRAIT_EXPECTED_EP).sort((a, b) => TRAIT_EXPECTED_EP[b] - TRAIT_EXPECTED_EP[a]).slice(0, 18);
const highRollerTraits = (index) => {
  const pool = [...HIGH_VALUE_TRAITS];
  let seed = Math.imul(index + 1, 2_654_435_761) >>> 0;
  for (let cursor = pool.length - 1; cursor > 0; cursor--) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const swap = (seed >>> 0) % (cursor + 1);
    [pool[cursor], pool[swap]] = [pool[swap], pool[cursor]];
  }
  return pool.slice(0, 10).sort((a, b) => TRAIT_EXPECTED_EP[a] - TRAIT_EXPECTED_EP[b]);
};
const highRollerDefinitions = HIGH_ROLLER_PREFIXES.flatMap((prefix, prefixIndex) => HIGH_ROLLER_SUFFIXES.map((suffix, suffixIndex) => {
  const index = prefixIndex * HIGH_ROLLER_SUFFIXES.length + suffixIndex;
  return {
    id: `high-roller-${slugify(`${prefix}-${suffix}`)}`,
    name: `${prefix} ${suffix}`,
    image: CASE_IMAGES[index % CASE_IMAGES.length],
    accent: ["#ffd43b", "#ff8a34", "#ff4fd8", "#53e7ff", "#c7ff36"][suffixIndex],
    secondary: ["#fff1a3", "#ffd43b", "#ae70ff", "#7d8cff", "#53e7ff"][suffixIndex],
    category: "High Roller",
    glyph: "♛",
    themeNumber: standardCaseDefinitions.length + index + 1,
    risk: ["volatile", "wild", "extreme"][index % 3],
    odds: HIGH_ROLLER_ODDS[index % HIGH_ROLLER_ODDS.length].map((entry) => [...entry]),
    traitIds: highRollerTraits(index),
  };
}));

const MAXIMUM_PREFIXES = ["Zero-Day", "Cataclysm", "Doomsday", "Redline", "Black-Swan", "Meltdown", "Overkill", "Aftershock", "Deadlock", "Final-Hour"];
const MAXIMUM_SUFFIXES = ["Protocol", "Reactor", "Vault", "Payload", "Singularity"];
const maximumTraits = (index) => {
  const pool = Object.keys(TRAIT_EXPECTED_EP);
  let seed = Math.imul(index + 401, 2_246_822_519) >>> 0;
  for (let cursor = pool.length - 1; cursor > 0; cursor--) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const swap = (seed >>> 0) % (cursor + 1);
    [pool[cursor], pool[swap]] = [pool[swap], pool[cursor]];
  }
  return pool.slice(0, 10).sort((a, b) => TRAIT_EXPECTED_EP[a] - TRAIT_EXPECTED_EP[b]);
};
const maximumDefinitions = MAXIMUM_PREFIXES.flatMap((prefix, prefixIndex) => MAXIMUM_SUFFIXES.map((suffix, suffixIndex) => {
  const index = prefixIndex * MAXIMUM_SUFFIXES.length + suffixIndex;
  return {
    id: `maximum-${slugify(`${prefix}-${suffix}`)}`,
    name: `${prefix.replace("-", " ")} ${suffix}`,
    image: CASE_IMAGES[(index + 2) % CASE_IMAGES.length],
    accent: ["#ff3158", "#ff7a2f", "#f7e733", "#b85cff", "#35e9ff"][suffixIndex],
    secondary: ["#ff9aae", "#ffd0a8", "#fff5a1", "#e3b6ff", "#b4f7ff"][suffixIndex],
    category: "Maximum Volatility",
    glyph: "⚠",
    themeNumber: standardCaseDefinitions.length + highRollerDefinitions.length + index + 1,
    risk: "maximum",
    odds: ODDS_PROFILES.maximum.map((entry) => [...entry]),
    traitIds: maximumTraits(index),
  };
}));

const CASECEPTION_NAMES = ["Nested Fortune", "Vault Within", "Matryoshka Cache", "Recursive Riches", "Inner Circle", "Second Secret", "Double Blind", "Hidden Chamber", "Pocket Dimension", "Caseception Prime"];
const NESTED_POOL_INDEXES = [
  [6, 7, 8, 9], [5, 7, 8, 9], [4, 6, 8, 9], [3, 5, 7, 9], [2, 4, 6, 8],
  [1, 4, 7, 9], [0, 3, 6, 9], [0, 2, 5, 8], [0, 1, 4, 7], [1, 2, 3, 9],
];
const NESTED_POOL_ODDS = [[45, 30, 20, 5], [15, 25, 30, 30], [10, 20, 30, 40], [60, 20, 15, 5]];
const caseceptionDefinitions = CASECEPTION_NAMES.map((name, index) => {
  const traitIds = maximumTraits(index + 100);
  const bonusIndexes = NESTED_POOL_INDEXES[index];
  return {
    id: `caseception-${slugify(name)}`,
    name,
    image: CASE_IMAGES[index % CASE_IMAGES.length],
    accent: ["#ff4fd8", "#53e7ff", "#c7ff36", "#ff8a34", "#ae70ff"][index % 5],
    secondary: ["#53e7ff", "#ff4fd8", "#ffd43b", "#ff5aa7", "#7d8cff"][index % 5],
    category: "Caseception",
    glyph: "▣",
    themeNumber: standardCaseDefinitions.length + highRollerDefinitions.length + maximumDefinitions.length + index + 1,
    risk: ["volatile", "wild", "extreme"][index % 3],
    odds: ODDS_PROFILES[["volatile", "wild", "extreme"][index % 3]].map((entry) => [...entry]),
    traitIds,
    bonusType: "nested",
    bonusTraitIds: bonusIndexes.map((poolIndex) => traitIds[poolIndex]),
    bonusOdds: NESTED_POOL_ODDS[index % NESTED_POOL_ODDS.length],
  };
});

const EXPANSION_SUFFIXES = ["Micro Cache", "Quickdraw", "Overload", "Spectrum", "Wildcard", "Gauntlet", "Cascade", "Infinity", "Switchback", "Apex Run"];
const EXPANSION_POOL_SIZES = [3, 4, 5, 6, 8, 12, 14, 16, 20, 24];
const EXPANSION_RISKS = ["steady", "balanced", "volatile", "wild", "extreme"];
const expansionTraits = (collectionIndex, localIndex, count) => {
  const pool = Object.keys(TRAIT_EXPECTED_EP);
  let seed = Math.imul(700 + collectionIndex * 31 + localIndex, 2_246_822_519) >>> 0;
  for (let cursor = pool.length - 1; cursor > 0; cursor--) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const swap = (seed >>> 0) % (cursor + 1);
    [pool[cursor], pool[swap]] = [pool[swap], pool[cursor]];
  }
  return pool.slice(0, count).sort((a, b) => TRAIT_EXPECTED_EP[a] - TRAIT_EXPECTED_EP[b]);
};
const expansionOdds = (count, risk) => {
  const exponent = { steady: 1.1, balanced: 1.45, volatile: 1.9, wild: 2.45, extreme: 3.1 }[risk];
  const weights = Array.from({ length: count }, (_, index) => (count - index) ** exponent);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let allocated = 0;
  const rarities = ["common", "uncommon", "rare", "epic", "mythic"];
  return weights.map((weight, index) => {
    const chance = index === count - 1 ? 100 - allocated : weight / total * 100;
    allocated += chance;
    const tier = count === 1 ? 0 : Math.round(index * (rarities.length - 1) / (count - 1));
    return [rarities[tier], chance];
  });
};
const expansionDefinitions = THEME_COLLECTIONS.flatMap(([category, glyph], collectionIndex) => EXPANSION_SUFFIXES.map((suffix, localIndex) => {
  const index = collectionIndex * EXPANSION_SUFFIXES.length + localIndex;
  const count = EXPANSION_POOL_SIZES[localIndex];
  const risk = EXPANSION_RISKS[(collectionIndex + localIndex) % EXPANSION_RISKS.length];
  return {
    id: `expansion-${slugify(`${category}-${suffix}`)}`,
    name: `${category} ${suffix}`,
    image: CASE_IMAGES[(collectionIndex + localIndex + 1) % CASE_IMAGES.length],
    accent: THEME_COLORS[(collectionIndex * 2 + localIndex) % THEME_COLORS.length],
    secondary: THEME_SECONDARY[(collectionIndex + localIndex * 3) % THEME_SECONDARY.length],
    category,
    glyph,
    themeNumber: standardCaseDefinitions.length + highRollerDefinitions.length + maximumDefinitions.length + caseceptionDefinitions.length + index + 1,
    risk,
    odds: expansionOdds(count, risk),
    traitIds: expansionTraits(collectionIndex, localIndex, count),
  };
}));
const caseDefinitions = [...standardCaseDefinitions, ...highRollerDefinitions, ...maximumDefinitions, ...caseceptionDefinitions, ...expansionDefinitions];

export function createCase(definition) {
  const { id, name, image = "assets/case-nova.png", accent = "#ae70ff", secondary = accent, category = "Community", glyph = "◇", themeNumber = 0, risk = "balanced", odds = DROP_ODDS, traitIds, bonusType = "gold", bonusTraitIds = [], bonusOdds = [] } = definition;
  if (!/^[a-z0-9-]{3,50}$/.test(id) || typeof name !== "string" || !name.trim() || name.length > 40) throw new RangeError("invalid case identity");
  const validOdds = Array.isArray(odds) && odds.length >= 1 && odds.length <= 50 && odds.every((entry) => Array.isArray(entry) && entry.length === 2 && CASE_RARITIES.has(entry[0]) && Number.isFinite(entry[1]) && entry[1] > 0);
  if (!CASE_IMAGES.includes(image) || !/^#[0-9a-f]{6}$/i.test(accent) || !/^#[0-9a-f]{6}$/i.test(secondary) || !validOdds || Math.abs(odds.reduce((sum, [, chance]) => sum + chance, 0) - 100) > 1e-7 || !Array.isArray(traitIds) || traitIds.length !== odds.length || traitIds.some((traitId) => !(traitId in TRAITS))) throw new RangeError("invalid case traits or odds");
  const drops = odds.map(([rarity, chance], index) => ({
    id: traitIds[index],
    name: TRAITS[traitIds[index]][0],
    description: TRAITS[traitIds[index]][1],
    rarity,
    chance,
  }));
  const disclosedPremiumChance = drops.filter((drop) => ["rare", "epic", "mythic"].includes(drop.rarity)).reduce((sum, drop) => sum + drop.chance, 0);
  const premiumChance = disclosedPremiumChance || 100;
  const nestedBonus = bonusType === "nested";
  const validNestedBonus = nestedBonus && bonusTraitIds.length >= 2 && bonusTraitIds.length === bonusOdds.length && bonusTraitIds.every((traitId) => traitIds.includes(traitId)) && bonusOdds.every((chance) => Number.isFinite(chance) && chance > 0) && Math.abs(bonusOdds.reduce((sum, chance) => sum + chance, 0) - 100) < 1e-7;
  if (!new Set(["gold", "nested"]).has(bonusType) || nestedBonus && !validNestedBonus) throw new RangeError("invalid bonus pool");
  const nestedWeights = new Map(bonusTraitIds.map((traitId, index) => [traitId, bonusOdds[index]]));
  drops.forEach((drop) => {
    drop.goldChance = nestedBonus ? nestedWeights.get(drop.id) || 0 : disclosedPremiumChance ? ["rare", "epic", "mythic"].includes(drop.rarity) ? drop.chance / premiumChance * 100 : 0 : drop.chance;
    drop.finalChance = drop.chance * (1 - GOLD_COIN_CHANCE) + drop.goldChance * GOLD_COIN_CHANCE;
  });
  const normalExpectedEp = drops.reduce((total, drop) => total + TRAIT_EXPECTED_EP[drop.id] * drop.chance / 100, 0);
  const bonusMultipliers = nestedBonus ? NESTED_MULTIPLIERS : GOLD_MULTIPLIERS;
  const expectedBonusMultiplier = bonusMultipliers.reduce((sum, [multiplier, percent]) => sum + multiplier * percent / 100, 0);
  const rawCost = (1 - GOLD_COIN_CHANCE) * (normalExpectedEp / EP_PER_CREDIT) / (CASE_RTP - GOLD_COIN_CHANCE * expectedBonusMultiplier);
  const cost = Math.round(rawCost * 100) / 100;
  const expectedPayout = (1 - GOLD_COIN_CHANCE) * normalExpectedEp / EP_PER_CREDIT + GOLD_COIN_CHANCE * cost * expectedBonusMultiplier;
  const expectedEp = expectedPayout * EP_PER_CREDIT;
  drops.forEach((drop) => {
    drop.expectedEp = TRAIT_EXPECTED_EP[drop.id];
    drop.weightedEp = drop.expectedEp * drop.finalChance / 100;
    drop.oneIn = 100 / drop.finalChance;
    drop.baseOneIn = 100 / drop.chance;
    drop.averagePayout = drop.expectedEp / EP_PER_CREDIT;
    drop.averageReturn = drop.averagePayout / cost;
  });
  return {
    id, name: name.trim(), cost, image, accent, secondary, category, glyph, themeNumber, risk, drops, expectedEp, normalExpectedEp, premiumChance: disclosedPremiumChance, bonusType,
    bonusChance: GOLD_COIN_CHANCE, bonusMultipliers: bonusMultipliers.map(([multiplier, percent]) => ({ multiplier, percent })), expectedBonusMultiplier,
    denominator: EP_PER_CREDIT,
    expectedPayout,
    definition: { id, name: name.trim(), cost, image, accent, secondary, category, glyph, themeNumber, risk, odds: odds.map((entry) => [...entry]), traitIds: [...traitIds], ...(nestedBonus ? { bonusType, bonusTraitIds: [...bonusTraitIds], bonusOdds: [...bonusOdds] } : {}) },
  };
}

export const CASES = caseDefinitions.map(createCase);

export function drawCaseDrop(caseItem, roll) {
  if (!caseItem?.drops || !Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError("invalid case draw");
  let cursor = roll * 100;
  for (const drop of caseItem.drops) {
    cursor -= drop.chance;
    if (cursor < 0) return drop;
  }
  return caseItem.drops.at(-1);
}

export function drawGoldDrop(caseItem, roll) {
  if (!caseItem?.drops || !Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError("invalid gold draw");
  let cursor = roll * 100;
  for (const drop of caseItem.drops) {
    cursor -= drop.goldChance;
    if (cursor < 0) return drop;
  }
  return caseItem.drops.filter((drop) => drop.goldChance > 0).at(-1);
}

export function drawBonusMultiplier(caseItem, roll) {
  if (!caseItem?.drops || !Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError("invalid bonus multiplier draw");
  let cursor = roll * 100;
  const table = caseItem.bonusType === "nested" ? NESTED_MULTIPLIERS : GOLD_MULTIPLIERS;
  for (const [multiplier, percent] of table) {
    cursor -= percent;
    if (cursor < 0) return multiplier;
  }
  return table.at(-1)[0];
}

export function drawCaseOutcome(caseItem, triggerNumber, itemRoll, multiplierRoll = itemRoll) {
  const gold = isGoldCoinRoll(triggerNumber);
  return { gold, drop: gold ? drawGoldDrop(caseItem, itemRoll) : drawCaseDrop(caseItem, itemRoll), multiplier: gold ? drawBonusMultiplier(caseItem, multiplierRoll) : null };
}

export function generateTraitNumber(traitId, seed) {
  if (!(traitId in TRAITS) || !Number.isInteger(seed) || seed < 0 || seed >= ALL_ROLL_COUNT) throw new RangeError("invalid trait roll");
  return TRAITS[traitId][2](seed);
}

export function epToCredits(score) {
  if (!Number.isFinite(score) || score < 0) throw new RangeError("invalid EP value");
  return Math.round(score / EP_PER_CREDIT * 100) / 100;
}

export function casePayout(caseItem, score, multiplier = null) {
  if (!caseItem?.drops) throw new RangeError("invalid case payout");
  if (multiplier !== null) {
    if (!caseItem.bonusMultipliers?.some((entry) => entry.multiplier === multiplier)) throw new RangeError("invalid bonus multiplier");
    return Math.round(caseItem.cost * multiplier * 100) / 100;
  }
  return epToCredits(score);
}

export function isGoldCoinRoll(randomNumber) {
  if (!Number.isInteger(randomNumber) || randomNumber < 0 || randomNumber >= ALL_ROLL_COUNT) throw new RangeError("invalid gold coin roll");
  return randomNumber < GOLD_COIN_OUTCOMES;
}

export function battleWinner(mode, histories) {
  if (!Array.isArray(histories) || histories.length < 2 || histories.length > 4 || histories.some((history) => !Array.isArray(history) || !history.length) || histories.some((history) => history.length !== histories[0].length)) throw new RangeError("invalid battle history");
  if (mode === "share") return -1;
  let values;
  if (mode === "classic") values = histories.map((history) => history.reduce((sum, score) => sum + score, 0));
  else if (mode === "crazy") values = histories.map((history) => -history.reduce((sum, score) => sum + score, 0));
  else if (mode === "clutch") values = histories.map((history) => Math.max(...history));
  else if (mode === "terminal") values = histories.map((history) => history.at(-1));
  else throw new RangeError("invalid battle mode");
  const winningValue = Math.max(...values);
  const winners = values.map((value, index) => value === winningValue ? index : -1).filter((index) => index >= 0);
  return winners.length === 1 ? winners[0] : -1;
}

export function splitBattlePot(pot, playerCount) {
  if (!Number.isFinite(pot) || pot < 0 || !Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6) throw new RangeError("invalid shared battle pot");
  return Math.round(pot * 100 / playerCount) / 100;
}

export function dailyReward(randomNumber) {
  if (!Number.isInteger(randomNumber) || randomNumber < 0 || randomNumber >= ALL_ROLL_COUNT) throw new RangeError("invalid daily roll");
  return 15_000 + Math.floor(randomNumber / ALL_ROLL_COUNT * 10_001);
}

export function localDayKey(date = new Date()) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

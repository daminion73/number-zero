const exact = new Map([
  [0, ["Zero", "The number zero"]], [1, ["One", "The number one"]], [2, ["Two", "The number two"]],
  [3, ["Three", "The number three"]], [4, ["Four", "The number four"]], [5, ["Five", "The number five"]],
  [6, ["Six", "The number six"]], [7, ["Seven", "The number seven"]], [8, ["Eight", "The number eight"]], [9, ["Nine", "The number nine"]],
  [42, ["Exact Meaning", "The answer to life, the universe and everything"]], [67, ["Exact Six-Seven", "Exactly 67"]],
  [69, ["Exact Nice", "Exactly 69"]], [86, ["Exact Eighty-Six", "Exactly 86"]], [101, ["Exact Orientation", "The basics"]],
  [365, ["Exact Calendar", "Days in a common year"]], [404, ["Not Found", "The web's most famous error"]],
  [420, ["Exact Botanist", "Exactly 420"]], [666, ["Exact Devil", "Exactly 666"]], [777, ["Exact Jackpot", "Triple sevens"]],
  [911, ["Exact Emergency", "Exactly 911"]], [1337, ["Exact Leet", "Elite in leetspeak"]], [1984, ["Orwellian", "Big Brother is watching"]],
  [7734, ["Exact Hell", "HELL on an upside-down calculator"]], [17776, ["17776", "What football will look like in the future"]],
  [80085, ["Exact 80085", "Calculator spelling classic"]], [86400, ["Full Day", "Seconds in one day"]],
  [365365, ["Groundhog Day", "The same day, again"]], [420420, ["Hotbox", "Double 420"]],
  [424242, ["Universal Answer", "The answer, repeated"]], [666666, ["Infernal", "Six sixes"]],
  [676767, ["Brainrot", "Six-seven, three times"]], [696969, ["Very Very Nice", "Nice, three times"]],
  [777777, ["Jackpot Six", "A double jackpot"]], [911911, ["Mayday", "Emergency, repeated"]],
  [1000000, ["The Fabled One Million", "The only seven-digit result"]],
]);

const fixedGroups = [
  ["Exact Boob", "Calculator spelling", 50000050, [8008, 58008]],
  ["Funny Number", "A very specific crossover", 50000050, [42069, 69420]],
  ["Always", "24/7/365", 50000050, [247365, 365247]],
  ["Golden Ratio", "The opening digits of φ", 33333367, [1618, 16180, 161803]],
  ["Yes", "The opening digits of τ", 33333367, [6283, 62831, 628318]],
  ["Pi", "The opening digits of π", 25000025, [314, 3141, 31415, 314159]],
  ["Euler's Number", "The opening digits of e", 25000025, [271, 2718, 27182, 271828]],
  ["4 Consecutive Numbers", "Four consecutive integers concatenated", 25000025, [10987, 78910, 111098, 891011]],
];

const powers = (power) => {
  const values = new Set();
  for (let n = 0; n ** power <= 1000000; n++) values.add(n ** power);
  return values;
};

const powerSets = new Map(Array.from({ length: 18 }, (_, i) => i + 2).map((p) => [p, powers(p)]));
const fibonacci = new Set([0, 1]);
for (let a = 0, b = 1; a + b <= 1000000; [a, b] = [b, a + b]) fibonacci.add(a + b);
const factorials = new Set([1, 2, 6, 24, 120, 720, 5040, 40320, 362880]);
const pronic = new Set();
for (let i = 0; i * (i + 1) <= 1000000; i++) pronic.add(i * (i + 1));

function rarity(score) {
  const denominator = Math.round(score / 100);
  if (denominator >= 100000) return "mythic";
  if (denominator >= 10000) return "anomaly";
  if (denominator >= 1000) return "epic";
  if (denominator >= 100) return "rare";
  if (denominator >= 10) return "uncommon";
  return "common";
}

function badge(label, description, score, odds) {
  return { label, description, score, odds: odds || `1 / ${Math.max(1, Math.round(score / 100)).toLocaleString()}`, rarity: rarity(score) };
}

const numberRarityBands = [
  { tier: "trash", label: "Trash", maximum: 2183, rank: "Bottom 1%" },
  { tier: "common", label: "Common", maximum: 6173, rank: "Bottom 50%" },
  { tier: "uncommon", label: "Uncommon", maximum: 12850, rank: "Top 50–25%" },
  { tier: "rare", label: "Rare", maximum: 30730, rank: "Top 25–10%" },
  { tier: "epic", label: "Epic", maximum: 81459, rank: "Top 10–5%" },
  { tier: "anomaly", label: "Anomaly", maximum: 224965, rank: "Top 5–1%" },
  { tier: "mythic", label: "Mythic", maximum: Infinity, rank: "Top 1%" },
];

export function numberRarity(score) {
  if (!Number.isFinite(score) || score < 0) throw new RangeError("score must be a non-negative number");
  return numberRarityBands.find((band) => score <= band.maximum);
}

export function preciseNumberRank(score, distribution, total = 1_000_001) {
  if (!(distribution instanceof Uint32Array) || distribution.length < 2 || distribution.length % 2) {
    throw new TypeError("distribution must contain score/count pairs");
  }
  let low = 0, high = distribution.length / 2 - 1, match = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (distribution[middle * 2] <= score) { match = middle; low = middle + 1; }
    else high = middle - 1;
  }
  const atOrBelow = match < 0 ? 0 : distribution[match * 2 + 1];
  const exact = match >= 0 && distribution[match * 2] === score;
  const below = exact ? (match ? distribution[(match - 1) * 2 + 1] : 0) : atOrBelow;
  const count = score <= 6173 ? atOrBelow : total - below;
  const side = score <= 6173 ? "Bottom" : "Top";
  return `${side} ${(count / total * 100).toFixed(4)}% · ${count.toLocaleString()} / ${total.toLocaleString()}`;
}

function isPrime(n) {
  if (n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
  return true;
}

function hasEquation(s) {
  if (s.length < 3) return false;
  for (let a = 1; a < s.length - 1; a++) for (let b = a + 1; b < s.length; b++) {
    const x = Number(s.slice(0, a)), y = Number(s.slice(a, b)), z = Number(s.slice(b));
    if (x + y === z || x - y === z || x * y === z || (y && x / y === z)) return true;
  }
  return false;
}

function monotonicPeak(ds, allowEqual, valley = false) {
  const cmpA = valley ? (a, b) => allowEqual ? a >= b : a > b : (a, b) => allowEqual ? a <= b : a < b;
  const cmpB = valley ? (a, b) => allowEqual ? a <= b : a < b : (a, b) => allowEqual ? a >= b : a > b;
  return ds.some((_, pivot) => pivot > 0 && pivot < ds.length - 1 && ds.slice(0, pivot).every((d, i) => cmpA(d, ds[i + 1])) && ds.slice(pivot).every((d, i) => i === ds.length - pivot - 1 || cmpB(d, ds[pivot + i + 1])));
}

function containsConsecutiveIntegers(s, count, nearby = false) {
  for (let start = 0; start <= 999; start++) {
    const parts = Array.from({ length: count }, (_, i) => String(start + i));
    const joined = parts.join("");
    if (joined.length > s.length) break;
    if (!nearby && s.includes(joined)) return true;
    if (nearby && parts.every((part) => s.includes(part))) return true;
  }
  return false;
}

function numberPartitions(s, count, maxWidth = 3) {
  const results = [];
  const visit = (index, parts) => {
    if (parts.length === count) {
      if (index === s.length) results.push(parts);
      return;
    }
    for (let width = 1; width <= maxWidth && index + width <= s.length; width++) {
      const part = s.slice(index, index + width);
      if (part.length > 1 && part[0] === "0") continue;
      visit(index + width, [...parts, Number(part)]);
    }
  };
  visit(0, []);
  return results;
}

function isScrambledConsecutive(s, count) {
  return numberPartitions(s, count).some((parts) => {
    const sorted = [...parts].sort((a, b) => a - b);
    return sorted.every((value, index) => index === 0 || value === sorted[index - 1] + 1) && parts.some((value, index) => value !== sorted[index]);
  });
}

function hasConsecutivePair(s, requireGap = false) {
  for (let start = 9; start <= 999; start++) {
    const first = String(start), second = String(start + 1);
    const firstIndex = s.indexOf(first), secondIndex = s.indexOf(second, firstIndex + first.length);
    if (firstIndex >= 0 && secondIndex >= 0 && (requireGap ? secondIndex > firstIndex + first.length : secondIndex === firstIndex + first.length)) return true;
  }
  return false;
}

function hasChunkProgression(s, geometric = false) {
  for (let count = 3; count <= Math.min(6, s.length); count++) {
    if (numberPartitions(s, count).some((parts) => {
      if (geometric) {
        if (parts[0] === 0) return false;
        const ratio = parts[1] / parts[0];
        return ratio > 1 && parts.slice(2).every((value, index) => value / parts[index + 1] === ratio);
      }
      const difference = parts[1] - parts[0];
      return difference !== 0 && parts.slice(2).every((value, index) => value - parts[index + 1] === difference);
    })) return true;
  }
  return false;
}

function hasMiniScramble(s) {
  for (let width = 3; width <= Math.min(5, s.length); width++) for (let start = 0; start + width <= s.length; start++) {
    const part = s.slice(start, start + width);
    const digits = [...part].map(Number).sort((a, b) => a - b);
    if (new Set(digits).size === width && digits.every((value, index) => index === 0 || value === digits[index - 1] + 1)) return true;
    if (isScrambledConsecutive(part, 3)) return true;
  }
  return false;
}

function isStrobogrammatic(s) {
  const flip = { 0: "0", 1: "1", 6: "9", 8: "8", 9: "6" };
  return [...s].reverse().every((d, i) => flip[d] === s[i]);
}

export function evaluateBadges(number) {
  if (!Number.isInteger(number) || number < 0 || number > 1000000) throw new RangeError("number must be an integer from 0 to 1,000,000");
  const s = String(number), ds = [...s].map(Number), out = [];
  const add = (label, description, score, odds) => out.push(badge(label, description, score, odds));
  const contains = (sequence, label, description, score) => s.includes(sequence) && add(label, description, score);
  const exactMatch = exact.get(number);
  if (exactMatch) add(exactMatch[0], exactMatch[1], 100000100, "1 / 1,000,001");
  for (const [label, description, score, values] of fixedGroups) if (values.includes(number)) add(label, description, score);

  const powerScores = { 2: 99900, 3: 990100, 4: 3125003, 5: 6250006, 6: 9090918, 7: 12500013, 8: 16666683, 9: 20000020, 10: 25000025, 11: 25000025, 13: 33333367, 17: 33333367, 19: 33333367 };
  for (const [p, score] of Object.entries(powerScores)) if (powerSets.get(Number(p)).has(number)) add(`${p}${p === "2" ? "nd" : p === "3" ? "rd" : "th"} Power`, `An exact ${p}th power`, score);
  [[2, 5000005], [3, 7692315], [5, 11111122], [7, 12500013]].forEach(([base, score]) => {
    let v = 1; while (v < number) v *= base;
    if (v === number) add(`Power of ${["Two", "Three", "", "Five", "", "Seven"][base - 2]}`, `An exact power of ${base}`, score);
  });
  if (factorials.has(number)) add("Factorial", "An exact factorial", 11111122);
  if ([1, 4, 27, 256, 3125, 46656, 823543].includes(number)) add("Ouroboros", "A number raised to itself", 14285729);
  if (fibonacci.has(number)) add("Fibonacci Number", "Part of the Fibonacci sequence", 3333337);
  if (pronic.has(number)) add("Pronic Number", "A product of consecutive integers", 100000);

  contains("07734", "Hello", "HELLO on an upside-down calculator", 11111122);
  contains("00000", "Deep Void (5)", "Five zeroes in a row", 10000010);
  contains("77777", "Jackpot Five", "Five sevens in a row", 5263163);
  contains("27182", "E Slice (5)", "Five digits of e", 5000005); contains("31415", "Pi Slice (5)", "Five digits of π", 5000005);
  contains("62831", "Tau Slice (5)", "Five digits of τ", 5000005); contains("56789", "Royal Flush", "Five rising digits", 5000005);
  contains("58008", "58008", "Calculator spelling", 5000005); contains("80085", "80085", "Calculator spelling", 5000005);
  contains("0000", "Deep Void (4)", "Four zeroes in a row", 552487); contains("7777", "Jackpot Four", "Four sevens in a row", 357143);
  [["4242", "Deeper Meaning"], ["6767", "6767"], ["6969", "Very Nice"], ["1337", "Leet"], ["1984", "Big Brother"], ["2718", "E Slice (4)"], ["3141", "Pi Slice (4)"], ["6283", "Tau Slice (4)"], ["7734", "Hell"], ["8008", "8008"]].forEach(([seq, label]) => contains(seq, label, `Contains ${seq}`, seq === "4242" || seq === "6767" || seq === "6969" ? 334448 : 333334));
  contains("000", "Deep Void (3)", "Three zeroes in a row", 37023);
  [["007", "Secret Agent"], ["666", "Devil"], ["777", "Jackpot"], ["101", "Orientation"], ["404", "Error 404"], ["271", "E Slice (3)"], ["314", "Pi Slice (3)"], ["365", "Calendar"], ["420", "Botanist"], ["911", "Emergency"]].forEach(([seq, label]) => contains(seq, label, `Contains ${seq}`, ["666", "777"].includes(seq) ? 27027 : seq === "007" ? 34614 : 25006));
  contains("00", "Deep Void", "Two zeroes in a row", 2784);
  [["42", "Meaning of Life"], ["67", "Six-Seven"], ["69", "Nice"], ["86", "Eighty-Six"]].forEach(([seq, label]) => contains(seq, label, `Contains ${seq}`, 2024));

  if (/([0-9])\1{5}/.test(s) && !s.includes("000000")) add("Contiguous Sixes", "Six identical digits in a row", 10000010);
  if (/([0-9])\1{4}/.test(s)) add("Contiguous Fives", "Five identical digits in a row", 552487);
  if (/([0-9])\1{3}/.test(s)) add("Contiguous Quads", "Four identical digits in a row", 37023);
  if (/([0-9])\1{2}/.test(s)) add("Contiguous Trips", "Three identical digits in a row", 2784);
  if (/([0-9])\1/.test(s)) add("Contiguous Pair", "Two identical digits side-by-side", 249);
  if (/([0-9])\1([0-9])\2/.test(s)) add("Contiguous Two Pair", "Two adjacent pairs", 3957);
  if (/([0-9])\1{2}([0-9])\2|([0-9])\3([0-9])\4{2}/.test(s)) add("Contiguous Full House", "An adjacent triple and pair", 30111);
  if (/^([0-9])\1([0-9])\2([0-9])\3$/.test(s)) add("Contiguous Three Pair", "Three adjacent pairs", 154321);
  if (/^([0-9])([0-9])\2([0-9])$/.test(s) && ds[0] !== ds[1] && ds[1] !== ds[3] && ds[0] !== ds[3]) add("Framed Pair", "A pair surrounded by two different digits", 137174);
  if (/^([0-9])([0-9])\2{2}([0-9])$/.test(s) && ds[0] !== ds[1] && ds[1] !== ds[4] && ds[0] !== ds[4]) add("Framed Triple", "A triple surrounded by two different digits", 137174);
  if (/^([0-9])([0-9])\2{3}([0-9])$/.test(s) && ds[0] !== ds[1] && ds[1] !== ds[5] && ds[0] !== ds[5]) add("Framed Quad", "A quadruple surrounded by two different digits", 137174);
  if (new Set(ds).size === 1 && s.length > 1) add("Homogeneous", "Every digit is the same", 2222224);
  if (/^([01]+)$/.test(s) && s.length > 1) add("Binary Soul", "Only zeroes and ones", 1538463);
  if (new Set(ds).size === 2) add("Duality", "Exactly two distinct digits", 21654);
  if (new Set(ds).size === 3) add("Trinity", "Exactly three distinct digits", 1265);
  if (new Set(ds).size === 4) add("Quartet", "Exactly four distinct digits", 290);
  if (new Set(ds).size === ds.length) add("Heterogeneous", "Every digit is unique", 593);
  if (s.length === 1) add("Single Digit", "The whole number is one digit", 10000010);
  if (new Set(ds).size === 2 && s.length >= 4 && ds.every((d, i) => d === ds[i % 2])) add("Zipper", "Two alternating digits", 246914);
  if (s.length >= 4 && s.slice(0, s.length / 2) === s.slice(s.length / 2)) add("Echo", "The first half repeats", 100100);
  if (s === [...s].reverse().join("")) add("Palindrome", "Reads the same both ways", 50025);
  if (isStrobogrammatic(s) && s.length > 1) add("Strobogrammatic", "Looks the same upside down", 502513);

  const counts = ds.reduce((m, d) => m.set(d, (m.get(d) || 0) + 1), new Map());
  const frequencies = [...counts.values()];
  if (frequencies.some((v) => v >= 5)) add("Five of a Kind", "Five matching digits", 198020);
  if (frequencies.some((v) => v >= 4)) add("Four of a Kind", "Four matching digits", 8436);
  if (frequencies.some((v) => v >= 3)) add("Three of a Kind", "Three matching digits", 724);
  if (frequencies.filter((v) => v >= 2).length >= 2) add("Two Pair", "Two different pairs", 377);
  if (frequencies.filter((v) => v === 2).length === 3) add("Three Pair", "Three different pairs", 10288);
  if (frequencies.includes(3) && frequencies.includes(2)) add("Full House", "A triple and a pair", 2397);
  if (frequencies.some((v) => v >= 2)) add("Pair", "At least one repeated digit", 120);
  if (ds.filter((d) => d === 1).length === 2) add("Snake Eyes", "Exactly two ones", 2121);
  const outlierCounts = frequencies.sort((a, b) => a - b);
  if (outlierCounts[0] === 1 && outlierCounts.at(-1) === s.length - 1) add("Firefly", "One digit differs from all the others", 82237);

  const diffs = ds.slice(1).map((d, i) => d - ds[i]);
  if (diffs.length >= 2 && diffs.every((d) => d === diffs[0]) && diffs[0] !== 0) add("Even Spacing", "Digits form an arithmetic sequence", 862070);
  if (diffs.length >= 2 && diffs.every((d) => Math.abs(d) === Math.abs(diffs[0]))) add("Even Spacing (Absolute)", "Equal distance between neighbors", 90992);
  if (diffs.every((d) => d === 1)) add("Cascade", "Every digit rises by one", 3333337);
  if (diffs.every((d) => d === -1)) add("Waterfall", "Every digit falls by one", 2857146);
  if (diffs.every((d) => d > 0)) add("Ascension", "Every digit strictly rises", 219298);
  if (diffs.every((d) => d < 0)) add("Decay", "Every digit strictly falls", 119474);
  if (diffs.every((d) => d >= 0)) add("Steps", "Digits never decrease", 20202);
  if (diffs.every((d) => d <= 0)) add("Slopes", "Digits never increase", 12582);
  if (diffs.length >= 2 && diffs.every((d, i) => i === 0 || Math.sign(d) === -Math.sign(diffs[i - 1]) && d !== 0)) add("Hills", "Digits alternate up and down", 733);
  if (diffs.length >= 2 && diffs.every((d, i) => i === 0 || Math.sign(d) !== Math.sign(diffs[i - 1]) || d === 0)) add("Dunes", "Digits loosely alternate up and down", 364);
  if (ds.slice(2).some((d, i) => d === ds[i])) add("Hopscotch", "A digit repeats two places later", 312);
  if (ds.slice(2).filter((d, i) => d === ds[i]).length >= 2) add("Double Hop", "Two digits repeat two places later", 5321);
  if (monotonicPeak(ds, false)) add("Mountain", "Strict climb, then descent", 5885);
  if (monotonicPeak(ds, false, true)) add("Valley", "Strict descent, then climb", 4199);
  if (monotonicPeak(ds, true)) add("Mesa", "Climb, plateau allowed, then descent", 1568);
  if (monotonicPeak(ds, true, true)) add("Canyon", "Descent, plateau allowed, then climb", 1184);

  if (containsConsecutiveIntegers(s, 4)) add("4 Consecutive Numbers (Contains)", "Contains four consecutive integers", 2631582);
  if (isScrambledConsecutive(s, 4)) add("4 Consecutive Numbers (Scrambled)", "Four consecutive integers out of order", 2272730);
  if (numberPartitions(s, 3).some((parts) => parts[1] === parts[0] + 1 && parts[2] === parts[1] + 1)) add("3 Consecutive Numbers", "Three consecutive integers concatenated", 555556);
  if (containsConsecutiveIntegers(s, 3)) add("3 Consecutive Numbers (Contains)", "Contains three consecutive integers in a row", 157978);
  if (isScrambledConsecutive(s, 3)) add("3 Consecutive Numbers (Scrambled)", "Three consecutive integers out of order", 277778);
  if (numberPartitions(s, 2).some((parts) => parts[1] === parts[0] + 1)) add("2 Consecutive Numbers", "Two consecutive integers concatenated", 50505);
  if (hasConsecutivePair(s)) add("2 Consecutive Numbers (Contains)", "Contains two adjacent consecutive integers", 1659);
  if (hasConsecutivePair(s, true)) add("2 Consecutive Numbers (Nearby)", "Contains two separated consecutive integers", 1575);
  if ([3, 4, 5, 6].some((count) => isScrambledConsecutive(s, count))) add("Scramble", "Consecutive integers mixed out of order", 22722);
  if (s.length === 6 && (diffs.every((difference) => difference === 1) || diffs.every((difference) => difference === -1))) add("Sequence (6)", "Six consecutive digits", 11111122);
  if (["0123456789", "9876543210"].some((seq) => [...Array(Math.max(0, seq.length - 2))].some((_, i) => s.includes(seq.slice(i, i + 3))))) add("Sequence (3)", "Three consecutive digits", 1716);
  if (["0123456789", "9876543210"].some((seq) => [...Array(Math.max(0, seq.length - 3))].some((_, i) => s.includes(seq.slice(i, i + 4))))) add("Sequence (4)", "Four consecutive digits", 25907);
  if (["0123456789", "9876543210"].some((seq) => [...Array(Math.max(0, seq.length - 4))].some((_, i) => s.includes(seq.slice(i, i + 5))))) add("Straight", "Five consecutive digits", 454546);

  const sum = ds.reduce((a, b) => a + b, 0), product = ds.reduce((a, b) => a * b, 1);
  if (sum === product) add("Spy Number", "Digit sum equals digit product", 1030929);
  if (sum >= 45) add("Heavy", "Digit sum is at least 45", 33300);
  if (sum < 15) add("Feather", "Digit sum is under 15", 2667);
  if (sum === 21) add("Blackjack", "Digit sum is exactly 21", 2521);
  if (number !== 0 && number % sum === 0) add("Harshad Number", "Divisible by its digit sum", 1048);
  if (hasEquation(s)) add("Equation", "Its digits can form a true equation", 7720);
  if (hasChunkProgression(s)) add("Metronome", "Chunks form an arithmetic sequence", 17784);
  if (hasChunkProgression(s, true)) add("Crescendo", "Chunks form a geometric sequence", 208334);
  if (isPrime(number)) add("Prime Number", "Divisible only by one and itself", 1274);
  if (number % 12 === 0) add("Dozen", "Divisible by twelve", 1200);
  if (number % 11 === 0) add("Eleven", "Divisible by eleven", 1100);
  if (number % 7 === 0) add("Lucky Seven (Divisible)", "Divisible by seven", 700);
  if (/^[0369]+$/.test(s)) add("Divisible by 3", "Every digit is divisible by three", 24414);

  if (ds.every((d) => d <= 4)) add("Low Ball", "Only low digits, zero through four", 6400);
  if (ds.every((d) => d >= 5)) add("High Roller", "Only high digits, five through nine", 5120);
  if (ds.every((d) => d % 2 === ds[0] % 2)) add("Flush", "All digits share parity", 2845);
  if (ds.length >= 2 && ds.slice(1).every((d, i) => d % 2 !== ds[i] % 2)) add("Alternator", "Odd and even digits alternate", 2845);
  if (ds.every((d, i) => i === 0 || Math.abs(d - ds[i - 1]) <= 1)) add("Turtle", "Neighboring digits stay within one", 36049);
  if (s.includes("69") && s.includes("420")) add("Funny Numbers", "Contains both 69 and 420", 1666668);
  if (["02468", "13579", "86420", "97531"].some((v) => s.includes(v))) add("Straight Flush", "Five consecutive same-parity digits", 1449277);
  if (s[0] === s.at(-1)) add("Equilibrium", "Matching first and last digits", 1000);
  if (Math.abs(ds[0] - ds.at(-1)) === 1) add("Gap One", "First and last differ by one", 529);
  if (ds[0] < ds.at(-1)) add("Grounded", "Last digit is higher than the first", 250);
  if (ds[0] > ds.at(-1)) add("Liftoff", "First digit is higher than the last", 200);
  if (number % 2) add("Odd", "An odd number", 200); else add("Even", "An even number", 200);
  if (!s.includes("0")) add("Void", "Contains no zeroes", 167);
  if (s.includes("7")) add("Lucky Seven", "Contains at least one seven", 213);
  if (ds.some((d, i) => ds.slice(i + 1).some((x) => Math.abs(x - d) === 1))) add("Neighbors", "Contains two neighboring values", 161);
  if (hasMiniScramble(s)) add("Mini Scramble", "A short span rearranges into consecutive digits", 579);
  for (let digit = 1; digit <= 9; digit++) if (ds.filter((d) => d === digit).length === 1) add(["Hydrogen", "Helium", "Lithium", "Beryllium", "Boron", "Carbon", "Nitrogen", "Oxygen", "Fluorine"][digit - 1], `Contains exactly one ${digit}`, 282);
  if (ds.filter((d) => d === 0).length === 1) add("Ghost", "Contains exactly one zero", 309);

  const endings = [["00000", "Eon", 10000010], ["50000", "Semi-Eon", 10000010], ["99999", "Quint Nine", 10000010], ["0000", "Epoch", 1000001], ["5000", "Semi-Epoch", 1000001], ["9999", "Quad Nine", 1000001], ["000", "Millennium", 100000], ["500", "Semi-Millennium", 100000], ["999", "Triple Nine", 100000], ["00", "Century", 10000], ["25", "Quarter-Century", 10000], ["50", "Semi-Century", 10000], ["75", "Three-Quarter-Century", 10000], ["99", "Double Nine", 10000]];
  endings.forEach(([end, label, score]) => s.endsWith(end) && add(label, `Ends in ${end}`, score));
  if (s.endsWith("0")) add("Clean", "Ends in zero", 1000);
  if (s.endsWith("5")) add("Semi-Clean", "Ends in five", 1000);
  if (number > 999000) add("Colossal", "Greater than 999,000", 100000);
  if (s.length >= 2 && s.length <= 6) add([, "Single Digit", "Two Digits", "Three Digits", "Four Digits", "Five Digits", "Six Digits"][s.length], `${s.length} digits long`, [0, 10000010, 1111112, 111111, 11111, 1111, 111][s.length]);

  if (s.length >= 4 && s.length % 2 === 0 && ds.slice(0, s.length / 2).reduce((a, b) => a + b, 0) === ds.slice(s.length / 2).reduce((a, b) => a + b, 0)) add("Balanced", "Both halves have the same digit sum", 1959);
  if (s.length >= 4 && s.slice(0, 2) === s.slice(-2)) add("Bookends", "Matching two-digit bookends", 10010);
  if (s.length >= 4 && s.slice(0, 2) === [...s.slice(-2)].reverse().join("")) add("Mirror Bookends", "Mirrored two-digit bookends", 10010);
  if (/^([0-9])\1.*([0-9])\2$/.test(s)) add("Paired Bookends", "A pair at both ends", 11122);
  if (/^([0-9])([0-9])\2.*([0-9])\3([0-9])$/.test(s)) add("Framed Double", "Two pairs framed by different digits", 15242);
  if ([4, 5].some((width) => [...Array(Math.max(0, s.length - width + 1))].some((_, index) => {
    const part = s.slice(index, index + width);
    return part === [...part].reverse().join("");
  }))) add("Pocket Mirror", "Contains a four- or five-digit palindrome", 2124);
  if (/(..).*\1/.test(s)) add("Mini Echo", "A two-digit sequence repeats", 3704);
  if (/(.{2,}).*\1/.test(s)) add("Rhyme", "A longer sequence repeats", 1872);

  return out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

const badgeSequences = new Map([
  ["Hello", "07734"], ["Jackpot Five", "77777"], ["E Slice (5)", "27182"], ["Pi Slice (5)", "31415"],
  ["Tau Slice (5)", "62831"], ["Royal Flush", "56789"], ["58008", "58008"], ["80085", "80085"],
  ["Jackpot Four", "7777"], ["Deeper Meaning", "4242"], ["6767", "6767"], ["Very Nice", "6969"],
  ["Leet", "1337"], ["Big Brother", "1984"], ["E Slice (4)", "2718"], ["Pi Slice (4)", "3141"],
  ["Tau Slice (4)", "6283"], ["Hell", "7734"], ["8008", "8008"], ["Secret Agent", "007"],
  ["Devil", "666"], ["Jackpot", "777"], ["Orientation", "101"], ["Error 404", "404"],
  ["E Slice (3)", "271"], ["Pi Slice (3)", "314"], ["Calendar", "365"], ["Botanist", "420"],
  ["Emergency", "911"], ["Meaning of Life", "42"], ["Six-Seven", "67"], ["Nice", "69"], ["Eighty-Six", "86"],
]);

function positionsOf(s, sequence) {
  const positions = new Set();
  for (let start = 0; start <= s.length - sequence.length; start++) {
    if (s.slice(start, start + sequence.length) === sequence) {
      for (let index = start; index < start + sequence.length; index++) positions.add(index);
    }
  }
  return [...positions];
}

function orderedSequencePositions(s, count, requireGap = false) {
  let best = [], bestGap = Infinity;
  for (let start = 0; start <= 999; start++) {
    const positions = [];
    let cursor = 0, previousEnd = 0, gapSize = 0, found = true;
    for (let offset = 0; offset < count; offset++) {
      const part = String(start + offset), index = s.indexOf(part, cursor);
      if (index < 0) { found = false; break; }
      if (offset > 0) gapSize += index - previousEnd;
      positions.push(...Array.from({ length: part.length }, (_, digit) => index + digit));
      previousEnd = index + part.length; cursor = previousEnd;
    }
    if (found && (!requireGap || gapSize > 0) && gapSize < bestGap) {
      best = positions;
      bestGap = gapSize;
    }
  }
  return best;
}

function concatenatedSequencePositions(s, count) {
  for (let start = 0; start <= 999; start++) {
    const sequence = Array.from({ length: count }, (_, offset) => String(start + offset)).join("");
    const positions = positionsOf(s, sequence);
    if (positions.length) return positions;
  }
  return [];
}

function digitSequencePositions(s, length) {
  for (let start = 0; start <= s.length - length; start++) {
    const digits = [...s.slice(start, start + length)].map(Number);
    const direction = digits[1] - digits[0];
    if (Math.abs(direction) === 1 && digits.every((digit, index) => index === 0 || digit - digits[index - 1] === direction)) {
      return Array.from({ length }, (_, index) => start + index);
    }
  }
  return [];
}

export function badgeHighlights(number, label, description = "") {
  const s = String(number), offset = 7 - s.length;
  const actual = [...s].map((_, index) => offset + index);
  const toDisplay = (indices) => indices.map((index) => offset + index);
  const sequence = badgeSequences.get(label) || description.match(/(?:Contains|Ends in) (\d+)/)?.[1];
  if (sequence) return toDisplay(positionsOf(s, sequence));
  if (label === "Funny Numbers") return toDisplay([...new Set([...positionsOf(s, "420"), ...positionsOf(s, "69")])]);
  if (label === "4 Consecutive Numbers (Contains)") return toDisplay(concatenatedSequencePositions(s, 4));
  if (label === "3 Consecutive Numbers (Contains)") return toDisplay(concatenatedSequencePositions(s, 3));
  if (label === "2 Consecutive Numbers (Contains)") return toDisplay(orderedSequencePositions(s, 2));
  if (label === "2 Consecutive Numbers (Nearby)") return toDisplay(orderedSequencePositions(s, 2, true));
  const digitSequence = label.match(/^Sequence \((3|4|6)\)$/);
  if (digitSequence) return toDisplay(digitSequencePositions(s, Number(digitSequence[1])));

  const deepVoid = label.match(/^Deep Void(?: \((\d)\))?$/);
  if (deepVoid) return toDisplay(positionsOf(s, "0".repeat(Number(deepVoid[1] || 2))));
  const repeated = label.match(/^Contiguous (Pair|Trips|Quads|Fives|Sixes)$/);
  if (repeated) {
    const length = { Pair: 2, Trips: 3, Quads: 4, Fives: 5, Sixes: 6 }[repeated[1]];
    const match = s.match(new RegExp(`([0-9])\\1{${length - 1}}`));
    return match ? toDisplay([...Array(length)].map((_, index) => match.index + index)) : actual;
  }

  const element = ["Hydrogen", "Helium", "Lithium", "Beryllium", "Boron", "Carbon", "Nitrogen", "Oxygen", "Fluorine"].indexOf(label);
  if (element >= 0) return toDisplay([...s].flatMap((digit, index) => digit === String(element + 1) ? [index] : []));
  if (label === "Ghost") return toDisplay([...s].flatMap((digit, index) => digit === "0" ? [index] : []));
  if (label === "Lucky Seven") return toDisplay([...s].flatMap((digit, index) => digit === "7" ? [index] : []));
  if (["Odd", "Even", "Clean", "Semi-Clean"].includes(label)) return [6];
  if (["Equilibrium", "Gap One", "Grounded", "Liftoff"].includes(label)) return [offset, 6];
  if (["Pair", "Two Pair", "Three Pair", "Three of a Kind", "Four of a Kind", "Five of a Kind"].includes(label)) {
    const counts = [...s].reduce((map, digit) => map.set(digit, (map.get(digit) || 0) + 1), new Map());
    return toDisplay([...s].flatMap((digit, index) => counts.get(digit) > 1 ? [index] : []));
  }
  return actual;
}

export function secureRandomNumber() {
  const range = 1000001;
  const limit = Math.floor(0x100000000 / range) * range;
  const data = new Uint32Array(1);
  do crypto.getRandomValues(data); while (data[0] >= limit);
  return data[0] % range;
}

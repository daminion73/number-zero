// Texas Hold'em hand evaluation: best five of up to seven cards with full kicker ordering.
// Cards are ints 0–51 (rank = i % 13 with 0 = A … 12 = K, suit = floor(i / 13)), as in casino-core.

export const CATEGORIES = ["high-card", "pair", "two-pair", "trips", "straight", "flush", "full-house", "quads", "straight-flush", "royal-flush"];
export const CATEGORY_NAMES = ["High Card", "Pair", "Two Pair", "Three of a Kind", "Straight", "Flush", "Full House", "Four of a Kind", "Straight Flush", "Royal Flush"];
const RANK_NAMES = { 14: "Ace", 13: "King", 12: "Queen", 11: "Jack", 10: "Ten", 9: "Nine", 8: "Eight", 7: "Seven", 6: "Six", 5: "Five", 4: "Four", 3: "Three", 2: "Two" };
const plural = (rank) => (rank === 6 ? "Sixes" : `${RANK_NAMES[rank]}s`);

/** Poker rank value: 2…14 (ace high). */
export const rankValue = (card) => (card % 13 === 0 ? 14 : (card % 13) + 1);
const suitOf = (card) => Math.floor(card / 13);

/** Highest straight in a list of cards → the five cards (high first), or null. The wheel A-2-3-4-5 counts as 5-high. */
function straightOf(cards) {
  const byRank = new Map();
  for (const card of cards) if (!byRank.has(rankValue(card))) byRank.set(rankValue(card), card);
  for (let high = 14; high >= 5; high--) {
    const run = [];
    for (let rank = high; rank > high - 5; rank--) {
      const card = byRank.get(rank === 1 ? 14 : rank);
      if (card === undefined) break;
      run.push(card);
    }
    if (run.length === 5) return { high, cards: run };
  }
  return null;
}

/**
 * Evaluates 5–7 cards. Returns `{ score, category, id, name, label, best, ranks }`; higher score wins, equal scores tie.
 * `best` = the five cards used; `ranks` = tie-break ranks in order of importance.
 */
export function evaluateHand(cards) {
  if (!Array.isArray(cards) || cards.length < 5 || cards.length > 7 || new Set(cards).size !== cards.length) throw new RangeError("evaluate 5–7 distinct cards");
  const sorted = [...cards].sort((a, b) => rankValue(b) - rankValue(a));
  const suits = [0, 1, 2, 3].map((suit) => sorted.filter((card) => suitOf(card) === suit));
  const flushCards = suits.find((list) => list.length >= 5) || null;
  let category, best, ranks;

  const straightFlush = flushCards && straightOf(flushCards);
  if (straightFlush) {
    category = straightFlush.high === 14 ? 9 : 8;
    best = straightFlush.cards;
    ranks = [straightFlush.high];
  } else {
    const groups = new Map();
    for (const card of sorted) groups.set(rankValue(card), [...(groups.get(rankValue(card)) || []), card]);
    const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0]);
    const [first, second] = ordered;
    const kickers = (used, count) => sorted.filter((card) => !used.includes(card)).slice(0, count);
    const straight = straightOf(sorted);
    if (first[1].length === 4) {
      category = 7;
      best = [...first[1], ...kickers(first[1], 1)];
    } else if (first[1].length === 3 && second && second[1].length >= 2) {
      category = 6;
      best = [...first[1], ...second[1].slice(0, 2)];
    } else if (flushCards) {
      category = 5;
      best = flushCards.slice(0, 5);
    } else if (straight) {
      category = 4;
      best = straight.cards;
      ranks = [straight.high];
    } else if (first[1].length === 3) {
      category = 3;
      best = [...first[1], ...kickers(first[1], 2)];
    } else if (first[1].length === 2 && second && second[1].length === 2) {
      category = 2;
      const pairs = [...first[1], ...second[1]];
      best = [...pairs, ...kickers(pairs, 1)];
    } else if (first[1].length === 2) {
      category = 1;
      best = [...first[1], ...kickers(first[1], 3)];
    } else {
      category = 0;
      best = sorted.slice(0, 5);
    }
    ranks ||= best.map(rankValue);
  }
  // Encode category + ranks (each < 15) into one comparable integer.
  const score = [category, ...ranks, 0, 0, 0, 0, 0].slice(0, 6).reduce((total, value) => total * 15 + value, 0);
  return { score, category, id: CATEGORIES[category], name: CATEGORY_NAMES[category], label: describe(category, best), best, ranks };
}

function describe(category, best) {
  const r = best.map(rankValue);
  switch (category) {
    case 9: return "Royal Flush";
    case 8: return `Straight Flush, ${RANK_NAMES[r[0]]} high`;
    case 7: return `Four ${plural(r[0])}`;
    case 6: return `Full House, ${plural(r[0])} over ${plural(r[3])}`;
    case 5: return `Flush, ${RANK_NAMES[r[0]]} high`;
    case 4: return `Straight, ${RANK_NAMES[r[0]]} high`;
    case 3: return `Three ${plural(r[0])}`;
    case 2: return `Two Pair, ${plural(r[0])} and ${plural(r[2])}`;
    case 1: return `Pair of ${plural(r[0])}`;
    default: return `${RANK_NAMES[r[0]]} High`;
  }
}

/** Compares two evaluated hands: > 0 if `a` wins, < 0 if `b` wins, 0 on a tie. */
export const compareHands = (a, b) => a.score - b.score;

/** Fisher–Yates shuffle of a 52-card deck driven by 52 provably fair floats. */
export function shuffleDeck(floats) {
  if (floats.length < 52) throw new RangeError("need 52 floats");
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = Math.min(i, Math.floor(floats[51 - i] * (i + 1)));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** Splits contributions into main/side pots. `players` = [{ seat, committed, live }]. Returns [{ amount, eligible: seats[] }]. */
export function buildPots(players) {
  const levels = [...new Set(players.filter((p) => p.live && p.committed > 0).map((p) => p.committed))].sort((a, b) => a - b);
  const pots = [];
  let previous = 0;
  for (const level of levels) {
    const amount = players.reduce((sum, p) => sum + Math.max(0, Math.min(p.committed, level) - previous), 0);
    const eligible = players.filter((p) => p.live && p.committed >= level).map((p) => p.seat);
    if (amount > 0) pots.push({ amount, eligible });
    previous = level;
  }
  // Dead money above every live player's contribution (e.g. a player who left after betting) joins the last pot.
  const leftover = players.reduce((sum, p) => sum + Math.max(0, p.committed - previous), 0);
  if (leftover > 0) {
    if (pots.length) pots[pots.length - 1].amount += leftover;
    else pots.push({ amount: leftover, eligible: players.filter((p) => p.live).map((p) => p.seat) });
  }
  return pots;
}

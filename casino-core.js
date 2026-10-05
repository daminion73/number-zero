// Shared, synchronous casino logic used by both the server (authoritative online play)
// and the browser (demo play + provably-fair verification). All money is integer cents.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const ror = (x, n) => (x >>> n) | (x << (32 - n));
const utf8 = (value) => (typeof value === "string" ? new TextEncoder().encode(value) : value);
const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export function sha256(input) {
  const bytes = utf8(input);
  const length = bytes.length;
  const padded = ((length + 9 + 63) >> 6) << 6;
  const message = new Uint8Array(padded);
  message.set(bytes);
  message[length] = 0x80;
  const view = new DataView(message.buffer);
  view.setUint32(padded - 8, Math.floor((length * 8) / 0x100000000));
  view.setUint32(padded - 4, (length * 8) >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  for (let offset = 0; offset < padded; offset += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      W[i] = W[i - 16] + (ror(a, 7) ^ ror(a, 18) ^ (a >>> 3)) + W[i - 7] + (ror(b, 17) ^ ror(b, 19) ^ (b >>> 10));
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  H.forEach((word, index) => outView.setUint32(index * 4, word));
  return out;
}

export const sha256Hex = (input) => hex(sha256(input));

export function hmacSha256(key, message) {
  let keyBytes = utf8(key);
  if (keyBytes.length > 64) keyBytes = sha256(keyBytes);
  const inner = new Uint8Array(64 + utf8(message).length);
  const outer = new Uint8Array(96);
  for (let i = 0; i < 64; i++) {
    inner[i] = (keyBytes[i] || 0) ^ 0x36;
    outer[i] = (keyBytes[i] || 0) ^ 0x5c;
  }
  inner.set(utf8(message), 64);
  outer.set(sha256(inner), 64);
  return sha256(outer);
}

export const hmacSha256Hex = (key, message) => hex(hmacSha256(key, message));

/** Stake-style float stream: HMAC(serverSeed, `${clientSeed}:${nonce}:${cursor}`), 4 bytes per float. */
export function fairFloats(serverSeed, clientSeed, nonce, count) {
  const floats = [];
  for (let cursor = 0; floats.length < count; cursor++) {
    const bytes = hmacSha256(serverSeed, `${clientSeed}:${nonce}:${cursor}`);
    for (let i = 0; i < 32 && floats.length < count; i += 4)
      floats.push(bytes[i] / 256 + bytes[i + 1] / 256 ** 2 + bytes[i + 2] / 256 ** 3 + bytes[i + 3] / 256 ** 4);
  }
  return floats;
}

export const HOUSE_EDGE = 0.01;
export const MIN_BET_CENTS = 100;
export const MAX_BET_CENTS = 1_000_000_000; // 10,000,000 CR
export const BLACKJACK_FLOATS = 128;
export const BACCARAT_FLOATS = 6;
export const MINES_FLOATS = 24;
export const GAMES = ["blackjack", "baccarat", "mines", "crash", "live-rocket", "case-battle"];

export function validBet(cents) {
  return Number.isInteger(cents) && cents >= MIN_BET_CENTS && cents <= MAX_BET_CENTS;
}

// ── Cards ── index 0..51: rank = index % 13 (0 = A … 12 = K), suit = floor(index / 13)
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠", "♥", "♦", "♣"];
export const cardFromFloat = (float) => Math.min(51, Math.floor(float * 52));
export function cardInfo(index) {
  const suit = Math.floor(index / 13);
  return { index, rank: RANKS[index % 13], suit: SUITS[suit], red: suit === 1 || suit === 2 };
}
const blackjackPoints = (card) => Math.min(10, (card % 13) + 1);
export const baccaratPoints = (card) => ((card % 13) + 1 >= 10 ? 0 : (card % 13) + 1);

export function handValue(cards) {
  let total = 0, aces = 0;
  for (const card of cards) {
    total += blackjackPoints(card);
    if (card % 13 === 0) aces++;
  }
  const soft = aces > 0 && total + 10 <= 21;
  return { total: soft ? total + 10 : total, soft };
}
const isNatural = (cards) => cards.length === 2 && handValue(cards).total === 21;

// ── Blackjack ── dealer stands on all 17s, blackjack pays 3:2, insurance pays 2:1,
// double on any two cards (not split aces), split pairs up to 4 hands per seat.
export const BLACKJACK_MAX_SEATS = 3;
export const BLACKJACK_MAX_HANDS_PER_SEAT = 4;

function draw(state, floats) {
  if (state.cursor >= floats.length) throw new RangeError("fair card stream exhausted");
  return cardFromFloat(floats[state.cursor++]);
}

export function blackjackStart(floats, betsCents) {
  if (!Array.isArray(betsCents) || betsCents.length < 1 || betsCents.length > BLACKJACK_MAX_SEATS || !betsCents.every(validBet))
    throw new RangeError("invalid blackjack bets");
  const state = {
    game: "blackjack",
    phase: "player",
    cursor: 0,
    dealer: [],
    hands: betsCents.map((bet, seat) => ({ seat, cards: [], bet, doubled: false, split: false, done: false, result: null, payout: 0 })),
    active: 0,
    insurance: null,
    wager: betsCents.reduce((sum, bet) => sum + bet, 0),
    payout: 0,
  };
  for (const hand of state.hands) hand.cards.push(draw(state, floats));
  state.dealer.push(draw(state, floats));
  for (const hand of state.hands) hand.cards.push(draw(state, floats));
  state.dealer.push(draw(state, floats));
  if (state.dealer[0] % 13 === 0) state.phase = "insurance";
  else afterPeek(state, floats);
  return state;
}

function afterPeek(state, floats) {
  const upTen = blackjackPoints(state.dealer[0]) >= 10 || state.dealer[0] % 13 === 0;
  if (upTen && isNatural(state.dealer)) return settleBlackjack(state);
  if (state.insurance) state.insurance.payout = 0;
  for (const hand of state.hands) if (isNatural(hand.cards)) hand.done = true;
  state.phase = "player";
  advance(state, floats);
}

function advance(state, floats) {
  const next = state.hands.findIndex((hand) => !hand.done);
  if (next >= 0) {
    state.active = next;
    return;
  }
  state.active = -1;
  const live = state.hands.some((hand) => handValue(hand.cards).total <= 21 && !(isNatural(hand.cards) && !hand.split));
  if (live) while (handValue(state.dealer).total < 17) state.dealer.push(draw(state, floats));
  settleBlackjack(state);
}

function settleBlackjack(state) {
  const dealer = handValue(state.dealer).total;
  const dealerNatural = isNatural(state.dealer);
  for (const hand of state.hands) {
    const total = handValue(hand.cards).total;
    const natural = isNatural(hand.cards) && !hand.split;
    if (total > 21) [hand.result, hand.payout] = ["bust", 0];
    else if (natural && !dealerNatural) [hand.result, hand.payout] = ["blackjack", hand.bet + Math.floor(hand.bet * 1.5)];
    else if (dealerNatural) [hand.result, hand.payout] = natural ? ["push", hand.bet] : ["lose", 0];
    else if (dealer > 21 || total > dealer) [hand.result, hand.payout] = ["win", hand.bet * 2];
    else if (total === dealer) [hand.result, hand.payout] = ["push", hand.bet];
    else [hand.result, hand.payout] = ["lose", 0];
    hand.done = true;
  }
  if (state.insurance) state.insurance.payout = state.insurance.taken && dealerNatural ? state.insurance.bet * 3 : 0;
  state.payout = state.hands.reduce((sum, hand) => sum + hand.payout, 0) + (state.insurance?.payout || 0);
  state.phase = "settled";
  state.active = -1;
  return state;
}

/** Extra cents the player must stake to perform `action` (0 when free). Throws when illegal. */
export function blackjackCost(state, action) {
  if (state.phase === "settled") throw new RangeError("round already settled");
  if (state.phase === "insurance") {
    if (action === "insurance") return state.hands.reduce((sum, hand) => sum + Math.floor(hand.bet / 2), 0);
    if (action === "no-insurance") return 0;
    throw new RangeError("decide on insurance first");
  }
  const hand = state.hands[state.active];
  if (action === "hit" || action === "stand") return 0;
  if (action === "double") {
    if (hand.cards.length !== 2 || hand.splitAces) throw new RangeError("double is only allowed on two cards");
    return hand.bet;
  }
  if (action === "split") {
    const seatHands = state.hands.filter((other) => other.seat === hand.seat).length;
    if (hand.cards.length !== 2 || blackjackPoints(hand.cards[0]) !== blackjackPoints(hand.cards[1]) || hand.splitAces || seatHands >= BLACKJACK_MAX_HANDS_PER_SEAT)
      throw new RangeError("this hand cannot be split");
    return hand.bet;
  }
  throw new RangeError("unknown blackjack action");
}

export function blackjackAction(state, floats, action) {
  const cost = blackjackCost(state, action);
  state.wager += cost;
  if (state.phase === "insurance") {
    state.insurance = { taken: action === "insurance", bet: cost, payout: 0 };
    afterPeek(state, floats);
    return state;
  }
  const hand = state.hands[state.active];
  if (action === "hit") {
    hand.cards.push(draw(state, floats));
    if (handValue(hand.cards).total >= 21) hand.done = true;
  } else if (action === "stand") hand.done = true;
  else if (action === "double") {
    hand.bet *= 2;
    hand.doubled = true;
    hand.cards.push(draw(state, floats));
    hand.done = true;
  } else if (action === "split") {
    const aces = hand.cards[0] % 13 === 0;
    const twin = { seat: hand.seat, cards: [hand.cards.pop()], bet: hand.bet, doubled: false, split: true, splitAces: aces, done: false, result: null, payout: 0 };
    hand.split = true;
    hand.splitAces = aces;
    hand.cards.push(draw(state, floats));
    twin.cards.push(draw(state, floats));
    state.hands.splice(state.active + 1, 0, twin);
    for (const item of [hand, twin]) if (aces || handValue(item.cards).total === 21) item.done = true;
  }
  advance(state, floats);
  return state;
}

/** Public projection: hides the dealer hole card until the round is settled. */
export function blackjackView(state) {
  const settled = state.phase === "settled";
  const dealer = settled ? state.dealer : [state.dealer[0], null];
  return {
    game: "blackjack",
    phase: state.phase,
    active: state.active,
    dealer,
    dealerTotal: settled ? handValue(state.dealer).total : handValue([state.dealer[0]]).total,
    hands: state.hands.map(({ seat, cards, bet, doubled, split, done, result, payout }) => ({ seat, cards, bet, doubled, split, done, result, payout, ...handValue(cards) })),
    insurance: state.insurance,
    wager: state.wager,
    payout: state.payout,
    actions: blackjackLegalActions(state),
  };
}

export function blackjackLegalActions(state) {
  return ["hit", "stand", "double", "split", "insurance", "no-insurance"].filter((action) => {
    try {
      blackjackCost(state, action);
      return true;
    } catch {
      return false;
    }
  });
}

// ── Baccarat ── Punto Banco tableau. Player 1:1, Banker 0.95:1, Tie 8:1 (Player/Banker push on tie).
export function baccaratPlay(floats, bets) {
  const stakes = { player: bets?.player || 0, banker: bets?.banker || 0, tie: bets?.tie || 0 };
  const values = Object.values(stakes);
  if (!values.every((value) => value === 0 || validBet(value)) || values.every((value) => value === 0))
    throw new RangeError("invalid baccarat bets");
  let cursor = 0;
  const next = () => cardFromFloat(floats[cursor++]);
  const player = [next()], banker = [next()];
  player.push(next());
  banker.push(next());
  const total = (cards) => cards.reduce((sum, card) => sum + baccaratPoints(card), 0) % 10;
  const natural = total(player) >= 8 || total(banker) >= 8;
  if (!natural) {
    let third = null;
    if (total(player) <= 5) {
      third = next();
      player.push(third);
    }
    const b = total(banker);
    const v = third === null ? null : baccaratPoints(third);
    const bankerDraws = v === null ? b <= 5 : b <= 2 || (b === 3 && v !== 8) || (b === 4 && v >= 2 && v <= 7) || (b === 5 && v >= 4 && v <= 7) || (b === 6 && v >= 6 && v <= 7);
    if (bankerDraws) banker.push(next());
  }
  const playerTotal = total(player), bankerTotal = total(banker);
  const winner = playerTotal > bankerTotal ? "player" : bankerTotal > playerTotal ? "banker" : "tie";
  const payouts = {
    player: winner === "player" ? stakes.player * 2 : winner === "tie" ? stakes.player : 0,
    banker: winner === "banker" ? stakes.banker + Math.floor(stakes.banker * 0.95) : winner === "tie" ? stakes.banker : 0,
    tie: winner === "tie" ? stakes.tie * 9 : 0,
  };
  return {
    game: "baccarat",
    player, banker, playerTotal, bankerTotal, winner, natural,
    bets: stakes,
    payouts,
    wager: values.reduce((sum, value) => sum + value, 0),
    payout: payouts.player + payouts.banker + payouts.tie,
  };
}

// ── Mines ── 5×5 grid; multiplier = (1 - edge) × C(25, gems) / C(25 - mines, gems)
export const MINES_TILES = 25;

export function minesMultiplier(mines, gems) {
  if (gems === 0) return 1;
  let multiplier = 1 - HOUSE_EDGE;
  for (let i = 0; i < gems; i++) multiplier *= (MINES_TILES - i) / (MINES_TILES - mines - i);
  return Math.floor(multiplier * 10_000) / 10_000;
}

export function minesLayout(floats, mines) {
  const tiles = Array.from({ length: MINES_TILES }, (_, index) => index);
  const picked = [];
  for (let i = 0; i < mines; i++) picked.push(tiles.splice(Math.floor(floats[i] * tiles.length), 1)[0]);
  return picked.sort((a, b) => a - b);
}

export function minesStart(floats, betCents, mines) {
  if (!validBet(betCents) || !Number.isInteger(mines) || mines < 1 || mines > 24) throw new RangeError("invalid mines round");
  return { game: "mines", phase: "playing", bet: betCents, mines, layout: minesLayout(floats, mines), revealed: [], hit: null, multiplier: 1, wager: betCents, payout: 0 };
}

export function minesReveal(state, tile) {
  if (state.phase !== "playing") throw new RangeError("round is not active");
  if (!Number.isInteger(tile) || tile < 0 || tile >= MINES_TILES || state.revealed.includes(tile)) throw new RangeError("invalid tile");
  if (state.layout.includes(tile)) {
    state.hit = tile;
    state.phase = "busted";
    state.payout = 0;
    return state;
  }
  state.revealed.push(tile);
  state.multiplier = minesMultiplier(state.mines, state.revealed.length);
  if (state.revealed.length === MINES_TILES - state.mines) return minesCashout(state);
  return state;
}

export function minesCashout(state) {
  if (state.phase !== "playing" || !state.revealed.length) throw new RangeError("reveal at least one gem first");
  state.phase = "cashed";
  state.payout = Math.floor(state.bet * state.multiplier);
  return state;
}

export function minesView(state) {
  const over = state.phase !== "playing";
  const { layout, ...rest } = state;
  return { ...rest, next: state.phase === "playing" ? minesMultiplier(state.mines, state.revealed.length + 1) : null, ...(over ? { layout } : {}) };
}

// ── Crash ── P(crash ≥ x) = 0.99 / x. Multiplier grows as e^(GROWTH·ms).
export const CRASH_GROWTH = 0.00009;
export const CRASH_MAX = 10_000;
export const LIVE_SALT = "number-zero-live-rocket";

export function crashPointFromFloat(float) {
  const point = Math.floor(((1 - HOUSE_EDGE) * 100) / Math.max(1e-12, 1 - float) + 1e-9) / 100;
  return Math.min(CRASH_MAX, Math.max(1, point));
}
export const crashMultiplierAt = (ms) => Math.max(1, Math.floor(Math.exp(CRASH_GROWTH * Math.max(0, ms)) * 100) / 100);
export const crashTimeFor = (multiplier) => Math.log(Math.max(1, multiplier)) / CRASH_GROWTH;
export const liveCrashPoint = (seed, roundId) => crashPointFromFloat(fairFloats(seed, LIVE_SALT, roundId, 1)[0]);

export function validAutoCashout(value) {
  return value === null || value === undefined || (Number.isFinite(value) && value >= 1.01 && value <= CRASH_MAX);
}

/** Single-player crash round. `crashPoint` stays secret while flying. */
export function crashStart(floats, betCents, autoCashout, now) {
  if (!validBet(betCents) || !validAutoCashout(autoCashout)) throw new RangeError("invalid crash round");
  return { game: "crash", phase: "flying", bet: betCents, autoCashout: autoCashout ?? null, startedAt: now, crashPoint: crashPointFromFloat(floats[0]), cashedAt: null, wager: betCents, payout: 0 };
}

/** Applies due auto cash-outs / crashes for `now`. Mutates and returns the round. */
export function crashSettle(round, now) {
  if (round.phase !== "flying") return round;
  const elapsed = now - round.startedAt;
  const auto = round.autoCashout;
  if (auto && auto < round.crashPoint && elapsed >= crashTimeFor(auto)) {
    round.phase = "cashed";
    round.cashedAt = auto;
    round.payout = Math.floor(round.bet * auto);
  } else if (elapsed >= crashTimeFor(round.crashPoint)) round.phase = "crashed";
  return round;
}

export function crashCashout(round, now) {
  crashSettle(round, now);
  if (round.phase !== "flying") return round;
  round.phase = "cashed";
  round.cashedAt = crashMultiplierAt(now - round.startedAt);
  round.payout = Math.floor(round.bet * round.cashedAt);
  return round;
}

const credit = (cents) => cents / 100;

/** Client-facing projection in credits, hiding secrets for unfinished rounds. */
export function clientView(state) {
  if (state.game === "blackjack") {
    const view = blackjackView(state);
    return {
      ...view,
      hands: view.hands.map((hand) => ({ ...hand, bet: credit(hand.bet), payout: credit(hand.payout) })),
      insurance: view.insurance && { ...view.insurance, bet: credit(view.insurance.bet), payout: credit(view.insurance.payout) },
      wager: credit(view.wager),
      payout: credit(view.payout),
    };
  }
  if (state.game === "baccarat") {
    const money = (record) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, credit(value)]));
    return { ...state, phase: "settled", bets: money(state.bets), payouts: money(state.payouts), wager: credit(state.wager), payout: credit(state.payout) };
  }
  if (state.game === "mines") {
    const view = minesView(state);
    return { ...view, bet: credit(view.bet), wager: credit(view.wager), payout: credit(view.payout) };
  }
  if (state.game === "crash") {
    const { crashPoint, ...rest } = state;
    return { ...rest, bet: credit(state.bet), wager: credit(state.wager), payout: credit(state.payout), ...(state.phase === "flying" ? {} : { crashPoint }) };
  }
  throw new RangeError("unknown game");
}

export const roundFinished = (state) => ["settled", "busted", "cashed", "crashed"].includes(state.phase) || state.game === "baccarat";

/** Replays any finished round from revealed seeds for the fairness verifier. */
export function verifyRound({ game, serverSeed, clientSeed, nonce, mines = 3 }) {
  if (game === "baccarat") {
    const floats = fairFloats(serverSeed, clientSeed, nonce, BACCARAT_FLOATS);
    return baccaratPlay(floats, { player: MIN_BET_CENTS });
  }
  if (game === "mines") return { layout: minesLayout(fairFloats(serverSeed, clientSeed, nonce, MINES_FLOATS), mines) };
  if (game === "crash") return { crashPoint: crashPointFromFloat(fairFloats(serverSeed, clientSeed, nonce, 1)[0]) };
  if (game === "blackjack") return { cards: fairFloats(serverSeed, clientSeed, nonce, 16).map(cardFromFloat) };
  throw new RangeError("unknown game");
}

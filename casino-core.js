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
export const GAMES = ["blackjack", "baccarat", "mines", "crash", "roulette", "dice", "plinko", "keno", "video-poker", "slots", "hilo", "sic-bo", "money-wheel", "live-rocket", "live-roulette", "coinflip", "case-battle"];

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
  if (["roulette", "dice", "plinko", "keno", "slots", "video-poker", "hilo", "sic-bo", "money-wheel"].includes(state.game)) {
    const { deck, ...rest } = state; // video poker keeps the replacement cards secret until the draw
    return {
      ...rest,
      ...(state.game === "video-poker" && state.phase === "settled" ? { deck } : {}),
      bet: credit(state.bet ?? state.wager),
      wager: credit(state.wager),
      payout: credit(state.payout),
      ...(state.bets ? { bets: state.bets.map((bet) => ({ ...bet, amount: credit(bet.amount), payout: credit(bet.payout) })) } : {}),
      ...(state.wins ? { wins: state.wins.map((win) => ({ ...win, payout: credit(win.payout) })) } : {}),
    };
  }
  if (state.game === "crash") {
    const { crashPoint, ...rest } = state;
    return { ...rest, bet: credit(state.bet), wager: credit(state.wager), payout: credit(state.payout), ...(state.phase === "flying" ? {} : { crashPoint }) };
  }
  throw new RangeError("unknown game");
}

export const roundFinished = (state) => ["settled", "busted", "cashed", "crashed"].includes(state.phase) || INSTANT_GAMES.includes(state.game);

/** Replays any finished round from revealed seeds for the fairness verifier. */
export function verifyRound({ game, serverSeed, clientSeed, nonce, mines = 3, rows = 16, machine = "lucky-sevens" }) {
  const stream = (count) => fairFloats(serverSeed, clientSeed, nonce, count);
  if (game === "roulette") {
    const number = Math.min(36, Math.floor(stream(1)[0] * 37));
    return { number, color: rouletteColor(number) };
  }
  if (game === "dice") return { roll: Math.min(9_999, Math.floor(stream(1)[0] * 10_000)) / 100 };
  if (game === "plinko") {
    const path = stream(PLINKO_FLOATS).slice(0, rows).map((float) => (float < 0.5 ? 0 : 1));
    return { path, slot: path.reduce((sum, step) => sum + step, 0) };
  }
  if (game === "keno") return { drawn: kenoDraw(stream(KENO_FLOATS)) };
  if (game === "video-poker") {
    const deck = drawDistinct(stream(VIDEO_POKER_FLOATS), Array.from({ length: 52 }, (_, i) => i), VIDEO_POKER_FLOATS);
    return { cards: deck.slice(0, 5), replacements: deck.slice(5) };
  }
  if (game === "slots") {
    const spec = SLOT_MACHINES[machine];
    if (!spec) throw new RangeError("unknown slot machine");
    const floats = stream(SLOT_FLOATS);
    return { machine, stops: spec.reels.map((reel, index) => Math.floor(floats[index] * reel.length)) };
  }
  if (game === "baccarat") {
    const floats = fairFloats(serverSeed, clientSeed, nonce, BACCARAT_FLOATS);
    return baccaratPlay(floats, { player: MIN_BET_CENTS });
  }
  if (game === "mines") return { layout: minesLayout(fairFloats(serverSeed, clientSeed, nonce, MINES_FLOATS), mines) };
  if (game === "crash") return { crashPoint: crashPointFromFloat(fairFloats(serverSeed, clientSeed, nonce, 1)[0]) };
  if (game === "blackjack") return { cards: fairFloats(serverSeed, clientSeed, nonce, 16).map(cardFromFloat) };
  if (game === "hilo") return { cards: stream(HILO_FLOATS).map(cardFromFloat) };
  if (game === "sic-bo") {
    const dice = sicBoDice(stream(SIC_BO_FLOATS));
    return { dice, total: dice[0] + dice[1] + dice[2] };
  }
  if (game === "money-wheel") {
    const segment = wheelSegment(stream(WHEEL_FLOATS));
    return { segment, value: WHEEL_SEGMENTS[segment] };
  }
  throw new RangeError("unknown game");
}

// ════════════════════════════════════════════════════════════════════════════════════════
// Classics: Roulette, Dice, Plinko, Keno, Video Poker — and Slots. All amounts are cents.
// ════════════════════════════════════════════════════════════════════════════════════════
/** Games settled by a single request (no resumable state). */
export const INSTANT_GAMES = ["baccarat", "roulette", "dice", "plinko", "keno", "slots", "sic-bo", "money-wheel"];

// ── Roulette ── European single zero. Straight 35:1, dozen/column 2:1, even-money 1:1.
export const ROULETTE_FLOATS = 1;
export const ROULETTE_RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
export const ROULETTE_MAX_BETS = 60;
const ROULETTE_TYPES = {
  straight: { returns: 36, valid: (v) => Number.isInteger(v) && v >= 0 && v <= 36, wins: (n, v) => n === v },
  red: { returns: 2, wins: (n) => ROULETTE_RED.includes(n) },
  black: { returns: 2, wins: (n) => n > 0 && !ROULETTE_RED.includes(n) },
  odd: { returns: 2, wins: (n) => n > 0 && n % 2 === 1 },
  even: { returns: 2, wins: (n) => n > 0 && n % 2 === 0 },
  low: { returns: 2, wins: (n) => n >= 1 && n <= 18 },
  high: { returns: 2, wins: (n) => n >= 19 },
  dozen: { returns: 3, valid: (v) => [1, 2, 3].includes(v), wins: (n, v) => n > 0 && Math.ceil(n / 12) === v },
  column: { returns: 3, valid: (v) => [1, 2, 3].includes(v), wins: (n, v) => n > 0 && ((n - 1) % 3) + 1 === v },
};
export const rouletteColor = (n) => (n === 0 ? "green" : ROULETTE_RED.includes(n) ? "red" : "black");

/** `bets` = [{ type, value?, amount (cents) }]. */
export function rouletteSpin(floats, bets) {
  if (!Array.isArray(bets) || !bets.length || bets.length > ROULETTE_MAX_BETS) throw new RangeError("invalid roulette bets");
  const placed = bets.map((bet) => {
    const rule = ROULETTE_TYPES[bet?.type];
    if (!rule || !validBet(bet.amount) || (rule.valid ? !rule.valid(bet.value) : bet.value !== undefined && bet.value !== null))
      throw new RangeError("invalid roulette bet");
    return { type: bet.type, value: rule.valid ? bet.value : null, amount: bet.amount };
  });
  const wager = placed.reduce((sum, bet) => sum + bet.amount, 0);
  if (wager > MAX_BET_CENTS) throw new RangeError("total roulette bet too large");
  const number = Math.min(36, Math.floor(floats[0] * 37));
  for (const bet of placed) bet.payout = ROULETTE_TYPES[bet.type].wins(number, bet.value) ? bet.amount * ROULETTE_TYPES[bet.type].returns : 0;
  return { game: "roulette", phase: "settled", number, color: rouletteColor(number), bets: placed, wager, payout: placed.reduce((sum, bet) => sum + bet.payout, 0) };
}

// ── Dice ── roll 0.00–99.99. Under wins when roll < target; over wins when roll ≥ target.
// Win chance (%) = target or 100 − target; multiplier = 99 / chance (1% edge).
export const DICE_FLOATS = 1;
export const DICE_MIN_CHANCE = 1;
export const DICE_MAX_CHANCE = 98;
export const diceChance = (target, direction) => (direction === "under" ? target : 100 - target);
export const diceMultiplier = (chance) => Math.floor(((100 * (1 - HOUSE_EDGE)) / chance) * 10_000) / 10_000;

export function diceRoll(floats, betCents, target, direction) {
  const hundredths = Math.round(target * 100);
  const chance = diceChance(hundredths / 100, direction);
  if (!validBet(betCents) || !["under", "over"].includes(direction) || !Number.isFinite(target) || Math.abs(target * 100 - hundredths) > 1e-6 || chance < DICE_MIN_CHANCE || chance > DICE_MAX_CHANCE)
    throw new RangeError("invalid dice bet");
  const roll = Math.min(9_999, Math.floor(floats[0] * 10_000)) / 100;
  const won = direction === "under" ? roll < hundredths / 100 : roll >= hundredths / 100;
  const multiplier = diceMultiplier(chance);
  return { game: "dice", phase: "settled", bet: betCents, target: hundredths / 100, direction, chance, multiplier, roll, won, wager: betCents, payout: won ? Math.floor(betCents * multiplier) : 0 };
}

// ── Plinko ── each row bounces left (< 0.5) or right; slot = number of right bounces.
export const PLINKO_ROWS = [8, 12, 16];
export const PLINKO_FLOATS = 16;
export const PLINKO_TABLES = {
  8: { low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6], medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13], high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29] },
  12: {
    low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
    medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
  },
  16: {
    low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
    medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
    high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
  },
};

export function plinkoDrop(floats, betCents, rows, risk) {
  const table = PLINKO_TABLES[rows]?.[risk];
  if (!validBet(betCents) || !table) throw new RangeError("invalid plinko bet");
  const path = floats.slice(0, rows).map((float) => (float < 0.5 ? 0 : 1));
  const slot = path.reduce((sum, step) => sum + step, 0);
  const multiplier = table[slot];
  return { game: "plinko", phase: "settled", bet: betCents, rows, risk, path, slot, multiplier, wager: betCents, payout: Math.floor(betCents * multiplier) };
}

// ── Keno ── pick 1–10 of 40; 10 numbers drawn. Paytables return ≈ 99%.
export const KENO_NUMBERS = 40;
export const KENO_DRAWN = 10;
export const KENO_FLOATS = KENO_DRAWN;
export const KENO_PAYTABLE = {
  1: [0.7, 1.85],
  2: [0, 2, 3.8],
  3: [0, 1.1, 1.38, 26],
  4: [0, 0, 2.2, 7.9, 90],
  5: [0, 0, 1.5, 4.2, 13, 300],
  6: [0, 0, 1.1, 2, 6.2, 100, 700],
  7: [0, 0, 1.1, 1.6, 3.5, 15, 225, 700],
  8: [0, 0, 1.1, 1.5, 2, 5.5, 39, 100, 800],
  9: [0, 0, 1.1, 1.3, 1.7, 2.5, 7.5, 50, 250, 1000],
  10: [0, 0, 1.1, 1.2, 1.3, 1.8, 3.5, 13, 50, 250, 1000],
};

/** Draws `count` distinct values from `pool` (consumes one float each). */
function drawDistinct(floats, pool, count) {
  const remaining = [...pool];
  return floats.slice(0, count).map((float) => remaining.splice(Math.floor(float * remaining.length), 1)[0]);
}
export const kenoDraw = (floats) => drawDistinct(floats, Array.from({ length: KENO_NUMBERS }, (_, i) => i + 1), KENO_DRAWN);

export function kenoPlay(floats, betCents, picks) {
  const unique = new Set(picks);
  if (!validBet(betCents) || !Array.isArray(picks) || picks.length < 1 || picks.length > 10 || unique.size !== picks.length || !picks.every((n) => Number.isInteger(n) && n >= 1 && n <= KENO_NUMBERS))
    throw new RangeError("invalid keno picks");
  const drawn = kenoDraw(floats);
  const hits = picks.filter((n) => drawn.includes(n)).sort((a, b) => a - b);
  const multiplier = KENO_PAYTABLE[picks.length][hits.length];
  return { game: "keno", phase: "settled", bet: betCents, picks: [...picks].sort((a, b) => a - b), drawn, hits, multiplier, wager: betCents, payout: Math.floor(betCents * multiplier) };
}

// ── Video Poker ── Jacks or Better 9/6 (≈ 99.5% with optimal holds). Returns × bet.
export const VIDEO_POKER_FLOATS = 10;
export const VIDEO_POKER_PAYTABLE = [
  ["royal-flush", "Royal Flush", 800],
  ["straight-flush", "Straight Flush", 50],
  ["four-kind", "Four of a Kind", 25],
  ["full-house", "Full House", 9],
  ["flush", "Flush", 6],
  ["straight", "Straight", 4],
  ["three-kind", "Three of a Kind", 3],
  ["two-pair", "Two Pair", 2],
  ["jacks-better", "Jacks or Better", 1],
].map(([id, name, returns]) => ({ id, name, returns }));

/** Evaluates a 5-card hand (indices 0–51). Returns a paytable entry or null. */
export function pokerHand(cards) {
  const ranks = cards.map((card) => card % 13).sort((a, b) => a - b);
  const flush = cards.every((card) => Math.floor(card / 13) === Math.floor(cards[0] / 13));
  const counts = Object.values(ranks.reduce((map, rank) => ({ ...map, [rank]: (map[rank] || 0) + 1 }), {})).sort((a, b) => b - a);
  const distinct = new Set(ranks).size === 5;
  const royal = distinct && ranks.join() === "0,9,10,11,12";
  const straight = distinct && (ranks[4] - ranks[0] === 4 || royal);
  const pick = (id) => VIDEO_POKER_PAYTABLE.find((entry) => entry.id === id);
  if (royal && flush) return pick("royal-flush");
  if (straight && flush) return pick("straight-flush");
  if (counts[0] === 4) return pick("four-kind");
  if (counts[0] === 3 && counts[1] === 2) return pick("full-house");
  if (flush) return pick("flush");
  if (straight) return pick("straight");
  if (counts[0] === 3) return pick("three-kind");
  if (counts[0] === 2 && counts[1] === 2) return pick("two-pair");
  if (counts[0] === 2) {
    const pair = ranks.find((rank, index) => ranks[index + 1] === rank);
    if (pair === 0 || pair >= 10) return pick("jacks-better");
  }
  return null;
}

export function videoPokerStart(floats, betCents) {
  if (!validBet(betCents)) throw new RangeError("invalid video poker bet");
  const deck = drawDistinct(floats, Array.from({ length: 52 }, (_, i) => i), VIDEO_POKER_FLOATS);
  const cards = deck.slice(0, 5);
  return { game: "video-poker", phase: "deal", bet: betCents, cards, deck, held: [false, false, false, false, false], hand: pokerHand(cards), wager: betCents, payout: 0 };
}

export function videoPokerDraw(state, held) {
  if (state.phase !== "deal") throw new RangeError("round is not waiting for a draw");
  if (!Array.isArray(held) || held.length !== 5 || !held.every((value) => typeof value === "boolean")) throw new RangeError("invalid holds");
  let next = 5;
  state.held = held;
  state.cards = state.cards.map((card, index) => (held[index] ? card : state.deck[next++]));
  state.hand = pokerHand(state.cards);
  state.payout = state.hand ? state.bet * state.hand.returns : 0;
  state.phase = "settled";
  return state;
}

// ── Slots ── weighted reel strips, left-to-right line pays (× line bet) with substituting wilds.
export const SLOT_FLOATS = 5;
const strip = (weights) => Object.entries(weights).flatMap(([symbol, count]) => Array(count).fill(symbol));
/** Interleaves a weighted strip so equal symbols are spread out (deterministic). */
function spread(symbols) {
  const out = [];
  const step = 7;
  const used = new Array(symbols.length).fill(false);
  for (let i = 0, position = 0; i < symbols.length; i++) {
    while (used[position]) position = (position + 1) % symbols.length;
    used[position] = true;
    out[position] = symbols[i];
    position = (position + step) % symbols.length;
  }
  return out;
}
const reelsOf = (weights, count) => Array.from({ length: count }, () => spread(strip(weights)));
export const SLOT_MACHINES = {
  "lucky-sevens": {
    name: "Lucky Sevens", tagline: "Classic 3-reel · 1 line", rows: 3,
    lines: [[1, 1, 1]],
    reels: reelsOf({ cherry: 4, lemon: 6, orange: 6, plum: 5, bell: 4, bar: 4, seven: 3 }, 3),
    pays: { cherry: { 1: 1, 2: 5, 3: 20 }, lemon: { 3: 18 }, orange: { 3: 18 }, plum: { 3: 24 }, bell: { 3: 36 }, bar: { 3: 75 }, seven: { 3: 250 } },
    wild: null,
  },
  "fruit-frenzy": {
    name: "Fruit Frenzy", tagline: "3×3 · 5 lines · Wilds", rows: 3,
    lines: [[0, 0, 0], [1, 1, 1], [2, 2, 2], [0, 1, 2], [2, 1, 0]],
    reels: reelsOf({ cherry: 6, lemon: 6, grape: 5, melon: 4, bell: 3, seven: 2, wild: 2 }, 3),
    pays: { cherry: { 3: 4 }, lemon: { 3: 6 }, grape: { 3: 10 }, melon: { 3: 17 }, bell: { 3: 30 }, seven: { 3: 70 }, wild: { 3: 250 } },
    wild: "wild",
  },
  "neon-gems": {
    name: "Neon Gems", tagline: "5×3 · 10 lines · Wilds", rows: 3,
    lines: [[1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [1, 0, 1, 2, 1]],
    reels: reelsOf({ emerald: 8, sapphire: 8, ruby: 7, amethyst: 6, topaz: 5, diamond: 3, crown: 2, wild: 2 }, 5),
    pays: {
      emerald: { 3: 7, 4: 16, 5: 50 }, sapphire: { 3: 7, 4: 16, 5: 50 }, ruby: { 3: 11, 4: 25, 5: 80 },
      amethyst: { 3: 12, 4: 40, 5: 125 }, topaz: { 3: 16, 4: 60, 5: 200 }, diamond: { 3: 30, 4: 150, 5: 600 },
      crown: { 3: 60, 4: 300, 5: 1500 }, wild: { 3: 80, 4: 500, 5: 3000 },
    },
    wild: "wild",
  },
};

/** Best pay for one line of symbols: returns { symbol, count, multiplier } or null. */
export function slotLinePay(cells, machine) {
  let best = null;
  for (const [symbol, table] of Object.entries(machine.pays)) {
    let count = 0;
    for (const cell of cells) {
      if (cell === symbol || (machine.wild && cell === machine.wild && symbol !== machine.wild)) count++;
      else break;
    }
    // A run made only of wilds is paid by the wild's own table.
    if (symbol !== machine.wild && count && cells.slice(0, count).every((cell) => cell === machine.wild)) continue;
    const multiplier = table[count] || 0;
    if (multiplier && (!best || multiplier > best.multiplier)) best = { symbol, count, multiplier };
  }
  return best;
}

/** Exact return-to-player (each line's cells have the reel strips' marginal distribution). */
export function slotRtp(machine) {
  const probabilities = machine.reels.map((reel) => reel.reduce((map, symbol) => ({ ...map, [symbol]: (map[symbol] || 0) + 1 / reel.length }), {}));
  let rtp = 0;
  const walk = (index, cells, probability) => {
    if (index === machine.reels.length) {
      rtp += probability * (slotLinePay(cells, machine)?.multiplier || 0);
      return;
    }
    for (const [symbol, p] of Object.entries(probabilities[index])) walk(index + 1, [...cells, symbol], probability * p);
  };
  walk(0, [], 1);
  return rtp;
}

export function slotsSpin(floats, betCents, machineId) {
  const machine = SLOT_MACHINES[machineId];
  if (!machine || !validBet(betCents) || betCents % machine.lines.length) throw new RangeError("invalid slots bet");
  const lineBet = betCents / machine.lines.length;
  const stops = machine.reels.map((reel, index) => Math.floor(floats[index] * reel.length));
  const grid = machine.reels.map((reel, index) => Array.from({ length: machine.rows }, (_, row) => reel[(stops[index] + row) % reel.length]));
  const wins = [];
  machine.lines.forEach((line, index) => {
    const pay = slotLinePay(line.map((row, reel) => grid[reel][row]), machine);
    if (pay) wins.push({ line: index, ...pay, payout: Math.floor(lineBet * pay.multiplier) });
  });
  return { game: "slots", phase: "settled", machine: machineId, bet: betCents, stops, grid, wins, wager: betCents, payout: wins.reduce((sum, win) => sum + win.payout, 0) };
}

// ── Live roulette (server-wide, CS-style 15-slot wheel) ── 0 = green, 1–7 = red, 8–14 = black.
export const LIVE_ROULETTE_SALT = "number-zero-live-roulette";
export const LIVE_ROULETTE_SLOTS = 15;
/** Order of the slots along the spinning strip (red/black alternate, green between 4 and 11). */
export const LIVE_ROULETTE_ORDER = [1, 14, 2, 13, 3, 12, 4, 0, 11, 5, 10, 6, 9, 7, 8];
export const LIVE_ROULETTE_PAYOUTS = { red: 2, black: 2, green: 14 };
export const liveRouletteColor = (slot) => (slot === 0 ? "green" : slot <= 7 ? "red" : "black");
export const liveRouletteRoll = (seed, roundId) => Math.floor(fairFloats(seed, LIVE_ROULETTE_SALT, roundId, 1)[0] * LIVE_ROULETTE_SLOTS);

// ── Coinflip battles ── one player per side; the committed seed decides the coin.
export const COINFLIP_SALT = "number-zero-coinflip";
export const COINFLIP_SIDES = ["heads", "tails"];
export const coinflipResult = (seed, flipId) => (fairFloats(seed, COINFLIP_SALT, flipId, 1)[0] < 0.5 ? "heads" : "tails");

// ════════════════════════════════════════════════════════════════════════════════════════
// More classics: Hi-Lo, Sic Bo and the Money Wheel. All amounts are cents.
// ════════════════════════════════════════════════════════════════════════════════════════

// ── Hi-Lo ── an endless deck: every card is drawn independently from the round's float stream
// (card k = cardFromFloat(floats[k])). Guess whether the next card is "higher" (higher or same) or
// "lower" (lower or same); Ace is low, King high. A correct guess multiplies the stake by 0.99 / chance.
// Skip a card for free (up to HILO_MAX_SKIPS); cash out any time after one correct guess.
export const HILO_FLOATS = 64;
export const HILO_MAX_SKIPS = 20;
export const HILO_MAX_MULTIPLIER = 1_000_000;
export const hiloRank = (card) => card % 13; // 0 = A … 12 = K
/** Chance (0–1) that a guess wins from a card of `rank`. */
export const hiloChance = (rank, guess) => (guess === "higher" ? (13 - rank) / 13 : (rank + 1) / 13);
/** Multiplier one correct guess applies (1% edge). */
export const hiloStep = (chance) => Math.floor(((1 - HOUSE_EDGE) / chance) * 10_000) / 10_000;

export function hiloStart(floats, betCents) {
  if (!validBet(betCents)) throw new RangeError("invalid hi-lo bet");
  return { game: "hilo", phase: "playing", bet: betCents, cards: [cardFromFloat(floats[0])], history: [], skips: 0, multiplier: 1, wager: betCents, payout: 0 };
}

export function hiloCashout(state) {
  if (state.phase !== "playing" || !state.history.some((step) => step.correct)) throw new RangeError("make a correct guess first");
  state.phase = "cashed";
  state.payout = Math.floor(state.bet * state.multiplier);
  return state;
}

/** `action` = "higher" | "lower" | "skip" | "cashout". History entries: { guess, card, correct?, chance?, multiplier? }. */
export function hiloAction(state, floats, action) {
  if (state.phase !== "playing") throw new RangeError("round is not active");
  if (action === "cashout") return hiloCashout(state);
  const rank = hiloRank(state.cards.at(-1));
  const next = cardFromFloat(floats[state.cards.length]);
  if (action === "skip") {
    if (state.skips >= HILO_MAX_SKIPS) throw new RangeError("no skips left");
    state.skips++;
    state.cards.push(next);
    state.history.push({ guess: "skip", card: next });
  } else if (action === "higher" || action === "lower") {
    const chance = hiloChance(rank, action);
    if (chance >= 1) throw new RangeError("that guess cannot lose");
    const correct = action === "higher" ? hiloRank(next) >= rank : hiloRank(next) <= rank;
    state.cards.push(next);
    if (!correct) {
      state.history.push({ guess: action, card: next, correct: false, chance });
      state.phase = "busted";
      state.payout = 0;
      return state;
    }
    state.multiplier = Math.min(HILO_MAX_MULTIPLIER, Math.floor(state.multiplier * hiloStep(chance) * 10_000) / 10_000);
    state.history.push({ guess: action, card: next, correct: true, chance, multiplier: state.multiplier });
    if (state.multiplier >= HILO_MAX_MULTIPLIER) return hiloCashout(state);
  } else throw new RangeError("unknown hi-lo action");
  // The stream is long enough for any sane round; at its end the round cashes out automatically.
  if (state.cards.length >= HILO_FLOATS) return hiloCashout(state);
  return state;
}

// ── Sic Bo ── three dice. Odds are "to 1" (a winning bet returns amount × (odds + 1)).
// Small/big/odd/even lose on any triple. Single pays 1:1, 2:1 or 3:1 for one, two or three matching dice.
export const SIC_BO_FLOATS = 3;
export const SIC_BO_MAX_BETS = 60;
export const SIC_BO_TOTALS = { 4: 60, 5: 30, 6: 17, 7: 12, 8: 8, 9: 6, 10: 6, 11: 6, 12: 6, 13: 8, 14: 12, 15: 17, 16: 30, 17: 60 };
const face = (v) => Number.isInteger(v) && v >= 1 && v <= 6;
const comboPair = (v) => Number.isInteger(v) && face(Math.floor(v / 10)) && face(v % 10) && Math.floor(v / 10) < v % 10;
/** Bet types → { valid?(value), odds(dice, value) → odds to 1 (0 = lose) }. Combo value is two digits, e.g. 25 = a 2 and a 5. */
export const SIC_BO_BETS = {
  small: { odds: (d, _v, s) => (!s.triple && s.total <= 10 ? 1 : 0) },
  big: { odds: (d, _v, s) => (!s.triple && s.total >= 11 ? 1 : 0) },
  odd: { odds: (d, _v, s) => (!s.triple && s.total % 2 === 1 ? 1 : 0) },
  even: { odds: (d, _v, s) => (!s.triple && s.total % 2 === 0 ? 1 : 0) },
  total: { valid: (v) => Number.isInteger(v) && v >= 4 && v <= 17, odds: (d, v, s) => (s.total === v ? SIC_BO_TOTALS[v] : 0) },
  single: { valid: face, odds: (d, v) => d.filter((die) => die === v).length },
  double: { valid: face, odds: (d, v) => (d.filter((die) => die === v).length >= 2 ? 10 : 0) },
  triple: { valid: face, odds: (d, v) => (d.every((die) => die === v) ? 180 : 0) },
  "any-triple": { odds: (d, _v, s) => (s.triple ? 30 : 0) },
  combo: { valid: comboPair, odds: (d, v) => (d.includes(Math.floor(v / 10)) && d.includes(v % 10) ? 5 : 0) },
};
export const sicBoDice = (floats) => floats.slice(0, 3).map((float) => Math.min(5, Math.floor(float * 6)) + 1);

/** `bets` = [{ type, value?, amount (cents) }]. */
export function sicBoRoll(floats, bets) {
  if (!Array.isArray(bets) || !bets.length || bets.length > SIC_BO_MAX_BETS) throw new RangeError("invalid sic bo bets");
  const placed = bets.map((bet) => {
    const rule = SIC_BO_BETS[bet?.type];
    if (!rule || !validBet(bet.amount) || (rule.valid ? !rule.valid(bet.value) : bet.value !== undefined && bet.value !== null)) throw new RangeError("invalid sic bo bet");
    return { type: bet.type, value: rule.valid ? bet.value : null, amount: bet.amount };
  });
  const wager = placed.reduce((sum, bet) => sum + bet.amount, 0);
  if (wager > MAX_BET_CENTS) throw new RangeError("total sic bo bet too large");
  const dice = sicBoDice(floats);
  const summary = { total: dice[0] + dice[1] + dice[2], triple: dice[0] === dice[1] && dice[1] === dice[2] };
  for (const bet of placed) {
    const odds = SIC_BO_BETS[bet.type].odds(dice, bet.value, summary);
    bet.payout = odds ? bet.amount * (odds + 1) : 0;
  }
  return { game: "sic-bo", phase: "settled", dice, ...summary, bets: placed, wager, payout: placed.reduce((sum, bet) => sum + bet.payout, 0) };
}

// ── Money Wheel ── a 54-segment Big Six wheel. Bet on a segment value; it pays "to 1" when it lands.
export const WHEEL_FLOATS = 1;
export const WHEEL_PAYS = { 1: 1, 2: 2, 5: 5, 10: 10, 20: 20, joker: 40, zero: 40 };
/** Segments in wheel order (clockwise from the top); 24× 1, 15× 2, 7× 5, 4× 10, 2× 20, one joker, one zero. */
export const WHEEL_SEGMENTS = ["zero", "5", "2", "10", "2", "1", "1", "2", "1", "5", "1", "2", "1", "1", "20", "2", "5", "10", "2", "1", "1", "1", "2", "1", "5", "2", "1", "joker", "1", "2", "10", "1", "5", "2", "1", "1", "2", "1", "1", "1", "5", "20", "2", "1", "10", "2", "1", "5", "2", "1", "2", "1", "1", "1"];
export const wheelSegment = (floats) => Math.min(WHEEL_SEGMENTS.length - 1, Math.floor(floats[0] * WHEEL_SEGMENTS.length));

/** `bets` = [{ type: "1"|"2"|"5"|"10"|"20"|"joker"|"zero", amount (cents) }], at most one per type. */
export function wheelSpin(floats, bets) {
  const types = Object.keys(WHEEL_PAYS);
  if (!Array.isArray(bets) || !bets.length || bets.length > types.length) throw new RangeError("invalid wheel bets");
  const placed = bets.map((bet) => {
    if (!types.includes(String(bet?.type)) || !validBet(bet.amount)) throw new RangeError("invalid wheel bet");
    return { type: String(bet.type), amount: bet.amount };
  });
  if (new Set(placed.map((bet) => bet.type)).size !== placed.length) throw new RangeError("one bet per wheel value");
  const wager = placed.reduce((sum, bet) => sum + bet.amount, 0);
  if (wager > MAX_BET_CENTS) throw new RangeError("total wheel bet too large");
  const segment = wheelSegment(floats);
  const value = WHEEL_SEGMENTS[segment];
  for (const bet of placed) bet.payout = bet.type === value ? bet.amount * (WHEEL_PAYS[value] + 1) : 0;
  return { game: "money-wheel", phase: "settled", segment, value, bets: placed, wager, payout: placed.reduce((sum, bet) => sum + bet.payout, 0) };
}

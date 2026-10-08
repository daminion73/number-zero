// Live blackjack table: one shared dealer, up to `seats` players (humans and house bots).
//
// Round loop
//   betting  — open; the 12 s countdown starts with the first human bet (or right after a round that had human
//              bets). Bets are debited when placed and can be changed/cleared until betting closes. When every
//              seated human has bet the countdown is cut to 3 s. Bots bet the minimum when the countdown starts.
//   playing  — 2 cards each, dealer 1 up + hole card (peeks for blackjack under an ace/ten). Players act in seat
//              order: HIT, STAND, DOUBLE (first two cards), SPLIT (one split per seat, equal ranks; split aces
//              get one card). 15 s per decision, auto-STAND on timeout. Bots play basic strategy.
//   result   — dealer reveals and draws to 17 (stands on soft 17); blackjack pays 3:2, win 1:1, push returns
//              the bet. Shown for the dealer's draw animation + 5 s, then betting reopens.
// Provably fair: every round commits a fresh seed (hash shown during betting/play, seed revealed at result);
// card k of round n = cardFromFloat(floats(seed, n, …)[k]) — an infinite-deck stream like single-player blackjack.
import { cardFromFloat, handValue, validBet } from "../../casino-core.js";

export const BETTING_MS = 12_000;
export const ALL_IN_MS = 3_000;
export const TURN_MS = 15_000;
export const BOT_THINK_MS = 900;
export const RESULT_MS = 5_000;
export const DEAL_STEP_MS = 320; // client deal animation per card (used to time the result phase)
export const DEALER_STEP_MS = 700; // client dealer reveal/draw animation per card
const MAX_CARDS = 200;
const BET_MULTIPLE = 1_000; // max bet = 1000 × min bet

const isNatural = (cards) => cards.length === 2 && handValue(cards).total === 21;
const rank = (card) => card % 13;
const points = (card) => Math.min(10, rank(card) + 1);

export const blackjack = {
  id: "blackjack",
  name: "Blackjack",
  bots: true,

  config(body, fail) {
    const seats = Number(body.seats);
    const minBet = Number(body.minBet);
    if (![2, 3, 4, 5].includes(seats)) throw fail(400, "invalid_seats", "Choose 2 to 5 seats.");
    if (![1, 10, 100, 1000].includes(minBet)) throw fail(400, "invalid_bet", "Choose a minimum bet of 1, 10, 100 or 1,000 CR.");
    return { seats, minBet, maxBet: minBet * BET_MULTIPLE, minBetCents: minBet * 100, maxBetCents: minBet * BET_MULTIPLE * 100 };
  },
  seatCount: (config) => config.seats,
  init(room) {
    room.play = freshPlay(room.config.seats);
  },
  /** Seats can be taken any time no hand is live (betting and the result screen). */
  joinable: (room) => room.play.phase !== "playing",

  async join(room, seat, player, t) {
    const play = room.play;
    if (!play.seedHash) commitSeed(play, t);
    if (player.bot && play.phase === "betting" && play.closesAt) play.bets[seat] = room.config.minBetCents;
  },

  async leave(room, seat, t, { closing } = {}) {
    const play = room.play;
    const player = room.seats[seat];
    if (play.phase === "betting") {
      const bet = play.bets[seat];
      play.bets[seat] = null;
      if (bet && !player.bot) await t.credit(player.userId, bet);
      return true;
    }
    if (play.phase === "playing") {
      const hands = play.hands[seat] || [];
      const stake = hands.reduce((sum, hand) => sum + hand.bet, 0);
      if (hands.length) {
        if (!player.bot) {
          // Closing the table refunds the unsettled bet; walking away mid-hand forfeits it.
          if (closing) await t.credit(player.userId, stake);
          else await t.record(player.userId, stake, 0, { game: "live-blackjack", won: false, natural: false });
        }
        for (const hand of hands) Object.assign(hand, { done: true, forfeit: true, result: "forfeit", payout: 0 });
        if (!closing && play.turn?.seat === seat) await advance(room, t);
        schedule(play);
      }
      return true;
    }
    return true; // result phase: everything is settled
  },

  async action(room, seat, body, t) {
    const play = room.play;
    const type = body?.type;
    if (type === "bet" || type === "clear") {
      if (play.phase !== "betting") throw t.fail(409, "betting_closed", "Betting is closed — wait for the next round.");
      const player = room.seats[seat];
      const old = play.bets[seat] || 0;
      let next = 0;
      if (type === "bet") {
        next = typeof body.amount === "number" && Number.isFinite(body.amount) ? Math.round(body.amount * 100) : NaN;
        if (!Number.isInteger(next / 100) || !validBet(next) || next < room.config.minBetCents || next > room.config.maxBetCents)
          throw t.fail(400, "invalid_bet", `Bet a whole number of credits from ${room.config.minBet} to ${room.config.maxBet}.`);
      }
      if (next > old) await t.debit(player.userId, next - old);
      else if (old > next) await t.credit(player.userId, old - next);
      play.bets[seat] = next || null;
      if (next && !play.closesAt) startCountdown(room, t);
      if (play.closesAt) {
        const humans = room.seats.map((entry, index) => [entry, index]).filter(([entry]) => entry && !entry.bot);
        if (humans.every(([, index]) => play.bets[index])) play.closesAt = Math.min(play.closesAt, t.now + ALL_IN_MS);
      }
      schedule(play);
      return;
    }
    if (!["hit", "stand", "double", "split"].includes(type)) throw t.fail(400, "invalid_action", "Unknown move.");
    if (play.phase !== "playing" || play.turn?.seat !== seat) throw t.fail(409, "not_your_turn", "It is not your turn.");
    await move(room, type, t);
    schedule(play);
  },

  async tick(room, t) {
    const play = room.play;
    play.nextAt = null;
    if (play.phase === "betting" && play.closesAt && t.now >= play.closesAt) await closeBetting(room, t);
    else if (play.phase === "playing" && play.turn) {
      const bot = play.botTurn;
      if (bot && t.now >= play.botAt) await move(room, botMove(play.hands[play.turn.seat][play.turn.hand], play.dealer[0], play.hands[play.turn.seat].length), t);
      else if (!bot && t.now >= play.turnEndsAt) await move(room, "stand", t);
    } else if (play.phase === "result" && t.now >= play.resultEndsAt) openBetting(room, t);
    schedule(play);
  },

  view(room, viewerSeat, at) {
    const play = room.play;
    const revealed = play.phase === "result";
    const live = play.phase === "playing" || revealed;
    const hands = room.seats.map((seat, index) => {
      if (!live || !seat) return [];
      return (play.hands[index] || []).filter((hand) => hand.owner === ownerOf(seat)).map((hand) => {
        const value = handValue(hand.cards);
        return { cards: hand.cards, bet: hand.bet / 100, total: value.total, soft: value.soft, done: hand.done, doubled: hand.doubled, split: hand.split, natural: hand.natural, forfeit: Boolean(hand.forfeit), result: revealed || hand.forfeit ? hand.result : hand.cards.length && value.total > 21 ? "bust" : null, payout: revealed ? hand.payout / 100 : null };
      });
    });
    const dealerCards = !live ? [] : revealed ? play.dealer : [play.dealer[0], null];
    const dealerValue = handValue(dealerCards.filter((card) => card != null));
    let actions = [];
    if (play.phase === "playing" && play.turn && play.turn.seat === viewerSeat) actions = legal(play, play.hands[viewerSeat][play.turn.hand], room, play.hands[viewerSeat].length);
    return {
      phase: play.phase,
      round: play.round,
      minBet: room.config.minBet,
      maxBet: room.config.maxBet,
      bettingMs: BETTING_MS,
      turnMs: TURN_MS,
      dealStepMs: DEAL_STEP_MS,
      dealerStepMs: DEALER_STEP_MS,
      closesAt: play.phase === "betting" ? play.closesAt : null,
      bets: room.seats.map((seat, index) => (play.phase === "betting" && seat && play.bets[index] ? play.bets[index] / 100 : null)),
      hands,
      turn: play.phase === "playing" ? play.turn : null,
      turnEndsAt: play.phase === "playing" ? play.turnEndsAt : null,
      actions,
      dealer: { cards: dealerCards, total: dealerValue.total, soft: dealerValue.soft, revealed, natural: revealed && isNatural(play.dealer), peeked: play.peeked || false },
      dealtAt: live ? play.dealtAt : null,
      revealAt: revealed ? play.revealAt : null,
      resultEndsAt: revealed ? play.resultEndsAt : null,
      seedHash: play.seedHash || null,
      seed: revealed ? play.seed : null,
      drawn: revealed ? play.cursor : null,
      nonce: play.round,
      last: play.last || null,
      serverTime: at,
    };
  },

  summary(room) {
    return { minBet: room.config.minBet, phase: room.play.phase, round: room.play.round };
  },
};

function freshPlay(seats) {
  return { phase: "betting", round: 1, nextAt: null, closesAt: null, bets: Array(seats).fill(null), hands: Array(seats).fill(null), dealer: [], turn: null, cursor: 0, seed: null, seedHash: null, hadHumans: false, last: null };
}

const ownerOf = (seat) => (seat.bot ? `bot:${seat.name}` : `user:${seat.userId}`);

function commitSeed(play, t) {
  const { seed, hash } = t.seed();
  play.seed = seed;
  play.seedHash = hash;
}

function schedule(play) {
  if (play.phase === "betting") play.nextAt = play.closesAt || null;
  else if (play.phase === "playing") play.nextAt = play.turn ? (play.botTurn ? play.botAt : play.turnEndsAt) : null;
  else if (play.phase === "result") play.nextAt = play.resultEndsAt;
}

function startCountdown(room, t) {
  const play = room.play;
  play.closesAt = t.now + BETTING_MS;
  room.state = "playing"; // the table is live from the first bet on (lobby shows IN PLAY; never expires as "waiting")
  room.seats.forEach((seat, index) => {
    if (seat?.bot && !play.bets[index]) play.bets[index] = room.config.minBetCents;
  });
}

function openBetting(room, t) {
  const play = room.play;
  const again = play.hadHumans;
  play.last = { round: play.round, seed: play.seed, seedHash: play.seedHash, drawn: play.cursor };
  Object.assign(play, { phase: "betting", round: play.round + 1, closesAt: null, bets: room.seats.map(() => null), hands: room.seats.map(() => null), dealer: [], turn: null, cursor: 0, peeked: false, hadHumans: false });
  commitSeed(play, t);
  // Keep the game flowing for players who just played; otherwise wait for someone to bet (no idle ticks).
  if (again && room.seats.some((seat) => seat && !seat.bot)) startCountdown(room, t);
}

function draw(room, t) {
  const play = room.play;
  if (play.cursor >= MAX_CARDS) throw new RangeError("card stream exhausted");
  const float = t.floats(play.seed, play.round, play.cursor + 1)[play.cursor];
  play.cursor++;
  return cardFromFloat(float);
}

async function closeBetting(room, t) {
  const play = room.play;
  const humanBet = room.seats.some((seat, index) => seat && !seat.bot && play.bets[index]);
  if (!humanBet) {
    // Nobody real is playing this round: drop the bots' (moneyless) bets and wait for a bet.
    play.bets = room.seats.map(() => null);
    play.closesAt = null;
    return;
  }
  const seats = room.seats.map((seat, index) => (seat && play.bets[index] ? index : -1)).filter((index) => index >= 0);
  play.hands = room.seats.map((seat, index) => (seats.includes(index) ? [{ owner: ownerOf(seat), userId: seat.bot ? null : seat.userId, cards: [], bet: play.bets[index], doubled: false, split: false, done: false, natural: false, result: null, payout: 0 }] : null));
  play.bets = room.seats.map(() => null);
  play.hadHumans = true;
  play.phase = "playing";
  play.closesAt = null;
  for (let pass = 0; pass < 2; pass++) {
    for (const index of seats) play.hands[index][0].cards.push(draw(room, t));
    play.dealer.push(draw(room, t));
  }
  play.dealtAt = t.now;
  for (const index of seats) {
    const hand = play.hands[index][0];
    if (isNatural(hand.cards)) Object.assign(hand, { natural: true, done: true });
  }
  // Dealer peeks under an ace or ten-value card; a dealer blackjack ends the round at once.
  const up = points(play.dealer[0]);
  if (up === 1 || up === 10) {
    play.peeked = true;
    if (isNatural(play.dealer)) return finish(room, t, seats.length * 2 + 2);
  }
  play.turn = null;
  await advance(room, t, seats.length * 2 + 2);
}

/** Moves the turn to the next unfinished hand (in seat order), or to the dealer. */
async function advance(room, t, dealtCards = 0) {
  const play = room.play;
  const delay = dealtCards * DEAL_STEP_MS;
  for (let index = 0; index < play.hands.length; index++) {
    const hands = play.hands[index];
    if (!hands) continue;
    const handIndex = hands.findIndex((hand) => !hand.done);
    if (handIndex < 0) continue;
    const bot = room.seats[index]?.bot;
    play.turn = { seat: index, hand: handIndex };
    play.botTurn = Boolean(bot);
    play.turnEndsAt = t.now + delay + TURN_MS;
    play.botAt = t.now + delay + BOT_THINK_MS;
    return;
  }
  play.turn = null;
  return finish(room, t, dealtCards);
}

function legal(play, hand, room, handCount) {
  if (!hand || hand.done) return [];
  const actions = ["hit", "stand"];
  if (hand.cards.length === 2) {
    actions.push("double");
    if (handCount === 1 && rank(hand.cards[0]) === rank(hand.cards[1])) actions.push("split");
  }
  return actions;
}

async function move(room, type, t) {
  const play = room.play;
  const { seat, hand: handIndex } = play.turn;
  const hands = play.hands[seat];
  const hand = hands[handIndex];
  const player = room.seats[seat];
  if (!legal(play, hand, room, hands.length).includes(type)) throw t.fail(409, "illegal_move", `You cannot ${type} now.`);
  let dealt = 0;
  if (type === "stand") hand.done = true;
  else if (type === "hit") {
    hand.cards.push(draw(room, t));
    dealt = 1;
  } else if (type === "double") {
    if (!player.bot) await t.debit(player.userId, hand.bet);
    hand.bet *= 2;
    hand.doubled = true;
    hand.cards.push(draw(room, t));
    hand.done = true;
    dealt = 1;
  } else if (type === "split") {
    if (!player.bot) await t.debit(player.userId, hand.bet);
    const second = { ...hand, cards: [hand.cards[1]], split: true };
    hand.cards = [hand.cards[0]];
    hand.split = true;
    hands.push(second);
    const aces = rank(hand.cards[0]) === 0;
    for (const entry of hands) {
      entry.cards.push(draw(room, t));
      if (aces) entry.done = true; // split aces take one card each
    }
    dealt = 2;
  }
  const value = handValue(hand.cards).total;
  if (value >= 21) hand.done = true;
  for (const entry of hands) if (!entry.done && handValue(entry.cards).total >= 21) entry.done = true;
  await advance(room, t, dealt);
}

/** Dealer reveals and draws, every hand is settled and recorded, the result phase starts. */
async function finish(room, t, dealtCards = 0) {
  const play = room.play;
  const live = play.hands.flat().filter((hand) => hand && !hand.forfeit);
  const contest = live.some((hand) => handValue(hand.cards).total <= 21 && !hand.natural);
  const before = play.dealer.length;
  if (contest && !isNatural(play.dealer)) while (handValue(play.dealer).total < 17) play.dealer.push(draw(room, t));
  const dealer = handValue(play.dealer).total;
  const dealerNatural = isNatural(play.dealer);
  for (const hand of live) {
    const total = handValue(hand.cards).total;
    const natural = hand.natural && !hand.split;
    let payout = 0, result = "lose";
    if (total > 21) result = "bust";
    else if (natural && !dealerNatural) [payout, result] = [Math.floor(hand.bet * 2.5), "blackjack"];
    else if (natural && dealerNatural) [payout, result] = [hand.bet, "push"];
    else if (dealerNatural) result = "lose";
    else if (dealer > 21 || total > dealer) [payout, result] = [hand.bet * 2, "win"];
    else if (total === dealer) [payout, result] = [hand.bet, "push"];
    Object.assign(hand, { payout, result, done: true });
  }
  for (const hands of play.hands) {
    if (!hands || hands[0].forfeit || hands[0].userId == null) continue;
    const wager = hands.reduce((sum, hand) => sum + hand.bet, 0);
    const payout = hands.reduce((sum, hand) => sum + hand.payout, 0);
    await t.credit(hands[0].userId, payout);
    await t.record(hands[0].userId, wager, payout, { game: "live-blackjack", won: payout > wager, natural: hands.some((hand) => hand.natural && !hand.split) });
  }
  play.phase = "result";
  play.turn = null;
  play.revealAt = t.now + dealtCards * DEAL_STEP_MS;
  play.resultEndsAt = play.revealAt + (1 + play.dealer.length - before) * DEALER_STEP_MS + RESULT_MS;
}

/** Basic strategy (dealer stands on soft 17) for house bots. */
export function botMove(hand, upCard, handCount) {
  const up = points(upCard) === 1 ? 11 : points(upCard);
  const { total, soft } = handValue(hand.cards);
  const two = hand.cards.length === 2;
  if (two && handCount === 1 && rank(hand.cards[0]) === rank(hand.cards[1])) {
    const pair = points(hand.cards[0]);
    const split =
      pair === 1 || pair === 8 ||
      (pair === 9 && up !== 7 && up < 10) ||
      ((pair === 7 || pair === 2 || pair === 3) && up <= 7) ||
      (pair === 6 && up <= 6) ||
      (pair === 4 && (up === 5 || up === 6));
    if (split) return "split";
  }
  if (soft) {
    if (total >= 19) return "stand";
    if (total === 18) return two && up >= 3 && up <= 6 ? "double" : up <= 8 ? "stand" : "hit";
    if (two && ((total >= 17 && up >= 3 && up <= 6) || (total >= 15 && up >= 4 && up <= 6) || (up >= 5 && up <= 6))) return "double";
    return "hit";
  }
  if (total >= 17) return "stand";
  if (total >= 13) return up <= 6 ? "stand" : "hit";
  if (total === 12) return up >= 4 && up <= 6 ? "stand" : "hit";
  if (total === 11) return two ? "double" : "hit";
  if (total === 10) return two && up <= 9 ? "double" : "hit";
  if (total === 9) return two && up >= 3 && up <= 6 ? "double" : "hit";
  return "hit";
}

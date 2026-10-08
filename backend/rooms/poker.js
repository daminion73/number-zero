// Poker room: a No-Limit Texas Hold'em cash table for 2, 4 or 6 seats.
// Sitting down converts the buy-in into a chip stack; leaving cashes the stack back out (folding first if you are in
// a hand). Hands deal automatically whenever two or more stacks (at least one human) are seated. Each hand uses a
// fresh committed seed (hash shown before the deal, seed revealed after) and a Fisher–Yates deck from tools.floats.
// Chips are integer cents but every bet is a whole credit, so the smallest chip (for odd-chip splits) is 1 CR.
import { buildPots, evaluateHand, shuffleDeck } from "./poker-hands.js";

export const TURN_MS = 20_000;
export const STREET_PAUSE_MS = 900; // chips slide into the pot before the next street is dealt
export const RUNOUT_PAUSE_MS = 1_500; // all-in run-outs deal one street at a time
export const SHOWDOWN_MS = 5_500; // result display before the next hand
export const UNCONTESTED_MS = 3_000;
export const FIRST_HAND_MS = 1_500; // short pause after the table fills before the first deal
export const BOT_THINK_MS = [1_000, 2_000];
export const MAX_TIMEOUTS = 2; // consecutive turn timeouts before a player is sat out
const CHIP = 100;
const BIG_BLINDS = [2, 10, 50, 200, 1000];
const BUY_INS = [50, 100, 200];

const cr = (cents) => cents / 100;
const STREETS = ["preflop", "flop", "turn", "river"];

/** Live (dealt, still seated) entry for a seat in the current hand. */
const entry = (hand, seat) => (hand && hand.players[seat] && !hand.players[seat].left ? hand.players[seat] : null);
const contenders = (hand) => hand.players.filter((p) => p && !p.folded);
const canAct = (p) => p && !p.folded && !p.allIn;
const needsAction = (hand, p) => canAct(p) && (!p.acted || p.bet < hand.currentBet);

function seatsAfter(count, from) {
  const order = [];
  for (let step = 1; step <= count; step++) order.push((((from + step) % count) + count) % count);
  return order;
}

function nextToAct(hand, from) {
  const actors = hand.players.filter(canAct);
  // Nobody left to bet against: a lone active player who has matched the bet does not act.
  if (actors.length === 0) return -1;
  if (actors.length === 1 && actors[0].bet >= hand.currentBet && contenders(hand).length > 1) return -1;
  for (const seat of seatsAfter(hand.players.length, from)) if (needsAction(hand, hand.players[seat])) return seat;
  return -1;
}

function legal(hand, seat, stack) {
  const p = hand.players[seat];
  const toCall = Math.min(hand.currentBet - p.bet, stack);
  const maxTo = p.bet + stack;
  const othersCanAct = hand.players.some((other, index) => index !== seat && canAct(other));
  const canRaise = !p.capped && stack > toCall && othersCanAct;
  const minTo = Math.min(maxTo, hand.currentBet === 0 ? hand.bigBlind : hand.currentBet + hand.minRaise);
  return { toCall, canCheck: toCall === 0, canRaise, minTo, maxTo };
}

function botThink(t) {
  return t.now + BOT_THINK_MS[0] + t.randomInt(BOT_THINK_MS[1] - BOT_THINK_MS[0] + 1);
}

/** Monte Carlo equity of a bot's hand against `opponents` random hands (uses only what the bot can see). */
export function estimateEquity(hole, board, opponents, iterations = 120, random = Math.random) {
  const known = new Set([...hole, ...board]);
  const unseen = Array.from({ length: 52 }, (_, i) => i).filter((card) => !known.has(card));
  let score = 0;
  for (let run = 0; run < iterations; run++) {
    const pool = unseen.slice();
    const draw = () => pool.splice(Math.floor(random() * pool.length), 1)[0];
    const others = Array.from({ length: opponents }, () => [draw(), draw()]);
    const fullBoard = [...board];
    while (fullBoard.length < 5) fullBoard.push(draw());
    const mine = evaluateHand([...hole, ...fullBoard]).score;
    let best = true, ties = 0;
    for (const other of others) {
      const theirs = evaluateHand([...other, ...fullBoard]).score;
      if (theirs > mine) { best = false; break; }
      if (theirs === mine) ties++;
    }
    if (best) score += 1 / (ties + 1);
  }
  return score / iterations;
}

/** A simple strength-based bot: raise strong hands, call with odds, check/fold the rest, with some randomness. */
export function botDecision(hand, seat, stack, random = Math.random) {
  const p = hand.players[seat];
  const opponents = contenders(hand).length - 1;
  const { toCall, canCheck, canRaise, minTo, maxTo } = legal(hand, seat, stack);
  const pot = hand.players.reduce((sum, other) => sum + (other ? other.committed : 0), 0);
  const equity = estimateEquity(p.hole, hand.board, Math.max(1, opponents), 120, random) + (random() - 0.5) * 0.1;
  const raiseAt = Math.min(0.7, Math.max(0.3, 1.3 / (opponents + 1) + 0.05));
  const potOdds = toCall / (pot + toCall || 1);
  const roll = random();
  const raiseTo = (fraction) => {
    const target = hand.currentBet + Math.max(hand.bigBlind, Math.round((pot + toCall) * fraction));
    const whole = Math.round(target / CHIP) * CHIP;
    return Math.min(maxTo, Math.max(minTo, whole));
  };
  if (canRaise && equity > raiseAt && (hand.raises < 3 || equity > raiseAt + 0.25)) {
    if (equity > raiseAt + 0.22 && roll < 0.25) return { type: "allin" };
    const amount = raiseTo(0.5 + roll * 0.5);
    return amount >= maxTo ? { type: "allin" } : { type: "raise", amount: cr(amount) };
  }
  if (canCheck) {
    if (canRaise && roll < 0.08) return { type: "raise", amount: cr(raiseTo(0.5)) }; // the occasional bluff
    return { type: "check" };
  }
  const bigCall = toCall >= stack * 0.5;
  if (equity > potOdds + (bigCall ? 0.12 : 0.02) || (toCall <= hand.bigBlind && equity > 0.18 && roll < 0.7)) return { type: "call" };
  return { type: "fold" };
}

export const poker = {
  id: "poker",
  name: "Poker",
  bots: true,

  config(body, fail) {
    const seats = Number(body.seats);
    const bigBlind = Number(body.bigBlind);
    const buyIn = Number(body.buyIn);
    if (![2, 4, 6].includes(seats)) throw fail(400, "invalid_seats", "Poker tables have 2, 4 or 6 seats.");
    if (!BIG_BLINDS.includes(bigBlind)) throw fail(400, "invalid_blinds", "Choose one of the listed blind levels.");
    if (!BUY_INS.includes(buyIn)) throw fail(400, "invalid_buy_in", "Choose a buy-in of 50, 100 or 200 big blinds.");
    return { seats, bigBlind, smallBlind: bigBlind / 2, buyIn, bigBlindCents: bigBlind * 100, buyInCents: buyIn * bigBlind * 100 };
  },
  seatCount: (config) => config.seats,
  init(room) {
    const n = room.config.seats;
    room.play = { phase: "waiting", nextAt: null, handNo: 0, button: -1, stacks: Array(n).fill(null), sitOut: Array(n).fill(false), timeouts: Array(n).fill(0), nextSeed: null, hand: null, last: null, nextHandAt: null };
  },
  joinable: (room) => room.state !== "closed",

  async join(room, seat, player, t) {
    const play = room.play;
    if (!player.bot) await t.debit(player.userId, room.config.buyInCents);
    play.stacks[seat] = room.config.buyInCents;
    play.sitOut[seat] = false;
    play.timeouts[seat] = 0;
    if (!play.nextSeed) play.nextSeed = t.seed();
    if (play.phase !== "hand") {
      play.nextHandAt = Math.max(play.nextHandAt || 0, t.now + FIRST_HAND_MS);
      if (play.phase === "waiting") play.nextAt = t.now; // tick decides whether a hand can start
    }
  },

  async leave(room, seat, t, { closing } = {}) {
    const play = room.play;
    const player = room.seats[seat];
    const hand = play.phase === "hand" ? play.hand : null;
    const p = entry(hand, seat);
    let cash = play.stacks[seat] || 0;
    if (p && !p.recorded) {
      if (closing) {
        // The table is closing mid-hand: the hand is void and everyone gets back what they put in.
        cash += p.committed;
        p.committed = 0;
        p.recorded = true;
        hand.voided = true;
      } else {
        if (!p.folded) {
          p.folded = true;
          p.last = "fold";
        }
        if (!player.bot) await t.record(player.userId, p.committed, 0, { game: "poker", won: false, hand: null });
        p.recorded = true;
      }
    }
    if (p) p.left = true;
    if (!player.bot) await t.credit(player.userId, cash);
    play.stacks[seat] = null;
    play.sitOut[seat] = false;
    play.timeouts[seat] = 0;
    if (hand && !closing && p) await afterMove(room, t, seat);
    if (!closing) schedule(room);
    return true;
  },

  async action(room, seat, body, t) {
    const play = room.play;
    const type = body?.type;
    const hand = play.phase === "hand" ? play.hand : null;
    const p = entry(hand, seat);
    if (type === "rebuy") {
      if (play.stacks[seat] > 0) throw t.fail(409, "has_chips", "You can rebuy when your stack is empty.");
      if (p && !p.folded) throw t.fail(409, "in_hand", "Wait for the hand to finish.");
      await t.debit(room.seats[seat].userId, room.config.buyInCents);
      play.stacks[seat] = room.config.buyInCents;
      play.sitOut[seat] = false;
      play.timeouts[seat] = 0;
      if (play.phase === "waiting") play.nextAt = t.now;
      return;
    }
    if (type === "sitin" || type === "sitout") {
      play.sitOut[seat] = type === "sitout";
      play.timeouts[seat] = 0;
      if (play.phase === "waiting") play.nextAt = t.now;
      return;
    }
    if (!hand || !p) throw t.fail(409, "not_in_hand", "You are not in this hand.");
    if (hand.toAct !== seat || hand.pendingAt != null) throw t.fail(409, "not_your_turn", "It is not your turn.");
    play.timeouts[seat] = 0;
    await applyMove(room, seat, body, t);
  },

  async tick(room, t) {
    const play = room.play;
    const hand = play.hand;
    if (play.phase === "hand") {
      if (hand.pendingAt != null) {
        if (t.now >= hand.pendingAt) await nextStreet(room, t);
      } else if (hand.toAct >= 0) {
        const seat = hand.toAct;
        const p = hand.players[seat];
        if (room.seats[seat]?.bot && t.now >= hand.botAt) await applyMove(room, seat, botDecision(hand, seat, play.stacks[seat]), t);
        else if (t.now >= hand.turnEndsAt) {
          const { canCheck } = legal(hand, seat, play.stacks[seat]);
          if (!room.seats[seat]?.bot && ++play.timeouts[seat] >= MAX_TIMEOUTS) play.sitOut[seat] = true;
          await applyMove(room, seat, { type: canCheck ? "check" : "fold", timeout: true }, t);
          p.timedOut = true;
        }
      }
    } else if (play.nextHandAt == null || t.now >= play.nextHandAt) {
      startHand(room, t);
    }
    schedule(room);
  },

  view(room, viewerSeat, at) {
    const play = room.play;
    const hand = play.hand;
    const active = play.phase === "hand";
    const done = play.phase === "done";
    const showing = hand && (active || done);
    const seats = room.seats.map((seated, seat) => {
      if (!seated) return null;
      const p = showing ? entry(hand, seat) : null;
      const reveal = p && (seat === viewerSeat || p.shown);
      return {
        stack: cr(play.stacks[seat] || 0),
        sitOut: Boolean(play.sitOut[seat]),
        inHand: Boolean(p),
        folded: Boolean(p?.folded),
        allIn: Boolean(p?.allIn),
        bet: p ? cr(p.bet) : 0,
        committed: p ? cr(p.committed) : 0,
        last: p?.last || null,
        cards: p ? (reveal ? p.hole : p.folded ? null : [null, null]) : null,
        shown: Boolean(p?.shown),
        hand: p?.shown && p.eval ? { id: p.eval.id, label: p.eval.label, best: p.eval.best } : null,
        won: done && p ? cr(p.won) : 0,
      };
    });
    const pot = showing ? hand.players.reduce((sum, p) => sum + (p ? p.committed : 0), 0) : 0;
    const collected = showing ? hand.players.reduce((sum, p) => sum + (p ? p.committed - p.bet : 0), 0) : 0;
    let pots = [];
    if (done && hand.result) pots = hand.result.pots.map((entryPot) => ({ amount: cr(entryPot.amount), winners: entryPot.winners, label: entryPot.label }));
    else if (active) {
      const live = buildPots(hand.players.map((p, seat) => p && { seat, committed: p.committed - p.bet, live: !p.folded }).filter(Boolean));
      pots = live.map((entryPot) => ({ amount: cr(entryPot.amount), winners: null, label: null }));
    }
    const me = active ? entry(hand, viewerSeat) : null;
    let you = null;
    if (me && hand.toAct === viewerSeat && hand.pendingAt == null) {
      const options = legal(hand, viewerSeat, play.stacks[viewerSeat]);
      you = { toCall: cr(options.toCall), canCheck: options.canCheck, canRaise: options.canRaise, minRaiseTo: cr(options.minTo), maxRaiseTo: cr(options.maxTo), currentBet: cr(hand.currentBet), bet: cr(me.bet) };
    }
    const mine = showing ? entry(hand, viewerSeat) : null;
    let myHand = null;
    if (mine && !mine.folded) myHand = hand.board.length >= 3 ? evaluateHand([...mine.hole, ...hand.board]).label : preflopLabel(mine.hole);
    return {
      phase: play.phase,
      handNo: play.handNo,
      street: showing ? hand.street : null,
      bigBlind: room.config.bigBlind,
      smallBlind: room.config.smallBlind,
      buyIn: cr(room.config.buyInCents),
      seats,
      board: showing ? hand.board : [],
      button: showing ? hand.button : play.button,
      sb: showing ? hand.sb : -1,
      bb: showing ? hand.bb : -1,
      dealOrder: showing ? hand.dealt : [],
      toAct: active && hand.pendingAt == null ? hand.toAct : -1,
      turnEndsAt: active && hand.pendingAt == null && hand.toAct >= 0 ? hand.turnEndsAt : null,
      turnMs: TURN_MS,
      pot: cr(pot),
      collected: cr(collected),
      pots,
      you,
      myHand,
      result: done && hand.result ? { uncontested: hand.result.uncontested, voided: Boolean(hand.voided) } : null,
      nextHandAt: done ? play.nextHandAt : null,
      seedHash: showing ? hand.seedHash : play.nextSeed?.hash || null,
      seed: done ? hand.seed : null,
      last: play.last,
      serverTime: at,
    };
  },

  summary(room) {
    return { hand: room.play.handNo, playing: room.play.phase === "hand" };
  },
};

function preflopLabel(hole) {
  const ranks = hole.map((card) => (card % 13 === 0 ? 14 : (card % 13) + 1)).sort((a, b) => b - a);
  const names = { 14: "A", 13: "K", 12: "Q", 11: "J", 10: "10" };
  const name = (rank) => names[rank] || String(rank);
  if (ranks[0] === ranks[1]) return `Pocket ${name(ranks[0])}s`;
  return `${name(ranks[0])}-${name(ranks[1])}${Math.floor(hole[0] / 13) === Math.floor(hole[1] / 13) ? " suited" : ""}`;
}

/** Sets `play.nextAt` to the next moment something has to happen (or null when idle). */
function schedule(room) {
  const play = room.play;
  const hand = play.hand;
  if (play.phase === "hand") {
    if (hand.pendingAt != null) play.nextAt = hand.pendingAt;
    else if (hand.toAct >= 0) play.nextAt = room.seats[hand.toAct]?.bot ? Math.min(hand.botAt, hand.turnEndsAt) : hand.turnEndsAt;
    else play.nextAt = null;
  } else if (play.phase === "done") play.nextAt = play.nextHandAt;
  else play.nextAt = canDeal(room) ? Math.max(play.nextHandAt || 0, 0) : null;
}

function dealable(room) {
  const play = room.play;
  return room.seats.map((seat, index) => (seat && !play.sitOut[index] && (play.stacks[index] > 0 || seat.bot) ? index : -1)).filter((index) => index >= 0);
}

function canDeal(room) {
  const seats = dealable(room);
  return seats.length >= 2 && seats.some((index) => !room.seats[index].bot);
}

function startHand(room, t) {
  const play = room.play;
  if (!canDeal(room)) {
    if (play.phase === "done") play.last = play.hand ? { handNo: play.hand.no, seed: play.hand.seed, seedHash: play.hand.seedHash } : play.last;
    play.phase = "waiting";
    play.hand = null;
    play.nextHandAt = null;
    room.state = "waiting";
    return;
  }
  const { bigBlindCents: bigBlind, buyInCents } = room.config;
  const n = room.seats.length;
  // Busted house bots rebuy with house money so the table keeps going.
  for (const index of dealable(room)) if (room.seats[index].bot && !(play.stacks[index] > 0)) play.stacks[index] = buyInCents;
  const seated = dealable(room);
  if (play.hand) play.last = { handNo: play.hand.no, seed: play.hand.seed, seedHash: play.hand.seedHash };
  const button = seatsAfter(n, play.button < 0 ? n - 1 : play.button).find((index) => seated.includes(index));
  const order = seatsAfter(n, button).filter((index) => seated.includes(index)); // left of the button … button
  const headsUp = seated.length === 2;
  const sb = headsUp ? button : order[0];
  const bb = headsUp ? order[0] : order[1];
  const committed = play.nextSeed || t.seed();
  play.nextSeed = t.seed();
  const deck = shuffleDeck(t.floats(committed.seed, 0, 52));
  const players = Array(n).fill(null);
  for (const index of order) players[index] = { userId: room.seats[index].userId, bot: Boolean(room.seats[index].bot), hole: [], bet: 0, committed: 0, folded: false, allIn: false, acted: false, capped: false, shown: false, left: false, recorded: false, last: null, won: 0, eval: null };
  let cursor = 0;
  for (let round = 0; round < 2; round++) for (const index of order) players[index].hole.push(deck[cursor++]);
  play.handNo += 1;
  play.button = button;
  play.phase = "hand";
  play.nextHandAt = null;
  room.state = "playing";
  const hand = (play.hand = {
    no: play.handNo, seed: committed.seed, seedHash: committed.hash, deck, cursor, board: [], street: "preflop",
    button, sb, bb, dealt: order, players, bigBlind, currentBet: bigBlind, minRaise: bigBlind, raises: 0,
    toAct: -1, turnEndsAt: null, botAt: null, pendingAt: null, result: null, voided: false,
  });
  post(play, hand, sb, bigBlind / 2, "small blind");
  post(play, hand, bb, bigBlind, "big blind");
  beginTurn(room, t, nextToAct(hand, bb));
}

function post(play, hand, seat, amount, label) {
  const p = hand.players[seat];
  const paid = Math.min(amount, play.stacks[seat]);
  play.stacks[seat] -= paid;
  p.bet += paid;
  p.committed += paid;
  p.last = label;
  if (play.stacks[seat] === 0) p.allIn = true;
}

function beginTurn(room, t, seat) {
  const hand = room.play.hand;
  if (seat < 0) return roundComplete(room, t);
  hand.toAct = seat;
  hand.turnEndsAt = t.now + TURN_MS;
  hand.botAt = room.seats[seat]?.bot ? botThink(t) : null;
}

async function applyMove(room, seat, body, t) {
  const play = room.play;
  const hand = play.hand;
  const p = hand.players[seat];
  const stack = play.stacks[seat];
  const options = legal(hand, seat, stack);
  let type = body?.type;
  const pay = (amount) => {
    play.stacks[seat] -= amount;
    p.bet += amount;
    p.committed += amount;
    if (play.stacks[seat] === 0) p.allIn = true;
  };
  if (type === "call" && options.toCall === 0) type = "check";
  if (type === "allin") {
    if (options.maxTo > hand.currentBet && options.canRaise) type = "raise";
    else type = "call";
    body = { type, amount: cr(options.maxTo) };
  }
  if (type === "fold") {
    p.folded = true;
    p.last = body.timeout ? "timeout" : "fold";
  } else if (type === "check") {
    if (!options.canCheck) throw t.fail(409, "cannot_check", "You have to call, raise or fold.");
    p.last = "check";
  } else if (type === "call") {
    pay(options.toCall);
    p.last = p.allIn ? "all-in" : "call";
  } else if (type === "raise") {
    if (!options.canRaise) throw t.fail(409, "cannot_raise", "Raising is not allowed here — call or fold.");
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || Math.round(amount * 100) % CHIP !== 0) throw t.fail(400, "invalid_amount", "Bet in whole credits.");
    const to = Math.round(amount * 100);
    if (to > options.maxTo) throw t.fail(409, "insufficient_chips", "You do not have that many chips.");
    if (to < options.minTo || to <= hand.currentBet) throw t.fail(409, "raise_too_small", `The minimum raise is to ${cr(options.minTo)} CR.`);
    const increment = to - hand.currentBet;
    const full = increment >= hand.minRaise;
    pay(to - p.bet);
    for (const [index, other] of hand.players.entries()) {
      if (index === seat || !canAct(other)) continue;
      // A full raise reopens the betting; a short all-in only obliges the others to respond.
      if (full) other.capped = false;
      else if (other.acted) other.capped = true;
      other.acted = false;
    }
    if (full) hand.minRaise = increment;
    p.last = p.allIn ? "all-in" : hand.currentBet === 0 ? "bet" : "raise";
    hand.currentBet = to;
    hand.raises += 1;
  } else throw t.fail(400, "invalid_action", "Fold, check, call, raise or go all-in.");
  p.acted = true;
  p.capped = false;
  await afterMove(room, t, seat);
}

/** After a move or a player leaving: end the hand, pass the turn or close the betting round. */
async function afterMove(room, t, from) {
  const hand = room.play.hand;
  if (room.play.phase !== "hand") return;
  if (contenders(hand).length <= 1) return settle(room, t);
  if (hand.pendingAt != null) return;
  if (hand.toAct !== from && hand.toAct >= 0 && needsAction(hand, hand.players[hand.toAct])) return; // someone else left
  beginTurn(room, t, nextToAct(hand, from));
}

/** Betting round over: sweep bets into the pot, then deal the next street after a pause (or go to showdown). */
function roundComplete(room, t) {
  const play = room.play;
  const hand = play.hand;
  // Return an uncalled bet straight away so it never sits in the pot.
  const bets = hand.players.map((p, seat) => p && { seat, bet: p.bet }).filter(Boolean).sort((a, b) => b.bet - a.bet);
  if (bets.length > 1 && bets[0].bet > bets[1].bet) {
    const top = hand.players[bets[0].seat];
    if (!top.folded && !top.left) {
      const refund = bets[0].bet - bets[1].bet;
      top.bet -= refund;
      top.committed -= refund;
      play.stacks[bets[0].seat] += refund;
      if (play.stacks[bets[0].seat] > 0) top.allIn = false;
    }
  }
  for (const p of hand.players) if (p) {
    p.bet = 0;
    p.acted = false;
    p.capped = false;
  }
  hand.currentBet = 0;
  hand.minRaise = hand.bigBlind;
  hand.raises = 0;
  hand.toAct = -1;
  hand.turnEndsAt = null;
  hand.botAt = null;
  const runout = hand.players.filter(canAct).length < 2;
  hand.pendingAt = t.now + (runout && hand.street !== "preflop" ? RUNOUT_PAUSE_MS : STREET_PAUSE_MS);
}

async function nextStreet(room, t) {
  const hand = room.play.hand;
  hand.pendingAt = null;
  if (hand.street === "river") return settle(room, t);
  hand.street = STREETS[STREETS.indexOf(hand.street) + 1];
  hand.cursor += 1; // burn
  const count = hand.street === "flop" ? 3 : 1;
  for (let i = 0; i < count; i++) hand.board.push(hand.deck[hand.cursor++]);
  for (const p of hand.players) if (p && !p.folded) p.last = p.allIn ? "all-in" : null;
  if (hand.players.filter(canAct).length < 2) {
    hand.pendingAt = t.now + RUNOUT_PAUSE_MS;
    return;
  }
  beginTurn(room, t, nextToAct(hand, hand.button));
}

/** Awards every pot (side pots, splits, odd chips left of the button), records the hand and schedules the next. */
async function settle(room, t) {
  const play = room.play;
  const hand = play.hand;
  const live = contenders(hand);
  const uncontested = live.length === 1;
  // Uncalled chips (the last bet nobody matched) go back before the pots are built.
  const ranked = hand.players.map((p, seat) => p && { seat, committed: p.committed }).filter(Boolean).sort((a, b) => b.committed - a.committed);
  const top = ranked[0] && hand.players[ranked[0].seat];
  if (ranked.length > 1 && top && !top.folded && ranked[0].committed > ranked[1].committed) {
    const refund = ranked[0].committed - ranked[1].committed;
    top.committed -= refund;
    top.bet = Math.max(0, top.bet - refund);
    play.stacks[ranked[0].seat] += refund;
  }
  if (!uncontested) for (const [seat, p] of hand.players.entries()) if (p && !p.folded) {
    p.shown = true;
    p.eval = evaluateHand([...p.hole, ...hand.board]);
    p.last = null;
    void seat;
  }
  const pots = buildPots(hand.players.map((p, seat) => p && { seat, committed: p.committed, live: !p.folded }).filter(Boolean));
  const leftOfButton = seatsAfter(hand.players.length, hand.button);
  const result = [];
  for (const pot of pots) {
    let winners = pot.eligible;
    if (!uncontested && winners.length > 1) {
      const best = Math.max(...winners.map((seat) => hand.players[seat].eval.score));
      winners = winners.filter((seat) => hand.players[seat].eval.score === best);
    }
    winners = leftOfButton.filter((seat) => winners.includes(seat));
    const share = Math.floor(pot.amount / CHIP / winners.length) * CHIP;
    let odd = pot.amount - share * winners.length;
    for (const seat of winners) {
      const extra = Math.min(odd, CHIP);
      odd -= extra;
      hand.players[seat].won += share + extra;
    }
    result.push({ amount: pot.amount, winners, label: uncontested ? null : hand.players[winners[0]].eval.label });
  }
  for (const [seat, p] of hand.players.entries()) {
    if (!p) continue;
    if (p.won && !p.left) play.stacks[seat] += p.won;
    if (!p.bot && !p.recorded) {
      await t.record(p.userId, p.committed, p.won, { game: "poker", won: p.won > p.committed, hand: p.shown ? p.eval.id : null });
      p.recorded = true;
    }
    if (p.won && !p.shown) p.last = "wins";
  }
  hand.street = uncontested ? hand.street : "showdown";
  hand.toAct = -1;
  hand.pendingAt = null;
  hand.turnEndsAt = null;
  hand.result = { pots: result, uncontested };
  play.phase = "done";
  play.nextHandAt = t.now + (uncontested ? UNCONTESTED_MS : SHOWDOWN_MS);
}

// Russian Roulette room: 2–6 players stake the same amount, one bullet sits in a 6-chamber revolver.
// Players pull the trigger in seat order (the first shooter is drawn from the seed); the cylinder advances
// one chamber per pull. The first player the bullet finds is out and the survivors split the whole pot.
// Each player may SPIN the cylinder once per game before pulling. Everything is derived from a committed seed:
//   floats = tools.floats(seed, 0, 8): bullet = ⌊f0·6⌋, first shooter = players[⌊f1·n⌋], k-th spin lands on ⌊f(2+k)·6⌋.
// The view only ever exposes the pull history (who pulled, spun, survived) — never the bullet or chamber index.
import { validBet } from "../../casino-core.js";

export const CHAMBERS = 6;
export const COUNTDOWN_MS = 5_000; // after every seat is filled
export const OPEN_MS = 1_200; // from start to the first turn (cylinder loads)
export const TURN_MS = 10_000; // then the trigger pulls itself
export const PULL_GAP_MS = 1_600; // click animation before the next turn
export const SPIN_GAP_MS = 2_400; // spin + click animation
export const BOT_THINK_MS = 1_500;
export const FLOATS = 2 + CHAMBERS;

/** Pure replay used by the engine (and mirrored by the client to verify a revealed seed). */
export function rouletteSetup(floats, players) {
  return { bullet: Math.min(CHAMBERS - 1, Math.floor(floats[0] * CHAMBERS)), first: players[Math.min(players.length - 1, Math.floor(floats[1] * players.length))] };
}
const spinLanding = (floats, index) => Math.min(CHAMBERS - 1, Math.floor(floats[2 + index] * CHAMBERS));

const occupied = (room) => room.seats.flatMap((seat, index) => (seat ? [index] : []));

function nextPlayer(play, seat) {
  const at = play.players.indexOf(seat);
  return play.players[(at + 1) % play.players.length];
}

function scheduleTurn(room, seat, at) {
  const play = room.play;
  play.turnSeat = seat;
  play.turnAt = at;
  play.turnEndsAt = at + TURN_MS;
  play.nextAt = room.seats[seat]?.bot ? at + BOT_THINK_MS : play.turnEndsAt;
}

async function begin(room, t) {
  const play = room.play;
  const players = occupied(room);
  const floats = t.floats(play.seed, 0, FLOATS);
  const { bullet, first } = rouletteSetup(floats, players);
  room.state = "playing";
  Object.assign(play, {
    phase: "playing",
    players,
    roster: players.map((seat) => ({ seat, name: room.seats[seat].name, bot: Boolean(room.seats[seat].bot), look: room.seats[seat].look || null })),
    bullet,
    position: 0,
    firstSeat: first,
    spinsUsed: [],
    history: [],
    startedAt: t.now,
    startAt: null,
  });
  scheduleTurn(room, first, t.now + OPEN_MS);
}

async function settle(room, shotSeat, t) {
  const play = room.play;
  const stake = room.config.stakeCents;
  const pot = stake * play.players.length;
  const survivors = play.players.filter((seat) => seat !== shotSeat);
  const share = Math.floor(pot / survivors.length);
  const remainder = pot - share * survivors.length;
  const payouts = {};
  for (const seat of play.players) payouts[seat] = seat === shotSeat ? 0 : share + (seat === survivors[0] ? remainder : 0);
  for (const seat of play.players) {
    const player = room.seats[seat];
    if (!player || player.bot) continue;
    await t.credit(player.userId, payouts[seat]);
    await t.record(player.userId, stake, payouts[seat], { game: "russian-roulette", won: seat !== shotSeat, shot: seat === shotSeat });
  }
  Object.assign(play, { phase: "finished", shotSeat, payouts, pot, endedAt: t.now, turnSeat: null, turnAt: null, turnEndsAt: null, nextAt: null, settled: true });
  room.state = "finished";
}

async function pull(room, seat, spin, t) {
  const play = room.play;
  if (spin) {
    play.position = spinLanding(t.floats(play.seed, 0, FLOATS), play.spinsUsed.length);
    play.spinsUsed.push(seat);
  }
  const fired = play.position === play.bullet;
  play.history.push({ seat, spun: Boolean(spin), safe: !fired, at: t.now });
  if (fired) return settle(room, seat, t);
  play.position = (play.position + 1) % CHAMBERS;
  scheduleTurn(room, nextPlayer(play, seat), t.now + (spin ? SPIN_GAP_MS : PULL_GAP_MS));
}

/** Pulls since the last spin (public knowledge: that many chambers are known to be empty). */
function sinceSpin(history) {
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    count++;
    if (history[i].spun) break;
  }
  return count;
}

export const russianRoulette = {
  id: "russian-roulette",
  name: "Russian Roulette",
  bots: true,
  closeWhilePlaying: false,

  config(body, fail) {
    const stakeCents = typeof body.stake === "number" && Number.isFinite(body.stake) ? Math.round(body.stake * 100) : NaN;
    if (!validBet(stakeCents)) throw fail(400, "invalid_bet", "Choose a stake of at least 1 CR.");
    const seats = body.seats;
    if (!Number.isInteger(seats) || seats < 2 || seats > 6) throw fail(400, "invalid_seats", "Tables seat 2 to 6 players.");
    return { stakeCents, stake: stakeCents / 100, seats };
  },
  seatCount: (config) => config.seats,
  init(room) {
    room.play = { phase: "waiting", nextAt: null, startAt: null };
  },
  joinable: (room) => room.state === "waiting",

  async join(room, seat, player, t) {
    if (!room.play.seed) Object.assign(room.play, (({ seed, hash }) => ({ seed, seedHash: hash }))(t.seed()));
    if (!player.bot) await t.debit(player.userId, room.config.stakeCents);
    room.play.nextAt = t.now; // tick checks whether the table is now full
  },

  async leave(room, seat, t, { closing } = {}) {
    const play = room.play;
    const player = room.seats[seat];
    if (room.state === "playing" && !closing) throw t.fail(409, "in_progress", "The cylinder is already turning — you can't leave mid-game.");
    if (room.state !== "finished" && !play.settled && !player.bot) await t.credit(player.userId, room.config.stakeCents);
    if (room.state === "waiting" && play.phase === "countdown") Object.assign(play, { phase: "waiting", startAt: null, nextAt: null });
    return true;
  },

  canStart: (room) => room.state === "waiting" && occupied(room).length >= 2,
  async start(room, t) {
    await begin(room, t);
  },

  async action(room, seat, body, t) {
    const play = room.play;
    if (body?.type !== "pull") throw t.fail(400, "invalid_action", "Pull the trigger.");
    if (room.state !== "playing" || play.phase !== "playing") throw t.fail(409, "not_playing", "The game is not running.");
    if (play.turnSeat !== seat) throw t.fail(409, "not_your_turn", "Wait for your turn.");
    if (t.now < play.turnAt) throw t.fail(409, "too_soon", "The cylinder is still turning.");
    const spin = body.spin === true;
    if (spin && play.spinsUsed.includes(seat)) throw t.fail(409, "spin_used", "You already used your spin.");
    await pull(room, seat, spin, t);
  },

  async tick(room, t) {
    const play = room.play;
    play.nextAt = null;
    if (room.state === "waiting") {
      if (play.phase === "countdown") {
        if (!room.seats.every(Boolean)) Object.assign(play, { phase: "waiting", startAt: null });
        else if (t.now >= play.startAt) await begin(room, t);
        else play.nextAt = play.startAt;
      } else if (room.seats.every(Boolean)) {
        Object.assign(play, { phase: "countdown", startAt: t.now + COUNTDOWN_MS, nextAt: t.now + COUNTDOWN_MS });
      }
      return;
    }
    if (room.state !== "playing" || play.phase !== "playing") return;
    const seat = play.turnSeat;
    if (room.seats[seat]?.bot) {
      if (t.now < play.turnAt + BOT_THINK_MS) return void (play.nextAt = play.turnAt + BOT_THINK_MS);
      // Bots spin once the odds of the next chamber get bad (≥ 1 in 3 after three empty clicks).
      const spin = !play.spinsUsed.includes(seat) && sinceSpin(play.history) >= 3;
      return pull(room, seat, spin, t);
    }
    if (t.now < play.turnEndsAt) return void (play.nextAt = play.turnEndsAt);
    await pull(room, seat, false, t); // timeout: the trigger pulls itself
  },

  view(room, viewerSeat, at) {
    const play = room.play;
    const done = play.phase === "finished";
    const seated = play.players || occupied(room);
    return {
      phase: play.phase,
      stake: room.config.stake,
      chambers: CHAMBERS,
      pot: (room.config.stakeCents * seated.length) / 100,
      players: play.players || null,
      roster: play.roster || null,
      startAt: play.startAt || null,
      countdownMs: COUNTDOWN_MS,
      turnSeat: play.turnSeat ?? null,
      turnAt: play.turnAt || null,
      turnEndsAt: play.turnEndsAt || null,
      turnMs: TURN_MS,
      firstSeat: play.firstSeat ?? null,
      history: (play.history || []).map(({ seat, spun, safe, at: when }) => ({ seat, spun, safe, at: when })),
      pulls: play.history?.length || 0,
      spinsUsed: play.spinsUsed || [],
      canSpin: play.phase === "playing" && viewerSeat >= 0 && !(play.spinsUsed || []).includes(viewerSeat),
      shotSeat: done ? play.shotSeat : null,
      payouts: done ? Object.fromEntries(Object.entries(play.payouts).map(([seat, cents]) => [seat, cents / 100])) : null,
      seedHash: play.seedHash || null,
      seed: done ? play.seed : null,
      serverTime: at,
    };
  },

  summary(room) {
    const play = room.play;
    return { stake: room.config.stake, pulls: play.history?.length || 0, shot: play.phase === "finished" ? play.roster.find((entry) => entry.seat === play.shotSeat)?.name || null : null };
  },
};

// Coinflip room: two seats, one per side of the coin. The seed is committed when the room opens;
// once both seats are filled a short countdown runs, the coin is flipped and the winner takes 2×.
import { COINFLIP_SIDES, coinflipResult, validBet } from "../../casino-core.js";

export const COUNTDOWN_MS = 3_000;
export const FLIP_MS = 3_200;
const other = (side) => (side === "heads" ? "tails" : "heads");

export const coinflip = {
  id: "coinflip",
  name: "Coinflip",
  bots: true,
  closeWhilePlaying: false,

  config(body, fail) {
    const stakeCents = typeof body.stake === "number" ? Math.round(body.stake * 100) : NaN;
    if (!validBet(stakeCents)) throw fail(400, "invalid_bet", "Choose a stake of at least 1 CR.");
    if (!COINFLIP_SIDES.includes(body.side)) throw fail(400, "invalid_side", "Pick heads or tails.");
    return { stakeCents, stake: stakeCents / 100, side: body.side };
  },
  seatCount: () => 2,
  init(room) {
    room.play = { phase: "waiting", nextAt: null };
  },
  joinable: (room) => room.state === "waiting",

  async join(room, seat, player, t) {
    if (!room.play.seed) Object.assign(room.play, (({ seed, hash }) => ({ seed, seedHash: hash }))(t.seed()));
    if (!player.bot) await t.debit(player.userId, room.config.stakeCents);
    room.play.nextAt = t.now; // tick checks whether both seats are now filled
  },

  async leave(room, seat, t) {
    const player = room.seats[seat];
    if (room.state === "playing") throw t.fail(409, "in_progress", "The coin is already in the air.");
    if (room.state === "waiting" && !player.bot) await t.credit(player.userId, room.config.stakeCents);
    return true;
  },

  async action(room, seat, body, t) {
    throw t.fail(409, "no_action", "Nothing to do — the coin flips automatically.");
  },

  async tick(room, t) {
    const play = room.play;
    play.nextAt = null;
    if (room.state === "waiting" && room.seats.every(Boolean)) {
      room.state = "playing";
      play.phase = "countdown";
      play.flipAt = t.now + COUNTDOWN_MS;
      play.nextAt = play.flipAt;
      return;
    }
    if (play.phase === "countdown" && t.now >= play.flipAt) {
      const result = coinflipResult(play.seed, room.id);
      const winnerSeat = result === room.config.side ? 0 : 1;
      const pot = room.config.stakeCents * 2;
      for (const [index, player] of room.seats.entries()) {
        if (player.bot) continue;
        const payout = index === winnerSeat ? pot : 0;
        await t.credit(player.userId, payout);
        await t.record(player.userId, room.config.stakeCents, payout);
      }
      Object.assign(play, { phase: "flipped", result, winnerSeat, revealAt: play.flipAt + FLIP_MS });
      room.state = "finished";
    }
  },

  view(room, viewerSeat, at) {
    const play = room.play;
    const done = play.phase === "flipped";
    return {
      phase: play.phase,
      stake: room.config.stake,
      sides: [room.config.side, other(room.config.side)],
      flipAt: play.flipAt || null,
      flipMs: FLIP_MS,
      revealAt: play.revealAt || null,
      result: done ? play.result : null,
      winnerSeat: done ? play.winnerSeat : null,
      seedHash: play.seedHash || null,
      seed: done ? play.seed : null,
      serverTime: at,
    };
  },

  summary(room) {
    return { stake: room.config.stake, side: room.config.side, result: room.play.phase === "flipped" ? room.play.result : null, winnerSeat: room.play.winnerSeat ?? null };
  },
};

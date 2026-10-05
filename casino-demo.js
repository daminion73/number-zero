// Browser-side demo engine. Mirrors the online casino API (same paths, bodies and response
// shapes) using the shared provably-fair core, with unlimited credits and nothing recorded.
import {
  BACCARAT_FLOATS, BLACKJACK_FLOATS, MINES_FLOATS, baccaratPlay, blackjackAction, blackjackStart, clientView,
  crashCashout, crashSettle, crashStart, fairFloats, minesCashout, minesReveal, minesStart, roundFinished, sha256Hex,
} from "./casino-core.js";

const randomHex = (bytes) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
const cents = (credits) => Math.round(Number(credits) * 100);
const fail = (code, message) => Object.assign(new Error(message), { code });

export function createDemoEngine({ now = () => Date.now() } = {}) {
  let seed = { serverSeed: randomHex(32), clientSeed: randomHex(6), nonce: 0 };
  let previous = null;
  const active = { blackjack: null, mines: null, crash: null };
  let sequence = 0;

  const fairPublic = () => ({ serverSeedHash: sha256Hex(seed.serverSeed), clientSeed: seed.clientSeed, nonce: seed.nonce, previous });
  function nextRound(count) {
    const fair = { serverSeedHash: sha256Hex(seed.serverSeed), clientSeed: seed.clientSeed, nonce: seed.nonce };
    const floats = fairFloats(seed.serverSeed, seed.clientSeed, seed.nonce, count);
    seed.nonce++;
    return { fair, floats, serverSeed: seed.serverSeed };
  }
  const view = (record) => (record ? { ...clientView(record.state), id: record.id, fair: record.fair } : null);
  const respond = (record) => ({ round: view(record), user: null, demo: true, serverTime: now() });
  function begin(game, count, build) {
    if (active[game] && !roundFinished(active[game].state)) throw fail("round_active", "Finish your current round first.");
    const { fair, floats, serverSeed } = nextRound(count);
    let state;
    try {
      state = build(floats);
    } catch (error) {
      seed.nonce--;
      throw fail("invalid_bet", error.message);
    }
    const record = { id: `demo-${++sequence}`, state, floats, fair, serverSeed };
    if (game !== "baccarat") active[game] = record;
    return record;
  }
  function current(game) {
    const record = active[game];
    if (!record || roundFinished(record.state)) throw fail("no_round", "No active round.");
    return record;
  }
  function apply(game, fn) {
    const record = current(game);
    try {
      fn(record);
    } catch (error) {
      throw fail("illegal_action", error.message);
    }
    return respond(record);
  }

  const routes = {
    "GET /fair": () => ({ fair: fairPublic(), demo: true }),
    "POST /fair/rotate": (body) => {
      if (active.crash) crashSettle(active.crash.state, now());
      if (Object.values(active).some((record) => record && !roundFinished(record.state))) throw fail("round_active", "Finish active rounds before rotating seeds.");
      const clientSeed = typeof body.clientSeed === "string" && /^[\w-]{1,64}$/.test(body.clientSeed) ? body.clientSeed : randomHex(6);
      previous = { serverSeed: seed.serverSeed, serverSeedHash: sha256Hex(seed.serverSeed), clientSeed: seed.clientSeed, nonce: seed.nonce };
      seed = { serverSeed: randomHex(32), clientSeed, nonce: 0 };
      return { fair: fairPublic(), demo: true };
    },
    "GET /casino/active": () => {
      if (active.crash) crashSettle(active.crash.state, now());
      const open = (game) => (active[game] && !roundFinished(active[game].state) ? view(active[game]) : null);
      return { blackjack: open("blackjack"), mines: open("mines"), crash: open("crash"), demo: true, serverTime: now() };
    },
    "POST /casino/blackjack/start": (body) => respond(begin("blackjack", BLACKJACK_FLOATS, (floats) => blackjackStart(floats, (body.bets || []).map(cents)))),
    "POST /casino/blackjack/action": (body) => apply("blackjack", (record) => blackjackAction(record.state, record.floats, body.action)),
    "POST /casino/baccarat": (body) => {
      const bets = body.bets || {};
      return respond(begin("baccarat", BACCARAT_FLOATS, (floats) => baccaratPlay(floats, { player: cents(bets.player || 0), banker: cents(bets.banker || 0), tie: cents(bets.tie || 0) })));
    },
    "POST /casino/mines/start": (body) => respond(begin("mines", MINES_FLOATS, (floats) => minesStart(floats, cents(body.bet), body.mines))),
    "POST /casino/mines/reveal": (body) => apply("mines", (record) => minesReveal(record.state, body.tile)),
    "POST /casino/mines/cashout": () => apply("mines", (record) => minesCashout(record.state)),
    "POST /casino/crash/start": (body) => respond(begin("crash", 1, (floats) => crashStart(floats, cents(body.bet), body.autoCashout ?? null, now()))),
    "POST /casino/crash/cashout": () => apply("crash", (record) => crashCashout(record.state, now())),
    "GET /casino/crash": () => {
      const record = active.crash;
      if (record) crashSettle(record.state, now());
      return respond(record);
    },
  };
  return {
    async request(path, body) {
      const handler = routes[`${body === undefined ? "GET" : "POST"} ${path}`];
      if (!handler) throw fail("not_found", "Demo mode does not support this action.");
      return structuredClone(handler(body || {}));
    },
    /** Revealed seed for a finished demo round (demo rounds can be verified instantly). */
    reveal(roundId) {
      const record = Object.values(active).find((item) => item?.id === roundId);
      return record && roundFinished(record.state) ? record.serverSeed : null;
    },
  };
}

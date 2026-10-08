// Live blackjack table view: shared dealer on top, player seats along the rail, betting chips and
// HIT/STAND/DOUBLE/SPLIT controls in the dock. Cards are animated once (keyed by round/seat/hand/index)
// against the server clock, so 600 ms polls never restart an animation.
import { cardFromFloat, fairFloats, sha256Hex } from "../casino-core.js";
import { cardFaceMarkup } from "./cards.js";

const BACK = `<div class="pc-face pc-back"><span class="pc-back-logo">N<em>//</em>Z</span></div>`;
const CHIP_STEPS = [1, 5, 10, 25, 100];
/** Short chip label: 5 · 25 · 2.5K · 1M. */
const short = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}K` : `${+n.toFixed(2)}`);
const RESULT_TEXT = { blackjack: "BLACKJACK", win: "WIN", push: "PUSH", lose: "LOSE", bust: "BUST", forfeit: "FORFEIT" };

export function mountRoom(root, api) {
  root.innerHTML = `
    <div class="rbj">
      <section class="rbj-felt">
        <div class="rbj-dealer">
          <div class="rbj-shoe" aria-hidden="true"><i></i><i></i><i></i></div>
          <div class="rbj-dealer-cards"></div>
          <div class="rbj-dealer-label"><b>DEALER</b><span class="rbj-dealer-total"></span></div>
        </div>
        <div class="rbj-centre">
          <p class="rbj-rules">BLACKJACK PAYS 3 TO 2 · DEALER STANDS ON SOFT 17 · INSURANCE NOT OFFERED</p>
          <div class="rbj-status"></div>
        </div>
        <div class="rbj-seats"></div>
      </section>
      <footer class="rbj-dock">
        <div class="rbj-controls"></div>
        <div class="rbj-side"><div class="rbj-fair"></div><div class="rbj-leave"></div></div>
      </footer>
    </div>`;

  const find = (selector) => root.querySelector(selector);
  let room = null;
  let lastBet = 0;
  let toastedRound = 0;
  let sigs = {};
  const appear = new Map(); // card key → server time it lands
  let timer = 0;

  const me = () => room?.you ?? -1;
  const isHost = () => Boolean(api.user()) && String(api.user().id) === room.hostId;
  const now = () => api.serverNow();

  /** Server time at which the dealer finishes drawing and results show. */
  function resultsAt(play) {
    return play.revealAt + Math.max(0, play.dealer.cards.length - 1) * play.dealerStepMs;
  }

  /** Card markup; new cards get a deal animation timed to land at their scheduled moment. */
  function card(key, index, at, { hidden = false, flipAt = 0 } = {}) {
    if (!appear.has(key)) appear.set(key, Math.max(at, now()));
    const delay = appear.get(key) - now();
    const animate = delay > -600 && !api.reducedMotion();
    const flipDelay = flipAt ? flipAt - now() : -1;
    const flipping = !hidden && flipAt && flipDelay > -600 && !api.reducedMotion();
    const style = `${animate ? `animation-delay:${Math.round(delay)}ms;` : ""}${flipping ? `--flip-delay:${Math.max(0, Math.round(flipDelay))}ms;` : ""}`;
    return `<div class="pc-card ${animate ? "rbj-deal" : ""} ${flipping ? "rbj-flip" : ""}" style="${style}"><div class="pc-inner${hidden ? " pc-down" : ""}">${hidden || index == null ? "" : cardFaceMarkup(index)}${BACK}</div></div>`;
  }

  /** Deal moment of a card during the initial deal: round-robin seats, then the dealer, twice. */
  function dealAt(play, seatOrder, index) {
    const seated = play.hands.map((hands, seat) => (hands.length ? seat : -1)).filter((seat) => seat >= 0);
    const perPass = seated.length + 1;
    const position = seatOrder < 0 ? perPass - 1 : seated.indexOf(seatOrder);
    return play.dealtAt + (index * perPass + position) * play.dealStepMs;
  }

  function dealerMarkup() {
    const play = room.play;
    const cards = play.dealer.cards;
    if (!cards.length) return `<div class="rbj-empty-cards"><span></span><span></span></div>`;
    return cards
      .map((value, index) => {
        const key = `${play.round}:d:${index}`;
        if (index < 2) return card(key, value, dealAt(play, -1, index), { hidden: value == null, flipAt: index === 1 && play.dealer.revealed ? play.revealAt : 0 });
        return card(key, value, play.revealAt + (index - 1) * play.dealerStepMs);
      })
      .join("");
  }

  function dealerTotal() {
    const play = room.play;
    if (!play.dealer.cards.length) return "";
    if (!play.dealer.revealed) return `<i>${play.dealer.total}</i>`;
    const delay = resultsAt(play) - now();
    const label = play.dealer.natural ? "BJ" : play.dealer.total > 21 ? "BUST" : play.dealer.total;
    return `<i class="${play.dealer.total > 21 ? "bust" : ""} ${delay > 0 ? "rbj-later" : ""}" style="${delay > 0 ? `animation-delay:${Math.round(delay)}ms` : ""}">${label}</i>`;
  }

  /** 0 for the centre seat … 1 for the outermost: seats follow the curve of the table. */
  function lift(seat) {
    const half = (room.seats.length - 1) / 2;
    return half ? (((seat - half) / half) ** 2).toFixed(2) : 0;
  }

  function seatMarkup(seat) {
    const play = room.play;
    const player = room.seats[seat];
    const mine = seat === me();
    if (!player) {
      const canSit = me() < 0 && play.phase !== "playing";
      return `<div class="rbj-seat open" data-seat="${seat}" style="--lift:${lift(seat)}">
        <div class="rbj-open">
          ${canSit ? `<button type="button" class="rbj-sit" data-join="${seat}"><b>SIT DOWN</b><small>MIN ${api.money(play.minBet)} CR</small></button>` : `<span class="rbj-open-label">${play.phase === "playing" ? "JOIN NEXT ROUND" : "OPEN SEAT"}</span>`}
          ${isHost() && play.phase !== "playing" ? `<button type="button" class="rbj-bot" data-bot="${seat}">+ ADD BOT</button>` : ""}
        </div>
      </div>`;
    }
    const hands = play.hands[seat] || [];
    const turn = play.turn?.seat === seat;
    const showResults = play.phase === "result" && now() >= resultsAt(play) - 50;
    const handsMarkup = hands
      .map((hand, handIndex) => {
        const active = turn && play.turn.hand === handIndex;
        const cards = hand.cards
          .map((value, index) => {
            const key = `${play.round}:${seat}:${handIndex}:${index}`;
            const at = index < 2 && !hand.split ? dealAt(play, seat, index) : now();
            return card(key, value, at);
          })
          .join("");
        const result = hand.result && (showResults || hand.result === "bust" || hand.result === "forfeit") ? hand.result : null;
        const payout = result && result !== "push" && hand.payout != null && showResults ? hand.payout - hand.bet : null;
        return `<div class="rbj-hand ${active ? "active" : ""} ${result ? `res-${result}` : ""}">
          <div class="rbj-cards">${cards}</div>
          <div class="rbj-hand-meta"><span class="rbj-total ${hand.total > 21 ? "bust" : ""}">${hand.natural ? "BJ" : `${hand.soft && hand.total <= 21 ? "soft " : ""}${hand.total}`}</span>${hand.doubled ? '<span class="rbj-tag">2×</span>' : ""}</div>
          ${result ? `<div class="rbj-result"><b>${RESULT_TEXT[result]}</b>${payout != null ? `<small>${payout > 0 ? "+" : payout < 0 ? "−" : ""}${api.money(Math.abs(payout))}</small>` : ""}</div>` : ""}
        </div>`;
      })
      .join("");
    const bet = play.phase === "betting" ? play.bets[seat] : hands.reduce((sum, hand) => sum + hand.bet, 0) || null;
    return `<div class="rbj-seat ${mine ? "mine" : ""} ${turn ? "turn" : ""}" data-seat="${seat}" style="--lift:${lift(seat)}">
      <div class="rbj-hands">${handsMarkup}</div>
      <div class="rbj-spot ${bet ? "has-bet" : ""}">${bet ? `<span class="rbj-chip" title="${api.money(bet)} CR">${short(bet)}</span>` : `<span class="rbj-spot-ring"></span>`}</div>
      <div class="rbj-player">
        <span class="rbj-ring ${turn ? "on" : ""}" ${turn ? `data-ends="${play.turnEndsAt}" data-span="${play.turnMs}"` : ""}>${api.avatar(player.look, player.name, 40)}</span>
        <span class="rbj-name">${api.name(player.look, player.name)}${player.bot ? "<em>BOT</em>" : ""}${mine ? "<em class='you'>YOU</em>" : ""}</span>
        ${isHost() && player.bot && play.phase !== "playing" ? `<button type="button" class="rbj-kick" data-kick="${seat}" title="Remove bot">×</button>` : ""}
      </div>
    </div>`;
  }

  function statusMarkup() {
    const play = room.play;
    if (play.phase === "betting") {
      if (!play.closesAt) return `<b>PLACE YOUR BETS</b><small>The deal starts ${room.seats.some((s) => s && !s.bot) ? "12 s after the first bet" : "when a player bets"}</small>`;
      return `<b>BETS CLOSE IN <span data-count="${play.closesAt}"></span></b><small>Round ${play.round}</small>`;
    }
    if (play.phase === "playing") {
      const seat = play.turn ? room.seats[play.turn.seat] : null;
      if (play.turn?.seat === me()) return `<b class="you">YOUR TURN</b><small>${room.play.hands[me()].length > 1 ? `Hand ${play.turn.hand + 1} of ${room.play.hands[me()].length}` : "Hit, stand, double or split"}</small>`;
      return `<b>${seat ? `${api.escape(seat.name).toUpperCase()} TO ACT` : "DEALING…"}</b><small>Round ${play.round}</small>`;
    }
    const done = now() >= resultsAt(play);
    return done ? `<b>NEXT ROUND IN <span data-count="${play.resultEndsAt}"></span></b><small>Dealer ${play.dealer.natural ? "has blackjack" : play.dealer.total > 21 ? "busts" : `stands on ${play.dealer.total}`}</small>` : `<b>DEALER PLAYS…</b><small>Round ${play.round}</small>`;
  }

  function controlsMarkup() {
    const play = room.play;
    if (!api.user()) return `<div class="rbj-note"><b>SIGN IN TO PLAY</b><button type="button" class="rbj-primary" data-signin>SIGN IN</button></div>`;
    if (me() < 0) {
      const open = room.seats.findIndex((seat) => !seat);
      if (open < 0) return `<div class="rbj-note"><b>TABLE FULL</b><span>Watching · a seat opens when someone leaves</span></div>`;
      return play.phase === "playing"
        ? `<div class="rbj-note"><b>WATCHING</b><span>Seats open again after this round</span></div>`
        : `<div class="rbj-note"><b>WATCHING</b><button type="button" class="rbj-primary big" data-join="${open}">TAKE A SEAT · MIN ${api.money(play.minBet)} CR</button></div>`;
    }
    if (play.phase === "betting") {
      const bet = play.bets[me()] || 0;
      const steps = CHIP_STEPS.map((step) => step * play.minBet).filter((amount) => amount <= play.maxBet);
      return `<div class="rbj-betting">
        <div class="rbj-bet-now"><small>YOUR BET</small><b>${bet ? `${api.money(bet)} CR` : "—"}</b></div>
        <div class="rbj-chips">${steps.map((amount, index) => `<button type="button" class="rbj-chip-btn c${index}" data-add="${amount}">${short(amount)}</button>`).join("")}</div>
        <div class="rbj-bet-tools">
          <button type="button" data-double-bet ${bet && bet * 2 <= play.maxBet ? "" : "disabled"}>2×</button>
          <button type="button" data-rebet ${!bet && lastBet ? "" : "disabled"}>REBET${lastBet ? ` ${api.money(lastBet)}` : ""}</button>
          <button type="button" data-clear ${bet ? "" : "disabled"}>CLEAR</button>
        </div>
      </div>`;
    }
    if (play.phase === "playing" && play.turn?.seat === me()) {
      const can = new Set(play.actions);
      const button = (type, label, key) => `<button type="button" class="rbj-move ${type}" data-move="${type}" ${can.has(type) ? "" : "disabled"}><b>${label}</b><kbd>${key}</kbd></button>`;
      return `<div class="rbj-moves">${button("hit", "HIT", "H")}${button("stand", "STAND", "S")}${button("double", "DOUBLE", "D")}${button("split", "SPLIT", "P")}<div class="rbj-turnbar" data-ends="${play.turnEndsAt}" data-span="${play.turnMs}"><i></i></div></div>`;
    }
    if (play.phase === "playing") {
      const hands = play.hands[me()] || [];
      return `<div class="rbj-note"><b>${hands.length ? "WAITING FOR YOUR TURN" : "SITTING OUT THIS ROUND"}</b><span>${hands.length ? "Your hand is in play" : "Bet during the next betting window"}</span></div>`;
    }
    const hands = play.hands[me()] || [];
    if (!hands.length || now() < resultsAt(play)) return `<div class="rbj-note"><b>${hands.length ? "DEALER PLAYS…" : "ROUND OVER"}</b><span>Next betting round soon</span></div>`;
    const wager = hands.reduce((sum, hand) => sum + hand.bet, 0);
    const net = hands.reduce((sum, hand) => sum + (hand.payout || 0), 0) - wager;
    return `<div class="rbj-note ${net > 0 ? "won" : net < 0 ? "lost" : ""}"><b>${net > 0 ? `YOU WIN +${api.money(net)} CR` : net < 0 ? `YOU LOSE −${api.money(-net)} CR` : "PUSH · BET RETURNED"}</b><span>Next round starts automatically</span></div>`;
  }

  function fairMarkup() {
    const play = room.play;
    if (play.phase === "result" && play.seed) {
      const stream = fairFloats(play.seed, "number-zero-room-blackjack", play.nonce, play.drawn).map(cardFromFloat);
      const shown = [...play.dealer.cards, ...play.hands.flat().flatMap((hand) => hand.cards)].sort((a, b) => a - b);
      const ok = sha256Hex(play.seed) === play.seedHash && JSON.stringify([...stream].sort((a, b) => a - b)) === JSON.stringify(shown);
      return `<span class="${ok ? "ok" : "bad"}">${ok ? "✓ FAIR" : "✕ CHECK FAILED"}</span><code title="Seed ${play.seed}">${play.seed.slice(0, 12)}…</code>`;
    }
    return play.seedHash ? `<span>COMMITTED</span><code title="SHA-256 of this round's seed: ${play.seedHash}">${play.seedHash.slice(0, 12)}…</code>` : "";
  }

  function render() {
    const play = room.play;
    const set = (selector, html, key) => {
      // Animation delays shift every frame; ignore them so in-flight cards are not rebuilt.
      const sig = html.replace(/(animation-delay|--flip-delay):-?\d+ms;?/g, "");
      if (sigs[key || selector] === sig) return;
      sigs[key || selector] = sig;
      find(selector).innerHTML = html;
    };
    set(".rbj-dealer-cards", dealerMarkup());
    set(".rbj-dealer-total", dealerTotal());
    const count = room.seats.length;
    const seats = find(".rbj-seats");
    seats.style.setProperty("--n", count);
    set(".rbj-seats", room.seats.map((_, seat) => seatMarkup(seat)).join(""));
    set(".rbj-status", statusMarkup());
    set(".rbj-controls", controlsMarkup());
    set(".rbj-fair", fairMarkup());
    const canLeave = me() >= 0;
    set(".rbj-leave", canLeave ? `<button type="button" data-leave>${play.phase === "playing" && (play.hands[me()] || []).length ? "LEAVE (FORFEIT)" : "LEAVE TABLE"}</button>` : `<button type="button" data-back>LOBBY</button>`);
    tickTimers();
  }

  function tickTimers() {
    const t = now();
    root.querySelectorAll("[data-ends]").forEach((element) => {
      const left = Math.max(0, Number(element.dataset.ends) - t);
      element.style.setProperty("--p", (left / Number(element.dataset.span)).toFixed(3));
      element.classList.toggle("low", left < 5000);
    });
    root.querySelectorAll("[data-count]").forEach((element) => {
      element.textContent = `${Math.max(0, Math.ceil((Number(element.dataset.count) - t) / 1000))}s`;
    });
  }

  function maybeToast() {
    const play = room.play;
    if (play.phase !== "result" || me() < 0 || toastedRound === play.round || now() < resultsAt(play)) return;
    const hands = play.hands[me()] || [];
    if (!hands.length) return;
    toastedRound = play.round;
    const wager = hands.reduce((sum, hand) => sum + hand.bet, 0);
    const net = hands.reduce((sum, hand) => sum + (hand.payout || 0), 0) - wager;
    if (net > 0) {
      api.toast(hands.some((hand) => hand.result === "blackjack") ? "Blackjack!" : "Hand won", "win", `+${api.money(net)} CR`);
      api.sound(880, 0.14, "triangle", 0.05);
      setTimeout(() => api.sound(1320, 0.16, "triangle", 0.05), 130);
    } else if (net < 0) api.sound(190, 0.22, "sawtooth", 0.03);
  }

  function frame() {
    if (!room) return;
    // Markup only changes when a scheduled moment passes (cards landing, results), so this is cheap.
    render();
    maybeToast();
  }
  timer = setInterval(frame, 200);

  async function bet(amount) {
    const play = room.play;
    const clamped = Math.max(play.minBet, Math.min(play.maxBet, Math.round(amount)));
    const next = await api.act({ type: "bet", amount: clamped });
    if (next) {
      lastBet = clamped;
      api.sound(520, 0.05, "triangle", 0.04);
    }
  }

  function move(type) {
    if (room?.play.phase !== "playing" || room.play.turn?.seat !== me() || !room.play.actions.includes(type)) return;
    api.sound(type === "hit" ? 640 : 420, 0.05, "triangle", 0.04);
    api.act({ type });
  }

  root.addEventListener("click", async (event) => {
    const target = event.target;
    const join = target.closest("[data-join]");
    if (join) api.join(Number(join.dataset.join));
    const bot = target.closest("[data-bot]");
    if (bot) api.bot(Number(bot.dataset.bot));
    const kick = target.closest("[data-kick]");
    if (kick) api.kick(Number(kick.dataset.kick));
    if (target.closest("[data-signin]")) api.requireSignIn();
    const add = target.closest("[data-add]");
    if (add) bet((room.play.bets[me()] || 0) + Number(add.dataset.add));
    if (target.closest("[data-double-bet]")) bet((room.play.bets[me()] || 0) * 2);
    if (target.closest("[data-rebet]") && lastBet) bet(lastBet);
    if (target.closest("[data-clear]")) api.act({ type: "clear" });
    const moveButton = target.closest("[data-move]");
    if (moveButton) move(moveButton.dataset.move);
    if (target.closest("[data-leave]")) {
      const forfeit = room.play.phase === "playing" && (room.play.hands[me()] || []).length;
      if (forfeit && !confirm("Leave now? Your bet on this hand is forfeited.")) return;
      const result = await api.leave();
      if (result && result.state === "closed") api.back();
    }
    if (target.closest("[data-back]")) api.back();
  });

  function onKey(event) {
    if (!root.isConnected || event.target.closest?.("input,textarea,select")) return;
    const type = { h: "hit", s: "stand", d: "double", p: "split" }[event.key.toLowerCase()];
    if (type) move(type);
  }
  document.addEventListener("keydown", onKey);

  return {
    update(next) {
      if (room && next.play.round !== room.play.round) {
        // Forget card keys of finished rounds.
        for (const key of appear.keys()) if (!key.startsWith(`${next.play.round}:`)) appear.delete(key);
      }
      const dealt = room && room.play.phase === "betting" && next.play.phase === "playing";
      room = next;
      if (dealt) api.sound(330, 0.06, "triangle", 0.035);
      render();
    },
    destroy() {
      clearInterval(timer);
      document.removeEventListener("keydown", onKey);
    },
  };
}

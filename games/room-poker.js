// Texas Hold'em table view: oval felt with seats around it (your seat always at the bottom), board and
// pots in the middle, FOLD / CHECK·CALL / RAISE controls with a sizing slider in the dock.
// New cards animate once (keyed by hand/seat/index); the revealed seed is replayed client-side.
import { fairFloats, sha256Hex } from "../casino-core.js";
import { cardFaceMarkup } from "./cards.js";

const BACK = `<div class="pc-face pc-back"><span class="pc-back-logo">N<em>//</em>Z</span></div>`;
const LAST = { "small blind": "SB", "big blind": "BB", fold: "FOLD", timeout: "TIMED OUT", check: "CHECK", call: "CALL", bet: "BET", raise: "RAISE", "all-in": "ALL-IN", wins: "WINS" };
const short = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 10_000 ? `${+(n / 1000).toFixed(1)}K` : `${+n.toFixed(2)}`);

/** Same Fisher–Yates as the server (backend/rooms/poker-hands.js). */
function shuffle(floats) {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = Math.min(i, Math.floor(floats[51 - i] * (i + 1)));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function mountRoom(root, api) {
  root.innerHTML = `
    <div class="pk">
      <section class="pk-table">
        <div class="pk-felt">
          <div class="pk-centre">
            <div class="pk-pots"></div>
            <div class="pk-board"></div>
            <div class="pk-label"></div>
          </div>
        </div>
        <div class="pk-seats"></div>
      </section>
      <footer class="pk-dock">
        <div class="pk-controls"></div>
        <div class="pk-side"><div class="pk-fair"></div><div class="pk-leave"></div></div>
      </footer>
    </div>`;

  const find = (selector) => root.querySelector(selector);
  let room = null;
  let sigs = {};
  let raiseTo = null;
  let raiseKey = "";
  let toastedHand = 0;
  const appear = new Map();
  let timer = 0;

  const me = () => room?.you ?? -1;
  const isHost = () => Boolean(api.user()) && String(api.user().id) === room.hostId;
  const now = () => api.serverNow();

  /** Position on the oval for seat `seat`; the viewer's seat is rotated to the bottom centre. */
  function place(seat) {
    const n = room.seats.length;
    const offset = me() >= 0 ? me() : 0;
    const k = (seat - offset + n) % n;
    const angle = Math.PI / 2 + (k * 2 * Math.PI) / n;
    const x = 50 + 43 * Math.cos(angle);
    const y = 50 + 39 * Math.sin(angle);
    return { x, y, top: y < 45, style: `left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;--tx:${((50 - x) * 0.5).toFixed(1)}cqw;--ty:${((50 - y) * 0.45).toFixed(1)}cqh` };
  }

  function card(key, value, { hidden = false, best = false, dim = false, order = 0 } = {}) {
    if (!appear.has(key)) appear.set(key, now() + order * 110);
    const delay = appear.get(key) - now();
    const animate = delay > -600 && !api.reducedMotion();
    return `<div class="pc-card ${animate ? "pk-deal" : ""} ${best ? "best" : ""} ${dim ? "dim" : ""}" style="${animate ? `animation-delay:${Math.round(delay)}ms` : ""}"><div class="pc-inner${hidden ? " pc-down" : ""}">${hidden || value == null ? "" : cardFaceMarkup(value)}${BACK}</div></div>`;
  }

  function seatMarkup(seat) {
    const play = room.play;
    const player = room.seats[seat];
    const { style, top } = place(seat);
    if (!player) {
      const canSit = me() < 0 && api.user();
      return `<div class="pk-seat open ${top ? "top" : ""}" style="${style}">
        ${canSit || !api.user() ? `<button type="button" class="pk-sit" data-join="${seat}"><b>SIT DOWN</b><small>BUY-IN ${api.money(play.buyIn)} CR</small></button>` : `<span class="pk-open-label">EMPTY</span>`}
        ${isHost() ? `<button type="button" class="pk-bot" data-bot="${seat}">+ ADD BOT</button>` : ""}
      </div>`;
    }
    const info = play.seats[seat];
    const turn = play.toAct === seat;
    const winner = play.phase === "done" && info.won > 0;
    const showdown = play.phase === "done" && play.street === "showdown";
    const best = new Set(info.hand?.best || []);
    const cards = info.cards
      ? `<div class="pk-hole ${info.folded ? "folded" : ""}">${info.cards.map((value, index) => card(`${play.handNo}:${seat}:${index}${value == null ? "" : `:${value}`}`, value, { hidden: value == null, best: showdown && best.has(value), dim: showdown && info.shown && !best.has(value), order: index * play.dealOrder.length + Math.max(0, play.dealOrder.indexOf(seat)) })).join("")}</div>`
      : "";
    const marker = play.button === seat ? `<i class="pk-dealer">D</i>` : "";
    const blind = play.phase !== "waiting" ? (play.sb === seat ? `<i class="pk-blind">SB</i>` : play.bb === seat ? `<i class="pk-blind bb">BB</i>` : "") : "";
    const last = info.last && LAST[info.last] ? `<span class="pk-last ${info.last.replace(/\s/g, "-")}">${LAST[info.last]}</span>` : "";
    return `<div class="pk-seat ${top ? "top" : ""} ${seat === me() ? "mine" : ""} ${turn ? "turn" : ""} ${info.folded ? "folded" : ""} ${winner ? "winner" : ""} ${info.sitOut ? "away" : ""}" style="${style}">
      ${cards}
      <div class="pk-plate">
        <span class="pk-timer ${turn ? "on" : ""}" ${turn ? `data-ends="${play.turnEndsAt}" data-span="${play.turnMs}"` : ""}>${api.avatar(player.look, player.name, 44)}</span>
        <span class="pk-who"><b>${api.name(player.look, player.name)}</b><small>${info.allIn ? "ALL-IN" : info.sitOut ? "SITTING OUT" : `${short(info.stack)} CR`}</small></span>
        ${marker}${blind}
        ${isHost() && player.bot ? `<button type="button" class="pk-kick" data-kick="${seat}" title="Remove bot">×</button>` : ""}
      </div>
      ${winner ? `<strong class="pk-won">+${short(info.won)}${info.hand ? ` · ${api.escape(info.hand.label)}` : ""}</strong>` : showdown && info.hand ? `<strong class="pk-showhand">${api.escape(info.hand.label)}</strong>` : last}
      ${info.bet > 0 ? `<span class="pk-bet"><i></i>${short(info.bet)}</span>` : ""}
    </div>`;
  }

  function centreMarkup() {
    const play = room.play;
    const slots = Array.from({ length: 5 }, (_, index) => {
      const value = play.board[index];
      if (value == null) return `<span class="pk-slot"></span>`;
      const winners = play.phase === "done" && play.street === "showdown" ? play.seats.filter((s) => s && s.won > 0 && s.hand).flatMap((s) => s.hand.best) : [];
      return card(`${play.handNo}:b:${index}:${value}`, value, { best: winners.includes(value), dim: winners.length > 0 && !winners.includes(value), order: index >= 3 ? 0 : index });
    }).join("");
    let pots = "";
    if (play.phase === "done" && play.pots.length) pots = play.pots.map((pot, index) => `<span class="pk-pot ${index ? "side" : ""}"><small>${index ? `SIDE POT ${index}` : "POT"}</small><b>${short(pot.amount)}</b></span>`).join("");
    else if (play.phase === "hand") pots = (play.pots.length ? play.pots : [{ amount: 0 }]).map((pot, index) => `<span class="pk-pot ${index ? "side" : ""}"><small>${index ? `SIDE POT ${index}` : "POT"}</small><b>${short(pot.amount)}</b></span>`).join("");
    let label = "";
    if (play.phase === "waiting") label = `<b>${room.seats.filter(Boolean).length < 2 ? "WAITING FOR PLAYERS" : "NEXT HAND SOON"}</b><small>BLINDS ${short(play.smallBlind)}/${short(play.bigBlind)} · BUY-IN ${short(play.buyIn)} CR</small>`;
    else if (play.phase === "hand") label = `<b>${(play.street || "").toUpperCase()}</b><small>HAND #${play.handNo}</small>`;
    else if (play.result?.voided) label = `<b>HAND VOID</b><small>Chips returned</small>`;
    else {
      const winners = play.seats.map((s, i) => (s && s.won > 0 ? room.seats[i]?.name : null)).filter(Boolean);
      label = `<b class="win">${winners.map((n) => api.escape(n).toUpperCase()).join(" & ")} ${winners.length > 1 ? "SPLIT" : "WINS"}</b><small>${play.result?.uncontested ? "Everyone else folded" : api.escape(play.pots[0]?.label || "")} · next hand <span data-count="${play.nextHandAt}"></span></small>`;
    }
    return { slots, pots, label };
  }

  function controlsMarkup() {
    const play = room.play;
    if (!api.user()) return `<div class="pk-note"><b>SIGN IN TO PLAY</b><button type="button" class="pk-primary" data-signin>SIGN IN</button></div>`;
    if (me() < 0) {
      const open = room.seats.findIndex((seat) => !seat);
      return open >= 0 ? `<div class="pk-note"><b>WATCHING</b><button type="button" class="pk-primary big" data-join="${open}">SIT DOWN · BUY-IN ${api.money(play.buyIn)} CR</button></div>` : `<div class="pk-note"><b>TABLE FULL</b><span>Watching</span></div>`;
    }
    const info = play.seats[me()];
    const you = play.you;
    if (you) {
      const key = `${play.handNo}:${play.street}:${you.currentBet}`;
      if (raiseKey !== key || raiseTo == null) {
        raiseKey = key;
        raiseTo = you.minRaiseTo;
      }
      raiseTo = Math.max(you.minRaiseTo, Math.min(you.maxRaiseTo, raiseTo));
      const pot = play.pot;
      const preset = (label, value) => `<button type="button" data-size="${Math.max(you.minRaiseTo, Math.min(you.maxRaiseTo, Math.round(value)))}">${label}</button>`;
      const allIn = raiseTo >= you.maxRaiseTo;
      return `<div class="pk-moves">
        <div class="pk-hand-now"><small>YOUR HAND</small><b>${api.escape(play.myHand || "")}</b></div>
        <button type="button" class="pk-move fold" data-move="fold"><b>FOLD</b></button>
        <button type="button" class="pk-move call" data-move="${you.canCheck ? "check" : "call"}"><b>${you.canCheck ? "CHECK" : you.toCall >= info.stack ? "CALL ALL-IN" : "CALL"}</b>${you.canCheck ? "" : `<small>${api.money(you.toCall)}</small>`}</button>
        ${you.canRaise ? `<div class="pk-raise">
          <div class="pk-presets">${preset("MIN", you.minRaiseTo)}${preset("½ POT", you.currentBet + (pot + you.toCall) / 2)}${preset("POT", you.currentBet + pot + you.toCall)}${preset("ALL-IN", you.maxRaiseTo)}</div>
          <input type="range" class="pk-slider" min="${you.minRaiseTo}" max="${you.maxRaiseTo}" step="1" value="${raiseTo}" aria-label="Raise to">
        </div>
        <button type="button" class="pk-move raise" data-move="raise"><!--r--><b>${allIn ? "ALL-IN" : you.currentBet === 0 ? "BET" : "RAISE TO"}</b><small class="pk-raise-amount">${api.money(raiseTo)}</small><!--/r--></button>` : ""}
        <div class="pk-turnbar" data-ends="${play.turnEndsAt}" data-span="${play.turnMs}"><i></i></div>
      </div>`;
    }
    const busted = info && info.stack <= 0 && !(play.phase === "hand" && info.inHand && !info.folded);
    const tools = `${busted ? `<button type="button" class="pk-primary" data-rebuy>REBUY · ${api.money(play.buyIn)} CR</button>` : ""}<button type="button" class="pk-ghost" data-sit="${info?.sitOut ? "sitin" : "sitout"}">${info?.sitOut ? "I'M BACK" : "SIT OUT NEXT HAND"}</button>`;
    if (play.phase === "hand" && info?.inHand && !info.folded) return `<div class="pk-note"><div class="pk-hand-now"><small>YOUR HAND</small><b>${api.escape(play.myHand || "")}</b></div><span>Waiting for ${api.escape(room.seats[play.toAct]?.name || "the dealer")}…</span>${tools}</div>`;
    if (play.phase === "done" && info?.won > 0) return `<div class="pk-note won"><b>YOU WIN +${api.money(info.won)} CR</b>${tools}</div>`;
    return `<div class="pk-note"><b>${play.phase === "hand" ? (info?.folded ? "FOLDED" : "NEXT HAND") : play.phase === "waiting" ? "WAITING FOR PLAYERS" : "HAND OVER"}</b><span>${info?.sitOut ? "You are sitting out" : play.phase === "waiting" ? "Hands deal when two or more players are seated" : "You'll be dealt in next hand"}</span>${tools}</div>`;
  }

  function fairMarkup() {
    const play = room.play;
    if (!play.seedHash) return "";
    if (!play.seed) return `<span>COMMITTED</span><code title="SHA-256 of this hand's seed: ${play.seedHash}">${play.seedHash.slice(0, 12)}…</code>`;
    const deck = shuffle(fairFloats(play.seed, "number-zero-room-poker", 0, 52));
    const m = play.dealOrder.length;
    let ok = sha256Hex(play.seed) === play.seedHash;
    play.dealOrder.forEach((seat, k) => {
      const cards = play.seats[seat]?.cards;
      if (cards && cards.every((c) => c != null) && (cards[0] !== deck[k] || cards[1] !== deck[k + m])) ok = false;
    });
    const boardAt = [2 * m + 1, 2 * m + 2, 2 * m + 3, 2 * m + 5, 2 * m + 7];
    play.board.forEach((value, index) => value !== deck[boardAt[index]] && (ok = false));
    return `<span class="${ok ? "ok" : "bad"}">${ok ? "✓ FAIR DECK" : "✕ CHECK FAILED"}</span><code title="Seed ${play.seed}">${play.seed.slice(0, 12)}…</code>`;
  }

  function render() {
    const play = room.play;
    const set = (selector, html) => {
      const sig = html.replace(/animation-delay:-?\d+ms/g, "").replace(/<!--r-->[\s\S]*?<!--\/r-->/g, "").replace(/ value="[\d.]+"/g, "");
      if (sigs[selector] === sig) return;
      sigs[selector] = sig;
      find(selector).innerHTML = html;
    };
    find(".pk-table").style.setProperty("--n", room.seats.length);
    set(".pk-seats", room.seats.map((_, seat) => seatMarkup(seat)).join(""));
    const centre = centreMarkup();
    set(".pk-board", centre.slots);
    set(".pk-pots", centre.pots);
    set(".pk-label", centre.label);
    set(".pk-controls", controlsMarkup());
    set(".pk-fair", fairMarkup());
    const info = me() >= 0 ? play.seats[me()] : null;
    set(".pk-leave", info ? `<button type="button" data-leave>CASH OUT ${short(info.stack)} CR</button>` : `<button type="button" data-back>LOBBY</button>`);
    tickTimers();
  }

  function tickTimers() {
    const t = now();
    root.querySelectorAll("[data-ends]").forEach((element) => {
      const left = Math.max(0, Number(element.dataset.ends) - t);
      element.style.setProperty("--p", (left / Number(element.dataset.span)).toFixed(3));
      element.classList.toggle("low", left < 6000);
    });
    root.querySelectorAll("[data-count]").forEach((element) => {
      element.textContent = `${Math.max(0, Math.ceil((Number(element.dataset.count) - t) / 1000))}s`;
    });
  }

  function maybeToast() {
    const play = room.play;
    if (play.phase !== "done" || me() < 0 || toastedHand === play.handNo) return;
    toastedHand = play.handNo;
    const info = play.seats[me()];
    if (info?.won > 0) {
      api.toast(info.hand ? `Won with ${info.hand.label}` : "Pot won", "win", `+${api.money(info.won)} CR`);
      api.sound(880, 0.14, "triangle", 0.05);
      setTimeout(() => api.sound(1320, 0.16, "triangle", 0.05), 130);
    }
  }

  timer = setInterval(() => room && render(), 250);

  function move(type) {
    const you = room?.play.you;
    if (!you) return;
    if (type === "raise" && !you.canRaise) return;
    if (type === "check" && !you.canCheck) type = "call";
    api.sound(type === "fold" ? 240 : 520, 0.05, "triangle", 0.04);
    api.act(type === "raise" ? (raiseTo >= you.maxRaiseTo ? { type: "allin" } : { type: "raise", amount: raiseTo }) : { type });
  }

  function setRaise(value) {
    raiseTo = Number(value);
    const label = find(".pk-raise-amount");
    if (label) label.textContent = api.money(raiseTo);
    const slider = find(".pk-slider");
    if (slider && Number(slider.value) !== raiseTo) slider.value = String(raiseTo);
    const button = find('[data-move="raise"] b');
    const you = room.play.you;
    if (button && you) button.textContent = raiseTo >= you.maxRaiseTo ? "ALL-IN" : you.currentBet === 0 ? "BET" : "RAISE TO";
  }

  root.addEventListener("input", (event) => {
    if (event.target.matches(".pk-slider")) setRaise(event.target.value);
  });

  root.addEventListener("click", async (event) => {
    const target = event.target;
    const join = target.closest("[data-join]");
    if (join) api.join(Number(join.dataset.join));
    const bot = target.closest("[data-bot]");
    if (bot) api.bot(Number(bot.dataset.bot));
    const kick = target.closest("[data-kick]");
    if (kick) api.kick(Number(kick.dataset.kick));
    if (target.closest("[data-signin]")) api.requireSignIn();
    const size = target.closest("[data-size]");
    if (size) setRaise(size.dataset.size);
    const moveButton = target.closest("[data-move]");
    if (moveButton) move(moveButton.dataset.move);
    if (target.closest("[data-rebuy]")) api.act({ type: "rebuy" });
    const sit = target.closest("[data-sit]");
    if (sit) api.act({ type: sit.dataset.sit });
    if (target.closest("[data-leave]")) {
      const info = room.play.seats[me()];
      if (room.play.phase === "hand" && info?.inHand && !info.folded && !confirm("Leave now? You fold this hand and cash out your remaining stack.")) return;
      const result = await api.leave();
      if (result && result.state === "closed") api.back();
    }
    if (target.closest("[data-back]")) api.back();
  });

  function onKey(event) {
    if (!root.isConnected || event.target.closest?.("input,textarea,select")) return;
    const type = { f: "fold", c: "check", r: "raise" }[event.key.toLowerCase()];
    if (type && room?.play.you) move(type);
  }
  document.addEventListener("keydown", onKey);

  return {
    update(next) {
      if (room && next.play.handNo !== room.play.handNo) for (const key of appear.keys()) if (!key.startsWith(`${next.play.handNo}:`)) appear.delete(key);
      const myTurn = next.play.you && !room?.play.you;
      room = next;
      if (myTurn) api.sound(660, 0.08, "triangle", 0.05);
      render();
      maybeToast();
    },
    destroy() {
      clearInterval(timer);
      document.removeEventListener("keydown", onKey);
    },
  };
}

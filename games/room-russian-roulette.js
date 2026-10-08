// Russian roulette room view: players sit around a revolver. The cylinder turns one chamber per pull
// (a full spin when someone uses their spin), a click passes the turn, a bang ends the game and the
// survivors split the pot. Every pull is animated once, at the server time it happened.
import { fairFloats, sha256Hex } from "../casino-core.js";

const SPIN_MS = 2_000;
const CLICK_MS = 700;

function cylinderSvg() {
  const chambers = Array.from({ length: 6 }, (_, i) => {
    const a = (i * 60 - 90) * (Math.PI / 180);
    return `<circle class="rr-chamber" cx="${(50 + 27 * Math.cos(a)).toFixed(2)}" cy="${(50 + 27 * Math.sin(a)).toFixed(2)}" r="10.5"/>`;
  }).join("");
  const flutes = Array.from({ length: 6 }, (_, i) => {
    const a = (i * 60 - 60) * (Math.PI / 180);
    return `<circle class="rr-flute" cx="${(50 + 47 * Math.cos(a)).toFixed(2)}" cy="${(50 + 47 * Math.sin(a)).toFixed(2)}" r="7"/>`;
  }).join("");
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="rr-steel" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#d5dbe8"/><stop offset=".45" stop-color="#7c869c"/><stop offset="1" stop-color="#2a3040"/></radialGradient></defs><g class="rr-drum"><circle cx="50" cy="50" r="46" fill="url(#rr-steel)"/>${flutes}<circle cx="50" cy="50" r="44" class="rr-rim"/>${chambers}<circle cx="50" cy="50" r="7" class="rr-pin"/></g></svg>`;
}

export function mountRoom(root, api) {
  root.innerHTML = `
    <div class="rr">
      <section class="rr-stage">
        <div class="rr-ring">
          <div class="rr-centre">
            <div class="rr-hammer" aria-hidden="true"></div>
            <div class="rr-cylinder">${cylinderSvg()}</div>
            <div class="rr-pop" aria-live="polite"></div>
            <div class="rr-pot"></div>
          </div>
          <div class="rr-seats"></div>
        </div>
        <aside class="rr-log"><header>TRIGGER LOG</header><ol></ol></aside>
      </section>
      <footer class="rr-dock">
        <div class="rr-controls"></div>
        <div class="rr-side"><div class="rr-fair"></div><div class="rr-leave"></div></div>
      </footer>
      <div class="rr-flash" aria-hidden="true"></div>
    </div>`;

  const find = (selector) => root.querySelector(selector);
  let room = null;
  let seen = -1; // history entries already animated (index of the last one)
  let angle = 0;
  let sigs = {};
  let timer = 0;
  const timeouts = new Set();

  const me = () => room?.you ?? -1;
  const isHost = () => Boolean(api.user()) && String(api.user().id) === room.hostId;
  const now = () => api.serverNow();
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timeouts.delete(id);
      fn();
    }, ms);
    timeouts.add(id);
  };
  const nameOf = (seat) => room.play.roster?.find((entry) => entry.seat === seat)?.name || room.seats[seat]?.name || "Player";
  /** The bullet is "revealed" to this client once the bang animation has played. */
  const bangShown = () => room.play.phase === "finished" && seen >= room.play.history.length - 1;

  function seatMarkup(seat) {
    const play = room.play;
    const player = room.seats[seat] || (play.roster && play.roster.find((entry) => entry.seat === seat));
    const n = room.seats.length;
    const style = `--a:${(seat * 360) / n - 90}deg`;
    if (!player) {
      const canSit = room.state === "waiting" && me() < 0;
      return `<div class="rr-seat open" style="${style}">
        ${canSit ? `<button type="button" class="rr-sit" data-join="${seat}"><b>TAKE SEAT</b><small>${api.money(play.stake)} CR</small></button>` : `<span class="rr-open-label">OPEN</span>`}
        ${isHost() && room.state === "waiting" ? `<button type="button" class="rr-bot" data-bot="${seat}">+ BOT</button>` : ""}
      </div>`;
    }
    const turn = play.phase === "playing" && play.turnSeat === seat;
    const shot = bangShown() && play.shotSeat === seat;
    const survived = bangShown() && play.shotSeat !== seat && play.players?.includes(seat);
    const payout = survived && play.payouts ? play.payouts[seat] : null;
    const pulls = play.history.filter((entry) => entry.seat === seat).length;
    const spun = play.spinsUsed.includes(seat);
    return `<div class="rr-seat ${turn ? "turn" : ""} ${shot ? "shot" : ""} ${survived ? "alive" : ""} ${seat === me() ? "mine" : ""}" style="${style}">
      <span class="rr-ring-timer ${turn ? "on" : ""}" ${turn ? `data-ends="${play.turnEndsAt}" data-span="${play.turnMs}"` : ""}>${api.avatar(player.look, player.name, 52)}</span>
      <b class="rr-name">${api.name(player.look, player.name)}</b>
      <small class="rr-meta">${player.bot ? "BOT · " : ""}${seat === me() ? "YOU · " : ""}${play.phase === "playing" || play.phase === "finished" ? `${pulls} PULL${pulls === 1 ? "" : "S"}${spun ? " · SPUN" : ""}` : `${api.money(play.stake)} CR`}</small>
      ${shot ? `<strong class="rr-tag dead">BANG</strong>` : survived ? `<strong class="rr-tag win">+${api.money(payout)}</strong>` : ""}
      ${isHost() && room.state === "waiting" && player.bot ? `<button type="button" class="rr-kick" data-kick="${seat}" title="Remove bot">×</button>` : ""}
    </div>`;
  }

  function potMarkup() {
    const play = room.play;
    const status =
      play.phase === "waiting" ? `${room.seats.filter(Boolean).length}/${room.seats.length} SEATED`
      : play.phase === "countdown" ? `STARTS IN <span data-count="${play.startAt}"></span>`
      : play.phase === "playing" ? `CHAMBER ${Math.min(6, (play.pulls % 6) + 1)} · ${play.turnSeat === me() ? "YOUR TURN" : `${api.escape(nameOf(play.turnSeat)).toUpperCase()}`}`
      : bangShown() ? `${api.escape(nameOf(play.shotSeat)).toUpperCase()} IS OUT` : "…";
    return `<small>POT</small><b>${api.money(play.pot)} CR</b><span>${status}</span>`;
  }

  function logMarkup() {
    const play = room.play;
    if (!play.history.length) return `<li class="empty">${play.phase === "playing" ? "The cylinder is loaded…" : "One bullet, six chambers. Take turns pulling the trigger — the player it finds is out and the survivors split the pot. Everyone may spin the cylinder once."}</li>`;
    return play.history
      .slice(0, seen + 1)
      .map((entry, index) => `<li class="${entry.safe ? "" : "bang"}"><i>${index + 1}</i><b>${api.escape(nameOf(entry.seat))}</b><span>${entry.spun ? "SPUN · " : ""}${entry.safe ? "CLICK" : "BANG"}</span></li>`)
      .reverse()
      .join("");
  }

  function controlsMarkup() {
    const play = room.play;
    if (!api.user()) return `<div class="rr-note"><b>SIGN IN TO PLAY</b><button type="button" class="rr-primary" data-signin>SIGN IN</button></div>`;
    if (play.phase === "waiting" || play.phase === "countdown") {
      const open = room.seats.findIndex((seat) => !seat);
      if (me() < 0) return open >= 0 ? `<div class="rr-note"><b>${api.money(play.stake)} CR TO PLAY</b><button type="button" class="rr-primary big" data-join="${open}">TAKE A SEAT · ${api.money(play.stake)} CR</button></div>` : `<div class="rr-note"><b>TABLE FULL</b><span>Watching</span></div>`;
      const seated = room.seats.filter(Boolean).length;
      return `<div class="rr-note"><b>${play.phase === "countdown" ? "GET READY" : "WAITING FOR PLAYERS"}</b><span>${play.phase === "countdown" ? "The table is full — the cylinder loads in a moment" : `Starts automatically when all ${room.seats.length} seats are full${isHost() ? " — or start now" : ""}`}</span>${isHost() && play.phase === "waiting" && seated >= 2 ? `<button type="button" class="rr-primary" data-start>START WITH ${seated}</button>` : ""}</div>`;
    }
    if (play.phase === "playing") {
      if (play.turnSeat === me()) {
        const ready = now() >= play.turnAt;
        return `<div class="rr-moves">
          <button type="button" class="rr-pull" data-pull ${ready ? "" : "disabled"}><b>PULL THE TRIGGER</b><kbd>SPACE</kbd></button>
          <button type="button" class="rr-spin" data-spin ${ready && play.canSpin ? "" : "disabled"}><b>SPIN &amp; PULL</b><small>${play.canSpin ? "ONCE PER GAME" : "SPIN USED"}</small></button>
          <div class="rr-turnbar" data-ends="${play.turnEndsAt}" data-span="${play.turnMs}"><i></i></div>
        </div>`;
      }
      return `<div class="rr-note"><b>${api.escape(nameOf(play.turnSeat)).toUpperCase()} HAS THE GUN</b><span>${me() >= 0 ? "Hold your breath" : "Watching"}</span></div>`;
    }
    if (!bangShown()) return `<div class="rr-note"><b>…</b></div>`;
    const mine = me() >= 0 && play.players?.includes(me());
    const won = mine && play.shotSeat !== me();
    return `<div class="rr-note ${won ? "won" : mine ? "lost" : ""}"><b>${!mine ? `${api.escape(nameOf(play.shotSeat)).toUpperCase()} TOOK THE BULLET` : won ? `YOU SURVIVED · +${api.money(play.payouts[me()])} CR` : "BANG — YOU'RE OUT"}</b><button type="button" class="rr-primary" data-again>NEW TABLE · ${api.money(play.stake)} CR</button></div>`;
  }

  function fairMarkup() {
    const play = room.play;
    if (!play.seedHash) return "";
    if (!play.seed || !bangShown()) return `<span>COMMITTED</span><code title="SHA-256 of the seed: ${play.seedHash}">${play.seedHash.slice(0, 12)}…</code>`;
    // Replay the game from the revealed seed: bullet, first shooter and every spin.
    const floats = fairFloats(play.seed, "number-zero-room-russian-roulette", 0, 8);
    const bullet = Math.min(5, Math.floor(floats[0] * 6));
    let seat = play.players[Math.min(play.players.length - 1, Math.floor(floats[1] * play.players.length))];
    let position = 0, spins = 0, ok = sha256Hex(play.seed) === play.seedHash;
    for (const entry of play.history) {
      if (entry.seat !== seat) ok = false;
      if (entry.spun) position = Math.min(5, Math.floor(floats[2 + spins++] * 6));
      if ((position === bullet) === entry.safe) ok = false;
      position = (position + 1) % 6;
      seat = play.players[(play.players.indexOf(seat) + 1) % play.players.length];
    }
    return `<span class="${ok ? "ok" : "bad"}">${ok ? `✓ FAIR · BULLET IN CHAMBER ${bullet + 1}` : "✕ CHECK FAILED"}</span><code title="Seed ${play.seed}">${play.seed.slice(0, 12)}…</code>`;
  }

  function render() {
    const play = room.play;
    const set = (selector, html) => {
      if (sigs[selector] === html) return;
      sigs[selector] = html;
      find(selector).innerHTML = html;
    };
    set(".rr-seats", room.seats.map((_, seat) => seatMarkup(seat)).join(""));
    set(".rr-pot", potMarkup());
    set(".rr-log ol", logMarkup());
    set(".rr-controls", controlsMarkup());
    set(".rr-fair", fairMarkup());
    const canLeave = me() >= 0 && room.state === "waiting";
    set(".rr-leave", canLeave ? `<button type="button" data-leave>${isHost() ? "CANCEL & REFUND" : "LEAVE & REFUND"}</button>` : `<button type="button" data-back>LOBBY</button>`);
    root.querySelector(".rr").dataset.phase = play.phase;
    tickTimers();
  }

  function tickTimers() {
    const t = now();
    root.querySelectorAll("[data-ends]").forEach((element) => {
      const left = Math.max(0, Number(element.dataset.ends) - t);
      element.style.setProperty("--p", (left / Number(element.dataset.span)).toFixed(3));
      element.classList.toggle("low", left < 4000);
    });
    root.querySelectorAll("[data-count]").forEach((element) => {
      element.textContent = `${Math.max(0, Math.ceil((Number(element.dataset.count) - t) / 1000))}s`;
    });
  }

  function pop(text, tone) {
    const element = find(".rr-pop");
    element.textContent = text;
    element.className = `rr-pop show ${tone}`;
    void element.offsetWidth;
    later(() => (element.className = "rr-pop"), tone === "bang" ? 2600 : 900);
  }

  /** Animates one pull: optional spin, hammer fall, then click or bang. */
  function animatePull(entry, index, late) {
    const drum = find(".rr-drum");
    const reduced = api.reducedMotion() || late;
    const spinTime = entry.spun ? (reduced ? 0 : SPIN_MS) : 0;
    angle += entry.spun ? 360 * 3 + 60 * (1 + ((index * 7) % 5)) : 60;
    drum.style.transition = reduced ? "none" : `transform ${entry.spun ? SPIN_MS : 260}ms cubic-bezier(${entry.spun ? ".15,.7,.25,1" : ".3,1.6,.5,1"})`;
    drum.style.transform = `rotate(${angle}deg)`;
    if (entry.spun && !reduced) {
      pop("SPIN!", "spin");
      for (let k = 0; k < 9; k++) later(() => api.sound(900 - k * 60, 0.02, "square", 0.02), k * k * 22);
    }
    later(() => {
      find(".rr-hammer").classList.remove("fire");
      void find(".rr-hammer").offsetWidth;
      find(".rr-hammer").classList.add("fire");
      seen = Math.max(seen, index);
      if (entry.safe) {
        pop("CLICK", "safe");
        api.sound(1400, 0.03, "square", 0.05);
        later(() => api.sound(700, 0.02, "square", 0.03), 40);
      } else {
        pop("BANG", "bang");
        const stage = root.querySelector(".rr");
        stage.classList.remove("banged");
        void stage.offsetWidth;
        stage.classList.add("banged");
        api.sound(90, 0.5, "sawtooth", 0.09);
        api.sound(60, 0.7, "square", 0.06);
        const play = room.play;
        if (me() >= 0 && play.players?.includes(me())) {
          if (play.shotSeat === me()) api.toast("Bang — you're out", "loss", `−${api.money(play.stake)} CR`);
          else api.toast("You survived", "win", `+${api.money(play.payouts?.[me()] || 0)} CR`);
        }
      }
      render();
    }, spinTime + (reduced ? 0 : 120));
  }

  function syncHistory(firstView) {
    const history = room.play.history;
    if (firstView) {
      // Opened mid-game or afterwards: show past pulls without replaying them.
      seen = history.length - 1;
      angle = history.reduce((sum, entry) => sum + (entry.spun ? 420 : 60), 0);
      const drum = find(".rr-drum");
      drum.style.transition = "none";
      drum.style.transform = `rotate(${angle}deg)`;
      if (room.play.phase === "finished") root.querySelector(".rr").classList.add("banged-static");
      return;
    }
    for (let index = seen + 1; index < history.length; index++) {
      if (history[index].animating) continue;
      history[index].animating = true;
      const age = now() - history[index].at;
      animatePull(history[index], index, age > (history[index].spun ? SPIN_MS : CLICK_MS) + 1500);
    }
  }

  timer = setInterval(() => room && (tickTimers(), render()), 250);

  function pull(spin) {
    const play = room?.play;
    if (!play || play.phase !== "playing" || play.turnSeat !== me() || now() < play.turnAt) return;
    if (spin && !play.canSpin) return;
    api.act({ type: "pull", spin });
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
    if (target.closest("[data-start]")) api.start();
    if (target.closest("[data-pull]")) pull(false);
    if (target.closest("[data-spin]")) pull(true);
    if (target.closest("[data-again]")) api.create("russian-roulette", { stake: room.play.stake, seats: room.seats.length }, room.visibility);
    if (target.closest("[data-leave]")) {
      const result = await api.leave();
      if (result && result.state === "closed") api.back();
    }
    if (target.closest("[data-back]")) api.back();
  });

  function onKey(event) {
    if (!root.isConnected || event.code !== "Space" || event.repeat || event.target.closest?.("input,textarea,select,button")) return;
    if (room?.play.phase === "playing" && room.play.turnSeat === me()) {
      event.preventDefault();
      pull(false);
    }
  }
  document.addEventListener("keydown", onKey);

  return {
    update(next) {
      const firstView = !room;
      // Keep animation flags on history entries we already know about.
      if (room) next.play.history.forEach((entry, index) => room.play.history[index]?.animating && (entry.animating = true));
      room = next;
      syncHistory(firstView);
      render();
    },
    destroy() {
      clearInterval(timer);
      for (const id of timeouts) clearTimeout(id);
      document.removeEventListener("keydown", onKey);
    },
  };
}

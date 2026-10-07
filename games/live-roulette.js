import { LIVE_ROULETTE_ORDER, LIVE_ROULETTE_PAYOUTS, liveRouletteColor, liveRouletteRoll, sha256Hex } from "../casino-core.js";

const COLORS = ["red", "green", "black"];
const REPEATS = 12;
const REST_LAP = 2;
const SPIN_LAP = 9;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Deterministic landing offset inside the tile (−0.36…0.36) so every client stops at the same spot. */
const jitter = (id) => ((parseInt(sha256Hex(String(id)).slice(0, 8), 16) / 0xffffffff) - 0.5) * 0.72;

export function mount(container, ctx) {
  container.innerHTML = `
    <section class="lr">
      <header class="lr-head">
        <div class="lr-status"><b class="lr-phase">CONNECTING</b><small class="lr-timer">Waiting for the table…</small><i class="lr-bar"><span></span></i></div>
        <div class="lr-stats"></div>
        <div class="lr-history" aria-label="Previous results"></div>
      </header>
      <div class="lr-wheel">
        <div class="lr-strip">${Array.from({ length: REPEATS }, () => LIVE_ROULETTE_ORDER.map((slot) => `<span class="lr-tile ${liveRouletteColor(slot)}"><b>${slot}</b></span>`).join("")).join("")}</div>
        <i class="lr-marker"></i>
        <div class="lr-result" hidden></div>
      </div>
      <div class="lr-bet-row">
        <label class="lr-amount-label">BET AMOUNT<span><input class="lr-amount" type="number" min="1" step="1" value="100"><b>CR</b></span></label>
        <div class="lr-quick">
          <button type="button" data-set="clear">CLEAR</button><button type="button" data-add="10">+10</button><button type="button" data-add="100">+100</button><button type="button" data-add="1000">+1K</button><button type="button" data-add="10000">+10K</button><button type="button" data-mul="0.5">½</button><button type="button" data-mul="2">2×</button><button type="button" data-set="max">MAX</button>
        </div>
      </div>
      <div class="lr-columns">
        ${COLORS.map((color) => `
          <section class="lr-col" data-color="${color}">
            <button type="button" class="lr-place" data-color="${color}"><span>${color.toUpperCase()}</span><b>WIN ${LIVE_ROULETTE_PAYOUTS[color]}×</b></button>
            <header><span class="lr-count">0 BETS</span><strong class="lr-total">0.00 CR</strong></header>
            <ol class="lr-list"></ol>
          </section>`).join("")}
      </div>
      <div class="lr-popover" hidden></div>
    </section>`;

  const find = (selector) => container.querySelector(selector);
  const strip = find(".lr-strip");
  let data = null;
  let me = [];
  let shown = false;
  let busy = false;
  let pollTimer = 0;
  let frame = 0;
  let animatedRound = null;
  let restSlot = 0;
  let lastPhase = null;

  function tileStep() {
    const tiles = strip.children;
    return tiles[1].getBoundingClientRect().left - tiles[0].getBoundingClientRect().left;
  }

  /** Moves the strip so tile `index` (+ fractional offset) sits under the centre marker. */
  function moveTo(index, offset, duration) {
    const step = tileStep();
    const width = find(".lr-wheel").clientWidth;
    const x = (index + 0.5 + offset) * step - width / 2;
    strip.style.transition = duration > 0 ? `transform ${duration}ms cubic-bezier(.1,.55,.12,1)` : "none";
    strip.style.transform = `translate3d(${-x}px,0,0)`;
  }

  const lapIndex = (lap, slot) => lap * LIVE_ROULETTE_ORDER.length + LIVE_ROULETTE_ORDER.indexOf(slot);

  function syncStrip(force = false) {
    if (!data) return;
    const remaining = data.spinEndsAt - ctx.serverNow();
    if (data.phase === "betting") {
      if (force || lastPhase !== "betting") moveTo(lapIndex(REST_LAP, restSlot), 0, 0);
      animatedRound = null;
      return;
    }
    if (animatedRound === data.roundId && !force) return;
    animatedRound = data.roundId;
    const target = lapIndex(SPIN_LAP, data.slot);
    const offset = jitter(data.roundId);
    if (data.phase === "spinning" && remaining > 350 && !ctx.reducedMotion()) {
      moveTo(lapIndex(REST_LAP, restSlot), 0, 0);
      void strip.offsetWidth;
      moveTo(target, offset, remaining - 120);
      ctx.sound(320, 0.05, "triangle", 0.03);
    } else moveTo(target, offset, 0);
    restSlot = data.slot;
  }

  function renderTimer() {
    if (!data) return;
    const now = ctx.serverNow();
    const bar = find(".lr-bar span");
    let label;
    if (data.phase === "betting") {
      const left = Math.max(0, data.bettingEndsAt - now);
      label = `Spinning in ${(left / 1000).toFixed(1)}s`;
      bar.style.width = `${Math.min(100, (left / 15000) * 100)}%`;
    } else if (data.phase === "spinning") {
      label = "No more bets";
      bar.style.width = "0%";
    } else {
      label = `Next round in ${(Math.max(0, data.nextAt - now) / 1000).toFixed(1)}s`;
      bar.style.width = "0%";
    }
    find(".lr-timer").textContent = label;
  }

  function render() {
    if (!data) return;
    const phaseLabel = { betting: "PLACE YOUR BETS", spinning: "ROLLING…", result: `${data.color?.toUpperCase()} ${data.slot} WINS` }[data.phase];
    const phase = find(".lr-phase");
    phase.textContent = phaseLabel;
    phase.className = `lr-phase ${data.phase === "result" ? `is-${data.color}` : ""}`;
    renderTimer();
    find(".lr-history").innerHTML = data.history.slice(0, 14).map((entry, index) => `<button type="button" class="${entry.color}" data-history="${index}" title="Verify round">${entry.slot}</button>`).join("");
    const recent = data.history.slice(0, 100);
    find(".lr-stats").innerHTML = `<span>LAST ${recent.length}</span>${COLORS.map((color) => `<b class="${color}">${recent.filter((entry) => entry.color === color).length}</b>`).join("")}`;
    const result = find(".lr-result");
    result.hidden = data.phase !== "result";
    if (data.phase === "result") {
      result.className = `lr-result ${data.color}`;
      result.innerHTML = `<b>${data.slot}</b><span>${data.color.toUpperCase()} · ${LIVE_ROULETTE_PAYOUTS[data.color]}×</span>`;
    }
    const meId = ctx.user()?.id;
    for (const color of COLORS) {
      const column = find(`.lr-col[data-color="${color}"]`);
      const bets = data.bets.filter((bet) => bet.color === color);
      column.classList.toggle("won", data.phase === "result" && data.color === color);
      column.classList.toggle("lost", data.phase === "result" && data.color !== color);
      column.querySelector(".lr-count").textContent = `${bets.length} BET${bets.length === 1 ? "" : "S"}`;
      const total = data.totals[color] || 0;
      column.querySelector(".lr-total").textContent = data.phase === "result" && data.color === color ? `+${ctx.money(total * LIVE_ROULETTE_PAYOUTS[color])} CR` : `${ctx.money(total)} CR`;
      column.querySelector(".lr-list").innerHTML = bets.map((bet) => `<li class="${bet.userId === String(meId) ? "mine" : ""}"><i>${escapeHtml(bet.name[0] || "?")}</i><span>${escapeHtml(bet.name)}</span><b>${bet.payout ? `+${ctx.money(bet.payout)}` : ctx.money(bet.bet)}</b></li>`).join("") || `<li class="empty">No bets yet</li>`;
      const mine = me.find((bet) => bet.color === color);
      const button = column.querySelector(".lr-place");
      button.disabled = busy || data.phase !== "betting";
      button.querySelector("span").textContent = mine ? `${color.toUpperCase()} · ${ctx.money(mine.bet)}` : color.toUpperCase();
    }
    if (lastPhase !== data.phase) {
      if (data.phase === "result") {
        const won = me.filter((bet) => bet.color === data.color).reduce((sum, bet) => sum + bet.payout, 0);
        if (won) {
          ctx.toast("Roulette win", "win", `+${ctx.money(won)} CR on ${data.color}`);
          ctx.sound(880, 0.14, "triangle", 0.05);
        } else ctx.sound(data.color === "green" ? 660 : 240, 0.12, "triangle", 0.035);
      }
    }
    syncStrip();
    lastPhase = data.phase;
  }

  function absorb(response) {
    data = response.roulette;
    me = response.me || [];
    if (lastPhase === null && data.history[0]) restSlot = data.history[0].slot;
    render();
  }

  async function poll() {
    try {
      absorb(await ctx.server("/live-roulette"));
    } catch (error) {
      find(".lr-phase").textContent = "OFFLINE";
      find(".lr-timer").textContent = error.message;
    }
  }

  function amount() {
    return Math.max(0, Math.round(Number(find(".lr-amount").value) * 100) / 100 || 0);
  }

  async function place(color) {
    if (busy || data?.phase !== "betting") return;
    if (!ctx.user()) return ctx.requireSignIn();
    const bet = amount();
    if (bet < 1) return ctx.toast("Minimum bet is 1 CR", "loss");
    busy = true;
    render();
    try {
      absorb(await ctx.server("/live-roulette/bet", { bet, color }));
      ctx.sound(520, 0.06, "square", 0.03);
    } catch (error) {
      ctx.toast(error.message, "loss");
    } finally {
      busy = false;
      render();
    }
  }

  function verify(index) {
    const entry = data.history[index];
    if (!entry?.seed) return;
    const hashOk = sha256Hex(entry.seed) === entry.seedHash;
    const slot = liveRouletteRoll(entry.seed, entry.roundId);
    const ok = hashOk && slot === entry.slot;
    const popover = find(".lr-popover");
    popover.hidden = false;
    popover.innerHTML = `<button type="button" data-close>×</button><strong class="${ok ? "ok" : "bad"}">${ok ? "✓ VERIFIED FAIR" : "✕ VERIFICATION FAILED"}</strong><span>ROUND<b>${escapeHtml(entry.roundId)}</b></span><span>SEED HASH<code>${escapeHtml(entry.seedHash)}</code></span><span>REVEALED SEED<code>${escapeHtml(entry.seed)}</code></span><span>RECOMPUTED<b>${slot} · ${liveRouletteColor(slot).toUpperCase()} ${slot === entry.slot ? "✓" : "✕"}</b></span>`;
  }

  container.addEventListener("click", (event) => {
    const place_ = event.target.closest(".lr-place");
    if (place_) place(place_.dataset.color);
    const input = find(".lr-amount");
    const add = event.target.closest("[data-add]");
    if (add) input.value = Math.round((amount() + Number(add.dataset.add)) * 100) / 100;
    const mul = event.target.closest("[data-mul]");
    if (mul) input.value = Math.max(1, Math.round(amount() * Number(mul.dataset.mul) * 100) / 100);
    const set = event.target.closest("[data-set]");
    if (set) input.value = set.dataset.set === "clear" ? "" : Math.floor((ctx.user()?.balance ?? 0) * 100) / 100 || "";
    const history = event.target.closest("[data-history]");
    if (history) verify(Number(history.dataset.history));
    if (event.target.closest("[data-close]")) find(".lr-popover").hidden = true;
  });

  const resize = new ResizeObserver(() => syncStrip(true));
  resize.observe(find(".lr-wheel"));

  function tick() {
    renderTimer();
    if (shown) frame = requestAnimationFrame(tick);
  }

  return {
    show() {
      shown = true;
      poll();
      clearInterval(pollTimer);
      pollTimer = setInterval(poll, 1000);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    },
    hide() {
      shown = false;
      clearInterval(pollTimer);
      cancelAnimationFrame(frame);
    },
  };
}

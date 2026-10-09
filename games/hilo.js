import { HILO_MAX_MULTIPLIER, HILO_MAX_SKIPS, cardInfo, hiloChance, hiloRank, hiloStep } from "../casino-core.js";
import { centerOf, createCard, dealCard, flipCard, wait } from "./cards.js";

const clampBet = (n) => Math.max(1, Math.min(10_000_000, Math.round(Number(n) * 100) / 100 || 1));
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

/** 4-decimal multipliers like the server, trimmed to at least 2 decimals ("1.0725", "2.00", "1.50"). */
function fmtX(n) {
  if (n >= 100) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toFixed(4).replace(/0{1,2}$/, "");
}

/** Total multiplier after one more correct guess (floored to 4 decimals like hiloAction). */
const nextTotal = (multiplier, chance) => Math.min(HILO_MAX_MULTIPLIER, Math.floor(multiplier * hiloStep(chance) * 10_000) / 10_000);

const miniCard = (index) => {
  const { rank, suit, red } = cardInfo(index);
  return `<div class="hl-trail-card${red ? " red" : ""}" aria-label="${rank} of ${suit}"><b>${rank}</b><i>${suit}</i></div>`;
};

const oddsCell = (rank, guess) => { const chance = hiloChance(rank, guess); return chance >= 1 ? "—" : `${fmtX(hiloStep(chance))}×`; };

const guessButton = (guess) => {
  const higher = guess === "higher";
  return `<button class="hl-guess hl-${guess}" type="button" data-guess="${guess}" aria-label="${higher ? "Higher or same" : "Lower or same"}">
    <i class="hl-arrow" aria-hidden="true">${higher ? "▲" : "▼"}</i>
    <strong>${higher ? "HIGHER" : "LOWER"}</strong><small>OR SAME</small>
    <b class="hl-chance">—</b>
    <span class="hl-step">—</span>
    <em class="hl-total">—</em>
    <kbd>${higher ? "↑ / H" : "↓ / L"}</kbd>
  </button>`;
};

export function mount(container, ctx) {
  let bet = 10, round = null, busy = false, visible = false, token = 0;
  container.innerHTML = `
    <section class="hl" aria-label="Hi-Lo">
      <div class="hl-table">
        <header class="hl-stats">
          <span><small>MULTIPLIER</small><b class="hl-mult">1.00×</b></span>
          <span><small>PAYOUT</small><b class="hl-pay">0.00 CR</b></span>
          <span><small>CORRECT</small><b class="hl-correct">0</b></span>
          <span><small>SKIPS LEFT</small><b class="hl-skipsleft">${HILO_MAX_SKIPS}</b></span>
        </header>
        <div class="hl-stage">
          ${guessButton("lower")}
          <div class="hl-center">
            <div class="hl-slot" aria-live="polite"></div>
            <div class="hl-burst" aria-hidden="true"></div>
            <p class="hl-msg" role="status">PLACE A BET · PRESS START</p>
          </div>
          ${guessButton("higher")}
          <div class="hl-deck" aria-hidden="true"><i></i><i></i><i></i><span>∞ DECK</span></div>
        </div>
        <div class="hl-trail-wrap">
          <div class="hl-trail-head"><span>CARD TRAIL</span><small>A LOW · K HIGH · TIES WIN</small></div>
          <div class="hl-trail"></div>
        </div>
      </div>
      <aside class="hl-panel">
        <div class="hl-heading"><span>HI-LO</span><i>PROVABLY FAIR</i></div>
        <div class="hl-odds" aria-label="Multiplier per correct guess"><div><span>CARD</span><span class="lo">▼ LOWER</span><span class="hi">▲ HIGHER</span></div>${RANKS.map((r, rank) => `<div data-rank="${rank}"><b>${r}</b><span class="lo">${oddsCell(rank, "lower")}</span><span class="hi">${oddsCell(rank, "higher")}</span></div>`).join("")}</div>
        <label class="hl-field"><span>BET AMOUNT</span>
          <div class="hl-betrow"><div class="hl-input"><input class="hl-bet" type="number" min="1" max="10000000" step="1" value="10"><b>CR</b></div><button type="button" data-scale=".5">½</button><button type="button" data-scale="2">2×</button></div>
        </label>
        <button class="hl-skip" type="button">SKIP CARD · <span class="hl-skipcount">${HILO_MAX_SKIPS}</span> LEFT <kbd>S</kbd></button>
        <button class="hl-main" type="button">START ROUND <kbd>SPACE</kbd></button>
        <p class="hl-hint">Guess the next card. Every correct call multiplies your bet — cash out whenever you like.</p>
      </aside>
    </section>`;

  const $ = (s) => container.querySelector(s);
  const slot = $(".hl-slot"), trail = $(".hl-trail"), mainButton = $(".hl-main"), skipButton = $(".hl-skip"), betInput = $(".hl-bet");
  const reduced = () => ctx.reducedMotion();
  const playing = () => round?.phase === "playing";
  const correctCount = () => round?.history.filter((h) => h.correct).length ?? 0;

  function message(text, tone = "") {
    const msg = $(".hl-msg");
    msg.textContent = text;
    msg.className = `hl-msg ${tone}`;
  }

  function renderTrail() {
    if (!round) { trail.innerHTML = `<p class="hl-trail-empty">Your cards will line up here.</p>`; return; }
    let running = 1;
    trail.innerHTML = round.cards.map((card, i) => {
      const step = i ? round.history[i - 1] : null;
      let cls = "start", mark = "START";
      if (step?.guess === "skip") { cls = "skip"; mark = "SKIP"; }
      else if (step?.correct) { running = step.multiplier; cls = "win"; mark = `${step.guess === "higher" ? "▲" : "▼"} ✓ ${fmtX(running)}×`; }
      else if (step) { cls = "loss"; mark = `${step.guess === "higher" ? "▲" : "▼"} ✗ BUST`; }
      const current = i === round.cards.length - 1 ? " is-current" : "";
      return `<div class="hl-trail-item ${cls}${current}" data-trail="${i}">${miniCard(card)}<b>${mark}</b></div>`;
    }).join("");
    requestAnimationFrame(() => { trail.scrollLeft = trail.scrollWidth; });
  }

  function renderGuesses() {
    const rank = playing() ? hiloRank(round.cards.at(-1)) : null;
    container.querySelectorAll("[data-guess]").forEach((button) => {
      const guess = button.dataset.guess;
      if (rank === null) {
        button.disabled = true;
        button.querySelector(".hl-chance").textContent = "—";
        button.querySelector(".hl-step").textContent = "×—";
        button.querySelector(".hl-total").textContent = "START A ROUND";
        return;
      }
      const chance = hiloChance(rank, guess);
      const sure = chance >= 1;
      button.disabled = busy || sure;
      button.querySelector(".hl-chance").textContent = `${(chance * 100).toFixed(2)}%`;
      if (sure) {
        button.querySelector(".hl-step").textContent = "CAN'T LOSE";
        button.querySelector(".hl-total").textContent = guess === "higher" ? "ACE IS LOWEST" : "KING IS HIGHEST";
      } else {
        const total = nextTotal(round.multiplier, chance);
        button.querySelector(".hl-step").textContent = `×${fmtX(hiloStep(chance))}`;
        button.querySelector(".hl-total").textContent = `→ ${fmtX(total)}× · ${ctx.money(round.bet * total)} CR`;
      }
    });
  }

  function render() {
    const open = playing();
    const multiplier = round?.multiplier ?? 1;
    const correct = correctCount();
    const skipsLeft = HILO_MAX_SKIPS - (round?.skips ?? 0);
    const payout = round ? (round.phase === "cashed" ? round.payout : round.phase === "busted" ? 0 : round.bet * multiplier) : 0;
    $(".hl-mult").textContent = `${fmtX(multiplier)}×`;
    $(".hl-pay").textContent = `${ctx.money(payout)} CR`;
    $(".hl-correct").textContent = String(correct);
    $(".hl-skipsleft").textContent = open || round ? String(skipsLeft) : String(HILO_MAX_SKIPS);
    $(".hl-skipcount").textContent = String(open ? skipsLeft : HILO_MAX_SKIPS);
    skipButton.disabled = busy || !open || skipsLeft <= 0;
    if (open) {
      mainButton.innerHTML = correct ? `CASH OUT · ${ctx.money(round.bet * multiplier)} CR <kbd>C</kbd>` : `CASH OUT <small>AFTER A CORRECT GUESS</small>`;
      mainButton.disabled = busy || !correct;
      mainButton.classList.add("is-cash");
    } else {
      mainButton.innerHTML = `${round ? "NEW ROUND" : "START ROUND"} <kbd>SPACE</kbd>`;
      mainButton.disabled = busy || bet > ctx.balance();
      mainButton.classList.remove("is-cash");
    }
    betInput.disabled = open || busy;
    container.querySelectorAll("[data-scale]").forEach((b) => { b.disabled = open || busy; });
    const root = container.querySelector(".hl");
    root.dataset.phase = round?.phase ?? "idle";
    root.toggleAttribute("data-busy", busy);
    const current = open ? hiloRank(round.cards.at(-1)) : -1;
    container.querySelectorAll("[data-rank]").forEach((row) => row.classList.toggle("active", Number(row.dataset.rank) === current));
    renderGuesses();
  }

  function statusFor(r) {
    if (!r) return message("PLACE A BET · PRESS START");
    const rank = RANKS[hiloRank(r.cards.at(-1))];
    if (r.phase === "busted") return message(`BUST · −${ctx.money(r.bet)} CR`, "loss");
    if (r.phase === "cashed") return message(`CASHED OUT · +${ctx.money(r.payout)} CR · ${fmtX(r.multiplier)}×`, "win");
    const last = r.history.at(-1);
    if (last?.correct) return message(`CORRECT! ${rank} · HIGHER OR LOWER?`, "good");
    if (last?.guess === "skip") return message(`SKIPPED · ${rank} · HIGHER OR LOWER?`);
    return message(`${rank} · HIGHER OR LOWER?`);
  }

  function staticCard(index) {
    const card = createCard(index ?? null);
    slot.replaceChildren(card);
    return card;
  }

  function markCenter(r) {
    const card = slot.lastElementChild;
    if (!card) return;
    card.classList.toggle("hl-bust", r?.phase === "busted");
    card.classList.toggle("hl-cashed", r?.phase === "cashed");
  }

  /** Deals `index` face-down from the deck into the centre, retiring the previous card, then flips it. */
  async function dealCenter(index) {
    const old = slot.lastElementChild;
    const card = createCard(null);
    slot.append(card);
    if (old) {
      old.classList.add("hl-old");
      old.animate([{ transform: "none", opacity: 1 }, { transform: "translate(-36%, 18%) scale(.55) rotate(-8deg)", opacity: 0 }], { duration: reduced() ? 120 : 340, easing: "ease-in", fill: "forwards" }).finished.then(() => old.remove(), () => old.remove());
    }
    await dealCard(card, centerOf($(".hl-deck")), { reduced: reduced() });
    await flipCard(card, index, { reduced: reduced() });
    if (reduced()) await wait(120);
    return card;
  }

  function celebrate() {
    const burst = $(".hl-burst");
    burst.replaceChildren();
    const count = reduced() ? 6 : 22;
    for (let i = 0; i < count; i++) {
      const p = document.createElement("i");
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const distance = 70 + Math.random() * 90;
      p.style.setProperty("--x", `${Math.cos(angle) * distance}px`);
      p.style.setProperty("--y", `${Math.sin(angle) * distance}px`);
      p.style.setProperty("--c", ["#c7ff36", "#ffd43b", "#53e7ff", "#ff4fd8"][i % 4]);
      burst.append(p);
    }
    setTimeout(() => burst.replaceChildren(), 1200);
  }

  function feedback(r) {
    if (r.phase === "busted") {
      ctx.sound(70, 0.4, "sawtooth", 0.16);
      const card = slot.lastElementChild;
      if (card && !reduced()) card.animate([{ translate: "0" }, { translate: "-9px" }, { translate: "8px" }, { translate: "-5px" }, { translate: "0" }], { duration: 380 });
    } else if (r.phase === "cashed") {
      celebrate();
      ctx.sound(660, 0.14, "triangle", 0.08);
      setTimeout(() => ctx.sound(990, 0.24, "triangle", 0.08), 120);
    } else if (r.history.at(-1)?.correct) {
      ctx.sound(420 + correctCount() * 55, 0.12, "sine", 0.1);
    } else {
      ctx.sound(300, 0.06, "triangle", 0.05);
    }
  }

  async function start() {
    if (busy || playing()) return;
    if (bet > ctx.balance()) return ctx.toast("Insufficient balance", "loss");
    busy = true; render();
    const mine = ++token;
    let result = null;
    try {
      result = await ctx.request("/casino/hilo/start", { bet }, { reveal: true });
      if (mine !== token) return;
      $(".hl-burst").replaceChildren();
      slot.replaceChildren();
      round = { ...result.round, cards: [], history: [] };
      renderTrail();
      message("DEALING…");
      await dealCenter(result.round.cards[0]);
      if (mine !== token) return;
      round = result.round;
      ctx.sound(520, 0.08, "triangle", 0.06);
    } catch (e) {
      ctx.toast(e.message, "loss");
      if (e.code === "round_active") { busy = false; await resume(); return; }
    } finally {
      result?.reveal();
      if (mine === token) { busy = false; renderTrail(); statusFor(round); markCenter(round); render(); }
    }
  }

  async function act(action) {
    if (busy || !playing()) return;
    if (action === "cashout" && !correctCount()) return;
    if (action === "skip" && round.skips >= HILO_MAX_SKIPS) return;
    if ((action === "higher" || action === "lower") && hiloChance(hiloRank(round.cards.at(-1)), action) >= 1) return;
    busy = true; render();
    const mine = ++token;
    let result = null;
    try {
      result = await ctx.request("/casino/hilo/action", { action }, { reveal: true });
      if (mine !== token) return;
      const next = result.round;
      if (next.phase === "playing") result.reveal();
      if (action === "cashout") {
        round = next;
      } else {
        message(action === "skip" ? "SKIPPING…" : action === "higher" ? "HIGHER…" : "LOWER…");
        await dealCenter(next.cards.at(-1));
        if (mine !== token) return;
        round = next;
      }
      markCenter(round);
      feedback(round);
    } catch (e) {
      ctx.toast(e.message, "loss");
      if (["no_round", "illegal_action"].includes(e.code)) { busy = false; await resume(); return; }
    } finally {
      result?.reveal();
      if (mine === token) { busy = false; renderTrail(); statusFor(round); render(); }
    }
  }

  async function resume() {
    const mine = ++token;
    busy = false;
    try {
      const active = (await ctx.request("/casino/active")).hilo || null;
      if (mine !== token) return;
      // Keep a just-finished round on screen; otherwise show the open one (or the idle table).
      if (active || playing()) round = active;
    } catch (e) {
      if (mine !== token) return;
      round = null;
      if (e.code !== "unauthorized") ctx.toast(e.message, "loss");
    }
    $(".hl-burst").replaceChildren();
    staticCard(round ? round.cards.at(-1) : null);
    markCenter(round);
    renderTrail(); statusFor(round); render();
  }

  container.addEventListener("click", (e) => {
    const guess = e.target.closest("[data-guess]");
    if (guess && !guess.disabled) return act(guess.dataset.guess);
    const scale = e.target.closest("[data-scale]");
    if (scale && !scale.disabled) { bet = clampBet(bet * Number(scale.dataset.scale)); betInput.value = bet; render(); }
    if (e.target.closest(".hl-skip")) act("skip");
    if (e.target.closest(".hl-main")) playing() ? act("cashout") : start();
  });
  betInput.addEventListener("change", () => { bet = clampBet(betInput.value); betInput.value = bet; render(); });
  document.addEventListener("keydown", (e) => {
    if (!visible || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.("input,select,textarea,dialog")) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === "ArrowUp" || key === "h") { e.preventDefault(); act("higher"); }
    else if (key === "ArrowDown" || key === "l") { e.preventDefault(); act("lower"); }
    else if (key === "s") act("skip");
    else if (key === "c") act("cashout");
    else if (key === "Enter") { e.preventDefault(); playing() ? act("cashout") : start(); }
    else if (key === " ") { e.preventDefault(); if (!playing()) start(); }
  });
  ctx.onModeChange(() => { round = null; if (visible) resume(); else { token++; busy = false; } });
  staticCard(null); renderTrail(); render();
  return { show() { visible = true; resume(); }, hide() { visible = false; token++; busy = false; } };
}

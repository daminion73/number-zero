import { minesMultiplier } from "../casino-core.js";

const GEM_SVG = `<svg viewBox="0 0 80 80" aria-hidden="true"><defs><linearGradient id="mines-gem-fill" x2="1" y2="1"><stop stop-color="#d8fbff"/><stop offset=".38" stop-color="#53e7ff"/><stop offset="1" stop-color="#1769a2"/></linearGradient></defs><path fill="url(#mines-gem-fill)" d="M14 27 28 11h25l14 16-27 42z"/><path fill="#fff" opacity=".65" d="m28 11 12 16-26 0zm12 16 13-16 14 16zm0 0v42L14 27zm0 0 27 0-27 42z"/></svg>`;
const BOMB_SVG = `<svg viewBox="0 0 80 80" aria-hidden="true"><path class="mines-fuse" d="M51 22c2-10 12-8 13-17"/><path fill="#ffca3a" d="m65 3 3 7 8-1-6 6 4 7-8-4-6 6 1-9-8-3 9-2z"/><circle cx="39" cy="45" r="25" fill="#20283a"/><path fill="#3c4860" d="M20 38c4-13 17-20 30-16-14 3-22 11-25 25z"/><rect x="44" y="17" width="17" height="10" rx="4" transform="rotate(35 44 17)" fill="#7f899b"/><circle cx="32" cy="38" r="4" fill="#fff" opacity=".55"/></svg>`;

function clampBet(value) {
  return Math.min(10_000_000, Math.max(1, Number(value) || 1));
}

function chanceForNext(mines, gems) {
  return ((25 - mines - gems) / (25 - gems)) * 100;
}

function createParticles(tile, type) {
  const count = type === "mine" ? 18 : 10;
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < count; index += 1) {
    const particle = document.createElement("i");
    particle.className = `mines-particle mines-particle-${type}`;
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.3;
    const distance = 28 + Math.random() * (type === "mine" ? 58 : 30);
    particle.style.setProperty("--particle-x", `${Math.cos(angle) * distance}px`);
    particle.style.setProperty("--particle-y", `${Math.sin(angle) * distance}px`);
    particle.style.setProperty("--particle-rotate", `${Math.random() * 300}deg`);
    fragment.append(particle);
  }
  tile.append(fragment);
  window.setTimeout(() => tile.querySelectorAll(".mines-particle").forEach((item) => item.remove()), 850);
}

export function mount(container, ctx) {
  const tiles = Array.from({ length: 25 }, (_, index) => `
    <button class="mines-tile" type="button" data-tile="${index}" aria-label="Tile ${index + 1}">
      <span class="mines-tile-face"></span>
      <span class="mines-symbol mines-gem">${GEM_SVG}<i></i></span>
      <span class="mines-symbol mines-bomb">${BOMB_SVG}<i></i></span>
    </button>`).join("");

  container.innerHTML = `
    <section class="mines-game" aria-label="Mines">
      <aside class="mines-panel">
        <div class="mines-panel-heading"><span>MINES</span><i>PROVABLY FAIR</i></div>
        <label class="mines-field">BET AMOUNT
          <div class="mines-input-wrap"><input class="mines-bet" type="number" min="1" max="10000000" step="1" value="100"><b>CR</b></div>
        </label>
        <div class="mines-modifiers"><button data-bet-mod="0.5">½</button><button data-bet-mod="2">2×</button><button data-bet-max>MAX</button></div>
        <label class="mines-field mines-mine-field">NUMBER OF MINES <output class="mines-count">3</output>
          <input class="mines-slider" type="range" min="1" max="24" value="3">
        </label>
        <div class="mines-presets">${[1, 3, 5, 10, 24].map((value) => `<button data-mines="${value}">${value}</button>`).join("")}</div>
        <div class="mines-number-stepper"><button data-mines-step="-1">−</button><input class="mines-number" type="number" min="1" max="24" value="3"><button data-mines-step="1">+</button></div>
        <button class="mines-action" type="button">START GAME</button>
        <button class="mines-random" type="button">✦ PICK RANDOM TILE</button>
        <p class="mines-hint">Choose a tile. Every gem raises your payout.</p>
      </aside>
      <main class="mines-arena">
        <div class="mines-stats">
          <span><small>CURRENT MULTIPLIER</small><b class="mines-current">1.00×</b></span>
          <span><small>NEXT TILE</small><b class="mines-next">1.13×</b></span>
          <span><small>PROFIT ON CASH OUT</small><b class="mines-profit">0.00 CR</b></span>
          <span><small>GEMS LEFT</small><b class="mines-left">22</b></span>
          <span><small>NEXT PICK CHANCE</small><b class="mines-chance">88.00%</b></span>
        </div>
        <div class="mines-board-wrap">
          <div class="mines-board">${tiles}</div>
          <div class="mines-screen-flash"></div>
          <div class="mines-banner" aria-live="polite"></div>
        </div>
        <div class="mines-ladder-heading"><span>MULTIPLIER LADDER</span><small>SAFE PICKS →</small></div>
        <div class="mines-ladder"></div>
      </main>
    </section>`;

  const find = (selector) => container.querySelector(selector);
  const findAll = (selector) => [...container.querySelectorAll(selector)];
  const board = find(".mines-board");
  const slider = find(".mines-slider");
  const numberInput = find(".mines-number");
  const betInput = find(".mines-bet");
  let round = null;
  let busy = false;
  let shown = false;
  let displayedMultiplier = 1;
  let countAnimation = 0;

  function selectedMines() {
    return Math.min(24, Math.max(1, Number(slider.value) || 1));
  }

  function setMines(value) {
    const next = Math.min(24, Math.max(1, Math.round(Number(value) || 1)));
    slider.value = String(next);
    numberInput.value = String(next);
    find(".mines-count").value = String(next);
    render();
  }

  function animateMultiplier(target) {
    cancelAnimationFrame(countAnimation);
    if (ctx.reducedMotion()) {
      displayedMultiplier = target;
      return;
    }
    const from = displayedMultiplier;
    const started = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - started) / 340);
      displayedMultiplier = from + (target - from) * (1 - (1 - progress) ** 3);
      find(".mines-current").textContent = `${displayedMultiplier.toFixed(2)}×`;
      if (progress < 1) countAnimation = requestAnimationFrame(tick);
    };
    countAnimation = requestAnimationFrame(tick);
  }

  function renderLadder(mines, gems) {
    const safeTiles = 25 - mines;
    find(".mines-ladder").innerHTML = Array.from({ length: safeTiles }, (_, index) => {
      const step = index + 1;
      const state = step < gems ? "complete" : step === gems + 1 ? "current" : "";
      return `<span class="${state}" data-step="${step}"><small>${step} GEM${step === 1 ? "" : "S"}</small><b>${minesMultiplier(mines, step).toFixed(2)}×</b></span>`;
    }).join("");
    requestAnimationFrame(() => find(`.mines-ladder [data-step="${Math.min(safeTiles, gems + 1)}"]`)?.scrollIntoView({ behavior: ctx.reducedMotion() ? "auto" : "smooth", inline: "center", block: "nearest" }));
  }

  function render() {
    const mines = round?.mines ?? selectedMines();
    const gems = round?.revealed?.length ?? 0;
    const playing = round?.phase === "playing";
    const finished = round && !playing;
    const multiplier = round?.multiplier ?? 1;
    const next = playing ? round.next : minesMultiplier(mines, Math.min(25 - mines, gems + 1));
    const payout = round ? round.bet * multiplier : 0;

    find(".mines-current").textContent = `${displayedMultiplier.toFixed(2)}×`;
    find(".mines-next").textContent = next ? `${next.toFixed(2)}×` : "—";
    find(".mines-profit").textContent = `${ctx.money(Math.max(0, payout - (round?.bet ?? 0)))} CR`;
    find(".mines-left").textContent = String(Math.max(0, 25 - mines - gems));
    find(".mines-chance").textContent = gems < 25 - mines ? `${chanceForNext(mines, gems).toFixed(2)}%` : "—";
    find(".mines-action").textContent = playing
      ? gems > 0
        ? `CASH OUT · ${ctx.money(payout)} CR`
        : "REVEAL A GEM"
      : "START GAME";
    find(".mines-action").disabled = busy || (playing && gems === 0);
    find(".mines-random").disabled = busy || !playing;
    slider.disabled = playing;
    numberInput.disabled = playing;
    betInput.disabled = playing;
    findAll("[data-mines], [data-mines-step]").forEach((button) => { button.disabled = playing; });

    findAll(".mines-tile").forEach((tile) => {
      const index = Number(tile.dataset.tile);
      const revealed = round?.revealed?.includes(index);
      const mine = finished && round.layout?.includes(index);
      tile.className = "mines-tile";
      if (revealed) tile.classList.add("is-gem", "is-revealed");
      if (finished && !mine && !revealed) tile.classList.add("is-gem", "is-revealed", "is-dim");
      if (mine) tile.classList.add("is-mine", "is-revealed", index === round.hit ? "is-hit" : "is-dim");
      tile.disabled = busy || !playing || revealed;
    });

    const banner = find(".mines-banner");
    banner.className = `mines-banner ${round?.phase ?? ""}`;
    banner.innerHTML = round?.phase === "busted"
      ? `<strong>BOOM!</strong><span>MINE DETONATED · −${ctx.money(round.bet)} CR</span>`
      : round?.phase === "cashed"
        ? `<strong>SECURED</strong><span>+${ctx.money(round.payout)} CR · ${round.multiplier.toFixed(2)}×</span>`
        : "";
    renderLadder(mines, gems);
  }

  function celebrateTile(previousRound) {
    if (!round) return;
    if (round.phase === "busted") {
      const hit = find(`[data-tile="${round.hit}"]`);
      createParticles(hit, "mine");
      board.classList.add(ctx.reducedMotion() ? "mines-flash-only" : "mines-board-shake");
      window.setTimeout(() => board.classList.remove("mines-flash-only", "mines-board-shake"), 700);
      ctx.sound(62, 0.38, "sawtooth", 0.2);
      return;
    }
    const newlyRevealed = round.revealed?.find((tile) => !previousRound?.revealed?.includes(tile));
    if (newlyRevealed !== undefined) {
      createParticles(find(`[data-tile="${newlyRevealed}"]`), "gem");
      ctx.sound(410 + round.revealed.length * 72, 0.12, "sine", 0.11);
    }
    if (round.phase === "cashed") ctx.sound(920, 0.25, "sine", 0.12);
  }

  async function request(path, body) {
    if (busy) return;
    busy = true;
    render();
    const previousRound = round ? structuredClone(round) : null;
    try {
      round = (await ctx.request(path, body)).round;
      celebrateTile(previousRound);
      animateMultiplier(round?.multiplier ?? 1);
    } catch (error) {
      ctx.toast(error.message, "loss");
    } finally {
      busy = false;
      render();
    }
  }

  async function resume() {
    try {
      round = (await ctx.request("/casino/active")).mines;
      displayedMultiplier = round?.multiplier ?? 1;
      if (round) setMines(round.mines);
      render();
    } catch (error) {
      ctx.toast(error.message, "loss");
    }
  }

  container.addEventListener("click", (event) => {
    const tile = event.target.closest("[data-tile]");
    if (tile) return request("/casino/mines/reveal", { tile: Number(tile.dataset.tile) });
    const preset = event.target.closest("[data-mines]");
    if (preset) return setMines(preset.dataset.mines);
    const step = event.target.closest("[data-mines-step]");
    if (step) return setMines(selectedMines() + Number(step.dataset.minesStep));
    const modifier = event.target.closest("[data-bet-mod]");
    if (modifier) betInput.value = String(clampBet(clampBet(betInput.value) * Number(modifier.dataset.betMod)));
    if (event.target.closest("[data-bet-max]")) betInput.value = String(Math.max(1, Math.min(10_000_000, ctx.balance())));
  });
  slider.addEventListener("input", () => setMines(slider.value));
  numberInput.addEventListener("change", () => setMines(numberInput.value));
  find(".mines-action").addEventListener("click", () => {
    if (round?.phase === "playing") return request("/casino/mines/cashout", {});
    displayedMultiplier = 1;
    request("/casino/mines/start", { bet: clampBet(betInput.value), mines: selectedMines() });
  });
  find(".mines-random").addEventListener("click", () => {
    const available = findAll(".mines-tile:not(:disabled)");
    available[Math.floor(Math.random() * available.length)]?.click();
  });
  ctx.onModeChange(() => shown && resume());
  render();

  return {
    show() {
      shown = true;
      container.hidden = false;
      resume();
    },
    hide() {
      shown = false;
      container.hidden = true;
      cancelAnimationFrame(countAnimation);
    },
  };
}

// Originals hub: game switcher, DEMO/ONLINE routing, wallet, toasts and the provably-fair
// dialog. Game modules live in games/<id>.js and receive a shared `ctx` (see casino-contract).
import { createDemoEngine } from "./casino-demo.js";
import { cardInfo, sha256Hex, verifyRound } from "./casino-core.js";

const ICONS = {
  blackjack: `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="7" width="14" height="20" rx="2.5" transform="rotate(-12 12 17)"/><rect x="13" y="5" width="14" height="20" rx="2.5" transform="rotate(10 20 15)"/><path d="M20 11.5c-1.6 2.3-3.6 2.8-3.6 4.6a1.7 1.7 0 0 0 3 1.1l-.4 2h2l-.4-2a1.7 1.7 0 0 0 3-1.1c0-1.8-2-2.3-3.6-4.6Z" class="fill"/></svg>`,
  baccarat: `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="11" cy="16" r="7"/><circle cx="21" cy="16" r="7"/><path d="M16 11v10" /></svg>`,
  mines: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m16 4 5 6-5 18-5-18 5-6Z" class="fill"/><path d="M6 12h20M11 10l5 18 5-18"/></svg>`,
  crash: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 27c8-1 15-6 20-17"/><path d="m19 6 7-2-1 7" /><circle cx="24.5" cy="7.5" r="1.4" class="fill"/></svg>`,
};

const GAMES = [
  { id: "blackjack", name: "Blackjack", tagline: "3:2 · Multi-hand · Insurance" },
  { id: "baccarat", name: "Baccarat", tagline: "Punto Banco · Squeeze · Roads" },
  { id: "mines", name: "Mines", tagline: "5×5 grid · 1–24 mines" },
  { id: "crash", name: "Crash", tagline: "Solo rocket · Auto-bet" },
];

const TOAST_ICONS = { win: "▲", loss: "▼", info: "◆", achievement: "★" };

function formatMoney(value) {
  return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function loadStylesheet(path) {
  const href = new URL(path, import.meta.url).href;
  if (document.querySelector(`link[data-casino-css="${path}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.casinoCss = path;
  document.head.append(link);
}

function createToaster() {
  const stack = document.createElement("div");
  stack.className = "cz-toasts";
  stack.setAttribute("aria-live", "polite");
  document.body.append(stack);
  return function toast(text, tone = "info", detail = "") {
    const item = document.createElement("div");
    item.className = `cz-toast cz-toast-${tone}`;
    item.innerHTML = `<i>${TOAST_ICONS[tone] || TOAST_ICONS.info}</i><div><strong>${escapeHtml(text)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</div>`;
    stack.prepend(item);
    while (stack.children.length > 4) stack.lastElementChild.remove();
    window.setTimeout(() => item.classList.add("cz-toast-leaving"), tone === "achievement" ? 5200 : 3400);
    window.setTimeout(() => item.remove(), tone === "achievement" ? 5700 : 3900);
  };
}

export function initCasino({ originalsRoot, liveRoot, account, sound }) {
  loadStylesheet("casino.css");
  const demo = createDemoEngine();
  const reducedMotionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const toast = createToaster();
  const modules = new Map();
  const modeListeners = new Set();
  let playMode = account.getUser() ? "online" : "demo";
  let appMode = "home";
  let currentGame = "blackjack";
  let clockOffset = 0;
  let lastUserId = account.getUser()?.id ?? null;
  let walletShown = null;
  let walletAnimation = 0;
  let holdToken = 0;

  originalsRoot.classList.add("cz-root");
  originalsRoot.innerHTML = `
    <section class="cz-hub">
      <header class="cz-hub-head">
        <div class="cz-title">
          <p>NUMBER//ZERO ORIGINALS</p>
          <h1>In-house games. <em>Provably fair.</em></h1>
        </div>
        <div class="cz-controls">
          <div class="cz-mode" role="group" aria-label="Play mode">
            <button type="button" data-play-mode="demo">DEMO</button>
            <button type="button" data-play-mode="online">ONLINE</button>
          </div>
          <div class="cz-wallet" aria-live="polite">
            <small class="cz-wallet-label">BALANCE</small>
            <strong class="cz-wallet-value">—</strong>
          </div>
          <button type="button" class="cz-fair-button"><i></i>PROVABLY FAIR</button>
        </div>
      </header>
      <nav class="cz-tabs" aria-label="Originals">
        ${GAMES.map(
          (game) => `
          <button type="button" class="cz-tab" data-game="${game.id}">
            <span class="cz-tab-icon">${ICONS[game.id]}</span>
            <span class="cz-tab-copy"><strong>${game.name}</strong><small>${game.tagline}</small></span>
          </button>`,
        ).join("")}
      </nav>
      <div class="cz-stage">
        ${GAMES.map((game) => `<div class="cz-game" data-game-root="${game.id}" hidden></div>`).join("")}
      </div>
    </section>`;
  liveRoot.classList.add("cz-root", "cz-live-root");
  liveRoot.innerHTML = `<div class="cz-game" data-game-root="live-rocket" hidden></div>`;

  const fairDialog = document.createElement("dialog");
  fairDialog.className = "cz-fair-dialog";
  document.body.append(fairDialog);

  const $ = (selector) => originalsRoot.querySelector(selector);

  // ── Requests & clock ────────────────────────────────────────────────────────
  /**
   * Applies a server response. With `{ reveal: true }` the payout and achievement rewards stay
   * hidden from every wallet display until the game calls `result.reveal()` after its animation.
   */
  function absorb(result, { reveal = false } = {}) {
    if (!result || typeof result !== "object") return result;
    if (Number.isFinite(result.serverTime)) clockOffset = result.serverTime - Date.now();
    const achievements = result.achievements || [];
    const announce = () => {
      for (const achievement of achievements) {
        toast(`Achievement · ${achievement.name}`, "achievement", `+${formatMoney(achievement.reward)} CR added to your wallet`);
        sound(988, 0.12, "triangle", 0.06);
        window.setTimeout(() => sound(1319, 0.2, "triangle", 0.06), 120);
      }
    };
    if (!reveal) {
      if (result.user) account.setUser(result.user);
      announce();
      return result;
    }
    const settledPayout = result.round?.phase === "settled" ? result.round.payout || 0 : 0;
    const pending = settledPayout + achievements.reduce((sum, achievement) => sum + achievement.reward, 0);
    const token = pending > 0 ? ++holdToken : holdToken;
    if (result.user) {
      if (pending > 0) account.holdBalance(Math.round((result.user.balance - pending) * 100) / 100);
      account.setUser(result.user);
    }
    let revealed = false;
    const finish = () => {
      if (revealed) return;
      revealed = true;
      window.clearTimeout(safety);
      if (pending > 0 && token === holdToken) account.holdBalance(null);
      announce();
    };
    // Never leave the wallet pinned if an animation is interrupted.
    const safety = window.setTimeout(finish, 30_000);
    return { ...result, reveal: finish };
  }

  async function server(path, body, options) {
    return absorb(await account.api(path, body), options);
  }

  async function request(path, body, options) {
    if (playMode === "demo") {
      const result = await demo.request(path, body);
      return { ...result, serverTime: result.serverTime ?? Date.now(), reveal() {} };
    }
    if (!account.getUser()) {
      account.openAccount();
      throw Object.assign(new Error("Sign in to play online."), { code: "unauthorized" });
    }
    return server(path, body, options);
  }

  // ── Mode & wallet ───────────────────────────────────────────────────────────
  function renderMode() {
    originalsRoot.querySelectorAll("[data-play-mode]").forEach((button) => {
      const active = button.dataset.playMode === playMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    originalsRoot.dataset.playMode = playMode;
    renderWallet();
  }

  function setPlayMode(mode) {
    if (mode === playMode) return;
    if (mode === "online" && !account.getUser()) {
      account.openAccount();
      return;
    }
    playMode = mode;
    renderMode();
    modeListeners.forEach((listener) => listener(playMode));
  }

  function renderWallet() {
    const label = $(".cz-wallet-label");
    const value = $(".cz-wallet-value");
    if (playMode === "demo") {
      cancelAnimationFrame(walletAnimation);
      walletShown = null;
      label.textContent = "DEMO BALANCE";
      value.textContent = "∞ DEMO";
      return;
    }
    const target = account.displayBalance() ?? 0;
    label.textContent = "ONLINE BALANCE";
    if (walletShown === null || reducedMotionQuery.matches) {
      walletShown = target;
      value.textContent = `${formatMoney(target)} CR`;
      return;
    }
    const from = walletShown;
    const started = performance.now();
    cancelAnimationFrame(walletAnimation);
    value.classList.toggle("cz-wallet-up", target > from);
    value.classList.toggle("cz-wallet-down", target < from);
    const step = (time) => {
      const progress = Math.min(1, (time - started) / 650);
      walletShown = from + (target - from) * (1 - (1 - progress) ** 3);
      value.textContent = `${formatMoney(walletShown)} CR`;
      if (progress < 1) walletAnimation = requestAnimationFrame(step);
      else value.classList.remove("cz-wallet-up", "cz-wallet-down");
    };
    walletAnimation = requestAnimationFrame(step);
  }

  account.onUser((user) => {
    const userId = user?.id ?? null;
    if (userId !== lastUserId) {
      lastUserId = userId;
      const next = userId ? "online" : "demo";
      if (next !== playMode) {
        playMode = next;
        renderMode();
        modeListeners.forEach((listener) => listener(playMode));
        return;
      }
    }
    renderWallet();
  });

  // ── Modules ─────────────────────────────────────────────────────────────────
  const ctx = {
    mode: () => playMode,
    request,
    server,
    balance: () => (playMode === "demo" ? Infinity : account.getUser()?.balance ?? 0),
    money: formatMoney,
    sound: (...args) => sound(...args),
    reducedMotion: () => reducedMotionQuery.matches,
    toast,
    serverNow: () => Date.now() + (playMode === "demo" ? 0 : clockOffset),
    onModeChange(listener) {
      modeListeners.add(listener);
      return () => modeListeners.delete(listener);
    },
    requireSignIn: () => account.openAccount(),
    user: () => account.getUser(),
  };
  // Live rocket always talks to the server, so its clock must not depend on the demo switch.
  const liveCtx = { ...ctx, serverNow: () => Date.now() + clockOffset };

  function moduleRoot(id) {
    return (id === "live-rocket" ? liveRoot : originalsRoot).querySelector(`[data-game-root="${id}"]`);
  }

  function ensureModule(id) {
    if (modules.has(id)) return modules.get(id);
    const container = moduleRoot(id);
    container.innerHTML = `<div class="cz-loading"><i></i>LOADING ${id.replace("-", " ").toUpperCase()}…</div>`;
    loadStylesheet(`games/${id}.css`);
    const entry = { container, instance: null, ready: null, visible: false };
    entry.ready = import(new URL(`games/${id}.js`, import.meta.url).href)
      .then(async (module) => {
        container.innerHTML = "";
        entry.instance = await module.mount(container, id === "live-rocket" ? liveCtx : ctx);
        if (entry.visible) entry.instance.show();
        else entry.instance.hide();
        container.hidden = !entry.visible;
      })
      .catch((error) => {
        console.error(error);
        container.innerHTML = `<div class="cz-error"><strong>${escapeHtml(id.toUpperCase())} FAILED TO LOAD</strong><span>${escapeHtml(error.message)}</span><button type="button" data-retry="${id}">RETRY</button></div>`;
        modules.delete(id);
      });
    modules.set(id, entry);
    return entry;
  }

  function setVisible(id, visible) {
    const entry = visible ? ensureModule(id) : modules.get(id);
    if (!entry) return;
    if (entry.visible === visible) return;
    entry.visible = visible;
    entry.container.hidden = !visible;
    if (entry.instance) visible ? entry.instance.show() : entry.instance.hide();
  }

  function syncVisibility() {
    for (const game of GAMES) setVisible(game.id, appMode === "originals" && game.id === currentGame);
    setVisible("live-rocket", appMode === "live");
  }

  function openGame(id) {
    if (!GAMES.some((game) => game.id === id)) return;
    currentGame = id;
    originalsRoot.querySelectorAll(".cz-tab").forEach((tab) => {
      const active = tab.dataset.game === id;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    syncVisibility();
  }

  // ── Provably fair dialog ────────────────────────────────────────────────────
  async function openFairness() {
    fairDialog.innerHTML = `<div class="cz-fair-loading">Loading seeds…</div>`;
    fairDialog.showModal();
    try {
      renderFairness((await request("/fair")).fair);
    } catch (error) {
      fairDialog.innerHTML = `<button type="button" class="cz-dialog-close" aria-label="Close">×</button><p class="cz-fair-error">${escapeHtml(error.message)}</p>`;
    }
  }

  function renderFairness(fair) {
    const previous = fair.previous;
    fairDialog.innerHTML = `
      <button type="button" class="cz-dialog-close" aria-label="Close">×</button>
      <p class="cz-kicker">${playMode === "demo" ? "DEMO SEEDS" : "YOUR ONLINE SEEDS"}</p>
      <h2>Provably fair</h2>
      <p class="cz-fair-intro">Every result is <b>HMAC-SHA256(server seed, client seed : nonce : cursor)</b>. You see the server seed's SHA-256 hash before playing; rotating reveals the seed so you can replay every round.</p>
      <div class="cz-fair-grid">
        <label>ACTIVE SERVER SEED (HASHED)<output class="cz-mono">${escapeHtml(fair.serverSeedHash)}</output></label>
        <label>CLIENT SEED<input class="cz-client-seed" maxlength="64" value="${escapeHtml(fair.clientSeed)}" pattern="[A-Za-z0-9_-]{1,64}"></label>
        <label>NEXT NONCE<output class="cz-mono">${fair.nonce}</output></label>
      </div>
      <button type="button" class="cz-primary cz-rotate">ROTATE SEED PAIR</button>
      ${
        previous
          ? `<div class="cz-previous"><strong>PREVIOUS SEED PAIR · REVEALED</strong>
              <label>SERVER SEED<output class="cz-mono">${escapeHtml(previous.serverSeed)}</output></label>
              <label>SHA-256<output class="cz-mono" data-hash>${escapeHtml(previous.serverSeedHash)}</output></label>
              <span>Client seed <b>${escapeHtml(previous.clientSeed)}</b> · ${previous.nonce} rounds played</span>
            </div>`
          : ""
      }
      <form class="cz-verify">
        <strong>VERIFY A ROUND</strong>
        <div class="cz-verify-fields">
          <label>GAME<select name="game"><option value="blackjack">Blackjack</option><option value="baccarat">Baccarat</option><option value="mines">Mines</option><option value="crash">Crash</option></select></label>
          <label>SERVER SEED<input name="serverSeed" required value="${escapeHtml(previous?.serverSeed || "")}"></label>
          <label>CLIENT SEED<input name="clientSeed" required value="${escapeHtml(previous?.clientSeed || fair.clientSeed)}"></label>
          <label>NONCE<input name="nonce" type="number" min="0" required value="0"></label>
          <label>MINES<input name="mines" type="number" min="1" max="24" value="3"></label>
        </div>
        <button type="submit" class="cz-secondary">VERIFY</button>
        <output class="cz-verify-result"></output>
      </form>`;
  }

  function describeVerification(game, result) {
    if (game === "crash") return `Crash point <b>${result.crashPoint.toFixed(2)}×</b>`;
    if (game === "mines") return `Mines at tiles <b>${result.layout.map((tile) => tile + 1).join(", ")}</b>`;
    const cards = (list) => list.map((index) => `${cardInfo(index).rank}${cardInfo(index).suit}`).join(" ");
    if (game === "baccarat")
      return `Player <b>${cards(result.player)}</b> (${result.playerTotal}) · Banker <b>${cards(result.banker)}</b> (${result.bankerTotal}) · <b>${result.winner.toUpperCase()}</b>`;
    return `Card stream (deal order) <b>${cards(result.cards.slice(0, 10))}</b>`;
  }

  fairDialog.addEventListener("click", async (event) => {
    if (event.target === fairDialog || event.target.closest(".cz-dialog-close")) {
      fairDialog.close();
      return;
    }
    if (!event.target.closest(".cz-rotate")) return;
    const clientSeed = fairDialog.querySelector(".cz-client-seed").value.trim();
    try {
      const { fair } = await request("/fair/rotate", { clientSeed });
      renderFairness(fair);
      toast("Seed pair rotated", "info", "Previous server seed revealed below.");
    } catch (error) {
      toast(error.message, "loss");
    }
  });

  fairDialog.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const output = fairDialog.querySelector(".cz-verify-result");
    const game = form.get("game");
    const serverSeed = String(form.get("serverSeed")).trim();
    try {
      const result = verifyRound({
        game,
        serverSeed,
        clientSeed: String(form.get("clientSeed")).trim(),
        nonce: Number(form.get("nonce")),
        mines: Number(form.get("mines")),
      });
      const hash = sha256Hex(serverSeed);
      const knownHash = fairDialog.querySelector(".cz-previous [data-hash]")?.textContent;
      const matches = !knownHash || knownHash === hash;
      const hashCheck = knownHash ? (matches ? "✓ matches the committed hash" : "✗ does not match the committed hash") : "";
      output.innerHTML = `${describeVerification(game, result)}<small>SHA-256 ${hash.slice(0, 24)}… ${hashCheck}</small>`;
      output.dataset.ok = String(matches);
    } catch (error) {
      output.textContent = error.message;
      output.dataset.ok = "false";
    }
  });

  // ── Events ──────────────────────────────────────────────────────────────────
  originalsRoot.addEventListener("click", (event) => {
    const modeButton = event.target.closest("[data-play-mode]");
    if (modeButton) setPlayMode(modeButton.dataset.playMode);
    const tab = event.target.closest(".cz-tab");
    if (tab) {
      sound(520, 0.05, "triangle", 0.03);
      openGame(tab.dataset.game);
    }
    if (event.target.closest(".cz-fair-button")) openFairness();
    const retry = event.target.closest("[data-retry]");
    if (retry) syncVisibility();
  });

  renderMode();
  openGame(currentGame);

  return {
    setMode(mode) {
      appMode = mode;
      syncVisibility();
    },
    open(game) {
      openGame(game);
    },
  };
}

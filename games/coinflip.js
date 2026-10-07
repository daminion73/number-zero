import { coinflipResult, sha256Hex } from "../casino-core.js";

const FLIP_MS = 2600;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const coin = (side, extra = "") => `<span class="cf-coin ${extra}" data-side="${side}" aria-hidden="true"><i class="cf-face heads">H</i><i class="cf-face tails">T</i></span>`;

export function mount(container, ctx) {
  container.innerHTML = `
    <section class="cf">
      <aside class="cf-panel">
        <header><b>COINFLIP</b><small>PLAYER VS PLAYER · WINNER TAKES 2×</small></header>
        <label class="cf-amount-label">BET AMOUNT<span><input class="cf-amount" type="number" min="1" step="1" value="100"><b>CR</b></span></label>
        <div class="cf-quick"><button type="button" data-add="100">+100</button><button type="button" data-add="1000">+1K</button><button type="button" data-mul="0.5">½</button><button type="button" data-mul="2">2×</button></div>
        <div class="cf-sides" role="radiogroup" aria-label="Pick a side">
          <button type="button" data-side="heads" class="active" role="radio" aria-checked="true">${coin("heads", "small")}<b>HEADS</b></button>
          <button type="button" data-side="tails" role="radio" aria-checked="false">${coin("tails", "small")}<b>TAILS</b></button>
        </div>
        <button type="button" class="cf-create">CREATE FLIP</button>
        <p class="cf-note">Your stake is held until someone takes the other side. Call a house bot to flip instantly, or cancel for a full refund while it is open.</p>
        <div class="cf-record"></div>
      </aside>
      <main class="cf-main">
        <div class="cf-stage" hidden></div>
        <header class="cf-list-head"><span>OPEN FLIPS <b class="cf-open-count">0</b></span><span class="cf-hint">Seeds are committed when a flip is created · click a finished flip to verify</span></header>
        <div class="cf-list"></div>
      </main>
      <div class="cf-popover" hidden></div>
    </section>`;

  const find = (selector) => container.querySelector(selector);
  let flips = [];
  let side = "heads";
  let shown = false;
  let busy = false;
  let pollTimer = 0;
  let stageTimer = 0;
  let firstLoad = true;
  const seenFlipped = new Set();
  const myId = () => (ctx.user() ? String(ctx.user().id) : null);
  const involves = (flip) => myId() && (flip.creator.id === myId() || flip.joiner?.id === myId());
  const flipping = (flip) => flip.state === "flipped" && ctx.serverNow() - flip.flippedAt < FLIP_MS;

  function player(person, flip, role) {
    if (!person) return `<div class="cf-player empty"><i>?</i><span><b>Waiting…</b><small>${flip.creator.side === "heads" ? "TAILS" : "HEADS"} IS OPEN</small></span></div>`;
    const won = flip.state === "flipped" && !flipping(flip) && flip.winner === role;
    const lost = flip.state === "flipped" && !flipping(flip) && flip.winner !== role;
    return `<div class="cf-player ${won ? "won" : ""} ${lost ? "lost" : ""} ${person.id && person.id === myId() ? "mine" : ""}">${coin(person.side, "small")}<span><b>${escapeHtml(person.name)}${person.bot ? " <em>BOT</em>" : ""}</b><small>${person.side.toUpperCase()}${won ? ` · +${ctx.money(flip.bet * 2)} CR` : ""}</small></span></div>`;
  }

  function row(flip) {
    const mine = flip.creator.id === myId();
    const animating = flipping(flip);
    let actions = "";
    if (flip.state === "open") {
      actions = mine
        ? `<button type="button" data-act="bot" data-id="${flip.id}">CALL BOT</button><button type="button" class="ghost" data-act="cancel" data-id="${flip.id}">CANCEL</button>`
        : `<button type="button" class="join" data-act="join" data-id="${flip.id}">JOIN · ${ctx.money(flip.bet)} CR</button>`;
    } else actions = animating ? `<span class="cf-flipping">FLIPPING…</span>` : `<button type="button" class="ghost" data-verify="${flip.id}">VERIFY</button>`;
    const centre = flip.state === "open" ? `<b class="cf-vs">VS</b>` : coin(flip.result, `small ${animating ? "spin" : "landed"}`);
    return `<article class="cf-row ${flip.state} ${involves(flip) ? "involved" : ""}" data-flip="${flip.id}">
      ${player(flip.creator, flip, "creator")}
      <div class="cf-centre">${centre}</div>
      ${player(flip.joiner, flip, "joiner")}
      <div class="cf-pot"><small>${flip.state === "open" ? "STAKE" : "POT"}</small><strong>${ctx.money(flip.state === "open" ? flip.bet : flip.bet * 2)} CR</strong></div>
      <div class="cf-actions">${actions}</div>
    </article>`;
  }

  function renderRecord() {
    const id = myId();
    if (!id) {
      find(".cf-record").innerHTML = `<span>Sign in to create or join flips.</span>`;
      return;
    }
    const mine = flips.filter((flip) => flip.state === "flipped" && involves(flip) && !flipping(flip));
    const wins = mine.filter((flip) => (flip.winner === "creator" ? flip.creator.id : flip.joiner.id) === id);
    const net = mine.reduce((sum, flip) => sum + (wins.includes(flip) ? flip.bet : -flip.bet), 0);
    find(".cf-record").innerHTML = `<span>RECENT<b>${mine.length}</b></span><span>WON<b>${wins.length}</b></span><span>NET<b class="${net >= 0 ? "up" : "down"}">${net >= 0 ? "+" : "−"}${ctx.money(Math.abs(net))}</b></span>`;
  }

  function render() {
    const open = flips.filter((flip) => flip.state === "open");
    const done = flips.filter((flip) => flip.state === "flipped");
    find(".cf-open-count").textContent = String(open.length);
    find(".cf-list").innerHTML = flips.length
      ? `${open.map(row).join("")}${done.length ? `<h3>RECENT RESULTS</h3>${done.map(row).join("")}` : ""}`
      : `<div class="cf-empty">${coin("heads")}<b>No flips yet</b><span>Create the first one — anyone online can take the other side.</span></div>`;
    find(".cf-create").disabled = busy;
    renderRecord();
  }

  /** Big centre-stage flip for a coin the player is part of. */
  function stage(flip) {
    const el = find(".cf-stage");
    const elapsed = Math.max(0, ctx.serverNow() - flip.flippedAt);
    const remaining = ctx.reducedMotion() ? 0 : Math.max(0, FLIP_MS - elapsed);
    const winnerSide = flip.result;
    const winnerName = flip.winner === "creator" ? flip.creator.name : flip.joiner.name;
    const youWon = (flip.winner === "creator" ? flip.creator.id : flip.joiner?.id) === myId();
    el.hidden = false;
    el.className = "cf-stage";
    el.innerHTML = `<div class="cf-stage-side left">${player(flip.creator, { ...flip, state: "open" }, "creator")}</div>${coin(winnerSide, "big spin")}<div class="cf-stage-side right">${player(flip.joiner, { ...flip, state: "open" }, "joiner")}</div><p class="cf-stage-result"></p><button type="button" class="cf-stage-close" data-close-stage>×</button>`;
    const big = el.querySelector(".cf-coin.big");
    big.style.animationDuration = `${Math.max(1, remaining)}ms`;
    clearTimeout(stageTimer);
    stageTimer = setTimeout(() => {
      big.classList.remove("spin");
      big.classList.add("landed");
      el.classList.add(youWon ? "won" : "lost");
      el.querySelector(".cf-stage-result").innerHTML = `${winnerSide.toUpperCase()} · <b>${escapeHtml(winnerName)}</b> WINS ${ctx.money(flip.bet * 2)} CR`;
      if (youWon) {
        ctx.toast("Coinflip won", "win", `+${ctx.money(flip.bet * 2)} CR`);
        ctx.sound(880, 0.16, "triangle", 0.05);
      } else ctx.sound(200, 0.2, "sawtooth", 0.03);
      render();
      stageTimer = setTimeout(() => (el.hidden = true), 4200);
    }, remaining);
  }

  function absorb(list) {
    flips = list;
    for (const flip of flips) {
      if (flip.state !== "flipped" || seenFlipped.has(flip.id)) continue;
      seenFlipped.add(flip.id);
      if (!firstLoad && involves(flip) && flipping(flip)) stage(flip);
    }
    firstLoad = false;
    render();
  }

  async function poll() {
    try {
      absorb((await ctx.server("/coinflips")).flips);
    } catch (error) {
      find(".cf-list").innerHTML = `<div class="cf-empty"><b>OFFLINE</b><span>${escapeHtml(error.message)}</span></div>`;
    }
  }

  function amount() {
    return Math.max(0, Math.round(Number(find(".cf-amount").value) * 100) / 100 || 0);
  }

  async function run(task) {
    if (busy) return;
    if (!ctx.user()) return ctx.requireSignIn();
    busy = true;
    render();
    try {
      await task();
      await poll();
    } catch (error) {
      ctx.toast(error.message, "loss");
    } finally {
      busy = false;
      render();
    }
  }

  function verify(id) {
    const flip = flips.find((entry) => entry.id === id);
    if (!flip?.seed) return;
    const result = coinflipResult(flip.seed, flip.id);
    const ok = sha256Hex(flip.seed) === flip.seedHash && result === flip.result;
    const popover = find(".cf-popover");
    popover.hidden = false;
    popover.innerHTML = `<button type="button" data-close>×</button><strong class="${ok ? "ok" : "bad"}">${ok ? "✓ VERIFIED FAIR" : "✕ VERIFICATION FAILED"}</strong><span>FLIP<b>${escapeHtml(flip.id)}</b></span><span>SEED HASH (SHOWN WHEN CREATED)<code>${escapeHtml(flip.seedHash)}</code></span><span>REVEALED SEED<code>${escapeHtml(flip.seed)}</code></span><span>RECOMPUTED<b>${result.toUpperCase()} ${result === flip.result ? "✓" : "✕"}</b></span>`;
  }

  container.addEventListener("click", (event) => {
    const pick = event.target.closest(".cf-sides button[data-side]");
    if (pick) {
      side = pick.dataset.side;
      container.querySelectorAll(".cf-sides button[data-side]").forEach((button) => {
        button.classList.toggle("active", button === pick);
        button.setAttribute("aria-checked", String(button === pick));
      });
    }
    const input = find(".cf-amount");
    const add = event.target.closest("[data-add]");
    if (add) input.value = Math.round((amount() + Number(add.dataset.add)) * 100) / 100;
    const mul = event.target.closest("[data-mul]");
    if (mul) input.value = Math.max(1, Math.round(amount() * Number(mul.dataset.mul) * 100) / 100);
    if (event.target.closest(".cf-create")) {
      const bet = amount();
      if (bet < 1) ctx.toast("Minimum bet is 1 CR", "loss");
      else run(async () => {
        await ctx.server("/coinflips", { bet, side });
        ctx.sound(520, 0.06, "square", 0.03);
      });
    }
    const act = event.target.closest("[data-act]");
    if (act) run(() => ctx.server(`/coinflips/${act.dataset.id}/${act.dataset.act}`, {}));
    const verifyButton = event.target.closest("[data-verify]");
    if (verifyButton) verify(verifyButton.dataset.verify);
    if (event.target.closest("[data-close]")) find(".cf-popover").hidden = true;
    if (event.target.closest("[data-close-stage]")) find(".cf-stage").hidden = true;
  });

  return {
    show() {
      shown = true;
      poll();
      clearInterval(pollTimer);
      pollTimer = setInterval(() => shown && poll(), 1500);
    },
    hide() {
      shown = false;
      clearInterval(pollTimer);
    },
  };
}

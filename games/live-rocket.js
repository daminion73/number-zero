import { crashMultiplierAt, crashTimeFor, liveCrashPoint, sha256Hex } from "../casino-core.js";
import { createRocketChart } from "./crash.js";

const formatMultiplier = (value) => `${Number(value || 1).toFixed(2)}×`;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export function mount(container, ctx) {
  container.innerHTML = `
    <section class="live-game">
      <header class="live-header">
        <div><i></i><b>SERVER-WIDE · <span class="live-player-count">0</span> PLAYERS</b><small>ONE ROCKET. ONE GLOBAL ROUND.</small></div>
        <div class="live-history"></div>
      </header>
      <div class="live-layout">
        <main class="live-main">
          <div class="live-stage">
            <canvas></canvas>
            <div class="live-stage-flash"></div>
            <div class="live-value">1.00×<small>CONNECTING TO LAUNCH CONTROL</small></div>
            <div class="live-countdown"><span>NEXT LAUNCH IN <b>—</b></span><i></i></div>
          </div>
          <div class="live-controls">
            <label>BET AMOUNT<div><input class="live-bet" type="number" min="1" value="100"><b>CR</b></div></label>
            <label>AUTO CASH OUT<input class="live-auto" type="number" min="1.01" step="0.01" value="2.00"></label>
            <button class="live-action">BET</button>
          </div>
          <p class="live-round-label">WAITING FOR SERVER…</p>
        </main>
        <aside class="live-lobby">
          <div class="live-lobby-title"><span>LIVE BETS</span><i>● LIVE</i></div>
          <div class="live-totals"></div>
          <div class="live-bets"></div>
        </aside>
      </div>
      <div class="live-popover" hidden></div>
    </section>`;

  const find = (selector) => container.querySelector(selector);
  const chart = createRocketChart(find("canvas"));
  let response = null;
  let shown = false;
  let busy = false;
  let pollTimer = 0;
  let previousPhase = null;
  const cashedUsers = new Set();

  function currentMultiplier() {
    const live = response?.live;
    if (!live) return 1;
    return live.phase === "flying"
      ? crashMultiplierAt(ctx.serverNow() - live.startedAt)
      : live.crashPoint || live.multiplier || 1;
  }

  function chartState() {
    const live = response?.live;
    const multiplier = currentMultiplier();
    const elapsed = live?.phase === "crashed"
      ? crashTimeFor(live.crashPoint)
      : Math.max(0, ctx.serverNow() - (live?.startedAt || ctx.serverNow()));
    return { multiplier, elapsed, phase: live?.phase || "idle" };
  }

  function historyClass(value) {
    if (value >= 10) return "gold";
    if (value >= 2) return "cyan";
    return "low";
  }

  function renderHistory(live) {
    find(".live-history").innerHTML = live.history.map((round, index) => `
      <button class="${historyClass(round.crashPoint)}" data-history="${index}">
        ${formatMultiplier(round.crashPoint)}
      </button>`).join("");
  }

  function renderBets(live) {
    const meId = ctx.user()?.id;
    find(".live-bets").innerHTML = live.bets.map((bet) => {
      const cashed = Boolean(bet.cashedAt);
      const busted = live.phase === "crashed" && !cashed;
      const isNewCashout = cashed && !cashedUsers.has(bet.userId);
      if (cashed) cashedUsers.add(bet.userId);
      return `<div class="live-bet-row ${cashed ? "won" : busted ? "lost" : ""} ${isNewCashout ? "just-won" : ""} ${bet.userId === meId ? "mine" : ""}">
        <i>${escapeHtml(bet.name?.[0] || "?")}</i>
        <span><b>${escapeHtml(bet.name)}</b><small>${bet.autoCashout ? `AUTO @ ${formatMultiplier(bet.autoCashout)}` : "MANUAL"}</small></span>
        <strong>${ctx.money(bet.bet)} CR</strong>
        <em>${cashed ? `${formatMultiplier(bet.cashedAt)} · +${ctx.money(bet.payout)} CR` : busted ? "BUSTED" : "IN PLAY"}</em>
      </div>`;
    }).join("") || `<p class="live-empty">No bets yet. Be first aboard.</p>`;
  }

  function render() {
    if (!response?.live) return;
    const live = response.live;
    const multiplier = currentMultiplier();
    const me = response.me;
    const wagered = live.bets.reduce((sum, bet) => sum + bet.bet, 0);
    const paid = live.bets.reduce((sum, bet) => sum + (bet.payout || 0), 0);
    const status = live.phase === "betting" ? "ACCEPTING BETS" : live.phase === "flying" ? "ROCKET IN FLIGHT" : `CRASHED @ ${formatMultiplier(live.crashPoint)}`;
    find(".live-value").innerHTML = `${formatMultiplier(multiplier)}<small>${status}</small>`;
    find(".live-value").className = `live-value ${live.phase}`;
    const secondsLeft = Math.max(0, (live.bettingEndsAt - ctx.serverNow()) / 1000);
    const countdown = find(".live-countdown");
    countdown.hidden = live.phase !== "betting";
    countdown.querySelector("b").textContent = `${secondsLeft.toFixed(1)}s`;
    countdown.querySelector("i").style.width = `${Math.min(100, (secondsLeft / 7) * 100)}%`;
    find(".live-player-count").textContent = String(live.bets.length);
    find(".live-round-label").textContent = `ROUND ${live.roundId} · COMMIT ${live.seedHash.slice(0, 12)}…`;
    find(".live-totals").innerHTML = `<span>BETS<b>${live.bets.length}</b></span><span>WAGERED<b>${ctx.money(wagered)}</b></span><span>PAID<b>${ctx.money(paid)}</b></span>`;
    const action = find(".live-action");
    if (!me) action.textContent = live.phase === "betting" ? "BET" : "WAIT FOR NEXT ROUND";
    else if (me.cashedAt) action.textContent = `CASHED @ ${formatMultiplier(me.cashedAt)} · +${ctx.money(me.payout)} CR`;
    else if (live.phase === "flying") action.textContent = `CASH OUT @ ${formatMultiplier(multiplier)}`;
    else if (live.phase === "betting") action.textContent = "BET PLACED · WAITING FOR LAUNCH";
    else action.textContent = "BUSTED";
    action.disabled = busy || (!me && live.phase !== "betting") || (me && (Boolean(me.cashedAt) || live.phase !== "flying"));
    renderHistory(live);
    renderBets(live);

    if (previousPhase !== live.phase) {
      if (live.phase === "crashed") {
        find(".live-stage").classList.add("is-crashed");
        window.setTimeout(() => find(".live-stage").classList.remove("is-crashed"), 700);
        ctx.sound(65, 0.4, "sawtooth", 0.16);
      }
      if (live.phase === "betting") cashedUsers.clear();
      previousPhase = live.phase;
    }
  }

  async function poll() {
    try {
      response = await ctx.server("/live");
      render();
    } catch (error) {
      ctx.toast(error.message, "loss");
    }
  }

  async function act() {
    if (busy) return;
    if (!ctx.user()) return ctx.requireSignIn();
    busy = true;
    render();
    try {
      if (response?.me && response.live.phase === "flying") response = await ctx.server("/live/cashout", {});
      else response = await ctx.server("/live/bet", { bet: Number(find(".live-bet").value), autoCashout: Number(find(".live-auto").value) || null });
      render();
    } catch (error) {
      ctx.toast(error.message, "loss");
    } finally {
      busy = false;
      render();
    }
  }

  function inspectHistory(index) {
    const round = response.live.history[index];
    if (!round?.seed) return;
    const computedHash = sha256Hex(round.seed);
    const computedPoint = liveCrashPoint(round.seed, round.roundId);
    const verified = computedHash === round.seedHash && computedPoint === round.crashPoint;
    const popover = find(".live-popover");
    popover.hidden = false;
    popover.innerHTML = `<button data-close>×</button><strong class="${verified ? "verified" : "invalid"}">${verified ? "✓ VERIFIED FAIR" : "✕ VERIFICATION FAILED"}</strong><span>ROUND ID<b>${escapeHtml(round.roundId)}</b></span><span>SEED HASH<code>${escapeHtml(round.seedHash)}</code></span><span>REVEALED SEED<code>${escapeHtml(round.seed)}</code></span><span>RECOMPUTED RESULT<b>${formatMultiplier(computedPoint)} ${computedPoint === round.crashPoint ? "✓" : "✕"}</b></span>`;
  }

  find(".live-action").addEventListener("click", act);
  container.addEventListener("click", (event) => {
    const history = event.target.closest("[data-history]");
    if (history) inspectHistory(Number(history.dataset.history));
    if (event.target.closest("[data-close]")) find(".live-popover").hidden = true;
  });

  return {
    show() {
      shown = true;
      container.hidden = false;
      poll();
      window.clearInterval(pollTimer);
      pollTimer = window.setInterval(poll, 1000);
      chart.loop(chartState);
    },
    hide() {
      shown = false;
      container.hidden = true;
      window.clearInterval(pollTimer);
      chart.stop();
    },
  };
}

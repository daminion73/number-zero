import { CRASH_GROWTH, crashMultiplierAt, crashTimeFor } from "../casino-core.js";

const formatMultiplier = (value) => `${Number(value || 1).toFixed(2)}×`;
const NICE_MULTIPLIERS = [1, 1.2, 1.5, 2, 3, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

function roundedAxisMaximum(multiplier) {
  return NICE_MULTIPLIERS.find((value) => value >= multiplier * 1.16) || 10000;
}

function drawRocket(context, x, y, angle, phase, time) {
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  if (phase === "crashed") {
    for (let index = 0; index < 26; index += 1) {
      const direction = index * 2.4;
      const distance = 15 + ((time / 7 + index * 17) % 52);
      context.fillStyle = index % 3 ? "#ff6a3d" : "#ffd43b";
      context.globalAlpha = Math.max(0, 1 - distance / 72);
      context.fillRect(Math.cos(direction) * distance, Math.sin(direction) * distance, 4, 4);
    }
    context.globalAlpha = 1;
    context.strokeStyle = "#ff496c";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(0, 0, 20 + (time % 700) / 12, 0, Math.PI * 2);
    context.stroke();
    context.restore();
    return;
  }
  const flame = 14 + Math.sin(time / 45) * 5;
  context.shadowBlur = 20;
  context.shadowColor = "#ff7c35";
  context.fillStyle = "#ff7c35";
  context.beginPath();
  context.moveTo(-17, -5);
  context.lineTo(-17 - flame, 0);
  context.lineTo(-17, 5);
  context.fill();
  context.shadowColor = "#53e7ff";
  context.fillStyle = "#dffbff";
  context.beginPath();
  context.moveTo(22, 0);
  context.quadraticCurveTo(10, -13, -14, -9);
  context.lineTo(-14, 9);
  context.quadraticCurveTo(10, 13, 22, 0);
  context.fill();
  context.fillStyle = "#53e7ff";
  context.beginPath();
  context.arc(6, 0, 5, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ae70ff";
  context.beginPath();
  context.moveTo(-7, -8);
  context.lineTo(-17, -19);
  context.lineTo(-14, -5);
  context.moveTo(-7, 8);
  context.lineTo(-17, 19);
  context.lineTo(-14, 5);
  context.fill();
  context.restore();
}

export function createRocketChart(canvas) {
  const context = canvas.getContext("2d");
  const stars = Array.from({ length: 70 }, (_, index) => ({
    x: ((index * 83) % 997) / 997,
    y: ((index * 47) % 389) / 389,
    size: 0.5 + (index % 4) * 0.35,
    depth: 0.25 + (index % 5) * 0.15,
  }));
  const observer = new ResizeObserver(() => resize());
  let width = 1;
  let height = 1;
  let state = { multiplier: 1, phase: "idle", elapsed: 0, cashoutAt: null };
  let animationFrame = 0;
  let targetAxis = 2;
  let displayAxis = 2;

  function resize() {
    width = Math.max(1, canvas.clientWidth);
    height = Math.max(1, canvas.clientHeight);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function draw(nextState = state) {
    state = { ...state, ...nextState };
    resize();
    targetAxis = roundedAxisMaximum(state.multiplier);
    displayAxis += (targetAxis - displayAxis) * 0.06;
    if (Math.abs(targetAxis - displayAxis) < 0.01) displayAxis = targetAxis;
    context.clearRect(0, 0, width, height);
    const pad = { left: 52, right: 34, top: 28, bottom: 40 };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const duration = Math.max(4500, state.elapsed * 1.12, crashTimeFor(state.multiplier) * 1.12);
    const xFor = (milliseconds) => pad.left + (milliseconds / duration) * plotWidth;
    const yFor = (multiplier) => pad.top + plotHeight * (1 - (multiplier - 1) / (displayAxis - 1));
    const time = performance.now();

    stars.forEach((star) => {
      const drift = ((state.elapsed / 40000) * star.depth) % 1;
      context.globalAlpha = 0.2 + star.depth * 0.5;
      context.fillStyle = star.depth > 0.7 ? "#53e7ff" : "#fff";
      context.beginPath();
      context.arc(((star.x - drift + 1) % 1) * width, star.y * height, star.size, 0, Math.PI * 2);
      context.fill();
    });
    context.globalAlpha = 1;
    context.font = '10px "DM Mono"';
    context.textBaseline = "middle";
    const yTicks = NICE_MULTIPLIERS.filter((value) => value <= displayAxis * 1.001);
    const step = Math.max(1, Math.ceil(yTicks.length / 6));
    yTicks.filter((_, index) => index % step === 0 || _ === 1).forEach((tick) => {
      const y = yFor(tick);
      context.strokeStyle = "#27314799";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(pad.left, y);
      context.lineTo(width - pad.right, y);
      context.stroke();
      context.fillStyle = "#758096";
      context.fillText(formatMultiplier(tick), 7, y);
    });
    const seconds = duration / 1000;
    const tickSeconds = seconds > 20 ? 5 : seconds > 10 ? 2 : 1;
    for (let second = 0; second <= seconds; second += tickSeconds) {
      const x = xFor(second * 1000);
      context.fillStyle = "#667187";
      context.fillText(`${second}s`, x - 7, height - 16);
    }

    const maxElapsed = Math.max(0, Math.min(state.elapsed, crashTimeFor(state.multiplier)));
    const samples = Math.max(12, Math.min(180, Math.round(plotWidth / 5)));
    context.beginPath();
    context.moveTo(xFor(0), yFor(1));
    for (let index = 1; index <= samples; index += 1) {
      const elapsed = (maxElapsed * index) / samples;
      context.lineTo(xFor(elapsed), yFor(crashMultiplierAt(elapsed)));
    }
    const tipX = xFor(maxElapsed);
    const tipY = yFor(state.multiplier);
    context.lineTo(tipX, height - pad.bottom);
    context.lineTo(pad.left, height - pad.bottom);
    const fill = context.createLinearGradient(0, pad.top, 0, height - pad.bottom);
    fill.addColorStop(0, state.phase === "crashed" ? "#ff496c55" : "#53e7ff52");
    fill.addColorStop(1, "#53e7ff03");
    context.fillStyle = fill;
    context.fill();
    context.beginPath();
    for (let index = 0; index <= samples; index += 1) {
      const elapsed = (maxElapsed * index) / samples;
      const x = xFor(elapsed);
      const y = yFor(crashMultiplierAt(elapsed));
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = state.phase === "crashed" ? "#ff496c" : "#53e7ff";
    context.lineWidth = 4;
    context.shadowBlur = 17;
    context.shadowColor = context.strokeStyle;
    context.stroke();
    context.shadowBlur = 0;

    if (state.cashoutAt) {
      const markerTime = crashTimeFor(state.cashoutAt);
      const markerX = xFor(markerTime);
      const markerY = yFor(state.cashoutAt);
      context.strokeStyle = "#c7ff36";
      context.setLineDash([4, 4]);
      context.beginPath();
      context.moveTo(markerX, markerY);
      context.lineTo(markerX, height - pad.bottom);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = "#c7ff36";
      context.fillText(`CASHED ${formatMultiplier(state.cashoutAt)}`, markerX + 7, markerY - 10);
    }
    const tangentMultiplier = state.multiplier * Math.exp(CRASH_GROWTH * 60);
    const tangent = Math.atan2(yFor(tangentMultiplier) - tipY, xFor(maxElapsed + 60) - tipX);
    drawRocket(context, tipX, tipY, tangent, state.phase, time);
  }

  function loop(getState) {
    cancelAnimationFrame(animationFrame);
    const tick = () => {
      draw(getState());
      animationFrame = requestAnimationFrame(tick);
    };
    tick();
  }

  observer.observe(canvas);
  return { draw, loop, stop: () => cancelAnimationFrame(animationFrame), destroy: () => observer.disconnect() };
}

export function mount(container, ctx) {
  container.innerHTML = `
    <section class="crash-game">
      <main class="crash-main">
        <div class="crash-topline"><span>RECENT FLIGHTS</span><div class="crash-history"></div></div>
        <div class="crash-stage"><canvas></canvas><div class="crash-flash"></div><div class="crash-multiplier">1.00×<small>READY FOR LAUNCH</small></div></div>
      </main>
      <aside class="crash-panel">
        <div class="crash-tabs"><button class="active" data-tab="manual">MANUAL</button><button data-tab="auto">AUTO</button></div>
        <label>BET AMOUNT<div class="crash-input"><input class="crash-bet" type="number" min="1" value="100"><b>CR</b></div></label>
        <div class="crash-modifiers"><button data-mod="0.5">½</button><button data-mod="2">2×</button></div>
        <label class="crash-auto-target">AUTO CASH OUT<input type="number" min="1.01" max="10000" step="0.01" value="2.00"></label>
        <div class="crash-auto-settings">
          <label>NUMBER OF BETS <small>0 = ∞</small><input class="crash-count" type="number" min="0" value="5"></label>
          <label>ON WIN<select class="crash-win"><option value="0">RESET</option><option value="10">INCREASE 10%</option><option value="25">INCREASE 25%</option></select></label>
          <label>ON LOSS<select class="crash-loss"><option value="0">RESET</option><option value="25">INCREASE 25%</option><option value="50">INCREASE 50%</option></select></label>
          <label>STOP ON PROFIT<input class="crash-stop-profit" type="number" min="0" value="0"></label>
          <label>STOP ON LOSS<input class="crash-stop-loss" type="number" min="0" value="0"></label>
        </div>
        <div class="crash-running"><span>RUNNING PROFIT</span><b>0.00 CR</b></div>
        <button class="crash-action">PLACE BET</button>
        <button class="crash-auto-action">START AUTO-BET</button>
        <p>SPACE TO BET / CASH OUT · SERVER AUTHORITATIVE</p>
      </aside>
    </section>`;

  const find = (selector) => container.querySelector(selector);
  const chart = createRocketChart(find("canvas"));
  let round = null;
  let shown = false;
  let busy = false;
  let pollTimer = 0;
  let autoRunning = false;
  let autoRemaining = 0;
  let baseBet = 100;
  let runningProfit = 0;
  let finishedRoundId = null;
  const history = [];

  function currentMultiplier() {
    if (!round) return 1;
    if (round.phase === "flying") return crashMultiplierAt(ctx.serverNow() - round.startedAt);
    return round.crashPoint || round.cashedAt || 1;
  }

  function chartState() {
    const multiplier = currentMultiplier();
    const endTime = round?.crashPoint ? crashTimeFor(round.crashPoint) : ctx.serverNow() - (round?.startedAt || ctx.serverNow());
    return { multiplier, phase: round?.phase || "idle", elapsed: Math.max(0, endTime), cashoutAt: round?.cashedAt };
  }

  function render() {
    const multiplier = currentMultiplier();
    const status = !round ? "READY FOR LAUNCH" : round.phase === "flying" ? "ROCKET IN FLIGHT" : round.phase === "cashed" ? `CASHED OUT @ ${formatMultiplier(round.cashedAt)} · +${ctx.money(round.payout)} CR` : `CRASHED @ ${formatMultiplier(round.crashPoint)}`;
    find(".crash-multiplier").innerHTML = `${formatMultiplier(multiplier)}<small>${status}</small>`;
    find(".crash-multiplier").className = `crash-multiplier ${round?.phase || "idle"}`;
    find(".crash-action").textContent = round?.phase === "flying" ? `CASH OUT · ${ctx.money(round.bet * multiplier)} CR` : "PLACE BET";
    find(".crash-action").disabled = busy || (autoRunning && round?.phase !== "flying");
    find(".crash-running b").textContent = `${runningProfit >= 0 ? "+" : ""}${ctx.money(runningProfit)} CR`;
    find(".crash-running").classList.toggle("loss", runningProfit < 0);
    find(".crash-history").innerHTML = history.map((value) => `<i class="${value >= 10 ? "gold" : value >= 2 ? "cyan" : "low"}">${formatMultiplier(value)}</i>`).join("");
  }

  function stopAuto() {
    autoRunning = false;
    find(".crash-auto-action").textContent = "START AUTO-BET";
  }

  function finishRound() {
    if (!round || round.phase === "flying" || round.id === finishedRoundId) return;
    finishedRoundId = round.id;
    window.clearInterval(pollTimer);
    const result = round.crashPoint || round.cashedAt || 1;
    history.unshift(result);
    history.splice(12);
    if (round.phase === "crashed") {
      find(".crash-stage").classList.add("is-crashed");
      window.setTimeout(() => find(".crash-stage").classList.remove("is-crashed"), 650);
      ctx.sound(68, 0.35, "sawtooth", 0.17);
    } else ctx.sound(840, 0.22, "sine", 0.12);
    if (!autoRunning) return render();
    const won = round.phase === "cashed";
    runningProfit += (round.payout || 0) - round.bet;
    const percent = Number(find(won ? ".crash-win" : ".crash-loss").value);
    find(".crash-bet").value = String(percent ? round.bet * (1 + percent / 100) : baseBet);
    if (Number.isFinite(autoRemaining)) autoRemaining -= 1;
    const profitLimit = Number(find(".crash-stop-profit").value);
    const lossLimit = Number(find(".crash-stop-loss").value);
    const shouldStop = autoRemaining <= 0 || (profitLimit > 0 && runningProfit >= profitLimit) || (lossLimit > 0 && runningProfit <= -lossLimit);
    if (shouldStop) stopAuto();
    else window.setTimeout(placeOrCashout, 750);
    render();
  }

  async function sync() {
    try {
      round = (await ctx.request("/casino/crash")).round;
      finishRound();
      render();
    } catch (error) {
      ctx.toast(error.message, "loss");
    }
  }

  async function placeOrCashout() {
    if (busy) return;
    busy = true;
    render();
    try {
      if (round?.phase === "flying") round = (await ctx.request("/casino/crash/cashout", {})).round;
      else {
        const autoCashout = container.classList.contains("crash-auto-mode") ? Number(find(".crash-auto-target input").value) : null;
        round = (await ctx.request("/casino/crash/start", { bet: Number(find(".crash-bet").value), autoCashout })).round;
        finishedRoundId = null;
        window.clearInterval(pollTimer);
        pollTimer = window.setInterval(sync, 400);
      }
      finishRound();
    } catch (error) {
      ctx.toast(error.message, "loss");
      stopAuto();
    } finally {
      busy = false;
      render();
    }
  }

  async function resume() {
    try {
      round = (await ctx.request("/casino/active")).crash;
      if (!round) round = (await ctx.request("/casino/crash")).round;
      if (round?.phase === "flying") {
        window.clearInterval(pollTimer);
        pollTimer = window.setInterval(sync, 400);
      }
      render();
    } catch (error) {
      ctx.toast(error.message, "loss");
    }
  }

  find(".crash-action").addEventListener("click", placeOrCashout);
  find(".crash-auto-action").addEventListener("click", () => {
    if (autoRunning) return stopAuto();
    autoRunning = true;
    baseBet = Number(find(".crash-bet").value);
    runningProfit = 0;
    const count = Number(find(".crash-count").value);
    autoRemaining = count === 0 ? Infinity : Math.max(1, count);
    find(".crash-auto-action").textContent = "STOP AUTO-BET";
    placeOrCashout();
  });
  container.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]");
    if (tab) {
      container.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("active", button === tab));
      container.classList.toggle("crash-auto-mode", tab.dataset.tab === "auto");
    }
    const modifier = event.target.closest("[data-mod]");
    if (modifier) find(".crash-bet").value = String(Math.max(1, Number(find(".crash-bet").value) * Number(modifier.dataset.mod)));
  });
  window.addEventListener("keydown", (event) => {
    if (shown && event.code === "Space" && !/INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) {
      event.preventDefault();
      placeOrCashout();
    }
  });
  ctx.onModeChange(() => shown && resume());

  return {
    show() {
      shown = true;
      container.hidden = false;
      resume();
      chart.loop(chartState);
    },
    hide() {
      shown = false;
      container.hidden = true;
      window.clearInterval(pollTimer);
      chart.stop();
      stopAuto();
    },
  };
}

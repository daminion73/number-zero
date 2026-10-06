import { PLINKO_ROWS, PLINKO_TABLES } from "../casino-core.js";

const clampBet = (value) => Math.min(10_000_000, Math.max(1, Number(value) || 1));
const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function mount(container, ctx) {
  container.innerHTML = `
    <section class="plinko-game">
      <main class="plinko-stage">
        <header><div><small>NUMBER//ZERO</small><strong>PLINKO</strong></div><span class="plinko-flight">READY TO DROP</span></header>
        <div class="plinko-canvas-wrap"><canvas aria-label="Plinko peg board"></canvas></div>
        <div class="plinko-history" aria-label="Recent multipliers"></div>
      </main>
      <aside class="plinko-panel">
        <div class="plinko-title"><strong>DROP CONTROL</strong><small>PROVABLY FAIR · SPACE TO DROP</small></div>
        <label>BET AMOUNT<div class="plinko-input"><input class="plinko-bet" type="number" min="1" max="10000000" value="100"><b>CR</b></div></label>
        <div class="plinko-mods"><button data-mod=".5">½</button><button data-mod="2">2×</button></div>
        <fieldset><legend>RISK</legend><div class="plinko-options">${["low", "medium", "high"].map((v) => `<button data-risk="${v}">${v.toUpperCase()}</button>`).join("")}</div></fieldset>
        <fieldset><legend>ROWS</legend><div class="plinko-options">${PLINKO_ROWS.map((v) => `<button data-rows="${v}">${v}</button>`).join("")}</div></fieldset>
        <div class="plinko-result"><small>LAST PAYOUT</small><strong>—</strong><span>Choose your risk and drop</span></div>
        <button class="plinko-drop">DROP <kbd>SPACE</kbd></button>
      </aside>
    </section>`;

  const $ = (selector) => container.querySelector(selector);
  const canvas = $("canvas");
  const context = canvas.getContext("2d");
  const balls = [];
  const history = [];
  let rows = 12;
  let risk = "medium";
  let visible = false;
  let frame = 0;
  let pulse = null;

  function geometry() {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    const top = Math.max(18, height * .055);
    const bucketH = Math.max(28, Math.min(48, height * .1));
    const usable = height - top - bucketH - 8;
    const dy = usable / rows;
    const dx = Math.min((width - 26) / (rows + 1), dy * 1.65);
    return { width, height, top, bucketH, dy, dx, center: width / 2 };
  }

  function point(g, row, rights) {
    return { x: g.center + (rights - row / 2) * g.dx, y: g.top + row * g.dy };
  }

  function color(value) {
    if (value >= 25) return "#ff4fd8";
    if (value >= 5) return "#ffd43b";
    if (value >= 1) return "#53e7ff";
    return "#ff4d6d";
  }

  function resize() {
    const ratio = Math.min(2, devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function draw() {
    resize();
    const g = geometry();
    context.clearRect(0, 0, g.width, g.height);
    context.fillStyle = "#536078";
    context.shadowBlur = 7;
    context.shadowColor = "#53e7ff66";
    const radius = Math.max(2, Math.min(4, g.dy * .1));
    for (let row = 0; row < rows; row++) {
      for (let peg = 0; peg <= row; peg++) {
        const p = point(g, row, peg);
        context.beginPath(); context.arc(p.x, p.y, radius, 0, Math.PI * 2); context.fill();
      }
    }
    context.shadowBlur = 0;
    const table = PLINKO_TABLES[rows][risk];
    const bucketY = g.height - g.bucketH;
    table.forEach((value, slot) => {
      const x = g.center + (slot - rows / 2) * g.dx;
      const active = pulse?.slot === slot && performance.now() - pulse.at < 650;
      context.fillStyle = color(value);
      context.globalAlpha = active ? .95 : .48;
      context.beginPath();
      context.roundRect(x - g.dx * .45, bucketY, g.dx * .9, g.bucketH - 5, 5);
      context.fill();
      context.globalAlpha = 1;
      context.fillStyle = active || value >= 1 ? "#f8fbff" : "#cbd1df";
      context.font = `800 ${Math.max(8, Math.min(14, g.dx * .28))}px "Barlow Condensed"`;
      context.textAlign = "center"; context.textBaseline = "middle";
      context.fillText(`${value}×`, x, bucketY + (g.bucketH - 5) / 2);
    });
    for (const ball of balls) {
      const p = ball.position(g);
      context.fillStyle = "#c7ff36"; context.shadowBlur = 17; context.shadowColor = "#c7ff36";
      context.beginPath(); context.arc(p.x, p.y, Math.max(5, radius * 1.8), 0, Math.PI * 2); context.fill();
      context.shadowBlur = 0;
    }
    if (visible || balls.length) frame = requestAnimationFrame(draw);
  }

  function render() {
    container.querySelectorAll("[data-risk]").forEach((b) => b.classList.toggle("active", b.dataset.risk === risk));
    container.querySelectorAll("[data-rows]").forEach((b) => b.classList.toggle("active", Number(b.dataset.rows) === rows));
    container.querySelectorAll("[data-risk], [data-rows]").forEach((b) => { b.disabled = balls.length > 0; });
    $(".plinko-flight").textContent = balls.length ? `${balls.length} BALL${balls.length === 1 ? "" : "S"} IN FLIGHT` : "READY TO DROP";
    $(".plinko-history").innerHTML = history.map((v) => `<i style="--tone:${color(v)}">${v}×</i>`).join("") || "<small>RECENT MULTIPLIERS APPEAR HERE</small>";
  }

  async function animate(result, round) {
    const duration = ctx.reducedMotion() ? 260 : 1250 + round.rows * 32;
    const started = performance.now();
    const ball = { position(g) {
      const progress = Math.min(1, (performance.now() - started) / duration);
      const scaled = progress * (round.rows + .9);
      const segment = Math.min(round.rows, Math.floor(scaled));
      const local = scaled - segment;
      const rights = round.path.slice(0, segment).reduce((a, v) => a + v, 0);
      if (segment >= round.rows) {
        const p = point(g, round.rows, rights);
        return { x: p.x, y: p.y + local * (g.height - g.bucketH - p.y) };
      }
      const from = point(g, segment, rights);
      const to = point(g, segment + 1, rights + round.path[segment]);
      return { x: from.x + (to.x - from.x) * local, y: from.y + (to.y - from.y) * local - Math.sin(local * Math.PI) * g.dy * .2 };
    }};
    balls.push(ball); render();
    await wait(duration);
    balls.splice(balls.indexOf(ball), 1);
    pulse = { slot: round.slot, at: performance.now() };
    result.reveal();
    history.unshift(round.multiplier); history.splice(10);
    const net = round.payout - round.bet;
    $(".plinko-result strong").textContent = `${ctx.money(round.payout)} CR`;
    $(".plinko-result span").textContent = `${round.multiplier}× · ${net >= 0 ? "+" : "−"}${ctx.money(Math.abs(net))} CR net`;
    $(".plinko-result").dataset.tone = net >= 0 ? "win" : "loss";
    ctx.sound(net >= 0 ? 850 : 170, .16, net >= 0 ? "triangle" : "sawtooth", .06);
    render();
  }

  async function drop() {
    const bet = clampBet($(".plinko-bet").value);
    if (bet > ctx.balance()) return ctx.toast("Not enough credits for that drop", "loss");
    try {
      const result = await ctx.request("/casino/plinko", { bet, rows, risk }, { reveal: true });
      animate(result, result.round);
    } catch (error) { ctx.toast(error.message, "loss"); }
  }

  container.addEventListener("click", (event) => {
    const mod = event.target.closest("[data-mod]");
    if (mod) $(".plinko-bet").value = String(clampBet(clampBet($(".plinko-bet").value) * Number(mod.dataset.mod)));
    const riskButton = event.target.closest("[data-risk]");
    if (riskButton && !balls.length) { risk = riskButton.dataset.risk; render(); }
    const rowButton = event.target.closest("[data-rows]");
    if (rowButton && !balls.length) { rows = Number(rowButton.dataset.rows); render(); }
    if (event.target.closest(".plinko-drop")) drop();
  });
  window.addEventListener("keydown", (event) => { if (visible && event.code === "Space" && !event.repeat && !/INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) { event.preventDefault(); drop(); } });
  ctx.onModeChange(() => { balls.splice(0).forEach(() => {}); history.splice(0); pulse = null; $(".plinko-result strong").textContent = "—"; $(".plinko-result span").textContent = "Choose your risk and drop"; render(); });
  render();
  return { show() { visible = true; container.hidden = false; cancelAnimationFrame(frame); draw(); }, hide() { visible = false; container.hidden = true; cancelAnimationFrame(frame); } };
}

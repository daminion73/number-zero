import { ROULETTE_RED } from "../casino-core.js";

const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const CHIPS = [1, 5, 25, 100, 500, 2500];
const COLORS = ["#9aa3b8", "#53e7ff", "#2ee59d", "#c7ff36", "#ae70ff", "#ff4fd8"];
const POCKET = 360 / 37;
const key = (t, v) => `${t}:${v ?? ""}`;
const colorOf = (n) => (n === 0 ? "green" : ROULETTE_RED.includes(n) ? "red" : "black");
const label = (t, v) => t === "straight" ? v : t === "dozen" ? `${v}${["ST", "ND", "RD"][v - 1]} 12` : t === "column" ? "2:1" : ({ low: "1–18", high: "19–36", odd: "ODD", even: "EVEN", red: "RED", black: "BLACK" }[t]);
/** Compact chip-token text, e.g. 5 · 25 · 1.5K · 2M. */
const compact = (a) => a >= 1e6 ? `${+(a / 1e6).toFixed(1)}M` : a >= 1000 ? `${+(a / 1000).toFixed(1)}K` : `${+a.toFixed(2)}`;
const chipColor = (a) => COLORS[Math.max(0, CHIPS.filter((c) => c <= a).length - 1)];

/** Table cell markup. Grid placement is given for the horizontal (h*) and phone/vertical (v*) layouts. */
function cell(t, v, cls, pos, inner = `<b>${label(t, v)}</b>`) {
  const [hr, hc, hrs, hcs, vr, vc, vrs, vcs] = pos;
  return `<button class="rl-bet ${cls}" data-t="${t}"${v == null ? "" : ` data-v="${v}"`} aria-label="${t} ${v ?? ""}" style="--hr:${hr};--hc:${hc};--hrs:${hrs};--hcs:${hcs};--vr:${vr};--vc:${vc};--vrs:${vrs};--vcs:${vcs}">${inner}<i></i></button>`;
}

function tableMarkup() {
  const out = [cell("straight", 0, "rl-num rl-zero green", [1, 1, 3, 1, 1, 3, 1, 3])];
  for (let n = 1; n <= 36; n++) {
    const k = n - 1;
    out.push(cell("straight", n, `rl-num ${colorOf(n)}`, [3 - (k % 3), 2 + Math.floor(k / 3), 1, 1, 2 + Math.floor(k / 3), 3 + (k % 3), 1, 1]));
  }
  for (let v = 1; v <= 3; v++) out.push(cell("column", v, "rl-out rl-col", [4 - v, 14, 1, 1, 14, 2 + v, 1, 1]));
  for (let v = 1; v <= 3; v++) out.push(cell("dozen", v, "rl-out rl-dozen", [4, 2 + 4 * (v - 1), 1, 4, 2 + 4 * (v - 1), 2, 4, 1]));
  ["low", "even", "red", "black", "odd", "high"].forEach((t, i) => out.push(cell(t, null, `rl-out rl-even ${t}`, [5, 2 + 2 * i, 1, 2, 2 + 2 * i, 1, 2, 1])));
  return out.join("");
}

function wheelMarkup() {
  const half = (POCKET / 2) * Math.PI / 180;
  const p = (r, s) => `${(100 + s * r * Math.sin(half)).toFixed(3)} ${(100 - r * Math.cos(half)).toFixed(3)}`;
  const sector = (ro, ri) => `M${p(ro, -1)} A${ro} ${ro} 0 0 1 ${p(ro, 1)} L${p(ri, 1)} A${ri} ${ri} 0 0 0 ${p(ri, -1)}Z`;
  const numberRing = sector(94, 71);
  const pocket = sector(71, 57);
  return ORDER.map((n, i) => `<g transform="rotate(${(i * POCKET).toFixed(4)} 100 100)"><path d="${numberRing}" class="rl-pocket ${colorOf(n)}" data-n="${n}"/><path d="${pocket}" class="rl-cup"/><text x="100" y="17.6">${n}</text></g>`).join("");
}

export function mount(container, ctx) {
  let bets = new Map(), last = null, undo = [], chip = 5, busy = false, visible = false, history = load(), angle = 0, ballAngle = 0;
  function sk() { return `number-zero-roulette:${ctx.mode()}`; }
  function load() { try { return JSON.parse(localStorage.getItem(sk())) || []; } catch { return []; } }
  container.innerHTML = `<section class="rl">
    <main class="rl-play">
      <div class="rl-side">
        <div class="rl-wheel">
          <svg viewBox="0 0 200 200" aria-hidden="true">
            <defs><radialGradient id="rl-cone" cx="50%" cy="42%" r="60%"><stop offset="0" stop-color="#ffe9a3"/><stop offset=".55" stop-color="#c2963c"/><stop offset="1" stop-color="#6d4c17"/></radialGradient></defs>
            <circle cx="100" cy="100" r="99" class="rl-rim"/>
            <circle cx="100" cy="100" r="95.5" class="rl-rim-in"/>
            <g class="rl-rotor">${wheelMarkup()}<circle cx="100" cy="100" r="57" class="rl-cone"/><circle cx="100" cy="100" r="31" class="rl-hub"/><path d="M100 46v20M100 134v20M46 100h20M134 100h20" class="rl-spokes"/></g>
            <g class="rl-ball-track"><circle class="rl-ball" cx="100" cy="36" r="4.4"/></g>
            <path d="M95.5 1.5h9l-4.5 6z" class="rl-marker"/>
          </svg>
          <div class="rl-result"><small>PLACE<br>BETS</small></div>
        </div>
        <div class="rl-info"><div class="rl-summary">EUROPEAN · SINGLE ZERO · 35:1</div><div class="rl-history"></div></div>
      </div>
      <div class="rl-felt"><div class="rl-table">${tableMarkup()}</div></div>
    </main>
    <footer class="rl-dock">
      <header><b>EUROPEAN ROULETTE</b><small>SINGLE ZERO · 35:1</small></header>
      <div class="rl-chips">${CHIPS.map((v, i) => `<button data-chip="${v}" style="--chip:${COLORS[i]}">${v >= 1000 ? v / 1000 + "K" : v}</button>`).join("")}</div>
      <div class="rl-tools">${["undo", "clear", "rebet", "double"].map((x) => `<button data-tool="${x}">${x === "double" ? "2×" : x.toUpperCase()}</button>`).join("")}</div>
      <div class="rl-total"><span>TOTAL BET</span><b>0.00 CR</b></div>
      <button class="rl-spin">SPIN <span>SPACE</span></button>
    </footer>
  </section>`;
  const $ = (s) => container.querySelector(s);
  function render() {
    container.querySelectorAll(".rl-bet").forEach((el) => {
      const a = bets.get(key(el.dataset.t, el.dataset.v == null ? null : +el.dataset.v)) || 0;
      const token = el.querySelector("i");
      token.textContent = a ? compact(a) : "";
      token.title = a ? `${ctx.money(a)} CR` : "";
      token.style.setProperty("--chip", a ? chipColor(a) : "transparent");
      el.classList.toggle("has-bet", !!a);
    });
    container.querySelectorAll("[data-chip]").forEach((x) => x.classList.toggle("active", +x.dataset.chip === chip));
    const total = [...bets.values()].reduce((a, b) => a + b, 0);
    $(".rl-total b").textContent = `${ctx.money(total)} CR`;
    $(".rl-spin").disabled = busy || !total || total > ctx.balance();
    $(".rl-history").innerHTML = `<small>RECENT</small>${history.slice(-12).reverse().map((n) => `<b class="${colorOf(n)}">${n}</b>`).join("")}`;
  }
  function set(next) { undo.push(new Map(bets)); bets = next; render(); }
  async function spin() {
    if (busy || !bets.size) return;
    busy = true; render();
    container.querySelectorAll(".win,.hit").forEach((x) => x.classList.remove("win", "hit"));
    const placed = [...bets].map(([k, amount]) => { const [type, v] = k.split(":"); return { type, ...(v !== "" ? { value: +v } : {}), amount }; }), mode = ctx.mode();
    let res;
    try { res = await ctx.request("/casino/roulette", { bets: placed }, { reveal: true }); }
    catch (e) { busy = false; render(); ctx.toast(e.message, "loss"); return; }
    const r = res.round, idx = ORDER.indexOf(r.number), reduced = ctx.reducedMotion(), turns = reduced ? 1 : 5;
    // Rotor: pocket `idx` is centred at idx·POCKET, so rotating by −idx·POCKET brings it under the ball (which rests at 12 o'clock).
    angle += turns * 360 + ((360 - ((idx * POCKET) % 360)) % 360) - (((angle % 360) + 360) % 360);
    $(".rl-rotor").style.transform = `rotate(${angle}deg)`;
    ballAngle -= (turns + 2) * 360;
    $(".rl-ball-track").style.transform = `rotate(${ballAngle}deg)`;
    const wheel = $(".rl-wheel");
    wheel.classList.remove("spinning"); void wheel.offsetWidth; wheel.classList.add("spinning");
    $(".rl-result").innerHTML = `<small>NO MORE<br>BETS</small>`;
    await new Promise((ok) => setTimeout(ok, reduced ? 120 : 2300));
    res.reveal();
    if (ctx.mode() !== mode) return;
    last = new Map(bets);
    history.push(r.number); history = history.slice(-30);
    localStorage.setItem(sk(), JSON.stringify(history));
    container.querySelectorAll(".rl-bet").forEach((el) => {
      const v = el.dataset.v == null ? null : +el.dataset.v;
      const b = r.bets.find((x) => x.type === el.dataset.t && (x.value ?? null) === v);
      if (b?.payout) el.classList.add("win");
      if (el.dataset.t === "straight" && v === r.number) el.classList.add("hit");
    });
    container.querySelector(`.rl-pocket[data-n="${r.number}"]`)?.classList.add("hit");
    const net = r.payout - r.wager;
    $(".rl-result").innerHTML = `<b class="${r.color}">${r.number}</b>`;
    $(".rl-summary").innerHTML = `<em class="${r.color}">${r.number} ${r.color.toUpperCase()}</em> RETURNED <b>${ctx.money(r.payout)}</b> · NET <strong class="${net > 0 ? "up" : net < 0 ? "down" : ""}">${net >= 0 ? "+" : "−"}${ctx.money(Math.abs(net))}</strong>`;
    if (net > 0) ctx.toast("Roulette win", "win", `+${ctx.money(net)} CR net`);
    busy = false; render();
  }
  container.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.t) { const k = key(b.dataset.t, b.dataset.v == null ? null : +b.dataset.v), n = new Map(bets); n.set(k, (n.get(k) || 0) + chip); set(n); }
    else if (b.dataset.chip) { chip = +b.dataset.chip; render(); }
    else if (b.dataset.tool === "undo" && undo.length) { bets = undo.pop(); render(); }
    else if (b.dataset.tool === "clear") set(new Map());
    else if (b.dataset.tool === "rebet" && last) set(new Map(last));
    else if (b.dataset.tool === "double") set(new Map([...bets].map(([k, v]) => [k, v * 2])));
    else if (b.classList.contains("rl-spin")) spin();
  });
  document.addEventListener("keydown", (e) => { if (visible && e.code === "Space" && !e.repeat && !e.target.closest?.("input,select,textarea")) { e.preventDefault(); spin(); } });
  ctx.onModeChange(() => { busy = false; bets = new Map(); last = null; undo = []; history = load(); render(); });
  render();
  return { show() { visible = true; render(); }, hide() { visible = false; } };
}

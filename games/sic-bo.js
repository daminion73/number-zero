import { SIC_BO_TOTALS, SIC_BO_BETS, SIC_BO_MAX_BETS } from "../casino-core.js";

const CHIPS = [1, 5, 25, 100, 500, 2500];
const COLORS = ["#9aa3b8", "#53e7ff", "#2ee59d", "#c7ff36", "#ae70ff", "#ff4fd8"];
/** Pip cells (1–9 in a 3×3 grid, row-major) for each face. */
const PIPS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
/** Cube rotation that brings face v to the front (front 1, top 2, right 3, left 4, bottom 5, back 6). */
const FRONT = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
const CUBE_FACES = [[1, "front"], [6, "back"], [3, "right"], [4, "left"], [2, "top"], [5, "bottom"]];
const COMBOS = [];
for (let a = 1; a <= 6; a++) for (let b = a + 1; b <= 6; b++) COMBOS.push(a * 10 + b);

const key = (t, v) => `${t}:${v ?? ""}`;
const compact = (a) => a >= 1e6 ? `${+(a / 1e6).toFixed(1)}M` : a >= 1000 ? `${+(a / 1000).toFixed(1)}K` : `${+a.toFixed(2)}`;
const chipColor = (a) => COLORS[Math.max(0, CHIPS.filter((c) => c <= a).length - 1)];
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const face = (v, cls = "sb-pd") => `<span class="${cls} v${v}">${PIPS[v].map((k) => `<i style="grid-area:${Math.ceil(k / 3)}/${((k - 1) % 3) + 1}"></i>`).join("")}</span>`;
const dice = (...vs) => `<span class="sb-dice">${vs.map((v) => face(v)).join("")}</span>`;
const odds = (o) => `<span class="sb-odds">${o}</span>`;
const tagOf = (r) => r.triple ? "triple" : r.total >= 11 ? "big" : "small";
const NAMES = { small: "Small 4 to 10", big: "Big 11 to 17", odd: "Odd", even: "Even", "any-triple": "Any triple", total: "Total", single: "Single", double: "Double", triple: "Triple", combo: "Combination" };

/** Bet area. `pos` = [row, col, rowSpan, colSpan] for the wide (h) and phone (v) top-band layouts. */
function cell(t, v, cls, inner, h, p) {
  const pos = h ? ` style="--hr:${h[0]};--hc:${h[1]};--hrs:${h[2]};--hcs:${h[3]};--vr:${p[0]};--vc:${p[1]};--vrs:${p[2]};--vcs:${p[3]}"` : "";
  const label = `${NAMES[t]}${v == null ? "" : ` ${t === "combo" ? `${Math.floor(v / 10)} and ${v % 10}` : v}`}`;
  return `<button class="sb-bet ${cls}" data-t="${t}"${v == null ? "" : ` data-v="${v}"`} aria-label="${label}"${pos}>${inner}<span class="sb-tok"></span><em class="sb-won"></em></button>`;
}

function tableMarkup() {
  const top = [
    cell("small", null, "sb-side-bet sb-small", `<b class="sb-word">SMALL</b><small>4 – 10</small>${odds("1:1")}<small class="sb-note">LOSES ON TRIPLE</small>`, [1, 1, 3, 1], [1, 1, 1, 1]),
    cell("odd", null, "sb-side-bet sb-oe", `<b class="sb-word">ODD</b>${odds("1:1")}`, [1, 2, 3, 1], [1, 2, 1, 1]),
    cell("any-triple", null, "sb-any", `<b class="sb-word">ANY TRIPLE</b>${odds("30:1")}`, [2, 6, 1, 3], [1, 3, 1, 2]),
    cell("even", null, "sb-side-bet sb-oe", `<b class="sb-word">EVEN</b>${odds("1:1")}`, [1, 12, 3, 1], [1, 5, 1, 1]),
    cell("big", null, "sb-side-bet sb-big", `<b class="sb-word">BIG</b><small>11 – 17</small>${odds("1:1")}<small class="sb-note">LOSES ON TRIPLE</small>`, [1, 13, 3, 1], [1, 6, 1, 1]),
  ];
  for (let v = 1; v <= 6; v++) {
    top.push(cell("double", v, "sb-double", `${dice(v, v)}${odds("10:1")}`, [1, v <= 3 ? 2 + v : 5 + v, 3, 1], [3, v, 1, 1]));
    top.push(cell("triple", v, "sb-triple", `${dice(v, v, v)}${odds("180:1")}`, [v <= 3 ? 1 : 3, 5 + ((v - 1) % 3) + 1, 1, 1], [2, v, 1, 1]));
  }
  const totals = Object.keys(SIC_BO_TOTALS).map(Number).map((v) => cell("total", v, `sb-total ${v <= 10 ? "lo" : "hi"}`, `<b class="sb-num">${v}</b>${odds(`${SIC_BO_TOTALS[v]}:1`)}`));
  const combos = COMBOS.map((v) => cell("combo", v, "sb-combo", `${dice(Math.floor(v / 10), v % 10)}${odds("5:1")}`));
  const singles = [1, 2, 3, 4, 5, 6].map((v) => cell("single", v, "sb-single", `${dice(v)}<span class="sb-odds"><span class="sb-long">1:1 · 2:1 · 3:1</span><span class="sb-short">1–3:1</span></span>`));
  return `<div class="sb-band sb-top">${top.join("")}</div>
    <div class="sb-band sb-totals">${totals.join("")}</div>
    <div class="sb-band sb-combos">${combos.join("")}<div class="sb-legend"><b>ANY 2</b><span>5:1</span></div></div>
    <div class="sb-band sb-singles">${singles.join("")}</div>`;
}

const cubeMarkup = (i) => `<div class="sb-die" data-i="${i}"><div class="sb-toss"><div class="sb-tilt"><div class="sb-cube">${CUBE_FACES.map(([v, side]) => face(v, `sb-face ${side}`)).join("")}</div></div></div><span class="sb-shadow"></span></div>`;

export function mount(container, ctx) {
  let bets = new Map(), last = null, undo = [], chip = 5, busy = false, visible = false, history = load();
  const rot = [0, 1, 2].map(() => ({ x: 0, y: 0, z: 0 }));
  function sk() { return `number-zero-sic-bo:${ctx.mode()}`; }
  function load() { try { return JSON.parse(localStorage.getItem(sk())) || []; } catch { return []; } }

  container.innerHTML = `<section class="sb">
    <main class="sb-play">
      <div class="sb-side">
        <div class="sb-tray"><div class="sb-dome">${[0, 1, 2].map(cubeMarkup).join("")}</div></div>
        <div class="sb-readout"><div class="sb-sum"><small>PLACE YOUR BETS</small></div><div class="sb-net">THREE DICE · UP TO 180:1</div></div>
        <div class="sb-history"></div>
      </div>
      <div class="sb-felt"><div class="sb-table">${tableMarkup()}</div></div>
    </main>
    <footer class="sb-dock">
      <header><b>SIC BO</b><small>3 DICE · UP TO 180:1</small></header>
      <div class="sb-chips">${CHIPS.map((v, i) => `<button data-chip="${v}" style="--chip:${COLORS[i]}" aria-label="Chip ${v}">${v >= 1000 ? v / 1000 + "K" : v}</button>`).join("")}</div>
      <div class="sb-tools">${["undo", "clear", "rebet", "double"].map((x) => `<button data-tool="${x}">${x === "double" ? "2×" : x.toUpperCase()}</button>`).join("")}</div>
      <div class="sb-stake"><span>TOTAL BET</span><b>0.00 CR</b></div>
      <button class="sb-roll">ROLL <span>SPACE</span></button>
    </footer>
  </section>`;
  const $ = (s) => container.querySelector(s);
  const root = $(".sb");
  const cells = [...container.querySelectorAll(".sb-bet")];
  const valueOf = (el) => (el.dataset.v == null ? null : +el.dataset.v);

  function pose(i, v, z = 0) {
    const [x, y] = FRONT[v];
    rot[i] = { x, y, z };
    container.querySelector(`.sb-die[data-i="${i}"] .sb-cube`).style.transform = `rotateZ(${z}deg) rotateX(${x}deg) rotateY(${y}deg)`;
  }
  (history.at(-1)?.dice || [6, 5, 4]).forEach((v, i) => pose(i, v, [-8, 6, -3][i]));

  function historyMarkup() {
    return `<small>RECENT ROLLS</small><div class="sb-hlist">${history.slice(-10).reverse().map((h) => `<div class="sb-h ${h.tag}">${dice(...h.dice)}<b>${h.total}</b><em>${h.tag.toUpperCase()}</em></div>`).join("") || `<span class="sb-hempty">NO ROLLS YET</span>`}</div>`;
  }

  function render() {
    for (const el of cells) {
      const a = bets.get(key(el.dataset.t, valueOf(el))) || 0;
      const tok = el.querySelector(".sb-tok");
      tok.textContent = a ? compact(a) : "";
      tok.title = a ? `${ctx.money(a)} CR` : "";
      tok.style.setProperty("--chip", a ? chipColor(a) : "transparent");
      el.classList.toggle("has-bet", !!a);
    }
    container.querySelectorAll("[data-chip]").forEach((x) => x.classList.toggle("active", +x.dataset.chip === chip));
    const total = [...bets.values()].reduce((a, b) => a + b, 0);
    $(".sb-stake b").textContent = `${ctx.money(total)} CR`;
    $(".sb-roll").disabled = busy || !total || total > ctx.balance();
    container.querySelectorAll("[data-tool]").forEach((x) => {
      const t = x.dataset.tool;
      x.disabled = busy || (t === "undo" ? !undo.length : t === "rebet" ? !last : !bets.size);
    });
    $(".sb-history").innerHTML = historyMarkup();
  }
  function clearResults() {
    root.classList.remove("settled");
    for (const el of cells) { el.classList.remove("hit", "win", "lost"); el.querySelector(".sb-won").textContent = ""; }
  }
  function set(next) {
    if (busy) return;
    if (next.size > SIC_BO_MAX_BETS) { ctx.toast(`At most ${SIC_BO_MAX_BETS} bets per roll`, "loss"); return; }
    clearResults();
    undo.push(new Map(bets)); undo = undo.slice(-60);
    bets = next; render();
  }

  function land(i, v, reduced) {
    const [x, y] = FRONT[v], prev = rot[i];
    const dir = i === 1 ? -1 : 1;
    const turnsX = reduced ? 0 : 2 + i, turnsY = reduced ? 0 : 3 - (i % 2);
    const base = (a) => a - (((a % 360) + 360) % 360);
    const nx = base(prev.x) + dir * 360 * turnsX + x;
    const ny = base(prev.y) + 360 * turnsY + y;
    const nz = base(prev.z) + (reduced ? 0 : 360 * dir) + Math.round(Math.random() * 24 - 12);
    rot[i] = { x: nx, y: ny, z: nz };
    const die = container.querySelector(`.sb-die[data-i="${i}"]`);
    die.querySelector(".sb-cube").style.transform = `rotateZ(${nz}deg) rotateX(${nx}deg) rotateY(${ny}deg)`;
    die.classList.remove("tossing"); void die.offsetWidth; die.classList.add("tossing");
  }

  async function roll() {
    if (busy || !bets.size) return;
    const total = [...bets.values()].reduce((a, b) => a + b, 0);
    if (total > ctx.balance()) { ctx.toast("Not enough credits for this roll", "loss"); return; }
    busy = true; clearResults(); render();
    const placed = [...bets].map(([k, amount]) => { const [type, v] = k.split(":"); return { type, ...(v !== "" ? { value: +v } : {}), amount }; });
    const mode = ctx.mode(), reduced = ctx.reducedMotion();
    const tray = $(".sb-tray");
    root.classList.toggle("reduced", reduced);
    tray.classList.add("shaking");
    $(".sb-sum").innerHTML = `<small>NO MORE BETS</small>`;
    $(".sb-net").textContent = "ROLLING…";
    let rattle = 0;
    const rattler = setInterval(() => ctx.sound(220 + Math.random() * 260, 0.03, "square", 0.012 + 0.004 * (rattle++ % 2)), 70);
    let res;
    try {
      [res] = await Promise.all([ctx.request("/casino/sic-bo", { bets: placed }, { reveal: true }), wait(reduced ? 0 : 380)]);
    } catch (e) {
      clearInterval(rattler); tray.classList.remove("shaking");
      busy = false; render();
      $(".sb-sum").innerHTML = `<small>PLACE YOUR BETS</small>`; $(".sb-net").textContent = "THREE DICE · UP TO 180:1";
      ctx.toast(e.message, "loss");
      return;
    }
    clearInterval(rattler);
    tray.classList.remove("shaking");
    const r = res.round, ms = reduced ? 160 : 1450;
    r.dice.forEach((v, i) => {
      land(i, v, reduced);
      if (!reduced) setTimeout(() => ctx.sound(140 + i * 30, 0.06, "triangle", 0.03), 520 + i * 110);
    });
    await wait(ms);
    res.reveal();
    if (ctx.mode() !== mode) return;
    last = new Map(bets);
    const tag = tagOf(r);
    history.push({ dice: r.dice, total: r.total, tag }); history = history.slice(-30);
    try { localStorage.setItem(sk(), JSON.stringify(history)); } catch { /* storage full or blocked */ }
    const summary = { total: r.total, triple: r.triple };
    for (const el of cells) {
      const t = el.dataset.t, v = valueOf(el);
      if (SIC_BO_BETS[t].odds(r.dice, v, summary) > 0) el.classList.add("hit");
      const b = r.bets.find((x) => x.type === t && (x.value ?? null) === v);
      if (!b) continue;
      if (b.payout > 0) { el.classList.add("win"); el.querySelector(".sb-won").textContent = `+${compact(b.payout)}`; el.querySelector(".sb-won").title = `${ctx.money(b.payout)} CR returned`; }
      else el.classList.add("lost");
    }
    root.classList.add("settled");
    const net = r.payout - r.wager;
    $(".sb-sum").innerHTML = `<span class="sb-faces">${r.dice.join(" · ")}</span><b>${r.total}</b><em class="${tag}">${tag.toUpperCase()}</em>`;
    $(".sb-net").innerHTML = `RETURNED <b>${ctx.money(r.payout)}</b> · NET <strong class="${net > 0 ? "up" : net < 0 ? "down" : ""}">${net >= 0 ? "+" : "−"}${ctx.money(Math.abs(net))}</strong>`;
    if (r.payout > 0) { ctx.sound(660, 0.1, "triangle", 0.05); setTimeout(() => ctx.sound(990, 0.14, "triangle", 0.05), 110); }
    else ctx.sound(170, 0.18, "sawtooth", 0.025);
    if (net > 0) ctx.toast("Sic Bo win", "win", `+${ctx.money(net)} CR net`);
    busy = false; render();
  }

  container.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled || busy) return;
    if (b.dataset.t) {
      const k = key(b.dataset.t, valueOf(b)), n = new Map(bets);
      n.set(k, Math.round(((n.get(k) || 0) + chip) * 100) / 100); set(n);
      ctx.sound(520 + Math.random() * 80, 0.04, "triangle", 0.03);
    }
    else if (b.dataset.chip) { chip = +b.dataset.chip; render(); }
    else if (b.dataset.tool === "undo" && undo.length) { clearResults(); bets = undo.pop(); render(); }
    else if (b.dataset.tool === "clear") set(new Map());
    else if (b.dataset.tool === "rebet" && last) set(new Map(last));
    else if (b.dataset.tool === "double") set(new Map([...bets].map(([k, v]) => [k, v * 2])));
    else if (b.classList.contains("sb-roll")) roll();
  });
  container.addEventListener("contextmenu", (e) => {
    // Right-click removes one chip of the selected size from that area.
    const b = e.target.closest(".sb-bet");
    if (!b || busy) return;
    e.preventDefault();
    const k = key(b.dataset.t, valueOf(b)), a = bets.get(k);
    if (!a) return;
    const n = new Map(bets), left = Math.round((a - chip) * 100) / 100;
    if (left > 0) n.set(k, left); else n.delete(k);
    set(n);
  });
  document.addEventListener("keydown", (e) => {
    if (!visible || e.repeat || e.target.closest?.("input,select,textarea,[contenteditable]")) return;
    const enter = e.code === "Enter" || e.code === "NumpadEnter";
    if (e.code !== "Space" && !enter) return;
    // Enter on a focused control keeps its normal meaning (keyboard bet placement); Space always rolls.
    if (enter && e.target.closest?.("button,a") && !e.target.closest(".sb-roll")) return;
    e.preventDefault();
    roll();
  });
  ctx.onModeChange(() => {
    busy = false; bets = new Map(); last = null; undo = []; history = load();
    clearResults(); $(".sb-tray").classList.remove("shaking");
    $(".sb-sum").innerHTML = `<small>PLACE YOUR BETS</small>`; $(".sb-net").textContent = "THREE DICE · UP TO 180:1";
    render();
  });
  render();
  return { show() { visible = true; render(); }, hide() { visible = false; } };
}

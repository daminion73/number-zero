import { WHEEL_PAYS, WHEEL_SEGMENTS } from "../casino-core.js";

const TYPES = ["1", "2", "5", "10", "20", "joker", "zero"];
const COLOR = { 1: "#ffd43b", 2: "#53e7ff", 5: "#ae70ff", 10: "#ff4fd8", 20: "#ff8a3d", joker: "#ff4d6d", zero: "#c7ff36" };
const COUNT = Object.fromEntries(TYPES.map((t) => [t, WHEEL_SEGMENTS.filter((s) => s === t).length]));
const CHIPS = [1, 5, 25, 100, 500, 2500];
const CHIP_COLORS = ["#9aa3b8", "#53e7ff", "#2ee59d", "#c7ff36", "#ae70ff", "#ff4fd8"];
const N = WHEEL_SEGMENTS.length;
const SEG = 360 / N;
const C = 200, R_OUT = 182, R_IN = 92, R_PEG = 188;
const compact = (a) => a >= 1e6 ? `${+(a / 1e6).toFixed(1)}M` : a >= 1000 ? `${+(a / 1000).toFixed(1)}K` : `${+a.toFixed(2)}`;
const chipColor = (a) => CHIP_COLORS[Math.max(0, CHIPS.filter((c) => c <= a).length - 1)];
const short = (t) => t === "joker" ? "J" : t === "zero" ? "0" : t;
const name = (t) => t === "joker" ? "JOKER" : t === "zero" ? "ZERO" : t;
const mod = (a, m) => ((a % m) + m) % m;
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Point at `deg` clockwise from the top, radius r. */
const pt = (deg, r) => {
  const a = (deg * Math.PI) / 180;
  return `${(C + r * Math.sin(a)).toFixed(3)} ${(C - r * Math.cos(a)).toFixed(3)}`;
};

function wheelMarkup() {
  const h = SEG / 2;
  const wedge = `M${pt(-h, R_OUT)} A${R_OUT} ${R_OUT} 0 0 1 ${pt(h, R_OUT)} L${pt(h, R_IN)} A${R_IN} ${R_IN} 0 0 0 ${pt(-h, R_IN)}Z`;
  const segs = WHEEL_SEGMENTS.map((v, i) => {
    let label;
    if (v === "joker") label = `<rect x="192" y="22" width="16" height="38" rx="2.5" class="mw-plaque"/><text x="200" y="35" class="mw-star">★</text><text x="200" y="51" class="mw-num sm">J</text><text transform="translate(200 116) rotate(90)" class="mw-radial">JOKER</text>`;
    else if (v === "zero") label = `<rect x="192" y="22" width="16" height="38" rx="2.5" class="mw-plaque dark"/><text x="200" y="33" class="mw-slash">//</text><text x="200" y="49" class="mw-num zero">0</text><text transform="translate(200 116) rotate(90)" class="mw-radial">ZERO</text>`;
    else label = `<rect x="192" y="22" width="16" height="38" rx="2.5" class="mw-plaque"/><text x="200" y="41.5" class="mw-num${v.length > 1 ? " sm" : ""}">${v}</text><text transform="translate(200 114) rotate(90)" class="mw-radial faint">${v}:1</text>`;
    return `<g class="mw-seg" data-i="${i}" data-v="${v}" style="--c:${COLOR[v]}" transform="rotate(${(i * SEG).toFixed(4)} ${C} ${C})"><path d="${wedge}" class="mw-wedge"/>${label}</g>`;
  }).join("");
  const pegs = WHEEL_SEGMENTS.map((_, i) => {
    const [x, y] = pt(i * SEG + h, R_PEG).split(" ");
    return `<circle cx="${x}" cy="${y}" r="2.6" class="mw-peg"/>`;
  }).join("");
  const lines = WHEEL_SEGMENTS.map((_, i) => `<path d="M${pt(i * SEG + h, R_IN)} L${pt(i * SEG + h, R_OUT)}" class="mw-line"/>`).join("");
  return `${segs}${lines}${pegs}`;
}

function spotMarkup(t) {
  const big = t === "joker" ? `<em>★</em>JOKER` : t === "zero" ? `<em>//</em>ZERO` : t;
  return `<button class="mw-spot${t.length > 2 ? " special" : ""}" data-type="${t}" style="--c:${COLOR[t]}" aria-label="Bet on ${name(t)}, pays ${WHEEL_PAYS[t]} to 1">
    <span class="mw-spot-big">${big}</span><span class="mw-spot-pay">${WHEEL_PAYS[t]}:1</span><span class="mw-spot-count">${COUNT[t]} SEG</span><i></i></button>`;
}

export function mount(container, ctx) {
  let bets = new Map(), last = null, undo = [], chip = 5, busy = false, visible = false, history = load(), angle = 0, abort = null;
  function sk() { return `number-zero-money-wheel:${ctx.mode()}`; }
  function load() { try { return JSON.parse(localStorage.getItem(sk())) || []; } catch { return []; } }
  container.innerHTML = `<section class="mw">
    <main class="mw-stage">
      <div class="mw-wheel">
        <svg viewBox="0 -26 400 426" aria-hidden="true">
          <defs>
            <radialGradient id="mw-shade" cx="50%" cy="50%" r="50%"><stop offset=".48" stop-color="#000" stop-opacity=".55"/><stop offset=".8" stop-color="#000" stop-opacity=".1"/><stop offset="1" stop-color="#fff" stop-opacity=".08"/></radialGradient>
            <linearGradient id="mw-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a3"/><stop offset=".5" stop-color="#d9a640"/><stop offset="1" stop-color="#7a5418"/></linearGradient>
          </defs>
          <circle cx="${C}" cy="${C}" r="198" class="mw-rim"/>
          <circle cx="${C}" cy="${C}" r="192" class="mw-rim-in"/>
          <g class="mw-rotor">${wheelMarkup()}</g>
          <circle cx="${C}" cy="${C}" r="${R_OUT}" fill="url(#mw-shade)" pointer-events="none"/>
          <circle cx="${C}" cy="${C}" r="${R_IN}" class="mw-hub-ring"/>
          <circle cx="${C}" cy="${C}" r="${R_IN - 9}" class="mw-hub"/>
          <text x="${C}" y="${C - 34}" class="mw-brand">NUMBER<tspan>//</tspan>ZERO</text>
          <text x="${C}" y="${C + 8}" class="mw-hub-val">?</text>
          <text x="${C}" y="${C + 46}" class="mw-hub-sub">PLACE BETS</text>
          <g class="mw-clapper"><path d="M200 34 L190.5 -4 Q200 -17 209.5 -4 Z" class="mw-flap"/><circle cx="200" cy="-6" r="4.2" class="mw-hinge"/></g>
        </svg>
      </div>
    </main>
    <aside class="mw-board">
      <header><b>MONEY WHEEL</b><small>BIG SIX · 54 SEGMENTS · UP TO 40:1</small></header>
      <div class="mw-history"></div>
      <div class="mw-banner" aria-live="polite"><b>PLACE YOUR BETS</b><small>PICK A CHIP, TAP A SPOT</small></div>
      <div class="mw-spots">${TYPES.map(spotMarkup).join("")}</div>
      <div class="mw-chips">${CHIPS.map((v, i) => `<button data-chip="${v}" style="--chip:${CHIP_COLORS[i]}" aria-label="Chip ${v}">${v >= 1000 ? v / 1000 + "K" : v}</button>`).join("")}</div>
      <div class="mw-tools">${["clear", "undo", "rebet", "double"].map((x) => `<button data-tool="${x}">${x === "double" ? "2×" : x.toUpperCase()}</button>`).join("")}</div>
      <footer><div class="mw-total"><span>TOTAL STAKE</span><b>0.00 CR</b></div><button class="mw-spin">SPIN <span>SPACE</span></button></footer>
    </aside>
  </section>`;
  const $ = (s) => container.querySelector(s);
  const rotor = $(".mw-rotor"), clapper = $(".mw-clapper");

  function render() {
    container.querySelectorAll(".mw-spot").forEach((el) => {
      const a = bets.get(el.dataset.type) || 0, token = el.querySelector("i");
      token.textContent = a ? compact(a) : "";
      token.title = a ? `${ctx.money(a)} CR` : "";
      token.style.setProperty("--chip", a ? chipColor(a) : "transparent");
      el.classList.toggle("has-bet", !!a);
      el.disabled = busy;
    });
    container.querySelectorAll("[data-chip]").forEach((x) => x.classList.toggle("active", +x.dataset.chip === chip));
    container.querySelectorAll("[data-tool]").forEach((x) => {
      const t = x.dataset.tool;
      x.disabled = busy || (t === "undo" ? !undo.length : t === "rebet" ? !last : !bets.size);
    });
    const total = [...bets.values()].reduce((a, b) => a + b, 0);
    $(".mw-total b").textContent = `${ctx.money(total)} CR`;
    $(".mw-spin").disabled = busy || !total || total > ctx.balance();
    $(".mw-history").innerHTML = `<small>LAST</small>${history.slice(-16).reverse().map((v) => `<b style="--c:${COLOR[v]}" class="${v.length > 2 ? "special" : ""}">${short(v)}</b>`).join("") || "<small>NO SPINS YET</small>"}`;
  }
  function set(next) { undo.push(new Map(bets)); undo = undo.slice(-50); bets = next; render(); }
  function banner(cls, big, small) { const b = $(".mw-banner"); b.className = `mw-banner ${cls}`; b.innerHTML = `<b>${big}</b><small>${small}</small>`; }
  function hub(val, sub, color) {
    const v = $(".mw-hub-val");
    v.textContent = val; v.style.fill = color || ""; v.classList.toggle("long", val.length > 2);
    $(".mw-hub-sub").textContent = sub;
  }
  function setAngle(a) { rotor.setAttribute("transform", `rotate(${a.toFixed(3)} ${C} ${C})`); }

  /** Rotates the rotor from `angle` to `to` with an ease-out, ticking the clapper on every peg. Resolves early on abort. */
  function animate(to, duration) {
    return new Promise((done) => {
      const from = angle, delta = to - from, t0 = performance.now(), reduced = ctx.reducedMotion();
      let pegs = Math.floor((from + SEG / 2) / SEG), lastClick = 0, kick = -1e9;
      // Safety net: if frames are throttled (background tab, busy device) the wheel still lands on time.
      const guard = setTimeout(() => abort === finish && finish(), duration + 400);
      const finish = () => { clearTimeout(guard); abort = null; angle = to; setAngle(to); clapper.removeAttribute("transform"); done(); };
      abort = finish;
      const frame = (now) => {
        if (abort !== finish) return;
        const t = Math.min(1, (now - t0) / duration), e = 1 - Math.pow(1 - t, 4), a = from + delta * e;
        setAngle(a);
        const p = Math.floor((a + SEG / 2) / SEG);
        if (p !== pegs) {
          pegs = p; kick = now;
          if (now - lastClick > (reduced ? 120 : 45)) { lastClick = now; ctx.sound(1500 + Math.random() * 300, 0.018, "square", 0.018); }
        }
        const k = Math.max(0, 1 - (now - kick) / 110);
        clapper.setAttribute("transform", `rotate(${(-24 * k).toFixed(2)} 200 -6)`);
        if (t < 1) requestAnimationFrame(frame); else finish();
      };
      requestAnimationFrame(frame);
    });
  }

  async function spin() {
    if (busy || !bets.size) return;
    const total = [...bets.values()].reduce((a, b) => a + b, 0);
    if (total > ctx.balance()) { ctx.toast("Not enough credits for this stake", "loss"); return; }
    busy = true; render();
    container.querySelectorAll(".hit,.win").forEach((x) => x.classList.remove("hit", "win"));
    const placed = [...bets].map(([type, amount]) => ({ type, amount })), mode = ctx.mode(), stake = new Map(bets);
    banner("spinning", "NO MORE BETS", "WHEEL IS SPINNING…");
    let res;
    try { res = await ctx.request("/casino/money-wheel", { bets: placed }, { reveal: true }); }
    catch (e) { busy = false; render(); banner("", "PLACE YOUR BETS", "PICK A CHIP, TAP A SPOT"); ctx.toast(e.message, "loss"); return; }
    if (ctx.mode() !== mode) { res.reveal(); return; }
    const r = res.round, reduced = ctx.reducedMotion();
    hub("…", "SPINNING");
    // Segment i is centred at i·SEG; rotating the rotor by −(i·SEG + offset) puts that point under the top pointer.
    const offset = (Math.random() - 0.5) * SEG * 0.76;
    const target = mod(-(r.segment * SEG + offset), 360);
    const to = angle + (reduced ? 1 : 5) * 360 + mod(target - angle, 360);
    await animate(to, reduced ? 650 : 5200);
    res.reveal();
    if (ctx.mode() !== mode) return;
    last = stake;
    history.push(r.value); history = history.slice(-30);
    try { localStorage.setItem(sk(), JSON.stringify(history)); } catch {}
    container.querySelector(`.mw-seg[data-i="${r.segment}"]`)?.classList.add("hit");
    const spot = container.querySelector(`.mw-spot[data-type="${r.value}"]`);
    spot?.classList.add("hit");
    const won = r.bets.find((b) => b.payout > 0);
    if (won) spot?.classList.add("win");
    const net = r.payout - r.wager;
    hub(r.value === "joker" ? "★" : r.value === "zero" ? "0" : r.value, r.value === "joker" ? "JOKER · 40:1" : r.value === "zero" ? "ZERO · 40:1" : `${WHEEL_PAYS[r.value]}:1`, COLOR[r.value]);
    if (won) {
      banner("won", `${name(r.value)} · WIN ${ctx.money(r.payout)} CR`, `NET +${ctx.money(net)} CR · STAKE ${ctx.money(r.wager)}`);
      ctx.sound(880, 0.12, "triangle", 0.06); setTimeout(() => ctx.sound(1320, 0.22, "triangle", 0.06), 120);
      if (net > 0) ctx.toast("Money Wheel win", "win", `+${ctx.money(net)} CR net`);
    } else {
      banner("lost", `${name(r.value)} · NO WIN`, `STAKE ${ctx.money(r.wager)} CR LOST`);
      ctx.sound(170, 0.2, "sawtooth", 0.025);
    }
    busy = false; render();
  }

  container.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.type) {
      const n = new Map(bets);
      n.set(b.dataset.type, Math.round(((n.get(b.dataset.type) || 0) + chip) * 100) / 100);
      set(n); ctx.sound(520, 0.04, "triangle", 0.03);
    }
    else if (b.dataset.chip) { chip = +b.dataset.chip; render(); }
    else if (b.dataset.tool === "undo" && undo.length) { bets = undo.pop(); render(); }
    else if (b.dataset.tool === "clear") set(new Map());
    else if (b.dataset.tool === "rebet" && last) set(new Map(last));
    else if (b.dataset.tool === "double") set(new Map([...bets].map(([k, v]) => [k, v * 2])));
    else if (b.classList.contains("mw-spin")) spin();
  });
  container.addEventListener("contextmenu", (e) => {
    const b = e.target.closest(".mw-spot");
    if (!b || busy || !bets.has(b.dataset.type)) return;
    e.preventDefault();
    const n = new Map(bets); n.delete(b.dataset.type); set(n);
  });
  document.addEventListener("keydown", (e) => {
    if (!visible || e.repeat || (e.code !== "Space" && e.key !== "Enter") || e.target.closest?.("input,select,textarea,dialog")) return;
    if (!container.offsetParent) return;
    e.preventDefault(); spin();
  });
  ctx.onModeChange(() => {
    abort?.();
    busy = false; bets = new Map(); last = null; undo = []; history = load();
    container.querySelectorAll(".hit,.win").forEach((x) => x.classList.remove("hit", "win"));
    banner("", "PLACE YOUR BETS", "PICK A CHIP, TAP A SPOT"); hub("?", "PLACE BETS");
    render();
  });
  setAngle(0);
  render();
  return {
    show() { visible = true; history = load(); render(); },
    hide() { visible = false; abort?.(); },
  };
}

import { SLOT_MACHINES, slotRtp } from "../casino-core.js";

const IDS = Object.keys(SLOT_MACHINES);
const BETS = [0.1, 0.5, 1, 2, 5, 10, 50, 100, 500, 1000, 5000];
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

const gem = (fill, light, points) =>
  `<polygon points="${points}" fill="${fill}" stroke="${light}" stroke-width="2.5" stroke-linejoin="round"/><polygon points="${points}" fill="url(#sl-shine)" transform="scale(.62) translate(19.6 19.6)"/>`;

/** Inline SVG artwork per symbol (64×64 viewBox, no image files). */
const ART = {
  cherry: `<path d="M22 40c4-14 12-24 24-30M42 44c-1-12 0-22 4-34" fill="none" stroke="#3fa34d" stroke-width="3.5" stroke-linecap="round"/><path d="M46 10c-6 0-12 3-14 8 6 1 11-2 14-8z" fill="#58c464"/><circle cx="21" cy="45" r="11" fill="#e8243c"/><circle cx="42" cy="47" r="11" fill="#c8102e"/><circle cx="17" cy="41" r="3" fill="#fff8"/><circle cx="38" cy="43" r="3" fill="#fff8"/>`,
  lemon: `<ellipse cx="32" cy="34" rx="22" ry="16" fill="#ffe14a" transform="rotate(-20 32 34)"/><path d="M12 42l-4 3M52 26l4-3" stroke="#e8c21a" stroke-width="5" stroke-linecap="round"/><ellipse cx="25" cy="29" rx="7" ry="3.5" fill="#fff6" transform="rotate(-20 25 29)"/>`,
  orange: `<circle cx="32" cy="36" r="20" fill="#ff9417"/><circle cx="32" cy="36" r="20" fill="url(#sl-dots)"/><path d="M32 16c4-6 10-8 16-6-3 6-9 8-16 6z" fill="#3fa34d"/><ellipse cx="24" cy="28" rx="6" ry="4" fill="#fff5"/>`,
  plum: `<path d="M32 16c14 0 20 10 20 21s-9 19-20 19-20-8-20-19 6-21 20-21z" fill="#8a3fd1"/><path d="M32 18c-2 10-2 26 0 37" stroke="#6a24a8" stroke-width="2" fill="none"/><path d="M32 16c2-5 6-8 12-8-1 5-6 8-12 8z" fill="#3fa34d"/><ellipse cx="23" cy="29" rx="5" ry="7" fill="#fff4"/>`,
  grape: `<path d="M32 12v8" stroke="#6b4a2a" stroke-width="3" stroke-linecap="round"/><path d="M33 14c6-4 12-3 15 0-6 4-11 3-15 0z" fill="#3fa34d"/>${[[24, 24], [34, 24], [44, 24], [29, 33], [39, 33], [24, 42], [34, 42], [44, 42], [29, 51], [39, 51]].filter((p, i) => i !== 5 && i !== 7).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6.2" fill="#7d3cc8"/><circle cx="${x - 2}" cy="${y - 2}" r="1.8" fill="#fff6"/>`).join("")}`,
  melon: `<path d="M8 26h48a24 24 0 0 1-48 0z" fill="#2fa84f"/><path d="M12 26h40a20 20 0 0 1-40 0z" fill="#ff4d6d"/><g fill="#1b1b24"><ellipse cx="22" cy="34" rx="1.6" ry="2.6"/><ellipse cx="32" cy="38" rx="1.6" ry="2.6"/><ellipse cx="42" cy="34" rx="1.6" ry="2.6"/><ellipse cx="27" cy="43" rx="1.6" ry="2.6"/><ellipse cx="37" cy="43" rx="1.6" ry="2.6"/></g>`,
  bell: `<path d="M32 10c-11 0-16 9-16 20v10l-5 7h42l-5-7V30c0-11-5-20-16-20z" fill="#ffd43b" stroke="#c99a10" stroke-width="2"/><circle cx="32" cy="51" r="5" fill="#c99a10"/><path d="M24 22c2-4 5-6 8-6" stroke="#fff9" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  bar: `<rect x="6" y="20" width="52" height="24" rx="5" fill="#141824" stroke="#ffd43b" stroke-width="2.5"/><text x="32" y="39" text-anchor="middle" font-family="Barlow Condensed" font-weight="900" font-size="20" fill="#ffd43b" letter-spacing="2">BAR</text>`,
  seven: `<text x="32" y="54" text-anchor="middle" font-family="Barlow Condensed" font-weight="900" font-size="58" fill="#ff2e4d" stroke="#ffd43b" stroke-width="2.5" paint-order="stroke">7</text>`,
  wild: `<path d="M32 6l7 16 17 2-13 11 4 17-15-9-15 9 4-17L8 24l17-2z" fill="#b64dff" stroke="#f3c8ff" stroke-width="2" stroke-linejoin="round"/><text x="32" y="40" text-anchor="middle" font-family="Barlow Condensed" font-weight="900" font-size="13" fill="#fff" letter-spacing="1">WILD</text>`,
  emerald: gem("#11b981", "#7dffc8", "22,10 42,10 54,24 54,40 42,54 22,54 10,40 10,24"),
  sapphire: gem("#1e6bff", "#9cc2ff", "32,6 56,32 32,58 8,32"),
  ruby: gem("#e8233f", "#ff9aa9", "14,12 50,12 58,28 32,58 6,28"),
  amethyst: gem("#9b45e8", "#dcb4ff", "32,6 57,25 47,56 17,56 7,25"),
  topaz: gem("#ff9c1a", "#ffd79a", "32,8 50,20 50,44 32,56 14,44 14,20"),
  diamond: `<path d="M16 12h32l12 14-28 32L4 26z" fill="#53e7ff" stroke="#d6fbff" stroke-width="2.5" stroke-linejoin="round"/><path d="M4 26h56M16 12l8 14 8-14 8 14 8-14M24 26l8 32 8-32" fill="none" stroke="#d6fbff" stroke-width="1.6" opacity=".8"/>`,
  crown: `<path d="M8 46L6 18l14 12 12-18 12 18 14-12-2 28z" fill="#ffd43b" stroke="#fff1a8" stroke-width="2" stroke-linejoin="round"/><rect x="8" y="46" width="48" height="8" rx="2" fill="#e0a800"/><circle cx="32" cy="36" r="4" fill="#ff4d6d"/><circle cx="19" cy="40" r="3" fill="#53e7ff"/><circle cx="45" cy="40" r="3" fill="#53e7ff"/>`,
};
const DEFS = `<svg width="0" height="0" aria-hidden="true" style="position:absolute"><defs><linearGradient id="sl-shine" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient><pattern id="sl-dots" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r=".8" fill="#c96a00"/></pattern></defs></svg>`;

const art = (symbol) => `<svg viewBox="0 0 64 64" aria-hidden="true">${ART[symbol] || ""}</svg>`;
const cell = (symbol) => `<div class="sl-symbol s-${symbol}" data-symbol="${symbol}" title="${symbol}">${art(symbol)}</div>`;

export function mount(container, ctx) {
  let machine = localStorage.getItem("nz-slot-machine");
  if (!SLOT_MACHINES[machine]) machine = IDS[0];
  let bet = 1;
  let busy = false;
  let visible = false;
  let spinToken = 0;
  let grid = null;
  const recent = [];

  container.innerHTML = `<section class="sl">${DEFS}
    <nav class="sl-select" aria-label="Slot machines"></nav>
    <div class="sl-cabinet">
      <header><small></small><strong></strong><span></span></header>
      <div class="sl-screen"><div class="sl-reels"></div><svg class="sl-lines" viewBox="0 0 100 100" preserveAspectRatio="none"></svg></div>
      <div class="sl-message">READY</div>
      <div class="sl-pay" hidden></div>
    </div>
    <aside class="sl-panel">
      <div class="sl-recent"><small>RECENT SPINS</small><ol></ol></div>
      <label>TOTAL BET<select class="sl-bet"></select></label>
      <p>LINE BET <b class="sl-linebet"></b></p>
      <p class="sl-win-row">WIN <strong class="sl-win">0.00 CR</strong></p>
      <button class="sl-spin" type="button">SPIN <kbd>SPACE</kbd></button>
      <button class="sl-pay-toggle" type="button">PAYTABLE</button>
    </aside></section>`;
  const root = container.querySelector(".sl");
  const $ = (selector) => container.querySelector(selector);
  const spec = () => SLOT_MACHINES[machine];

  const validBets = () => BETS.filter((value) => Math.round(value * 100) % spec().lines.length === 0);
  const randomColumn = (reel, count) => Array.from({ length: count }, () => reel[Math.floor(Math.random() * reel.length)]);

  function draw(nextGrid) {
    grid = nextGrid;
    $(".sl-reels").innerHTML = grid.map((column, i) => `<div class="sl-reel" data-reel="${i}"><div class="sl-strip">${column.map(cell).join("")}</div></div>`).join("");
  }

  function configure() {
    const m = spec();
    root.dataset.machine = machine;
    root.style.setProperty("--reels", m.reels.length);
    $(".sl-cabinet header strong").textContent = m.name;
    $(".sl-cabinet header span").textContent = m.tagline;
    $(".sl-cabinet header small").textContent = `RTP ${(slotRtp(m) * 100).toFixed(2)}%`;
    $(".sl-select").innerHTML = IDS.map((id) => {
      const x = SLOT_MACHINES[id];
      return `<button type="button" data-machine="${id}" class="${id === machine ? "active" : ""}"><span class="sl-select-art">${art(id === "lucky-sevens" ? "seven" : id === "fruit-frenzy" ? "cherry" : "diamond")}</span><span><b>${x.name}</b><small>${x.tagline}</small></span></button>`;
    }).join("");
    const values = validBets();
    if (!values.includes(bet)) bet = values.find((x) => x >= 1) || values[0];
    $(".sl-bet").innerHTML = values.map((x) => `<option value="${x}" ${x === bet ? "selected" : ""}>${ctx.money(x)} CR</option>`).join("");
    $(".sl-linebet").textContent = `${ctx.money(bet / m.lines.length)} × ${m.lines.length}`;
    $(".sl-pay").innerHTML = `<header><b>${m.name} paytable</b><small>× line bet${m.wild ? " · WILD substitutes" : ""} · pays left to right</small></header>${Object.entries(m.pays).map(([symbol, pays]) => `<div><span class="sl-pay-art">${art(symbol)}</span><b>${symbol}</b><span>${Object.entries(pays).map(([n, x]) => `<em>${n}×</em> ${x}`).join(" · ")}</span></div>`).join("")}`;
    $(".sl-win").textContent = "0.00 CR";
    $(".sl-message").textContent = "READY";
    $(".sl-message").className = "sl-message";
    $(".sl-lines").innerHTML = "";
    draw(m.reels.map((reel, i) => [0, 1, 2].map((j) => reel[(i * 5 + j * 2) % reel.length])));
    localStorage.setItem("nz-slot-machine", machine);
    controls();
  }

  function controls() {
    $(".sl-spin").disabled = busy || bet > ctx.balance();
    $(".sl-bet").disabled = busy;
    container.querySelectorAll("button[data-machine]").forEach((x) => (x.disabled = busy));
  }

  function linePath(line) {
    const n = spec().reels.length;
    return line.map((row, i) => `${i ? "L" : "M"} ${((i + 0.5) / n) * 100} ${((row + 0.5) / 3) * 100}`).join(" ");
  }

  function startSpinning() {
    const fast = ctx.reducedMotion();
    container.querySelectorAll(".sl-reel").forEach((reel, i) => {
      const strip = randomColumn(spec().reels[i], 6);
      reel.querySelector(".sl-strip").innerHTML = [...strip, ...strip].map(cell).join("");
      reel.classList.remove("stop");
      reel.classList.add("spinning");
      if (fast) reel.classList.add("calm");
    });
  }

  function stopReel(i, column) {
    const reel = $(`[data-reel="${i}"]`);
    if (!reel) return;
    reel.classList.remove("spinning", "calm");
    reel.querySelector(".sl-strip").innerHTML = column.map(cell).join("");
    void reel.offsetWidth;
    reel.classList.add("stop");
  }

  function countUp(amount) {
    const start = performance.now();
    const duration = ctx.reducedMotion() ? 1 : 700;
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      $(".sl-win").textContent = `${ctx.money(amount * p)} CR`;
      if (p < 1 && visible) requestAnimationFrame(step);
      else $(".sl-win").textContent = `${ctx.money(amount)} CR`;
    };
    requestAnimationFrame(step);
  }

  async function spin() {
    if (busy || bet > ctx.balance()) return;
    busy = true;
    controls();
    $(".sl-pay").hidden = true;
    $(".sl-lines").innerHTML = "";
    $(".sl-win").textContent = "0.00 CR";
    $(".sl-message").className = "sl-message";
    $(".sl-message").textContent = "GOOD LUCK…";
    root.classList.remove("has-wins");
    const token = ++spinToken;
    const m = spec();
    const started = performance.now();
    const fast = ctx.reducedMotion();
    startSpinning();
    let result;
    try {
      result = await ctx.request("/casino/slots", { bet, machine }, { reveal: true });
    } catch (error) {
      if (token === spinToken) {
        grid.forEach((column, i) => stopReel(i, column));
        $(".sl-message").textContent = "READY";
      }
      busy = false;
      controls();
      ctx.toast(error.message, "loss");
      return;
    }
    const round = result.round;
    const firstStop = fast ? 120 : 650;
    const gap = fast ? 70 : 260;
    await wait(Math.max(0, firstStop - (performance.now() - started)));
    for (let i = 0; i < m.reels.length; i++) {
      if (token !== spinToken) {
        result.reveal();
        return;
      }
      stopReel(i, round.grid[i]);
      ctx.sound(200 + i * 40, 0.07, "square", 0.03);
      if (i < m.reels.length - 1) await wait(gap);
    }
    grid = round.grid;
    result.reveal();
    if (round.wins.length) {
      root.classList.add("has-wins");
      for (const win of round.wins) {
        const line = m.lines[win.line];
        for (let reel = 0; reel < win.count; reel++) {
          container.querySelector(`[data-reel="${reel}"] .sl-symbol:nth-child(${line[reel] + 1})`)?.classList.add("hit");
        }
      }
      $(".sl-lines").innerHTML = round.wins.map((win, j) => `<path d="${linePath(m.lines[win.line])}" class="l${j % 4}"/>`).join("");
      countUp(round.payout);
      const top = round.wins.reduce((a, b) => (b.payout > a.payout ? b : a));
      $(".sl-message").className = "sl-message win";
      $(".sl-message").textContent = round.wins.length > 1 ? `${round.wins.length} LINES · WIN ${ctx.money(round.payout)} CR` : `${top.count}× ${top.symbol.toUpperCase()} · WIN ${ctx.money(round.payout)} CR`;
      ctx.sound(660, 0.12, "triangle", 0.05);
      setTimeout(() => ctx.sound(990, 0.16, "triangle", 0.05), 120);
      if (round.payout >= bet * 20) {
        $(".sl-cabinet").classList.add("big");
        ctx.toast("BIG WIN!", "win", `${ctx.money(round.payout)} CR`);
        setTimeout(() => $(".sl-cabinet")?.classList.remove("big"), 1800);
      }
    } else {
      $(".sl-message").textContent = "NO WIN · SPIN AGAIN";
    }
    recent.unshift({ name: m.name, bet, payout: round.payout });
    recent.length = Math.min(recent.length, 12);
    renderRecent();
    busy = false;
    controls();
  }

  function renderRecent() {
    $(".sl-recent ol").innerHTML = recent.length
      ? recent.map((x) => `<li class="${x.payout ? "won" : ""}"><span>${x.name}</span><span>${ctx.money(x.bet)}</span><b>${x.payout ? `+${ctx.money(x.payout)}` : "—"}</b></li>`).join("")
      : "<li class=\"empty\">No spins yet</li>";
  }

  container.addEventListener("click", (event) => {
    const pick = event.target.closest("button[data-machine]");
    if (pick && !busy && pick.dataset.machine !== machine) {
      machine = pick.dataset.machine;
      configure();
    }
    if (event.target.closest(".sl-spin")) spin();
    if (event.target.closest(".sl-pay-toggle")) $(".sl-pay").hidden = !$(".sl-pay").hidden;
    else if (event.target.closest(".sl-pay")) $(".sl-pay").hidden = true;
  });
  $(".sl-bet").addEventListener("change", (event) => {
    bet = Number(event.target.value);
    configure();
  });
  document.addEventListener("keydown", (event) => {
    if (!visible || event.repeat || !(event.key === " " || event.key === "Enter")) return;
    if (event.target.closest?.("input,select,textarea,dialog,button")) return;
    event.preventDefault();
    spin();
  });
  ctx.onModeChange(() => {
    spinToken++;
    busy = false;
    recent.length = 0;
    renderRecent();
    configure();
  });
  configure();
  renderRecent();

  return {
    show() {
      visible = true;
      controls();
    },
    hide() {
      visible = false;
      spinToken++;
      busy = false;
      if (container.querySelector(".sl-reel.spinning")) grid.forEach((column, i) => stopReel(i, column));
    },
    select(options) {
      if (SLOT_MACHINES[options?.machine] && !busy) {
        machine = options.machine;
        configure();
      }
    },
  };
}

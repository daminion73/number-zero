// Performance over time, from /api/profile/performance (cumulative net P/L of online plays):
// the zoomable chart on the profile page and the live session panel shown while playing.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SESSION_KEY = "nz-session-start";
const POSITION_KEY = "nz-session-position";
const money = (value) => Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (value) => `${value >= 0 ? "+" : "−"}${money(Math.abs(value))}`;
const tone = (value) => (value > 0 ? "positive" : value < 0 ? "negative" : "");
let chartIds = 0;

const fetchPerformance = (account, from, to, buckets) =>
  account.api(`/profile/performance?from=${Math.floor(from)}&to=${Math.ceil(to)}&buckets=${buckets}`).then((result) => result.performance);

/** Chart points: the carried-in net at `from`, every bucket, then flat to the window's end (or now). */
function seriesOf(performance) {
  const end = Math.min(performance.to, Date.now());
  const points = [{ at: performance.from, net: performance.start }, ...performance.points];
  if (end > points.at(-1).at) points.push({ at: end, net: performance.end });
  return points;
}

/** SVG markup plus the scales used to place the hover marker. */
function chartSvg(performance, width, height) {
  const id = `nz-chart-${++chartIds}`;
  const series = seriesOf(performance);
  const values = [0, ...series.map((point) => point.net)];
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (high - low < 0.01) [low, high] = [low - 1, high + 1];
  const pad = (high - low) * 0.1;
  low -= pad;
  high += pad;
  const span = performance.to - performance.from;
  const x = (at) => ((at - performance.from) / span) * width;
  const y = (net) => height - ((net - low) / (high - low)) * height;
  const zero = y(0);
  // Steps: the net holds until the next play settles, then jumps.
  const line = series
    .flatMap((point, index) => [...(index ? [[point.at, series[index - 1].net]] : []), [point.at, point.net]])
    .map(([at, net]) => `${x(at).toFixed(1)},${y(net).toFixed(1)}`)
    .join(" ");
  const area = `M${x(series[0].at).toFixed(1)},${zero.toFixed(1)} L${line.replaceAll(" ", " L")} L${x(series.at(-1).at).toFixed(1)},${zero.toFixed(1)} Z`;
  const svg = `<svg class="nz-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Cumulative net profit and loss over time">
    <defs>
      <linearGradient id="${id}-up" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#c7ff36" stop-opacity=".35"/><stop offset="1" stop-color="#c7ff36" stop-opacity="0"/></linearGradient>
      <linearGradient id="${id}-down" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#ff587b" stop-opacity="0"/><stop offset="1" stop-color="#ff587b" stop-opacity=".35"/></linearGradient>
      <clipPath id="${id}-above"><rect width="${width}" height="${Math.max(0, zero)}"/></clipPath>
      <clipPath id="${id}-below"><rect y="${zero}" width="${width}" height="${Math.max(0, height - zero)}"/></clipPath>
    </defs>
    <line class="nz-chart-zero" x1="0" x2="${width}" y1="${zero}" y2="${zero}"/>
    <path d="${area}" fill="url(#${id}-up)" clip-path="url(#${id}-above)"/><path d="${area}" fill="url(#${id}-down)" clip-path="url(#${id}-below)"/>
    <polyline points="${line}" class="nz-chart-up" clip-path="url(#${id}-above)"/><polyline points="${line}" class="nz-chart-down" clip-path="url(#${id}-below)"/>
    <line class="nz-chart-cross" y1="0" y2="${height}" hidden/><circle class="nz-chart-dot" r="5" hidden/>
  </svg>`;
  return { svg, series, x, y, low, high };
}

function timeLabel(at, span) {
  const date = new Date(at);
  if (span <= 15 * MINUTE) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (span <= 2 * DAY) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (span <= 120 * DAY) return date.toLocaleDateString([], { day: "numeric", month: "short" });
  return date.toLocaleDateString([], { month: "short", year: "numeric" });
}

/** Shows the nearest point under the pointer. */
function bindHover(wrap, chart, width) {
  const svg = wrap.querySelector("svg");
  const cross = svg.querySelector(".nz-chart-cross");
  const dot = svg.querySelector(".nz-chart-dot");
  const tip = wrap.querySelector(".nz-chart-tip");
  svg.addEventListener("pointermove", (event) => {
    const bounds = svg.getBoundingClientRect();
    const px = ((event.clientX - bounds.left) / bounds.width) * width;
    const point = chart.series.reduce((best, item) => (Math.abs(chart.x(item.at) - px) < Math.abs(chart.x(best.at) - px) ? item : best));
    const cx = chart.x(point.at);
    cross.setAttribute("x1", cx);
    cross.setAttribute("x2", cx);
    dot.setAttribute("cx", cx);
    dot.setAttribute("cy", chart.y(point.net));
    cross.hidden = dot.hidden = tip.hidden = false;
    tip.style.left = `${(cx / width) * 100}%`;
    tip.style.transform = `translateX(${cx / width > 0.75 ? "-100%" : cx / width < 0.25 ? "0" : "-50%"})`;
    tip.innerHTML = `<strong class="${tone(point.net)}">${signed(point.net)} CR</strong><small>${new Date(point.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small>`;
  });
  svg.addEventListener("pointerleave", () => {
    cross.hidden = dot.hidden = tip.hidden = true;
  });
}

// ── Profile chart ────────────────────────────────────────────────────────────
const PRESETS = [["1H", HOUR], ["24H", DAY], ["7D", 7 * DAY], ["30D", 30 * DAY], ["ALL", null]];
const WIDTH = 1000;
const HEIGHT = 280;
const MIN_SPAN = 30_000;

/**
 * Lifetime chart on a time axis: range presets, drag to zoom into a span, scroll to zoom around the
 * pointer, double-click to reset. Each window is re-fetched, so zooming in shows finer detail.
 */
export function mountPerformanceChart(root, { account, firstPlayAt }) {
  let preset = "ALL";
  let view = null; // { from, to } while zoomed
  let request = 0;
  let wheelTimer = 0;
  // ALL starts just before the first play (5% of the span, at least a minute).
  const allFrom = () => {
    const first = firstPlayAt ?? Date.now();
    return first - Math.max(MINUTE, (Date.now() - first) * 0.05);
  };
  const presetWindow = () => {
    const now = Date.now();
    const span = PRESETS.find(([name]) => name === preset)[1];
    return { from: span ? now - span : allFrom(), to: now };
  };
  const windowNow = () => view || presetWindow();

  root.innerHTML = `<div class="nz-perf">
    <div class="nz-perf-bar">
      <div class="nz-perf-presets" role="group" aria-label="Chart range">${PRESETS.map(([name]) => `<button type="button" data-preset="${name}">${name}</button>`).join("")}</div>
      <div class="nz-perf-window"></div>
      <button type="button" class="nz-perf-reset" hidden>RESET ZOOM</button>
    </div>
    <div class="nz-chart-wrap"><div class="nz-chart-plot"></div><div class="nz-chart-axis"></div><div class="nz-chart-times"></div><div class="nz-chart-select" hidden></div><div class="nz-chart-tip" hidden></div></div>
    <p class="nz-perf-hint">DRAG ACROSS THE CHART OR SCROLL TO ZOOM · DOUBLE-CLICK TO RESET</p>
  </div>`;
  const wrap = root.querySelector(".nz-chart-wrap");
  const plot = root.querySelector(".nz-chart-plot");
  const select = root.querySelector(".nz-chart-select");

  async function load() {
    const id = ++request;
    const { from, to } = windowNow();
    root.querySelectorAll("[data-preset]").forEach((button) => button.classList.toggle("active", !view && button.dataset.preset === preset));
    root.querySelector(".nz-perf-reset").hidden = !view;
    wrap.classList.add("loading");
    try {
      const performance = await fetchPerformance(account, from, to, 400);
      if (id !== request) return;
      const chart = chartSvg(performance, WIDTH, HEIGHT);
      plot.innerHTML = chart.svg;
      root.querySelector(".nz-chart-axis").innerHTML = `<span>${signed(chart.high)}</span><span>${signed((chart.high + chart.low) / 2)}</span><span>${signed(chart.low)}</span>`;
      root.querySelector(".nz-chart-times").innerHTML = [0, 0.25, 0.5, 0.75, 1].map((ratio) => `<span>${timeLabel(from + (to - from) * ratio, to - from)}</span>`).join("");
      const totals = performance.totals;
      root.querySelector(".nz-perf-window").innerHTML = `<b class="${tone(totals.net)}">${signed(totals.net)} CR</b><span>${totals.plays.toLocaleString()} PLAYS IN VIEW${totals.plays ? ` · ${((totals.wins / totals.plays) * 100).toFixed(1)}% WON` : ""}</span>`;
      bindHover(wrap, chart, WIDTH);
    } catch (error) {
      if (id === request) plot.innerHTML = `<div class="nz-chart-empty">${error.message}</div>`;
    } finally {
      if (id === request) wrap.classList.remove("loading");
    }
  }

  function zoomTo(from, to) {
    const now = Date.now();
    if (to - from < MIN_SPAN) {
      const middle = (from + to) / 2;
      [from, to] = [middle - MIN_SPAN / 2, middle + MIN_SPAN / 2];
    }
    to = Math.min(to, now);
    from = Math.max(Math.min(from, to - MIN_SPAN), allFrom() - DAY);
    view = { from, to };
    load();
  }

  const ratioAt = (event) => {
    const bounds = plot.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
  };
  root.querySelector(".nz-perf-presets").addEventListener("click", (event) => {
    const button = event.target.closest("[data-preset]");
    if (!button) return;
    preset = button.dataset.preset;
    view = null;
    load();
  });
  root.querySelector(".nz-perf-reset").addEventListener("click", () => {
    view = null;
    load();
  });
  plot.addEventListener("dblclick", () => {
    view = null;
    load();
  });
  let drag = null;
  plot.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { start: ratioAt(event), end: ratioAt(event) };
    plot.setPointerCapture(event.pointerId);
  });
  plot.addEventListener("pointermove", (event) => {
    if (!drag) return;
    drag.end = ratioAt(event);
    const [a, b] = [Math.min(drag.start, drag.end), Math.max(drag.start, drag.end)];
    Object.assign(select.style, { left: `${a * 100}%`, width: `${(b - a) * 100}%` });
    select.hidden = b - a < 0.01;
  });
  plot.addEventListener("pointerup", () => {
    if (!drag) return;
    const [a, b] = [Math.min(drag.start, drag.end), Math.max(drag.start, drag.end)];
    drag = null;
    select.hidden = true;
    if (b - a < 0.01) return;
    const { from, to } = windowNow();
    zoomTo(from + (to - from) * a, from + (to - from) * b);
  });
  plot.addEventListener("wheel", (event) => {
    event.preventDefault();
    const { from, to } = windowNow();
    const anchor = from + (to - from) * ratioAt(event);
    const scale = event.deltaY < 0 ? 0.7 : 1 / 0.7;
    view = { from: anchor - (anchor - from) * scale, to: anchor + (to - anchor) * scale };
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => zoomTo(view.from, view.to), 140);
  }, { passive: false });

  load();
}

// ── Live session panel ───────────────────────────────────────────────────────
const RANGES = [["session", "SESSION"], ["today", "TODAY"], ["week", "7 DAYS"]];

/**
 * "How am I doing" while playing: a toggle (`.nz-session-toggle`, placed by the game headers) showing
 * this session's net, and a panel with stats and a time chart. Online plays only. The panel stays open
 * while you play and can be dragged by its header to anywhere on screen.
 */
export function initSessionPanel({ account, navigate }) {
  let active = false;
  let range = "session";
  let data = null;
  let request = 0;
  let refreshTimer = 0;
  let pollTimer = 0;
  let lastBalance = null;
  let sessionNet = null;
  const sessionStart = () => {
    let start = Number(sessionStorage.getItem(SESSION_KEY));
    if (!start) {
      start = Date.now();
      sessionStorage.setItem(SESSION_KEY, String(start));
    }
    return start;
  };
  const rangeFrom = () => {
    if (range === "today") return new Date().setHours(0, 0, 0, 0);
    if (range === "week") return Date.now() - 7 * DAY;
    return sessionStart();
  };

  const panel = document.createElement("aside");
  panel.className = "nz-session";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Live performance");
  document.body.append(panel);

  function renderToggles() {
    const user = account.getUser();
    const net = user ? sessionNet : null;
    document.querySelectorAll(".nz-session-toggle").forEach((button) => {
      button.classList.toggle("open", !panel.hidden);
      button.setAttribute("aria-expanded", String(!panel.hidden));
      const html = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17 9 11l4 4 8-8"/><path d="M15 7h6v6"/></svg><span>SESSION</span>${net === null ? "" : `<b class="${tone(net)}">${signed(net)}</b>`}`;
      if (button.dataset.html !== html) {
        button.dataset.html = html;
        button.innerHTML = html;
      }
    });
  }

  function renderPanel() {
    const user = account.getUser();
    if (!user) {
      panel.innerHTML = `<header><b>LIVE PERFORMANCE</b><button type="button" data-session-close aria-label="Close">×</button></header><p class="nz-session-empty">Demo plays aren't tracked. Sign in and play ONLINE to see how your session is going.</p><button type="button" class="nz-session-signin">SIGN IN →</button>`;
      return;
    }
    const tabs = `<nav class="nz-session-tabs">${RANGES.map(([id, label]) => `<button type="button" data-session-range="${id}" class="${id === range ? "active" : ""}">${label}</button>`).join("")}</nav>`;
    if (!data || data.range !== range) {
      panel.innerHTML = `<header><b>LIVE PERFORMANCE</b><button type="button" data-session-close aria-label="Close">×</button></header>${tabs}<div class="nz-session-loading">LOADING…</div>`;
      return;
    }
    const totals = data.totals;
    const since = range === "session" ? `SINCE ${new Date(data.from).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : range === "today" ? "SINCE MIDNIGHT" : "LAST 7 DAYS";
    const chart = chartSvg({ ...data, start: 0, end: totals.net, points: data.points.map((point) => ({ ...point, net: Math.round((point.net - data.start) * 100) / 100 })) }, 320, 90);
    panel.innerHTML = `<header><b>LIVE PERFORMANCE</b><button type="button" data-session-close aria-label="Close">×</button></header>${tabs}
      <div class="nz-session-net"><small>NET ${since}</small><strong class="${tone(totals.net)}">${signed(totals.net)} <em>CR</em></strong></div>
      <div class="nz-session-chart nz-chart-wrap">${totals.plays ? chart.svg : `<div class="nz-chart-empty">No online plays yet${range === "session" ? " this session" : ""}.</div>`}<div class="nz-chart-tip" hidden></div></div>
      <dl class="nz-session-stats">
        <div><dt>PLAYS</dt><dd>${totals.plays.toLocaleString()}</dd></div>
        <div><dt>WIN RATE</dt><dd>${totals.plays ? `${((totals.wins / totals.plays) * 100).toFixed(1)}%` : "—"}</dd></div>
        <div><dt>WAGERED</dt><dd>${money(totals.wagered)}</dd></div>
        <div><dt>RTP</dt><dd>${totals.wagered ? `${((totals.returned / totals.wagered) * 100).toFixed(1)}%` : "—"}</dd></div>
        <div><dt>BEST WIN</dt><dd>${totals.best ? `+${money(totals.best)}` : "—"}</dd></div>
        <div><dt>BALANCE</dt><dd>${money(account.displayBalance())}</dd></div>
      </dl>
      <footer>${range === "session" ? '<button type="button" data-session-reset>RESTART SESSION</button>' : "<span>ONLINE PLAYS ONLY</span>"}<button type="button" data-session-profile>FULL STATS →</button></footer>`;
    if (totals.plays) bindHover(panel.querySelector(".nz-session-chart"), chart, 320);
  }

  async function refresh() {
    const user = account.getUser();
    if (!active || !user) return;
    // Wait until a round's reveal finishes, so the panel never spoils a result.
    if (account.displayBalance() !== user.balance) return;
    const id = ++request;
    const wanted = range;
    try {
      const performance = await fetchPerformance(account, rangeFrom(), Date.now() + 1000, 120);
      if (id !== request) return;
      data = { ...performance, range: wanted };
      // The toggle always shows the session, even while another range is open.
      sessionNet = wanted === "session" ? performance.totals.net : (await fetchPerformance(account, sessionStart(), Date.now() + 1000, 1)).totals.net;
    } catch {
      return;
    }
    if (id !== request) return;
    if (!panel.hidden) renderPanel();
    renderToggles();
  }

  const scheduleRefresh = (delay = 400) => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, delay);
  };

  /** Where the player last dragged it, else just under the visible toggle; always kept on screen. */
  function place() {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || "null");
    let left, top;
    if (saved) ({ left, top } = saved);
    else {
      const toggle = [...document.querySelectorAll(".nz-session-toggle")].find((button) => button.offsetParent);
      const bounds = toggle?.getBoundingClientRect() || { bottom: 60, right: innerWidth - 8 };
      left = bounds.right - panel.offsetWidth;
      top = bounds.bottom + 8;
    }
    panel.style.left = `${Math.round(Math.max(8, Math.min(left, innerWidth - panel.offsetWidth - 8)))}px`;
    panel.style.top = `${Math.round(Math.max(8, Math.min(top, innerHeight - 60)))}px`;
  }
  let drag = null;
  panel.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".nz-session > header") || event.target.closest("button")) return;
    drag = { x: event.clientX - panel.offsetLeft, y: event.clientY - panel.offsetTop };
    panel.setPointerCapture(event.pointerId);
    panel.classList.add("dragging");
  });
  panel.addEventListener("pointermove", (event) => {
    if (!drag) return;
    localStorage.setItem(POSITION_KEY, JSON.stringify({ left: event.clientX - drag.x, top: event.clientY - drag.y }));
    place();
  });
  panel.addEventListener("pointerup", () => {
    drag = null;
    panel.classList.remove("dragging");
  });
  function open() {
    panel.hidden = false;
    renderPanel();
    place();
    renderToggles();
    refresh();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => scheduleRefresh(0), 15_000);
  }
  function close() {
    panel.hidden = true;
    clearInterval(pollTimer);
    renderToggles();
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest(".nz-session-toggle")) return panel.hidden ? open() : close();
    if (panel.hidden || !event.target.closest(".nz-session")) return;
    if (event.target.closest("[data-session-close]")) return close();
    if (event.target.closest(".nz-session-signin")) {
      close();
      return account.openAccount();
    }
    if (event.target.closest("[data-session-profile]")) {
      close();
      return navigate("profile");
    }
    if (event.target.closest("[data-session-reset]")) {
      sessionStorage.setItem(SESSION_KEY, String(Date.now()));
      data = null;
      renderPanel();
      return refresh();
    }
    const tab = event.target.closest("[data-session-range]");
    if (tab) {
      range = tab.dataset.sessionRange;
      renderPanel();
      refresh();
    }
  });
  addEventListener("resize", () => !panel.hidden && place());

  account.onUser((user) => {
    const balance = user ? `${user.id}:${user.balance}:${account.displayBalance()}` : null;
    if (balance === lastBalance) return;
    lastBalance = balance;
    if (!user) data = null;
    renderToggles();
    if (!panel.hidden) renderPanel();
    scheduleRefresh();
  });

  return {
    /** Focus mode on/off: the toggle only refreshes while a game screen is open. */
    setActive(value) {
      if (value === active) return;
      active = value;
      if (!value) close();
      else {
        renderToggles();
        scheduleRefresh(0);
      }
    },
    /** Re-render toggles after a header containing one was (re)drawn. */
    refreshToggles: renderToggles,
  };
}

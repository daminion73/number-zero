const money = (value) => Number(value || 0).toLocaleString(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const gameName = (value) => String(value || "—").replaceAll("-", " ").toUpperCase();
const signed = (value) => `${value >= 0 ? "+" : "−"}${money(Math.abs(value))}`;

function chartMarkup(series) {
  if (!series.length) return '<div class="chart-empty">Play a game to begin your lifetime graph.</div>';
  const width = 1000;
  const height = 260;
  const maximum = Math.max(1, ...series.map((point) => Math.abs(point.net)));
  const y = (value) => height / 2 - (value / maximum) * (height * 0.42);
  const points = series.map((point, index) => ({
    ...point,
    x: series.length === 1 ? width / 2 : (index / (series.length - 1)) * width,
    y: y(point.net),
  }));
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `M ${points[0].x} ${height / 2} L ${points.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${points.at(-1).x} ${height / 2} Z`;
  return `<div class="profile-chart-wrap">
    <svg class="profile-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Cumulative net profit and loss">
      <defs><linearGradient id="profit-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#c7ff36" stop-opacity=".34"/><stop offset="1" stop-color="#c7ff36" stop-opacity="0"/></linearGradient><linearGradient id="loss-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#ff587b" stop-opacity="0"/><stop offset="1" stop-color="#ff587b" stop-opacity=".34"/></linearGradient><clipPath id="profit-clip"><rect width="${width}" height="${height / 2}"/></clipPath><clipPath id="loss-clip"><rect y="${height / 2}" width="${width}" height="${height / 2}"/></clipPath></defs>
      <line class="zero-line" x1="0" x2="${width}" y1="${height / 2}" y2="${height / 2}"/>
      <path d="${area}" fill="url(#profit-fill)" clip-path="url(#profit-clip)"/><path d="${area}" fill="url(#loss-fill)" clip-path="url(#loss-clip)"/>
      <polyline points="${line}" class="profit-line" clip-path="url(#profit-clip)"/><polyline points="${line}" class="loss-line" clip-path="url(#loss-clip)"/>
      <line class="chart-crosshair" y1="0" y2="${height}" hidden/><circle class="chart-point" r="6" hidden/>
    </svg><div class="chart-tooltip" hidden></div>
    <div class="chart-axis"><span>+${money(maximum)}</span><span>0 CR</span><span>−${money(maximum)}</span></div>
  </div>`;
}

export function initProfile({ root, account }) {
  let requestId = 0;
  let shownFor = null; // "userId:balance" the rendered profile reflects
  const userKey = (user) => (user ? `${user.id}:${user.balance}` : null);

  function signedOut() {
    shownFor = null;
    root.innerHTML = `<section class="profile-empty"><div class="profile-empty-art">⌁</div><span>YOUR STORY STARTS HERE</span><h1>Lifetime analytics.<br>Every play accounted for.</h1><p>Sign in to track wagering, returns, win rate, achievements and every move in your profit curve.</p><button>SIGN IN / CREATE ACCOUNT →</button></section>`;
    root.querySelector("button").onclick = account.openAccount;
  }

  function loading() {
    root.innerHTML = `<div class="profile-skeleton"><div></div><div class="skeleton-kpis">${"<i></i>".repeat(6)}</div><div class="skeleton-chart"></div></div>`;
  }

  function bindChart(series) {
    const wrap = root.querySelector(".profile-chart-wrap");
    if (!wrap || !series.length) return;
    const svg = wrap.querySelector("svg");
    const crosshair = wrap.querySelector(".chart-crosshair");
    const point = wrap.querySelector(".chart-point");
    const tooltip = wrap.querySelector(".chart-tooltip");
    svg.addEventListener("pointermove", (event) => {
      const bounds = svg.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      const index = Math.round(ratio * (series.length - 1));
      const data = series[index];
      const maximum = Math.max(1, ...series.map((item) => Math.abs(item.net)));
      const x = series.length === 1 ? 500 : (index / (series.length - 1)) * 1000;
      const y = 130 - (data.net / maximum) * 109.2;
      crosshair.setAttribute("x1", x);
      crosshair.setAttribute("x2", x);
      point.setAttribute("cx", x);
      point.setAttribute("cy", y);
      crosshair.hidden = false;
      point.hidden = false;
      tooltip.hidden = false;
      tooltip.style.left = `${ratio * 100}%`;
      tooltip.innerHTML = `<b>PLAY ${index + 1}</b><strong class="${data.net >= 0 ? "positive" : "negative"}">${signed(data.net)} CR</strong><small>${new Date(data.at).toLocaleString()}</small>`;
    });
    svg.addEventListener("pointerleave", () => {
      crosshair.hidden = true;
      point.hidden = true;
      tooltip.hidden = true;
    });
  }

  function render(profile) {
    const totals = profile.totals;
    const returnRate = totals.wagered ? (totals.returned / totals.wagered) * 100 : 0;
    const winRate = totals.plays ? (totals.wins / totals.plays) * 100 : 0;
    const comparisonMax = Math.max(totals.wagered, totals.returned, 1);
    const unlocked = profile.achievements.filter((item) => item.unlocked);
    const rewards = unlocked.reduce((sum, item) => sum + item.reward, 0);
    root.innerHTML = `
      <header class="profile-head"><div class="profile-avatar">${profile.user.name[0].toUpperCase()}</div><div><span>VERIFIED PLAYER PROFILE</span><h1>${profile.user.name}</h1><p>${totals.plays.toLocaleString()} lifetime plays · ${profile.user.battlesPlayed || 0} battles completed</p></div><div class="profile-balance"><span>ONLINE BALANCE</span><strong>${money(profile.user.balance)} <small>CR</small></strong></div></header>
      <section class="profile-kpis">
        <article class="featured"><span>LIFETIME TOTAL EARNINGS</span><strong>${money(totals.returned)} <small>CR</small></strong></article>
        <article><span>WAGERED VOLUME</span><strong>${money(totals.wagered)} <small>CR</small></strong></article>
        <article><span>NET PROFIT / LOSS</span><strong class="${totals.net >= 0 ? "positive" : "negative"}">${signed(totals.net)} <small>CR</small></strong></article>
        <article><span>PLAYS</span><strong>${totals.plays.toLocaleString()}</strong></article>
        <article><span>WIN RATE</span><strong>${winRate.toFixed(1)}%</strong></article>
        <article><span>RTP</span><strong>${returnRate.toFixed(2)}%</strong></article>
      </section>
      <section class="profile-panel comparison"><header><div><span>CAPITAL FLOW</span><h2>Earnings vs wagered</h2></div><b>${totals.plays.toLocaleString()} SETTLED PLAYS</b></header><div class="comparison-row"><span>RETURNED</span><i><b style="width:${(totals.returned / comparisonMax) * 100}%"></b></i><strong>${money(totals.returned)} CR</strong></div><div class="comparison-row wagered"><span>WAGERED</span><i><b style="width:${(totals.wagered / comparisonMax) * 100}%"></b></i><strong>${money(totals.wagered)} CR</strong></div></section>
      <section class="profile-panel chart-panel"><header><div><span>CUMULATIVE PERFORMANCE</span><h2>Net P/L</h2></div><b>HOVER TO INSPECT</b></header>${chartMarkup(profile.series || [])}</section>
      <section class="profile-highlights"><article><i>×</i><span>BIGGEST WIN MULTIPLIER</span><strong>${profile.biggestMultiplier ? `${profile.biggestMultiplier.multiplier.toFixed(2)}×` : "—"}</strong><small>${gameName(profile.biggestMultiplier?.game)}</small></article><article><i>◇</i><span>BIGGEST WIN</span><strong>${profile.biggestWin ? `${money(profile.biggestWin.amount)} CR` : "—"}</strong><small>${gameName(profile.biggestWin?.game)}</small></article><article><i>★</i><span>FAVOURITE GAME</span><strong>${gameName(profile.favourite?.game)}</strong><small>${profile.favourite ? `${profile.favourite.plays} plays` : "NO DATA YET"}</small></article></section>
      <section class="profile-panel"><header><div><span>GAME INTELLIGENCE</span><h2>Per-game breakdown</h2></div></header><div class="profile-games"><div class="games-table-head"><span>GAME</span><span>PLAYS</span><span>WAGERED</span><span>RETURNED</span><span>NET</span></div>${profile.games.map((game) => `<div class="game-row"><b>${gameName(game.game)}<i style="width:${(game.wagered / Math.max(totals.wagered, 1)) * 100}%"></i></b><span>${game.plays}</span><span>${money(game.wagered)}</span><span>${money(game.returned)}</span><strong class="${game.net >= 0 ? "positive" : "negative"}">${signed(game.net)}</strong></div>`).join("") || '<p class="chart-empty">No settled games yet.</p>'}</div></section>
      <section class="profile-panel"><header><div><span>CAREER MILESTONES</span><h2>Achievements</h2></div><b>${unlocked.length} / ${profile.achievements.length} UNLOCKED · ${money(rewards)} CR EARNED</b></header><div class="achievements">${profile.achievements.map((achievement) => `<article class="${achievement.unlocked ? "unlocked" : "locked"}"><i>${achievement.unlocked ? "◆" : "◇"}</i><div><strong>${achievement.name}</strong><p>${achievement.description}</p><span>+${money(achievement.reward)} CR</span><small>${achievement.unlockedAt ? `UNLOCKED ${new Date(achievement.unlockedAt).toLocaleDateString()}` : "LOCKED"}</small></div></article>`).join("")}</div></section>`;
    bindChart(profile.series || []);
  }

  async function show() {
    const currentRequest = ++requestId;
    if (!account.getUser()) return signedOut();
    loading();
    try {
      const { profile } = await account.api("/profile");
      if (currentRequest !== requestId) return;
      shownFor = userKey(profile.user);
      // Async credits (live rocket, battles, achievements) can land between /me polls; sync the header now.
      if (userKey(account.getUser()) !== shownFor) account.setUser({ ...account.getUser(), ...profile.user });
      render(profile);
    } catch (error) {
      if (currentRequest !== requestId) return;
      root.innerHTML = `<section class="profile-empty"><span>CONNECTION INTERRUPTED</span><h1>Profile unavailable</h1><p>${error.message}</p><button>TRY AGAIN</button></section>`;
      root.querySelector("button").onclick = show;
    }
  }

  account.onUser((user) => {
    // /me polling hands out a fresh object every few seconds; only reload when something changed.
    if (!root.hidden && userKey(user) !== shownFor) show();
  });
  return { show };
}

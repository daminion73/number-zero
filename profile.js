import { avatarMarkup, nameMarkup, titleMarkup } from "./cosmetics.js";
import { mountPerformanceChart } from "./performance.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const KINDS = [["avatar", "PROFILE PICTURES"], ["frame", "FRAMES"], ["color", "NAME COLOURS"], ["title", "TITLES"]];
const RARITY = { common: "COMMON", rare: "RARE", epic: "EPIC", legendary: "LEGENDARY" };
const REWARD_ICON = { avatar: "◉", frame: "◎", color: "✦", title: "❝" };
const money = (value) => Number(value || 0).toLocaleString(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const gameName = (value) => String(value || "—").replace("slots:", "slots · ").replaceAll("-", " ").toUpperCase();
const signed = (value) => `${value >= 0 ? "+" : "−"}${money(Math.abs(value))}`;

export function initProfile({ root, account }) {
  let requestId = 0;
  let lockerKind = "avatar";
  let category = "all";
  let current = null;
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

  function lockerMarkup(profile) {
    const { items, equipped } = profile.cosmetics;
    const owned = items.filter((item) => item.owned).length;
    const list = items.filter((item) => item.kind === lockerKind);
    const look = profile.user.look || {};
    const preview = (item) => {
      if (item.kind === "avatar") return avatarMarkup({ ...look, avatar: item.id }, profile.user.name, 54);
      if (item.kind === "frame") return avatarMarkup({ ...look, frame: item.id }, profile.user.name, 54);
      if (item.kind === "color") return `<span class="locker-name">${nameMarkup({ color: item.id }, profile.user.name)}</span>`;
      return `<span class="nz-title locker-title">${escapeHtml(item.name)}</span>`;
    };
    const none = { avatar: "Initial", frame: "No frame", color: "Default", title: "No title" }[lockerKind];
    const noneEquipped = !equipped[lockerKind];
    return `<section class="profile-panel locker"><header><div><span>COSMETICS</span><h2>Locker</h2></div><b>${owned} / ${items.length} OWNED · EARN MORE WITH ACHIEVEMENTS</b></header>
      <nav class="locker-tabs">${KINDS.map(([kind, label]) => `<button type="button" data-locker="${kind}" class="${kind === lockerKind ? "active" : ""}">${label}<small>${items.filter((i) => i.kind === kind && i.owned).length}/${items.filter((i) => i.kind === kind).length}</small></button>`).join("")}</nav>
      <div class="locker-grid">
        <button type="button" class="locker-item owned ${noneEquipped ? "equipped" : ""}" data-equip-kind="${lockerKind}" data-equip-id=""><div class="locker-preview">${lockerKind === "avatar" || lockerKind === "frame" ? avatarMarkup({ ...look, [lockerKind]: null }, profile.user.name, 54) : `<span class="locker-none">—</span>`}</div><b>${none}</b><small>${noneEquipped ? "EQUIPPED" : "DEFAULT"}</small></button>
        ${list.map((item) => {
          const isOn = equipped[item.kind] === item.id;
          return `<button type="button" class="locker-item ${item.owned ? "owned" : "locked"} ${isOn ? "equipped" : ""} r-${item.rarity}" ${item.owned ? `data-equip-kind="${item.kind}" data-equip-id="${item.id}"` : "disabled"} title="${item.owned ? "Equip" : `Unlock: ${escapeHtml(item.unlock)}`}"><div class="locker-preview">${preview(item)}</div><b>${escapeHtml(item.name)}</b><em>${RARITY[item.rarity]}</em><small>${isOn ? "EQUIPPED" : item.owned ? "TAP TO EQUIP" : `🔒 ${escapeHtml(item.unlock)}`}</small></button>`;
        }).join("")}
      </div></section>`;
  }

  function achievementsMarkup(profile) {
    const all = profile.achievements;
    const unlocked = all.filter((item) => item.unlocked);
    const categories = [...new Map(all.map((item) => [item.category, item.categoryName])).entries()];
    const shown = all.filter((item) => category === "all" || item.category === category).sort((a, b) => (b.unlocked - a.unlocked) || ((b.progress ? b.progress.value / b.progress.target : 0) - (a.progress ? a.progress.value / a.progress.target : 0)));
    const progress = (p) => p ? `<div class="ach-progress"><i style="width:${Math.min(100, (p.value / p.target) * 100).toFixed(1)}%"></i><span>${Number(p.value.toFixed(2)).toLocaleString()} / ${p.target.toLocaleString()}${p.unit ? ` ${p.unit}` : ""}</span></div>` : "";
    return `<section class="profile-panel"><header><div><span>CAREER MILESTONES</span><h2>Achievements</h2></div><b>${unlocked.length} / ${all.length} UNLOCKED · REWARDS ARE COSMETICS</b></header>
      <nav class="locker-tabs ach-tabs"><button type="button" data-category="all" class="${category === "all" ? "active" : ""}">ALL<small>${unlocked.length}/${all.length}</small></button>${categories.map(([id, name]) => `<button type="button" data-category="${id}" class="${category === id ? "active" : ""}">${escapeHtml(name).toUpperCase()}<small>${all.filter((a) => a.category === id && a.unlocked).length}/${all.filter((a) => a.category === id).length}</small></button>`).join("")}</nav>
      <div class="achievements">${shown.map((achievement) => `<article class="${achievement.unlocked ? "unlocked" : "locked"}"><i>${achievement.unlocked ? "◆" : "◇"}</i><div><strong>${escapeHtml(achievement.name)}</strong><p>${escapeHtml(achievement.description)}</p>${achievement.unlocked ? "" : progress(achievement.progress)}<span class="ach-rewards">${achievement.unlocks.map((item) => `<em class="r-${item.rarity}">${REWARD_ICON[item.kind]} ${escapeHtml(item.name)}</em>`).join("")}</span><small>${achievement.unlockedAt ? `UNLOCKED ${new Date(achievement.unlockedAt).toLocaleDateString()}` : "LOCKED"}</small></div></article>`).join("")}</div></section>`;
  }

  root.addEventListener("click", async (event) => {
    const tab = event.target.closest("[data-locker]");
    if (tab && current) {
      lockerKind = tab.dataset.locker;
      render(current);
    }
    const cat = event.target.closest("[data-category]");
    if (cat && current) {
      category = cat.dataset.category;
      render(current);
    }
    const equip = event.target.closest("[data-equip-kind]");
    if (equip && current) {
      try {
        const result = await account.api("/profile/cosmetics", { kind: equip.dataset.equipKind, id: equip.dataset.equipId || null });
        shownFor = userKey(result.user);
        account.setUser({ ...account.getUser(), ...result.user });
        render(result.profile);
      } catch (error) {
        equip.classList.add("shake");
      }
    }
  });

  function render(profile) {
    const totals = profile.totals;
    const returnRate = totals.wagered ? (totals.returned / totals.wagered) * 100 : 0;
    const winRate = totals.plays ? (totals.wins / totals.plays) * 100 : 0;
    const comparisonMax = Math.max(totals.wagered, totals.returned, 1);
    const unlocked = profile.achievements.filter((item) => item.unlocked);
    current = profile;
    root.innerHTML = `
      <header class="profile-head"><div class="profile-avatar-look">${avatarMarkup(profile.user.look, profile.user.name, 76)}</div><div><span>VERIFIED PLAYER PROFILE ${titleMarkup(profile.user.look)}</span><h1>${nameMarkup(profile.user.look, profile.user.name)}</h1><p>${totals.plays.toLocaleString()} lifetime plays · ${profile.user.battlesPlayed || 0} battles completed</p></div><div class="profile-balance"><span>ONLINE BALANCE</span><strong>${money(profile.user.balance)} <small>CR</small></strong></div></header>
      <section class="profile-kpis">
        <article class="featured"><span>LIFETIME TOTAL EARNINGS</span><strong>${money(totals.returned)} <small>CR</small></strong></article>
        <article><span>WAGERED VOLUME</span><strong>${money(totals.wagered)} <small>CR</small></strong></article>
        <article><span>NET PROFIT / LOSS</span><strong class="${totals.net >= 0 ? "positive" : "negative"}">${signed(totals.net)} <small>CR</small></strong></article>
        <article><span>PLAYS</span><strong>${totals.plays.toLocaleString()}</strong></article>
        <article><span>WIN RATE</span><strong>${winRate.toFixed(1)}%</strong></article>
        <article><span>RTP</span><strong>${returnRate.toFixed(2)}%</strong></article>
      </section>
      <section class="profile-panel comparison"><header><div><span>CAPITAL FLOW</span><h2>Earnings vs wagered</h2></div><b>${totals.plays.toLocaleString()} SETTLED PLAYS</b></header><div class="comparison-row"><span>RETURNED</span><i><b style="width:${(totals.returned / comparisonMax) * 100}%"></b></i><strong>${money(totals.returned)} CR</strong></div><div class="comparison-row wagered"><span>WAGERED</span><i><b style="width:${(totals.wagered / comparisonMax) * 100}%"></b></i><strong>${money(totals.wagered)} CR</strong></div></section>
      <section class="profile-panel chart-panel"><header><div><span>CUMULATIVE PERFORMANCE</span><h2>Net P/L over time</h2></div><b>HOVER TO INSPECT · DRAG TO ZOOM</b></header>${profile.firstPlayAt ? '<div class="profile-performance"></div>' : '<div class="chart-empty">Play a game to begin your lifetime graph.</div>'}</section>
      <section class="profile-highlights"><article><i>×</i><span>BIGGEST WIN MULTIPLIER</span><strong>${profile.biggestMultiplier ? `${profile.biggestMultiplier.multiplier.toFixed(2)}×` : "—"}</strong><small>${gameName(profile.biggestMultiplier?.game)}</small></article><article><i>◇</i><span>BIGGEST WIN</span><strong>${profile.biggestWin ? `${money(profile.biggestWin.amount)} CR` : "—"}</strong><small>${gameName(profile.biggestWin?.game)}</small></article><article><i>★</i><span>FAVOURITE GAME</span><strong>${gameName(profile.favourite?.game)}</strong><small>${profile.favourite ? `${profile.favourite.plays} plays` : "NO DATA YET"}</small></article></section>
      <section class="profile-panel"><header><div><span>GAME INTELLIGENCE</span><h2>Per-game breakdown</h2></div></header><div class="profile-games"><div class="games-table-head"><span>GAME</span><span>PLAYS</span><span>WAGERED</span><span>RETURNED</span><span>NET</span></div>${profile.games.map((game) => `<div class="game-row"><b>${gameName(game.game)}<i style="width:${(game.wagered / Math.max(totals.wagered, 1)) * 100}%"></i></b><span>${game.plays}</span><span>${money(game.wagered)}</span><span>${money(game.returned)}</span><strong class="${game.net >= 0 ? "positive" : "negative"}">${signed(game.net)}</strong></div>`).join("") || '<p class="chart-empty">No settled games yet.</p>'}</div></section>
      ${lockerMarkup(profile)}
      ${achievementsMarkup(profile)}`;
    const chart = root.querySelector(".profile-performance");
    if (chart) mountPerformanceChart(chart, { account, firstPlayAt: profile.firstPlayAt });
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

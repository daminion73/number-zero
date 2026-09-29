import { badgeHighlights, evaluateBadges, numberRarity, preciseNumberRank, secureRandomNumber } from "./badges.js";
import { battleWinner, CASES, EP_PER_CREDIT, TRAITS, TRAIT_ICONS, casePayout, createCase, dailyReward, drawCaseDrop, drawCaseOutcome, drawGoldDrop, epToCredits, generateTraitNumber, localDayKey, splitBattlePot } from "./economy.js";

const $ = (selector) => document.querySelector(selector);
const reels = [...document.querySelectorAll(".reel")];
const reelBank = $("#reels");
const rollButton = $("#roll-button");
const badgeGrid = $("#badge-grid");
const statusText = $("#status-text");
const scorePreview = $("#score-preview");
const summary = $("#result-summary");
const numberRarityResult = $("#number-rarity");
const soundToggle = $("#sound-toggle");
const musicToggle = $("#music-toggle");
const motionToggle = $("#motion-toggle");
const ceremony = $("#rarity-ceremony");
const caseOpening = $("#case-opening");
const rareTraitRoom = $("#rare-trait-room");
const caseGrid = $("#case-grid");
const caseDetail = $("#case-detail");
const categoryChips = $("#category-chips");
const caseBay = $("#case-bay");
const machine = $("#machine");
const rewardsPanel = $("#rewards-panel");
const inventoryPanel = $("#inventory-panel");
const inventoryGrid = $("#inventory-grid");
const duelPanel = $("#duel-panel");
const openingContext = $("#opening-context");
const modeTabs = [...document.querySelectorAll("[data-mode]")];
const dailyButton = $("#daily-roll");
let rolling = false;
let soundOn = true;
let musicOn = true;
let fastReveal = false;
let currentMode = "sandbox";
let selectedCaseId = "nano";
let selectedCategory = "All";
let duelMatch = { length: 0, round: 0, totals: [0, 0], histories: [[], []], payoutPot: 0, active: false };
let battleCaseIds = Array(3).fill(CASES[0].id);
let audio, musicBus, musicNodes = [];
const scoreDistribution = fetch("assets/score-cdf.bin")
  .then((response) => {
    if (!response.ok) throw new Error("Score distribution unavailable");
    return response.arrayBuffer();
  })
  .then((buffer) => new Uint32Array(buffer));

const savedState = JSON.parse(localStorage.getItem("number-zero-state") || "{}");
const legacyPayout = Number(savedState.unclaimedCredits) || 0;
const state = { rolls: 0, best: 0, badges: [], balance: 0, casesOpened: 0, dailyDate: "", inventory: [], duelWins: [0, 0], customCases: [], adminNextOutcome: "", ...savedState };
delete state.goldCoins;
delete state.unclaimedCredits;
if (legacyPayout > 0) state.balance = Math.round((state.balance + legacyPayout) * 100) / 100;
if (!Array.isArray(state.inventory)) state.inventory = [];
if (!Array.isArray(state.duelWins)) state.duelWins = [0, 0];
if (!Array.isArray(state.customCases)) state.customCases = [];
state.customCases = state.customCases.filter((definition) => {
  try {
    if (CASES.some((item) => item.id === definition.id)) return false;
    const item = createCase(definition); item.custom = true; CASES.push(item); return true;
  } catch { return false; }
});
const saveState = () => localStorage.setItem("number-zero-state", JSON.stringify(state));
if (legacyPayout > 0) saveState();
const formatCredits = (value) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatOdds = (value) => value.toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 });
const formatChance = (value) => value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
const findDrop = (caseId, traitId) => CASES.find((item) => item.id === caseId)?.drops.find((drop) => drop.id === traitId);
const traitImage = (traitId) => `assets/icons/${TRAIT_ICONS[traitId] || "1f3c5"}.png`;
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const categoryOrder = ["Tech", "Cosmic", "Lucky", "Void", "Math", "Pattern", "Retro", "Meme", "Elemental", "Prestige", "High Roller", "Maximum Volatility", "Caseception"];

function renderStats() {
  $("#total-rolls").textContent = state.rolls.toLocaleString();
  $("#best-score").textContent = state.best.toLocaleString();
  $("#badge-count").textContent = state.badges.length.toLocaleString();
  $("#credit-balance").textContent = formatCredits(state.balance);
  $("#inventory-balance").textContent = formatCredits(state.balance);
  $("#opening-balance").textContent = formatCredits(state.balance);
  $("#global-balance").textContent = `${formatCredits(state.balance)} CR`;
  $("#battle-balance").textContent = `${formatCredits(state.balance)} CR`;
  $("#admin-balance").textContent = formatCredits(state.balance);
  $("#admin-rolls").textContent = state.rolls.toLocaleString();
  $("#admin-cases").textContent = state.casesOpened.toLocaleString();
  $("#admin-inventory").textContent = state.inventory.length.toLocaleString();
  $("#inventory-count").textContent = state.inventory.length.toLocaleString();
  $("#duel-wins-1").textContent = state.duelWins[0];
  $("#duel-wins-2").textContent = state.duelWins[1];
  const claimed = state.dailyDate === localDayKey();
  dailyButton.disabled = claimed || rolling;
  $("#daily-status").textContent = claimed ? "CLAIMED TODAY" : "AVAILABLE NOW";
  document.querySelectorAll("button[data-buy-case]").forEach((button) => {
    button.disabled = rolling || state.balance + 0.0001 < CASES.find((item) => item.id === button.dataset.buyCase).cost;
  });
}

function caseImage(item) {
  const categoryIndex = categoryOrder.indexOf(item.category);
  if (categoryIndex < 0) return `<img src="${item.image}" alt="${escapeHtml(item.name)}" />`;
  const localIndex = (Math.max(1, item.themeNumber) - 1) % 10;
  const artIndex = item.id === "endgame-vault" ? 9 : (localIndex + categoryIndex * 3) % 10;
  const sheet = categoryIndex % 2 === 1 && item.category !== "Prestige" ? "assets/case-categories-alt.png" : "assets/case-categories.png";
  const artTilt = item.themeNumber % 2 ? -3 - item.themeNumber % 5 : 2 + item.themeNumber % 6;
  const artScale = 90 + item.themeNumber % 9;
  return `<span class="case-sprite" role="img" aria-label="${escapeHtml(item.name)} case" style="--sprite-sheet:url('${sheet}');--sprite-x:${artIndex % 5 * 25}%;--sprite-y:${Math.floor(artIndex / 5) * 100}%;--sprite-hue:${categoryIndex * 24 + item.themeNumber % 4 * 13}deg;--art-tilt:${artTilt}deg;--art-scale:${artScale / 100}"></span>`;
}

function caseArt(item) {
  return `<div class="case-art themed-art" style="--case-accent:${item.accent};--case-secondary:${item.secondary};--art-angle:${item.themeNumber % 18 * 20}deg;--art-grid:${14 + item.themeNumber % 6 * 3}px"><i></i><span class="theme-glyph">${item.glyph}</span><span class="theme-index">//${String(item.themeNumber || 0).padStart(3, "0")}</span>${caseImage(item)}</div>`;
}

function renderCaseDetail(item, scroll = false) {
  selectedCaseId = item.id;
  caseGrid.querySelectorAll(".case-card").forEach((card) => card.classList.toggle("selected", card.dataset.caseId === item.id));
  caseDetail.style.setProperty("--case-accent", item.accent);
  caseDetail.style.setProperty("--case-secondary", item.secondary);
  const nestedBonus = item.bonusType === "nested";
  const bonusPath = nestedBonus
    ? `<div class="gold-path nested-path"><b class="nested-medallion">${caseImage(item)}</b><span><strong>2% CASE-INSIDE-A-CASE TRIGGER</strong><small>LAND IT → OPEN A SEPARATELY WEIGHTED 4-TRAIT INNER POOL</small></span></div><div class="nested-pool-preview">${item.drops.filter((drop) => drop.goldChance > 0).map((drop) => `<span><img src="${traitImage(drop.id)}" alt="" /><b>${drop.name}</b><em>${formatChance(drop.goldChance)}%</em></span>`).join("")}</div>`
    : `<div class="gold-path"><b class="gold-medallion">G</b><span><strong>2% GOLD COIN TRIGGER</strong><small>LAND IT → ${item.premiumChance ? "IMMEDIATE RARE-ONLY SPIN" : "REPEAT THE FULL CUSTOM POOL"}</small></span></div>`;
  caseDetail.innerHTML = `${caseArt(item)}<div class="detail-heading"><span>${item.category} · ${item.risk.toUpperCase()} RISK</span><h2>${escapeHtml(item.name)}</h2><p>THEME ${String(item.themeNumber || 0).padStart(3, "0")} · LINEAR EP PAYOUT</p></div><div class="detail-price"><span>FAIR POOL PRICE</span><strong>${formatCredits(item.cost)} CR</strong><button type="button" data-buy-case="${item.id}">ADD TO INVENTORY</button></div>${bonusPath}<div class="odds-title"><strong>COMPLETE FINAL ODDS</strong><span>INCLUDES BOTH SPIN PATHS</span></div><ol class="detail-drops">${item.drops.map((drop) => `<li class="${drop.rarity}"><img src="${traitImage(drop.id)}" alt="" /><span><strong>${drop.name}</strong><small>${drop.rarity} · ${Math.round(drop.expectedEp).toLocaleString()} AVG EP</small></span><b>${formatChance(drop.finalChance)}%<small>1 IN ${formatOdds(drop.oneIn)}</small></b><em>BASE ${formatChance(drop.chance)}%${drop.goldChance ? ` · ${nestedBonus ? "INNER" : "GOLD"} ${formatChance(drop.goldChance)}%` : ""}</em></li>`).join("")}</ol><div class="detail-math"><span>POOL AVG <b>${Math.round(item.expectedEp).toLocaleString()} EP</b></span><span>FIXED RATE <b>${EP_PER_CREDIT.toLocaleString()} EP/CR</b></span><span>AVG PAYOUT <b>${formatCredits(item.expectedPayout)} CR</b></span><span>MODELED RTP <b>98.00%</b></span></div>`;
  renderStats();
  if (scroll && innerWidth < 980) caseDetail.scrollIntoView({ behavior: fastReveal ? "auto" : "smooth", block: "start" });
}

function renderCases() {
  const query = $("#case-search")?.value.trim().toLowerCase() || "";
  const sort = $("#case-sort")?.value || "featured";
  const riskOrder = ["steady", "balanced", "volatile", "wild", "extreme", "maximum"];
  let cases = CASES.filter((item) => (selectedCategory === "All" || item.category === selectedCategory) && (!query || `${item.name} ${item.category} ${item.risk}`.toLowerCase().includes(query)));
  if (sort === "low") cases.sort((a, b) => a.cost - b.cost);
  if (sort === "high") cases.sort((a, b) => b.cost - a.cost);
  if (sort === "risk") cases.sort((a, b) => riskOrder.indexOf(a.risk) - riskOrder.indexOf(b.risk) || a.cost - b.cost);
  $("#catalog-count").textContent = `${cases.length} ${cases.length === 1 ? "CASE" : "CASES"}`;
  const renderCard = (item) => `<article class="case-card${selectedCaseId === item.id ? " selected" : ""}" data-case-id="${item.id}" style="--case-accent:${item.accent};--case-secondary:${item.secondary}">${caseArt(item)}<div class="case-card-copy"><p>${item.category} · ${item.risk.toUpperCase()}</p><h2>${escapeHtml(item.name)}</h2><div><span>${formatCredits(item.cost)} CR</span><small>TOP ${item.drops.at(-1).rarity.toUpperCase()} · ${formatChance(item.drops.at(-1).finalChance)}%</small></div></div><button type="button" data-view-case="${item.id}">VIEW CASE <span>→</span></button></article>`;
  const groups = [...new Set(cases.map((item) => item.category))].map((category) => [category, cases.filter((item) => item.category === category)]);
  caseGrid.innerHTML = groups.map(([category, items]) => `<section class="case-shelf"><header><span>${items[0]?.glyph || "◇"}</span><div><h2>${escapeHtml(category)} COLLECTION</h2><p>${items.length} THEMED CASES · ${[...new Set(items.map((item) => item.risk.toUpperCase()))].join(" / ")}</p></div><b>${String(categoryOrder.indexOf(category) + 1).padStart(2, "0")}</b></header><div class="case-shelf-row">${items.map(renderCard).join("")}</div></section>`).join("") || '<div class="catalog-empty">NO CASES MATCH THIS SIGNAL.</div>';
  const selected = cases.find((item) => item.id === selectedCaseId) || cases[0] || CASES[0];
  renderCaseDetail(selected);
}

const categories = ["All", ...new Set(CASES.map((item) => item.category))];
categoryChips.innerHTML = categories.map((category) => `<button type="button" class="${category === "All" ? "active" : ""}" data-category="${category}">${category}</button>`).join("");
const featured = CASES.reduce((highest, item) => item.cost > highest.cost ? item : highest, CASES[0]);
$("#featured-case").style.setProperty("--case-accent", featured.accent);
$("#featured-case").style.setProperty("--case-secondary", featured.secondary);
$("#featured-case").innerHTML = `<div><p>FEATURED // HIGH ROLLER COLLECTION</p><h2>${featured.name}</h2><span>The catalog's highest-priced audited pool, with custom drop percentages and a 2% path to the rare-only Gold Spin.</span><button type="button" data-view-case="${featured.id}">EXPLORE CASE</button></div>${caseArt(featured)}<aside><small>${featured.risk.toUpperCase()} RISK</small><strong>${formatCredits(featured.cost)} CR</strong><button type="button" data-buy-case="${featured.id}">ADD TO INVENTORY</button></aside>`;
renderCases();
renderStats();

const builderDialog = $("#case-builder-dialog");
const builderTraits = $("#builder-traits");
const traitOptions = Object.entries(TRAITS).map(([id, [name]]) => `<option value="${id}">${name}</option>`).join("");
const builderRarityOptions = ["common", "uncommon", "rare", "epic", "mythic"].map((rarity) => `<option value="${rarity}">${rarity.toUpperCase()}</option>`).join("");
const builderRarityColors = { common: "#8b96a8", uncommon: "#42d989", rare: "#00e5ff", epic: "#a66bff", mythic: "#f5a623" };

function addBuilderTraitRow({ traitId = Object.keys(TRAITS)[0], rarity = "common", chance = 1 } = {}) {
  const row = document.createElement("div");
  row.className = "builder-trait-row";
  row.style.setProperty("--accent", builderRarityColors[rarity]);
  row.innerHTML = `<label>TRAIT<select data-builder-trait>${traitOptions}</select></label><label>RARITY<select data-builder-rarity>${builderRarityOptions}</select></label><label>ODDS %<input data-builder-chance type="number" min="0.0001" max="100" step="0.0001" value="${chance}" /></label><button type="button" data-remove-builder-trait aria-label="Remove trait">×</button>`;
  row.querySelector("[data-builder-trait]").value = traitId;
  row.querySelector("[data-builder-rarity]").value = rarity;
  builderTraits.append(row);
}

CASES[1].definition.odds.forEach(([rarity, chance], index) => addBuilderTraitRow({ traitId: CASES[1].definition.traitIds[index], rarity, chance }));

function builderDefinition(id = "case-preview") {
  const rows = [...builderTraits.querySelectorAll(".builder-trait-row")];
  return {
    id,
    name: $("#builder-name").value,
    image: $("#builder-image").value,
    accent: $("#builder-accent").value,
    odds: rows.map((row) => [row.querySelector("[data-builder-rarity]").value, Number(row.querySelector("[data-builder-chance]").value)]),
    traitIds: rows.map((row) => row.querySelector("[data-builder-trait]").value),
  };
}

function updateBuilderEconomy() {
  const definition = builderDefinition();
  const oddsTotal = definition.odds.reduce((sum, [, chance]) => sum + (Number.isFinite(chance) ? chance : 0), 0);
  $("#builder-odds-total").textContent = `${formatChance(oddsTotal)}% / 100%`;
  $("#builder-odds-total").classList.toggle("valid", Math.abs(oddsTotal - 100) < 1e-7);
  try {
    const preview = createCase(definition);
    $("#builder-expected").textContent = `${Math.round(preview.expectedEp).toLocaleString()} EP`;
    $("#builder-denominator").textContent = `${EP_PER_CREDIT.toLocaleString()} EP / CREDIT`;
    $("#builder-cost").value = `${formatCredits(preview.cost)} CR`;
    $("#builder-status").textContent = `Average payout ${formatCredits(preview.expectedPayout)} CR · auto price ${formatCredits(preview.cost)} CR · every outcome uses the same linear rate.`;
    return preview;
  } catch (error) {
    $("#builder-expected").textContent = "—"; $("#builder-denominator").textContent = `${EP_PER_CREDIT.toLocaleString()} EP / CREDIT`;
    $("#builder-cost").value = "INVALID ODDS";
    $("#builder-status").textContent = error.message.toUpperCase();
    return null;
  }
}

function addCustomCase(definition) {
  if (CASES.some((item) => item.id === definition.id)) throw new RangeError("case ID already imported");
  const item = createCase(definition); item.custom = true;
  CASES.push(item); state.customCases.push(item.definition); saveState(); renderCases(); renderBattleCases(); renderStats();
  return item;
}

function generatedCaseDefinition() {
  const slug = $("#builder-name").value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "community-case";
  return builderDefinition(`${slug}-${Date.now().toString(36)}`);
}

builderDialog.addEventListener("input", updateBuilderEconomy);
builderDialog.addEventListener("change", (event) => {
  const row = event.target.closest(".builder-trait-row");
  if (row && event.target.matches("[data-builder-rarity]")) row.style.setProperty("--accent", builderRarityColors[event.target.value]);
});
$("#builder-add-trait").addEventListener("click", () => { addBuilderTraitRow(); updateBuilderEconomy(); });
builderTraits.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-builder-trait]");
  if (!button) return;
  button.closest(".builder-trait-row").remove();
  updateBuilderEconomy();
});
$("#case-builder-open").addEventListener("click", () => { updateBuilderEconomy(); builderDialog.showModal(); });
$(".case-builder-close").addEventListener("click", () => builderDialog.close());
builderDialog.addEventListener("click", (event) => { if (event.target === builderDialog) builderDialog.close(); });
$("#builder-save").addEventListener("click", () => {
  try {
    const item = addCustomCase(generatedCaseDefinition());
    $("#builder-status").textContent = `${item.name.toUpperCase()} ADDED · ${EP_PER_CREDIT.toLocaleString()} EP = 1 CREDIT`;
    tone(760, 0.3, "triangle", 0.07);
  } catch (error) { $("#builder-status").textContent = error.message.toUpperCase(); }
});
$("#builder-export").addEventListener("click", () => {
  try {
    const definition = generatedCaseDefinition(); createCase(definition);
    const url = URL.createObjectURL(new Blob([JSON.stringify(definition, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${definition.id}.json`; link.click(); URL.revokeObjectURL(url);
    $("#builder-status").textContent = "CASE JSON DOWNLOADED · READY TO SHARE";
  } catch (error) { $("#builder-status").textContent = error.message.toUpperCase(); }
});
$("#case-import-open").addEventListener("click", () => $("#case-import-file").click());
$("#case-import-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const importButton = $("#case-import-open");
  try {
    const item = addCustomCase(JSON.parse(await file.text()));
    importButton.textContent = `✓ ${item.name.toUpperCase()} IMPORTED`;
    tone(760, 0.3, "triangle", 0.07);
  } catch (error) { importButton.textContent = `IMPORT FAILED · ${error.message.toUpperCase()}`; }
  setTimeout(() => { importButton.textContent = "↑ IMPORT JSON"; }, 2400);
  event.target.value = "";
});

function renderInventory() {
  $("#inventory-count").textContent = state.inventory.length.toLocaleString();
  if (!state.inventory.length) {
    inventoryGrid.innerHTML = '<div class="inventory-empty"><span>◇</span><h2>NO CASES YET</h2><p>Buy one or more sealed cases from the store.</p></div>';
    return;
  }
  const stacks = [...state.inventory.reduce((groups, entry, index) => {
    const key = `${entry.type}:${entry.caseId}:${entry.traitId || ""}`;
    const stack = groups.get(key) || { entry, indices: [] };
    stack.indices.push(index); groups.set(key, stack); return groups;
  }, new Map()).values()];
  inventoryGrid.innerHTML = stacks.map(({ entry, indices }) => {
    const index = indices[0];
    const quantity = indices.length;
    const caseItem = CASES.find((item) => item.id === entry.caseId);
    if (!caseItem) return "";
    if (entry.type === "case") return `<article class="inventory-item unopened-case${quantity > 1 ? " stacked" : ""}" style="--accent:${caseItem.accent};--case-secondary:${caseItem.secondary}"><b class="stack-count">×${quantity}</b><div class="inventory-art case-inventory-art"><i></i>${caseImage(caseItem)}</div><small>SEALED CASE STACK · ${caseItem.drops.length} OUTCOMES EACH</small><h2>${escapeHtml(caseItem.name)}</h2><p>${quantity === 1 ? "One case ready to open." : `${quantity} identical cases grouped into one clean stack.`}</p><div><span>UNIT COST <b>${formatCredits(caseItem.cost)}</b></span><span>STACK VALUE <b>${formatCredits(caseItem.cost * quantity)}</b></span></div><button type="button" data-open-case="${index}">OPEN ONE <span>→</span></button></article>`;
    const drop = findDrop(entry.caseId, entry.traitId);
    if (!drop) return "";
    return `<article class="inventory-item ${drop.rarity}${quantity > 1 ? " stacked" : ""}" style="--case-accent:${caseItem.accent}"><b class="stack-count">×${quantity}</b><div class="inventory-art"><i></i><img src="${traitImage(drop.id)}" alt="" /></div><small>${drop.rarity} · ${escapeHtml(caseItem.name)}</small><h2>${drop.name}</h2><p>${drop.description}</p><div><span>LINEAR PAYOUT <b>${EP_PER_CREDIT.toLocaleString()} EP / CREDIT</b></span><span>STACK <b>${quantity} CAPSULE${quantity === 1 ? "" : "S"}</b></span></div><button type="button" data-open-number="${index}">OPEN ONE <span>→</span></button></article>`;
  }).join("");
}

function setMode(mode, scroll = false) {
  if (mode !== "duel" && (duelMatch.active || duelMatch.joining || duelMatch.settled)) return;
  currentMode = mode;
  const openingMode = mode === "opening";
  if (!openingMode && mode !== "sandbox") {
    document.body.classList.remove("roll-complete", "roll-resolving");
    delete document.body.dataset.rollRank;
  }
  caseBay.hidden = mode !== "store";
  inventoryPanel.hidden = mode !== "inventory";
  duelPanel.hidden = mode !== "duel";
  machine.hidden = !["sandbox", "opening"].includes(mode);
  rewardsPanel.hidden = !["sandbox", "opening"].includes(mode);
  openingContext.hidden = !openingMode;
  document.body.classList.toggle("opening-mode", openingMode);
  modeTabs.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $("#machine-title").firstElementChild.textContent = openingMode ? "◈ RESTRICTED POOL TERMINAL" : "◈ GLOBAL SIGNAL";
  rollButton.hidden = mode !== "sandbox";
  if (!rolling) {
    statusText.textContent = openingMode ? "CAPSULE READY" : "SIGNAL READY";
    scorePreview.textContent = openingMode ? "TRAIT-LOCKED POOL" : "PURE CHANCE";
  }
  if (mode === "inventory") renderInventory();
  const target = { store: caseBay, inventory: inventoryPanel, duel: duelPanel, opening: openingContext }[mode] || machine;
  if (scroll) target.scrollIntoView({ behavior: fastReveal ? "auto" : "smooth", block: "start" });
}

modeTabs.forEach((button) => button.addEventListener("click", () => {
  if (!rolling) setMode(button.dataset.mode, true);
}));
setMode("sandbox");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, fastReveal ? Math.min(ms, 65) : ms));

function tone(frequency, duration = 0.08, type = "sine", volume = 0.035) {
  if (!soundOn) return;
  audio ||= new AudioContext();
  const oscillator = audio.createOscillator(), gain = audio.createGain();
  oscillator.type = type; oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
  oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + duration);
}

function startBackgroundMusic() {
  if (!musicOn || musicBus) return;
  audio ||= new AudioContext();
  audio.resume();
  musicBus = audio.createGain();
  const filter = audio.createBiquadFilter(), lfo = audio.createOscillator(), lfoGain = audio.createGain();
  musicBus.gain.setValueAtTime(0.0001, audio.currentTime);
  musicBus.gain.exponentialRampToValueAtTime(0.022, audio.currentTime + 2.5);
  filter.type = "lowpass"; filter.frequency.value = 720; filter.Q.value = 0.8;
  lfo.frequency.value = 0.07; lfoGain.gain.value = 260;
  lfo.connect(lfoGain).connect(filter.frequency);
  const voices = [55, 82.41, 110].map((frequency, index) => {
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.type = index === 1 ? "triangle" : "sine";
    oscillator.frequency.value = frequency; oscillator.detune.value = index === 2 ? 7 : -5;
    gain.gain.value = [0.48, 0.24, 0.1][index];
    oscillator.connect(gain).connect(filter); oscillator.start();
    return oscillator;
  });
  filter.connect(musicBus).connect(audio.destination); lfo.start();
  musicNodes = [...voices, lfo];
}

function stopBackgroundMusic() {
  if (!musicBus) return;
  const bus = musicBus, nodes = musicNodes;
  bus.gain.cancelScheduledValues(audio.currentTime);
  bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), audio.currentTime);
  bus.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.8);
  setTimeout(() => { nodes.forEach((node) => node.stop()); bus.disconnect(); }, 850);
  musicBus = null; musicNodes = [];
}

function ceremonySound(rarity, revealDelay) {
  if (!soundOn) return;
  audio ||= new AudioContext();
  audio.resume();
  const now = audio.currentTime;
  const impact = now + revealDelay / 1000;
  const colors = { rare: [90, 2600], epic: [70, 3400], anomaly: [55, 4400], mythic: [45, 5200] };

  const noiseBuffer = audio.createBuffer(1, Math.floor(audio.sampleRate * 2.8), audio.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let index = 0; index < noiseData.length; index++) {
    const progress = index / noiseData.length;
    noiseData[index] = (Math.random() * 2 - 1) * Math.sin(Math.PI * progress) * 0.75;
  }
  const noise = audio.createBufferSource(), filter = audio.createBiquadFilter(), noiseGain = audio.createGain();
  noise.buffer = noiseBuffer; filter.type = "bandpass"; filter.Q.value = 0.65;
  filter.frequency.setValueAtTime(colors[rarity][0], now);
  filter.frequency.exponentialRampToValueAtTime(colors[rarity][1], impact + 1.15);
  noiseGain.gain.setValueAtTime(0.0001, now); noiseGain.gain.exponentialRampToValueAtTime(0.075, impact);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, impact + 1.7);
  noise.connect(filter).connect(noiseGain).connect(audio.destination); noise.start(now); noise.stop(impact + 1.75);

  const drone = audio.createOscillator(), droneGain = audio.createGain(), drift = audio.createOscillator(), driftGain = audio.createGain();
  drone.type = rarity === "anomaly" ? "sawtooth" : "sine";
  drone.frequency.setValueAtTime(rarity === "mythic" ? 42 : 34, now);
  drone.frequency.exponentialRampToValueAtTime(rarity === "epic" ? 68 : 54, impact + 1.4);
  drift.frequency.value = 4.2; driftGain.gain.value = rarity === "anomaly" ? 18 : 6;
  drift.connect(driftGain).connect(drone.detune);
  droneGain.gain.setValueAtTime(0.0001, now); droneGain.gain.exponentialRampToValueAtTime(0.09, impact + 0.08);
  droneGain.gain.exponentialRampToValueAtTime(0.0001, impact + 2.15);
  drone.connect(droneGain).connect(audio.destination); drift.start(now); drone.start(now);
  drift.stop(impact + 2.2); drone.stop(impact + 2.2);

  const boom = audio.createOscillator(), boomGain = audio.createGain();
  boom.type = "sine"; boom.frequency.setValueAtTime(rarity === "mythic" ? 72 : 58, impact);
  boom.frequency.exponentialRampToValueAtTime(21, impact + 1.25);
  boomGain.gain.setValueAtTime(0.19, impact); boomGain.gain.exponentialRampToValueAtTime(0.0001, impact + 1.3);
  boom.connect(boomGain).connect(audio.destination); boom.start(impact); boom.stop(impact + 1.35);
}

function setToggle(button, active, onLabel, offLabel) {
  button.setAttribute("aria-pressed", String(active));
  button.querySelector("small").textContent = active ? onLabel : offLabel;
}

soundToggle.addEventListener("click", () => { soundOn = !soundOn; setToggle(soundToggle, soundOn, "On", "Off"); tone(460); });
musicToggle.addEventListener("click", () => {
  musicOn = !musicOn; setToggle(musicToggle, musicOn, "Ambient", "Off");
  if (musicOn) startBackgroundMusic(); else stopBackgroundMusic();
});
motionToggle.addEventListener("click", () => { fastReveal = !fastReveal; setToggle(motionToggle, fastReveal, "On", "Off"); });
setToggle(musicToggle, musicOn, "Ambient", "Off");
setToggle(motionToggle, fastReveal, "On", "Off");

function badgeGraphic(label) {
  let hash = 2166136261;
  for (const character of label) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const name = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "badge";
  return `assets/badges/icons/${name}-${(hash >>> 0).toString(36)}.svg`;
}

function makeNumberStrip(number, item) {
  const display = String(number);
  const displayPadding = 7 - display.length;
  const highlights = new Set(badgeHighlights(number, item.label, item.description)
    .map((index) => index - displayPadding)
    .filter((index) => index >= 0));
  return [...display].map((digit, index) => {
    const active = highlights.has(index);
    const groupStart = active && !highlights.has(index - 1);
    const groupEnd = active && !highlights.has(index + 1);
    return `<span class="digit-cell${active ? " active" : ""}${groupStart ? " group-start" : ""}${groupEnd ? " group-end" : ""}" style="--digit:${index}">${digit}</span>`;
  }).join("");
}

function makeBadge(item, index, number, isNew) {
  const article = document.createElement("article");
  article.className = `badge-card ${item.rarity}`;
  article.innerHTML = `<div class="badge-icon"><img src="${badgeGraphic(item.label)}" alt="${item.label} badge" /></div><div class="badge-copy"><div class="badge-title"><h3>${item.label}</h3><b>${item.rarity}</b>${isNew ? "<em>NEW</em>" : ""}</div><p>${item.description}</p></div><div class="badge-meta"><strong>+${item.score.toLocaleString()} <small>PTS</small></strong><span>${item.odds}</span></div><div class="number-strip" aria-label="${number}, highlighted digits earned this badge"><small>MATCH</small>${makeNumberStrip(number, item)}</div>`;
  article.style.setProperty("--order", index);
  return article;
}

function burst(card) {
  const burst = document.createElement("div");
  burst.className = "reward-burst";
  burst.innerHTML = [...Array(9)].map((_, index) => `<i style="--ray:${index}"></i>`).join("");
  card.append(burst);
  setTimeout(() => burst.remove(), 900);
}

async function revealNumberRarity(score) {
  const rarity = numberRarity(score);
  const exactRank = await scoreDistribution.then((distribution) => preciseNumberRank(score, distribution)).catch(() => rarity.rank);
  const tiers = ["trash", "common", "uncommon", "rare", "epic", "anomaly", "mythic"];
  const activeIndex = tiers.indexOf(rarity.tier);
  numberRarityResult.className = `number-rarity-result rank-${rarity.tier}`;
  numberRarityResult.innerHTML = `<div class="rank-orbit"><i></i><img src="assets/badges/ranks/${rarity.tier}.svg" alt="" /></div><div class="rank-copy"><p>NUMBER RARITY</p><h2>${rarity.label}</h2><span>${exactRank} of all possible rolls</span></div><div class="rank-meter" aria-label="${rarity.label}, ${exactRank}"><span>RARITY SPECTRUM</span><div>${tiers.map((tier, index) => `<i class="${index === activeIndex ? "active" : ""}" title="${tier}"></i>`).join("")}</div><small>TRASH · COMMON · UNCOMMON · RARE · EPIC · ANOMALY · MYTHIC</small></div>`;
  numberRarityResult.hidden = false;
  document.body.dataset.rollRank = rarity.tier;
  requestAnimationFrame(() => numberRarityResult.classList.add("revealed"));
}

async function animateRoll(number) {
  const sevenDigits = number === 1_000_000;
  const target = sevenDigits ? "1000000" : String(number).padStart(6, "0");
  const leadingZeroes = number === 0 ? 5 : target.length - String(number).length;
  reels.forEach((reel, index) => {
    reel.classList.toggle("reel-hidden", index >= target.length);
    reel.classList.remove("vanishing");
    reel.setAttribute("aria-hidden", String(index >= target.length));
  });
  reelBank.classList.toggle("seven-digit", sevenDigits);
  reelBank.style.setProperty("--reel-count", target.length);
  const activeReels = reels.slice(0, target.length);
  const reelDelays = [190, 210, 230, 250, 270, 290, 310];
  const timers = activeReels.map((reel, index) => {
    reel.classList.add("spinning");
    return setInterval(() => {
      reel.querySelector("span").textContent = Math.floor(Math.random() * 10);
      tone(90 + index * 8, 0.025, "square", 0.006);
    }, 55 + index * 4);
  });
  for (let index = 0; index < activeReels.length; index++) {
    const delay = fastReveal ? 48 : reelDelays[index];
    const reel = activeReels[index];
    const brakeTime = fastReveal ? Math.min(40, delay * 0.35) : delay - 45;
    await new Promise((resolve) => setTimeout(resolve, delay - brakeTime));
    reel.classList.add("braking");
    await new Promise((resolve) => setTimeout(resolve, brakeTime));
    clearInterval(timers[index]);
    reel.classList.remove("spinning", "braking"); reel.classList.add("locked");
    reel.querySelector("span").textContent = target[index];
    statusText.textContent = `DIGIT LOCK ${index + 1} / ${activeReels.length}`;
    scorePreview.textContent = `PREFIX ${target.slice(0, index + 1).replace(/^0+(?=\d)/, "") || "0"}`;
    reelBank.classList.remove("impact");
    void reelBank.offsetWidth;
    reelBank.classList.add("impact");
    tone(180 + index * 48, 0.12, "triangle", 0.06);
    setTimeout(() => { reel.classList.remove("locked"); reelBank.classList.remove("impact"); }, 400);
    if (!sevenDigits && index < leadingZeroes) {
      await wait(15);
      reel.classList.add("vanishing");
      await wait(45);
      reel.classList.add("reel-hidden");
      reel.setAttribute("aria-hidden", "true");
      reelBank.style.setProperty("--reel-count", target.length - index - 1);
    }
  }
}

function lockRollResult(number) {
  const target = String(number);
  reels.forEach((reel, index) => {
    const hidden = index >= target.length;
    reel.className = `reel${hidden ? " reel-hidden" : ""}`;
    reel.setAttribute("aria-hidden", String(hidden));
    if (!hidden) reel.querySelector("span").textContent = target[index];
  });
  reelBank.classList.toggle("seven-digit", target.length === 7);
  reelBank.style.setProperty("--reel-count", target.length);
}

async function showRareTraitRoom(drop, number) {
  if (drop.rarity !== "mythic") return;
  const target = number === 1_000_000 ? "1000000" : String(number).padStart(6, "0");
  rareTraitRoom.className = `rare-trait-room ${drop.rarity} blackout`;
  rareTraitRoom.innerHTML = `<div class="rare-room-sky"></div><div class="rare-room-grid"></div><p>${drop.rarity.toUpperCase()} TRAIT CHAMBER</p><div class="rare-room-trait"><img src="${traitImage(drop.id)}" alt="" /><span>${drop.name}</span></div><h2>RESTRICTED NUMBER SPIN</h2><div class="rare-room-reels" style="--count:${target.length}">${[...target].map(() => "<i>0</i>").join("")}</div><strong>ENTERING PRIVATE ROLL ROOM</strong>`;
  rareTraitRoom.hidden = false;
  await wait(220);
  rareTraitRoom.classList.remove("blackout"); rareTraitRoom.classList.add("active");
  const roomReels = [...rareTraitRoom.querySelectorAll(".rare-room-reels i")];
  const timers = roomReels.map((reel, index) => setInterval(() => {
    reel.textContent = Math.floor(Math.random() * 10);
    tone(90 + index * 12, 0.025, "square", 0.01);
  }, 46 + index * 3));
  await wait(280);
  for (let index = 0; index < roomReels.length; index++) {
    await wait(65);
    clearInterval(timers[index]);
    roomReels[index].textContent = target[index]; roomReels[index].classList.add("locked");
    tone(240 + index * 55, 0.12, "triangle", 0.07);
  }
  rareTraitRoom.querySelector("strong").textContent = `${Number(target).toLocaleString()} · SIGNAL LOCKED`;
  await wait(240);
  rareTraitRoom.classList.add("leaving");
  await wait(150);
  rareTraitRoom.hidden = true; rareTraitRoom.className = "rare-trait-room";
}

const ceremonyCopy = {
  rare: ["RARE SIGNAL", "Pattern resonance confirmed"],
  epic: ["EPIC ASCENSION", "The machine is overloading"],
  anomaly: ["ANOMALY DETECTED", "Probability field destabilized"],
  mythic: ["MYTHIC EVENT", "One of the impossible ones"],
};

async function showRarityCeremony(item) {
  if (!(item.rarity in ceremonyCopy)) return;
  const [headline, caption] = ceremonyCopy[item.rarity];
  ceremony.className = `rarity-ceremony ${item.rarity}`;
  ceremony.innerHTML = `<div class="ceremony-galaxy"><i></i><i></i><i></i></div><div class="ceremony-field">${[...Array(36)].map((_, index) => `<i style="--spark:${index}"></i>`).join("")}</div><div class="ceremony-rings"><i></i><i></i><i></i></div><div class="ceremony-emblem"><img src="${badgeGraphic(item.label)}" alt="" /></div><p>${caption}</p><h2>${headline}</h2><strong>${item.label}</strong><button class="ceremony-dismiss" type="button">CONTINUING <span>↵</span></button>`;
  ceremony.hidden = false;
  ceremony.classList.add("prelude");
  const blackoutDuration = fastReveal ? 80 : 140;
  ceremonySound(item.rarity, blackoutDuration);
  if (musicBus) musicBus.gain.exponentialRampToValueAtTime(0.006, audio.currentTime + 0.6);
  await new Promise((resolve) => setTimeout(resolve, blackoutDuration));
  ceremony.classList.remove("prelude");
  ceremony.classList.add("active");
  const durations = { rare: 480, epic: 620, anomaly: 760, mythic: 950 };
  await new Promise((resolve) => setTimeout(resolve, fastReveal ? 320 : durations[item.rarity]));
  ceremony.classList.add("ready");
  await new Promise((resolve) => {
    const timeout = setTimeout(() => dismiss({ type: "timeout" }), fastReveal ? 80 : 260);
    const dismiss = (event) => {
      if (event.type === "keydown" && !["Enter", "Space", "Escape"].includes(event.code)) return;
      clearTimeout(timeout); ceremony.removeEventListener("click", dismiss); document.removeEventListener("keydown", dismiss); resolve();
    };
    ceremony.addEventListener("click", dismiss); document.addEventListener("keydown", dismiss);
  });
  ceremony.classList.add("leaving");
  await new Promise((resolve) => setTimeout(resolve, fastReveal ? 120 : 360));
  ceremony.hidden = true;
  ceremony.className = "rarity-ceremony";
  if (musicBus) musicBus.gain.exponentialRampToValueAtTime(0.022, audio.currentTime + 1.2);
}

const GOLD_COIN_DROP = { gold: true, name: "Gold Coin", rarity: "gold", chance: 2, averageReturn: 0, description: "Immediate bonus spin" };
const caseBonusTrigger = (item) => item.bonusType === "nested" ? { nested: true, item, name: "Case Inside A Case", rarity: "nested", chance: 2, description: "Open the inner case" } : GOLD_COIN_DROP;

function rouletteCard(candidate) {
  if (candidate.gold) return `<article class="gold-card"><small>BONUS TRIGGER</small><div><b class="gold-medallion">G</b></div><strong>GOLD COIN</strong><span>2% · BONUS SPIN</span></article>`;
  if (candidate.nested) return `<article class="nested-card"><small>INNER CASE TRIGGER</small><div>${caseImage(candidate.item)}</div><strong>CASE INSIDE A CASE</strong><span>2% · OPEN INNER POOL</span></article>`;
  return `<article class="${candidate.rarity}"><small>${candidate.rarity}</small><div><i></i><img src="${traitImage(candidate.id)}" alt="" /></div><strong>${candidate.name}</strong><span>${formatChance(candidate.finalChance)}% FINAL ODDS</span></article>`;
}

function visualHash(value) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

async function animateRouletteTrack(track, viewport, targetIndex, seed, audioTrack = true, durationOverride = null) {
  const cards = [...track.children];
  cards.forEach((card) => card.classList.remove("winner"));
  const cardWidth = cards[0].offsetWidth;
  const styles = getComputedStyle(track);
  const gap = Number.parseFloat(styles.columnGap) || 0;
  const padding = Number.parseFloat(styles.paddingLeft) || 0;
  const step = cardWidth + gap;
  const viewportWidth = viewport.clientWidth;
  const centeredDistance = (index, jitter = 0) => padding + index * step + cardWidth / 2 - viewportWidth / 2 + jitter;
  const jitter = (((visualHash(seed) % 10_001) / 10_000) * 2 - 1) * cardWidth * .38;
  const startDistance = centeredDistance(5);
  const targetDistance = centeredDistance(targetIndex, jitter);
  const shockDuration = fastReveal ? 90 : 360;
  const spinDuration = durationOverride ?? (fastReveal ? 950 : 5_200);

  track.style.transition = "none";
  track.style.transform = `translate3d(-${startDistance}px,0,0)`;
  void track.offsetWidth;
  track.classList.add("shock");
  track.style.setProperty("--shock-duration", `${shockDuration}ms`);
  track.style.transform = `translate3d(-${Math.max(0, startDistance - 45)}px,0,0)`;
  await new Promise((resolve) => setTimeout(resolve, shockDuration));

  let monitoring = true, lastCard = -1;
  const spinStarted = performance.now();
  const easedProgress = (elapsed) => {
    const progress = Math.max(0, Math.min(1, elapsed / spinDuration));
    let parameter = progress;
    for (let iteration = 0; iteration < 5; iteration++) {
      const inverse = 1 - parameter;
      const x = 3 * inverse * inverse * parameter * .08 + 3 * inverse * parameter * parameter * .14 + parameter ** 3;
      const derivative = 3 * inverse * inverse * .08 + 6 * inverse * parameter * (.14 - .08) + 3 * parameter * parameter * (1 - .14);
      if (derivative > .0001) parameter = Math.max(0, Math.min(1, parameter - (x - progress) / derivative));
    }
    const inverse = 1 - parameter;
    return 3 * inverse * inverse * parameter * .82 + 3 * inverse * parameter * parameter + parameter ** 3;
  };
  const monitorCollision = (timestamp) => {
    if (!monitoring) return;
    const currentX = startDistance + (targetDistance - startDistance) * easedProgress(timestamp - spinStarted);
    const currentCard = Math.floor((currentX + viewportWidth / 2 - padding) / step);
    if (audioTrack && currentCard !== lastCard) {
      tone(125 + Math.min(170, currentCard * 2), .025, "square", .012);
      if (navigator.vibrate && currentCard % 2 === 0) navigator.vibrate(3);
      lastCard = currentCard;
    }
    requestAnimationFrame(monitorCollision);
  };
  if (audioTrack) requestAnimationFrame(monitorCollision);
  track.classList.remove("shock");
  track.classList.add("rolling");
  track.style.setProperty("--spin-duration", `${spinDuration}ms`);
  track.style.transform = `translate3d(-${targetDistance}px,0,0)`;
  await new Promise((resolve) => setTimeout(resolve, spinDuration));
  monitoring = false;

  track.classList.remove("rolling");
  await new Promise((resolve) => setTimeout(resolve, fastReveal ? 35 : 95));
  track.classList.add("settling");
  const settleDuration = fastReveal ? 120 : 320;
  track.style.setProperty("--settle-duration", `${settleDuration}ms`);
  track.style.transform = `translate3d(-${centeredDistance(targetIndex)}px,0,0)`;
  await new Promise((resolve) => setTimeout(resolve, settleDuration));
  track.classList.remove("settling");
  cards[targetIndex].classList.add("winner");
}

async function showCaseSpin(item, drop, phase) {
  const winningIndex = 52;
  const bonusTrigger = phase === "trigger";
  const bonusSpin = phase === "gold" || phase === "nested";
  const nestedBonus = item.bonusType === "nested";
  const bonusPoolLabel = nestedBonus ? "INNER CASE" : item.premiumChance ? "RARE-ONLY" : "FULL-POOL BONUS";
  const triggerCard = caseBonusTrigger(item);
  const randomCandidate = () => bonusSpin ? drawGoldDrop(item, Math.random()) : Math.random() < 0.02 ? triggerCard : drawCaseDrop(item, Math.random());
  const winner = bonusTrigger ? triggerCard : drop;
  const reelDrops = [...Array.from({ length: winningIndex }, randomCandidate), winner, ...Array.from({ length: 10 }, randomCandidate)];
  caseOpening.className = `case-opening case-${item.id}${bonusTrigger ? nestedBonus ? " nested-trigger" : " gold-trigger" : ""}${bonusSpin ? nestedBonus ? " nested-spin" : " gold-spin" : ""}`;
  caseOpening.style.setProperty("--case-accent", bonusTrigger || bonusSpin ? nestedBonus ? item.secondary : "#ffd43b" : item.accent);
  const landed = bonusTrigger
    ? nestedBonus
      ? `<div class="nested-landed">${caseImage(item)}</div><small>CASE INSIDE A CASE · 20,000 / 1,000,001</small><strong>INNER POOL UNLOCKED</strong><span>Opening the hidden four-trait case now.</span>`
      : `<div class="gold-landed"><b class="gold-medallion">G</b></div><small>GOLD COIN · 20,000 / 1,000,001</small><strong>${bonusPoolLabel} SPIN UNLOCKED</strong><span>Starting the second spin now — no coin is stored.</span>`
    : `<div><i></i><img src="${traitImage(drop.id)}" alt="" /></div><small>${bonusSpin ? `${nestedBonus ? "INNER CASE" : "GOLD SPIN"} · ` : ""}${drop.rarity} CAPSULE · ${formatCredits(drop.averagePayout)} CR AVG</small><strong>${drop.name}</strong><span>${drop.description} · ${formatChance(drop.finalChance)}% FINAL ODDS</span>`;
  caseOpening.innerHTML = `<div class="case-open-glow"></div><div class="case-energy">${Array.from({ length: 28 }, (_, index) => `<i style="--spark:${index}"></i>`).join("")}</div><div class="case-scanlines"></div><p>${bonusSpin ? nestedBonus ? "HIDDEN CASE CHAMBER" : "GOLD COIN BONUS CHAMBER" : "CASE BREAK IN PROGRESS"}</p><h2>${bonusSpin ? `${bonusPoolLabel} SPIN` : escapeHtml(item.name)}</h2><div class="trait-roulette"><i class="roulette-marker"></i><div class="trait-track">${reelDrops.map((candidate) => rouletteCard(candidate)).join("")}</div></div><div class="trait-landed">${landed}</div>`;
  caseOpening.hidden = false;
  const roulette = caseOpening.querySelector(".trait-roulette");
  const track = caseOpening.querySelector(".trait-track");
  caseOpening.classList.add("active");
  tone(110, 0.7, "sawtooth", 0.035);
  await animateRouletteTrack(track, roulette, winningIndex, `${item.id}:${drop.id}:${phase}:${state.casesOpened}`);
  caseOpening.classList.add("landed");
  tone(bonusTrigger ? nestedBonus ? 840 : 1_120 : { common: 360, uncommon: 460, rare: 560, epic: 700, mythic: 900 }[drop.rarity], bonusTrigger ? 0.8 : 0.45, bonusTrigger ? "sine" : "triangle", 0.08);
  if (bonusTrigger) caseOpening.classList.add(nestedBonus ? "nested-hit" : "gold-hit");
  await new Promise((resolve) => setTimeout(resolve, fastReveal ? 220 : 620));
  caseOpening.classList.add("leaving");
  await new Promise((resolve) => setTimeout(resolve, fastReveal ? 80 : 220));
  caseOpening.hidden = true;
  caseOpening.className = "case-opening";
  caseOpening.removeAttribute("style");
}

async function showCaseOpening(item, outcome) {
  if (outcome.gold) {
    await showCaseSpin(item, outcome.drop, "trigger");
    await showCaseSpin(item, outcome.drop, item.bonusType === "nested" ? "nested" : "gold");
  } else {
    await showCaseSpin(item, outcome.drop, "normal");
  }
}

function buyCase(caseItem, button) {
  if (rolling || state.balance + 0.0001 < caseItem.cost) return;
  const originalLabel = button.innerHTML;
  state.balance = Math.round((state.balance - caseItem.cost) * 100) / 100;
  state.inventory.push({ type: "case", caseId: caseItem.id, acquiredAt: Date.now() + Math.random() });
  saveState(); renderStats();
  button.innerHTML = "ADDED TO INVENTORY <span>✓</span>";
  setTimeout(() => { if (button.isConnected) button.innerHTML = originalLabel; }, 850);
  tone(620, 0.16, "triangle", 0.05);
}

async function openPurchasedCase(index) {
  if (rolling) return;
  const entry = state.inventory[index];
  const caseItem = entry?.type === "case" && CASES.find((item) => item.id === entry.caseId);
  if (!caseItem) return;
  startBackgroundMusic(); rolling = true; renderStats();
  const forced = state.adminNextOutcome;
  const triggerNumber = forced === "gold" ? 0 : forced === "mythic" ? 20_000 : secureRandomNumber();
  const itemRoll = forced === "mythic" ? 0.999999 : forced === "gold" ? 0.5 : secureRandomNumber() / 1_000_001;
  const outcome = drawCaseOutcome(caseItem, triggerNumber, itemRoll);
  state.adminNextOutcome = "";
  const drop = outcome.drop;
  await showCaseOpening(caseItem, outcome);
  state.inventory.splice(index, 1, { type: "capsule", caseId: caseItem.id, traitId: drop.id, acquiredAt: Date.now() });
  saveState(); rolling = false; renderStats();
  await openInventoryItem(index);
}

async function revealBadges(badges, number, allowCeremonies = true) {
  badgeGrid.innerHTML = "";
  if (!badges.length) {
    badgeGrid.innerHTML = '<div class="empty-state"><span>◇</span><p>No extra patterns this time.<br />Every roll is still one in a million.</p></div>';
    return;
  }
  let runningScore = 0;
  const previouslyFound = new Set(state.badges);
  const orderedBadges = [...badges].sort((a, b) => a.score - b.score || a.label.localeCompare(b.label));
  for (let index = 0; index < orderedBadges.length; index++) {
    const item = orderedBadges[index];
    await wait(fastReveal ? 18 : 55);
    if (allowCeremonies && item.rarity in ceremonyCopy) {
      summary.innerHTML = `<span class="rarity-warning ${item.rarity}">${item.rarity.toUpperCase()} SIGNAL DETECTED</span>`;
      await showRarityCeremony(item);
    }
    const card = makeBadge(item, index, number, !previouslyFound.has(item.label));
    badgeGrid.prepend(card);
    requestAnimationFrame(() => { card.classList.add("revealed"); burst(card); });
    runningScore += item.score;
    summary.innerHTML = `BADGE <strong>${index + 1} / ${orderedBadges.length}</strong> REVEALED <span>+${item.score.toLocaleString()} PTS</span>`;
    const scale = { common: 380, uncommon: 460, rare: 540, epic: 620, anomaly: 720, mythic: 880 };
    tone(scale[item.rarity], 0.22, "triangle", 0.07);
  }
  await new Promise((resolve) => setTimeout(resolve, fastReveal ? 40 : 110));
  summary.innerHTML = `<span class="final-label">FINAL SCORE</span> <strong class="final-score">${runningScore.toLocaleString()} PTS</strong>`;
  tone(980, 0.5, "sine", 0.08);
  await wait(90);
  await revealNumberRarity(runningScore);
}

async function roll(opening = null) {
  if (rolling) return;
  const caseItem = opening?.caseItem;
  const caseDrop = opening?.caseDrop;
  let payout = 0;
  startBackgroundMusic();
  rolling = true; rollButton.disabled = true;
  document.body.classList.remove("roll-complete", "roll-resolving");
  delete document.body.dataset.rollRank;
  document.body.classList.add("is-rolling");
  rollButton.querySelector(".button-copy").textContent = "ROLLING SIGNAL";
  numberRarityResult.hidden = true;
  badgeGrid.innerHTML = '<div class="scanner"><i></i><span>SCANNING NUMBER DNA</span></div>';
  statusText.textContent = "ACQUIRING SIGNAL"; scorePreview.textContent = "— — —"; summary.textContent = "Locking digits, left to right…";
  const number = opening?.number ?? (caseDrop ? generateTraitNumber(caseDrop.id, secureRandomNumber()) : secureRandomNumber());
  if (opening?.skipAnimation) lockRollResult(number); else await animateRoll(number);
  const badges = evaluateBadges(number);
  const score = badges.reduce((sum, item) => sum + item.score, 0);
  if (caseItem) {
    payout = casePayout(caseItem, score);
    state.inventory.splice(opening.inventoryIndex, 1);
    state.balance = Math.round((state.balance + payout) * 100) / 100;
    state.casesOpened++;
    saveState(); renderStats();
    $("#opening-payout-status").textContent = `+${formatCredits(payout)} CR · AUTO-PAID`;
  }
  statusText.textContent = "SIGNAL LOCKED"; scorePreview.textContent = number.toLocaleString();
  summary.textContent = "Reading the number signature…";
  document.body.classList.add("roll-resolving");
  tone(240, 0.18, "sawtooth", 0.04);
  await wait(70);
  rewardsPanel.scrollIntoView({ behavior: fastReveal ? "auto" : "smooth", block: "start" });
  await wait(110);
  await revealBadges(badges, number, !caseItem);
  if (caseItem) {
    summary.innerHTML += `<span class="case-payout"><em class="${caseDrop.rarity}">${caseDrop.name}</em> AUTO-PAYOUT <b>+${formatCredits(payout)} CR CREDITED</b></span>`;
  }
  state.rolls++; state.best = Math.max(state.best, score);
  state.badges = [...new Set([...state.badges, ...badges.map((item) => item.label)])];
  saveState();
  rolling = false; rollButton.disabled = false;
  document.body.classList.remove("is-rolling", "roll-resolving");
  document.body.classList.add("roll-complete");
  statusText.textContent = "ROLL COMPLETE";
  rollButton.querySelector(".button-copy").textContent = "ROLL AGAIN";
  renderStats();
}

async function openInventoryItem(index) {
  if (rolling) return;
  const entry = state.inventory[index];
  if (!entry) return;
  const caseItem = CASES.find((item) => item.id === entry.caseId);
  const caseDrop = findDrop(entry.caseId, entry.traitId);
  if (!caseItem || !caseDrop) return;
  $("#opening-icon").src = traitImage(caseDrop.id);
  $("#opening-trait").textContent = caseDrop.name;
  $("#opening-description").textContent = caseDrop.description;
  $("#opening-payout-status").textContent = "AUTO-PAYOUT CALCULATING…";
  $("#back-inventory").disabled = true;
  setMode("opening", true);
  const number = generateTraitNumber(caseDrop.id, secureRandomNumber());
  const cinematic = caseDrop.rarity === "mythic";
  if (cinematic) {
    rolling = true; renderStats();
    await showRareTraitRoom(caseDrop, number);
    rolling = false;
  }
  await roll({ caseItem, caseDrop, inventoryIndex: index, number, skipAnimation: cinematic });
  $("#back-inventory").disabled = false;
}

rollButton.querySelector(".button-copy").textContent = "SANDBOX ROLL";
rollButton.addEventListener("click", () => roll());
caseBay.addEventListener("click", (event) => {
  const viewButton = event.target.closest("button[data-view-case]");
  const buyButton = event.target.closest("button[data-buy-case]");
  if (viewButton) {
    const item = CASES.find((candidate) => candidate.id === viewButton.dataset.viewCase);
    if (item) renderCaseDetail(item, true);
  }
  if (buyButton) {
    const item = CASES.find((candidate) => candidate.id === buyButton.dataset.buyCase);
    if (item) buyCase(item, buyButton);
  }
});
categoryChips.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-category]");
  if (!button) return;
  selectedCategory = button.dataset.category;
  categoryChips.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
  renderCases();
});
$("#case-search").addEventListener("input", renderCases);
$("#case-sort").addEventListener("change", renderCases);
inventoryGrid.addEventListener("click", (event) => {
  const caseButton = event.target.closest("button[data-open-case]");
  const numberButton = event.target.closest("button[data-open-number]");
  if (caseButton) openPurchasedCase(Number(caseButton.dataset.openCase));
  if (numberButton) openInventoryItem(Number(numberButton.dataset.openNumber));
});
$("[data-go-store]").addEventListener("click", () => setMode("store", true));
$("#back-inventory").addEventListener("click", () => { if (!rolling) setMode("inventory", true); });

const BOT_PROFILES = [
  { username: "0xXENON", level: 87, badge: "VIP HIGH-ROLLER" },
  { username: "SHADOWBYTE", level: 42, badge: "CASE COLLECTOR" },
  { username: "NOVA_404", level: 61, badge: "PATTERN HUNTER" },
  { username: "LUCKY//NULL", level: 29, badge: "GOLD CHASER" },
  { username: "VOIDWALKER", level: 73, badge: "CRAZY MODE ACE" },
  { username: "PIXEL_KING", level: 55, badge: "TEAM SPECIALIST" },
  { username: "CIPHER_X", level: 68, badge: "TERMINAL CLOSER" },
  { username: "ARC//LIGHT", level: 34, badge: "CLUTCH HUNTER" },
];
const BOT_COLORS = ["#00e5ff", "#ff3e8b", "#a66bff", "#f5a623", "#42d989", "#ff7353"];
const BATTLE_FORMATS = {
  "1": { label: "1V1", teams: [[0], [1]] },
  "2": { label: "1V1V1", teams: [[0], [1], [2]] },
  "3": { label: "1V1V1V1", teams: [[0], [1], [2], [3]] },
  "2v2": { label: "2V2", teams: [[0, 1], [2, 3]] },
  "3v3": { label: "3V3", teams: [[0, 1, 2], [3, 4, 5]] },
  "2v2v2": { label: "2V2V2", teams: [[0, 1], [2, 3], [4, 5]] },
};

function selectedBattleFormat() {
  return BATTLE_FORMATS[$("#battle-bots").value] || BATTLE_FORMATS["1"];
}

function teamBattleWinner(mode, histories, teams) {
  if (mode === "share") return -1;
  const values = teams.map((members) => {
    if (mode === "classic") return members.reduce((total, player) => total + histories[player].reduce((sum, score) => sum + score, 0), 0);
    if (mode === "crazy") return -members.reduce((total, player) => total + histories[player].reduce((sum, score) => sum + score, 0), 0);
    if (mode === "clutch") return Math.max(...members.flatMap((player) => histories[player]));
    if (mode === "terminal") return members.reduce((total, player) => total + histories[player].at(-1), 0);
    throw new RangeError("invalid battle mode");
  });
  const best = Math.max(...values);
  const winners = values.map((value, index) => value === best ? index : -1).filter((index) => index >= 0);
  return winners.length === 1 ? winners[0] : -1;
}

function battleTeamName(teamIndex) {
  if (teamIndex < 0) return "DRAW";
  const members = duelMatch.teams[teamIndex];
  return members.length === 1 ? duelMatch.players[members[0]].username : `TEAM ${String.fromCharCode(65 + teamIndex)}`;
}

function renderBattleSettlementBreakdown(payout, sharing, winner) {
  const playerCount = duelMatch.players.length;
  const splitCount = sharing || winner < 0 ? playerCount : duelMatch.teams[winner].length;
  const formula = sharing
    ? `${formatCredits(duelMatch.payoutPot)} CR ÷ ${splitCount} PLAYERS = ${formatCredits(payout)} CR EACH`
    : payout > 0
    ? `${formatCredits(duelMatch.payoutPot)} CR ÷ ${splitCount} ${splitCount === 1 ? "WINNER" : sharing ? "PLAYERS" : "RECIPIENTS"} = ${formatCredits(payout)} CR ${sharing ? "EACH" : "TO YOU"}`
    : `${formatCredits(duelMatch.payoutPot)} CR PAID TO ${battleTeamName(winner)}`;
  const breakdown = $("#battle-settlement-breakdown");
  breakdown.style.setProperty("--ledger-columns", playerCount === 4 ? 2 : Math.min(playerCount, 3));
  breakdown.innerHTML = `<header><span>POT SOURCE LEDGER</span><b>${duelMatch.length} ROUND${duelMatch.length === 1 ? "" : "S"} · ${playerCount} PLAYERS</b></header><div>${duelMatch.players.map((player, index) => `<article class="${index === 0 ? "you" : ""}" style="--player:${BOT_COLORS[player.team % BOT_COLORS.length]}"><i>${index === 0 ? "Y" : `B${index}`}</i><span><strong>${escapeHtml(player.username)}</strong><small>${duelMatch.totals[index].toLocaleString()} TOTAL EP</small></span><b>+${formatCredits(duelMatch.contributions[index])} CR</b></article>`).join("")}</div><footer><span>SETTLEMENT FORMULA</span><strong>${formula}</strong></footer>`;
}

function battlePlayerMarkup(profile, index) {
  const playerNumber = index + 1;
  const isPlayer = index === 0;
  const team = profile?.team ?? index;
  const connecting = profile?.connecting;
  const name = isPlayer ? "YOU" : connecting || !profile ? `BOT SLOT ${index}` : profile.username;
  const subtitle = isPlayer ? "LVL 37 · NUMBER HUNTER" : connecting || !profile ? "CONNECTING…" : `LVL ${profile.level} · ${profile.badge}`;
  return `<article class="duel-player ${isPlayer ? "player-one" : "player-bot"}" data-player="${index}" data-team="${team}" style="--player:${BOT_COLORS[team % BOT_COLORS.length]}"><header><div class="battle-avatar ${isPlayer ? "you-avatar" : "bot-avatar"}">${isPlayer ? "Y" : `B${index}`}</div><div><small>${duelMatch.teams?.[team]?.length > 1 ? `TEAM ${String.fromCharCode(65 + team)}` : isPlayer ? "LOCAL CONTENDER" : "VERIFIED HOUSE BOT"}</small><strong id="duel-name-${playerNumber}">${escapeHtml(name)}</strong><em id="duel-bot-badge-${playerNumber}">${escapeHtml(subtitle)}</em></div><div class="battle-player-total"><span>TOTAL EP</span><b id="duel-total-${playerNumber}">0</b><small id="duel-credit-${playerNumber}">0.00 CR</small></div></header><div class="battle-case-lane" id="battle-lane-${playerNumber}"><i class="battle-lane-reticle"></i><div class="battle-lane-track"></div></div><div class="battle-result-row"><div class="duel-reels" id="duel-number-${playerNumber}">${Array.from({ length: 7 }, (_, digit) => `<i${digit === 6 ? " hidden" : ""}>0</i>`).join("")}</div><strong id="duel-score-${playerNumber}">— THIS ROUND</strong></div><div class="duel-badges" id="duel-badges-${playerNumber}">${isPlayer ? "READY" : "CONNECTING"}</div></article>`;
}

function renderBattlePlayers(profiles = []) {
  const players = [null, ...profiles];
  const arena = $("#duel-arena");
  arena.style.setProperty("--battle-players", players.length);
  arena.dataset.playerCount = players.length;
  arena.innerHTML = `<div class="battle-steal" id="battle-steal" aria-hidden="true"><i></i><span>ROUND CAPTURED</span></div>${players.map(battlePlayerMarkup).join("")}`;
}

function appendBattleFeed(author, message, toneClass = "") {
  const feed = $("#battle-feed");
  feed.insertAdjacentHTML("beforeend", `<p class="${toneClass}"><b>${escapeHtml(author)}</b> ${escapeHtml(message)}</p>`);
  while (feed.children.length > 5) feed.firstElementChild.remove();
  feed.scrollTop = feed.scrollHeight;
}

function animateBattleValue(element, from, to, suffix = "") {
  const duration = fastReveal ? 260 : 720;
  const started = performance.now();
  element.classList.add("counting");
  return new Promise((resolve) => {
    const update = (timestamp) => {
      const progress = Math.min(1, (timestamp - started) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const value = from + (to - from) * eased;
      element.textContent = suffix ? `${formatCredits(value)}${suffix}` : Math.round(value).toLocaleString();
      if (progress < 1) requestAnimationFrame(update);
      else { element.classList.remove("counting"); element.classList.add("counted"); setTimeout(() => element.classList.remove("counted"), 420); resolve(); }
    };
    requestAnimationFrame(update);
  });
}

function reactToBattle(results) {
  const bot = duelMatch.bot;
  let reaction = "next round. locked in.";
  if (results[1].payout >= duelMatch.caseItem.cost * 2) reaction = "LETS GOOOO — huge pull.";
  else if (results[1].payout < duelMatch.caseItem.cost * .35) reaction = "bruh. unlucky, next round.";
  else if (results[0].payout >= duelMatch.caseItem.cost * 2) reaction = "wow, save some luck for me.";
  setTimeout(() => appendBattleFeed(bot.username, reaction, "bot-message"), 400);
}

async function runDuel() {
  if (rolling || !duelMatch.active || duelMatch.round >= duelMatch.length) return;
  startBackgroundMusic(); rolling = true; renderStats();
  const button = $("#duel-roll");
  const numberNodes = [$("#duel-number-1"), $("#duel-number-2")];
  const cells = numberNodes.map((node) => [...node.children]);
  button.disabled = true; $("#duel-round").textContent = `ROUND ${duelMatch.round + 1} ROLLING`; duelPanel.classList.add("duel-rolling");
  cells.flat().forEach((cell, index) => { cell.hidden = index % 7 === 6; cell.classList.remove("locked"); });
  numberNodes.forEach((node) => node.style.setProperty("--duel-count", 6));
  const outcomes = [0, 1].map(() => drawCaseOutcome(duelMatch.caseItem, secureRandomNumber(), secureRandomNumber() / 1_000_001));
  const drops = outcomes.map((outcome) => outcome.drop);
  const numbers = drops.map((drop) => generateTraitNumber(drop.id, secureRandomNumber()));
  const results = numbers.map((number, player) => {
    const badges = evaluateBadges(number);
    const score = badges.reduce((sum, item) => sum + item.score, 0);
    return { number, badges, score, drop: drops[player], payout: casePayout(duelMatch.caseItem, score) };
  });
  const isFinalRound = duelMatch.round === duelMatch.length - 1;
  const cliffhanger = isFinalRound && Math.abs(results[0].payout - results[1].payout) < 5;
  const spinDuration = cliffhanger ? (fastReveal ? 2_200 : 6_700) : null;
  duelPanel.classList.toggle("cliffhanger", cliffhanger);
  if (cliffhanger) { $("#battle-status").textContent = "CLIFFHANGER"; appendBattleFeed("SYSTEM", "Final values are within 5 CR. Slow-motion protocol engaged.", "system-message"); }
  const laneViewports = [$("#battle-lane-1"), $("#battle-lane-2")];
  const laneTracks = laneViewports.map((viewport, player) => {
    const targetIndex = 52;
    const randomDrop = () => drawCaseDrop(duelMatch.caseItem, Math.random());
    const candidates = [...Array.from({ length: targetIndex }, randomDrop), drops[player], ...Array.from({ length: 8 }, randomDrop)];
    const track = viewport.querySelector(".battle-lane-track");
    track.innerHTML = candidates.map((candidate, index) => rouletteCard(candidate, index === targetIndex)).join("");
    return track;
  });
  await Promise.all(laneTracks.map((track, player) => animateRouletteTrack(track, laneViewports[player], 52, `${duelMatch.caseItem.id}:${duelMatch.round}:${player}:${drops[player].id}`, player === 0, spinDuration)));
  const timers = cells.map((playerCells) => setInterval(() => playerCells.slice(0, 6).forEach((cell) => { cell.textContent = Math.floor(Math.random() * 10); }), 42));
  await new Promise((resolve) => setTimeout(resolve, fastReveal ? 180 : 520));
  timers.forEach(clearInterval);
  const digitTargets = numbers.map((number) => number === 1_000_000 ? "1000000" : String(number));
  for (let digit = 0; digit < Math.max(...digitTargets.map((target) => target.length)); digit++) {
    digitTargets.forEach((target, player) => {
      if (digit >= target.length) return;
      cells[player][digit].hidden = false;
      cells[player][digit].textContent = target[digit];
      cells[player][digit].classList.add("locked");
      numberNodes[player].style.setProperty("--duel-count", target.length);
    });
    tone(170 + digit * 38, 0.08, "triangle", 0.035);
    await new Promise((resolve) => setTimeout(resolve, fastReveal ? 25 : 95));
  }
  cells.forEach((playerCells, player) => playerCells.forEach((cell, index) => { cell.hidden = index >= digitTargets[player].length; }));
  $("#duel-badges-1").textContent = "SCANNING BADGES…";
  $("#duel-badges-2").textContent = "SCANNING BADGES…";
  await new Promise((resolve) => setTimeout(resolve, fastReveal ? 120 : 520));
  const orderedBadges = results.map((result) => [...result.badges].sort((a, b) => a.score - b.score || a.label.localeCompare(b.label)));
  const runningScores = [0, 0];
  $("#duel-badges-1").innerHTML = ""; $("#duel-badges-2").innerHTML = "";
  for (let badgeIndex = 0; badgeIndex < Math.max(...orderedBadges.map((badges) => badges.length)); badgeIndex++) {
    await wait(240);
    orderedBadges.forEach((badges, player) => {
      const badge = badges[badgeIndex];
      if (!badge) return;
      runningScores[player] += badge.score;
      $(`#duel-score-${player + 1}`).textContent = `${results[player].drop.name.toUpperCase()} · ${runningScores[player].toLocaleString()} EP`;
      $(`#duel-badges-${player + 1}`).insertAdjacentHTML("afterbegin", `<span class="${badge.rarity} revealing"><img src="${badgeGraphic(badge.label)}" alt="" /><em><strong>${badge.label}</strong><small>${badge.rarity}</small></em><b>+${badge.score.toLocaleString()}</b></span>`);
      tone(320 + badgeIndex * 22, 0.08, "triangle", 0.025);
    });
  }
  const previousTotals = [...duelMatch.totals];
  const previousPot = duelMatch.payoutPot;
  results.forEach((result, index) => {
    duelMatch.totals[index] += result.score;
    duelMatch.histories[index].push(result.score);
    duelMatch.payoutPot = Math.round((duelMatch.payoutPot + result.payout) * 100) / 100;
    $(`#duel-score-${index + 1}`).textContent = `${result.drop.name.toUpperCase()} · ${result.score.toLocaleString()} EP`;
  });
  await Promise.all([
    ...duelMatch.totals.map((total, index) => animateBattleValue($(`#duel-total-${index + 1}`), previousTotals[index], total)),
    animateBattleValue($("#battle-pot"), previousPot, duelMatch.payoutPot, " CR"),
  ]);
  duelMatch.round++;
  const roundWinner = results[0].score === results[1].score ? -1 : results[0].score > results[1].score ? 0 : 1;
  duelPanel.classList.remove("winner-1", "winner-2", "cliffhanger");
  $("#battle-steal").className = "battle-steal";
  if (roundWinner >= 0) {
    const winnerLane = duelPanel.querySelector(`.player-${roundWinner === 0 ? "one" : "two"}`);
    duelPanel.classList.add(`winner-${roundWinner + 1}`);
    winnerLane.classList.add("lane-victory-shake");
    $("#battle-steal").classList.add("active", `to-player-${roundWinner + 1}`);
    setTimeout(() => { winnerLane.classList.remove("lane-victory-shake"); $("#battle-steal").className = "battle-steal"; }, 900);
  }
  reactToBattle(results);
  state.rolls += 2;
  state.best = Math.max(state.best, ...results.map((result) => result.score));
  state.badges = [...new Set([...state.badges, ...results.flatMap((result) => result.badges.map((badge) => badge.label))])];
  if (duelMatch.round >= duelMatch.length) {
    duelMatch.active = false;
    const winner = battleWinner(duelMatch.mode, duelMatch.histories);
    const playerPayout = winner === 0 ? duelMatch.payoutPot : winner < 0 ? Math.round(duelMatch.payoutPot * 50) / 100 : 0;
    state.balance = Math.round((state.balance + playerPayout) * 100) / 100;
    $("#duel-round").textContent = winner < 0 ? `DRAW · +${formatCredits(playerPayout)} CR AUTO-PAID` : winner === 0 ? `YOU WIN · +${formatCredits(playerPayout)} CR AUTO-PAID` : `${duelMatch.bot.username} WINS · POT SETTLED`;
    $("#battle-status").textContent = winner === 0 ? "VICTORY" : winner < 0 ? "DRAW" : "DEFEAT";
    appendBattleFeed("SYSTEM", winner === 0 ? `${formatCredits(playerPayout)} CR credited instantly.` : winner < 0 ? `${formatCredits(playerPayout)} CR split credited instantly.` : `${duelMatch.bot.username} captured the pot.`, winner === 0 ? "win-message" : "system-message");
    if (winner >= 0) { state.duelWins[winner]++; duelPanel.classList.add(`winner-${winner + 1}`); }
    button.textContent = "MATCH COMPLETE";
    $("#duel-start").textContent = "CREATE REMATCH";
    $("#duel-start").disabled = false;
    $("#duel-length").disabled = false;
    $("#battle-case").disabled = false;
    $("#battle-mode").disabled = false;
  } else {
    $("#duel-round").textContent = `ROUND ${duelMatch.round} / ${duelMatch.length} COMPLETE`;
    $("#battle-status").textContent = "ROUND COMPLETE";
    button.innerHTML = `ROLL ROUND ${duelMatch.round + 1} / ${duelMatch.length} <span>⚡</span>`;
    button.disabled = false;
  }
  saveState(); rolling = false; duelPanel.classList.remove("duel-rolling"); renderStats();
  tone(roundWinner < 0 ? 520 : 820, 0.45, "triangle", 0.08);
}

function startDuel() {
  if (rolling) return;
  const caseItem = CASES.find((item) => item.id === $("#battle-case").value);
  const length = Number($("#duel-length").value);
  const entry = caseItem.cost * length;
  if (state.balance + 0.0001 < entry) {
    $("#duel-round").textContent = `NEED ${formatCredits(entry)} CREDITS`;
    tone(130, 0.3, "sawtooth", 0.04);
    return;
  }
  state.balance = Math.round((state.balance - entry) * 100) / 100;
  const bot = BOT_PROFILES[Math.floor(Math.random() * BOT_PROFILES.length)];
  duelMatch = { caseItem, mode: $("#battle-mode").value, length, round: 0, totals: [0, 0], histories: [[], []], payoutPot: 0, active: false, joining: true, bot };
  duelPanel.classList.remove("winner-1", "winner-2");
  $("#duel-total-1").textContent = "0"; $("#duel-total-2").textContent = "0";
  $("#duel-score-1").textContent = "— PTS THIS ROLL"; $("#duel-score-2").textContent = "— PTS THIS ROLL";
  $("#duel-badges-1").textContent = "READY TO ROLL"; $("#duel-badges-2").textContent = "READY TO ROLL";
  $("#duel-round").textContent = "WAITING FOR BOT";
  $("#battle-pot").textContent = "0.00 CR";
  $("#battle-mode-live").textContent = duelMatch.mode.toUpperCase();
  $("#battle-speed").textContent = fastReveal ? "TURBO" : "STANDARD";
  $("#battle-status").textContent = "MATCHMAKING";
  $("#duel-name-2").textContent = "SEARCHING…";
  $("#duel-bot-badge").textContent = "OPEN SLOT";
  $("#battle-feed").innerHTML = "";
  appendBattleFeed("SYSTEM", `Battle created. Searching for a verified bot opponent.`);
  $("#duel-start").disabled = true; $("#duel-length").disabled = true; $("#battle-case").disabled = true; $("#battle-mode").disabled = true;
  $("#duel-roll").disabled = true;
  $("#duel-roll").innerHTML = `WAITING FOR OPPONENT <span>⌁</span>`;
  saveState(); renderStats();
  const match = duelMatch;
  setTimeout(() => {
    if (duelMatch !== match || !duelMatch.joining) return;
    duelMatch.joining = false; duelMatch.active = true;
    $("#duel-name-2").textContent = bot.username;
    $("#duel-bot-badge").textContent = `LVL ${bot.level} · ${bot.badge}`;
    $("#duel-badges-2").textContent = "BOT READY";
    $("#duel-round").textContent = `${duelMatch.mode.toUpperCase()} · 0 / ${duelMatch.length}`;
    $("#battle-status").textContent = "OPPONENT CONNECTED";
    $("#duel-roll").disabled = false;
    $("#duel-roll").innerHTML = `ROLL ROUND 1 / ${duelMatch.length} <span>⚡</span>`;
    appendBattleFeed(bot.username, "joined the battle. gl hf", "bot-message");
    tone(680, .2, "triangle", .05);
  }, 1_500 + Math.floor(Math.random() * 3_001));
}

async function runGroupBattle() {
  if (rolling || !duelMatch.active || duelMatch.round >= duelMatch.length) return;
  startBackgroundMusic(); rolling = true; renderStats();
  const playerCount = duelMatch.players.length;
  const caseItem = duelMatch.cases[duelMatch.round];
  duelMatch.caseItem = caseItem;
  renderBattleTimeline();
  const button = $("#duel-roll");
  const numberNodes = Array.from({ length: playerCount }, (_, index) => $(`#duel-number-${index + 1}`));
  const cells = numberNodes.map((node) => [...node.children]);
  button.innerHTML = `ROUND ${duelMatch.round + 1} AUTO-RUNNING <span>⚡</span>`;
  $("#duel-round").textContent = `${duelMatch.round + 1} / ${duelMatch.length}`;
  $("#battle-status").textContent = "LIVE";
  duelPanel.classList.add("duel-rolling");
  cells.flat().forEach((cell, index) => { cell.hidden = index % 7 === 6; cell.classList.remove("locked"); });
  numberNodes.forEach((node) => { node.classList.remove("seven-digit"); node.style.setProperty("--duel-count", 6); });

  const outcomes = Array.from({ length: playerCount }, () => drawCaseOutcome(caseItem, secureRandomNumber(), secureRandomNumber() / 1_000_001));
  const drops = outcomes.map((outcome) => outcome.drop);
  const numbers = drops.map((drop) => generateTraitNumber(drop.id, secureRandomNumber()));
  const results = numbers.map((number, player) => {
    const badges = evaluateBadges(number);
    return { number, badges, score: badges.reduce((sum, item) => sum + item.score, 0), drop: drops[player], payout: casePayout(caseItem, badges.reduce((sum, item) => sum + item.score, 0)) };
  });
  const payouts = results.map((result) => result.payout);
  const cliffhanger = duelMatch.mode !== "share" && duelMatch.round === duelMatch.length - 1 && Math.max(...payouts) - Math.min(...payouts) < 5;
  const spinDuration = (duelMatch.turbo ? 950 : 5_200) + (cliffhanger ? 1_500 : 0);
  duelPanel.classList.toggle("cliffhanger", cliffhanger);
  if (cliffhanger) appendBattleFeed("SYSTEM", "Final values are within 5 CR. Slow-motion protocol engaged.", "system-message");

  const battleTargetIndex = 34;
  const laneViewports = Array.from({ length: playerCount }, (_, index) => $(`#battle-lane-${index + 1}`));
  const laneTracks = laneViewports.map((viewport, player) => {
    const triggerCard = caseBonusTrigger(caseItem);
    const randomDrop = () => Math.random() < .02 ? triggerCard : drawCaseDrop(caseItem, Math.random());
    const firstResult = outcomes[player].gold ? triggerCard : drops[player];
    const candidates = [...Array.from({ length: battleTargetIndex }, randomDrop), firstResult, ...Array.from({ length: 6 }, randomDrop)];
    const track = viewport.querySelector(".battle-lane-track");
    track.innerHTML = candidates.map((candidate) => rouletteCard(candidate)).join("");
    return track;
  });
  await Promise.all(laneTracks.map((track, player) => animateRouletteTrack(track, laneViewports[player], battleTargetIndex, `${caseItem.id}:${duelMatch.round}:${player}:${drops[player].id}`, player === 0, spinDuration)));

  const bonusPlayers = outcomes.flatMap((outcome, player) => outcome.gold ? [player] : []);
  if (bonusPlayers.length) {
    const nestedBonus = caseItem.bonusType === "nested";
    const triggerName = nestedBonus ? "an Inner Case" : "a Gold Coin";
    $("#battle-status").textContent = nestedBonus ? "INNER CASE" : "GOLD BONUS";
    appendBattleFeed("SYSTEM", `${bonusPlayers.map((player) => duelMatch.players[player].username).join(" + ")} hit ${bonusPlayers.length === 1 ? triggerName : nestedBonus ? "Inner Cases" : "Gold Coins"}. Bonus spin${bonusPlayers.length === 1 ? "" : "s"} armed.`, nestedBonus ? "nested-message" : "gold-message");
    bonusPlayers.forEach((player) => {
      $(`#duel-score-${player + 1}`).textContent = `${nestedBonus ? "CASE INSIDE A CASE" : "GOLD COIN"} · BONUS SPIN`;
      laneViewports[player].classList.add(nestedBonus ? "nested-bonus-active" : "gold-bonus-active");
      laneViewports[player].insertAdjacentHTML("beforeend", nestedBonus ? `<div class="battle-gold-trigger battle-nested-trigger"><b>${caseImage(caseItem)}</b><span>INNER CASE<small>BONUS SPIN</small></span></div>` : '<div class="battle-gold-trigger"><b class="gold-medallion">G</b><span>GOLD COIN<small>BONUS SPIN</small></span></div>');
      const randomGoldDrop = () => drawGoldDrop(caseItem, Math.random());
      const candidates = [...Array.from({ length: battleTargetIndex }, randomGoldDrop), drops[player], ...Array.from({ length: 6 }, randomGoldDrop)];
      laneTracks[player].innerHTML = candidates.map((candidate) => rouletteCard(candidate)).join("");
    });
    tone(1_120, .8, "sine", .08);
    await new Promise((resolve) => setTimeout(resolve, duelMatch.turbo ? 180 : 520));
    await Promise.all(bonusPlayers.map((player) => animateRouletteTrack(laneTracks[player], laneViewports[player], battleTargetIndex, `${caseItem.id}:${duelMatch.round}:${player}:bonus:${drops[player].id}`, player === 0, duelMatch.turbo ? 950 : 3_900)));
    bonusPlayers.forEach((player) => {
      laneViewports[player].classList.remove("gold-bonus-active", "nested-bonus-active");
      laneViewports[player].querySelector(".battle-gold-trigger")?.remove();
    });
  }

  const digitTimer = setInterval(() => cells.forEach((playerCells) => playerCells.slice(0, 6).forEach((cell) => { cell.textContent = Math.floor(Math.random() * 10); })), duelMatch.turbo ? 48 : 60);
  await new Promise((resolve) => setTimeout(resolve, duelMatch.turbo ? 420 : 1_200));
  clearInterval(digitTimer);
  const digitTargets = numbers.map((number) => number === 1_000_000 ? "1000000" : String(number));
  for (let digit = 0; digit < Math.max(...digitTargets.map((target) => target.length)); digit++) {
    digitTargets.forEach((target, player) => {
      if (digit >= target.length) return;
      cells[player][digit].hidden = false;
      cells[player][digit].textContent = target[digit];
      cells[player][digit].classList.add("locked");
      numberNodes[player].classList.toggle("seven-digit", target.length === 7);
      numberNodes[player].style.setProperty("--duel-count", target.length);
    });
    tone(170 + digit * 38, .08, "triangle", .035);
    await new Promise((resolve) => setTimeout(resolve, duelMatch.turbo ? 50 : 130));
  }
  cells.forEach((playerCells, player) => playerCells.forEach((cell, index) => { cell.hidden = index >= digitTargets[player].length; }));

  const visibleBadges = results.map((result) => [...result.badges].sort((a, b) => b.score - a.score).slice(0, 2));
  visibleBadges.forEach((badges, player) => {
    $(`#duel-badges-${player + 1}`).innerHTML = badges.map((badge) => `<span class="${badge.rarity} revealing"><img src="${badgeGraphic(badge.label)}" alt="" /><em><strong>${badge.label}</strong><small>${badge.rarity}</small></em><b>+${badge.score.toLocaleString()}</b></span>`).join("") || "NO BONUS PATTERN";
    $(`#duel-score-${player + 1}`).textContent = `${results[player].drop.name.toUpperCase()} · ${results[player].score.toLocaleString()} EP · ${formatCredits(results[player].payout)} CR`;
  });

  const previousTotals = [...duelMatch.totals];
  const previousPot = duelMatch.payoutPot;
  results.forEach((result, index) => {
    duelMatch.totals[index] += result.score;
    duelMatch.histories[index].push(result.score);
    duelMatch.contributions[index] = Math.round((duelMatch.contributions[index] + result.payout) * 100) / 100;
    duelMatch.payoutPot = Math.round((duelMatch.payoutPot + result.payout) * 100) / 100;
  });
  await Promise.all([
    ...duelMatch.totals.map((total, index) => animateBattleValue($(`#duel-total-${index + 1}`), previousTotals[index], total)),
    ...duelMatch.totals.map((total, index) => animateBattleValue($(`#duel-credit-${index + 1}`), epToCredits(previousTotals[index]), epToCredits(total), " CR")),
    animateBattleValue($("#battle-pot"), previousPot, duelMatch.payoutPot, " CR"),
  ]);
  duelMatch.round++;
  renderBattleTimeline();

  const sharing = duelMatch.mode === "share";
  const roundWinner = teamBattleWinner(duelMatch.mode, results.map((result) => [result.score]), duelMatch.teams);
  duelPanel.classList.remove("cliffhanger");
  duelPanel.querySelectorAll(".duel-player").forEach((lane) => lane.classList.remove("round-winner", "lane-victory-shake"));
  if (sharing) {
    const lanes = [...duelPanel.querySelectorAll(".duel-player")];
    lanes.forEach((lane) => lane.classList.add("round-winner"));
    $("#battle-steal").querySelector("span").textContent = "ROUND WINNINGS SHARED";
    $("#battle-steal").classList.add("active");
    setTimeout(() => $("#battle-steal").classList.remove("active"), 900);
  } else if (roundWinner >= 0) {
    const lanes = duelMatch.teams[roundWinner].map((player) => duelPanel.querySelector(`[data-player="${player}"]`));
    lanes.forEach((lane) => lane.classList.add("round-winner", "lane-victory-shake"));
    $("#battle-steal").querySelector("span").textContent = `${battleTeamName(roundWinner)} CAPTURES ROUND`;
    $("#battle-steal").classList.add("active");
    setTimeout(() => { lanes.forEach((lane) => lane.classList.remove("lane-victory-shake")); $("#battle-steal").classList.remove("active"); }, 900);
  }
  reactToGroupBattle(results);
  state.rolls += playerCount;
  state.best = Math.max(state.best, ...results.map((result) => result.score));
  state.badges = [...new Set([...state.badges, ...results.flatMap((result) => result.badges.map((badge) => badge.label))])];

  if (duelMatch.round >= duelMatch.length) {
    duelMatch.active = false;
    duelMatch.settled = true;
    const winner = teamBattleWinner(duelMatch.mode, duelMatch.histories, duelMatch.teams);
    const userWon = winner === 0;
    const payout = sharing ? splitBattlePot(duelMatch.payoutPot, playerCount) : userWon ? Math.round(duelMatch.payoutPot * 100 / duelMatch.teams[0].length) / 100 : winner < 0 ? splitBattlePot(duelMatch.payoutPot, playerCount) : 0;
    state.balance = Math.round((state.balance + payout) * 100) / 100;
    const winnerName = sharing ? "EVERYONE" : battleTeamName(winner);
    const winnerRoster = sharing ? `Every player receives an equal ${formatCredits(payout)} CR share.` : winner < 0 ? "All tied players split the pot." : duelMatch.teams[winner].map((player) => duelMatch.players[player].username).join(" + ");
    $("#duel-round").textContent = sharing ? `SHARED · +${formatCredits(payout)} CR AUTO-PAID` : winner < 0 ? `DRAW · +${formatCredits(payout)} CR AUTO-PAID` : userWon ? `YOU WIN · +${formatCredits(payout)} CR AUTO-PAID` : `${winnerName} WINS · POT SETTLED`;
    $("#battle-status").textContent = sharing ? "SHARED" : userWon ? "VICTORY" : winner < 0 ? "DRAW" : "DEFEAT";
    appendBattleFeed("SYSTEM", sharing ? `${formatCredits(duelMatch.payoutPot)} CR pot shared equally. ${formatCredits(payout)} CR credited to every player.` : userWon ? `${formatCredits(payout)} CR credited instantly.` : winner < 0 ? `${formatCredits(payout)} CR split credited instantly.` : `${winnerName} captured the pot.`, sharing || userWon ? "win-message" : "system-message");
    if (!sharing && winner >= 0) state.duelWins[userWon ? 0 : 1]++;
    const winnerBanner = $("#battle-winner-banner");
    winnerBanner.hidden = false;
    winnerBanner.className = `battle-winner-banner ${sharing ? "share" : winner < 0 ? "draw" : userWon ? "victory" : "defeat"}`;
    $("#battle-winner-kicker").textContent = `${duelMatch.format.label} · ${duelMatch.mode.toUpperCase()} · BATTLE COMPLETE`;
    $("#battle-winner-title").textContent = sharing ? "POT SHARED" : winner < 0 ? "DRAW" : `${winnerName} WINS`;
    $("#battle-winner-roster").textContent = winnerRoster;
    $("#battle-winner-payout").textContent = `${formatCredits(duelMatch.payoutPot)} CR POT`;
    renderBattleSettlementBreakdown(payout, sharing, winner);
    $("#battle-winner-credit").textContent = sharing ? `YOUR EQUAL SHARE · +${formatCredits(payout)} CR AUTO-PAID` : payout > 0 ? `+${formatCredits(payout)} CR AUTO-PAID TO YOU` : `${winnerName} CLAIMED THE FULL SETTLEMENT`;
    button.textContent = "BATTLE COMPLETE";
    ["#duel-start", "#battle-mode", "#battle-bots", "#battle-speed-select"].forEach((selector) => { $(selector).disabled = false; });
  } else {
    $("#duel-round").textContent = `${duelMatch.round} / ${duelMatch.length} COMPLETE`;
    $("#battle-status").textContent = "NEXT ROUND QUEUED";
    button.innerHTML = `ROUND ${duelMatch.round + 1} AUTO-STARTING <span>⌁</span>`;
  }
  saveState(); rolling = false; duelPanel.classList.remove("duel-rolling"); renderStats();
  tone(roundWinner < 0 ? 520 : 820, .45, "triangle", .08);
  if (duelMatch.active) setTimeout(() => { if (duelMatch.active && !rolling) runGroupBattle(); }, duelMatch.turbo ? 400 : 950);
}

function reactToGroupBattle(results) {
  const bestBotIndex = results.slice(1).reduce((best, result, index, items) => result.payout > items[best].payout ? index : best, 0) + 1;
  const bot = duelMatch.players[bestBotIndex];
  const message = results[0].payout >= duelMatch.caseItem.cost * 2 ? "save some luck for us." : results[bestBotIndex].payout >= duelMatch.caseItem.cost * 2 ? "LETS GOOOO — huge pull." : "next round. locked in.";
  setTimeout(() => appendBattleFeed(bot.username, message, "bot-message"), 350);
}

function startGroupBattle() {
  if (rolling || duelMatch.active || duelMatch.joining) return;
  const cases = battleCaseIds.map((id) => CASES.find((item) => item.id === id)).filter(Boolean);
  if (!cases.length) return;
  const caseItem = cases[0];
  const length = cases.length;
  const format = selectedBattleFormat();
  const botCount = format.teams.flat().length - 1;
  const entry = cases.reduce((sum, item) => sum + item.cost, 0);
  if (state.balance + .0001 < entry) { $("#duel-round").textContent = `NEED ${formatCredits(entry)} CREDITS`; tone(130, .3, "sawtooth", .04); return; }
  state.balance = Math.round((state.balance - entry) * 100) / 100;
  const bots = [...BOT_PROFILES].sort(() => Math.random() - .5).slice(0, botCount);
  const players = [{ username: "YOU", level: 37, badge: "NUMBER HUNTER" }, ...bots].map((player, index) => ({ ...player, team: format.teams.findIndex((members) => members.includes(index)) }));
  duelMatch = { cases, caseItem, format, teams: format.teams, mode: $("#battle-mode").value, length, round: 0, totals: Array(players.length).fill(0), histories: Array.from({ length: players.length }, () => []), contributions: Array(players.length).fill(0), payoutPot: 0, active: false, joining: true, settled: false, turbo: $("#battle-speed-select").value === "turbo", players };
  document.body.classList.add("battle-focus");
  $("#battle-creator").hidden = true;
  $("#battle-live-shell").hidden = false;
  $("#battle-winner-banner").hidden = true;
  renderBattlePlayers(players.slice(1).map((player) => ({ ...player, connecting: true })));
  renderBattleTimeline();
  $("#duel-round").textContent = "FILLING BOT SEATS"; $("#battle-pot").textContent = "0.00 CR"; $("#battle-mode-live").textContent = `${format.label} · ${duelMatch.mode.toUpperCase()}`; $("#battle-speed").textContent = duelMatch.turbo ? "FAST" : "STANDARD"; $("#battle-status").textContent = "MATCHMAKING";
  $("#battle-feed").innerHTML = ""; appendBattleFeed("SYSTEM", `Battle created. Filling ${botCount} verified bot seat${botCount === 1 ? "" : "s"}.`);
  ["#duel-start", "#battle-mode", "#battle-bots", "#battle-speed-select"].forEach((selector) => { $(selector).disabled = true; });
  $("#duel-roll").innerHTML = `WAITING FOR ${botCount} BOT${botCount === 1 ? "" : "S"} <span>⌁</span>`;
  saveState(); renderStats();
  const match = duelMatch;
  let joined = 0;
  bots.forEach((bot, botIndex) => setTimeout(() => {
    if (duelMatch !== match || !duelMatch.joining) return;
    const playerNumber = botIndex + 2;
    $(`#duel-name-${playerNumber}`).textContent = bot.username;
    $(`#duel-bot-badge-${playerNumber}`).textContent = `LVL ${bot.level} · ${bot.badge}`;
    $(`#duel-badges-${playerNumber}`).textContent = "READY";
    appendBattleFeed(bot.username, "joined the battle. gl hf", "bot-message");
    joined++;
    if (joined === bots.length) {
      duelMatch.joining = false; duelMatch.active = true;
      $("#duel-round").textContent = `0 / ${duelMatch.length} · READY`;
      $("#battle-status").textContent = "ALL PLAYERS READY";
      $("#duel-roll").innerHTML = `ROUND 1 AUTO-STARTING <span>⌁</span>`;
      appendBattleFeed("SYSTEM", "All seats locked. Round one starts automatically.");
      setTimeout(() => { if (duelMatch === match && duelMatch.active) runGroupBattle(); }, 850);
    }
  }, 1_500 + botIndex * 700 + Math.floor(Math.random() * 1_001)));
}

function groupBattleCases(ids) {
  return ids.reduce((groups, id, index) => {
    const previous = groups.at(-1);
    if (previous?.id === id) { previous.quantity++; previous.end = index; }
    else groups.push({ id, quantity: 1, start: index, end: index });
    return groups;
  }, []);
}

function renderBattleCost() {
  const total = battleCaseIds.reduce((sum, id) => sum + (CASES.find((item) => item.id === id)?.cost || 0), 0);
  const format = selectedBattleFormat();
  const players = format.teams.flat().length;
  $("#battle-entry").textContent = `${formatCredits(total)} CR · YOUR SEAT · ${format.label} · ${players} PLAYERS`;
  $("#battle-creator-total").textContent = `${formatCredits(total)} CR`;
  $("#battle-creator-rounds").textContent = `${battleCaseIds.length} ${battleCaseIds.length === 1 ? "ROUND" : "ROUNDS"}`;
  $("#duel-start").disabled = !battleCaseIds.length || state.balance + .0001 < total;
}

function renderBattleBasket() {
  const groups = groupBattleCases(battleCaseIds);
  $("#battle-case-accumulator").innerHTML = groups.length ? groups.map((group) => {
    const item = CASES.find((candidate) => candidate.id === group.id);
    return `<button class="checkout-case-node scale-in" type="button" data-remove-battle-case="${group.end}" title="Remove one ${escapeHtml(item.name)}"><span style="--case-accent:${item.accent};--case-secondary:${item.secondary}">${caseImage(item)}</span><b>×${group.quantity}</b><small>${escapeHtml(item.name)}</small></button>`;
  }).join("") : '<p>ADD CASES FROM THE REGISTRY BELOW</p>';
  const counts = new Map(battleCaseIds.map((id) => [id, battleCaseIds.filter((candidate) => candidate === id).length]));
  document.querySelectorAll("[data-battle-case-count]").forEach((badge) => {
    const count = counts.get(badge.dataset.battleCaseCount) || 0;
    badge.textContent = count;
    badge.hidden = count === 0;
  });
  $("#battle-clear-cases").disabled = !battleCaseIds.length;
  renderBattleCost();
}

function renderBattleCreatorCases() {
  const query = $("#battle-case-search").value.trim().toLowerCase();
  const price = $("#battle-price-filter").value;
  const matchesPrice = (cost) => price === "all" || price === "starter" && cost < 500 || price === "low" && cost >= 500 && cost < 1_000 || price === "mid" && cost >= 1_000 && cost < 5_000 || price === "high" && cost >= 5_000 && cost < 20_000 || price === "elite" && cost >= 20_000;
  const cases = CASES.filter((item) => matchesPrice(item.cost) && (!query || `${item.name} ${item.category} ${item.risk}`.toLowerCase().includes(query)));
  const renderCard = (item) => `<article class="creator-case-card" style="--case-accent:${item.accent};--case-secondary:${item.secondary}"><b class="creator-case-badge-count" data-battle-case-count="${item.id}" hidden>0</b><button class="creator-case-preview" type="button" data-inspect-battle-case="${item.id}" aria-label="View contents of ${escapeHtml(item.name)}"><div class="creator-case-art">${caseImage(item)}</div><div class="creator-case-details"><span>${item.category} · ${item.risk}</span><h2 class="creator-case-title">${escapeHtml(item.name)}</h2><p class="creator-case-cost">${formatCredits(item.cost)} CR</p><small>VIEW ${item.drops.length} CONTENTS</small></div></button><button class="btn-add-case-to-battle" type="button" data-add-battle-case="${item.id}">+ ADD TO BATTLE</button></article>`;
  const categories = [...new Set(cases.map((item) => item.category))];
  $("#battle-case-grid").innerHTML = categories.map((category, index) => {
    const items = cases.filter((item) => item.category === category);
    return `<section class="creator-case-shelf"><header><div><span>${items[0].glyph}</span><strong>${escapeHtml(category)} CASES</strong><small>${items.length} AVAILABLE</small></div><nav><button type="button" data-creator-scroll="prev" data-creator-row="${index}" aria-label="Previous ${escapeHtml(category)} cases">‹</button><button type="button" data-creator-scroll="next" data-creator-row="${index}" aria-label="Next ${escapeHtml(category)} cases">›</button></nav></header><div class="creator-case-row" data-creator-row-index="${index}">${items.map(renderCard).join("")}</div></section>`;
  }).join("") || '<p class="creator-empty">NO CASES MATCH THIS FILTER.</p>';
  renderBattleBasket();
}

function inspectBattleCase(caseId) {
  const item = CASES.find((candidate) => candidate.id === caseId);
  if (!item) return;
  $("#battle-case-inspector-content").innerHTML = `<header style="--case-accent:${item.accent};--case-secondary:${item.secondary}"><div class="battle-inspector-art">${caseImage(item)}</div><div><span>${item.category} · ${item.risk.toUpperCase()} RISK</span><h2>${escapeHtml(item.name)}</h2><strong>${formatCredits(item.cost)} CR</strong></div><button type="button" data-add-battle-case="${item.id}">+ ADD TO BATTLE</button></header><div class="battle-inspector-odds"><span>CASE CONTENTS</span><b>FINAL ODDS</b></div><ol>${item.drops.map((drop) => `<li class="${drop.rarity}"><img src="${traitImage(drop.id)}" alt="" /><span><strong>${escapeHtml(drop.name)}</strong><small>${drop.rarity} · ${Math.round(drop.expectedEp).toLocaleString()} AVG EP</small></span><b>${formatChance(drop.finalChance)}%</b></li>`).join("")}</ol>`;
  $("#battle-case-inspector").showModal();
}

function renderBattleTimeline() {
  if (!duelMatch.cases?.length) return;
  const ids = duelMatch.cases.map((item) => item.id);
  const groups = groupBattleCases(ids);
  const timeline = $("#battle-cases-timeline");
  const signature = groups.map((group) => `${group.id}:${group.quantity}`).join("|");
  if (timeline.dataset.signature !== signature) {
    timeline.dataset.signature = signature;
    timeline.innerHTML = groups.map((group, index) => {
      const item = duelMatch.cases[group.start];
      return `<div class="timeline-case-node" data-timeline-group="${index}" style="--case-accent:${item.accent};--case-secondary:${item.secondary}" title="${escapeHtml(item.name)}"><div class="timeline-case-art">${caseImage(item)}</div><b class="case-multiplier-pill">×${group.quantity}</b><small>${escapeHtml(item.name)}</small></div>`;
    }).join("");
  }
  groups.forEach((group, index) => {
    const node = timeline.querySelector(`[data-timeline-group="${index}"]`);
    node.classList.toggle("is-completed", duelMatch.round > group.end);
    node.classList.toggle("is-active", duelMatch.round >= group.start && duelMatch.round <= group.end && duelMatch.round < duelMatch.length);
  });
  const current = duelMatch.cases[Math.min(duelMatch.round, duelMatch.length - 1)];
  $("#battle-round-count").textContent = duelMatch.round >= duelMatch.length ? `${duelMatch.length} / ${duelMatch.length} COMPLETE` : `ROUND ${duelMatch.round + 1} / ${duelMatch.length}`;
  $("#battle-current-case").textContent = duelMatch.round >= duelMatch.length ? "ALL CASES RESOLVED" : current.name.toUpperCase();
  $("#battle-sequence-total").textContent = `${formatCredits(duelMatch.cases.reduce((sum, item) => sum + item.cost, 0))} CR`;
  timeline.querySelector(".is-active")?.scrollIntoView({ behavior: fastReveal ? "auto" : "smooth", block: "nearest", inline: "center" });
}

function renderBattleCases() {
  const selected = $("#battle-case").value || battleCaseIds[0] || CASES[0].id;
  $("#battle-case").innerHTML = CASES.map((item) => `<option value="${item.id}">${escapeHtml(item.name)} · ${formatCredits(item.cost)} CR</option>`).join("");
  $("#battle-case").value = CASES.some((item) => item.id === selected) ? selected : CASES[0].id;
  renderBattleCreatorCases();
}

function showBattleCreator() {
  if (rolling || duelMatch.active || duelMatch.joining) return;
  duelMatch.settled = false;
  document.body.classList.remove("battle-focus");
  $("#battle-live-shell").hidden = true;
  $("#battle-creator").hidden = false;
  renderBattleCreatorCases();
}

renderBattleCases();
renderBattlePlayers([null]);
$("#battle-case-search").addEventListener("input", renderBattleCreatorCases);
$("#battle-price-filter").addEventListener("change", renderBattleCreatorCases);
$("#battle-case-grid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-add-battle-case]");
  if (button && battleCaseIds.length < 20) { battleCaseIds.push(button.dataset.addBattleCase); renderBattleBasket(); return; }
  const inspect = event.target.closest("[data-inspect-battle-case]");
  if (inspect) { inspectBattleCase(inspect.dataset.inspectBattleCase); return; }
  const scroll = event.target.closest("[data-creator-scroll]");
  if (scroll) {
    const row = $(`[data-creator-row-index="${scroll.dataset.creatorRow}"]`);
    row.scrollBy({ left: (scroll.dataset.creatorScroll === "next" ? 1 : -1) * row.clientWidth * .82, behavior: fastReveal ? "auto" : "smooth" });
  }
});
$("#battle-case-inspector").addEventListener("click", (event) => {
  const add = event.target.closest("[data-add-battle-case]");
  if (add && battleCaseIds.length < 20) { battleCaseIds.push(add.dataset.addBattleCase); renderBattleBasket(); }
  if (event.target === $("#battle-case-inspector")) $("#battle-case-inspector").close();
});
$(".battle-inspector-close").addEventListener("click", () => $("#battle-case-inspector").close());
$("#battle-case-accumulator").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-battle-case]");
  if (!button) return;
  battleCaseIds.splice(Number(button.dataset.removeBattleCase), 1);
  renderBattleBasket();
});
$("#battle-clear-cases").addEventListener("click", () => { battleCaseIds = []; renderBattleBasket(); });
$("#battle-case").addEventListener("change", () => {
  battleCaseIds = Array(Number($("#duel-length").value) || 1).fill($("#battle-case").value);
  renderBattleBasket();
});
$("#duel-length").addEventListener("change", () => {
  battleCaseIds = Array(Number($("#duel-length").value) || 1).fill($("#battle-case").value || CASES[0].id);
  renderBattleBasket();
});
$("#battle-bots").addEventListener("change", () => {
  renderBattleCost();
  if (!duelMatch.active && !duelMatch.joining) {
    const format = selectedBattleFormat();
    duelMatch.teams = format.teams;
    const playerCount = format.teams.flat().length;
    renderBattlePlayers(Array.from({ length: playerCount - 1 }, (_, index) => ({ team: format.teams.findIndex((members) => members.includes(index + 1)), connecting: true })));
  }
});
$("#battle-new").addEventListener("click", showBattleCreator);
$("#duel-start").addEventListener("click", startGroupBattle);
dailyButton.addEventListener("click", async () => {
  if (state.dailyDate === localDayKey()) return;
  startBackgroundMusic(); dailyButton.disabled = true; dailyButton.classList.add("claiming");
  const reward = dailyReward(secureRandomNumber());
  await new Promise((resolve) => setTimeout(resolve, fastReveal ? 400 : 1300));
  state.balance = Math.round((state.balance + reward) * 100) / 100;
  state.dailyDate = localDayKey(); saveState(); renderStats();
  dailyButton.classList.remove("claiming");
  dailyButton.querySelector("strong").textContent = `+${reward.toLocaleString()} CR`;
  tone(760, 0.5, "triangle", 0.08);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "F1") {
    event.preventDefault();
    if (adminDialog.open) adminDialog.close(); else { renderStats(); adminDialog.showModal(); }
    return;
  }
  if (event.code === "Space" && event.target === document.body && currentMode === "sandbox") {
    event.preventDefault(); roll();
  }
});

const dialog = $("#odds-dialog");
const adminDialog = $("#admin-dialog");
const adminStatus = $("#admin-status");
const setAdminStatus = (message) => { adminStatus.textContent = message; };
$("#admin-case-select").innerHTML = CASES.map((item) => `<option value="${item.id}">${escapeHtml(item.category)} · ${escapeHtml(item.name)} · ${formatCredits(item.cost)} CR</option>`).join("");
$("#odds-button").addEventListener("click", () => dialog.showModal());
$(".dialog-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
$(".admin-close").addEventListener("click", () => adminDialog.close());
adminDialog.addEventListener("click", (event) => { if (event.target === adminDialog) adminDialog.close(); });
adminDialog.querySelectorAll("[data-admin-credit]").forEach((button) => button.addEventListener("click", () => {
  $("#admin-credit-amount").value = button.dataset.adminCredit;
}));
$("#admin-add-credits").addEventListener("click", () => {
  const amount = Number($("#admin-credit-amount").value);
  if (!Number.isFinite(amount) || amount <= 0) return;
  state.balance = Math.round((state.balance + amount) * 100) / 100;
  saveState(); renderStats(); setAdminStatus(`Added ${formatCredits(amount)} virtual credits.`); tone(760, 0.3, "triangle", 0.07);
});
$("#admin-grant-case").addEventListener("click", () => {
  const caseItem = CASES.find((item) => item.id === $("#admin-case-select").value);
  if (!caseItem) return;
  state.inventory.push({ type: "case", caseId: caseItem.id, acquiredAt: Date.now() + Math.random() });
  saveState(); renderStats(); setAdminStatus(`${caseItem.name} added to inventory.`); tone(620, 0.16, "triangle", 0.05);
});
$("#admin-force-gold").addEventListener("click", () => {
  state.adminNextOutcome = "gold"; saveState(); setAdminStatus("Next sealed case will trigger its Gold Coin or case-inside-a-case bonus path.");
});
$("#admin-force-mythic").addEventListener("click", () => {
  state.adminNextOutcome = "mythic"; saveState(); setAdminStatus("Next sealed case will land its final Mythic golden-tier item.");
});
$("#admin-reset-daily").addEventListener("click", () => {
  state.dailyDate = ""; saveState(); renderStats(); setAdminStatus("Daily Signal is available again.");
});
$("#admin-clear-inventory").addEventListener("click", () => {
  if (!confirm("Clear every case and capsule from this local inventory?")) return;
  state.inventory = []; saveState(); renderStats(); setAdminStatus("Local inventory cleared.");
});
$("#admin-reset-profile").addEventListener("click", () => {
  if (!confirm("Reset all local NUMBER//ZERO progress and credits?")) return;
  localStorage.removeItem("number-zero-state"); location.reload();
});

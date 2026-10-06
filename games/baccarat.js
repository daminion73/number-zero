// Baccarat (Punto Banco): server-authoritative rounds (casino-core.js baccaratPlay) rendered with
// shared spring-dealt cards, an optional squeeze peel, chip stacks and Bead Plate / Big Road roads.
import { baccaratPoints } from "../casino-core.js";
import { cardFaceMarkup, centerOf, createCard, dealCard, flipCard, wait } from "./cards.js";

const CHIPS = [1, 5, 25, 100, 500, 2_500, 10_000, 100_000];
const CHIP_COLORS = { 1: "#9aa3b8", 5: "#53e7ff", 25: "#2ee59d", 100: "#c7ff36", 500: "#ae70ff", 2500: "#ff4fd8", 10000: "#ffd43b", 100000: "#ff7a2f" };
const MAX_FIELD = 10_000_000;
const FIELDS = [
  { id: "player", label: "PLAYER", odds: "PAYS 1:1" },
  { id: "tie", label: "TIE", odds: "PAYS 8:1" },
  { id: "banker", label: "BANKER", odds: "PAYS 0.95:1" },
];
const HISTORY_LIMIT = 72;
const ROAD_ROWS = 6;
const BEAD_COLUMNS = 12;
const BIG_ROAD_COLUMNS = 16;
const SQUEEZE_THRESHOLD = 25_000;

const chipLabel = (value) => (value >= 1_000 ? `${value / 1_000}K` : String(value));
const handTotal = (cards) => cards.reduce((sum, card) => sum + baccaratPoints(card), 0) % 10;
const emptyBets = () => ({ player: 0, tie: 0, banker: 0 });
const betTotal = (record) => record.player + record.tie + record.banker;

/** Older history entries were bare winner strings. */
const normalize = (entry) => (typeof entry === "string" ? { w: entry } : entry);

/** Splits an amount into at most `limit` chips, largest first, for the stack graphic. */
function chipStack(amount, limit = 6) {
  const stack = [];
  let rest = amount;
  for (const chip of [...CHIPS].reverse()) {
    while (rest >= chip && stack.length < limit) {
      stack.push(chip);
      rest -= chip;
    }
  }
  return stack.reverse();
}

/** Big Road placement with dragon tails: a streak that hits the bottom (or an occupied cell) turns right. */
export function bigRoad(history) {
  const occupied = new Set();
  const cells = [];
  let leadingTies = 0;
  let previous = null;
  let streakColumn = -1;
  for (const entry of history) {
    if (entry.w === "tie") {
      if (cells.length) cells[cells.length - 1].ties++;
      else leadingTies++;
      continue;
    }
    let col, row;
    if (entry.w !== previous?.w) {
      streakColumn++;
      while (occupied.has(`${streakColumn}:0`)) streakColumn++;
      col = streakColumn;
      row = 0;
    } else if (previous.row < ROAD_ROWS - 1 && !occupied.has(`${previous.col}:${previous.row + 1}`)) {
      col = previous.col;
      row = previous.row + 1;
    } else {
      col = previous.col + 1;
      row = previous.row;
    }
    occupied.add(`${col}:${row}`);
    previous = { w: entry.w, col, row, ties: cells.length ? 0 : leadingTies, natural: Boolean(entry.n) };
    cells.push(previous);
  }
  return cells;
}

export function mount(container, ctx) {
  let bets = emptyBets();
  let lastBets = null;
  let undoStack = [];
  let chip = 100;
  let busy = false;
  let visible = false;
  let token = 0;
  let squeeze = localStorage.getItem("nz-squeeze") || "auto";
  let history = load();

  container.innerHTML = `
    <section class="bac" aria-label="Baccarat">
      <div class="bac-table">
        <div class="bac-top">
          <span>PUNTO BANCO · 8 DECK · BANKER 5% COMMISSION</span>
          <label>SQUEEZE
            <select class="bac-squeeze">
              <option value="auto">AUTO ≥ ${chipLabel(SQUEEZE_THRESHOLD)}</option>
              <option value="on">ALWAYS</option>
              <option value="off">OFF</option>
            </select>
          </label>
        </div>
        <div class="bac-shoe" aria-hidden="true"><div class="bac-shoe-cards"><i></i><i></i><i></i></div><span>SHOE</span></div>
        <div class="bac-status" role="status" aria-live="polite" data-tone="idle"><span>PLACE YOUR BETS</span></div>
        <div class="bac-hands">
          ${["player", "banker"]
            .map(
              (side) => `
            <div class="bac-hand" data-side="${side}">
              <div class="bac-hand-head"><span>${side.toUpperCase()}</span><b class="bac-score" hidden>0</b></div>
              <div class="bac-cards"></div>
              <div class="bac-hand-tag"></div>
            </div>`,
            )
            .join("")}
        </div>
        <div class="bac-fields">
          ${FIELDS.map(
            (field) => `
            <button type="button" class="bac-field" data-field="${field.id}">
              <small>${field.odds}</small>
              <b>${field.label}</b>
              <span class="bac-stack" data-stack="${field.id}"></span>
              <em class="bac-field-payout" data-payout="${field.id}"></em>
            </button>`,
          ).join("")}
        </div>
        <div class="bac-summary" hidden></div>
      </div>
      <aside class="bac-side">
        <div class="bac-controls">
          <div class="bac-panel-title"><span>CHIP VALUE</span><small>Click a betting area to place it</small></div>
          <div class="bac-chips">
            ${CHIPS.map((value) => `<button type="button" class="bac-chip" data-chip="${value}" style="--chip:${CHIP_COLORS[value]}">${chipLabel(value)}</button>`).join("")}
          </div>
          <div class="bac-tools">
            <button type="button" data-tool="undo">UNDO</button>
            <button type="button" data-tool="clear">CLEAR</button>
            <button type="button" data-tool="rebet">REBET</button>
            <button type="button" data-tool="double">2×</button>
          </div>
          <div class="bac-total"><span>TOTAL BET</span><strong>0.00 CR</strong></div>
          <button type="button" class="bac-deal">DEAL <span>⏎</span></button>
        </div>
        <div class="bac-road">
          <div class="bac-counts"></div>
          <h3>BEAD PLATE <small>Last ${HISTORY_LIMIT}</small></h3>
          <div class="bac-beads"></div>
          <h3>BIG ROAD</h3>
          <div class="bac-bigroad"></div>
          <button type="button" class="bac-reset-roads" data-tool="reset-roads">RESET ROADS</button>
        </div>
      </aside>
    </section>`;

  const $ = (selector) => container.querySelector(selector);
  $(".bac-squeeze").value = squeeze;

  // ── History ─────────────────────────────────────────────────────────────────
  function storageKey() {
    return `number-zero-baccarat:${ctx.mode()}`;
  }
  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey()));
      return Array.isArray(parsed) ? parsed.map(normalize).filter((entry) => ["player", "banker", "tie"].includes(entry?.w)) : [];
    } catch {
      return [];
    }
  }
  function save() {
    history = history.slice(-HISTORY_LIMIT);
    localStorage.setItem(storageKey(), JSON.stringify(history));
  }

  function renderRoads() {
    const count = (winner) => history.filter((entry) => entry.w === winner).length;
    const percent = (winner) => (history.length ? Math.round((count(winner) / history.length) * 100) : 0);
    $(".bac-counts").innerHTML = ["player", "banker", "tie"]
      .map((winner) => `<span class="${winner}"><i></i>${winner[0].toUpperCase()} ${count(winner)} <small>${percent(winner)}%</small></span>`)
      .join("");

    const beads = history.slice(-ROAD_ROWS * BEAD_COLUMNS);
    $(".bac-beads").innerHTML = beads
      .map(
        (entry, index) =>
          `<i class="${entry.w}${entry.n ? " natural" : ""}${index === beads.length - 1 ? " latest" : ""}" style="grid-column:${Math.floor(index / ROAD_ROWS) + 1};grid-row:${(index % ROAD_ROWS) + 1}" title="${entry.w}${entry.p !== undefined ? ` ${entry.p}–${entry.b}` : ""}">${entry.w[0].toUpperCase()}</i>`,
      )
      .join("");

    const cells = bigRoad(history);
    const lastColumn = cells.reduce((max, cell) => Math.max(max, cell.col), 0);
    const offset = Math.max(0, lastColumn - BIG_ROAD_COLUMNS + 1);
    $(".bac-bigroad").innerHTML = cells
      .filter((cell) => cell.col >= offset)
      .map(
        (cell, index, visibleCells) =>
          `<i class="${cell.w}${cell.natural ? " natural" : ""}${index === visibleCells.length - 1 ? " latest" : ""}" style="grid-column:${cell.col - offset + 1};grid-row:${cell.row + 1}">${cell.ties ? `<b>${cell.ties > 1 ? cell.ties : ""}</b>` : ""}</i>`,
      )
      .join("");
  }

  // ── Betting ─────────────────────────────────────────────────────────────────
  function renderBets() {
    for (const field of FIELDS) {
      const amount = bets[field.id];
      $(`[data-stack="${field.id}"]`).innerHTML = amount
        ? `<span class="bac-chip-stack">${chipStack(amount)
            .map((value, index) => `<i style="--chip:${CHIP_COLORS[value]};--n:${index}"></i>`)
            .join("")}</span><b>${ctx.money(amount)}</b>`
        : "";
    }
    container.querySelectorAll("[data-chip]").forEach((button) => button.classList.toggle("active", Number(button.dataset.chip) === chip));
    const total = betTotal(bets);
    const affordable = total <= ctx.balance();
    $(".bac-total strong").textContent = `${ctx.money(total)} CR`;
    $(".bac-total").classList.toggle("bac-over", !affordable);
    $(".bac-deal").disabled = busy || !total || !affordable;
    container.querySelectorAll(".bac-field, [data-tool], [data-chip]").forEach((button) => (button.disabled = busy));
    $('[data-tool="undo"]').disabled ||= !undoStack.length;
    $('[data-tool="rebet"]').disabled ||= !lastBets;
    $('[data-tool="double"]').disabled ||= !total;
    $('[data-tool="clear"]').disabled ||= !total;
  }

  function changeBets(next) {
    undoStack.push({ ...bets });
    if (undoStack.length > 50) undoStack.shift();
    bets = next;
    renderBets();
  }

  function setStatus(text, tone = "idle") {
    $(".bac-status span").textContent = text;
    $(".bac-status").dataset.tone = tone;
  }

  function resetTable() {
    for (const side of ["player", "banker"]) {
      const hand = $(`.bac-hand[data-side="${side}"]`);
      hand.querySelector(".bac-cards").replaceChildren();
      hand.querySelector(".bac-score").hidden = true;
      hand.querySelector(".bac-hand-tag").textContent = "";
      hand.classList.remove("bac-winner", "bac-loser");
    }
    container.querySelectorAll(".bac-field").forEach((field) => field.classList.remove("bac-won", "bac-lost", "bac-push"));
    container.querySelectorAll("[data-payout]").forEach((label) => (label.textContent = ""));
    $(".bac-summary").hidden = true;
    $(".bac-table").classList.remove("bac-celebrate");
  }

  // ── Dealing ─────────────────────────────────────────────────────────────────
  /** Slow, tension-building corner peel that stops twice before the full turn. */
  async function squeezeCard(card, index, reduced) {
    if (reduced) return flipCard(card, index, { reduced });
    const inner = card.querySelector(".pc-inner");
    card.classList.add("bac-squeezing");
    inner.insertAdjacentHTML("afterbegin", cardFaceMarkup(index));
    card.dataset.card = String(index);
    inner.classList.remove("pc-down");
    ctx.sound(140, 0.5, "sine", 0.025);
    await inner.animate(
      [
        { transform: "rotateY(180deg) rotateZ(0deg)", offset: 0 },
        { transform: "rotateY(156deg) rotateZ(-4deg)", offset: 0.25 },
        { transform: "rotateY(150deg) rotateZ(-5deg)", offset: 0.45 },
        { transform: "rotateY(118deg) rotateZ(-3deg)", offset: 0.68 },
        { transform: "rotateY(112deg) rotateZ(-3deg)", offset: 0.8 },
        { transform: "rotateY(0deg) rotateZ(0deg)", offset: 1 },
      ],
      { duration: 1650, easing: "cubic-bezier(0.45, 0, 0.3, 1)" },
    ).finished;
    card.classList.remove("bac-squeezing");
  }

  function placeCard(side, third) {
    const card = createCard(null);
    if (third) card.classList.add("bac-third");
    $(`.bac-hand[data-side="${side}"] .bac-cards`).append(card);
    return card;
  }

  function updateScore(side, cards) {
    const score = $(`.bac-hand[data-side="${side}"] .bac-score`);
    score.hidden = false;
    score.textContent = String(handTotal(cards));
    score.animate([{ transform: "scale(1.35)" }, { transform: "scale(1)" }], { duration: 260, easing: "ease-out" });
  }

  async function play(round, wantSqueeze) {
    const mine = ++token;
    const reduced = ctx.reducedMotion();
    const gap = reduced ? 60 : 210;
    const shoe = centerOf($(".bac-shoe-cards"));
    const alive = () => mine === token;

    // Deal P, B, P, B face down.
    const order = [["player", 0], ["banker", 0], ["player", 1], ["banker", 1]];
    const elements = order.map(([side]) => placeCard(side, false));
    elements.forEach((card, index) => {
      dealCard(card, shoe, { delay: index * gap, reduced });
      window.setTimeout(() => alive() && ctx.sound(300 + Math.random() * 60, 0.05, "triangle", 0.035), index * gap);
    });
    await wait(order.length * gap + (reduced ? 60 : 420));
    if (!alive()) return false;

    const reveal = async (side, cardIndex, card) => {
      setStatus(`${side.toUpperCase()} ${wantSqueeze ? "SQUEEZES" : "REVEALS"}…`, "turn");
      if (wantSqueeze) await squeezeCard(card, round[side][cardIndex], reduced);
      else {
        ctx.sound(520, 0.06, "sine", 0.035);
        await flipCard(card, round[side][cardIndex], { reduced });
      }
      updateScore(side, round[side].slice(0, cardIndex + 1));
    };

    for (const side of ["player", "banker"]) {
      await reveal(side, 0, elements[side === "player" ? 0 : 1]);
      if (!alive()) return false;
      await reveal(side, 1, elements[side === "player" ? 2 : 3]);
      if (!alive()) return false;
      await wait(reduced ? 40 : 220);
    }

    const twoCard = { player: handTotal(round.player.slice(0, 2)), banker: handTotal(round.banker.slice(0, 2)) };
    if (round.natural) {
      const side = twoCard.player >= twoCard.banker ? "player" : "banker";
      setStatus(`NATURAL ${Math.max(twoCard.player, twoCard.banker)}!`, "win");
      $(`.bac-hand[data-side="${side}"] .bac-hand-tag`).textContent = "NATURAL";
      await wait(reduced ? 60 : 500);
    }

    for (const side of ["player", "banker"]) {
      if (round[side].length < 3) {
        if (!round.natural && side === "player") $(`.bac-hand[data-side="player"] .bac-hand-tag`).textContent = "STANDS";
        continue;
      }
      setStatus(`${side.toUpperCase()} DRAWS A THIRD CARD`, "turn");
      $(`.bac-hand[data-side="${side}"] .bac-hand-tag`).textContent = "THIRD CARD";
      const card = placeCard(side, true);
      ctx.sound(320, 0.05, "triangle", 0.035);
      await dealCard(card, shoe, { reduced });
      if (!alive()) return false;
      await reveal(side, 2, card);
      if (!alive()) return false;
      await wait(reduced ? 40 : 240);
    }
    return true;
  }

  function settle(round) {
    const winner = round.winner;
    for (const side of ["player", "banker"]) {
      const hand = $(`.bac-hand[data-side="${side}"]`);
      hand.classList.toggle("bac-winner", winner === side);
      hand.classList.toggle("bac-loser", winner !== side && winner !== "tie");
    }
    for (const field of FIELDS) {
      const stake = round.bets[field.id];
      if (!stake) continue;
      const paid = round.payouts[field.id];
      const element = $(`.bac-field[data-field="${field.id}"]`);
      const tone = paid > stake ? "won" : paid === stake ? "push" : "lost";
      element.classList.add(`bac-${tone}`);
      $(`[data-payout="${field.id}"]`).textContent = tone === "won" ? `+${ctx.money(paid - stake)}` : tone === "push" ? "PUSH" : `−${ctx.money(stake)}`;
    }
    const net = round.payout - round.wager;
    const label = winner === "tie" ? `TIE · ${round.playerTotal} – ${round.bankerTotal}` : `${winner.toUpperCase()} WINS ${Math.max(round.playerTotal, round.bankerTotal)} – ${Math.min(round.playerTotal, round.bankerTotal)}`;
    setStatus(label, winner);
    const summary = $(".bac-summary");
    summary.hidden = false;
    summary.dataset.tone = net > 0 ? "win" : net === 0 ? "push" : "loss";
    summary.innerHTML = `<span>WAGERED <b>${ctx.money(round.wager)}</b></span><span>RETURNED <b>${ctx.money(round.payout)}</b></span><span>NET <b>${net >= 0 ? "+" : "−"}${ctx.money(Math.abs(net))} CR</b></span>`;
    if (net > 0) {
      ctx.toast(winner === "tie" ? "Tie pays 8 to 1!" : `${winner === "player" ? "Player" : "Banker"} wins`, "win", `+${ctx.money(net)} CR net`);
      [660, 880, 1100].forEach((frequency, index) => window.setTimeout(() => ctx.sound(frequency, 0.16, "triangle", 0.06), index * 110));
      if (winner === "tie" && !ctx.reducedMotion()) {
        void $(".bac-table").offsetWidth;
        $(".bac-table").classList.add("bac-celebrate");
      }
    } else if (net < 0) ctx.sound(170, 0.3, "sawtooth", 0.04);
    else ctx.sound(440, 0.15, "sine", 0.04);
  }

  async function deal() {
    const total = betTotal(bets);
    if (busy || !total) return;
    if (total > ctx.balance()) {
      ctx.toast("Not enough credits for that bet", "loss");
      return;
    }
    busy = true;
    resetTable();
    renderBets();
    setStatus("NO MORE BETS", "turn");
    // On stacked (mobile) layouts the deal button sits below the table; bring the cards into view.
    const hands = $(".bac-hands").getBoundingClientRect();
    if (hands.top < 60 || hands.bottom > innerHeight)
      $(".bac-hands").scrollIntoView({ block: "center", behavior: ctx.reducedMotion() ? "auto" : "smooth" });
    ctx.sound(240, 0.06, "square", 0.025);
    const stake = { ...bets };
    const mode = ctx.mode();
    let round, response;
    try {
      response = await ctx.request("/casino/baccarat", { bets: stake }, { reveal: true });
      round = response.round;
    } catch (error) {
      busy = false;
      setStatus("PLACE YOUR BETS");
      renderBets();
      ctx.toast(error.message, "loss");
      return;
    }
    lastBets = stake;
    const wantSqueeze = squeeze === "on" || (squeeze === "auto" && round.wager >= SQUEEZE_THRESHOLD);
    const finished = await play(round, wantSqueeze);
    response.reveal(); // the wallet only shows the payout once every card is face up
    if (ctx.mode() !== mode) return; // the mode switch already reset the table and roads
    history.push({ w: round.winner, n: round.natural ? 1 : 0, p: round.playerTotal, b: round.bankerTotal });
    save();
    busy = false;
    if (finished) settle(round);
    renderRoads();
    renderBets();
  }

  // ── Events ──────────────────────────────────────────────────────────────────
  container.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.field) {
      const field = button.dataset.field;
      if (bets[field] + chip > MAX_FIELD) {
        ctx.toast(`Maximum ${ctx.money(MAX_FIELD)} CR per betting area`, "info");
        return;
      }
      changeBets({ ...bets, [field]: bets[field] + chip });
      ctx.sound(880, 0.04, "square", 0.02);
      return;
    }
    if (button.dataset.chip) {
      chip = Number(button.dataset.chip);
      renderBets();
      return;
    }
    const tool = button.dataset.tool;
    if (tool === "undo" && undoStack.length) {
      bets = undoStack.pop();
      renderBets();
    } else if (tool === "clear") changeBets(emptyBets());
    else if (tool === "rebet" && lastBets) changeBets({ ...lastBets });
    else if (tool === "double") {
      const doubled = Object.fromEntries(Object.entries(bets).map(([key, value]) => [key, Math.min(MAX_FIELD, value * 2)]));
      changeBets(doubled);
    } else if (tool === "reset-roads") {
      history = [];
      save();
      renderRoads();
    }
    if (button.classList.contains("bac-deal")) deal();
  });

  $(".bac-squeeze").addEventListener("change", (event) => {
    squeeze = event.target.value;
    localStorage.setItem("nz-squeeze", squeeze);
  });

  document.addEventListener("keydown", (event) => {
    if (!visible || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.("input, select, textarea, dialog")) return;
    if (event.key === "Enter") {
      event.preventDefault();
      deal();
    }
  });

  ctx.onModeChange(() => {
    token++;
    busy = false;
    bets = emptyBets();
    lastBets = null;
    undoStack = [];
    history = load();
    resetTable();
    setStatus("PLACE YOUR BETS");
    renderBets();
    renderRoads();
  });

  renderBets();
  renderRoads();

  return {
    show() {
      visible = true;
      renderBets();
    },
    hide() {
      visible = false;
    },
  };
}

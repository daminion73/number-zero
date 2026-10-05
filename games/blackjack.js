// Blackjack: multi-hand table with insurance, double and split. Rules are server-authoritative
// (casino-core.js); this module renders rounds and animates newly dealt cards.
import { centerOf, createCard, dealCard, flipCard, wait } from "./cards.js";

const CHIPS = [1, 5, 25, 100, 500, 2_500, 10_000, 100_000];
const MAX_BET = 10_000_000;
const SEAT_COLORS = ["#c7ff36", "#53e7ff", "#ff4fd8"];
const RESULT_COPY = { blackjack: "BLACKJACK", win: "WIN", push: "PUSH", lose: "LOSE", bust: "BUST" };
const ACTIONS = [
  { id: "hit", label: "HIT", key: "H" },
  { id: "stand", label: "STAND", key: "S" },
  { id: "double", label: "DOUBLE", key: "D" },
  { id: "split", label: "SPLIT", key: "P" },
];

const chipLabel = (value) => (value >= 1_000 ? `${value / 1_000}K` : String(value));

function clampBet(value) {
  const amount = Math.round(Number(value) * 100) / 100;
  if (!Number.isFinite(amount)) return 1;
  return Math.min(MAX_BET, Math.max(1, amount));
}

function totalLabel(hand) {
  if (!hand.cards.length) return "";
  if (hand.soft && hand.total < 21) return `${hand.total - 10} / ${hand.total}`;
  return String(hand.total);
}

/** Keys hands by seat + split order so DOM zones survive re-renders. */
function handKeys(hands) {
  const perSeat = new Map();
  return hands.map((hand) => {
    const ordinal = perSeat.get(hand.seat) || 0;
    perSeat.set(hand.seat, ordinal + 1);
    return `${hand.seat}-${ordinal}`;
  });
}

export function mount(container, ctx) {
  let round = null;
  let bets = [100];
  let selectedSeat = 0;
  let previousBets = null;
  let busy = false;
  let visible = false;
  let renderToken = 0;

  container.innerHTML = `
    <section class="bj" aria-label="Blackjack">
      <div class="bj-table">
        <div class="bj-felt-rim"></div>
        <div class="bj-shoe" aria-hidden="true">
          <div class="bj-shoe-cards"><i></i><i></i><i></i><i></i></div>
          <span>SHOE</span>
        </div>
        <div class="bj-dealer">
          <div class="bj-zone-label"><span>DEALER</span><b class="bj-dealer-total" hidden></b></div>
          <div class="bj-cards bj-dealer-cards" data-zone="dealer"></div>
        </div>
        <div class="bj-alert" role="status" aria-live="polite"><span>PLACE YOUR BETS</span></div>
        <svg class="bj-arc" viewBox="0 0 800 120" aria-hidden="true">
          <defs><path id="bj-arc-path" d="M60 20 Q400 140 740 20" /></defs>
          <text><textPath href="#bj-arc-path" startOffset="50%" text-anchor="middle">BLACKJACK PAYS 3:2 · DEALER STANDS ON 17 · INSURANCE PAYS 2:1</textPath></text>
        </svg>
        <div class="bj-hands"></div>
        <div class="bj-summary" hidden></div>
      </div>
      <aside class="bj-panel">
        <div class="bj-panel-block bj-setup">
          <div class="bj-panel-title"><span>HANDS</span><small>Play up to three seats</small></div>
          <div class="bj-seat-count" role="group" aria-label="Number of hands">
            <button type="button" data-seats="1">1 HAND</button>
            <button type="button" data-seats="2">2 HANDS</button>
            <button type="button" data-seats="3">3 HANDS</button>
          </div>
          <div class="bj-bets"></div>
          <div class="bj-chips" aria-label="Add chips to the selected seat">
            ${CHIPS.map((chip) => `<button type="button" class="bj-chip" data-chip="${chip}" style="--chip:${chipColor(chip)}">${chipLabel(chip)}</button>`).join("")}
          </div>
          <div class="bj-total-bet"><span>TOTAL BET</span><strong>0.00 CR</strong></div>
          <button type="button" class="bj-deal">DEAL <span>⏎</span></button>
          <div class="bj-rebet-row">
            <button type="button" class="bj-rebet" disabled>REBET</button>
            <button type="button" class="bj-rebet-double" disabled>2× REBET</button>
          </div>
        </div>
        <div class="bj-panel-block bj-play" hidden>
          <div class="bj-panel-title"><span>YOUR MOVE</span><small class="bj-turn"></small></div>
          <div class="bj-insurance" hidden>
            <p>Dealer shows an Ace. Insure every hand for half its bet? Insurance pays 2 to 1.</p>
            <button type="button" data-action="insurance">INSURE <b class="bj-insurance-cost"></b></button>
            <button type="button" data-action="no-insurance">NO INSURANCE</button>
          </div>
          <div class="bj-actions">
            ${ACTIONS.map((action) => `<button type="button" data-action="${action.id}"><strong>${action.label}</strong><kbd>${action.key}</kbd></button>`).join("")}
          </div>
          <p class="bj-wager-line"></p>
        </div>
      </aside>
    </section>`;

  const $ = (selector) => container.querySelector(selector);
  const table = $(".bj-table");
  const handsRoot = $(".bj-hands");
  const dealerCards = $(".bj-dealer-cards");

  function chipColor(value) {
    return { 1: "#9aa3b8", 5: "#53e7ff", 25: "#2ee59d", 100: "#c7ff36", 500: "#ae70ff", 2500: "#ff4fd8", 10000: "#ffd43b", 100000: "#ff7a2f" }[value];
  }

  // ── Bet setup ───────────────────────────────────────────────────────────────
  function renderBets() {
    container.querySelectorAll("[data-seats]").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.seats) === bets.length);
    });
    $(".bj-bets").innerHTML = bets
      .map(
        (bet, seat) => `
        <div class="bj-bet${seat === selectedSeat ? " selected" : ""}" data-seat="${seat}" style="--seat:${SEAT_COLORS[seat]}">
          <button type="button" class="bj-bet-label" data-select-seat="${seat}">SEAT ${seat + 1}</button>
          <input type="number" min="1" max="${MAX_BET}" step="1" value="${bet}" data-bet-input="${seat}" aria-label="Seat ${seat + 1} bet">
          <button type="button" data-bet-scale="${seat}:0.5">½</button>
          <button type="button" data-bet-scale="${seat}:2">2×</button>
        </div>`,
      )
      .join("");
    renderTotal();
  }

  function renderTotal() {
    const total = bets.reduce((sum, bet) => sum + bet, 0);
    $(".bj-total-bet strong").textContent = `${ctx.money(total)} CR`;
    const affordable = total <= ctx.balance();
    $(".bj-deal").disabled = busy || !affordable;
    $(".bj-total-bet").classList.toggle("bj-over", !affordable);
  }

  // ── Table rendering ─────────────────────────────────────────────────────────
  function ensureHandZones(keys) {
    const existing = new Map([...handsRoot.children].map((element) => [element.dataset.key, element]));
    keys.forEach((key, index) => {
      let zone = existing.get(key);
      if (!zone) {
        zone = document.createElement("div");
        zone.className = "bj-hand";
        zone.dataset.key = key;
        zone.style.setProperty("--seat", SEAT_COLORS[Number(key.split("-")[0])]);
        zone.innerHTML = `<div class="bj-hand-result"></div><div class="bj-cards" data-zone="${key}"></div><div class="bj-hand-meta"><span class="bj-hand-name"></span><b class="bj-hand-total"></b><span class="bj-hand-bet"></span></div>`;
      }
      if (handsRoot.children[index] !== zone) handsRoot.insertBefore(zone, handsRoot.children[index] || null);
      existing.delete(key);
    });
    existing.forEach((zone) => zone.remove());
  }

  /** Reconciles a card zone. Returns { added: [...elements], flips: [{card, index}] }. */
  function reconcile(zone, codes) {
    const current = [...zone.children];
    const added = [];
    const flips = [];
    let keep = 0;
    while (keep < current.length && keep < codes.length) {
      const shown = current[keep].dataset.card;
      const wanted = codes[keep] === null ? "back" : String(codes[keep]);
      if (shown === wanted) keep++;
      else if (shown === "back" && wanted !== "back") {
        flips.push({ card: current[keep], index: codes[keep] });
        keep++;
      } else break;
    }
    current.slice(keep).forEach((card) => card.remove());
    codes.slice(keep).forEach((code) => {
      const card = createCard(code);
      card.style.setProperty("--fan", String(zone.children.length));
      zone.append(card);
      added.push(card);
    });
    return { added, flips };
  }

  function dealOrder(changes, initial) {
    const dealer = changes.find((change) => change.dealer);
    const players = changes.filter((change) => !change.dealer);
    if (!initial) return [...players.flatMap((change) => change.added), ...(dealer?.added || [])];
    const order = [];
    for (let pass = 0; pass < 2; pass++) {
      players.forEach((change) => change.added[pass] && order.push(change.added[pass]));
      if (dealer?.added[pass]) order.push(dealer.added[pass]);
    }
    return order;
  }

  async function renderRound(next, { animate = true } = {}) {
    const token = ++renderToken;
    const initial = !round || round.id !== next.id;
    if (initial) {
      dealerCards.replaceChildren();
      handsRoot.replaceChildren();
    }
    round = next;
    const keys = handKeys(next.hands);
    ensureHandZones(keys);
    const changes = [{ dealer: true, ...reconcile(dealerCards, next.dealer) }];
    next.hands.forEach((hand, index) => {
      const zone = handsRoot.querySelector(`[data-key="${keys[index]}"] .bj-cards`);
      changes.push({ dealer: false, ...reconcile(zone, hand.cards) });
    });
    renderMeta(keys, { revealResults: !animate });
    renderControls();
    if (!animate) return;

    const reduced = ctx.reducedMotion();
    const gap = reduced ? 70 : 230;
    const shoe = centerOf($(".bj-shoe-cards"));
    const order = dealOrder(changes, initial);
    order.forEach((card, index) => {
      dealCard(card, shoe, { delay: index * gap, reduced });
      window.setTimeout(() => ctx.sound(300 + Math.random() * 60, 0.05, "triangle", 0.035), index * gap);
    });
    let elapsed = order.length * gap;
    for (const flip of changes.flatMap((change) => change.flips)) {
      await wait(Math.max(0, elapsed - (reduced ? 0 : 120)));
      elapsed = 0;
      ctx.sound(520, 0.07, "sine", 0.04);
      await flipCard(flip.card, flip.index, { reduced });
    }
    await wait(elapsed + (reduced ? 40 : 260));
    if (token !== renderToken) return;
    renderMeta(keys, { revealResults: true });
    if (next.phase === "settled") announceSettlement(next);
  }

  function renderMeta(keys, { revealResults }) {
    const settled = round.phase === "settled";
    const dealerTotal = $(".bj-dealer-total");
    dealerTotal.hidden = !round.dealer.length;
    dealerTotal.textContent = settled && !revealResults ? "?" : String(round.dealerTotal);
    dealerTotal.classList.toggle("bj-bust", settled && revealResults && round.dealerTotal > 21);
    const seatHandCounts = round.hands.reduce((counts, hand) => counts.set(hand.seat, (counts.get(hand.seat) || 0) + 1), new Map());
    round.hands.forEach((hand, index) => {
      const zone = handsRoot.querySelector(`[data-key="${keys[index]}"]`);
      const ordinal = Number(keys[index].split("-")[1]);
      const split = seatHandCounts.get(hand.seat) > 1;
      zone.querySelector(".bj-hand-name").textContent = `SEAT ${hand.seat + 1}${split ? ` · HAND ${String.fromCharCode(65 + ordinal)}` : ""}`;
      const total = zone.querySelector(".bj-hand-total");
      total.textContent = totalLabel(hand);
      total.classList.toggle("bj-bust", hand.total > 21);
      total.classList.toggle("bj-twentyone", hand.total === 21);
      zone.querySelector(".bj-hand-bet").textContent = `${ctx.money(hand.bet)} CR${hand.doubled ? " · DOUBLED" : ""}`;
      zone.classList.toggle("bj-active", round.phase === "player" && round.active === index);
      const result = zone.querySelector(".bj-hand-result");
      const showResult = settled && revealResults && hand.result;
      result.className = `bj-hand-result${showResult ? ` bj-result-${hand.result}` : ""}`;
      result.textContent = showResult
        ? `${RESULT_COPY[hand.result]}${hand.payout > 0 ? ` · +${ctx.money(hand.payout)}` : ""}`
        : hand.total > 21
          ? "BUST"
          : "";
      if (!showResult && hand.total > 21) result.className = "bj-hand-result bj-result-bust";
    });
    renderAlert(revealResults);
  }

  function renderAlert(revealResults) {
    const alert = $(".bj-alert span");
    const element = $(".bj-alert");
    let text = "PLACE YOUR BETS";
    let tone = "idle";
    if (round?.phase === "insurance") {
      text = "DEALER SHOWS AN ACE — INSURANCE?";
      tone = "warn";
    } else if (round?.phase === "player") {
      const hand = round.hands[round.active];
      text = hand ? `SEAT ${hand.seat + 1} TO ACT · ${totalLabel(hand)} VS DEALER ${round.dealerTotal}` : "PLAYER TO ACT";
      tone = "turn";
    } else if (round?.phase === "settled") {
      const dealerNatural = round.dealer.length === 2 && round.dealerTotal === 21;
      const allBust = round.hands.every((hand) => hand.total > 21);
      if (!revealResults) text = "DEALER REVEALS…";
      else if (dealerNatural) text = "DEALER HAS BLACKJACK";
      else if (allBust) text = "ALL HANDS BUST";
      else if (round.dealerTotal > 21) text = `DEALER BUSTS WITH ${round.dealerTotal}!`;
      else text = `DEALER STANDS ON ${round.dealerTotal}`;
      tone = round.payout > round.wager ? "win" : round.payout === round.wager ? "push" : "loss";
      if (!revealResults) tone = "turn";
    }
    alert.textContent = text;
    element.dataset.tone = tone;
  }

  function renderControls() {
    const active = round && round.phase !== "settled";
    $(".bj-setup").hidden = Boolean(active);
    $(".bj-play").hidden = !active;
    $(".bj-rebet").disabled = busy || !previousBets;
    $(".bj-rebet-double").disabled = busy || !previousBets;
    renderTotal();
    if (!active) return;
    const insurance = round.phase === "insurance";
    $(".bj-insurance").hidden = !insurance;
    if (insurance) {
      const cost = round.hands.reduce((sum, hand) => sum + Math.floor(hand.bet * 50) / 100, 0);
      $(".bj-insurance-cost").textContent = `${ctx.money(cost)} CR`;
    }
    container.querySelectorAll(".bj-actions [data-action]").forEach((button) => {
      button.disabled = busy || insurance || !round.actions.includes(button.dataset.action);
    });
    container.querySelectorAll(".bj-insurance [data-action]").forEach((button) => {
      button.disabled = busy;
    });
    const hand = round.hands[round.active];
    $(".bj-turn").textContent = insurance ? "Insurance decision" : hand ? `Seat ${hand.seat + 1} · ${totalLabel(hand)}` : "";
    $(".bj-wager-line").textContent = `IN PLAY ${ctx.money(round.wager)} CR`;
  }

  function announceSettlement(settled) {
    const net = settled.payout - settled.wager;
    const summary = $(".bj-summary");
    summary.hidden = false;
    summary.dataset.tone = net > 0 ? "win" : net === 0 ? "push" : "loss";
    summary.innerHTML = `<span>WAGERED <b>${ctx.money(settled.wager)}</b></span><span>RETURNED <b>${ctx.money(settled.payout)}</b></span><span>NET <b>${net >= 0 ? "+" : "−"}${ctx.money(Math.abs(net))} CR</b></span>`;
    const blackjack = settled.hands.some((hand) => hand.result === "blackjack");
    if (net > 0) {
      ctx.toast(blackjack ? "Blackjack!" : "You win", "win", `+${ctx.money(net)} CR net`);
      [660, 880, 1100].forEach((frequency, index) => window.setTimeout(() => ctx.sound(frequency, 0.16, "triangle", 0.06), index * 110));
    } else if (net < 0) {
      ctx.sound(170, 0.32, "sawtooth", 0.04);
    } else ctx.sound(440, 0.15, "sine", 0.04);
    table.classList.remove("bj-celebrate");
    if (blackjack && !ctx.reducedMotion()) {
      void table.offsetWidth;
      table.classList.add("bj-celebrate");
    }
  }

  // ── Server actions ──────────────────────────────────────────────────────────
  async function run(path, body) {
    if (busy) return;
    busy = true;
    renderControls();
    try {
      const result = await ctx.request(path, body, { reveal: true });
      busy = false;
      try {
        await renderRound(result.round);
      } finally {
        result.reveal(); // payout reaches the wallet after the dealer's cards are revealed
      }
    } catch (error) {
      busy = false;
      ctx.toast(error.message, "loss");
      if (error.code === "round_active" || error.code === "no_round") await resume();
    } finally {
      busy = false;
      if (round) renderControls();
      else renderTotal();
    }
  }

  async function deal(stakes = bets) {
    const total = stakes.reduce((sum, bet) => sum + bet, 0);
    if (total > ctx.balance()) {
      ctx.toast("Not enough credits for that bet", "loss");
      return;
    }
    $(".bj-summary").hidden = true;
    previousBets = [...stakes];
    // On stacked (mobile) layouts the deal button sits below the table; bring the table into view.
    const rect = table.getBoundingClientRect();
    if (rect.top < 50 || rect.top > innerHeight * 0.6)
      table.scrollIntoView({ block: "start", behavior: ctx.reducedMotion() ? "auto" : "smooth" });
    ctx.sound(240, 0.06, "square", 0.025);
    await run("/casino/blackjack/start", { bets: stakes });
  }

  async function resume() {
    renderToken++;
    round = null;
    dealerCards.replaceChildren();
    handsRoot.replaceChildren();
    $(".bj-summary").hidden = true;
    try {
      const active = (await ctx.request("/casino/active")).blackjack;
      if (active) await renderRound(active, { animate: false });
    } catch (error) {
      if (error.code !== "unauthorized") ctx.toast(error.message, "loss");
    }
    renderControls();
    renderAlert(true);
  }

  // ── Events ──────────────────────────────────────────────────────────────────
  container.addEventListener("click", (event) => {
    const seats = event.target.closest("[data-seats]");
    if (seats) {
      const count = Number(seats.dataset.seats);
      bets = Array.from({ length: count }, (_, seat) => bets[seat] ?? bets[0]);
      selectedSeat = Math.min(selectedSeat, count - 1);
      renderBets();
    }
    const select = event.target.closest("[data-select-seat]");
    if (select) {
      selectedSeat = Number(select.dataset.selectSeat);
      renderBets();
    }
    const scale = event.target.closest("[data-bet-scale]");
    if (scale) {
      const [seat, factor] = scale.dataset.betScale.split(":").map(Number);
      bets[seat] = clampBet(bets[seat] * factor);
      selectedSeat = seat;
      renderBets();
    }
    const chip = event.target.closest("[data-chip]");
    if (chip) {
      bets[selectedSeat] = clampBet(bets[selectedSeat] + Number(chip.dataset.chip));
      ctx.sound(880, 0.04, "square", 0.02);
      renderBets();
    }
    if (event.target.closest(".bj-deal")) deal();
    if (event.target.closest(".bj-rebet") && previousBets) {
      bets = [...previousBets];
      renderBets();
      deal(bets);
    }
    if (event.target.closest(".bj-rebet-double") && previousBets) {
      bets = previousBets.map((bet) => clampBet(bet * 2));
      renderBets();
      deal(bets);
    }
    const action = event.target.closest("[data-action]");
    if (action && !action.disabled) {
      ctx.sound(action.dataset.action === "stand" ? 360 : 460, 0.05, "triangle", 0.03);
      run("/casino/blackjack/action", { action: action.dataset.action });
    }
  });

  container.addEventListener("change", (event) => {
    const input = event.target.closest("[data-bet-input]");
    if (!input) return;
    const seat = Number(input.dataset.betInput);
    bets[seat] = clampBet(input.value);
    selectedSeat = seat;
    renderBets();
  });

  container.addEventListener("focusin", (event) => {
    const input = event.target.closest("[data-bet-input]");
    if (!input || Number(input.dataset.betInput) === selectedSeat) return;
    selectedSeat = Number(input.dataset.betInput);
    container.querySelectorAll(".bj-bet").forEach((row) => row.classList.toggle("selected", Number(row.dataset.seat) === selectedSeat));
  });

  document.addEventListener("keydown", (event) => {
    if (!visible || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.("input, select, textarea, dialog")) return;
    const key = event.key.toUpperCase();
    if (key === "ENTER" && (!round || round.phase === "settled")) {
      event.preventDefault();
      deal();
      return;
    }
    const mapping = { H: "hit", S: "stand", D: "double", P: "split", I: "insurance", N: "no-insurance" };
    const button = mapping[key] && container.querySelector(`[data-action="${mapping[key]}"]:not([disabled])`);
    if (button && !button.closest("[hidden]")) {
      event.preventDefault();
      button.click();
    }
  });

  ctx.onModeChange(() => {
    previousBets = null;
    if (visible) resume();
  });

  renderBets();
  renderAlert(true);

  return {
    show() {
      visible = true;
      resume();
    },
    hide() {
      visible = false;
    },
  };
}

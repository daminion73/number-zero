import { VIDEO_POKER_PAYTABLE } from "../casino-core.js";
import { centerOf, createCard, dealCard, flipCard, wait } from "./cards.js";

const clamp = (n) => Math.max(1, Math.min(10_000_000, Math.round(Number(n) * 100) / 100 || 1));

export function mount(container, ctx) {
  let bet = 5, round = null, held = Array(5).fill(false), busy = false, visible = false, token = 0;
  container.innerHTML = `<section class="vp"><div class="vp-machine"><div class="vp-paytable">${VIDEO_POKER_PAYTABLE.map(p => `<div data-hand="${p.id}"><span>${p.name}</span><b>${p.returns}×</b><em></em></div>`).join("")}</div><div class="vp-title"><small>NUMBER//ZERO</small><strong>JACKS OR BETTER</strong><span>9 / 6 VIDEO POKER</span></div><div class="vp-cards" aria-label="Poker hand"></div><div class="vp-result" role="status">PRESS DEAL</div><div class="vp-shoe" aria-hidden="true"><i></i><span>DECK</span></div></div><aside class="vp-controls"><div><label>BET <input class="vp-bet" type="number" min="1" max="10000000" step="1" value="5"></label><button data-scale=".5">½</button><button data-scale="2">2×</button></div><p>WIN <strong class="vp-win">0.00 CR</strong></p><button class="vp-action">DEAL <kbd>SPACE</kbd></button><small>SELECT CARDS TO HOLD · KEYS 1–5</small></aside></section>`;
  const $ = s => container.querySelector(s), cards = $(".vp-cards");
  function status(text, hand = null) { $(".vp-result").textContent = text; container.querySelectorAll("[data-hand]").forEach(x => x.classList.toggle("active", x.dataset.hand === hand?.id)); }
  function controls() {
    const open = round?.phase === "deal";
    $(".vp-action").textContent = busy ? "PLEASE WAIT…" : open ? "DRAW" : "DEAL";
    $(".vp-action").disabled = busy || (!open && bet > ctx.balance());
    $(".vp-bet").disabled = open || busy;
    container.querySelectorAll("[data-scale]").forEach(x => x.disabled = open || busy);
  }
  function markHolds() { [...cards.children].forEach((card, i) => { card.classList.toggle("held", held[i]); let badge = card.querySelector(".vp-held"); if (!badge) { badge = document.createElement("b"); badge.className = "vp-held"; badge.textContent = "HELD"; card.append(badge); } badge.hidden = !held[i]; }); }
  async function showDeal(next, animate = true) {
    const mine = ++token; round = next; held = next.held || Array(5).fill(false); cards.replaceChildren();
    next.cards.forEach((code, i) => { const card = createCard(code); card.dataset.index = i; cards.append(card); if (animate) dealCard(card, centerOf($(".vp-shoe")), { delay: i * (ctx.reducedMotion() ? 45 : 130), reduced: ctx.reducedMotion() }); });
    markHolds(); status(next.hand?.name || "CHOOSE YOUR HOLDS", next.hand); controls();
    if (animate) await wait(ctx.reducedMotion() ? 280 : 900); return mine === token;
  }
  async function action() {
    if (busy) return; busy = true; controls();
    try {
      if (!round || round.phase === "settled") {
        const result = await ctx.request("/casino/video-poker/deal", { bet }, { reveal: true }); result.reveal();
        await showDeal(result.round); status(result.round.hand ? `${result.round.hand.name} · HOLD OR DRAW` : "CHOOSE YOUR HOLDS", result.round.hand);
      } else {
        const old = [...round.cards], result = await ctx.request("/casino/video-poker/draw", { held }, { reveal: true }); round = result.round;
        for (let i = 0; i < 5; i++) if (!held[i]) { const oldCard = cards.children[i]; await flipCard(oldCard, result.round.cards[i], { reduced: ctx.reducedMotion() }); oldCard.classList.remove("held"); }
        result.reveal(); $(".vp-win").textContent = `${ctx.money(round.payout)} CR`; status(round.hand ? `${round.hand.name} · ${ctx.money(round.payout)} CR` : "NO WIN", round.hand);
        if (round.payout) ctx.sound(880, .18, "triangle", .06);
      }
    } catch (e) { ctx.toast(e.message, "loss"); if (e.code === "round_active") await resume(); }
    finally { busy = false; controls(); }
  }
  async function resume() { const mine = ++token; round = null; cards.replaceChildren(); try { const active = (await ctx.request("/casino/active"))["video-poker"]; if (active && mine === token) await showDeal(active, false); else if (mine === token) { status("PRESS DEAL"); controls(); } } catch(e) { if (e.code !== "unauthorized") ctx.toast(e.message, "loss"); } }
  container.addEventListener("click", e => { const card = e.target.closest(".pc-card"); if (card && round?.phase === "deal" && !busy) { const i = Number(card.dataset.index); held[i] = !held[i]; markHolds(); } const scale = e.target.closest("[data-scale]"); if (scale && !scale.disabled) { bet = clamp(bet * Number(scale.dataset.scale)); $(".vp-bet").value = bet; controls(); } if (e.target.closest(".vp-action")) action(); });
  $(".vp-bet").addEventListener("change", e => { bet = clamp(e.target.value); e.target.value = bet; controls(); });
  document.addEventListener("keydown", e => { if (!visible || e.repeat || e.target.closest?.("input,select,textarea,dialog")) return; if (round?.phase === "deal" && /^[1-5]$/.test(e.key)) { held[Number(e.key)-1] = !held[Number(e.key)-1]; markHolds(); } else if (e.key === " " || e.key === "Enter") { e.preventDefault(); action(); } });
  ctx.onModeChange(() => visible && resume()); controls();
  return { show(){ visible = true; resume(); }, hide(){ visible = false; token++; } };
}

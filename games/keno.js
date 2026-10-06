import { KENO_NUMBERS, KENO_PAYTABLE } from "../casino-core.js";

const clampBet = (value) => Math.min(10_000_000, Math.max(1, Number(value) || 1));
const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function mount(container, ctx) {
  container.innerHTML = `<section class="keno-game">
    <main class="keno-stage">
      <header><div><small>NUMBER//ZERO</small><strong>KENO 40</strong></div><span class="keno-count">0 / 10 PICKED</span></header>
      <div class="keno-board">${Array.from({length:KENO_NUMBERS},(_,i)=>`<button data-number="${i+1}">${i+1}</button>`).join("")}</div>
      <div class="keno-summary"><strong>PICK YOUR NUMBERS</strong><span>Select between 1 and 10 numbers</span></div>
    </main>
    <aside class="keno-panel">
      <div class="keno-title"><strong>PLAY SLIP</strong><small>10 NUMBERS DRAWN · PROVABLY FAIR</small></div>
      <div class="keno-tools"><button class="keno-auto">AUTO PICK <b>5</b></button><button class="keno-clear">CLEAR</button></div>
      <label>BET AMOUNT<div class="keno-input"><input class="keno-bet" type="number" min="1" max="10000000" value="100"><b>CR</b></div></label>
      <div class="keno-mods"><button data-mod=".5">½</button><button data-mod="2">2×</button></div>
      <div class="keno-pay"><header><span>HITS</span><span>MULTIPLIER</span></header><div></div></div>
      <button class="keno-bet-button">SELECT NUMBERS <kbd>SPACE</kbd></button>
    </aside>
  </section>`;
  const $ = (s) => container.querySelector(s);
  const picks = new Set();
  let drawn = new Set();
  let revealed = new Set();
  let busy = false;
  let visible = false;
  let token = 0;
  let achieved = null;

  function render() {
    container.querySelectorAll("[data-number]").forEach((button) => {
      const n = Number(button.dataset.number);
      button.className = picks.has(n) ? "picked" : "";
      if (revealed.has(n)) button.classList.add(drawn.has(n) && picks.has(n) ? "hit" : "drawn");
      button.disabled = busy;
    });
    $(".keno-count").textContent = `${picks.size} / 10 PICKED`;
    $(".keno-bet-button").disabled = busy || !picks.size;
    $(".keno-bet-button").innerHTML = busy ? `DRAWING… <kbd>${revealed.size}/10</kbd>` : `${picks.size ? "BET" : "SELECT NUMBERS"} <kbd>SPACE</kbd>`;
    $(".keno-auto").disabled = busy; $(".keno-clear").disabled = busy || !picks.size;
    const table = KENO_PAYTABLE[picks.size];
    $(".keno-pay div").innerHTML = table ? table.map((multiplier, hits) => `<span class="${achieved === hits ? "achieved" : ""}"><b>${hits}</b><strong>${multiplier}×</strong></span>`).join("") : `<p>Pick numbers to view payouts</p>`;
  }

  function changePicks(next) {
    picks.clear(); next.forEach((n) => picks.add(n));
    drawn = new Set(); revealed = new Set(); achieved = null;
    $(".keno-summary strong").textContent = "PICK YOUR NUMBERS";
    $(".keno-summary span").textContent = "Selections persist after every draw";
    render();
  }

  async function play() {
    if (busy || !picks.size) return;
    const bet = clampBet($(".keno-bet").value);
    if (bet > ctx.balance()) return ctx.toast("Not enough credits for that bet", "loss");
    busy = true; drawn = new Set(); revealed = new Set(); achieved = null; render();
    const mine = ++token;
    let result;
    try { result = await ctx.request("/casino/keno", { bet, picks: [...picks] }, { reveal: true }); }
    catch (error) { busy = false; ctx.toast(error.message, "loss"); render(); return; }
    drawn = new Set(result.round.drawn);
    const delay = ctx.reducedMotion() ? 25 : 115;
    for (const number of result.round.drawn) {
      if (mine !== token) { result.reveal(); return; }
      revealed.add(number); render();
      ctx.sound(picks.has(number) ? 780 : 240, .055, "triangle", .035);
      await wait(delay);
    }
    result.reveal(); achieved = result.round.hits.length; busy = false;
    const hitCount = result.round.hits.length;
    $(".keno-summary strong").textContent = `${hitCount} HIT${hitCount === 1 ? "" : "S"} · ${result.round.multiplier}×`;
    $(".keno-summary span").textContent = `Payout ${ctx.money(result.round.payout)} CR`;
    $(".keno-summary").dataset.tone = result.round.payout >= bet ? "win" : "loss";
    if (result.round.payout > bet) ctx.sound(980,.2,"triangle",.08);
    render();
  }

  container.addEventListener("click", (event) => {
    const number = event.target.closest("[data-number]");
    if (number && !busy) { const n=Number(number.dataset.number); const next=new Set(picks); if(next.has(n))next.delete(n); else if(next.size<10)next.add(n); else return ctx.toast("Maximum 10 picks", "info"); changePicks(next); }
    if (event.target.closest(".keno-clear")) changePicks([]);
    if (event.target.closest(".keno-auto")) { const count=Math.max(1,picks.size||5); const pool=Array.from({length:40},(_,i)=>i+1); const next=[]; while(next.length<count) next.push(...pool.splice(Math.floor(Math.random()*pool.length),1)); changePicks(next); }
    const mod=event.target.closest("[data-mod]"); if(mod) $(".keno-bet").value=String(clampBet(clampBet($(".keno-bet").value)*Number(mod.dataset.mod)));
    if(event.target.closest(".keno-bet-button")) play();
  });
  window.addEventListener("keydown",(event)=>{if(visible&&event.code==="Space"&&!event.repeat&&!/INPUT|SELECT|TEXTAREA/.test(event.target.tagName)){event.preventDefault();play();}});
  ctx.onModeChange(()=>{token++;busy=false;drawn=new Set();revealed=new Set();achieved=null;render();});
  render();
  return {show(){visible=true;container.hidden=false;render();},hide(){visible=false;container.hidden=true;token++;busy=false;render();}};
}

// Coinflip room view: two players, one coin. Countdown → 3D toss synced to the server clock → winner.
import { coinflipResult, sha256Hex } from "../casino-core.js";

const face = (side) => `<i class="rcf-face ${side}"><b>${side === "heads" ? "H" : "T"}</b><small>${side.toUpperCase()}</small></i>`;

export function mountRoom(root, api) {
  root.innerHTML = `
    <div class="rcf">
      <div class="rcf-arena">
        <section class="rcf-side" data-seat="0"></section>
        <div class="rcf-centre">
          <div class="rcf-stage">
            <div class="rcf-glow"></div>
            <div class="rcf-shadow"></div>
            <div class="rcf-coin">${face("heads")}${face("tails")}<i class="rcf-edge"></i></div>
            <div class="rcf-count" hidden></div>
          </div>
          <p class="rcf-status">WAITING FOR AN OPPONENT</p>
          <p class="rcf-pot"></p>
        </div>
        <section class="rcf-side" data-seat="1"></section>
      </div>
      <footer class="rcf-foot"><div class="rcf-fair"></div><div class="rcf-actions"></div></footer>
      <div class="rcf-confetti" aria-hidden="true"></div>
    </div>`;

  const find = (selector) => root.querySelector(selector);
  const coin = find(".rcf-coin");
  let room = null;
  let animatedFlip = null;
  let animation = null;
  let shadowAnimation = null;
  let revealed = null;
  let countTimer = 0;
  let lastCount = null;
  let revealTimer = 0;

  const mySeat = () => room?.you ?? -1;

  function sideMarkup(seat) {
    const play = room.play;
    const side = play.sides[seat];
    const player = room.seats[seat];
    const done = revealed === room.id && play.phase === "flipped";
    const won = done && play.winnerSeat === seat;
    const lost = done && play.winnerSeat !== seat;
    const mine = seat === mySeat();
    if (!player) {
      const signedIn = Boolean(api.user());
      const isHost = signedIn && String(api.user().id) === room.hostId;
      const canJoin = room.state === "waiting" && mySeat() < 0;
      return `<div class="rcf-empty">
          <div class="rcf-empty-coin ${side}">${side === "heads" ? "H" : "T"}</div>
          <b>${side.toUpperCase()} IS OPEN</b>
          <span>Stake ${api.money(play.stake)} CR · winner takes ${api.money(play.stake * 2)} CR</span>
          ${canJoin ? `<button type="button" class="rcf-join" data-join="${seat}">TAKE ${side.toUpperCase()} · ${api.money(play.stake)} CR</button>` : ""}
          ${isHost && room.state === "waiting" ? `<button type="button" class="rcf-bot" data-bot="${seat}">CALL A HOUSE BOT</button><small>or share code <b>${room.code}</b></small>` : ""}
        </div>`;
    }
    return `<div class="rcf-player ${won ? "winner" : ""} ${lost ? "loser" : ""} ${mine ? "mine" : ""}">
        <div class="rcf-avatar">${api.avatar(player.look, player.name, 96)}<span class="rcf-badge ${side}">${side === "heads" ? "H" : "T"}</span></div>
        <b>${api.name(player.look, player.name)}${player.bot ? " <em>BOT</em>" : ""}${mine ? " <em class='you'>YOU</em>" : ""}</b>
        <span class="rcf-side-label">${side.toUpperCase()}</span>
        <strong class="rcf-amount">${won ? `+${api.money(play.stake * 2)} CR` : lost ? `−${api.money(play.stake)} CR` : `${api.money(play.stake)} CR`}</strong>
        ${room.state === "waiting" && api.user() && String(api.user().id) === room.hostId && player.bot ? `<button type="button" class="rcf-kick" data-kick="${seat}">REMOVE BOT</button>` : ""}
      </div>`;
  }

  function confetti() {
    if (api.reducedMotion()) return;
    const colours = ["#c7ff36", "#53e7ff", "#ffd43b", "#ff4fd8", "#ffffff"];
    find(".rcf-confetti").innerHTML = Array.from({ length: 60 }, (_, i) => `<i style="--x:${Math.random() * 100}%;--d:${(Math.random() * 0.8).toFixed(2)}s;--r:${Math.round(Math.random() * 720 - 360)}deg;--c:${colours[i % colours.length]};--s:${(0.6 + Math.random() * 0.8).toFixed(2)}"></i>`).join("");
    setTimeout(() => (find(".rcf-confetti").innerHTML = ""), 3200);
  }

  /** Starts (or resumes, if we joined late) the toss so every client lands at the same moment. */
  function toss() {
    const play = room.play;
    if (animatedFlip === room.id) return;
    animatedFlip = room.id;
    const result = play.result;
    const duration = api.reducedMotion() ? 400 : play.flipMs;
    const elapsed = Math.max(0, api.serverNow() - play.flipAt);
    const turns = 7;
    const end = turns * 360 + (result === "tails" ? 180 : 0);
    animation?.cancel();
    animation = coin.animate(
      [
        { transform: "translateY(0) rotateX(0deg) scale(1)" },
        { transform: `translateY(-62%) rotateX(${end * 0.55}deg) scale(1.28)`, offset: 0.45 },
        { transform: `translateY(4%) rotateX(${end - 12}deg) scale(0.98)`, offset: 0.9 },
        { transform: `translateY(0) rotateX(${end}deg) scale(1)` },
      ],
      { duration, easing: "cubic-bezier(.25,.6,.35,1)", fill: "forwards" },
    );
    shadowAnimation?.cancel();
    shadowAnimation = find(".rcf-shadow").animate(
      [{ transform: "scale(1)", opacity: 0.6 }, { transform: "scale(0.45)", opacity: 0.2, offset: 0.45 }, { transform: "scale(1)", opacity: 0.6 }],
      { duration, easing: "cubic-bezier(.25,.6,.35,1)", fill: "forwards" },
    );
    // Never skip more than a moment of the toss, even if this client saw the result late.
    const offset = Math.min(elapsed, 350, duration);
    animation.currentTime = offset;
    shadowAnimation.currentTime = offset;
    find(".rcf-stage").classList.add("tossing");
    api.sound(420, 0.08, "triangle", 0.04);
    clearTimeout(revealTimer);
    revealTimer = setTimeout(reveal, Math.max(0, duration - offset));
  }

  function reveal() {
    if (!room || revealed === room.id) return;
    revealed = room.id;
    const play = room.play;
    find(".rcf-stage").classList.remove("tossing");
    find(".rcf-stage").classList.add("landed", play.result);
    const winner = room.seats[play.winnerSeat];
    const youWon = play.winnerSeat === mySeat();
    find(".rcf-status").innerHTML = `${play.result.toUpperCase()} · <b>${api.escape(winner?.name || "")}</b> WINS`;
    find(".rcf-status").className = `rcf-status result ${youWon ? "won" : mySeat() >= 0 ? "lost" : ""}`;
    if (youWon) {
      confetti();
      api.sound(880, 0.16, "triangle", 0.05);
      setTimeout(() => api.sound(1320, 0.18, "triangle", 0.05), 140);
      api.toast("Coinflip won", "win", `+${api.money(play.stake * 2)} CR`);
    } else if (mySeat() >= 0) api.sound(180, 0.25, "sawtooth", 0.035);
    render();
  }

  function countdown() {
    clearInterval(countTimer);
    const el = find(".rcf-count");
    const step = () => {
      const left = Math.ceil((room.play.flipAt - api.serverNow()) / 1000);
      if (room.play.phase !== "countdown" || left <= 0) {
        el.hidden = true;
        clearInterval(countTimer);
        return;
      }
      el.hidden = false;
      if (left !== lastCount) {
        lastCount = left;
        el.textContent = String(left);
        el.classList.remove("pulse");
        void el.offsetWidth;
        el.classList.add("pulse");
        api.sound(300 + (3 - left) * 120, 0.07, "square", 0.03);
      }
    };
    step();
    countTimer = setInterval(step, 100);
  }

  function renderFair() {
    const play = room.play;
    if (!play.seedHash) return (find(".rcf-fair").innerHTML = "");
    if (play.seed) {
      const ok = sha256Hex(play.seed) === play.seedHash && coinflipResult(play.seed, room.id) === play.result;
      find(".rcf-fair").innerHTML = `<span class="${ok ? "ok" : "bad"}">${ok ? "✓ VERIFIED FAIR" : "✕ CHECK FAILED"}</span><code title="${play.seed}">SEED ${play.seed.slice(0, 20)}…</code><code title="${play.seedHash}">HASH ${play.seedHash.slice(0, 20)}…</code>`;
    } else find(".rcf-fair").innerHTML = `<span>COMMITTED</span><code title="${play.seedHash}">SEED HASH ${play.seedHash.slice(0, 28)}…</code><small>The seed is revealed after the flip so you can verify it.</small>`;
  }

  function renderActions() {
    const actions = [];
    const seated = mySeat() >= 0;
    if (room.state === "waiting" && seated) actions.push(`<button type="button" data-leave>${String(api.user()?.id) === room.hostId ? "CANCEL & REFUND" : "LEAVE & REFUND"}</button>`);
    if (room.state === "finished" && revealed === room.id) {
      const side = seated ? room.play.sides[mySeat()] : room.play.sides[0];
      actions.push(`<button type="button" class="primary" data-again="${side}">NEW FLIP · ${api.money(room.play.stake)} CR ${side.toUpperCase()}</button>`);
    }
    actions.push(`<button type="button" data-back>BACK TO LOBBY</button>`);
    find(".rcf-actions").innerHTML = actions.join("");
  }

  function render() {
    const play = room.play;
    find('[data-seat="0"]').innerHTML = sideMarkup(0);
    find('[data-seat="1"]').innerHTML = sideMarkup(1);
    find(".rcf-pot").innerHTML = `POT <b>${api.money(play.stake * (room.seats.filter(Boolean).length || 1))} CR</b>`;
    if (play.phase === "waiting") {
      find(".rcf-status").textContent = room.seats.every(Boolean) ? "STARTING…" : "WAITING FOR AN OPPONENT";
      find(".rcf-status").className = "rcf-status";
    } else if (play.phase === "countdown") {
      find(".rcf-status").textContent = "GET READY";
      find(".rcf-status").className = "rcf-status";
    } else if (revealed !== room.id) {
      find(".rcf-status").textContent = "FLIPPING…";
      find(".rcf-status").className = "rcf-status";
    }
    renderFair();
    renderActions();
  }

  root.addEventListener("click", async (event) => {
    const join = event.target.closest("[data-join]");
    if (join) api.join(Number(join.dataset.join));
    const bot = event.target.closest("[data-bot]");
    if (bot) api.bot(Number(bot.dataset.bot));
    const kick = event.target.closest("[data-kick]");
    if (kick) api.kick(Number(kick.dataset.kick));
    if (event.target.closest("[data-leave]")) {
      const result = await api.leave();
      if (result && result.state === "closed") api.back();
    }
    if (event.target.closest("[data-back]")) api.back();
    const again = event.target.closest("[data-again]");
    if (again) api.create("coinflip", { stake: room.play.stake, side: again.dataset.again }, room.visibility);
  });

  return {
    update(next) {
      const firstView = !room;
      room = next;
      const play = room.play;
      if (play.phase === "countdown") countdown();
      if (play.phase === "flipped") {
        // Seen for the first time long after the reveal (e.g. opened from the feed): show it landed.
        if (firstView && api.serverNow() > play.revealAt + 400) {
          animatedFlip = room.id;
          coin.style.transform = `rotateX(${play.result === "tails" ? 180 : 0}deg)`;
          revealed = room.id;
          find(".rcf-stage").classList.add("landed", play.result);
          const winner = room.seats[play.winnerSeat];
          render();
          find(".rcf-status").innerHTML = `${play.result.toUpperCase()} · <b>${api.escape(winner?.name || "")}</b> WON`;
          find(".rcf-status").className = "rcf-status result";
          return;
        }
        toss();
      }
      render();
    },
    destroy() {
      clearInterval(countTimer);
      clearTimeout(revealTimer);
      animation?.cancel();
      shadowAnimation?.cancel();
    },
  };
}

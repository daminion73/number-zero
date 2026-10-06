const money = (value) => Number(value || 0).toLocaleString(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const relativeTime = (date) => {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
};

const art = {
  coin: '<svg viewBox="0 0 300 220"><circle cx="150" cy="110" r="76"/><circle cx="150" cy="110" r="57"/><path d="M125 84h50l-16 26 16 26h-50l16-26z"/></svg>',
  rocket: '<svg viewBox="0 0 300 220"><path d="M83 174c26-72 72-124 143-138-13 72-64 118-137 143z"/><circle cx="176" cy="86" r="20"/><path d="M91 151l-48 27 29-54m61 52-28 41-2-49"/></svg>',
  cards: '<svg viewBox="0 0 300 220"><rect x="55" y="35" width="120" height="165" rx="14" transform="rotate(-12 115 118)"/><rect x="130" y="28" width="120" height="165" rx="14" transform="rotate(10 190 110)"/><path d="M190 73l18 28-18 28-18-28z"/></svg>',
  gem: '<svg viewBox="0 0 300 220"><path d="M58 79l44-48h96l44 48-92 116z"/><path d="M58 79h184M102 31l48 164 48-164"/></svg>',
};

const games = [
  { name: "LUCKY SEVENS", category: "slots", target: "slots:lucky-sevens", tag: "NEW", copy: "Classic 3-reel fruit machine", icon: "7" },
  { name: "FRUIT FRENZY", category: "slots", target: "slots:fruit-frenzy", tag: "NEW", copy: "3×3 · 5 lines · Wilds", icon: "🍒" },
  { name: "NEON GEMS", category: "slots", target: "slots:neon-gems", tag: "HOT", copy: "5×3 · 10 lines · 3,000× line", icon: "◆" },
  { name: "NUMBER ROLL", category: "slots", target: "sandbox", tag: "ORIGINAL", copy: "One million possibilities", icon: "0 0 1" },
  { name: "CASE STORE", category: "slots", target: "store", tag: "435 CASES", copy: "Audited drops and bonuses", icon: "◇" },
  { name: "INVENTORY", category: "slots", target: "inventory", tag: "VAULT", copy: "Your sealed collection", icon: "▦" },
  { name: "BLACKJACK", category: "originals", target: "blackjack", tag: "ORIGINAL", copy: "Classic multi-hand tables", icon: "A♠" },
  { name: "BACCARAT", category: "originals", target: "baccarat", tag: "ORIGINAL", copy: "Player · Banker · Tie", icon: "◆" },
  { name: "ROULETTE", category: "originals", target: "roulette", tag: "NEW", copy: "European single zero", icon: "◎" },
  { name: "VIDEO POKER", category: "originals", target: "video-poker", tag: "NEW", copy: "Jacks or Better 9/6", icon: "♥" },
  { name: "DICE", category: "originals", target: "dice", tag: "NEW", copy: "Roll over or under", icon: "⚄" },
  { name: "PLINKO", category: "originals", target: "plinko", tag: "NEW", copy: "Drop for up to 1,000×", icon: "∴" },
  { name: "KENO", category: "originals", target: "keno", tag: "NEW", copy: "Pick 1–10 of 40", icon: "▦" },
  { name: "MINES", category: "originals", target: "mines", tag: "ORIGINAL", copy: "Reveal gems or cash out", icon: "✦" },
  { name: "CRASH", category: "originals", target: "crash", tag: "HOT", copy: "Ride your own rocket", icon: "↗" },
  { name: "LIVE ROCKET", category: "live lobby", target: "live", tag: "LIVE", copy: "One round. Every player.", icon: "▲" },
  { name: "LIVE BATTLES", category: "case battles", target: "online", tag: "LIVE", copy: "Server-settled arenas", icon: "⚔" },
  { name: "CREATE BATTLE", category: "case battles", target: "duel", tag: "NEW", copy: "Build your showdown", icon: "+" },
];

const CASINO_GAMES = ["slots", "blackjack", "roulette", "baccarat", "video-poker", "dice", "plinko", "keno", "mines", "crash"];

export function initHome({ root, account, navigate, openGame }) {
  let visible = false;
  let liveTimer;
  let carouselTimer;
  let slideIndex = 0;
  let touchStart = 0;
  let winners = [];
  let category = "all";

  const promotionalSlides = [
    { eyebrow: "LIMITED DROP", title: "GOLDEN COINS", copy: "Crack the vault. Multipliers from 50× to a legendary 1,000×.", cta: "EXPLORE CASES", target: "store", theme: "gold", art: "coin" },
    { eyebrow: "MEMBER REWARD", title: "100,000 CR DAILY", copy: "A fresh stack, every day. Sign in and make your next run count.", cta: "CLAIM REWARD", target: "account", theme: "violet", art: "gem" },
    { eyebrow: "SERVER-WIDE ACTION", title: "LIVE ROCKET", copy: "One provably fair flight shared by everyone in the arena.", cta: "ENTER LIVE", target: "live", theme: "cyan", art: "rocket" },
    { eyebrow: "PICK A SIDE", title: "CASE BATTLES", copy: "Build a line-up, take a seat and watch every pull land live.", cta: "VIEW BATTLES", target: "online", theme: "pink", art: "cards" },
  ];

  root.innerHTML = `
    <section class="home-hero" aria-roledescription="carousel">
      <div class="home-slides"></div>
      <button class="hero-arrow previous" data-arrow="-1" aria-label="Previous promotion">‹</button>
      <button class="hero-arrow next" data-arrow="1" aria-label="Next promotion">›</button>
      <div class="home-dots"></div>
    </section>
    <section class="wins-strip"><strong><i></i> LIVE WINS</strong><div class="wins-viewport"><div class="wins-track"></div></div></section>
    <div class="home-feature-row">
      <button class="live-card" data-target="live"><span class="live-card-label"><i></i> LIVE ROCKET</span><strong class="live-value">CONNECTING</strong><small class="live-phase">Waiting for server</small><div class="live-meta"><span class="live-players">— PLAYERS</span><span class="live-history">LAST —</span></div></button>
      <article class="daily-card"><div><span>DAILY DROP</span><strong>100,000 <small>CR</small></strong><p>Available once every UTC day.</p></div><button id="home-daily">SIGN IN TO CLAIM</button></article>
    </div>
    <header class="games-heading"><div><span>THE FLOOR</span><h2>Choose your game</h2></div><nav class="home-categories" aria-label="Game categories"></nav></header>
    <div class="home-games"></div>`;

  const allSlides = () => [
    ...promotionalSlides,
    ...winners.slice(0, 3).map((winner) => ({
      eyebrow: `TOP LIVE WINNER · ${relativeTime(winner.at)}`,
      title: `${Number(winner.multiplier || 0).toFixed(2)}×`,
      copy: `${winner.name} won ${money(winner.payout)} CR playing ${String(winner.game).replace("slots:", "slots · ").replaceAll("-", " ")}.`,
      cta: "PLAY ORIGINALS",
      target: "originals",
      theme: "winner",
      art: "gem",
    })),
  ];

  function renderSlides() {
    const slides = allSlides();
    slideIndex = ((slideIndex % slides.length) + slides.length) % slides.length;
    root.querySelector(".home-slides").innerHTML = slides.map((slide, index) => `
      <article class="hero-slide theme-${slide.theme} ${index === slideIndex ? "active" : ""}" aria-hidden="${index !== slideIndex}">
        <div class="hero-copy"><span>${slide.eyebrow}</span><h1>${slide.title}</h1><p>${slide.copy}</p><button data-banner="${slide.target}">${slide.cta}<b>→</b></button></div>
        <div class="hero-art">${art[slide.art]}</div>
      </article>`).join("");
    root.querySelector(".home-dots").innerHTML = slides.map((_, index) => `<button data-slide="${index}" class="${index === slideIndex ? "active" : ""}" aria-label="Show slide ${index + 1}"></button>`).join("");
  }

  function renderGames() {
    const shown = games.filter((game) => category === "all" || game.category === category);
    root.querySelector(".home-games").innerHTML = shown.map((game, index) => `
      <button class="home-game art-${game.target.replace(":", "-")}" data-target="${game.target}" style="--delay:${index * 35}ms">
        <span class="game-tag ${game.tag === "LIVE" ? "is-live" : ""}">${game.tag}</span>
        <i class="game-art">${game.icon}</i><span class="game-category">${game.category}</span>
        <strong>${game.name}</strong><small>${game.copy}</small><b class="game-arrow">↗</b>
      </button>`).join("");
  }

  function renderCategories() {
    const categories = ["all", "slots", "originals", "live lobby", "case battles"];
    root.querySelector(".home-categories").innerHTML = categories.map((name) => `<button data-category="${name}" class="${name === category ? "active" : ""}">${name}</button>`).join("");
  }

  function renderWinners() {
    const track = root.querySelector(".wins-track");
    track.classList.toggle("is-empty", !winners.length);
    if (!winners.length) {
      track.innerHTML = `<span class="wins-empty">No big wins on the board yet. <b>Land one and it shows up here live.</b></span>`;
      return;
    }
    const items = winners;
    track.innerHTML = [...items, ...items].map((winner) => `<span><b>${winner.name}</b><em>${String(winner.game).replace("slots:", "slots · ").replaceAll("-", " ")}</em><strong>${Number(winner.multiplier || 0).toFixed(2)}×</strong><i>${money(winner.payout)} CR</i></span>`).join("");
  }

  async function loadWinners() {
    try {
      const result = await account.api("/winners");
      winners = result.winners || [];
    } catch {
      winners = [];
    }
    renderWinners();
    renderSlides();
  }

  async function pollLive() {
    if (!visible) return;
    try {
      const { live } = await account.api("/live");
      const now = Date.now();
      const value = live.phase === "betting"
        ? `${Math.max(0, (live.bettingEndsAt - now) / 1000).toFixed(1)}s`
        : `${Number(live.crashPoint || live.multiplier || 1).toFixed(2)}×`;
      root.querySelector(".live-value").textContent = value;
      root.querySelector(".live-phase").textContent = live.phase === "betting" ? "Next flight boarding" : live.phase === "flying" ? "Rocket in flight" : "Round crashed";
      root.querySelector(".live-players").textContent = `${live.bets?.length || 0} PLAYERS`;
      root.querySelector(".live-history").textContent = `LAST ${(live.history || []).slice(0, 3).map((round) => `${round.crashPoint.toFixed(2)}×`).join(" · ") || "—"}`;
    } catch {
      root.querySelector(".live-value").textContent = "OFFLINE";
      root.querySelector(".live-phase").textContent = "Practice games remain available";
    }
    liveTimer = setTimeout(pollLive, 2000);
  }

  function updateDaily(user) {
    const button = root.querySelector("#home-daily");
    button.textContent = !user ? "SIGN IN TO CLAIM" : user.dailyAvailable ? "CLAIM 100,000 CR" : "CLAIMED · BACK TOMORROW";
    button.disabled = Boolean(user && !user.dailyAvailable);
  }

  function resetCarouselTimer() {
    clearInterval(carouselTimer);
    carouselTimer = setInterval(() => {
      if (visible) {
        slideIndex += 1;
        renderSlides();
      }
    }, 6000);
  }

  root.addEventListener("click", async (event) => {
    const categoryButton = event.target.closest("[data-category]");
    if (categoryButton) {
      category = categoryButton.dataset.category;
      renderCategories();
      renderGames();
      return;
    }
    const target = event.target.closest("[data-target]")?.dataset.target;
    if (target) {
      if (target.startsWith("slots:")) openGame("slots", { machine: target.slice(6) });
      else if (CASINO_GAMES.includes(target)) openGame(target);
      else navigate(target);
      return;
    }
    const bannerTarget = event.target.closest("[data-banner]")?.dataset.banner;
    if (bannerTarget) {
      bannerTarget === "account" ? account.openAccount() : navigate(bannerTarget);
      return;
    }
    const dot = event.target.closest("[data-slide]");
    const arrow = event.target.closest("[data-arrow]");
    if (dot || arrow) {
      slideIndex = dot ? Number(dot.dataset.slide) : slideIndex + Number(arrow.dataset.arrow);
      renderSlides();
      resetCarouselTimer();
    }
  });

  root.querySelector("#home-daily").addEventListener("click", async () => {
    if (!account.getUser()) return account.openAccount();
    const button = root.querySelector("#home-daily");
    button.disabled = true;
    try {
      const result = await account.api("/daily", {});
      account.setUser(result.user);
      updateDaily(result.user);
    } catch (error) {
      button.textContent = error.message;
      setTimeout(() => updateDaily(account.getUser()), 2500);
    }
  });
  root.querySelector(".home-hero").addEventListener("mouseenter", () => clearInterval(carouselTimer));
  root.querySelector(".home-hero").addEventListener("mouseleave", resetCarouselTimer);
  root.querySelector(".home-hero").addEventListener("touchstart", (event) => { touchStart = event.touches[0].clientX; }, { passive: true });
  root.querySelector(".home-hero").addEventListener("touchend", (event) => {
    const distance = event.changedTouches[0].clientX - touchStart;
    if (Math.abs(distance) > 45) {
      slideIndex += distance < 0 ? 1 : -1;
      renderSlides();
    }
  }, { passive: true });

  account.onUser(updateDaily);
  renderCategories();
  renderGames();
  renderWinners();
  renderSlides();
  loadWinners();
  resetCarouselTimer();

  return {
    show() {
      visible = true;
      clearTimeout(liveTimer);
      pollLive();
    },
    hide() {
      visible = false;
      clearTimeout(liveTimer);
    },
  };
}

// Multiplayer rooms hub: a public feed of tables, join-by-code for private rooms, a create form,
// and a room view that loads the game's own renderer from games/room-<game>.js.
import { avatarMarkup, nameMarkup } from "../cosmetics.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Create-form options per game. Values are sent as `config` to POST /api/rooms. */
export const ROOM_GAMES = [
  {
    id: "coinflip",
    name: "Coinflip",
    tagline: "Heads or tails · winner takes 2×",
    icon: '<circle cx="12" cy="12" r="8"/><path d="M9.5 9h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4M12 7.5v1.5m0 6v1.5"/>',
    options: [
      { key: "stake", label: "STAKE", type: "number", value: 100, suffix: "CR" },
      { key: "side", label: "YOUR SIDE", type: "choice", value: "heads", choices: [["heads", "HEADS"], ["tails", "TAILS"]] },
    ],
  },
  {
    id: "blackjack",
    name: "Blackjack",
    tagline: "Shared dealer · up to 5 players",
    icon: '<rect x="4" y="5" width="10" height="14" rx="2"/><path d="M10 5.5 17.5 7a2 2 0 0 1 1.6 2.3l-1.7 9"/>',
    options: [
      { key: "seats", label: "SEATS", type: "choice", value: 5, choices: [[2, "2"], [3, "3"], [4, "4"], [5, "5"]] },
      { key: "minBet", label: "MIN BET", type: "choice", value: 10, choices: [[1, "1"], [10, "10"], [100, "100"], [1000, "1K"]] },
    ],
  },
  {
    id: "poker",
    name: "Poker",
    tagline: "Texas Hold'em cash table",
    icon: '<path d="M12 4c3 4 6 6 6 9a3 3 0 0 1-5 2l1 4h-4l1-4a3 3 0 0 1-5-2c0-3 3-5 6-9z"/>',
    options: [
      { key: "seats", label: "SEATS", type: "choice", value: 6, choices: [[2, "2"], [4, "4"], [6, "6"]] },
      { key: "bigBlind", label: "BLINDS", type: "choice", value: 10, choices: [[2, "1/2"], [10, "5/10"], [50, "25/50"], [200, "100/200"], [1000, "500/1K"]] },
      { key: "buyIn", label: "BUY-IN (× BIG BLIND)", type: "choice", value: 100, choices: [[50, "50×"], [100, "100×"], [200, "200×"]] },
    ],
  },
  {
    id: "russian-roulette",
    name: "Russian Roulette",
    tagline: "One bullet · survivors split the pot",
    icon: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="7.5" r="1.6"/><circle cx="16" cy="10.5" r="1.6"/><circle cx="14.5" cy="15.5" r="1.6"/><circle cx="9.5" cy="15.5" r="1.6"/><circle cx="8" cy="10.5" r="1.6"/>',
    options: [
      { key: "stake", label: "STAKE", type: "number", value: 100, suffix: "CR" },
      { key: "seats", label: "PLAYERS", type: "choice", value: 6, choices: [[2, "2"], [3, "3"], [4, "4"], [5, "5"], [6, "6"]] },
    ],
  },
];
const META = Object.fromEntries(ROOM_GAMES.map((game) => [game.id, game]));
const icon = (id, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${META[id]?.icon || ""}</svg>`;

function loadStylesheet(href) {
  const url = new URL(href, import.meta.url).href;
  if ([...document.styleSheets].some((sheet) => sheet.href === url) || document.querySelector(`link[href="${url}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  document.head.append(link);
}

export function mount(container, ctx) {
  container.innerHTML = `
    <section class="rm">
      <div class="rm-lobby">
        <header class="rm-head">
          <div><b>TABLES & ROOMS</b><small>Create a room, share the code, or jump into a public table</small></div>
          <form class="rm-code"><input name="code" maxlength="6" placeholder="ROOM CODE" autocomplete="off" spellcheck="false"><button type="submit">JOIN BY CODE</button></form>
          <button type="button" class="rm-create-open">+ CREATE ROOM</button>
        </header>
        <nav class="rm-filters"><button type="button" data-filter="" class="active">ALL TABLES</button>${ROOM_GAMES.map((game) => `<button type="button" data-filter="${game.id}">${icon(game.id, 16)}${game.name.toUpperCase()}</button>`).join("")}</nav>
        <div class="rm-feed"></div>
      </div>
      <div class="rm-room" hidden>
        <header class="rm-room-head">
          <button type="button" class="rm-back">← LOBBY</button>
          <div class="rm-room-title"></div>
          <div class="rm-room-meta"></div>
        </header>
        <div class="rm-room-body"></div>
      </div>
      <div class="rm-create" hidden></div>
    </section>`;

  const find = (selector) => container.querySelector(selector);
  let shown = false;
  let filter = "";
  let feed = [];
  let pollTimer = 0;
  let current = null; // { id, view, room, abort, streaming, viewer }
  let creating = null;
  let busy = false;

  // ── API ────────────────────────────────────────────────────────────────────
  const call = (path, body) => ctx.server(path, body);

  async function roomAction(action, body = {}) {
    if (!current) return null;
    if (!ctx.user()) {
      ctx.requireSignIn();
      return null;
    }
    try {
      const response = await call(`/rooms/${current.id}/${action}`, body);
      applyRoom(response.room);
      // Signed in since the stream opened: reconnect so pushes carry this player's private view.
      if (current && current.viewer !== (ctx.user()?.id ?? null)) connect();
      return response.room;
    } catch (error) {
      ctx.toast(error.message, "loss");
      return null;
    }
  }

  async function createRoom(game, config, visibility) {
    if (!ctx.user()) return ctx.requireSignIn();
    try {
      const response = await call("/rooms", { game, visibility, config });
      openRoom(response.room.code, response.room);
      return response.room;
    } catch (error) {
      ctx.toast(error.message, "loss");
      return null;
    }
  }

  const roomApi = {
    join: (seat) => roomAction("join", seat === undefined ? {} : { seat }),
    leave: () => roomAction("leave"),
    bot: (seat) => roomAction("bot", seat === undefined ? {} : { seat }),
    kick: (seat) => roomAction("kick", { seat }),
    start: () => roomAction("start"),
    close: () => roomAction("close"),
    act: (body) => roomAction("act", body),
    create: createRoom,
    back: () => closeRoom(),
    avatar: avatarMarkup,
    name: nameMarkup,
    escape: escapeHtml,
    money: ctx.money,
    sound: ctx.sound,
    toast: ctx.toast,
    serverNow: ctx.serverNow,
    reducedMotion: ctx.reducedMotion,
    user: ctx.user,
    requireSignIn: ctx.requireSignIn,
  };

  // ── Lobby ──────────────────────────────────────────────────────────────────
  function seatsMarkup(seats) {
    return seats.map((seat) => (seat ? `<span class="rm-seat" title="${escapeHtml(seat.name)}${seat.bot ? " (bot)" : ""}">${avatarMarkup(seat.look, seat.name, 26)}</span>` : `<span class="rm-seat empty" title="Open seat">+</span>`)).join("");
  }

  function detail(room) {
    const c = room.config || {};
    if (room.game === "coinflip") return room.detail?.result ? `${room.detail.result.toUpperCase()} WON` : `${ctx.money(c.stake)} CR · ${String(c.side).toUpperCase()} TAKEN`;
    if (room.game === "poker") return `BLINDS ${ctx.money(c.bigBlind / 2)}/${ctx.money(c.bigBlind)}`;
    if (room.game === "blackjack") return `MIN BET ${ctx.money(c.minBet)} CR`;
    if (room.game === "russian-roulette") return `${ctx.money(c.stake)} CR · ${c.seats} PLAYERS`;
    return "";
  }

  function renderFeed() {
    const rows = feed.filter((room) => !filter || room.game === filter);
    find(".rm-feed").innerHTML = rows.length
      ? rows.map((room) => `
        <article class="rm-card ${room.state}" data-game="${room.game}">
          <div class="rm-card-icon">${icon(room.game, 26)}</div>
          <div class="rm-card-copy"><small>${escapeHtml(room.name.toUpperCase())} · ${room.state === "waiting" ? "OPEN" : room.state === "playing" ? "IN PLAY" : "FINISHED"}</small><b>${escapeHtml(detail(room))}</b><span>Hosted by ${escapeHtml(room.hostName)}</span></div>
          <div class="rm-card-seats">${seatsMarkup(room.seats)}</div>
          <button type="button" data-open="${room.id}" class="${room.joinable ? "join" : ""}">${room.joinable ? "JOIN" : "WATCH"} →</button>
        </article>`).join("")
      : `<div class="rm-empty">${icon(filter || "coinflip", 44)}<b>No public ${filter ? META[filter].name.toLowerCase() : ""} rooms right now</b><span>Create one — public rooms show up here, private rooms are joined with their code.</span><button type="button" class="rm-create-open">+ CREATE ROOM</button></div>`;
  }

  async function pollFeed() {
    try {
      feed = (await call(`/rooms`)).rooms;
      renderFeed();
    } catch (error) {
      find(".rm-feed").innerHTML = `<div class="rm-empty"><b>OFFLINE</b><span>${escapeHtml(error.message)}</span></div>`;
    }
  }

  // ── Create form ────────────────────────────────────────────────────────────
  function renderCreate() {
    const game = META[creating.game];
    const panel = find(".rm-create");
    panel.hidden = false;
    panel.innerHTML = `
      <form class="rm-create-card">
        <header><b>CREATE A ROOM</b><button type="button" data-create-close aria-label="Close">×</button></header>
        <div class="rm-game-pick">${ROOM_GAMES.map((entry) => `<button type="button" data-pick="${entry.id}" class="${entry.id === game.id ? "active" : ""}">${icon(entry.id, 28)}<b>${entry.name}</b><small>${entry.tagline}</small></button>`).join("")}</div>
        <div class="rm-options">${game.options.map((option) => option.type === "number"
          ? `<label>${option.label}<span><input type="number" min="1" step="1" name="${option.key}" value="${creating.config[option.key] ?? option.value}"><b>${option.suffix || ""}</b></span></label>`
          : `<label>${option.label}<div class="rm-choice">${option.choices.map(([value, label]) => `<button type="button" data-option="${option.key}" data-value="${value}" class="${String(creating.config[option.key] ?? option.value) === String(value) ? "active" : ""}">${label}</button>`).join("")}</div></label>`).join("")}</div>
        <div class="rm-visibility"><button type="button" data-visibility="public" class="${creating.visibility === "public" ? "active" : ""}"><b>PUBLIC</b><small>Listed on the feed for everyone</small></button><button type="button" data-visibility="private" class="${creating.visibility === "private" ? "active" : ""}"><b>PRIVATE</b><small>Hidden · friends join with the code</small></button></div>
        <button type="submit" class="rm-create-submit" ${busy ? "disabled" : ""}>CREATE ${escapeHtml(game.name.toUpperCase())} ROOM</button>
      </form>`;
  }

  function openCreate(game = filter || "coinflip") {
    if (!ctx.user()) return ctx.requireSignIn();
    creating = { game, visibility: "public", config: {} };
    renderCreate();
  }

  function readConfig() {
    const game = META[creating.game];
    const config = {};
    for (const option of game.options) {
      if (option.type === "number") config[option.key] = Number(find(`.rm-create input[name="${option.key}"]`).value);
      else {
        const raw = creating.config[option.key] ?? option.value;
        config[option.key] = typeof option.value === "number" ? Number(raw) : raw;
      }
    }
    return config;
  }

  // ── Room ───────────────────────────────────────────────────────────────────
  function applyRoom(room) {
    if (!current || room.id !== current.id) return;
    current.room = room;
    const meta = META[room.game];
    find(".rm-room-title").innerHTML = `${icon(room.game, 22)}<b>${escapeHtml(meta?.name || room.name)}</b><small>Hosted by ${escapeHtml(room.hostName)}</small>`;
    const isHost = ctx.user() && String(ctx.user().id) === room.hostId;
    find(".rm-room-meta").innerHTML = `<span class="rm-badge ${room.visibility}">${room.visibility === "private" ? "🔒 PRIVATE" : "PUBLIC"}</span><button type="button" class="rm-copy" data-copy="${room.code}" title="Copy invite link">CODE <b>${room.code}</b> ⧉</button>${isHost && room.state === "waiting" ? '<button type="button" class="rm-close-room">CLOSE ROOM</button>' : ""}`;
    find(".rm-back").textContent = room.you >= 0 ? "← LEAVE TABLE" : "← LOBBY";
    current.view?.update(room);
  }

  async function openRoom(key, initial = null) {
    if (current) closeRoom(false);
    find(".rm-lobby").hidden = true;
    find(".rm-room").hidden = false;
    find(".rm-create").hidden = true;
    const body = find(".rm-room-body");
    body.innerHTML = `<div class="rm-loading">OPENING ROOM…</div>`;
    current = { id: key, view: null, room: null };
    try {
      const room = initial || (await call(`/rooms/${key}`)).room;
      if (current?.id !== key) return;
      current.id = room.id;
      const url = new URL(location.href);
      url.searchParams.set("room", room.code);
      history.replaceState(null, "", url);
      loadStylesheet(`room-${room.game}.css`);
      const module = await import(new URL(`room-${room.game}.js`, import.meta.url).href);
      if (current?.id !== room.id) return;
      // A fresh element per room, so a view's listeners never outlive it.
      const host = document.createElement("div");
      host.className = "rm-view";
      body.replaceChildren(host);
      current.view = module.mountRoom(host, roomApi);
      applyRoom(room);
      connect();
      schedule();
    } catch (error) {
      ctx.toast(error.message, "loss");
      closeRoom();
    }
  }

  /** Leaving the room view gives up the seat, so a table never lingers with only bots left. */
  function closeRoom(toLobby = true) {
    const leaving = current;
    leaving?.abort?.abort();
    leaving?.view?.destroy?.();
    if (leaving?.room && leaving.room.you >= 0 && ctx.user()) call(`/rooms/${leaving.id}/leave`, {}).catch(() => {});
    current = null;
    const url = new URL(location.href);
    url.searchParams.delete("room");
    history.replaceState(null, "", url);
    if (!toLobby) return;
    find(".rm-room").hidden = true;
    find(".rm-lobby").hidden = false;
    find(".rm-room-body").innerHTML = "";
    pollFeed();
    schedule();
  }

  /**
   * Opens the room's live stream (server push on every change). While it is up there is no polling;
   * if it drops, polling takes over and the stream is retried.
   */
  function connect() {
    const room = current;
    if (!room?.room || !shown || !ctx.stream) return;
    room.abort?.abort();
    const abort = new AbortController();
    room.abort = abort;
    room.viewer = ctx.user()?.id ?? null;
    const lost = () => {
      if (abort.signal.aborted || current !== room) return;
      room.streaming = false;
      schedule();
      setTimeout(() => current === room && room.abort === abort && connect(), 3000);
    };
    ctx.stream(`/rooms/${room.id}/stream`, (data) => {
      if (current !== room || abort.signal.aborted) return;
      if (data.closed) {
        abort.abort();
        room.room = null; // nothing left to leave
        ctx.toast("That room has closed", "info");
        return closeRoom();
      }
      if (!room.streaming) {
        room.streaming = true;
        schedule();
      }
      applyRoom(data.room);
    }, abort.signal).then(lost, (error) => {
      if (abort.signal.aborted || current !== room) return;
      if (error.code === "room_not_found") {
        room.room = null;
        ctx.toast("That room has closed", "info");
        return closeRoom();
      }
      lost();
    });
  }

  async function pollRoom() {
    if (!current?.room) return;
    try {
      applyRoom((await call(`/rooms/${current.id}`)).room);
    } catch (error) {
      if (error.code === "room_not_found" || /does not exist/.test(error.message)) {
        if (current) current.room = null;
        ctx.toast("That room has closed", "info");
        closeRoom();
      }
    }
  }

  function schedule() {
    clearInterval(pollTimer);
    if (!shown) return;
    if (current?.streaming) return;
    pollTimer = current ? setInterval(pollRoom, 1000) : setInterval(pollFeed, 3000);
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  container.addEventListener("click", async (event) => {
    const target = event.target;
    const filterButton = target.closest("[data-filter]");
    if (filterButton) {
      filter = filterButton.dataset.filter;
      container.querySelectorAll("[data-filter]").forEach((button) => button.classList.toggle("active", button === filterButton));
      renderFeed();
    }
    if (target.closest(".rm-create-open")) openCreate();
    const open = target.closest("[data-open]");
    if (open) openRoom(open.dataset.open);
    if (target.closest(".rm-back")) {
      const room = current?.room;
      if (room?.you >= 0 && room.state === "playing" && !confirm("Leave the table? You give up your seat and any hand in progress.")) return;
      closeRoom();
    }
    const copy = target.closest("[data-copy]");
    if (copy) {
      const url = new URL(location.href);
      url.searchParams.set("room", copy.dataset.copy);
      try {
        await navigator.clipboard.writeText(url.href);
        ctx.toast("Invite link copied", "info", `Code ${copy.dataset.copy}`);
      } catch {
        ctx.toast(`Room code ${copy.dataset.copy}`, "info");
      }
    }
    if (target.closest(".rm-close-room")) roomApi.close().then((room) => room && closeRoom());
    if (target.closest("[data-create-close]") || target === find(".rm-create")) find(".rm-create").hidden = true;
    const pick = target.closest("[data-pick]");
    if (pick) {
      creating = { ...creating, game: pick.dataset.pick, config: {} };
      renderCreate();
    }
    const option = target.closest("[data-option]");
    if (option) {
      creating.config[option.dataset.option] = option.dataset.value;
      container.querySelectorAll(`[data-option="${option.dataset.option}"]`).forEach((button) => button.classList.toggle("active", button === option));
    }
    const visibility = target.closest("[data-visibility]");
    if (visibility) {
      creating.visibility = visibility.dataset.visibility;
      container.querySelectorAll("[data-visibility]").forEach((button) => button.classList.toggle("active", button === visibility));
    }
  });

  container.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (event.target.closest(".rm-code")) {
      const code = event.target.code.value.trim().toUpperCase();
      if (code.length < 4) return ctx.toast("Enter a room code", "loss");
      event.target.code.value = "";
      openRoom(code);
    }
    if (event.target.closest(".rm-create-card") && !busy) {
      busy = true;
      renderCreate();
      const config = readConfig();
      const room = await createRoom(creating.game, config, creating.visibility);
      busy = false;
      if (room) find(".rm-create").hidden = true;
      else renderCreate();
    }
  });

  const deepLink = new URL(location.href).searchParams.get("room");

  return {
    show() {
      shown = true;
      if (current) {
        pollRoom();
        connect();
      }
      else if (deepLink && !this.opened) {
        this.opened = true;
        openRoom(deepLink);
      } else pollFeed();
      schedule();
    },
    hide() {
      shown = false;
      clearInterval(pollTimer);
      if (current) {
        current.abort?.abort();
        current.streaming = false;
      }
    },
    select(options) {
      if (options?.room) openRoom(options.room);
    },
  };
}

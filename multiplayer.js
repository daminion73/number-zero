import { avatarMarkup } from "./cosmetics.js";
import { CASES } from "./economy.js";
import { API_BASE } from "./config.js";

const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (value) =>
  Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const itemFor = (id) => CASES.find((item) => item.id === id);
const TEAM_COLORS = ["#53e7ff", "#ff4fd8", "#ffd43b", "#c7ff36"];
const TOKEN_KEY = `number-zero-session:${API_BASE || location.origin}`;
const modeCopy = {
  classic: "Highest total EP wins",
  crazy: "Lowest total EP wins",
  clutch: "Best single pull wins",
  terminal: "Final round EP wins",
  share: "Everyone shares the pot",
};

export function initMultiplayer({ navigate, getBattleSelection, caseImage, animateRound, renderBattle }) {
  let token = sessionStorage.getItem(TOKEN_KEY) || "",
    user = null,
    config = null;
  let battles = [],
    selected = null,
    currentMode = "sandbox",
    activeBattleId = null;
  // While a casino round is still revealing, the header shows this pre-payout balance instead.
  let heldBalance = null;
  const shownBalance = () => heldBalance ?? user?.balance;
  let paused = false,
    fetching = false,
    busy = false,
    online = false,
    timer,
    googlePromise;
  let listSignature = "",
    roomSignature = "",
    accountSignature = "",
    pendingCreate = null,
    requestEpoch = 0;
  let presentation = null;
  const userListeners = new Set();
  let notifiedUser = Symbol("initial");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const requestedBattle = new URL(location.href).searchParams.get("battle");

  const network = document.createElement("div");
  network.className = "network-bar";
  network.innerHTML = `<button class="network-link" id="network-lobby" type="button"><i></i><span id="network-status">CONNECTING TO ARENA</span></button><span class="network-note">VIRTUAL CREDITS · NO CASH VALUE</span><button type="button" id="account-button">SIGN IN / ACCOUNT <span>↗</span></button>`;
  $(".topbar").after(network);
  const panel = document.createElement("section");
  panel.id = "online-panel";
  panel.className = "online-panel";
  panel.hidden = true;
  panel.innerHTML = `<div class="online-heading"><div><p class="kicker">SHARED ARENA / REAL PLAYERS / OPTIONAL HOUSE BOTS</p><h1>LIVE//BATTLES</h1><p>Choose your seat. Build your team. Every result settles on the server.</p></div><button class="mp-primary" id="online-create" type="button">+ CREATE A BATTLE</button></div>
    <div class="online-toolbar"><div class="online-filters" role="group" aria-label="Filter public battles"><button type="button" data-filter="open" aria-pressed="true">OPEN SEATS</button><button type="button" data-filter="all" aria-pressed="false">ALL BATTLES</button><button type="button" data-filter="mine" aria-pressed="false">MY BATTLES</button></div><div class="online-feed-controls"><button id="online-pause" type="button" aria-pressed="false">PAUSE UPDATES</button><button id="online-refresh" type="button">REFRESH</button></div></div>
    <p id="online-message" class="online-message" role="status">Connecting to the battle server…</p>
    <div id="online-room" class="online-room" hidden></div><div id="online-battles" class="online-battles"></div>
    <p class="online-footnote">Online wallets are separate from local practice. Entry is reserved when you create or join. Leave before start to refund your seat; cancelled or expired lobbies refund all human players. House bots are always labelled.</p>`;
  $("#duel-panel").before(panel);
  const dialog = document.createElement("dialog");
  dialog.id = "account-dialog";
  dialog.className = "account-dialog";
  dialog.setAttribute("aria-labelledby", "account-title");
  dialog.innerHTML = `<button type="button" class="account-close" aria-label="Close account">×</button><p class="kicker">YOUR ONLINE IDENTITY</p><h2 id="account-title">ENTER THE ARENA</h2><p id="account-description">Sign in with Google to join public battles. Your online credits and results follow your account.</p><div id="account-content"></div><p class="account-status" id="account-status" role="status"></p><p class="online-footnote">100,000 welcome credits · 100,000 daily credits<br>Virtual only. No deposits, purchases or withdrawals.</p>`;
  document.body.append(dialog);
  const publish = document.createElement("button");
  publish.id = "online-publish";
  publish.className = "mp-primary";
  publish.type = "button";
  publish.textContent = "PUBLISH ONLINE →";
  $("#duel-start").before(publish);
  const publishStatus = document.createElement("p");
  publishStatus.className = "publish-status";
  publishStatus.setAttribute("role", "status");
  $(".creation-checkout-banner").after(publishStatus);
  let filter = "open";

  function message(text, error = false) {
    $("#online-message").textContent = text;
    $("#online-message").classList.toggle("is-error", error);
  }
  async function api(path, data) {
    const response = await fetch(`${API_BASE.replace(/\/$/, "")}/api${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
      credentials: "omit",
    });
    const result = await response.json().catch(() => {
      throw new Error(
        "Online server is not connected. GitHub Pages hosts practice only until a backend is configured.",
      );
    });
    if (!response.ok) {
      if (response.status === 401 && result.error?.code === "unauthorized") {
        token = "";
        user = null;
        sessionStorage.removeItem(TOKEN_KEY);
        renderAccount();
      }
      const error = new Error(
        result.error?.message || `Server returned ${response.status}`,
      );
      error.code = result.error?.code;
      error.battleId = result.error?.battleId;
      throw error;
    }
    return result;
  }
  /** Reads a server-sent-event stream, calling `onData` per message. Resolves when the server ends it. */
  async function stream(path, onData, signal) {
    const response = await fetch(`${API_BASE.replace(/\/$/, "")}/api${path}`, {
      headers: { Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal,
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok || !response.body) {
      const result = await response.json().catch(() => ({}));
      const error = new Error(result.error?.message || `Server returned ${response.status}`);
      error.code = result.error?.code;
      throw error;
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;
      for (let cut = buffer.indexOf("\n\n"); cut >= 0; cut = buffer.indexOf("\n\n")) {
        const data = buffer.slice(0, cut).split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
        buffer = buffer.slice(cut + 2);
        if (data) onData(JSON.parse(data));
      }
    }
  }
  function renderAccount() {
    if (!user) heldBalance = null;
    $("#account-button").innerHTML = user
      ? `${avatarMarkup(user.look, user.name, 20)}<span>${esc(user.name)} · ${money(shownBalance())} ONLINE CR</span>`
      : "SIGN IN / ACCOUNT ↗";
    $("#global-balance").textContent = user ? `${money(shownBalance())} CR` : "SIGN IN";
    if ($(".online-balance") && !presentation?.controller)
      $(".online-balance").textContent = user ? `${money(shownBalance())} CR` : "SPECTATING";
    if (notifiedUser !== user) {
      notifiedUser = user;
      userListeners.forEach((callback) => callback(user));
    }
    $("#account-title").textContent = user ? user.name : "ENTER THE ARENA";
    $("#account-description").textContent = user
      ? "Your server-owned wallet. Local practice tools cannot change this balance."
      : "Sign in with Google to join public battles. Your online credits and results follow your account.";
    if (!dialog.open) return;
    const signature = JSON.stringify([user, activeBattleId, config]);
    if (signature === accountSignature) return;
    accountSignature = signature;
    const content = $("#account-content");
    if (user) {
      content.innerHTML = `<div class="account-wallet"><small>ONLINE BALANCE</small><strong>${money(shownBalance())} <em>CR</em></strong></div><div class="account-stats"><span><b>${user.battlesPlayed}</b> BATTLES COMPLETED</span><span><b>${user.wins}</b> WINS / TIED WINS</span></div><button class="mp-primary" id="online-daily" type="button" ${user.dailyAvailable ? "" : "disabled"}>${user.dailyAvailable ? "CLAIM 100,000 DAILY CREDITS" : "DAILY CLAIMED · RESETS 00:00 UTC"}</button>${activeBattleId ? '<button id="online-resume" type="button">RETURN TO YOUR ACTIVE BATTLE →</button>' : ""}<button id="online-logout" type="button">SIGN OUT</button>`;
      $("#online-daily").onclick = () =>
        action(async () => {
          const result = await api("/daily", {});
          user = result.user;
          renderAccount();
          $("#account-status").textContent = "100,000 online credits added.";
        });
      $("#online-resume")?.addEventListener("click", () => {
        dialog.close();
        viewBattle(activeBattleId);
      });
      $("#online-logout").onclick = () =>
        action(async () => {
          await api("/auth/logout", {});
          token = "";
          user = null;
          activeBattleId = null;
          sessionStorage.removeItem(TOKEN_KEY);
          window.google?.accounts.id.disableAutoSelect();
          renderAccount();
          renderRoom(true);
        });
    } else {
      content.innerHTML = '<div id="google-signin"></div>';
      if (config?.googleClientId)
        loadGoogle().catch((error) => {
          $("#account-status").textContent = error.message;
        });
      else
        content.append(
          document.createTextNode(
            config
              ? "Google sign-in is not configured on this server yet."
              : "The online server is unavailable. Practice mode still works.",
          ),
        );
      if (config?.devAuth) {
        const form = document.createElement("form");
        form.className = "dev-login";
        form.innerHTML =
          '<label>LOCAL TEST ACCOUNT (NOT GOOGLE)<input id="dev-player-name" name="name" maxlength="40" required placeholder="Player name" autocomplete="off"></label><button type="submit">SIGN IN LOCALLY</button>';
        form.onsubmit = (event) => {
          event.preventDefault();
          action(async () =>
            signedIn(
              await api("/auth/dev", { name: new FormData(form).get("name") }),
            ),
          );
        };
        content.append(form);
      }
    }
  }
  async function loadGoogle() {
    googlePromise ||= new Promise((resolve, reject) => {
      if (window.google?.accounts) return resolve();
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        googlePromise = null;
        reject(
          new Error(
            "Google sign-in could not load. Check your connection or blocker.",
          ),
        );
      };
      document.head.append(script);
    });
    await googlePromise;
    if (user || !dialog.open) return;
    window.google.accounts.id.initialize({
      client_id: config.googleClientId,
      auto_select: false,
      callback: (response) =>
        action(async () =>
          signedIn(
            await api("/auth/google", { credential: response.credential }),
          ),
        ),
    });
    window.google.accounts.id.renderButton($("#google-signin"), {
      theme: "filled_black",
      size: "large",
      shape: "rectangular",
      text: "signin_with",
      width: 280,
    });
  }
  async function signedIn(result) {
    token = result.token;
    user = result.user;
    sessionStorage.setItem(TOKEN_KEY, token);
    $("#account-status").textContent =
      "Signed in. Your online wallet is ready.";
    await refresh(true);
    renderAccount();
    renderRoom(true);
  }
  function openAccount() {
    $("#account-status").textContent = "";
    accountSignature = "";
    dialog.showModal();
    renderAccount();
  }
  function renderList(force = false) {
    const shown = battles.filter((b) =>
      ["waiting", "running"].includes(b.state) && (filter === "open"
        ? b.state === "waiting"
        : filter === "mine"
          ? b.players.some((p) => !p.bot && p.id === user?.id)
          : true),
    );
    const signature = JSON.stringify([
      shown.map((b) => [b.id, b.state, b.players, b.rounds.length]),
      filter,
      user?.id,
    ]);
    if (!force && signature === listSignature) return;
    if (!force && shown.some((b) => b.id === document.activeElement?.dataset.viewBattle)) return;
    listSignature = signature;
    $("#online-battles").innerHTML = shown.length
      ? shown
          .map((b) => {
            const human = b.players.filter((p) => !p.bot).length,
              slots = b.teams.flat().length;
            const first = itemFor(b.caseIds[0]);
            return `<article class="online-battle-card" data-state="${b.state}"><div class="online-case-thumb">${first ? caseImage(first) : "◇"}</div><div class="online-battle-copy"><div><span class="online-state">${b.state.toUpperCase()}</span><small>${esc(b.format.toUpperCase())} · ${esc(b.mode.toUpperCase())}</small></div><h2>${esc(first?.name || "Case battle")}${b.caseIds.length > 1 ? ` <span>+${b.caseIds.length - 1} rounds</span>` : ""}</h2><p>${b.players.length}/${slots} seats · ${human} human${human === 1 ? "" : "s"} · ${b.players.length - human} bots</p></div><div class="online-entry"><strong>${money(b.entry)} <small>CR</small></strong><span>PER SEAT</span></div><button type="button" data-view-battle="${b.id}">${b.state === "waiting" ? "VIEW / JOIN" : "WATCH / RESULTS"} →</button></article>`;
          })
          .join("")
      : `<div class="online-empty"><span>◈</span><h2>${filter === "mine" ? "YOUR NEXT BATTLE STARTS HERE" : filter === "open" ? "THE ARENA IS OPEN" : "NO ACTIVE BATTLES"}</h2><p>${filter === "open" ? "No open lobbies right now. Publish a battle and invite a friend, or add house bots yourself." : "No active battles match this filter."}</p><button type="button" data-create-battle>CREATE A BATTLE →</button></div>`;
  }
  function renderRoom(force = false) {
    const room = $("#online-room");
    room.hidden = !selected;
    document.body.classList.toggle("online-battle-focus", currentMode === "online" && Boolean(selected));
    if (presentation?.id !== selected?.id) {
      presentation?.controller?.abort();
      // Already-revealed rounds on first entry/reconnect are history, not a replay queue.
      presentation = selected
        ? { id: selected.id, revealed: selected.rounds.length, controller: null, balance: user?.balance, settlementDismissed: false }
        : null;
    }
    if (!selected) return;
    const view = presentation;
    if (currentMode !== "online" || document.hidden || reducedMotion.matches) {
      view.controller?.abort();
      view.controller = null;
      view.revealed = selected.rounds.length;
    }
    // Polls and account refreshes must not replace a moving reel.
    if (view.controller) return;
    if (selected.state !== "settled") view.balance = user?.balance;
    const round = selected.rounds[view.revealed];
    if (!round) {
      paintRoom(selected, null, force);
      return;
    }
    const controller = new AbortController();
    view.controller = controller;
    const snapshot = {
      ...selected,
      state: "running",
      rounds: selected.rounds.slice(0, view.revealed),
      pot: undefined,
      payouts: undefined,
      winningTeams: undefined,
    };
    paintRoom(snapshot, round, true);
    (async () => {
      try {
        await animateRound(room, snapshot, round, controller.signal);
        if (controller.signal.aborted) return;
        view.revealed++;
      } catch (error) {
        if (!controller.signal.aborted) {
          view.revealed = selected.rounds.length;
          message("Opening animation interrupted. Showing server results.", true);
          console.error(error);
        }
      } finally {
        if (!controller.signal.aborted && presentation === view) {
          view.controller = null;
          renderRoom(true);
        }
      }
    })();
  }
  function paintRoom(b, opening = null, force = false) {
    const room = $("#online-room"),
      signature = JSON.stringify([b, user?.id, opening?.index, presentation.settlementDismissed]);
    if (!force && roomSignature === signature) return;
    roomSignature = signature;
    const focusKey = room.contains(document.activeElement)
      ? document.activeElement.dataset.focus
      : null;
    const host = user?.id === b.hostId,
      member = b.players.find((p) => !p.bot && p.id === user?.id);
    const slots = b.teams.flat().length;
    room.dataset.state = b.state;
    room.dataset.opening = opening ? String(opening.index) : "";
    const arena = b.state === "running" || b.state === "settled";
    room.classList.toggle("battle-focus", arena);
    room.classList.toggle("online-arena", arena);
    const historyHtml = b.rounds.length ? `<details class="online-history"><summary>INSPECT ROUND HISTORY & SETTLEMENT</summary>${b.rounds.map((r) => `<section><h3>ROUND ${r.index + 1} · ${esc(itemFor(r.caseId)?.name || r.caseId)}</h3>${r.results.map((result) => `<p><b>${esc(b.players.find((p) => p.seat === result.seat)?.name)}</b><span>${result.number.toLocaleString()} · ${esc(result.name)} · ${result.score.toLocaleString()} EP · ${money(result.payout)} CR</span></p>`).join("")}</section>`).join("")}<p>Server-generated results. Tied winning teams split the pot; whole-cent remainders go to winning seats in team order. House-bot shares are not credited to players.</p></details>` : "";
    if (arena) {
      const displayUser = user && b.state === "running" ? { ...user, balance: presentation.balance ?? user.balance } : user;
      room.innerHTML = renderBattle(b, opening, displayUser, !presentation.settlementDismissed) + historyHtml;
    } else room.innerHTML = `<header class="online-room-heading"><div><p class="kicker">${esc(b.mode.toUpperCase())} · ${esc(b.format.toUpperCase())} · ${esc(b.speed.toUpperCase())}</p><h2>${b.state === "waiting" ? (member ? "YOUR SEAT IS WAITING" : "PICK YOUR TEAM") : "LOBBY CLOSED"}</h2><p>${esc(modeCopy[b.mode])} · ${money(b.entry)} CR entry per seat</p></div><button type="button" data-room-action="close" data-focus="close">BACK TO FEED</button></header>
      <div class="online-room-meta"><span>${b.players.length}/${slots} SEATS FILLED</span><span>${b.caseIds.length} ROUNDS</span><button type="button" data-room-action="share" data-focus="share">COPY INVITE LINK ↗</button></div>
      <div class="online-sequence" aria-label="Battle case sequence">${b.caseIds.map((id, i) => `<span title="${esc(itemFor(id)?.name || id)}">${i + 1}. ${esc(itemFor(id)?.name || id)}</span>`).join("")}</div>
      <div class="online-teams">${b.teams.map((seats, team) => {
        const letter = String.fromCharCode(65 + team);
        const open = seats.find((seat) => !b.players.some((p) => p.seat === seat));
        const mine = member && seats.includes(member.seat);
        const seatCards = seats.map((seat) => {
          const player = b.players.find((p) => p.seat === seat);
          return `<article class="online-seat ${player ? "occupied" : "vacant"}"><div class="online-avatar${player && !player.bot ? " has-look" : ""}">${player ? (player.bot ? "◇" : avatarMarkup(player.look, player.name, 45)) : "+"}</div><h3>${esc(player?.name || "Open seat")}${player?.id === user?.id && user ? " <em>YOU</em>" : ""}</h3><small class="online-seat-kind">${player?.bot ? "HOUSE BOT" : player ? "PLAYER" : "WAITING FOR A PLAYER"}</small>
          ${b.state === "waiting" && !player ? `<div class="online-seat-actions">${!member ? `<button type="button" data-room-action="join" data-seat="${seat}" data-focus="join-${seat}">SIT HERE · ${money(b.entry)} CR</button>` : ""}${host ? `<button type="button" data-room-action="bot" data-seat="${seat}" data-focus="bot-${seat}">+ ADD BOT</button>` : ""}</div>` : ""}
          ${b.state === "waiting" && host && player?.bot ? `<button type="button" class="online-remove-bot" data-room-action="remove-bot" data-seat="${seat}" data-focus="remove-${seat}">REMOVE BOT</button>` : ""}</article>`;
        }).join("");
        const join = b.state === "waiting" && !member && open !== undefined
          ? `<button type="button" class="online-team-join" data-room-action="join" data-seat="${open}" data-focus="team-${team}">JOIN TEAM ${letter} <span>${money(b.entry)} CR</span></button>`
          : mine ? `<span class="online-team-yours">✓ YOU'RE ON TEAM ${letter}</span>` : open === undefined ? `<span class="online-team-full">TEAM FULL</span>` : "";
        return `${team ? `<div class="online-vs" aria-hidden="true">VS</div>` : ""}<section class="online-team ${mine ? "mine" : ""}" style="--team:${TEAM_COLORS[team % TEAM_COLORS.length]};--team-size:${seats.length}"><header><b>TEAM ${letter}</b><span>${seats.filter((seat) => b.players.some((p) => p.seat === seat)).length}/${seats.length} SEATED</span></header><div class="online-team-seats">${seatCards}</div>${join}</section>`;
      }).join("")}</div>
      <div class="online-room-actions">${b.state === "waiting" ? (host ? `<span class="online-autostart">Starts automatically when every seat is filled · ${b.players.length}/${slots}</span><button type="button" data-room-action="cancel" data-focus="cancel">CANCEL & REFUND EVERYONE</button>` : member ? '<button type="button" data-room-action="leave" data-focus="leave">LEAVE & REFUND MY SEAT</button>' : "<span>Sign in, choose a team, and join an open seat.</span>") : "<p>All reserved human entries were refunded.</p>"}</div>
      ${b.state === "waiting" ? `<p class="online-footnote">Waiting lobby expires at ${new Date(b.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Leaving this page does not cancel your seat. Reconnect from your account.</p>` : ""}
      ${historyHtml}`;
    if (focusKey)
      room
        .querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)
        ?.focus({ preventScroll: true });
    document.body.dataset.onlineState = b.state;
  }
  async function viewBattle(id) {
    if (navigate("online") === false) return;
    await action(async () => {
      selected = (await api(`/battles/${encodeURIComponent(id)}`)).battle;
      renderRoom(true);
      const url = new URL(location.href);
      url.searchParams.set("battle", id);
      history.replaceState(null, "", url);
      $("#online-room").scrollIntoView({ behavior: "instant", block: "start" });
    });
  }
  async function refresh(force = false) {
    if (fetching || (!force && (paused || document.hidden))) return;
    fetching = true;
    const epoch = requestEpoch,
      selectedId = selected?.id;
    try {
      const result = await api("/battles");
      const me = token ? await api("/me") : null;
      const room = selectedId ? await api(`/battles/${selectedId}`) : null;
      if (epoch !== requestEpoch || selectedId !== selected?.id) return;
      battles = result.battles;
      online = true;
      if (me) {
        user = me.user;
        activeBattleId = me.activeBattleId;
        renderAccount();
      }
      if (room) selected = room.battle;
      const waiting = battles.filter((b) => b.state === "waiting").length,
        running = battles.filter((b) => b.state === "running").length;
      $("#network-status").textContent =
        `${waiting} OPEN · ${running} RUNNING BATTLES`;
      network.dataset.connected = "true";
      renderList(force);
      renderRoom();
      message(
        paused
          ? "Updates paused. Server-side battles continue; refresh when ready."
          : `Connected · updated ${new Date(result.serverTime).toLocaleTimeString()} · ${activeBattleId ? "Your active seat is reserved." : "Public lobbies, no simulated activity."}`,
      );
    } catch (error) {
      online = false;
      network.dataset.connected = "false";
      $("#network-status").textContent = "ARENA DISCONNECTED · RETRY";
      message(error.message, true);
    } finally {
      fetching = false;
    }
  }
  async function action(callback) {
    if (busy) return;
    busy = true;
    requestEpoch++;
    panel.setAttribute("aria-busy", "true");
    publishStatus.textContent = "";
    try {
      await callback();
    } catch (error) {
      message(error.message, true);
      publishStatus.textContent = error.message;
      $("#account-status").textContent = error.message;
      if (error.battleId) {
        selected =
          (await api(`/battles/${error.battleId}`).catch(() => ({}))).battle ||
          selected;
        navigate("online");
        renderRoom(true);
      }
    } finally {
      busy = false;
      panel.removeAttribute("aria-busy");
    }
  }
  async function connect() {
    try {
      config = await api("/config");
      await refresh(true);
      renderAccount();
      if (requestedBattle && !selected) await viewBattle(requestedBattle);
    } catch (error) {
      message(error.message, true);
      $("#network-status").textContent =
        "ONLINE NOT CONFIGURED · PRACTICE AVAILABLE";
    }
  }
  $("#account-button").onclick = openAccount;
  dialog.querySelector(".account-close").onclick = () => dialog.close();
  $("#network-lobby").onclick = () => {
    navigate("online");
    if (!config) connect();
  };
  $("#online-create").onclick = () => navigate("duel");
  $("#online-pause").onclick = () => {
    paused = !paused;
    requestEpoch++;
    $("#online-pause").setAttribute("aria-pressed", String(paused));
    $("#online-pause").textContent = paused
      ? "RESUME UPDATES"
      : "PAUSE UPDATES";
    message(
      paused
        ? "Updates paused. Battles continue on the server."
        : "Resuming updates…",
    );
    if (!paused) refresh(true);
  };
  $("#online-refresh").onclick = () => (config ? refresh(true) : connect());
  panel.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.filter) {
      filter = button.dataset.filter;
      panel
        .querySelectorAll("[data-filter]")
        .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      renderList(true);
    }
    if (button.dataset.viewBattle) viewBattle(button.dataset.viewBattle);
    if (button.hasAttribute("data-create-battle")) navigate("duel");
    const command = button.dataset.roomAction;
    if (!command) return;
    if (command === "refresh") {
      refresh(true);
      return;
    }
    if (command === "results" || command === "settlement") {
      presentation.settlementDismissed = command === "results";
      $("#online-room .battle-winner-banner").hidden = presentation.settlementDismissed;
      return;
    }
    if (command === "close") {
      selected = null;
      renderRoom();
      delete document.body.dataset.onlineState;
      const url = new URL(location.href);
      url.searchParams.delete("battle");
      history.replaceState(null, "", url);
      return;
    }
    if (command === "build" || command === "collection") {
      navigate(command === "build" ? "duel" : "store");
      return;
    }
    if (command === "share") {
      action(async () => {
        const url = new URL(location.href);
        url.searchParams.set("battle", selected.id);
        await navigator.clipboard.writeText(url.href);
        message("Invite link copied. Send it to another player.");
      });
      return;
    }
    if (!user) {
      openAccount();
      return;
    }
    action(async () => {
      selected = (
        await api(
          `/battles/${selected.id}/${command}`,
          button.dataset.seat === undefined
            ? {}
            : { seat: Number(button.dataset.seat) },
        )
      ).battle;
      renderRoom(true);
      await refresh(true);
    });
  });
  publish.onclick = () => {
    if (!user) {
      openAccount();
      return;
    }
    action(async () => {
      const selection = getBattleSelection();
      if (!selection.caseIds.length || selection.caseIds.length > 20)
        throw new Error("Select between 1 and 20 cases to publish online.");
      const signature = JSON.stringify(selection);
      if (!pendingCreate || pendingCreate.signature !== signature)
        pendingCreate = { signature, requestId: crypto.randomUUID() };
      selected = (
        await api("/battles", {
          ...selection,
          requestId: pendingCreate.requestId,
        })
      ).battle;
      pendingCreate = null;
      navigate("online");
      filter = "all";
      panel
        .querySelectorAll("[data-filter]")
        .forEach((b) =>
          b.setAttribute("aria-pressed", String(b.dataset.filter === filter)),
        );
      renderRoom(true);
      const url = new URL(location.href);
      url.searchParams.set("battle", selected.id);
      history.replaceState(null, "", url);
      await refresh(true);
    });
  };
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(
      async () => {
        if (config && !busy) await refresh();
        schedule();
      },
      selected?.state === "running" && currentMode === "online" ? 1500 : 5000,
    );
  }
  document.addEventListener("visibilitychange", () => {
    renderRoom();
    if (!document.hidden && config) refresh();
  });
  reducedMotion.addEventListener("change", () => renderRoom(true));
  connect();
  schedule();
  return {
    setMode(mode) {
      currentMode = mode;
      renderRoom();
      if (mode === "online" && config) refresh();
    },
    get online() {
      return online;
    },
    account: {
      api,
      stream,
      getUser: () => user,
      onUser(callback) { userListeners.add(callback); callback(user); return () => userListeners.delete(callback); },
      openAccount,
      setUser(nextUser) { user = nextUser; renderAccount(); userListeners.forEach((callback) => callback(user)); },
      /** Balance to display (honours an active reveal hold). */
      displayBalance: shownBalance,
      /** Pins the displayed balance until called again with null (e.g. after a card reveal finishes). */
      holdBalance(value) {
        heldBalance = value;
        renderAccount();
        userListeners.forEach((callback) => callback(user));
      },
    },
  };
}

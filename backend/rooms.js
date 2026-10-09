// Multiplayer rooms: a shared lobby (public feed or private join-by-code) for table games such as
// coinflip, blackjack, poker and russian roulette. Each game is an engine (backend/rooms/<game>.js)
// that owns its rules; this module owns seats, money movements, persistence, timers and views.
//
// Engine contract (see .amp/in/rooms-contract.md for the full description):
//   { id, name, bots, config(body, fail) → config, seatCount(config),
//     joinable(room), async join(room, seat, player, tools), async leave(room, seat, tools) → bool,
//     canStart?(room), async start?(room, tools), async action(room, seat, body, tools),
//     async tick(room, tools), view(room, viewerSeat, at), summary?(room) }
// Engines keep their state in `room.play` and schedule timed work with `room.play.nextAt` (ms epoch);
// tick() runs only when `nextAt <= now`, inside a transaction, so idle rooms never touch the database.
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { fairFloats, sha256Hex } from "../casino-core.js";
import { transaction } from "./store.js";
import { recordPlay } from "./achievements.js";
import { BOT_NAMES } from "./game.js";
import { lookOf } from "./cosmetics.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const WAITING_TTL = 30 * 60_000;
const FINISHED_VISIBLE = 90_000;
const EMPTY_TABLE_TTL = 60_000;
const MAX_HOSTED_OPEN = 5;
// A seated player whose room stream has been closed this long has left the table (tab closed, navigated away).
const PRESENCE_GRACE = 20_000;

export async function createRooms({ db, now, fail, publicUser, engines, timers = true }) {
  const byId = new Map(engines.map((engine) => [engine.id, engine]));
  const games = engines.map((engine) => ({ id: engine.id, name: engine.name }));
  const rooms = new Map();
  const watchers = new Map(); // room id → Set<{ viewerId, write(payload), end() }>
  const presence = new Map(); // `${roomId}:${userId}` → { open: streams, seen: ms } (only for users who opened a stream)
  const wakeups = new Map(); // room id → timeout that advances a watched room exactly when its next event is due
  let queue = Promise.resolve();

  function exclusive(fn) {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  }

  for (const row of (await db.execute("SELECT data FROM rooms WHERE state IN ('waiting','playing','finished')")).rows) {
    const room = JSON.parse(row.data);
    if (byId.has(room.game)) rooms.set(room.id, room);
  }

  const engineOf = (room) => byId.get(room.game);
  const humans = (room) => room.seats.filter((seat) => seat && !seat.bot);
  const seatOf = (room, userId) => room.seats.findIndex((seat) => seat && !seat.bot && seat.userId === userId);

  function makeCode() {
    for (;;) {
      const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
      if (![...rooms.values()].some((room) => room.code === code)) return code;
    }
  }

  function tools(tx, room, at) {
    return {
      now: at,
      fail,
      randomInt,
      async debit(userId, cents) {
        const debit = await tx.execute({ sql: "UPDATE users SET balance_cents=balance_cents-? WHERE id=? AND balance_cents>=?", args: [cents, userId, cents] });
        if (!debit.rowsAffected) throw fail(409, "insufficient_balance", "Not enough online credits.");
      },
      async credit(userId, cents) {
        if (cents > 0) await tx.execute({ sql: "UPDATE users SET balance_cents=balance_cents+? WHERE id=?", args: [cents, userId] });
      },
      /** Records a finished play for profiles/achievements. Amounts in cents. */
      record(userId, wager, payout, extra = {}) {
        return recordPlay(tx, { userId, game: room.game, wager, payout, at, ...extra });
      },
      /** New committed seed: publish `hash` now, reveal `seed` when the round is over. */
      seed() {
        const seed = randomBytes(32).toString("hex");
        return { seed, hash: sha256Hex(seed) };
      },
      floats: (seed, nonce, count) => fairFloats(seed, `number-zero-room-${room.game}`, nonce, count),
      botName() {
        const taken = new Set(room.seats.filter(Boolean).map((seat) => seat.name));
        const names = BOT_NAMES.filter((name) => !taken.has(name));
        return names.length ? names[randomInt(names.length)] : `Bot ${randomInt(1000)}`;
      },
    };
  }

  async function persist(tx, room) {
    await tx.execute({
      sql: "INSERT INTO rooms(id,code,game,visibility,host_id,state,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state, data=excluded.data, updated_at=excluded.updated_at",
      args: [room.id, room.code, room.game, room.visibility, room.hostId, room.state, JSON.stringify(room), room.createdAt, room.updatedAt],
    });
  }

  /** Runs `fn` on a copy of the room inside a transaction; the copy replaces the room only on commit. */
  async function mutate(room, fn) {
    const draft = structuredClone(room);
    const at = now();
    const result = await transaction(db, async (tx) => {
      const t = tools(tx, draft, at);
      const value = await fn(draft, t);
      // Let the engine react straight away (auto-start, bot turns that are due now…).
      const engine = engineOf(draft);
      for (let guard = 0; guard < 20 && draft.state !== "closed" && draft.play?.nextAt != null && draft.play.nextAt <= at; guard++) await engine.tick(draft, t);
      draft.updatedAt = at;
      await persist(tx, draft);
      return value;
    });
    rooms.set(draft.id, draft);
    publish(draft);
    return { room: draft, result };
  }

  /** Pushes the new state to every open stream of the room (each viewer gets their own view). */
  function publish(room) {
    if (room.state === "closed") return; // forget() tells the viewers
    for (const watcher of watchers.get(room.id) || []) watcher.write({ room: snapshot(room, watcher.viewerId), serverTime: now() });
    arm(room);
  }

  /** Drops a room from memory and tells its viewers it is gone. */
  function forget(room) {
    rooms.delete(room.id);
    clearTimeout(wakeups.get(room.id));
    wakeups.delete(room.id);
    for (const watcher of watchers.get(room.id) || []) {
      watcher.write({ closed: true, serverTime: now() });
      watcher.end();
    }
    watchers.delete(room.id);
    for (const key of presence.keys()) if (key.startsWith(`${room.id}:`)) presence.delete(key);
  }

  /** Watched rooms advance on their own exactly when due, so streams see bot moves and timers without polling. */
  function arm(room) {
    clearTimeout(wakeups.get(room.id));
    wakeups.delete(room.id);
    if (!timers || !watchers.get(room.id)?.size || room.state === "closed") return;
    const due = room.state === "finished" ? room.updatedAt + FINISHED_VISIBLE : room.play?.nextAt;
    if (due == null) return;
    const wake = setTimeout(() => {
      exclusive(async () => {
        const current = rooms.get(room.id);
        if (!current) return;
        // advance() re-arms through publish() when it changes the room; otherwise check again later.
        if ((await advance(current)) === current && rooms.get(room.id) === current) arm(current);
      }).catch((error) => console.error("Room wakeup failed", error.message));
    }, Math.max(50, due - now() + 10));
    wake.unref?.();
    wakeups.set(room.id, wake);
  }

  function touch(room, userId) {
    const entry = userId == null ? null : presence.get(`${room.id}:${userId}`);
    if (entry) entry.seen = now();
  }

  /** True only for players known to have left: they streamed this room before and no stream has been open for a while. */
  function absent(room, userId) {
    const entry = presence.get(`${room.id}:${userId}`);
    return Boolean(entry) && entry.open === 0 && now() - entry.seen > PRESENCE_GRACE;
  }

  async function closeRoom(room, t) {
    const engine = engineOf(room);
    for (let seat = 0; seat < room.seats.length; seat++) if (room.seats[seat]) await engine.leave(room, seat, t, { closing: true });
    room.seats = room.seats.map(() => null);
    room.state = "closed";
  }

  /** Advances timers, expires stale lobbies and forgets old finished rooms. */
  async function advance(room) {
    const at = now();
    if (room.state === "closed") return room;
    if (room.state === "finished") {
      const seated = humans(room);
      if (at - room.updatedAt > FINISHED_VISIBLE || !seated.length || seated.every((seat) => absent(room, seat.userId))) forget(room);
      return room;
    }
    const engine = engineOf(room);
    const seated = humans(room);
    // Players who closed the page or walked off to another game no longer count as being at the table.
    const gone = room.state === "playing" && engine.closeWhilePlaying === false ? [] : seated.filter((seat) => absent(room, seat.userId));
    const stale =
      (room.state === "waiting" && at - room.createdAt > WAITING_TTL && !seated.some((seat) => seat.joinedAt > at - WAITING_TTL)) ||
      (!seated.length && at - room.updatedAt > EMPTY_TABLE_TTL) ||
      (seated.length > 0 && gone.length === seated.length);
    if (stale) {
      const { room: closed } = await mutate(room, (draft, t) => closeRoom(draft, t));
      forget(closed);
      return closed;
    }
    // Some (not all) players walked away: free their seats where the game allows it.
    for (const seat of gone) {
      try {
        ({ room } = await mutate(room, async (draft, t) => {
          const index = seatOf(draft, seat.userId);
          if (index < 0) return;
          await engine.leave(draft, index, t, {});
          draft.seats[index] = null;
        }));
      } catch {
        // Russian roulette forbids leaving mid-game; its turn timer plays for them instead.
      }
    }
    if (room.play?.nextAt != null && room.play.nextAt <= at) return (await mutate(room, () => {})).room;
    return room;
  }

  function snapshot(room, viewerId) {
    const engine = engineOf(room);
    const viewerSeat = viewerId == null ? -1 : seatOf(room, viewerId);
    return {
      id: room.id,
      code: room.code,
      game: room.game,
      name: engine.name,
      visibility: room.visibility,
      state: room.state,
      hostId: String(room.hostId),
      hostName: room.hostName,
      config: room.config,
      seats: room.seats.map((seat, index) => seat && { seat: index, name: seat.name, bot: Boolean(seat.bot), look: seat.look || null, userId: seat.userId == null ? null : String(seat.userId) }),
      you: viewerSeat,
      createdAt: room.createdAt,
      play: engine.view(room, viewerSeat, now()),
    };
  }

  function summary(room) {
    const engine = engineOf(room);
    return {
      id: room.id,
      code: room.visibility === "public" ? room.code : null,
      game: room.game,
      name: engine.name,
      state: room.state,
      hostName: room.hostName,
      config: room.config,
      seats: room.seats.map((seat) => seat && { name: seat.name, bot: Boolean(seat.bot), look: seat.look || null }),
      joinable: room.state !== "closed" && engine.joinable(room) && room.seats.some((seat) => !seat),
      detail: engine.summary ? engine.summary(room) : null,
      createdAt: room.createdAt,
    };
  }

  function find(idOrCode) {
    const key = String(idOrCode || "");
    const room = rooms.get(key) || [...rooms.values()].find((entry) => entry.code === key.toUpperCase());
    if (!room) throw fail(404, "room_not_found", "That room does not exist or has closed.");
    return room;
  }

  async function withUser(payload, user) {
    if (!user) return payload;
    const row = (await db.execute({ sql: "SELECT * FROM users WHERE id=?", args: [user.id] })).rows[0];
    return { ...payload, user: publicUser(row) };
  }

  return {
    games,

    list(game) {
      return exclusive(async () => {
        for (const room of [...rooms.values()]) await advance(room);
        const rows = [...rooms.values()]
          // Finished games drop off the feed straight away; only tables you can join or watch live are listed.
          .filter((room) => room.visibility === "public" && (room.state === "waiting" || room.state === "playing") && (!game || room.game === game))
          .sort((a, b) => (a.state === "playing") - (b.state === "playing") || b.createdAt - a.createdAt)
          .slice(0, 100)
          .map(summary);
        return { rooms: rows, games, serverTime: now() };
      });
    },

    get(idOrCode, viewer) {
      return exclusive(async () => {
        const room = await advance(find(idOrCode));
        touch(room, viewer?.id);
        return { room: snapshot(room, viewer?.id), serverTime: now() };
      });
    },

    /**
     * Live stream of a room: `write(payload)` gets `{ room, serverTime }` now and after every change, then
     * `{ closed: true }` (followed by `end()`) when the room goes away. Resolves to `stop()`.
     * An open stream is what keeps a seated player "at the table".
     */
    watch(idOrCode, viewer, write, end) {
      return exclusive(async () => {
        const room = await advance(find(idOrCode));
        if (room.state === "closed" || !rooms.has(room.id)) throw fail(404, "room_not_found", "That room does not exist or has closed.");
        const watcher = { viewerId: viewer?.id ?? null, write, end };
        if (!watchers.has(room.id)) watchers.set(room.id, new Set());
        watchers.get(room.id).add(watcher);
        const key = viewer ? `${room.id}:${viewer.id}` : null;
        if (key) {
          const entry = presence.get(key) || { open: 0, seen: 0 };
          entry.open++;
          entry.seen = now();
          presence.set(key, entry);
        }
        write({ room: snapshot(room, watcher.viewerId), serverTime: now() });
        arm(room);
        let stopped = false;
        return () => {
          if (stopped) return;
          stopped = true;
          const set = watchers.get(room.id);
          set?.delete(watcher);
          if (set && !set.size) {
            watchers.delete(room.id);
            clearTimeout(wakeups.get(room.id));
            wakeups.delete(room.id);
          }
          const entry = key && presence.get(key);
          if (entry) {
            entry.open = Math.max(0, entry.open - 1);
            entry.seen = now();
          }
        };
      });
    },

    create(user, body) {
      return exclusive(async () => {
        const engine = byId.get(body.game);
        if (!engine) throw fail(400, "invalid_game", "Choose a game for the room.");
        if (!["public", "private"].includes(body.visibility)) throw fail(400, "invalid_visibility", "Rooms are public or private.");
        const config = engine.config(body.config || {}, fail);
        const hosted = [...rooms.values()].filter((room) => room.hostId === user.id && room.state === "waiting").length;
        if (hosted >= MAX_HOSTED_OPEN) throw fail(409, "too_many_rooms", `You can host at most ${MAX_HOSTED_OPEN} open rooms.`);
        const at = now();
        const room = {
          id: randomUUID(),
          code: makeCode(),
          game: engine.id,
          visibility: body.visibility,
          state: "waiting",
          hostId: user.id,
          hostName: user.name,
          config,
          seats: Array.from({ length: engine.seatCount(config) }, () => null),
          play: null,
          createdAt: at,
          updatedAt: at,
        };
        if (engine.init) engine.init(room);
        const { room: created } = await mutate(room, async (draft, t) => {
          const player = { userId: user.id, name: user.name, look: lookOf(user), bot: false, joinedAt: at };
          await engine.join(draft, 0, player, t, body);
          draft.seats[0] = player;
        });
        return withUser({ room: snapshot(created, user.id), serverTime: now() }, user);
      });
    },

    act(user, idOrCode, action, body) {
      return exclusive(async () => {
        let room = await advance(find(idOrCode));
        const engine = engineOf(room);
        if (room.state === "closed") throw fail(409, "room_closed", "This room has closed.");
        touch(room, user.id);
        const host = room.hostId === user.id;
        const mine = seatOf(room, user.id);
        ({ room } = await mutate(room, async (draft, t) => {
          if (action === "join" || action === "bot") {
            const seat = Number.isInteger(body.seat) ? body.seat : draft.seats.findIndex((entry) => !entry);
            if (seat < 0 || seat >= draft.seats.length) throw fail(409, "room_full", "Every seat is taken.");
            if (draft.seats[seat]) throw fail(409, "seat_taken", "That seat is taken.");
            if (!engine.joinable(draft)) throw fail(409, "not_joinable", "You cannot join this room right now.");
            let player;
            if (action === "bot") {
              if (!host) throw fail(403, "host_only", "Only the host can add bots.");
              if (!engine.bots) throw fail(409, "no_bots", "This game has no house bots.");
              player = { userId: null, name: t.botName(), look: null, bot: true, joinedAt: t.now };
            } else {
              if (mine >= 0) throw fail(409, "already_seated", "You already have a seat in this room.");
              player = { userId: user.id, name: user.name, look: lookOf(user), bot: false, joinedAt: t.now };
            }
            await engine.join(draft, seat, player, t, body);
            draft.seats[seat] = player;
          } else if (action === "leave" || action === "kick") {
            const seat = action === "leave" ? mine : body.seat;
            if (action === "kick" && (!host || !draft.seats[seat]?.bot)) throw fail(403, "host_only", "Only the host can remove bots.");
            if (!Number.isInteger(seat) || seat < 0 || !draft.seats[seat]) throw fail(409, "not_seated", "You are not seated in this room.");
            await engine.leave(draft, seat, t, {});
            draft.seats[seat] = null;
            // The last human out closes the table: bots never keep a room alive on their own.
            if (!humans(draft).length) await closeRoom(draft, t);
          } else if (action === "start") {
            if (!host) throw fail(403, "host_only", "Only the host can start.");
            if (draft.state !== "waiting" || !engine.canStart?.(draft)) throw fail(409, "cannot_start", "Not enough players to start yet.");
            await engine.start(draft, t);
          } else if (action === "close") {
            if (!host) throw fail(403, "host_only", "Only the host can close the room.");
            if (draft.state === "playing" && engine.closeWhilePlaying === false) throw fail(409, "in_progress", "Finish the round before closing.");
            await closeRoom(draft, t);
          } else if (action === "act") {
            if (mine < 0) throw fail(403, "not_seated", "Take a seat to play.");
            await engine.action(draft, mine, body, t);
          } else throw fail(404, "not_found", "Unknown room action.");
        }));
        if (room.state === "closed") forget(room);
        return withUser({ room: snapshot(room, user.id), serverTime: now() }, user);
      });
    },

    maintenance() {
      return exclusive(async () => {
        for (const room of [...rooms.values()]) await advance(room);
      });
    },

    /** Ends every stream and wakeup timer (server shutdown). */
    shutdown() {
      for (const wake of wakeups.values()) clearTimeout(wake);
      wakeups.clear();
      for (const set of watchers.values()) for (const watcher of set) watcher.end();
      watchers.clear();
    },
  };
}

import { createClient } from "@libsql/client/web";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { createLocalClient } from "./sqlite.js";

export async function openStore(filename, { url, authToken } = {}) {
  if (
    (authToken && !url) ||
    (url && (!url.startsWith("libsql://") || !authToken))
  )
    throw new Error("Turso requires a libsql:// URL and TURSO_AUTH_TOKEN");
  if (!url && filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true });
  const db = url
    ? createClient({
        url,
        authToken,
        intMode: "number",
      })
    : createLocalClient(filename);
  try {
    await db.execute("PRAGMA foreign_keys=ON");
    await db.batch(
      [
        "CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, google_sub TEXT UNIQUE, name TEXT NOT NULL, balance_cents INTEGER NOT NULL, battles_played INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, daily_day TEXT)",
        "CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)",
        "CREATE TABLE IF NOT EXISTS battles(id TEXT PRIMARY KEY, host_id INTEGER NOT NULL REFERENCES users(id), request_id TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(host_id,request_id))",
        "CREATE INDEX IF NOT EXISTS battle_state ON battles(state)",
        "CREATE TABLE IF NOT EXISTS fair_seeds(user_id INTEGER PRIMARY KEY REFERENCES users(id), server_seed TEXT NOT NULL, client_seed TEXT NOT NULL, nonce INTEGER NOT NULL DEFAULT 0, previous TEXT)",
        "CREATE TABLE IF NOT EXISTS casino_rounds(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), game TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
        "CREATE INDEX IF NOT EXISTS casino_round_user_game_status ON casino_rounds(user_id,game,status)",
        "CREATE INDEX IF NOT EXISTS casino_round_game_status ON casino_rounds(game,status)",
        "CREATE TABLE IF NOT EXISTS plays(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), game TEXT NOT NULL, wager_cents INTEGER NOT NULL, payout_cents INTEGER NOT NULL, multiplier REAL NOT NULL, created_at INTEGER NOT NULL)",
        "CREATE INDEX IF NOT EXISTS plays_user ON plays(user_id)",
        "CREATE INDEX IF NOT EXISTS plays_created ON plays(created_at)",
        "CREATE TABLE IF NOT EXISTS achievements(user_id INTEGER NOT NULL REFERENCES users(id), id TEXT NOT NULL, unlocked_at INTEGER NOT NULL, PRIMARY KEY(user_id,id))",
        "CREATE TABLE IF NOT EXISTS live_rounds(id TEXT PRIMARY KEY, seed TEXT NOT NULL, seed_hash TEXT NOT NULL, crash_point REAL NOT NULL, betting_ends_at INTEGER NOT NULL, started_at INTEGER NOT NULL, crashed_at INTEGER, settled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS live_bets(round_id TEXT NOT NULL REFERENCES live_rounds(id), user_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL, wager_cents INTEGER NOT NULL, auto_cashout REAL, cashed_at REAL, payout_cents INTEGER NOT NULL DEFAULT 0, settled INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(round_id,user_id))",
        "CREATE INDEX IF NOT EXISTS live_bets_round ON live_bets(round_id)",
        "CREATE TABLE IF NOT EXISTS live_roulette_rounds(id TEXT PRIMARY KEY, seed TEXT NOT NULL, seed_hash TEXT NOT NULL, slot INTEGER NOT NULL, betting_ends_at INTEGER NOT NULL, settled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS live_roulette_bets(round_id TEXT NOT NULL REFERENCES live_roulette_rounds(id), user_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL, color TEXT NOT NULL, wager_cents INTEGER NOT NULL, PRIMARY KEY(round_id,user_id,color))",
        "CREATE TABLE IF NOT EXISTS coinflips(id TEXT PRIMARY KEY, creator_id INTEGER NOT NULL REFERENCES users(id), state TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
        "CREATE INDEX IF NOT EXISTS coinflips_state ON coinflips(state, updated_at)",
        "CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, code TEXT NOT NULL, game TEXT NOT NULL, visibility TEXT NOT NULL, host_id INTEGER NOT NULL REFERENCES users(id), state TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
        "CREATE INDEX IF NOT EXISTS rooms_state ON rooms(state)",
      ],
      "write",
    );
    // Equipped cosmetics (profile picture, frame, name colour, title); added to existing databases on boot.
    const columns = new Set((await db.execute("PRAGMA table_info(users)")).rows.map((row) => row.name));
    for (const column of ["avatar", "frame", "name_color", "title"])
      if (!columns.has(column)) await db.execute(`ALTER TABLE users ADD COLUMN ${column} TEXT`);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

// Serialize this instance's writers; the database write transaction also protects
// against other connections. A failed request must not poison the queue.
const writers = new WeakMap();
export function transaction(db, fn) {
  const result = (writers.get(db) || Promise.resolve()).then(async () => {
    const tx = await db.transaction("write");
    try {
      const value = await fn(tx);
      await tx.commit();
      return value;
    } catch (error) {
      try {
        await tx.rollback();
      } catch {}
      throw error;
    } finally {
      tx.close();
    }
  });
  writers.set(
    db,
    result.catch(() => {}),
  );
  return result;
}

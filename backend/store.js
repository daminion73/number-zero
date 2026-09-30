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
      ],
      "write",
    );
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

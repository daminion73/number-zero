import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server.js";

export const START = 10_000_000; // 100,000 CR in cents

/** Boots a server on a temp database with a controllable clock. Shared by room-game tests. */
export async function roomFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "number-zero-rooms-"));
  let time = Date.UTC(2026, 9, 8, 12);
  const options = { env: { DEV_AUTH: "1" }, dbPath: join(directory, "rooms.sqlite"), noTimer: true, now: () => time };
  let server, base;
  async function start() {
    server = await createServer(options);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    await new Promise((resolve) => server.close(resolve));
    await server.closeDatabase();
  }
  await start();
  t.after(async () => {
    await stop();
    await rm(directory, { recursive: true, force: true });
  });
  async function request(path, body, token) {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  }
  const f = {
    request,
    base: () => base,
    advance: (ms) => (time += Math.ceil(ms)),
    tick: () => server.tick(),
    restart: async () => {
      await stop();
      await start();
    },
    async login(name) {
      return (await request("/api/auth/dev", { name })).data.token;
    },
    async balanceCents(token) {
      return Math.round((await request("/api/me", undefined, token)).data.user.balance * 100);
    },
    /** Wallet (+ stakes still held in open rooms) = start + Σ(payout − wager) over recorded plays + achievement rewards (in credits). */
    async assertConserved(token, heldCents = 0) {
      const profile = (await request("/api/profile", undefined, token)).data.profile;
      const rewards = profile.achievements.filter((a) => a.unlocked).reduce((sum, a) => sum + (a.reward || 0) * 100, 0);
      assert.equal((await f.balanceCents(token)) + heldCents, START + Math.round(profile.totals.net * 100) + rewards);
    },
    create: (token, game, config, visibility = "public") => request("/api/rooms", { game, visibility, config }, token),
    act: (token, id, action, body = {}) => request(`/api/rooms/${id}/${action}`, body, token),
    room: (id, token) => request(`/api/rooms/${id}`, undefined, token),
  };
  return f;
}

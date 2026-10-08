import assert from "node:assert/strict";
import { test } from "node:test";
import { coinflipResult, sha256Hex } from "../casino-core.js";
import { roomFixture } from "./room-fixture.js";

test("coinflip rooms: public feed, private codes, countdown flip, payouts and refunds", async (t) => {
  const f = await roomFixture(t);
  const a = await f.login("Alpha");
  const b = await f.login("Bravo");
  assert.equal((await f.create(undefined, "coinflip", { stake: 100, side: "heads" })).status, 401);
  assert.equal((await f.create(a, "coinflip", { stake: 100, side: "edge" })).status, 400);
  assert.equal((await f.create(a, "nope", {})).status, 400);

  const created = await f.create(a, "coinflip", { stake: 500, side: "heads" });
  assert.equal(created.status, 201);
  const room = created.data.room;
  assert.equal(room.state, "waiting");
  assert.equal(room.you, 0);
  assert.match(room.code, /^[A-Z2-9]{6}$/);
  assert.ok(room.play.seedHash);
  assert.equal(room.play.seed, null);
  assert.equal(created.data.user.balance, 99_500);
  const feed = (await f.request("/api/rooms?game=coinflip")).data;
  assert.equal(feed.rooms[0].id, room.id);
  assert.ok(feed.games.some((game) => game.id === "poker"));

  const hidden = (await f.create(b, "coinflip", { stake: 100, side: "tails" }, "private")).data.room;
  assert.equal((await f.request("/api/rooms")).data.rooms.some((entry) => entry.id === hidden.id), false, "private rooms stay off the feed");
  assert.equal((await f.room(hidden.code.toLowerCase())).data.room.id, hidden.id, "join by code (case-insensitive)");

  const joined = (await f.act(b, room.code, "join")).data.room;
  assert.equal(joined.state, "playing");
  assert.equal(joined.play.phase, "countdown");
  assert.equal(joined.you, 1);
  assert.equal((await f.act(b, room.id, "leave")).data.error.code, "in_progress");
  f.advance(3_000);
  const done = (await f.room(room.id, a)).data.room;
  assert.equal(done.state, "finished");
  assert.equal(done.play.phase, "flipped");
  assert.equal(sha256Hex(done.play.seed), done.play.seedHash);
  assert.equal(coinflipResult(done.play.seed, room.id), done.play.result);
  assert.equal(done.play.winnerSeat, done.play.result === "heads" ? 0 : 1);
  await f.assertConserved(a);
  await f.assertConserved(b, 10_000); // Bravo still has 100 CR held in the private room

  // Bots fill a seat; leaving or closing an open room refunds the stake.
  const botRoom = (await f.create(a, "coinflip", { stake: 100, side: "tails" })).data.room;
  assert.equal((await f.act(b, botRoom.id, "bot")).status, 403);
  assert.equal((await f.act(a, botRoom.id, "bot")).data.room.play.phase, "countdown");
  f.advance(3_000);
  await f.tick();
  assert.equal((await f.room(botRoom.id)).data.room.state, "finished");
  await f.assertConserved(a);
  const before = await f.balanceCents(b);
  assert.equal((await f.act(b, hidden.id, "close")).status, 200);
  assert.equal(await f.balanceCents(b), before + 10_000);
  assert.equal((await f.room(hidden.id)).status, 404);
});

test("rooms survive a restart mid-countdown and settle exactly once", async (t) => {
  const f = await roomFixture(t);
  const a = await f.login("Alpha");
  const b = await f.login("Bravo");
  const room = (await f.create(a, "coinflip", { stake: 250, side: "heads" })).data.room;
  await f.act(b, room.id, "join");
  await f.restart();
  f.advance(5_000);
  await Promise.all([f.tick(), f.tick()]);
  await f.restart();
  assert.equal((await f.room(room.id)).data.room.play.phase, "flipped");
  await f.assertConserved(a);
  await f.assertConserved(b);
  assert.equal(((await f.balanceCents(a)) + (await f.balanceCents(b))) % 100, 0);
});

test("cosmetics: equip owned items, refuse locked ones, show the look in rooms", async (t) => {
  const f = await roomFixture(t);
  const a = await f.login("Alpha");
  const equip = (kind, id) => f.request("/api/profile/cosmetics", { kind, id }, a);
  const profile = (await f.request("/api/profile", undefined, a)).data.profile;
  assert.ok(profile.cosmetics.items.length >= 60);
  assert.ok(profile.cosmetics.items.filter((item) => item.owned).every((item) => item.source === "default"), "only defaults before any achievement");
  assert.ok(profile.achievements.every((achievement) => achievement.unlocks.length > 0), "every achievement grants a cosmetic");
  assert.equal((await equip("hat", "orb")).status, 400);
  assert.equal((await equip("avatar", "nope")).status, 400);
  assert.equal((await equip("title", "rookie")).data.error.code, "locked");
  const equipped = await equip("avatar", "spade");
  assert.equal(equipped.status, 200);
  assert.equal(equipped.data.user.look.avatar, "spade");
  assert.equal((await f.request("/api/me", undefined, a)).data.user.look.avatar, "spade");

  // First play unlocks "First Chips" → the Rookie title.
  const id = (await f.create(a, "coinflip", { stake: 10, side: "heads" })).data.room.id;
  const seated = (await f.act(a, id, "bot")).data.room;
  assert.equal(seated.seats[0].look.avatar, "spade", "rooms show the equipped profile picture");
  f.advance(10_000);
  await f.room(id);
  const titled = await equip("title", "rookie");
  assert.equal(titled.status, 200);
  assert.equal(titled.data.user.look.titleName, "Rookie");
  assert.equal((await equip("avatar", null)).data.user.look.avatar, null, "unequip");
  await f.restart();
  assert.equal((await f.request("/api/me", undefined, a)).data.user.look.title, "rookie", "persisted across restarts");
});

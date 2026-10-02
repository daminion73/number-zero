import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { createServer } from "../server.js";

const artifacts = process.env.ARTIFACT_DIR || join(import.meta.dirname, "../.amp/in/artifacts");
await mkdir(artifacts, { recursive: true });
const server = await createServer({ dbPath: ":memory:", env: { DEV_AUTH: "1" } });
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const errors = [];
const rounds = [
  { index: 0, caseId: "nano", results: [
    { seat: 0, trait: "luckyseven", name: "Lucky Presence", number: 712345, score: 180, payout: .18, bonus: false },
    { seat: 1, trait: "sixdigits", name: "Six Figure", number: 234568, score: 400, payout: .4, bonus: false },
  ] },
  { index: 1, caseId: "nano", results: [
    { seat: 0, trait: "descending", name: "Downfall", number: 654321, score: 1200, payout: 1.2, bonus: true },
    { seat: 1, trait: "cube", name: "Perfect Cube", number: 343, score: 1600, payout: 1.6, bonus: false },
  ] },
  { index: 2, caseId: "caseception-nested-fortune", results: [
    { seat: 0, trait: "power", name: "Power of Two", number: 65536, score: 2400, payout: 2.4, bonus: true },
    { seat: 1, trait: "devil", name: "Devil Imprint", number: 666, score: 900, payout: .9, bonus: false },
  ] },
];
function battle(speed = "standard") {
  return {
    id: "animation-fixture", hostId: "alpha", state: "running", mode: "share", format: "1", speed,
    teams: [[0], [1]], caseIds: rounds.map((r) => r.caseId), entry: 20, intervalMs: 4000,
    players: [{ id: "alpha", seat: 0, name: "ALPHA", bot: false }, { id: null, seat: 1, name: "HOUSE BOT 2", bot: true }],
    rounds: [],
  };
}
const settlement = { state: "settled", rounds, pot: 6.68, winningTeams: [0, 1], payouts: [{ seat: 0, amount: 3.34 }, { seat: 1, amount: 3.34 }] };
async function fixture({ width = 1440, speed = "standard", reducedMotion = "no-preference" } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1050 }, deviceScaleFactor: 2, reducedMotion });
  const page = await context.newPage();
  let snapshot = battle(speed);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.addInitScript(() => {
    window.landings = [];
    new MutationObserver((records) => {
      for (const { target } of records) {
        if (target.matches?.(".online-case-lane .battle-lane-track article.winner")) {
          window.landings.push([target.closest("[data-opening-seat]").dataset.openingSeat, target.querySelector("strong").textContent]);
        }
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["class"] });
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path === "/api/config" ? { devAuth: false, roundMs: 4000 }
      : path === "/api/battles" ? { battles: [snapshot], serverTime: Date.now() }
      : { battle: snapshot };
    return route.fulfill({ json });
  });
  await page.goto(`${base}/?battle=animation-fixture`);
  await page.locator(`.online-room[data-state="${snapshot.state}"]`).waitFor();
  // Only explicit snapshots drive this test, including delayed/batched polls.
  await page.locator("#online-pause").click();
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 100);
  return {
    page, context,
    update: async (patch, refresh = true) => {
      snapshot = { ...snapshot, ...patch };
      if (refresh) await page.locator("#online-refresh").click();
    },
  };
}
async function advanceUntil(page, selector) {
  for (let step = 0; step < 200; step++) {
    if (await page.locator(selector).count()) return;
    await page.clock.runFor(100);
  }
  assert.fail(`Animation never reached ${selector}`);
}
async function capture(page, name) {
  await page.locator("#online-room").evaluate((room) => room.scrollIntoView({ block: "start", behavior: "instant" }));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "No horizontal overflow");
  await page.screenshot({ path: join(artifacts, name) });
}
try {
  const desktop = await fixture();
  const { page, update } = desktop;
  await update({ rounds: [rounds[0]] });
  await advanceUntil(page, '.online-room[data-opening="0"] .battle-lane-track.rolling');
  const track = await page.locator(".online-case-lane .battle-lane-track").first().elementHandle();
  const before = await track.evaluate((el) => getComputedStyle(el).transform);
  await page.waitForTimeout(150);
  assert.notEqual(await track.evaluate((el) => getComputedStyle(el).transform), before, "Reel physically moves, not just a class toggle");
  assert.equal(await page.locator(".online-reveal strong, .online-payout, .online-history section").count(), 0, "No premature number, payout, or history");
  await update(settlement);
  assert.equal(await track.evaluate((el) => el.isConnected), true, "A newer settled snapshot must not replace the moving reel");
  assert.equal(await page.locator("#online-room").getAttribute("data-state"), "running");
  await capture(page, "battle-opening-desktop.png");
  await advanceUntil(page, '.online-room[data-opening="1"] [data-phase="bonus"]');
  assert.equal(await page.locator('[data-phase="bonus"]').count(), 1, "Only the triggering player gets a bonus spin");
  assert.match(await page.locator('[data-phase="bonus"] .online-spin-label').innerText(), /GOLD COIN/);
  await capture(page, "battle-opening-gold.png");
  await advanceUntil(page, '.online-room[data-opening="2"] [data-phase="bonus"]');
  assert.match(await page.locator('[data-phase="bonus"] .online-spin-label').innerText(), /INNER CASE/);
  await capture(page, "battle-opening-inner.png");
  await advanceUntil(page, '.online-room[data-state="settled"]');
  assert.deepEqual(await page.evaluate(() => window.landings.filter(([seat]) => seat === "0").map(([, name]) => name)),
    ["Lucky Presence", "GOLD COIN", "Downfall", "CASE INSIDE A CASE", "Power of Two"], "All queued rounds land on the server trait, with the correct bonus trigger first");
  assert.deepEqual(await page.evaluate(() => window.landings.filter(([seat]) => seat === "1").map(([, name]) => name)),
    ["Six Figure", "Perfect Cube", "Devil Imprint"]);
  assert.deepEqual(await page.locator(".online-reveal strong").allTextContents(), ["65,536", "666"]);
  assert.deepEqual(await page.locator(".online-score b").allTextContents(), ["3,780", "2,900"]);
  assert.deepEqual(await page.locator(".online-payout strong").allTextContents(), ["3.34 CR", "3.34 CR"]);
  await capture(page, "battle-opening-settled.png");
  await update({});
  assert.equal(await page.locator(".online-case-lane").count(), 0, "Duplicate snapshots do not replay rounds");
  await page.reload();
  await page.locator('.online-room[data-state="settled"]').waitFor();
  assert.equal(await page.locator(".online-case-lane").count(), 0, "Reconnect displays settled history immediately");
  await desktop.context.close();

  const mobile = await fixture({ width: 390, speed: "turbo" });
  await mobile.update({ rounds: [rounds[0]] });
  await advanceUntil(mobile.page, ".online-case-lane .rolling");
  assert.equal(await mobile.page.locator(".online-case-lane .rolling").first().evaluate((el) => el.style.getPropertyValue("--spin-duration")), "650ms", "Turbo uses a shorter spin");
  await capture(mobile.page, "battle-opening-mobile.png");
  await mobile.page.locator('[data-mode="store"]').click();
  assert.equal(await mobile.page.locator(".online-case-lane").count(), 0, "Navigation cancels the active reel");
  await mobile.update(settlement, false);
  await mobile.page.locator('[data-mode="online"]').click();
  await mobile.page.locator("#online-refresh").click();
  await advanceUntil(mobile.page, '.online-room[data-opening="1"]');
  await advanceUntil(mobile.page, '.online-room[data-state="settled"]');
  assert.deepEqual(await mobile.page.locator(".online-reveal strong").allTextContents(), ["65,536", "666"], "Cancelled work cannot overwrite a newer round");
  await mobile.context.close();

  const reduced = await fixture({ reducedMotion: "reduce" });
  await reduced.update(settlement);
  await reduced.page.locator('.online-room[data-state="settled"]').waitFor();
  assert.equal(await reduced.page.locator(".online-case-lane").count(), 0, "Reduced motion skips reels without delaying settlement");
  await reduced.context.close();

  const interrupted = await fixture();
  await interrupted.update({ rounds: [rounds[0]] });
  await advanceUntil(interrupted.page, ".online-case-lane .rolling");
  await interrupted.page.emulateMedia({ reducedMotion: "reduce" });
  await interrupted.page.locator(".online-case-lane").first().waitFor({ state: "detached" });
  await interrupted.update(settlement);
  await interrupted.page.locator('.online-room[data-state="settled"]').waitFor();
  await interrupted.page.clock.runFor(8000);
  assert.deepEqual(await interrupted.page.locator(".online-reveal strong").allTextContents(), ["65,536", "666"], "Changing motion preference aborts pending callbacks");
  await interrupted.context.close();
  assert.deepEqual(errors, []);
  console.log("PASS: moving reels, ordered batched rounds, authoritative landings, gold/inner bonuses, polling stability, turbo, mobile, navigation cancellation, reconnect and reduced motion.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await server.closeDatabase();
}

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
  const context = await browser.newContext({ viewport: { width, height: width < 650 ? 844 : 1050 }, deviceScaleFactor: 2, reducedMotion });
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
  // Control animation time while retaining real CSS transitions for the movement check.
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 100);
  return {
    page, context,
    update: async (patch, refresh = true) => {
      snapshot = { ...snapshot, ...patch };
      if (refresh) await page.locator('[data-room-action="refresh"]').click();
    },
  };
}
async function advanceUntil(page, selector) {
  for (let step = 0; step < 400; step++) {
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
async function numbers(page) {
  return page.locator("#online-room .duel-reels").evaluateAll((nodes) => nodes.map((node) => [...node.children].filter((cell) => !cell.hidden).map((cell) => cell.textContent).join("")));
}
async function checkPlayerGeometry(page, count) {
  const players = page.locator("#online-room .duel-player");
  assert.equal(await players.count(), count);
  for (const player of await players.all()) {
    const outer = await player.boundingBox();
    for (const selector of ["header", ".battle-case-lane", ".duel-reels", ".battle-player-total"]) {
      const box = await player.locator(selector).boundingBox();
      assert.ok(box && box.width > 0 && box.height > 0 && box.x >= outer.x && box.x + box.width <= outer.x + outer.width + 1 && box.y >= outer.y && box.y + box.height <= outer.y + outer.height + 1, `${selector} fits the player panel`);
      assert.ok(box.y + box.height <= page.viewportSize().height, `${selector} fits the viewport`);
    }
  }
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
  assert.equal(await page.locator("#online-room .duel-reels .locked, .online-payout, .online-history section").count(), 0, "No premature number, payout, or history");
  await update(settlement);
  assert.equal(await track.evaluate((el) => el.isConnected), true, "A newer settled snapshot must not replace the moving reel");
  assert.equal(await page.locator("#online-room").getAttribute("data-state"), "running");
  await checkPlayerGeometry(page, 2);
  await capture(page, "battle-opening-desktop.png");
  await advanceUntil(page, '[data-phase="digits"]');
  const scrambling = await numbers(page);
  await page.clock.runFor(180);
  assert.notDeepEqual(await numbers(page), scrambling, "Number digits scramble after the trait reel lands");
  assert.equal(await page.locator("#online-room .duel-reels .locked").count(), 0);
  await advanceUntil(page, '#online-room .duel-reels .locked');
  assert.ok(await page.locator("#online-room .duel-reels .locked").count() < 12, "Digits lock one at a time, not in one instant");
  assert.deepEqual(await page.locator("#online-room .battle-player-total > b").allTextContents(), ["0", "0"], "Totals wait for the complete number roll");
  await capture(page, "battle-number-rolling.png");
  await advanceUntil(page, '.online-room[data-opening="1"] [data-phase="bonus"]');
  assert.equal(await page.locator('[data-phase="bonus"]').count(), 1, "Only the triggering player gets a bonus spin");
  assert.match(await page.locator('.duel-player:has([data-phase="bonus"]) .online-spin-label').innerText(), /GOLD COIN/);
  await capture(page, "battle-opening-gold.png");
  await advanceUntil(page, '.online-room[data-opening="2"] [data-phase="bonus"]');
  assert.match(await page.locator('.duel-player:has([data-phase="bonus"]) .online-spin-label').innerText(), /INNER CASE/);
  await capture(page, "battle-opening-inner.png");
  await advanceUntil(page, '.online-room[data-state="settled"]');
  assert.deepEqual(await page.evaluate(() => window.landings.filter(([seat]) => seat === "0").map(([, name]) => name)),
    ["Lucky Presence", "GOLD COIN", "Downfall", "CASE INSIDE A CASE", "Power of Two"], "All queued rounds land on the server trait, with the correct bonus trigger first");
  assert.deepEqual(await page.evaluate(() => window.landings.filter(([seat]) => seat === "1").map(([, name]) => name)),
    ["Six Figure", "Perfect Cube", "Devil Imprint"]);
  assert.deepEqual(await numbers(page), ["65536", "666"]);
  assert.deepEqual(await page.locator("#online-room .battle-player-total > b").allTextContents(), ["3,780", "2,900"]);
  assert.deepEqual(await page.locator("#online-room .battle-player-total > small").allTextContents(), ["3.78 CR", "2.90 CR"]);
  assert.deepEqual(await page.locator(".online-payout strong").allTextContents(), ["3.34 CR", "3.34 CR"]);
  await capture(page, "battle-opening-settled.png");
  await page.locator('[data-room-action="results"]').click();
  await capture(page, "battle-original-results.png");
  await update({});
  assert.equal(await page.locator(".online-case-lane .rolling").count(), 0, "Duplicate snapshots do not replay rounds");
  await page.reload();
  await page.locator('.online-room[data-state="settled"]').waitFor();
  assert.equal(await page.locator(".online-case-lane .rolling").count(), 0, "Reconnect displays settled history immediately");
  await desktop.context.close();

  const mobile = await fixture({ width: 390, speed: "turbo" });
  await mobile.update({ rounds: [rounds[0]] });
  await advanceUntil(mobile.page, ".online-case-lane .rolling");
  assert.equal(await mobile.page.locator(".online-case-lane .rolling").first().evaluate((el) => el.style.getPropertyValue("--spin-duration")), "950ms", "Turbo restores the original fast spin");
  await checkPlayerGeometry(mobile.page, 2);
  await capture(mobile.page, "battle-opening-mobile.png");
  await mobile.page.locator('[data-room-action="close"]').click();
  assert.equal(await mobile.page.locator("#online-room").isVisible(), false, "Exit hides the fixed arena");
  assert.equal(await mobile.page.evaluate(() => document.body.classList.contains("online-battle-focus")), false, "Exit restores normal navigation");
  await mobile.update(settlement, false);
  await mobile.page.goto(`${base}/?battle=animation-fixture`);
  await advanceUntil(mobile.page, '.online-room[data-state="settled"]');
  assert.deepEqual(await numbers(mobile.page), ["65536", "666"], "Reconnect renders the final numbers");
  await mobile.context.close();

  const reduced = await fixture({ reducedMotion: "reduce" });
  await reduced.update(settlement);
  await reduced.page.locator('.online-room[data-state="settled"]').waitFor();
  assert.equal(await reduced.page.locator(".online-case-lane .rolling").count(), 0, "Reduced motion skips reels without delaying settlement");
  await reduced.context.close();

  const interrupted = await fixture();
  await interrupted.update({ rounds: [rounds[0]] });
  await advanceUntil(interrupted.page, ".online-case-lane .rolling");
  await interrupted.page.emulateMedia({ reducedMotion: "reduce" });
  await interrupted.page.locator(".online-case-lane .rolling").first().waitFor({ state: "detached" });
  await interrupted.update(settlement);
  await interrupted.page.locator('.online-room[data-state="settled"]').waitFor();
  await interrupted.page.clock.runFor(8000);
  assert.deepEqual(await numbers(interrupted.page), ["65536", "666"], "Changing motion preference aborts pending callbacks");
  await interrupted.context.close();

  const digitExit = await fixture({ speed: "turbo" });
  await digitExit.update({ rounds: [rounds[0]] });
  await advanceUntil(digitExit.page, '[data-phase="digits"]');
  await digitExit.page.locator('[data-room-action="close"]').click();
  const stopped = await numbers(digitExit.page);
  await digitExit.page.clock.runFor(5000);
  assert.deepEqual(await numbers(digitExit.page), stopped, "Exit cancels the digit interval and pending locks");
  await digitExit.context.close();

  for (const count of [4, 6]) {
    for (const width of [1440, 390]) {
      const layout = await fixture({ width, speed: "turbo" });
      const values = [0, 1000000, 7, 234568, 343, 65536].slice(0, count);
      const results = values.map((number, seat) => ({ ...rounds[0].results[0], seat, number }));
      await layout.update({
        format: count === 4 ? "3" : "3v3", teams: count === 4 ? [[0], [1], [2], [3]] : [[0, 1, 2], [3, 4, 5]],
        players: values.map((_, seat) => ({ id: null, seat, name: `HOUSE BOT ${seat + 1}`, bot: true })),
        rounds: [{ index: 0, caseId: "nano", results }],
      });
      await advanceUntil(layout.page, ".online-case-lane .rolling");
      await checkPlayerGeometry(layout.page, count);
      await advanceUntil(layout.page, '.online-room[data-opening=""]');
      assert.deepEqual(await numbers(layout.page), values.map(String), "Zero, short numbers and seven-digit million render exactly");
      await checkPlayerGeometry(layout.page, count);
      await capture(layout.page, `battle-original-${count}-${width}.png`);
      await layout.context.close();
    }
  }

  const practice = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  practice.on("pageerror", (error) => errors.push(error.message));
  const savedStats = { balance: 0, rolls: 9, best: 1200, badges: ["Existing badge"], casesOpened: 5, duelWins: [3, 7] };
  await practice.addInitScript((stats) => {
    if (!localStorage.getItem("number-zero-state")) localStorage.setItem("number-zero-state", JSON.stringify(stats));
  }, savedStats);
  await practice.goto(base);
  assert.equal(await practice.locator("#global-balance").innerText(), "∞ DEMO CR");
  await practice.locator("#motion-toggle").click();
  await practice.locator("#roll-button").click();
  await practice.locator("#status-text").filter({ hasText: "ROLL COMPLETE" }).waitFor();
  await practice.locator('[data-mode="store"]').click();
  assert.equal(await practice.locator("#daily-roll, #admin-add-credits").count(), 0, "No demo top-up requirements");
  await practice.locator('#case-detail [data-buy-case="nano"]').click();
  await practice.locator('[data-mode="inventory"]').click();
  await practice.locator("[data-open-case]").first().click();
  await practice.locator(".case-payout").waitFor({ timeout: 30000 });
  assert.match(await practice.locator(".case-payout").innerText(), /DEMO PAYOUT.*NOT CREDITED/);
  await practice.locator("#back-inventory").click();
  await practice.locator('[data-mode="duel"]').click();
  await practice.locator("#battle-clear-cases").click();
  assert.equal(await practice.locator("#duel-start").isDisabled(), true, "An empty demo still needs a case");
  await practice.locator('[data-add-battle-case="endgame-vault"]').click();
  assert.equal(await practice.locator("#duel-start").isEnabled(), true, "Even an expensive case is playable with zero stored credits");
  await practice.screenshot({ path: join(artifacts, "unlimited-demo-desktop.png") });
  await practice.setViewportSize({ width: 390, height: 844 });
  await practice.evaluate(() => window.scrollTo(0, 0));
  await practice.screenshot({ path: join(artifacts, "unlimited-demo-mobile.png") });
  assert.equal(await practice.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await practice.setViewportSize({ width: 1440, height: 1050 });
  await practice.locator("#battle-mode").selectOption("classic");
  await practice.locator("#battle-speed-select").selectOption("turbo");
  await practice.locator("#duel-start").click();
  await practice.locator("#duel-arena .battle-lane-track.rolling").first().waitFor();
  await practice.locator("#duel-number-1 .locked").first().waitFor();
  assert.ok(await practice.locator("#duel-arena .battle-player-total").count() >= 2, "Practice keeps the shared player header and number animation");
  await practice.locator("#battle-winner-banner").waitFor();
  assert.equal(await practice.locator("#battle-balance").innerText(), "∞ DEMO CR");
  assert.equal(await practice.locator("#battle-winner-credit").innerText(), "DEMO ONLY · NO CREDITS OR STATS RECORDED");
  await practice.reload();
  const stored = await practice.evaluate(() => JSON.parse(localStorage.getItem("number-zero-state")));
  for (const key of Object.keys(savedStats)) assert.deepEqual(stored[key], savedStats[key], `${key} is unchanged by sandbox rolls, demo openings and settled bot battles`);
  await practice.close();
  assert.deepEqual(errors, []);
  console.log("PASS: moving reels, ordered batched rounds, authoritative landings, gold/inner bonuses, polling stability, turbo, mobile, navigation cancellation, reconnect and reduced motion.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await server.closeDatabase();
}

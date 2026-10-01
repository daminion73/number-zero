import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { createServer } from "../server.js";

const artifacts =
  process.env.ARTIFACT_DIR || join(import.meta.dirname, "../.amp/in/artifacts");
await mkdir(artifacts, { recursive: true });
const server = await createServer({
  dbPath: ":memory:",
  env: { DEV_AUTH: "1", ROUND_MS: "2500" },
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const errors = [];
async function pageFor(name, width = 1440) {
  const context = await browser.newContext({
    viewport: { width, height: 1050 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && m.text().includes("Content Security Policy"))
      errors.push(m.text());
  });
  await page.goto(base);
  await page.locator("#network-status").filter({ hasText: "OPEN" }).waitFor();
  await page.locator("#account-button").click();
  await page.locator("#dev-player-name").fill(name);
  await page
    .getByRole("button", { name: "SIGN IN LOCALLY", exact: true })
    .click();
  await page.locator(".account-wallet").waitFor();
  await page.locator(".account-close").click();
  return page;
}
async function checkOverflow(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Horizontal viewport overflow",
  );
  const header = await page.locator(".topbar").boundingBox();
  const wallet = await page.locator(".global-wallet").boundingBox();
  const neighbour = (await page.locator(".fairness").isVisible())
    ? await page.locator(".fairness").boundingBox()
    : await page.locator(".brand").boundingBox();
  assert.ok(
    wallet.x >= neighbour.x + neighbour.width,
    "Wallet does not overlap header labels",
  );
  assert.ok(
    wallet.y >= header.y &&
      wallet.y + wallet.height <= header.y + header.height,
    "Wallet stays inside the sticky header",
  );
}
async function captureRoom(page, name, fullPage = false) {
  await page
    .locator("#online-room")
    .evaluate((room) =>
      room.scrollIntoView({ behavior: "instant", block: "start" }),
    );
  const heading = await page.locator(".online-room-heading").boundingBox();
  const navigation = await page.locator(".mode-tabs").boundingBox();
  assert.ok(
    heading.y >= navigation.y + navigation.height,
    "Opened room heading clears sticky navigation",
  );
  if (fullPage) await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(artifacts, name), fullPage });
}
try {
  const host = await pageFor("ALPHA"),
    guest = await pageFor("BRAVO");
  await host.locator('[data-mode="duel"]').click();
  await host.locator("#battle-bots").selectOption("2");
  await host.locator("#battle-mode").selectOption("share");
  await host.screenshot({ path: join(artifacts, "multiplayer-builder.png") });
  await host.locator("#online-publish").click();
  await host.locator('.online-room[data-state="waiting"]').waitFor();
  const id = new URL(host.url()).searchParams.get("battle");
  assert.ok(id);
  await guest.locator('[data-mode="online"]').click();
  await guest.locator("#online-refresh").click();
  await guest.locator(`[data-view-battle="${id}"]`).waitFor();
  await guest.screenshot({ path: join(artifacts, "multiplayer-feed.png") });
  await guest.locator(`[data-view-battle="${id}"]`).click();
  await guest.locator('[data-room-action="join"][data-seat="1"]').click();
  await guest
    .locator(".online-room-actions")
    .getByRole("button", { name: "LEAVE & REFUND MY SEAT" })
    .waitFor();
  await host.locator("#online-refresh").click();
  await host.locator('[data-room-action="bot"][data-seat="2"]').click();
  await host
    .getByRole("button", { name: "START BATTLE →", exact: true })
    .waitFor();
  await captureRoom(host, "multiplayer-seats.png");
  assert.equal(await guest.locator('[data-room-action="start"]').count(), 0);
  await host.locator('[data-room-action="start"]').click();
  await host.locator('.online-room[data-state="running"]').waitFor();
  assert.match(
    await host.locator(".online-room-actions").innerText(),
    /Rounds resolve on the server/,
    "Running battles show reconnect guidance, not a refund confirmation",
  );
  await captureRoom(host, "multiplayer-running.png");
  await guest.reload();
  await guest
    .locator('.online-room[data-state="settled"]')
    .waitFor({ timeout: 25000 });
  await host
    .locator('.online-room[data-state="settled"]')
    .waitFor({ timeout: 15000 });
  await captureRoom(host, "multiplayer-settled.png");
  const hostText = await host.locator(".online-room-meta").innerText(),
    guestText = await guest.locator(".online-room-meta").innerText();
  assert.equal(
    hostText,
    guestText,
    "Independent clients agree on settled pot and round count",
  );
  assert.equal(await host.locator(".online-payout").count(), 3);
  await host.locator(".online-history summary").click();
  assert.equal(await host.locator(".online-history section").count(), 3);
  await checkOverflow(host);

  const mobile = await pageFor("CHARLIE", 390);
  await mobile.goto(`${base}/?battle=${id}`);
  await mobile.locator('.online-room[data-state="settled"]').waitFor();
  await checkOverflow(mobile);
  await captureRoom(mobile, "multiplayer-mobile.png", true);
  await mobile.locator('[data-mode="sandbox"]').click();
  await mobile
    .getByRole("button", { name: "EXPLORE COLLECTION", exact: true })
    .click();
  await mobile.locator(".experience-filters input").fill("nano");
  await mobile.locator(".experience-favorite").first().click();
  await mobile.locator(".experience-filters select").selectOption("favorites");
  assert.ok((await mobile.locator(".experience-branch").count()) > 0);
  await mobile.screenshot({ path: join(artifacts, "experience-mobile.png") });
  await mobile.locator(".experience-inspect").first().click();
  assert.match(
    await mobile.locator(".experience-progress-copy span").innerText(),
    /1\/435 cases inspected/,
  );
  await mobile.reload();
  assert.match(
    await mobile.locator(".experience-progress-copy span").innerText(),
    /1\/435 cases inspected/,
  );
  assert.equal(
    await mobile.evaluate(() => document.body.dataset.ambience),
    "paused",
  );
  await mobile.emulateMedia({ reducedMotion: "no-preference" });
  await mobile
    .getByRole("button", { name: "PAUSE AMBIENCE", exact: true })
    .click();
  assert.equal(
    await mobile.evaluate(
      () =>
        getComputedStyle(document.querySelector(".roll-atmosphere"), "::before")
          .animationPlayState,
    ),
    "paused",
  );
  await mobile
    .getByRole("button", { name: "EXPLORE COLLECTION", exact: true })
    .click();
  await mobile
    .getByRole("button", { name: "HIDE CONTEXT", exact: true })
    .click();
  await mobile.locator(".experience-close").click();
  assert.equal(
    await mobile.locator(".experience-bar").isVisible(),
    true,
    "Controls remain recoverable when context is hidden",
  );
  await mobile.locator('[data-mode="online"]').click();
  await mobile.locator("#online-pause").click();
  assert.equal(
    await mobile.locator("#online-pause").getAttribute("aria-pressed"),
    "true",
  );
  await checkOverflow(mobile);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: independent clients create/join/add-bot/start/reconnect/settle; mobile, favorites, persistence, reduced motion and controls.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await server.closeDatabase();
}

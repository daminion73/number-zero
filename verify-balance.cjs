const { chromium } = require("playwright");
const assert = require("node:assert/strict");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    localStorage.setItem("number-zero-state", JSON.stringify({ balance: 100000, unclaimedCredits: 0, inventory: [{ type: "case", caseId: "nano" }, { type: "case", caseId: "nano" }, { type: "case", caseId: "nano" }, { type: "case", caseId: "signal-crate" }, { type: "case", caseId: "signal-crate" }] }));
    const rolls = [0, 500000, 123456];
    let call = 0;
    crypto.getRandomValues = (array) => { array[0] = rolls[call++] ?? 123456; return array; };
  });
  await page.goto("http://localhost:4173", { waitUntil: "networkidle" });
  assert.equal(await page.locator("#machine").isVisible(), true);
  assert.equal(await page.locator("#rewards-panel").isVisible(), true);
  await page.screenshot({ path: ".amp/in/artifacts/command-center-sandbox.jpg", type: "jpeg", quality: 82, fullPage: false });
  await page.locator("#motion-toggle").click();
  await page.locator('[data-mode="store"]').click();
  const cards = page.locator(".case-card");
  assert.equal(await cards.count(), 435);
  assert.equal(await page.locator(".detail-drops li").count(), 10);
  assert.match(await page.locator(".gold-path").textContent(), /2% GOLD COIN TRIGGER.*RARE-ONLY SPIN/s);
  assert.match(await page.locator(".catalog-status").textContent(), /435 CASES/);
  await page.locator("#case-search").fill("Fibonacci File");
  assert.equal(await cards.count(), 1);
  await page.locator("#case-search").fill("");
  assert.equal(await cards.count(), 435);
  await page.screenshot({ path: ".amp/in/artifacts/case-district.jpg", type: "jpeg", quality: 82, fullPage: false });
  await page.evaluate(() => window.scrollTo(0, document.querySelector(".catalog-status").offsetTop - 110));
  await page.screenshot({ path: ".amp/in/artifacts/case-catalog-detail.jpg", type: "jpeg", quality: 82, fullPage: false });

  await page.locator('[data-mode="inventory"]').click();
  assert.equal(await page.locator(".inventory-item").count(), 2);
  assert.deepEqual(await page.locator(".stack-count").allTextContents(), ["×3", "×2"]);
  await page.screenshot({ path: ".amp/in/artifacts/stacked-inventory.jpg", type: "jpeg", quality: 82, fullPage: false });
  const goldPipelineStarted = Date.now();
  await page.locator("button[data-open-case]").first().click({ noWaitAfter: true });
  await page.locator(".case-opening.gold-trigger.active").waitFor({ state: "visible", timeout: 5000 });
  await page.evaluate(() => {
    const freeze = (source, id, hidden = false) => {
      const clone = source.cloneNode(true);
      clone.id = id; clone.hidden = false; clone.classList.remove("leaving"); clone.classList.add("active", "landed");
      clone.style.cssText += ";opacity:1;animation:none;z-index:100;display:" + (hidden ? "none" : "grid");
      clone.querySelectorAll("*").forEach((element) => { element.style.animationPlayState = "paused"; });
      document.body.append(clone);
      return clone;
    };
    const opening = document.querySelector("#case-opening");
    freeze(opening, "capture-gold-trigger");
    new MutationObserver(() => {
      if (opening.classList.contains("gold-spin") && !document.querySelector("#capture-gold-spin-pending, #capture-gold-spin")) {
        const pending = document.createElement("i");
        pending.id = "capture-gold-spin-pending";
        pending.hidden = true;
        document.body.append(pending);
        setTimeout(() => {
          pending.remove();
          freeze(opening, "capture-gold-spin", true);
        }, 1170);
      }
    }).observe(opening, { attributes: true, attributeFilter: ["class"] });
  });
  await page.screenshot({ path: ".amp/in/artifacts/gold-coin-trigger.jpg", type: "jpeg", quality: 82, fullPage: false });
  await page.locator("#capture-gold-spin").waitFor({ state: "attached", timeout: 5000 });
  await page.evaluate(() => { document.querySelector("#capture-gold-trigger").style.display = "none"; document.querySelector("#capture-gold-spin").style.display = "grid"; });
  assert.match(await page.locator("#capture-gold-spin h2").textContent(), /RARE-ONLY GOLD SPIN/);
  const goldLanding = await page.locator("#capture-gold-spin").evaluate((opening) => {
    const markerX = opening.querySelector(".roulette-marker").getBoundingClientRect().x;
    const winner = opening.querySelector(".trait-track .winner");
    const winnerBox = winner.getBoundingClientRect();
    return {
      landedName: opening.querySelector(".trait-landed strong").textContent.trim(),
      winnerName: winner.querySelector("strong").textContent.trim(),
      markerInsideWinner: markerX >= winnerBox.left + winnerBox.width * .25 && markerX <= winnerBox.right - winnerBox.width * .25,
    };
  });
  assert.equal(goldLanding.markerInsideWinner, true);
  assert.equal(goldLanding.landedName, goldLanding.winnerName);
  await page.screenshot({ path: ".amp/in/artifacts/gold-rare-spin.jpg", type: "jpeg", quality: 82, fullPage: false });
  await page.evaluate(() => { document.querySelector("#capture-gold-trigger").remove(); document.querySelector("#capture-gold-spin").remove(); });
  await page.waitForFunction(() => document.querySelector("#opening-payout-status").textContent.includes("AUTO-PAID"), null, { timeout: 10000 });
  const goldPipelineMs = Date.now() - goldPipelineStarted;
  const paid = await page.evaluate(() => JSON.parse(localStorage.getItem("number-zero-state")));
  assert.ok(paid.balance > 100000);
  assert.equal("goldCoins" in paid, false);
  assert.equal("unclaimedCredits" in paid, false);
  const status = await page.locator("#opening-payout-status").textContent();
  assert.match(status, /\+\d[\d,.]* CR · AUTO-PAID/);
  assert.equal(await page.locator("#opening-claim").count(), 0);
  assert.equal(await page.locator("#rarity-ceremony").isHidden(), true);
  await page.locator("#rarity-ceremony").evaluate((element) => { element.hidden = true; });
  await page.screenshot({ path: ".amp/in/artifacts/gold-result.jpg", type: "jpeg", quality: 82, fullPage: false });
  await page.keyboard.press("F1");
  await page.locator("#admin-dialog").waitFor({ state: "visible" });
  assert.match(await page.locator("#admin-dialog").textContent(), /CONTROL\/\/ROOM.*OPENING TEST LAB.*FORCE GOLD.*FORCE MYTHIC/s);
  await page.screenshot({ path: ".amp/in/artifacts/admin-control-room.jpg", type: "jpeg", quality: 82, fullPage: false });
  await page.locator(".admin-close").click();
  await page.locator("#back-inventory").click();
  await page.setViewportSize({ width: 1600, height: 1400 });
  await page.locator('[data-mode="duel"]').click();
  assert.equal(await page.locator("#duel-panel").isVisible(), true);
  await page.screenshot({ path: ".amp/in/artifacts/case-battle-command-center.jpg", type: "jpeg", quality: 82, fullPage: false });
  await page.locator("#duel-length").selectOption("3");
  await page.locator("#battle-bots").selectOption("3");
  await page.locator("#battle-speed-select").selectOption("turbo");
  await page.locator("#duel-start").click();
  assert.equal(await page.locator("#duel-roll").isDisabled(), true);
  assert.match(await page.locator("#duel-round").textContent(), /FILLING BOT SEATS/);
  assert.equal(await page.locator(".duel-player").count(), 4);
  assert.deepEqual(await page.locator(".duel-player").evaluateAll((cards) => ({
    columns: new Set(cards.map((card) => Math.round(card.getBoundingClientRect().left))).size,
    rows: new Set(cards.map((card) => Math.round(card.getBoundingClientRect().top))).size,
  })), { columns: 2, rows: 2 });
  await page.waitForFunction(() => document.querySelectorAll(".battle-lane-track article").length === 244, null, { timeout: 7000 });
  await page.screenshot({ path: ".amp/in/artifacts/case-battle-ready.jpg", type: "jpeg", quality: 82, fullPage: false });
  await page.locator(".battle-lane-track.rolling").first().waitFor({ state: "attached", timeout: 3000 });
  await page.waitForFunction(() => !document.querySelector(".battle-lane-track.rolling"), null, { timeout: 3000 });
  const battleNumberStarted = Date.now();
  await page.locator("#duel-number-1 i.locked").first().waitFor({ state: "attached", timeout: 2000 });
  const battleNumberFirstDigitMs = Date.now() - battleNumberStarted;
  assert.ok(battleNumberFirstDigitMs >= 400, `Battle number locked too quickly: ${battleNumberFirstDigitMs}ms`);
  await page.waitForFunction(() => document.querySelector("#duel-round").textContent.includes("AUTO-PAID"), null, { timeout: 25000 });
  assert.equal(await page.locator(".battle-lane-track article").count(), 244);
  assert.match(await page.locator("#battle-feed").textContent(), /SYSTEM/);
  assert.doesNotMatch(await page.locator("#duel-arena").textContent(), /BOT SLOT|CONNECTING/);
  assert.match(await page.locator("#battle-speed").textContent(), /FAST/);
  assert.match(await page.locator("#battle-balance").textContent(), /CR/);
  assert.equal(await page.evaluate(() => "unclaimedCredits" in JSON.parse(localStorage.getItem("number-zero-state"))), false);
  await page.screenshot({ path: ".amp/in/artifacts/case-battle-auto-paid.jpg", type: "jpeg", quality: 82, fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  assert.equal(await page.locator(".duel-player").count(), 4);
  await page.screenshot({ path: ".amp/in/artifacts/case-battle-mobile.jpg", type: "jpeg", quality: 82, fullPage: false });
  await page.locator('[data-mode="sandbox"]').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.screenshot({ path: ".amp/in/artifacts/command-center-mobile.jpg", type: "jpeg", quality: 82, fullPage: false });
  await page.locator('[data-mode="inventory"]').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.screenshot({ path: ".amp/in/artifacts/inventory-mobile.jpg", type: "jpeg", quality: 82, fullPage: false });
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator('[data-mode="sandbox"]').click();
  await page.evaluate(() => {
    crypto.getRandomValues = (array) => { array[0] = 538271; return array; };
    setInterval(() => document.querySelector(".rarity-ceremony.ready .ceremony-dismiss")?.click(), 40);
    window.scrollTo(0, 0);
  });
  const completeRollStarted = Date.now();
  await page.locator("#roll-button").click();
  await page.locator("body.is-rolling").waitFor({ state: "attached" });
  await page.screenshot({ path: ".amp/in/artifacts/complete-roll-charge.jpg", type: "jpeg", quality: 82, fullPage: false });
  await page.locator("body.roll-complete").waitFor({ state: "attached", timeout: 20000 });
  const completeRollMs = Date.now() - completeRollStarted;
  assert.ok(completeRollMs < 5000, `Complete roll took ${completeRollMs}ms`);
  assert.equal(await page.locator(".badge-card.revealed").count(), 16);
  assert.equal(await page.locator(".badge-icon img").evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth === 128)), true);
  assert.equal(await page.locator(".badge-icon img").evaluateAll((images) => new Set(images.map((image) => image.src)).size), 16);
  assert.equal((await page.locator("#roll-button .button-copy").textContent()).trim(), "ROLL AGAIN");
  assert.ok(await page.locator("body").getAttribute("data-roll-rank"));
  await page.screenshot({ path: ".amp/in/artifacts/complete-roll-result.jpg", type: "jpeg", quality: 82, fullPage: false });

  const timingPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await timingPage.addInitScript(() => {
    localStorage.setItem("number-zero-state", JSON.stringify({ balance: 100000, inventory: [{ type: "case", caseId: "nano" }] }));
    crypto.getRandomValues = (array) => { array[0] = 500000; return array; };
  });
  await timingPage.goto("http://localhost:4173", { waitUntil: "networkidle" });
  await timingPage.locator('[data-mode="inventory"]').click();
  const standardSpinStarted = Date.now();
  await timingPage.locator("button[data-open-case]").click();
  await timingPage.locator("#case-opening.active").waitFor({ state: "visible" });
  await timingPage.locator(".trait-track.rolling").waitFor({ state: "attached" });
  const initialReelX = await timingPage.locator(".trait-track").evaluate((track) => new DOMMatrixReadOnly(getComputedStyle(track).transform).m41);
  await timingPage.waitForTimeout(400);
  const movingReel = await timingPage.locator(".trait-track").evaluate((track) => ({
    x: new DOMMatrixReadOnly(getComputedStyle(track).transform).m41,
    duration: getComputedStyle(track).transitionDuration,
  }));
  assert.ok(Math.abs(movingReel.x - initialReelX) > 500, `Reel did not move: ${initialReelX} to ${movingReel.x}`);
  assert.equal(movingReel.duration, "5.2s");
  const reelFrames = await timingPage.evaluate(() => new Promise((resolve) => {
    const intervals = [];
    let previous = performance.now();
    const sample = (timestamp) => {
      if (!document.querySelector(".trait-track.rolling")) {
        intervals.sort((left, right) => left - right);
        resolve({ frames: intervals.length, p95: intervals[Math.floor(intervals.length * .95)] });
        return;
      }
      intervals.push(timestamp - previous);
      previous = timestamp;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  await timingPage.locator("#case-opening").waitFor({ state: "hidden", timeout: 9000 });
  const standardSpinMs = Date.now() - standardSpinStarted;
  assert.ok(standardSpinMs >= 6200 && standardSpinMs < 8500, `Standard case spin took ${standardSpinMs}ms`);
  assert.ok(reelFrames.frames > 130 && reelFrames.p95 < 60, `Reel cadence was ${reelFrames.frames} frames with ${reelFrames.p95}ms p95`);
  await timingPage.close();

  const turboPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await turboPage.addInitScript(() => {
    localStorage.setItem("number-zero-state", JSON.stringify({ balance: 100000, inventory: [{ type: "case", caseId: "nano" }] }));
    crypto.getRandomValues = (array) => { array[0] = 500000; return array; };
  });
  await turboPage.goto("http://localhost:4173", { waitUntil: "networkidle" });
  await turboPage.locator("#motion-toggle").click();
  await turboPage.locator('[data-mode="inventory"]').click();
  const turboSpinStarted = Date.now();
  await turboPage.locator("button[data-open-case]").click();
  await turboPage.locator("#case-opening.active").waitFor({ state: "visible" });
  await turboPage.locator("#case-opening").waitFor({ state: "hidden", timeout: 4000 });
  const turboSpinMs = Date.now() - turboSpinStarted;
  assert.ok(turboSpinMs >= 1200 && turboSpinMs < 2200, `Turbo case spin took ${turboSpinMs}ms`);
  await turboPage.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status, balanceAfterAutoPay: paid.balance, goldPipelineMs, battleNumberFirstDigitMs, completeRollMs, standardSpinMs, turboSpinMs, reelFrames }, null, 2));
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });

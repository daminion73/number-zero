import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { badgeHighlights, evaluateBadges, numberRarity, preciseNumberRank } from "../badges.js";
import { battleWinner, CASE_RTP, CASES, EP_PER_CREDIT, GOLD_COIN_CHANCE, TRAIT_EXPECTED_EP, casePayout, createCase, dailyReward, drawCaseDrop, drawCaseOutcome, drawGoldDrop, epToCredits, generateTraitNumber, isGoldCoinRoll, splitBattlePot } from "../economy.js";

const labels = (number) => evaluateBadges(number).map((badge) => badge.label);

describe("badge stacking", () => {
  test("777 stacks exact, jackpot, homogeneous, odd and lucky badges", () => {
    const result = labels(777);
    for (const label of ["Exact Jackpot", "Jackpot", "Homogeneous", "Odd", "Lucky Seven"]) assert.ok(result.includes(label));
  });

  test("404 recognizes exact, palindrome, error and even", () => {
    const result = labels(404);
    for (const label of ["Not Found", "Error 404", "Palindrome", "Even"]) assert.ok(result.includes(label));
  });

  test("visual leading zeroes never create badges", () => {
    assert.ok(!labels(42).includes("Deep Void"));
  });

  test("single digit means length, not one distinct repeated digit", () => {
    assert.ok(labels(7).includes("Single Digit"));
    assert.ok(!labels(777).includes("Single Digit"));
  });

  test("the upper boundary is valid and special", () => {
    assert.ok(labels(1000000).includes("The Fabled One Million"));
  });

  test("rejects values outside the fair range", () => {
    assert.throws(() => evaluateBadges(1000001), RangeError);
    assert.throws(() => evaluateBadges(-1), RangeError);
  });

  test("alternator checks every adjacent pair", () => {
    assert.ok(labels(123456).includes("Alternator"));
    assert.ok(!labels(112345).includes("Alternator"));
  });

  test("compound pattern badges use asymmetric examples", () => {
    assert.ok(labels(118910).includes("4 Consecutive Numbers (Scrambled)"));
    assert.ok(labels(6998).includes("Framed Pair"));
    assert.ok(labels(55444).includes("Contiguous Full House"));
    assert.ok(labels(123456).includes("Sequence (6)"));
    assert.ok(!labels(121212).includes("Sequence (6)"));
    assert.ok(labels(525125).includes("Crescendo"));
    assert.ok(labels(526785).includes("3 Consecutive Numbers (Contains)"));
    assert.ok(!labels(278191).includes("3 Consecutive Numbers (Contains)"));
    assert.ok(labels(849102).includes("2 Consecutive Numbers (Contains)"));
    assert.ok(labels(849210).includes("2 Consecutive Numbers (Nearby)"));
    assert.ok(labels(810976).includes("Scramble"));
  });

  test("badge highlights point at the triggering display digits", () => {
    assert.deepEqual(badgeHighlights(14264, "Five Digits", "5 digits long"), [2, 3, 4, 5, 6]);
    assert.deepEqual(badgeHighlights(14264, "Even", "An even number"), [6]);
    assert.deepEqual(badgeHighlights(42069, "Meaning of Life", "Contains 42"), [2, 3]);
    assert.deepEqual(badgeHighlights(777, "Jackpot", "Contains 777"), [4, 5, 6]);
    assert.deepEqual(badgeHighlights(526785, "3 Consecutive Numbers (Contains)", "Contains three consecutive integers in a row"), [3, 4, 5]);
    assert.deepEqual(badgeHighlights(526785, "Sequence (3)", "Contains three consecutive digits in order"), [3, 4, 5]);
  });

  test("number rarity uses exact all-roll EP percentile boundaries", () => {
    assert.equal(numberRarity(2183).tier, "trash");
    assert.equal(numberRarity(2184).tier, "common");
    assert.equal(numberRarity(6174).tier, "uncommon");
    assert.equal(numberRarity(12851).tier, "rare");
    assert.equal(numberRarity(30731).tier, "epic");
    assert.equal(numberRarity(81460).tier, "anomaly");
    assert.equal(numberRarity(224966).tier, "mythic");
  });

  test("number rank reports the exact top or bottom percentile", async () => {
    const file = await readFile(new URL("../assets/score-cdf.bin", import.meta.url));
    const distribution = new Uint32Array(file.buffer, file.byteOffset, file.byteLength / 4);
    assert.match(preciseNumberRank(1786, distribution), /^Bottom 0\.0026%/);
    assert.match(preciseNumberRank(401450791, distribution), /^Top 0\.0001%/);
  });

  test("badge odds and tiers follow probability denominator bands", () => {
    const funny = evaluateBadges(42069).find((badge) => badge.label === "Funny Number");
    const clean = evaluateBadges(120).find((badge) => badge.label === "Clean");
    assert.equal(funny.odds, "1 / 500,001");
    assert.equal(funny.rarity, "mythic");
    assert.equal(clean.odds, "1 / 10");
    assert.equal(clean.rarity, "uncommon");
  });

  test("case trait tables disclose every outcome", () => {
    for (const item of CASES) {
      assert.equal(item.drops.reduce((sum, drop) => sum + drop.chance, 0), 100);
      assert.ok(Math.abs(item.drops.reduce((sum, drop) => sum + drop.finalChance, 0) - 100) < 1e-10);
      assert.ok(Math.abs(item.drops.reduce((sum, drop) => sum + drop.goldChance, 0) - 100) < 1e-10);
      assert.equal(drawCaseDrop(item, 0), item.drops[0]);
      assert.equal(drawCaseDrop(item, item.drops[0].chance / 100 - 1e-9), item.drops[0]);
      assert.equal(drawCaseDrop(item, item.drops[0].chance / 100), item.drops[1]);
      if (item.bonusType === "nested") {
        assert.ok(drawGoldDrop(item, 0).goldChance > 0);
        assert.ok(drawGoldDrop(item, 0.999999).goldChance > 0);
      } else {
        assert.ok(["rare", "epic", "mythic"].includes(drawGoldDrop(item, 0).rarity));
        assert.equal(drawGoldDrop(item, 0.999999).rarity, "mythic");
      }
    }
  });

  test("case payouts use one linear EP rate with fair auto-pricing", () => {
    assert.equal(CASES.length, 435);
    assert.equal(new Set(CASES.map((item) => item.name)).size, CASES.length);
    assert.equal(new Set(CASES.map((item) => item.id)).size, CASES.length);
    assert.equal(new Set(CASES.map((item) => item.denominator)).size, 1);
    assert.equal(CASES[0].denominator, EP_PER_CREDIT);
    assert.equal(new Set(CASES.map((item) => item.drops.map((drop) => drop.id).join(","))).size, CASES.length);
    assert.equal(new Set(CASES.map((item) => item.category)).size, 13);
    assert.equal(new Set(CASES.map((item) => item.risk)).size, 6);
    const highRollers = CASES.filter((item) => item.category === "High Roller");
    assert.equal(highRollers.length, 75);
    assert.ok(Math.min(...highRollers.map((item) => item.cost)) > 10_000);
    const maximumVolatility = CASES.filter((item) => item.category === "Maximum Volatility");
    assert.equal(maximumVolatility.length, 50);
    assert.ok(maximumVolatility.every((item) => item.risk === "maximum"));
    assert.ok(maximumVolatility.every((item) => item.drops.filter((drop) => drop.rarity === "mythic").reduce((sum, drop) => sum + drop.chance, 0) === .05));
    const caseception = CASES.filter((item) => item.category === "Caseception");
    assert.equal(caseception.length, 10);
    assert.ok(caseception.every((item) => item.bonusType === "nested" && item.drops.filter((drop) => drop.goldChance > 0).length === 4));
    assert.ok(caseception.some((item) => item.drops.some((drop) => drop.rarity === "common" && drop.goldChance > 0)), "at least one inner pool should include ordinary traits");
    const expansions = CASES.filter((item) => item.id.startsWith("expansion-"));
    assert.equal(expansions.length, 100);
    assert.deepEqual([...new Set(expansions.map((item) => item.drops.length))].sort((a, b) => a - b), [3, 4, 5, 6, 8, 12, 14, 16, 20, 24]);
    for (const item of CASES) {
      const averagePayout = item.drops.reduce((total, drop) => total + drop.finalChance / 100 * casePayout(item, TRAIT_EXPECTED_EP[drop.id]), 0);
      assert.ok(Math.abs(averagePayout / item.cost - CASE_RTP) < 1e-4);
      assert.equal(item.expectedPayout, item.expectedEp / EP_PER_CREDIT);
      for (const drop of item.drops) {
        assert.equal(drop.oneIn, 100 / drop.finalChance);
        assert.equal(drop.baseOneIn, 100 / drop.chance);
        assert.equal(drop.expectedEp, TRAIT_EXPECTED_EP[drop.id]);
        assert.equal(drop.weightedEp, drop.expectedEp * drop.finalChance / 100);
        assert.equal(drop.averagePayout, drop.expectedEp / EP_PER_CREDIT);
      }
      assert.equal(casePayout(item, 0), 0);
      assert.equal(casePayout(item, 14_000), 14);
      const tierReturns = ["common", "uncommon", "rare", "epic", "mythic"].map((rarity) => item.drops.filter((drop) => drop.rarity === rarity)).filter((drops) => drops.length).map((drops) => drops.reduce((sum, drop) => sum + drop.averageReturn, 0) / drops.length);
      assert.ok(tierReturns.every((value, index) => !index || value > tierReturns[index - 1]), `${item.id} rarity values must increase`);
    }
    assert.equal(epToCredits(1_000), 1);
    assert.equal(epToCredits(125_550), 125.55);
    assert.equal(casePayout(CASES[0], 900_000), casePayout(CASES.at(-1), 900_000));
  });

  test("player-created cases validate traits and auto-calculate their economy", () => {
    const custom = createCase({ id: "custom-test", name: "Custom Test", cost: 777, accent: "#12abef", traitIds: Object.keys(TRAIT_EXPECTED_EP).slice(0, 10) });
    assert.equal(custom.drops.length, 10);
    assert.equal(custom.denominator, EP_PER_CREDIT);
    assert.equal(custom.cost, Math.round(custom.expectedPayout / CASE_RTP * 100) / 100);
    const fullyCustom = createCase({ id: "custom-odds", name: "Custom Odds", accent: "#12abef", odds: [["common", 30], ["mythic", 70]], traitIds: ["even", "million"] });
    assert.deepEqual(fullyCustom.drops.map((drop) => drop.chance), [30, 70]);
    assert.equal(drawCaseDrop(fullyCustom, .299999).id, "even");
    assert.equal(drawCaseDrop(fullyCustom, .3).id, "million");
    const oneOutcome = createCase({ id: "one-outcome", name: "One Outcome", accent: "#12abef", odds: [["common", 100]], traitIds: ["even"] });
    assert.equal(drawCaseDrop(oneOutcome, .999999).id, "even");
    assert.equal(drawGoldDrop(oneOutcome, .999999).id, "even");
    assert.throws(() => createCase({ id: "bad", name: "Bad", cost: 10, accent: "#12abef", traitIds: ["missing"] }), RangeError);
    assert.throws(() => createCase({ id: "bad-odds", name: "Bad Odds", accent: "#12abef", odds: [["common", 40], ["mythic", 40]], traitIds: ["even", "million"] }), RangeError);
  });

  test("every generated subcase number has its promised trait", () => {
    const traits = {
      even: (n) => n % 2 === 0,
      lowdigits: (n) => [...String(n)].every((digit) => Number(digit) <= 4),
      clean: (n) => String(n).endsWith("0"),
      doublezero: (n) => String(n).endsWith("00"),
      pair: (n) => /(\d)\1/.test(String(n)),
      five: (n) => String(n).length === 5,
      palindrome: (n) => String(n) === [...String(n)].reverse().join(""),
      repeatedpair: (n) => (String(n).match(/(\d)\1/g) || []).length >= 2,
      homogeneous: (n) => new Set(String(n)).size === 1,
      zero: (n) => n === 0,
      odd: (n) => n % 2 === 1,
      sixdigits: (n) => String(n).length === 6,
      seven: (n) => n % 7 === 0,
      dozen: (n) => n % 12 === 0,
      sequence: (n) => String(n).includes("123"),
      descending: (n) => [...String(n)].every((digit, index, digits) => !index || Number(digit) === Number(digits[index - 1]) - 1),
      triple: (n) => /(\d)\1\1/.test(String(n)),
      factorial: (n) => [1, 2, 6, 24, 120, 720, 5040, 40320, 362880].includes(n),
      fibonacci: (n) => labels(n).includes("Fibonacci Number"),
      jackpot: (n) => String(n).includes("777"),
      nozero: (n) => !String(n).includes("0"),
      containszero: (n) => String(n).includes("0"),
      harshad: (n) => n % [...String(n)].reduce((sum, digit) => sum + Number(digit), 0) === 0,
      square: (n) => Number.isInteger(Math.sqrt(n)),
      alternating: (n) => [...String(n)].every((digit, index, digits) => !index || Number(digit) % 2 !== Number(digits[index - 1]) % 2),
      bookend: (n) => String(n)[0] === String(n).at(-1),
      fourtwenty: (n) => String(n).includes("420"),
      contains69: (n) => String(n).includes("69"),
      prime: (n) => labels(n).includes("Prime Number"),
      cube: (n) => Number.isInteger(Math.cbrt(n)),
      highdigits: (n) => [...String(n)].every((digit) => Number(digit) >= 5),
      eleven: (n) => n % 11 === 0,
      ascending: (n) => [...String(n)].every((digit, index, digits) => !index || Number(digit) === Number(digits[index - 1]) + 1),
      binary: (n) => /^[01]+$/.test(String(n)),
      power: (n) => n > 0 && (n & (n - 1)) === 0,
      pi: (n) => String(n).startsWith("314"),
      golden: (n) => String(n).startsWith("1618"),
      meaning: (n) => String(n).includes("42"),
      funny: (n) => n === 42069,
      million: (n) => n === 1_000_000,
      tau: (n) => String(n).startsWith("6283"),
      euler: (n) => String(n).startsWith("271"),
      leet: (n) => String(n).includes("1337"),
      devil: (n) => String(n).includes("666"),
      emergency: (n) => String(n).includes("911"),
      calendar: (n) => String(n).includes("365"),
      strobogrammatic: (n) => labels(n).includes("Strobogrammatic"),
      heavy: (n) => [...String(n)].reduce((sum, digit) => sum + Number(digit), 0) >= 45,
      luckyseven: (n) => String(n).includes("7"),
      unique: (n) => new Set(String(n)).size === String(n).length,
      spy: (n) => labels(n).includes("Spy Number"),
      blackjack: (n) => [...String(n)].reduce((sum, digit) => sum + Number(digit), 0) === 21,
    };
    for (const item of CASES) for (const drop of item.drops) for (const seed of [0, 1, 9, 10, 42, 999_999, 1_000_000]) {
      const number = generateTraitNumber(drop.id, seed);
      assert.ok(traits[drop.id](number), `${drop.id} failed for seed ${seed}: ${number}`);
      assert.ok(number >= 0 && number <= 1_000_000);
    }
  });

  test("daily rolls fund several entry cases without inflating the economy", () => {
    assert.equal(dailyReward(0), 15000);
    assert.equal(dailyReward(1000000), 25000);
    assert.ok(dailyReward(0) / CASES[0].cost >= 3);
  });

  test("gold coins immediately resolve through the rare-only second spin", () => {
    assert.equal(GOLD_COIN_CHANCE, 20_000 / 1_000_001);
    assert.equal(isGoldCoinRoll(0), true);
    assert.equal(isGoldCoinRoll(19_999), true);
    assert.equal(isGoldCoinRoll(20_000), false);
    assert.throws(() => isGoldCoinRoll(1_000_001), RangeError);
    const goldOutcome = drawCaseOutcome(CASES[0], 19_999, 0);
    assert.equal(goldOutcome.gold, true);
    assert.equal(goldOutcome.drop.rarity, "rare");
    const normalOutcome = drawCaseOutcome(CASES[0], 20_000, 0);
    assert.equal(normalOutcome.gold, false);
    assert.equal(normalOutcome.drop.rarity, "common");
    for (const item of CASES.filter((caseItem) => caseItem.bonusType === "gold")) for (const roll of [0, 0.25, 0.5, 0.75, 0.999999]) {
      assert.ok(["rare", "epic", "mythic"].includes(drawGoldDrop(item, roll).rarity));
    }
    const nested = CASES.find((item) => item.bonusType === "nested");
    const nestedOutcome = drawCaseOutcome(nested, 0, 0.999999);
    assert.equal(nestedOutcome.gold, true);
    assert.ok(nestedOutcome.drop.goldChance > 0);
  });

  test("case battle modes choose the intended winner", () => {
    const histories = [[100, 900, 200], [500, 400, 400]];
    assert.equal(battleWinner("classic", histories), 1);
    assert.equal(battleWinner("crazy", histories), 0);
    assert.equal(battleWinner("clutch", histories), 0);
    assert.equal(battleWinner("terminal", histories), 1);
    assert.equal(battleWinner("share", histories), -1);
    assert.equal(battleWinner("classic", [[100], [100]]), -1);
    assert.equal(battleWinner("classic", [[100, 100], [50, 50], [300, 10], [20, 20]]), 2);
    assert.equal(battleWinner("crazy", [[100], [20], [80]]), 1);
    assert.equal(splitBattlePot(123.45, 2), 61.73);
    assert.equal(splitBattlePot(123.45, 6), 20.58);
  });
});

import { randomInt as cryptoRandomInt } from "node:crypto";
import {
  ALL_ROLL_COUNT,
  CASES,
  TRAITS,
  casePayout,
  drawCaseOutcome,
  generateTraitNumber,
} from "../economy.js";
import { evaluateBadges } from "../badges.js";

export const FORMATS = {
  1: [[0], [1]],
  2: [[0], [1], [2]],
  3: [[0], [1], [2], [3]],
  "2v2": [
    [0, 1],
    [2, 3],
  ],
  "3v3": [
    [0, 1, 2],
    [3, 4, 5],
  ],
  "2v2v2": [
    [0, 1],
    [2, 3],
    [4, 5],
  ],
};
export const MODES = new Set([
  "classic",
  "crazy",
  "clutch",
  "terminal",
  "share",
]);
export const caseMap = new Map(CASES.map((item) => [item.id, item]));
export const toCents = (value) => Math.round(value * 100);

export function makeOutcomes(battle, randomInt = cryptoRandomInt) {
  return battle.caseIds.map((caseId, round) => {
    const item = caseMap.get(caseId);
    return battle.players.map((_, seat) => {
      const trigger = randomInt(ALL_ROLL_COUNT),
        itemRoll = randomInt(0x100000000) / 0x100000000,
        multiplierRoll = randomInt(0x100000000) / 0x100000000;
      const { gold, drop, multiplier } = drawCaseOutcome(item, trigger, itemRoll, multiplierRoll);
      const seed = randomInt(ALL_ROLL_COUNT),
        number = generateTraitNumber(drop.id, seed);
      const badges = evaluateBadges(number),
        traitScore = badges.reduce((sum, badge) => sum + badge.score, 0),
        payout = casePayout(item, traitScore, multiplier),
        score = multiplier === null ? traitScore : Math.round(payout * 1_000);
      return {
        seat,
        trait: drop.id,
        name: TRAITS[drop.id][0],
        rarity: drop.rarity,
        number,
        score,
        payout: toCents(payout),
        bonus: gold,
        multiplier,
      };
    });
  });
}

export function winningTeams(mode, outcomes, teams) {
  if (mode === "share") return teams.map((_, index) => index);
  const histories = teams.map((members) =>
    members.flatMap((seat) => outcomes.map((round) => round[seat].score)),
  );
  let values;
  if (mode === "classic")
    values = histories.map((h) => h.reduce((a, b) => a + b, 0));
  else if (mode === "crazy")
    values = histories.map((h) => -h.reduce((a, b) => a + b, 0));
  else if (mode === "clutch") values = histories.map((h) => Math.max(...h));
  else
    values = teams.map((members) =>
      members.reduce((sum, seat) => sum + outcomes.at(-1)[seat].score, 0),
    );
  const best = Math.max(...values);
  return values.flatMap((value, index) => (value === best ? [index] : []));
}

export function allocate(battle) {
  const pot = battle.outcomes
    .flat()
    .reduce((sum, result) => sum + result.payout, 0);
  const winning = winningTeams(battle.mode, battle.outcomes, battle.teams);
  const seats = winning.flatMap((team) => battle.teams[team]);
  const each = Math.floor(pot / seats.length),
    remainder = pot % seats.length;
  const payouts = battle.players.map((player) => ({
    seat: player.seat,
    amount: 0,
  }));
  seats.forEach((seat, index) => {
    payouts[seat].amount = each + (index < remainder ? 1 : 0);
  });
  return { pot, winningTeams: winning, payouts };
}

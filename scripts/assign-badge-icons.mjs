import fs from "node:fs";
import path from "node:path";

const catalog = JSON.parse(fs.readFileSync("assets/badges/catalog.json", "utf8"));
const lucideDir = "node_modules/lucide-static/icons";
const outputDir = "assets/badges/icons";
const iconNames = fs.readdirSync(lucideDir).filter((file) => file.endsWith(".svg")).map((file) => file.slice(0, -4));
const available = new Set(iconNames);
const used = new Set();
fs.mkdirSync(outputDir, { recursive: true });

const colors = { common: "#c7d0d8", uncommon: "#73f0ad", rare: "#53e7ff", epic: "#b47aff", anomaly: "#ff56d8", mythic: "#ffc447" };
const semanticGroups = [
  [/jackpot|royal|high roller/, ["crown", "gem", "trophy", "sparkles", "badge-dollar-sign"]],
  [/lucky|seven/, ["clover", "dice-6", "horseshoe", "sparkle", "badge-check"]],
  [/void|zero|ghost|eon|epoch/, ["circle-off", "ghost", "moon", "orbit", "circle-slash"]],
  [/mountain|hill|mesa/, ["mountain", "mountain-snow", "chart-no-axes-combined", "tent-tree"]],
  [/valley|canyon|dune|slope/, ["waves", "chart-spline", "route", "land-plot"]],
  [/cascade|waterfall/, ["waves", "droplets", "move-down", "chevrons-down"]],
  [/ascension|steps|sequence|consecutive/, ["stairs", "list-ordered", "trending-up", "chart-no-axes-column-increasing"]],
  [/decay|slopes/, ["trending-down", "chart-no-axes-column-decreasing", "chevrons-down"]],
  [/pair|kind|full house|flush/, ["copy", "panels-top-left", "layers", "gallery-horizontal-end", "boxes"]],
  [/palindrome|mirror|echo|rhyme|bookend/, ["between-horizontal-start", "scan-line", "repeat-2", "book-open", "flip-horizontal-2"]],
  [/pi|tau|e slice|euler|ratio|equation|factorial|power|prime|fibonacci|pronic/, ["pi", "sigma", "radical", "superscript", "binary", "calculator"]],
  [/calendar|day|century|millennium/, ["calendar-days", "calendar-clock", "clock-3", "hourglass"]],
  [/devil|hell|infernal/, ["flame", "skull", "badge-alert", "bomb"]],
  [/botanist|420|hotbox/, ["leaf", "sprout", "flower-2", "trees"]],
  [/emergency|mayday|error|404/, ["siren", "triangle-alert", "badge-x", "octagon-alert"]],
  [/binary|leet|scramble/, ["binary", "braces", "code-xml", "shuffle"]],
  [/odd|even|duality|trinity|quartet|digit/, ["split", "grid-2x2", "grid-3x3", "hash"]],
  [/clean|grounded|balanced|equilibrium/, ["scale", "circle-check", "shield-check", "align-center"]],
];
const ignored = new Set(["a", "an", "and", "by", "contains", "digit", "digits", "exact", "in", "is", "number", "numbers", "of", "the", "two"]);

function hashLabel(label) {
  let hash = 2166136261;
  for (const character of label) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function slug(label) {
  const name = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${name || "badge"}-${hashLabel(label).toString(36)}`;
}

function words(value) {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => !ignored.has(word)) || []);
}

function selectIcon(badge) {
  const text = `${badge.label} ${badge.description}`.toLowerCase();
  const semantic = semanticGroups.find(([pattern]) => pattern.test(text))?.[1].find((name) => available.has(name) && !used.has(name));
  if (semantic) return semantic;
  const badgeWords = words(text);
  let best = "", bestScore = 0;
  for (const icon of iconNames) {
    if (used.has(icon)) continue;
    const iconWords = words(icon.replaceAll("-", " "));
    let score = 0;
    for (const word of badgeWords) if (iconWords.has(word)) score += word.length * 3;
    if (text.includes(icon.replaceAll("-", " "))) score += 12;
    if (score > bestScore) { best = icon; bestScore = score; }
  }
  if (best) return best;
  const remaining = iconNames.filter((icon) => !used.has(icon));
  return remaining[hashLabel(badge.label) % remaining.length];
}

const mapping = {};
for (const badge of catalog) {
  const icon = selectIcon(badge);
  used.add(icon);
  mapping[badge.label] = icon;
  const source = fs.readFileSync(path.join(lucideDir, `${icon}.svg`), "utf8")
    .replaceAll("currentColor", colors[badge.rarity] || colors.common)
    .replace('width="24"', 'width="128"')
    .replace('height="24"', 'height="128"')
    .replace('stroke-width="2"', 'stroke-width="1.7"');
  fs.writeFileSync(path.join(outputDir, `${slug(badge.label)}.svg`), source);
}

fs.writeFileSync("assets/badges/icon-map.json", JSON.stringify(mapping, null, 2));
const rankIcons = { trash: "trash-2", common: "circle", uncommon: "sprout", rare: "gem", epic: "sparkles", anomaly: "orbit", mythic: "crown" };
fs.mkdirSync("assets/badges/ranks", { recursive: true });
for (const [rank, icon] of Object.entries(rankIcons)) {
  const source = fs.readFileSync(path.join(lucideDir, `${icon}.svg`), "utf8")
    .replaceAll("currentColor", colors[rank])
    .replace('width="24"', 'width="128"')
    .replace('height="24"', 'height="128"')
    .replace('stroke-width="2"', 'stroke-width="1.7"');
  fs.writeFileSync(`assets/badges/ranks/${rank}.svg`, source);
}
fs.copyFileSync("node_modules/lucide-static/LICENSE", "assets/badges/LUCIDE_LICENSE");
console.log(`Assigned ${used.size} distinct Lucide graphics to ${catalog.length} badges.`);

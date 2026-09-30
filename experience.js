import { CASES } from "./economy.js";

const STORAGE_KEY = "number-zero-experience-v1";
const ROLL_STEPS = [1, 10, 50, 100, 500, 1_000, 5_000, 10_000];

export function nextRollMilestone(rolls = 0) {
  const count = Math.max(0, Number(rolls) || 0);
  return (
    ROLL_STEPS.find((step) => step > count) ??
    Math.ceil((count + 1) / 10_000) * 10_000
  );
}

export function explorationProgress(discovered, total) {
  const count =
    discovered instanceof Set
      ? discovered.size
      : new Set(discovered || []).size;
  const maximum = Math.max(0, Number(total) || 0);
  return {
    value: Math.min(count, maximum),
    max: maximum,
    percent: maximum
      ? Math.round((Math.min(count, maximum) / maximum) * 100)
      : 0,
  };
}

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function readPrefs() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      favorites: Array.isArray(value.favorites) ? value.favorites : [],
      discovered: Array.isArray(value.discovered) ? value.discovered : [],
      ambience: value.ambience !== false,
      extras: value.extras !== false,
    };
  } catch {
    return { favorites: [], discovered: [], ambience: true, extras: true };
  }
}

export function initExperience({ getState, navigate, inspectCase }) {
  if (typeof getState !== "function")
    throw new TypeError("getState is required");
  const tabs = document.querySelector(".mode-tabs");
  if (!tabs || document.querySelector(".experience-bar"))
    return { update() {}, setMode() {}, discoverCase() {} };

  const prefs = readPrefs();
  const favorites = new Set(prefs.favorites);
  const discovered = new Set(prefs.discovered);
  let mode = "sandbox";
  let previousSummary = "";
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  const save = () =>
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        favorites: [...favorites],
        discovered: [...discovered],
        ambience: prefs.ambience,
        extras: prefs.extras,
      }),
    );

  const bar = make("section", "experience-bar");
  bar.setAttribute("aria-label", "Local journey progress");
  const copy = make("div", "experience-progress-copy");
  const label = make("strong", "", "LOCAL JOURNEY");
  const status = make("span", "");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const meter = make("progress", "");
  meter.setAttribute("aria-label", "Collection exploration progress");
  const open = make("button", "experience-open", "EXPLORE COLLECTION");
  open.type = "button";
  const globalPause = make("button", "experience-open", "PAUSE AMBIENCE");
  globalPause.type = "button";
  copy.append(label, status, meter);
  bar.append(copy, globalPause, open);
  tabs.after(bar);

  const dialog = make("dialog", "experience-drawer");
  dialog.setAttribute("aria-labelledby", "experience-title");
  const header = make("header", "");
  const headingWrap = make("div", "");
  headingWrap.append(make("p", "experience-kicker", "LOCAL COLLECTION INDEX"));
  const heading = make("h2", "", "DISCOVER YOUR SIGNAL");
  heading.id = "experience-title";
  headingWrap.append(heading);
  const close = make("button", "experience-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close collection explorer");
  header.append(headingWrap, close);
  const intro = make(
    "p",
    "experience-intro",
    "Favorites and inspected cases stay in this browser. Online account and lobby progress are separate.",
  );
  const controls = make("div", "experience-controls");
  const ambience = make("button", "", "");
  ambience.type = "button";
  const extras = make("button", "", "");
  extras.type = "button";
  controls.append(ambience, extras);
  const filters = make("div", "experience-filters");
  const search = make("input", "");
  search.type = "search";
  search.placeholder = "Search cases or collections…";
  search.setAttribute("aria-label", "Search collection index");
  const scope = make("select", "");
  scope.setAttribute("aria-label", "Collection index filter");
  for (const [value, text] of [
    ["unexplored", "Unexplored"],
    ["all", "All cases"],
    ["favorites", "Favorites"],
  ]) {
    const option = make("option", "", text);
    option.value = value;
    scope.append(option);
  }
  filters.append(search, scope);
  const list = make("div", "experience-discovery-list");
  dialog.append(header, intro, controls, filters, list);
  document.body.append(dialog);

  const next = make("aside", "experience-next");
  next.setAttribute("aria-label", "Suggested next action");
  const nextCopy = make("div", "");
  nextCopy.append(make("strong", "", "NEXT SIGNAL"), make("span", ""));
  const nextButton = make("button", "", "");
  nextButton.type = "button";
  next.append(nextCopy, nextButton);
  const rarity = document.querySelector(".rarity-key");
  (rarity || document.querySelector("main")).before(next);

  function allCases() {
    const custom = getState()?.customCases || [];
    const known = new Set(CASES.map((item) => item.id));
    return [
      ...CASES,
      ...custom.filter((item) => item?.id && !known.has(item.id)),
    ];
  }
  function applyEnvironment() {
    const paused = !prefs.ambience || media.matches || document.hidden;
    document.body.dataset.ambience = paused ? "paused" : "active";
    document.body.dataset.experienceExtras = prefs.extras ? "shown" : "hidden";
    ambience.textContent = `${prefs.ambience ? "PAUSE" : "RESUME"} AMBIENCE`;
    ambience.setAttribute("aria-pressed", String(!prefs.ambience));
    globalPause.textContent = media.matches
      ? "REDUCED MOTION"
      : ambience.textContent;
    globalPause.setAttribute("aria-pressed", String(paused));
    extras.textContent = `${prefs.extras ? "HIDE" : "SHOW"} CONTEXT`;
    extras.setAttribute("aria-pressed", String(!prefs.extras));
  }
  let visibleCount = 24;
  function renderDiscovery() {
    list.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const cases = allCases().filter(
      (item) =>
        `${item.name} ${item.category}`.toLowerCase().includes(query) &&
        (scope.value === "favorites"
          ? favorites.has(item.id)
          : scope.value === "unexplored"
            ? !discovered.has(item.id)
            : true),
    );
    if (!cases.length)
      list.append(
        make(
          "p",
          "experience-intro",
          scope.value === "favorites"
            ? "No saved cases match. Star a case in All cases to keep it here."
            : "No cases match. Try another filter or collection.",
        ),
      );
    cases.slice(0, visibleCount).forEach((candidate) => {
      const row = make("article", "experience-branch");
      const branchCopy = make("div", "");
      branchCopy.append(
        make("strong", "", candidate.name),
        make(
          "span",
          "",
          `${candidate.category} · ${candidate.risk} · ${discovered.has(candidate.id) ? "INSPECTED" : "UNEXPLORED"}`,
        ),
      );
      const favorite = make(
        "button",
        "experience-favorite",
        favorites.has(candidate.id) ? "★" : "☆",
      );
      favorite.type = "button";
      favorite.setAttribute(
        "aria-label",
        `${favorites.has(candidate.id) ? "Remove" : "Add"} ${candidate.name} ${favorites.has(candidate.id) ? "from" : "to"} favorites`,
      );
      favorite.setAttribute(
        "aria-pressed",
        String(favorites.has(candidate.id)),
      );
      favorite.addEventListener("click", () => {
        favorites.has(candidate.id)
          ? favorites.delete(candidate.id)
          : favorites.add(candidate.id);
        save();
        favorite.textContent = favorites.has(candidate.id) ? "★" : "☆";
        favorite.setAttribute(
          "aria-pressed",
          String(favorites.has(candidate.id)),
        );
        favorite.setAttribute(
          "aria-label",
          `${favorites.has(candidate.id) ? "Remove" : "Add"} ${candidate.name} ${favorites.has(candidate.id) ? "from" : "to"} favorites`,
        );
      });
      const inspect = make(
        "button",
        "experience-inspect",
        discovered.has(candidate.id) ? "REVISIT" : "INSPECT",
      );
      inspect.type = "button";
      inspect.addEventListener("click", () => {
        discoverCase(candidate.id);
        dialog.close();
        if (typeof inspectCase === "function") inspectCase(candidate.id);
      });
      row.append(branchCopy, favorite, inspect);
      list.append(row);
    });
    if (cases.length > visibleCount) {
      const more = make(
        "button",
        "experience-browse",
        `SHOW MORE · ${cases.length - visibleCount} REMAINING`,
      );
      more.type = "button";
      more.onclick = () => {
        visibleCount += 24;
        renderDiscovery();
      };
      list.append(more);
    }
    const browse = make(
      "button",
      "experience-browse",
      "BROWSE FULL CASE STORE →",
    );
    browse.type = "button";
    browse.addEventListener("click", () => {
      dialog.close();
      if (typeof navigate === "function") navigate("store");
    });
    list.append(browse);
  }
  function update() {
    const state = getState() || {};
    const progress = explorationProgress(discovered, allCases().length);
    meter.max = Math.max(1, progress.max);
    meter.value = progress.value;
    status.textContent = `${Number(state.badges?.length || 0).toLocaleString()} badges · ${Number(state.rolls || 0).toLocaleString()} rolls · ${progress.value}/${progress.max} cases inspected`;
    const summary = `${state.rolls || 0}:${state.badges?.length || 0}:${state.casesOpened || 0}:${state.inventory?.length || 0}`;
    if (previousSummary && summary !== previousSummary) {
      bar.classList.remove("experience-changed");
      requestAnimationFrame(() => bar.classList.add("experience-changed"));
    }
    previousSummary = summary;
    const message = next.querySelector("span");
    if (mode === "store") {
      message.textContent =
        progress.value < progress.max
          ? "Inspect an unexplored case; rendering alone never counts."
          : "Your local catalog is fully inspected.";
      nextButton.textContent = "OPEN INDEX";
      nextButton.onclick = () => open.click();
    } else if (mode === "online" || mode === "duel") {
      message.textContent =
        mode === "duel"
          ? "Publish your selection, then choose real players or labelled bots."
          : "Explore the case pools before choosing your next battle.";
      nextButton.textContent = "INSPECT CASE POOLS";
      nextButton.onclick = () => open.click();
    } else if (mode === "inventory") {
      message.textContent = state.inventory?.length
        ? `${state.inventory.length} local item${state.inventory.length === 1 ? "" : "s"} ready to explore.`
        : "Your inventory is empty; browse audited case pools.";
      nextButton.textContent = state.inventory?.length
        ? "VIEW INVENTORY"
        : "BROWSE CASES";
      nextButton.onclick = () =>
        navigate?.(state.inventory?.length ? "inventory" : "store");
    } else {
      const target = nextRollMilestone(state.rolls);
      message.textContent = `${target - (Number(state.rolls) || 0)} measured roll${target - (Number(state.rolls) || 0) === 1 ? "" : "s"} to ${target.toLocaleString()}. No streak expires.`;
      nextButton.textContent = "EXPLORE BRANCHES";
      nextButton.onclick = () => open.click();
    }
  }
  function setMode(nextMode) {
    mode = String(nextMode || "sandbox");
    document.body.dataset.experienceMode = mode;
    update();
  }
  function discoverCase(id) {
    if (!allCases().some((item) => item.id === id)) return false;
    const added = !discovered.has(id);
    discovered.add(id);
    save();
    update();
    return added;
  }

  open.addEventListener("click", () => {
    renderDiscovery();
    dialog.showModal();
    document.body.dataset.experienceFocus = "true";
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    delete document.body.dataset.experienceFocus;
    open.focus();
  });
  ambience.addEventListener("click", () => {
    prefs.ambience = !prefs.ambience;
    save();
    applyEnvironment();
  });
  globalPause.addEventListener("click", () => ambience.click());
  extras.addEventListener("click", () => {
    prefs.extras = !prefs.extras;
    save();
    applyEnvironment();
  });
  for (const control of [search, scope])
    control.addEventListener("input", () => {
      visibleCount = 24;
      renderDiscovery();
    });
  const focusObserver = new MutationObserver(() => {
    document.body.dataset.experienceFocus = String(
      Boolean(document.querySelector("dialog[open]")),
    );
  });
  focusObserver.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  document.addEventListener("visibilitychange", applyEnvironment);
  media.addEventListener?.("change", applyEnvironment);
  applyEnvironment();
  update();
  return { update, setMode, discoverCase };
}

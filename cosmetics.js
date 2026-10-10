// Player looks on the client: profile pictures, frames, name colours and titles.
// `look` comes from the server ({ avatar, frame, color, title, titleName }, any field may be null).
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Profile pictures: cells of assets/avatars.webp (a 6×6 grid, row by row in this order), each with a
// gradient shown while the image loads.
const AVATAR_ART = Object.fromEntries(
  [
    ["orb", "#53e7ff", "#2b3cff"], ["bolt", "#ffd43b", "#ff8a1f"], ["diamond", "#9cf3ff", "#4b6bff"], ["chip", "#ff4d6d", "#8a1030"], ["spade", "#2b3450", "#0b0e17"],
    ["heart", "#ff4fd8", "#ff2d55"], ["club", "#2ee59d", "#0b6b45"], ["star", "#ffd43b", "#ff4fd8"], ["coin", "#ffe57a", "#c99a10"], ["flame", "#ff8a5c", "#ff2d55"],
    ["ghost", "#ae70ff", "#3b1d6e"], ["planet", "#53e7ff", "#ae70ff"], ["robot", "#9aa3b8", "#2b3450"], ["ace", "#f6f8ff", "#c9cfe0"], ["yinyang", "#c7ff36", "#53e7ff"],
    ["gem", "#2ee59d", "#0b6b45"], ["bomb", "#ff4d6d", "#3a0d1a"], ["rocket", "#53e7ff", "#2b3cff"], ["target", "#ff4d6d", "#ffd43b"], ["eye", "#ae70ff", "#ff4fd8"],
    ["dice", "#f6f8ff", "#9aa3b8"], ["clover", "#2ee59d", "#c7ff36"], ["crown", "#ffd43b", "#ff8a1f"], ["joker", "#ae70ff", "#2ee59d"], ["seven", "#ff2d55", "#ffd43b"],
    ["cherry", "#ff4fd8", "#ff2d55"], ["moon", "#2b3cff", "#0b0e17"], ["wheel", "#13865e", "#0b3a2e"], ["sword", "#9aa3b8", "#2b3450"], ["cat", "#ffd43b", "#ff8a5c"],
    ["chips", "#53e7ff", "#ff4fd8"], ["alien", "#c7ff36", "#2ee59d"], ["revolver", "#9aa3b8", "#3a0d1a"], ["skull", "#ff4d6d", "#11141c"], ["shark", "#2b3cff", "#53e7ff"],
  ].map(([id, from, to], index) => [id, { from, to, x: index % 6, y: Math.floor(index / 6) }]),
);

/** Round profile picture (artwork or the player's initial) with the equipped frame. */
export function avatarMarkup(look, name, size = 40) {
  const art = look?.avatar && AVATAR_ART[look.avatar];
  const initial = escapeHtml(String(name || "?").trim()[0]?.toUpperCase() || "?");
  const inner = art ? "" : `<b>${initial}</b>`;
  const style = `--size:${size}px${art ? `;--av-a:${art.from};--av-b:${art.to};--av-x:${art.x};--av-y:${art.y}` : ""}`;
  return `<span class="nz-avatar${art ? " has-art" : ""}" style="${style}" data-frame="${escapeHtml(look?.frame || "")}" title="${escapeHtml(name)}">${inner}</span>`;
}

/** Player name with their equipped name colour. */
export function nameMarkup(look, name) {
  return `<span class="nz-name" data-color="${escapeHtml(look?.color || "")}">${escapeHtml(name)}</span>`;
}

/** Small title tag (e.g. "HIGH ROLLER"), or "" when none is equipped. */
export function titleMarkup(look) {
  return look?.titleName ? `<span class="nz-title">${escapeHtml(look.titleName)}</span>` : "";
}

// Player looks on the client: profile pictures, frames, name colours and titles.
// `look` comes from the server ({ avatar, frame, color, title, titleName }, any field may be null).
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Profile pictures: [background from, background to, 24×24 SVG artwork].
const S = (d, extra = "") => `<path d="${d}" ${extra}/>`;
export const AVATAR_ART = {
  orb: ["#53e7ff", "#2b3cff", `<circle cx="12" cy="12" r="6.5" fill="#fff" opacity=".9"/><circle cx="12" cy="12" r="9" fill="none" stroke="#fff" stroke-width="1.2" opacity=".5"/><circle cx="9.5" cy="9.5" r="2" fill="#53e7ff"/>`],
  bolt: ["#ffd43b", "#ff8a1f", S("M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2z", 'fill="#1b1200"')],
  diamond: ["#9cf3ff", "#4b6bff", S("M6 4h12l4 5-10 12L2 9z", 'fill="#fff" opacity=".92"') + S("M2 9h20M8 4l4 17 4-17", 'fill="none" stroke="#4b6bff" stroke-width="1"')],
  chip: ["#ff4d6d", "#8a1030", `<circle cx="12" cy="12" r="9" fill="#fff"/><circle cx="12" cy="12" r="9" fill="none" stroke="#c9213f" stroke-width="3.2" stroke-dasharray="3.5 3.6"/><circle cx="12" cy="12" r="4.6" fill="#c9213f"/>`],
  spade: ["#2b3450", "#0b0e17", S("M12 3c3.5 4 7 6.2 7 9.6a3.6 3.6 0 0 1-6 2.6l1.2 4.8H9.8l1.2-4.8a3.6 3.6 0 0 1-6-2.6C5 9.2 8.5 7 12 3z", 'fill="#fff"')],
  heart: ["#ff4fd8", "#ff2d55", S("M12 20s-8-5-8-11a4.4 4.4 0 0 1 8-2.4A4.4 4.4 0 0 1 20 9c0 6-8 11-8 11z", 'fill="#fff"')],
  club: ["#2ee59d", "#0b6b45", `<circle cx="12" cy="7.5" r="3.6" fill="#fff"/><circle cx="7.5" cy="13" r="3.6" fill="#fff"/><circle cx="16.5" cy="13" r="3.6" fill="#fff"/>` + S("M12 11l1.6 9h-3.2z", 'fill="#fff"')],
  star: ["#ffd43b", "#ff4fd8", S("m12 2.5 2.9 6.2 6.6.7-5 4.5 1.4 6.6L12 17.2l-5.9 3.3 1.4-6.6-5-4.5 6.6-.7z", 'fill="#fff"')],
  coin: ["#ffe57a", "#c99a10", `<circle cx="12" cy="12" r="8.5" fill="#ffd43b" stroke="#fff3b0" stroke-width="1.4"/><text x="12" y="16.2" text-anchor="middle" font-size="11" font-weight="900" fill="#7a5a00" font-family="Barlow Condensed,sans-serif">CR</text>`],
  flame: ["#ff8a5c", "#ff2d55", S("M12 2c1 4 5 5.5 5 11a5 5 0 0 1-10 0c0-2.6 1.4-4 2.4-5.2.2 1.8 1 2.8 2 3.2C11 8 10.6 5 12 2z", 'fill="#ffe57a"')],
  ghost: ["#ae70ff", "#3b1d6e", S("M5 21V11a7 7 0 0 1 14 0v10l-2.3-1.8L14.3 21 12 19.2 9.7 21l-2.4-1.8z", 'fill="#fff"') + `<circle cx="9.5" cy="11" r="1.4" fill="#3b1d6e"/><circle cx="14.5" cy="11" r="1.4" fill="#3b1d6e"/>`],
  planet: ["#53e7ff", "#ae70ff", `<circle cx="12" cy="12" r="5.6" fill="#fff"/><ellipse cx="12" cy="12" rx="10" ry="3.2" fill="none" stroke="#ffd43b" stroke-width="1.6" transform="rotate(-20 12 12)"/>`],
  robot: ["#9aa3b8", "#2b3450", `<rect x="5" y="7" width="14" height="11" rx="3" fill="#fff"/><circle cx="9.5" cy="12.5" r="1.8" fill="#53e7ff"/><circle cx="14.5" cy="12.5" r="1.8" fill="#53e7ff"/>` + S("M12 7V4m-1.5 0h3", 'stroke="#fff" stroke-width="1.6" stroke-linecap="round"')],
  ace: ["#f6f8ff", "#c9cfe0", `<rect x="6" y="3" width="12" height="18" rx="2" fill="#fff" stroke="#11141c" stroke-width="1"/><text x="9" y="8.6" font-size="5" font-weight="900" fill="#11141c" font-family="Barlow Condensed,sans-serif">A</text>` + S("M12 9c1.8 2 3.4 3 3.4 4.8a1.8 1.8 0 0 1-3 1.3l.6 2.4h-2l.6-2.4a1.8 1.8 0 0 1-3-1.3C8.6 12 10.2 11 12 9z", 'fill="#11141c"')],
  yinyang: ["#c7ff36", "#53e7ff", `<circle cx="12" cy="12" r="8" fill="#fff"/>` + S("M12 4a4 4 0 0 1 0 8 4 4 0 0 0 0 8 8 8 0 0 1 0-16z", 'fill="#0b0e17"') + `<circle cx="12" cy="8" r="1.3" fill="#fff"/><circle cx="12" cy="16" r="1.3" fill="#0b0e17"/>`],
  gem: ["#2ee59d", "#0b6b45", S("M12 3 20 9l-8 12L4 9z", 'fill="#b9ffe1"') + S("M4 9h16M12 3v18M8 6l4 15 4-15", 'fill="none" stroke="#0b6b45" stroke-width=".9"')],
  bomb: ["#ff4d6d", "#3a0d1a", `<circle cx="11" cy="14" r="6.5" fill="#11141c"/><circle cx="9" cy="12" r="1.6" fill="#fff" opacity=".5"/>` + S("M15 9.5 17.5 7M18 4l.6 1.6L20 6l-1.4.5L18 8l-.6-1.5L16 6l1.4-.4z", 'stroke="#ffd43b" stroke-width="1.4" fill="#ffd43b"')],
  rocket: ["#53e7ff", "#2b3cff", S("M14 3c4 0 7 3 7 7-2 4-6 7-9 8l-6-6c1-3 4-7 8-9z", 'fill="#fff"') + `<circle cx="15" cy="9" r="1.8" fill="#2b3cff"/>` + S("M6 12l-3 1 1-3zm6 6-1 3 3-1zM5 19c0-2 1-3 2-3", 'fill="#ff8a5c" stroke="#ff8a5c" stroke-width="1.2"')],
  target: ["#ff4d6d", "#ffd43b", `<circle cx="12" cy="12" r="8.5" fill="#fff"/><circle cx="12" cy="12" r="6" fill="#ff2d55"/><circle cx="12" cy="12" r="3.5" fill="#fff"/><circle cx="12" cy="12" r="1.5" fill="#ff2d55"/>`],
  eye: ["#ae70ff", "#ff4fd8", S("M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z", 'fill="#fff"') + `<circle cx="12" cy="12" r="3.6" fill="#ae70ff"/><circle cx="12" cy="12" r="1.6" fill="#0b0e17"/>`],
  dice: ["#f6f8ff", "#9aa3b8", `<rect x="4.5" y="4.5" width="15" height="15" rx="3.5" fill="#fff" stroke="#11141c" stroke-width="1"/><circle cx="8.5" cy="8.5" r="1.5" fill="#e0283f"/><circle cx="12" cy="12" r="1.5" fill="#e0283f"/><circle cx="15.5" cy="15.5" r="1.5" fill="#e0283f"/>`],
  clover: ["#2ee59d", "#c7ff36", `<circle cx="9" cy="9" r="3.4" fill="#fff"/><circle cx="15" cy="9" r="3.4" fill="#fff"/><circle cx="9" cy="15" r="3.4" fill="#fff"/><circle cx="15" cy="15" r="3.4" fill="#fff"/>` + S("M12 12c1 3 3 6 5 8", 'stroke="#fff" stroke-width="1.6" fill="none"')],
  crown: ["#ffd43b", "#ff8a1f", S("M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5z", 'fill="#fff6c4"') + `<circle cx="12" cy="14.5" r="1.5" fill="#ff2d55"/>`],
  joker: ["#ae70ff", "#2ee59d", S("M4 9c2-4 5-5 8-2 3-3 6-2 8 2l-3 1-2-2-3 4-3-4-2 2z", 'fill="#ffd43b"') + `<circle cx="12" cy="15" r="4.5" fill="#fff"/>` + S("M10 15.6q2 1.6 4 0", 'stroke="#ff2d55" stroke-width="1.1" fill="none"')],
  seven: ["#ff2d55", "#ffd43b", `<text x="12" y="19" text-anchor="middle" font-size="19" font-weight="900" fill="#fff" stroke="#8a1030" stroke-width=".8" font-family="Barlow Condensed,sans-serif">7</text>`],
  cherry: ["#ff4fd8", "#ff2d55", `<circle cx="8" cy="16" r="3.8" fill="#fff"/><circle cx="16" cy="15" r="3.8" fill="#fff"/>` + S("M8 12.5C9 8 12 5 15 4m1 7.2C16 8 15.5 6 15 4m0 0 4-1", 'stroke="#c7ff36" stroke-width="1.5" fill="none" stroke-linecap="round"')],
  moon: ["#2b3cff", "#0b0e17", S("M15 3a8.5 8.5 0 1 0 6 13A7 7 0 0 1 15 3z", 'fill="#ffe57a"') + `<circle cx="6" cy="6" r=".9" fill="#fff"/><circle cx="19" cy="5" r=".7" fill="#fff"/>`],
  wheel: ["#13865e", "#0b3a2e", `<circle cx="12" cy="12" r="8.5" fill="#11141c" stroke="#ffd43b" stroke-width="1.4"/><circle cx="12" cy="12" r="8.5" fill="none" stroke="#c92f4b" stroke-width="3" stroke-dasharray="2.2 2.2"/><circle cx="12" cy="12" r="3" fill="#ffd43b"/>`],
  sword: ["#9aa3b8", "#2b3450", S("M18.5 3.5 20.5 5.5 9 17l-2-2zM6 14l4 4-1.5 1.5-1-1L5 21l-2-2 2.5-2.5-1-1z", 'fill="#fff"')],
  cat: ["#ffd43b", "#ff8a5c", S("M5 20v-9l-1-6 4.5 3h7L20 5l-1 6v9z", 'fill="#fff"') + `<circle cx="9.5" cy="13" r="1.2" fill="#11141c"/><circle cx="14.5" cy="13" r="1.2" fill="#11141c"/>` + S("M11 16h2l-1 1z", 'fill="#ff2d55"')],
  chips: ["#53e7ff", "#ff4fd8", `<ellipse cx="12" cy="17" rx="7" ry="2.6" fill="#ff2d55" stroke="#fff" stroke-width="1"/><ellipse cx="12" cy="13" rx="7" ry="2.6" fill="#2b3cff" stroke="#fff" stroke-width="1"/><ellipse cx="12" cy="9" rx="7" ry="2.6" fill="#2ee59d" stroke="#fff" stroke-width="1"/>`],
  alien: ["#c7ff36", "#2ee59d", S("M12 3c5 0 8 3.5 8 7.5S15 21 12 21 4 14.5 4 10.5 7 3 12 3z", 'fill="#0b0e17"') + S("M7 10.5c1.8 0 3.4 1 3.6 2.8-2 .2-3.6-.8-3.6-2.8zm10 0c-1.8 0-3.4 1-3.6 2.8 2 .2 3.6-.8 3.6-2.8z", 'fill="#c7ff36"')],
  revolver: ["#9aa3b8", "#3a0d1a", `<circle cx="12" cy="12" r="8" fill="#5d6678" stroke="#fff" stroke-width="1"/>` + [0, 1, 2, 3, 4, 5].map((i) => `<circle cx="${(12 + 4.6 * Math.cos((i * Math.PI) / 3 - Math.PI / 2)).toFixed(2)}" cy="${(12 + 4.6 * Math.sin((i * Math.PI) / 3 - Math.PI / 2)).toFixed(2)}" r="1.9" fill="${i ? "#11141c" : "#ffd43b"}"/>`).join("")],
  skull: ["#ff4d6d", "#11141c", S("M12 3a8 8 0 0 0-8 8c0 3 1.5 4.6 3 5.4V20h10v-3.6c1.5-.8 3-2.4 3-5.4a8 8 0 0 0-8-8z", 'fill="#fff"') + `<circle cx="9" cy="11.5" r="2" fill="#11141c"/><circle cx="15" cy="11.5" r="2" fill="#11141c"/>` + S("M11 15.5h2l-1-1.8z", 'fill="#11141c"')],
  shark: ["#2b3cff", "#53e7ff", S("M2 15c4-1 7-6 9-11 1 3 1 6 0 8 4 0 8 1 11 3-3 1-6 3-11 3-4 0-7-1-9-3z", 'fill="#fff"') + `<circle cx="17" cy="15" r=".9" fill="#11141c"/>`],
};

/** Round profile picture (artwork or the player's initial) with the equipped frame. */
export function avatarMarkup(look, name, size = 40) {
  const art = look?.avatar && AVATAR_ART[look.avatar];
  const initial = escapeHtml(String(name || "?").trim()[0]?.toUpperCase() || "?");
  const inner = art ? `<svg viewBox="0 0 24 24" aria-hidden="true">${art[2]}</svg>` : `<b>${initial}</b>`;
  const style = `--size:${size}px${art ? `;--av-a:${art[0]};--av-b:${art[1]}` : ""}`;
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

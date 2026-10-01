// GitHub Pages uses the hosted API; Render and local previews stay same-origin.
export const API_BASE =
  location.hostname === "daminion73.github.io"
    ? "https://number-zero.onrender.com"
    : "";

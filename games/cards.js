// Shared playing-card rendering and physics-style motion for Blackjack and Baccarat.
import { cardInfo } from "../casino-core.js";

const PIP_LAYOUTS = {
  2: [[50, 18], [50, 82, true]],
  3: [[50, 18], [50, 50], [50, 82, true]],
  4: [[30, 18], [70, 18], [30, 82, true], [70, 82, true]],
  5: [[30, 18], [70, 18], [50, 50], [30, 82, true], [70, 82, true]],
  6: [[30, 18], [70, 18], [30, 50], [70, 50], [30, 82, true], [70, 82, true]],
  7: [[30, 18], [70, 18], [50, 34], [30, 50], [70, 50], [30, 82, true], [70, 82, true]],
  8: [[30, 18], [70, 18], [50, 34], [30, 50], [70, 50], [50, 66, true], [30, 82, true], [70, 82, true]],
  9: [[30, 16], [70, 16], [30, 39], [70, 39], [50, 50], [30, 61, true], [70, 61, true], [30, 84, true], [70, 84, true]],
  10: [[30, 16], [70, 16], [50, 28], [30, 39], [70, 39], [30, 61, true], [70, 61, true], [50, 72, true], [30, 84, true], [70, 84, true]],
};

function centerMarkup(rank, suit) {
  if (rank === "A") return `<span class="pc-ace">${suit}</span>`;
  if (["J", "Q", "K"].includes(rank))
    return `<span class="pc-court"><b>${rank}</b><i>${suit}</i></span>`;
  const pips = PIP_LAYOUTS[Number(rank)] || [];
  return `<span class="pc-pips">${pips
    .map(([x, y, flipped]) => `<i style="left:${x}%;top:${y}%"${flipped ? ' class="pc-flipped"' : ""}>${suit}</i>`)
    .join("")}</span>`;
}

export function cardFaceMarkup(index) {
  const { rank, suit, red } = cardInfo(index);
  return `
    <div class="pc-face pc-front${red ? " pc-red" : ""}">
      <span class="pc-corner pc-top"><b>${rank}</b><i>${suit}</i></span>
      ${centerMarkup(rank, suit)}
      <span class="pc-corner pc-bottom"><b>${rank}</b><i>${suit}</i></span>
    </div>`;
}

const BACK_MARKUP = `<div class="pc-face pc-back"><span class="pc-back-logo">N<em>//</em>Z</span></div>`;

/** Creates a card element. `index === null` renders a face-down card. */
export function createCard(index, { faceDown = false } = {}) {
  const card = document.createElement("div");
  card.className = "pc-card";
  const hidden = faceDown || index === null || index === undefined;
  card.dataset.card = hidden ? "back" : String(index);
  card.innerHTML = `<div class="pc-inner${hidden ? " pc-down" : ""}">${hidden ? "" : cardFaceMarkup(index)}${BACK_MARKUP}</div>`;
  if (!hidden) card.setAttribute("aria-label", `${cardInfo(index).rank} of ${cardInfo(index).suit}`);
  return card;
}

/** Simulated damped spring (mass 1). Returns displacement samples from 1 → 0 with overshoot. */
function springCurve(stiffness = 210, damping = 17, samples = 36, duration = 0.62) {
  const curve = [];
  let position = 1;
  let velocity = 0;
  const steps = 240;
  const dt = duration / steps;
  for (let step = 0; step <= steps; step++) {
    if (step % Math.round(steps / samples) === 0) curve.push(position);
    const force = -stiffness * position - damping * velocity;
    velocity += force * dt;
    position += velocity * dt;
  }
  curve[curve.length - 1] = 0;
  return curve;
}

const SPRING = springCurve();

/** Flies `card` in from the point `origin` (viewport coordinates) with spring physics. */
export function dealCard(card, origin, { delay = 0, reduced = false } = {}) {
  const rect = card.getBoundingClientRect();
  const dx = origin ? origin.x - (rect.left + rect.width / 2) : 0;
  const dy = origin ? origin.y - (rect.top + rect.height / 2) : -120;
  const spin = -24 + Math.random() * 10;
  if (reduced) {
    return card.animate([{ opacity: 0, transform: "translateY(-12px)" }, { opacity: 1, transform: "none" }], {
      duration: 160,
      delay,
      fill: "backwards",
      easing: "ease-out",
    }).finished;
  }
  const frames = SPRING.map((displacement, index) => {
    const travel = Math.max(displacement, -0.08);
    return {
      offset: index / (SPRING.length - 1),
      transform: `translate(${dx * travel}px, ${dy * travel}px) rotate(${spin * displacement}deg) scale(${1 - 0.18 * Math.max(0, displacement)})`,
      opacity: index === 0 ? 0.2 : 1,
    };
  });
  return card.animate(frames, { duration: 640, delay, fill: "backwards", easing: "linear" }).finished;
}

/** Turns a face-down card face-up with a 3D flip. */
export async function flipCard(card, index, { delay = 0, reduced = false } = {}) {
  const inner = card.querySelector(".pc-inner");
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  inner.insertAdjacentHTML("afterbegin", cardFaceMarkup(index));
  card.dataset.card = String(index);
  card.setAttribute("aria-label", `${cardInfo(index).rank} of ${cardInfo(index).suit}`);
  inner.classList.remove("pc-down");
  if (reduced) return;
  await inner.animate([{ transform: "rotateY(180deg)" }, { transform: "rotateY(0deg)" }], {
    duration: 420,
    easing: "cubic-bezier(0.3, 1.4, 0.5, 1)",
  }).finished;
}

export function centerOf(element) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

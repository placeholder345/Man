/**
 * Tiny DOM builder. All user content goes through text nodes or properties,
 * never innerHTML, so titles/comments/descriptions can't inject markup.
 *
 *   h("a", { class: "link", href: "/x", onclick: fn }, "text", childNode, [more])
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "text") el.textContent = value;
      else if (key === "dataset") Object.assign(el.dataset, value);
      else if (key === "style") for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
      else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
      else if (key in el && !key.includes("-") && typeof el[key] !== "function") el[key] = value;
      else el.setAttribute(key, value === true ? "" : value);
    }
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === true) continue;
    parent.append(child instanceof Node ? child : String(child));
  }
  return parent;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

const svgTemplate = document.createElement("template");

/** Parses a trusted, static SVG string (icons only). */
export function svg(markup) {
  svgTemplate.innerHTML = markup.trim();
  return svgTemplate.content.firstElementChild;
}

export const qs = (sel, root = document) => root.querySelector(sel);

/** Stable hue (0–359) for a string, used for avatars and placeholder thumbnails. */
export function hueOf(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 360;
}

const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/** First user-perceived character (handles emoji and accents). */
export function firstGrapheme(text) {
  const s = (text || "?").trim() || "?";
  if (segmenter) return segmenter.segment(s)[Symbol.iterator]().next().value.segment.toUpperCase();
  return Array.from(s)[0].toUpperCase();
}

export function isTyping(target) {
  if (!(target instanceof Element) || !target.isConnected) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
}

/** Grows a textarea to fit its content. */
export function autogrow(textarea, max = 400) {
  const fit = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight + 2, max)}px`;
  };
  textarea.addEventListener("input", fit);
  requestAnimationFrame(fit);
  return fit;
}

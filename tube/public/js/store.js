// localStorage can throw (private mode, blocked storage), so every access is guarded.

export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    if (value === undefined || value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: preferences just won't persist */
  }
}

export const prefs = {
  get volume() {
    const v = load("mt:volume", 1);
    return typeof v === "number" && v >= 0 && v <= 1 ? v : 1;
  },
  set volume(v) {
    save("mt:volume", v);
  },
  get muted() {
    return load("mt:muted", false) === true;
  },
  set muted(v) {
    save("mt:muted", v);
  },
  get autoplay() {
    return load("mt:autoplay", true) !== false;
  },
  set autoplay(v) {
    save("mt:autoplay", v);
  },
  get theater() {
    return load("mt:theater", false) === true;
  },
  set theater(v) {
    save("mt:theater", v);
  },
  get guideCollapsed() {
    return load("mt:guide-collapsed", false) === true;
  },
  set guideCollapsed(v) {
    save("mt:guide-collapsed", v);
  },
  get theme() {
    const t = load("mt:theme", "system");
    return t === "light" || t === "dark" ? t : "system";
  },
  set theme(v) {
    save("mt:theme", v === "system" ? null : v);
  },
};

// Watch progress per video, for "resume where you left off" and the red bars on thumbnails.
const PROGRESS_KEY = "mt:progress";
const MAX_PROGRESS_ENTRIES = 500;

export function getProgress(videoId) {
  const entry = load(PROGRESS_KEY, {})[videoId];
  return Array.isArray(entry) ? { time: entry[0], duration: entry[1] } : null;
}

export function setProgress(videoId, time, duration) {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return;
  const all = load(PROGRESS_KEY, {});
  delete all[videoId];
  all[videoId] = [Math.round(time * 10) / 10, Math.round(duration * 10) / 10];
  const ids = Object.keys(all);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_PROGRESS_ENTRIES))) delete all[id];
  save(PROGRESS_KEY, all);
}

export function clearAllProgress() {
  save(PROGRESS_KEY, null);
}

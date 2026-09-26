const compactFormat = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fullFormat = new Intl.NumberFormat("en");
const relative = new Intl.RelativeTimeFormat("en", { numeric: "always" });
const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

export const compact = (n) => compactFormat.format(n);
export const fullNumber = (n) => fullFormat.format(n);

export function plural(n, one, many = `${one}s`, { full = false } = {}) {
  return `${full ? fullNumber(n) : compact(n)} ${n === 1 ? one : many}`;
}

export const viewsLabel = (n) => (n === 0 ? "No views" : plural(n, "view"));
export const subscribersLabel = (n) => plural(n, "subscriber");

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Parses "1:02:05" / "3:45" into seconds, or null. */
export function parseTime(text) {
  const parts = String(text).split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !Number.isInteger(p) || p < 0)) return null;
  return parts.reduce((total, p) => total * 60 + p, 0);
}

/** Accepts ?t=90, ?t=90s, ?t=1m30s, ?t=1h2m3s. */
export function parseStartParam(value) {
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!m || !m[0]) return null;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

export function timeAgo(timestamp) {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const steps = [
    [60, "minute"],
    [3600, "hour"],
    [86400, "day"],
    [604800, "week"],
    [2629800, "month"],
    [31557600, "year"],
  ];
  let unit = steps[0];
  for (const step of steps) if (seconds >= step[0]) unit = step;
  return relative.format(-Math.floor(seconds / unit[0]), unit[1]);
}

export const formatDate = (timestamp) => dateFormat.format(new Date(timestamp));

export function formatBytes(bytes) {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return i === 0 ? `${n} bytes` : `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatDurationWords(seconds) {
  if (!Number.isFinite(seconds)) return "";
  seconds = Math.max(0, Math.round(seconds));
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min ${seconds % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

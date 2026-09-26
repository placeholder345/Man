import { load, save } from "./store.js";

const TOKEN_KEY = "mt:token";

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Shared app state: the signed-in (anonymous or named) user and server config. */
export const session = {
  user: null,
  config: null,
  token: load(TOKEN_KEY, null),
};

export const events = new EventTarget();
export const emit = (name, detail) => events.dispatchEvent(new CustomEvent(name, { detail }));

async function request(method, url, { body, signal } = {}) {
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, signal });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError(0, "Can't reach ManTube. Check that the server is running.");
  }
  if (res.status === 204) {
    await res.text().catch(() => {}); // finish the (empty) body so the connection is released cleanly
    return null;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status}).`, data?.code);
  return data;
}

let sessionPromise = null;

/** Creates a fresh anonymous identity (deduplicated across concurrent callers). */
function newSession() {
  sessionPromise ??= request("POST", "/api/session")
    .then((data) => {
      setToken(data.token);
      setUser(data.user);
    })
    .finally(() => {
      sessionPromise = null;
    });
  return sessionPromise;
}

function setToken(token) {
  session.token = token;
  save(TOKEN_KEY, token);
}

export function setUser(user) {
  session.user = user;
  emit("user", user);
}

export async function api(method, url, options) {
  try {
    return await request(method, url, options);
  } catch (err) {
    // The server no longer knows our token (e.g. its data folder was reset).
    if (err instanceof ApiError && err.code === "NO_SESSION") {
      await newSession();
      return request(method, url, options);
    }
    throw err;
  }
}

export const get = (url, options) => api("GET", url, options);
export const post = (url, body, options) => api("POST", url, { ...options, body });
export const put = (url, body, options) => api("PUT", url, { ...options, body });
export const patch = (url, body, options) => api("PATCH", url, { ...options, body });
export const del = (url, options) => api("DELETE", url, options);

export async function init() {
  session.config = await request("GET", "/api/config");
  if (session.token) {
    try {
      setUser(await request("GET", "/api/me"));
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) throw err;
    }
  }
  if (!session.user) await newSession();
}

/** Signs in with a key copied from another device. Throws if the key is invalid. */
export async function useSignInKey(key) {
  const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${key.trim()}` } });
  if (!res.ok) throw new ApiError(res.status, "That sign-in key isn't valid on this server.");
  setToken(key.trim());
  setUser(await res.json());
}

export const hasChannel = () => Boolean(session.user?.name);

export function query(params) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") search.set(k, v);
  const s = search.toString();
  return s ? `?${s}` : "";
}

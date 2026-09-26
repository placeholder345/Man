import { closeMenu, errorState } from "./components.js";

const routes = [];
let outlet = null;
let onNavigate = null;
let navId = 0;
let current = null;
const progressBar = document.createElement("div");
progressBar.className = "nav-progress";

/** Registers a page. `handler(ctx)` resolves to the page's root element. */
export function route(name, pattern, handler) {
  routes.push({ name, pattern, handler });
}

export function navigate(url, { replace = false } = {}) {
  const target = new URL(url, location.href);
  if (target.origin !== location.origin) {
    location.assign(target.href);
    return;
  }
  rememberScroll();
  const same = target.href === location.href;
  history[replace || same ? "replaceState" : "pushState"]({ scrollY: 0 }, "", target.href);
  render(false);
}

/** Re-renders the current URL (e.g. after signing in as someone else). */
export const reload = () => render(true);

function rememberScroll() {
  history.replaceState({ ...(history.state || {}), scrollY: window.scrollY }, "");
}

function match(pathname) {
  for (const r of routes) {
    const m = r.pattern.exec(pathname);
    if (m) return { ...r, params: m.slice(1).map(decodeURIComponent) };
  }
  return routes.find((r) => r.name === "not-found");
}

let progressTimer = 0;
function startProgress() {
  clearTimeout(progressTimer);
  progressBar.className = "nav-progress";
  progressTimer = setTimeout(() => progressBar.classList.add("is-loading"), 120);
}
function finishProgress() {
  clearTimeout(progressTimer);
  if (!progressBar.classList.contains("is-loading")) return;
  progressBar.classList.add("is-done");
  progressTimer = setTimeout(() => (progressBar.className = "nav-progress"), 400);
}

async function render(restoreScroll) {
  const id = ++navId;
  closeMenu();
  const url = new URL(location.href);
  const page = match(url.pathname);
  const controller = new AbortController();
  const cleanups = [];
  let titled = false;
  const ctx = {
    url,
    query: url.searchParams,
    params: page.params ?? [],
    signal: controller.signal,
    onCleanup: (fn) => cleanups.push(fn),
    setTitle: (title) => {
      titled = true;
      if (id === navId) document.title = title ? `${title} - ManTube` : "ManTube";
    },
    isCurrent: () => id === navId,
  };

  startProgress();
  let el;
  try {
    el = await page.handler(ctx);
  } catch (err) {
    if (err.name !== "AbortError") console.error(err);
    el = errorState(err.message || "This page failed to load.", () => render(true));
  }

  const runCleanups = (list) => {
    for (const fn of list) {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    }
  };

  if (id !== navId) {
    // A newer navigation started while this page was loading.
    controller.abort();
    runCleanups(cleanups);
    return;
  }

  if (current) {
    current.controller.abort();
    runCleanups(current.cleanups);
  }
  current = { controller, cleanups };

  document.body.dataset.page = page.name;
  outlet.replaceChildren(el);
  if (!titled) ctx.setTitle("");
  window.scrollTo(0, restoreScroll ? history.state?.scrollY ?? 0 : 0);
  finishProgress();
  onNavigate?.(url, page.name);
}

export function startRouter(options) {
  outlet = options.outlet;
  onNavigate = options.onNavigate;
  document.body.append(progressBar);
  history.scrollRestoration = "manual";

  window.addEventListener("popstate", () => render(true));

  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/")) return;
    e.preventDefault();
    navigate(url.href);
  });

  render(true);
}

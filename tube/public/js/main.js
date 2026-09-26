import { h, isTyping } from "./dom.js";
import { icon, logoMark } from "./icons.js";
import { init, session, events, get, useSignInKey } from "./api.js";
import { route, startRouter, navigate, reload } from "./router.js";
import { avatar, openMenu, channelDialog, modal, toast, copyText, channelUrl, watchUrl, emptyState } from "./components.js";
import { prefs } from "./store.js";
import { uploader } from "./uploader.js";
import { homePage } from "./pages/home.js";
import { watchPage } from "./pages/watch.js";
import { uploadPage } from "./pages/upload.js";
import { channelPage, myChannelPage } from "./pages/channel.js";
import { resultsPage } from "./pages/results.js";
import { subscriptionsPage, historyPage, likedPage } from "./pages/feeds.js";

// ---------- theme ----------

function applyTheme(theme) {
  prefs.theme = theme;
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

// ---------- shell ----------

const searchInput = h("input", {
  type: "search",
  name: "search_query",
  class: "search-input",
  placeholder: "Search",
  autocomplete: "off",
  enterKeyHint: "search",
  "aria-label": "Search",
});
const searchForm = h(
  "form",
  { class: "search", role: "search", action: "/results" },
  h("button", { class: "icon-btn search-back", type: "button", "aria-label": "Close search", onclick: () => closeMobileSearch() }, icon("back")),
  h("div", { class: "search-box" }, icon("search", "search-leading"), searchInput),
  h("button", { class: "search-submit", type: "submit", "aria-label": "Search" }, icon("search"))
);

const guideToggle = h("button", { class: "icon-btn", type: "button", "aria-label": "Menu", onclick: toggleGuide }, icon("menu"));
const accountButton = h("button", {
  class: "account-btn",
  type: "button",
  "aria-label": "Account menu",
  "aria-haspopup": "menu",
  onclick: () => openAccountMenu(),
});
const uploadPill = h("a", { class: "upload-pill", href: "/upload", hidden: true });

const masthead = h(
  "header",
  { class: "masthead" },
  h(
    "div",
    { class: "mh-start" },
    guideToggle,
    h("a", { class: "logo", href: "/", "aria-label": "ManTube home" }, logoMark(), h("span", { class: "logo-text" }, "ManTube"))
  ),
  searchForm,
  h(
    "div",
    { class: "mh-end" },
    h("button", { class: "icon-btn search-open", type: "button", "aria-label": "Search", onclick: openMobileSearch }, icon("search")),
    uploadPill,
    h("a", { class: "create-btn", href: "/upload", title: "Upload a video" }, icon("create"), h("span", {}, "Create")),
    accountButton
  )
);

function guideItem(href, iconName, label, name) {
  return h("a", { class: "guide-item", href, dataset: { name } }, icon(iconName), h("span", {}, label));
}

const subscriptionList = h("div", { class: "guide-subs" });
const guide = h(
  "nav",
  { class: "guide", "aria-label": "Main" },
  h(
    "div",
    { class: "guide-drawer-head" },
    h("button", { class: "icon-btn", type: "button", "aria-label": "Close menu", onclick: () => setDrawer(false) }, icon("menu")),
    h("a", { class: "logo", href: "/" }, logoMark(), h("span", { class: "logo-text" }, "ManTube"))
  ),
  h(
    "div",
    { class: "guide-section" },
    guideItem("/", "home", "Home", "home"),
    guideItem("/feed/subscriptions", "subscriptions", "Subscriptions", "subscriptions")
  ),
  h(
    "div",
    { class: "guide-section" },
    h("a", { class: "guide-heading", href: "/channel/me" }, "You", icon("chevronRight")),
    guideItem("/channel/me", "channel", "Your channel", "my-channel"),
    guideItem("/feed/history", "history", "History", "history"),
    guideItem("/feed/liked", "like", "Liked videos", "liked"),
    guideItem("/upload", "upload", "Upload video", "upload")
  ),
  h("div", { class: "guide-section" }, h("h3", { class: "guide-heading" }, "Subscriptions"), subscriptionList),
  h(
    "footer",
    { class: "guide-footer" },
    h("p", {}, "Your videos, your server, full original quality."),
    h("button", { class: "link-btn", type: "button", onclick: () => shortcutsDialog() }, "Keyboard shortcuts")
  )
);

const miniGuide = h(
  "nav",
  { class: "mini-guide", "aria-label": "Main" },
  h("a", { class: "mini-item", href: "/", dataset: { name: "home" } }, icon("home"), h("span", {}, "Home")),
  h(
    "a",
    { class: "mini-item", href: "/feed/subscriptions", dataset: { name: "subscriptions" } },
    icon("subscriptions"),
    h("span", {}, "Subscriptions")
  ),
  h("a", { class: "mini-item", href: "/feed/history", dataset: { name: "history" } }, icon("history"), h("span", {}, "History")),
  h("a", { class: "mini-item", href: "/channel/me", dataset: { name: "my-channel" } }, icon("channel"), h("span", {}, "You"))
);

const scrim = h("div", { class: "scrim", onclick: () => setDrawer(false) });
const outlet = h("main", { class: "page", id: "page", tabIndex: -1 });

document.getElementById("app").replaceChildren(masthead, guide, miniGuide, scrim, outlet);

// ---------- guide (sidebar) ----------

const wideQuery = window.matchMedia("(min-width: 1313px)");
const isDocked = () => wideQuery.matches && document.body.dataset.page !== "watch";

function toggleGuide() {
  if (isDocked()) {
    prefs.guideCollapsed = !document.body.classList.contains("guide-collapsed");
    document.body.classList.toggle("guide-collapsed", prefs.guideCollapsed);
  } else {
    setDrawer(!document.body.classList.contains("drawer-open"));
  }
}

function setDrawer(open) {
  document.body.classList.toggle("drawer-open", open);
  if (open) guide.querySelector(".guide-item")?.focus({ preventScroll: true });
}

document.body.classList.toggle("guide-collapsed", prefs.guideCollapsed);
wideQuery.addEventListener("change", () => setDrawer(false));

function highlightGuide(pageName, url) {
  let name = pageName;
  if (pageName === "channel" && session.user && url.pathname === channelUrl(session.user.id)) name = "my-channel";
  for (const el of document.querySelectorAll(".guide-item, .mini-item")) {
    el.classList.toggle("is-active", el.dataset.name === name);
  }
  for (const el of subscriptionList.querySelectorAll("a")) {
    el.classList.toggle("is-active", url.pathname === new URL(el.href).pathname);
  }
}

async function loadSubscriptions() {
  try {
    const channels = await get("/api/me/subscriptions");
    if (!channels.length) {
      subscriptionList.replaceChildren(h("p", { class: "guide-note" }, "Channels you subscribe to show up here."));
      return;
    }
    subscriptionList.replaceChildren(
      ...channels.map((c) =>
        h("a", { class: "guide-item guide-channel", href: channelUrl(c.id) }, avatar(c, 24, { link: false }), h("span", {}, c.name))
      )
    );
    highlightGuide(document.body.dataset.page, new URL(location.href));
  } catch {
    subscriptionList.replaceChildren();
  }
}

// ---------- search ----------

function openMobileSearch() {
  masthead.classList.add("search-active");
  searchInput.focus();
}
function closeMobileSearch() {
  masthead.classList.remove("search-active");
}

searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;
  searchInput.blur();
  closeMobileSearch();
  navigate(`/results?search_query=${encodeURIComponent(q)}`);
});

// ---------- account ----------

function renderAccountButton() {
  const user = session.user;
  accountButton.replaceChildren(user?.name ? avatar(user, 32, { link: false }) : h("span", { class: "account-anon" }, icon("user")));
}

function themeSwitcher() {
  const options = [
    ["system", "device", "Device"],
    ["light", "sun", "Light"],
    ["dark", "moon", "Dark"],
  ];
  const wrap = h("div", { class: "menu-theme", role: "group", "aria-label": "Appearance" });
  const render = () =>
    wrap.replaceChildren(
      h("span", { class: "menu-theme-label" }, "Appearance"),
      h(
        "div",
        { class: "segmented" },
        options.map(([value, iconName, label]) =>
          h(
            "button",
            {
              type: "button",
              class: `segmented-btn${prefs.theme === value ? " is-active" : ""}`,
              "aria-pressed": String(prefs.theme === value),
              onclick: () => {
                applyTheme(value);
                render();
              },
            },
            icon(iconName),
            label
          )
        )
      )
    );
  render();
  return wrap;
}

function openAccountMenu() {
  const user = session.user;
  const header = user.name
    ? h(
        "div",
        { class: "menu-header" },
        avatar(user, 40, { link: false }),
        h("div", {}, h("strong", {}, user.name), h("a", { class: "menu-header-link", href: channelUrl(user.id) }, "View your channel"))
      )
    : h("div", { class: "menu-header" }, h("span", { class: "account-anon large" }, icon("user")), h("div", {}, h("strong", {}, "Guest"), h("span", { class: "muted" }, "You don't have a channel yet")));

  openMenu(
    accountButton,
    [
      { element: header },
      { divider: true },
      user.name
        ? { icon: "channel", label: "Your channel", href: channelUrl(user.id) }
        : { icon: "channel", label: "Create a channel", onClick: () => channelDialog({ mode: "create" }) },
      user.name && { icon: "edit", label: "Customize channel", onClick: () => channelDialog({ mode: "edit" }) },
      { icon: "upload", label: "Upload video", href: "/upload" },
      { icon: "history", label: "History", href: "/feed/history" },
      { divider: true },
      { element: themeSwitcher() },
      { divider: true },
      { icon: "key", label: "Use this channel on another device", onClick: signInKeyDialog },
      { icon: "keyboard", label: "Keyboard shortcuts", onClick: shortcutsDialog },
    ],
    { className: "account-menu", label: "Account" }
  );
}

function signInKeyDialog() {
  const keyInput = h("input", { class: "input mono", type: "text", readOnly: true, value: session.token });
  const pasteInput = h("input", { class: "input mono", type: "text", placeholder: "Paste a sign-in key", autocomplete: "off", spellcheck: false });
  const status = h("p", { class: "form-error", role: "alert", hidden: true });
  modal({
    title: "Use your channel on another device",
    className: "dialog-small",
    build: (close, setBusy) => [
      h("p", { class: "dialog-text" }, "ManTube doesn't use passwords. Your browser holds a private sign-in key instead. Copy it to another device (a phone on the same Wi-Fi, say) to manage the same channel there."),
      h(
        "div",
        { class: "key-row" },
        keyInput,
        h(
          "button",
          {
            class: "btn btn-tonal",
            type: "button",
            onclick: async () => toast((await copyText(session.token)) ? "Sign-in key copied" : "Couldn't copy. Select the key and copy it manually."),
          },
          icon("copy"),
          "Copy"
        )
      ),
      h("p", { class: "field-hint warn" }, "Keep it private: anyone with this key can edit and delete your videos."),
      h("h3", { class: "dialog-subhead" }, "Have a key from another device?"),
      h(
        "div",
        { class: "key-row" },
        pasteInput,
        h(
          "button",
          {
            class: "btn btn-primary",
            type: "button",
            onclick: async () => {
              const key = pasteInput.value.trim();
              if (!key) return pasteInput.focus();
              setBusy(true);
              try {
                await useSignInKey(key);
                close();
                toast(session.user.name ? `Signed in as ${session.user.name}` : "Signed in");
                loadSubscriptions();
                reload();
              } catch (err) {
                setBusy(false);
                status.textContent = err.message;
                status.hidden = false;
              }
            },
          },
          "Sign in"
        )
      ),
      status,
    ],
  });
  keyInput.addEventListener("focus", () => keyInput.select());
}

export function shortcutsDialog() {
  const groups = [
    [
      "Playback",
      [
        [["K"], "or", ["Space"], "Play / pause"],
        [["J"], "/", ["L"], "Back / forward 10 seconds"],
        [["←"], "/", ["→"], "Back / forward 5 seconds"],
        [["0"], "–", ["9"], "Jump to 0% – 90% of the video"],
        [[","], "/", ["."], "Previous / next frame (while paused)"],
        [["<"], "/", [">"], "Slower / faster"],
        [["Shift", "N"], "", [], "Next video"],
      ],
    ],
    [
      "Player",
      [
        [["M"], "", [], "Mute / unmute"],
        [["↑"], "/", ["↓"], "Volume up / down (player focused)"],
        [["F"], "", [], "Full screen"],
        [["T"], "", [], "Theater mode"],
        [["I"], "", [], "Picture-in-picture"],
      ],
    ],
    [
      "General",
      [
        [["/"], "", [], "Search"],
        [["?"], "", [], "Show keyboard shortcuts"],
      ],
    ],
  ];
  const keys = (list) => list.map((k, i) => [i ? " + " : "", h("kbd", {}, k)]);
  modal({
    title: "Keyboard shortcuts",
    className: "dialog-shortcuts",
    build: () =>
      groups.map(([title, rows]) =>
        h(
          "section",
          { class: "shortcut-group" },
          h("h3", {}, title),
          h(
            "dl",
            {},
            rows.map(([a, sep, b, what]) => [h("dt", {}, keys(a), sep ? ` ${sep} ` : "", keys(b)), h("dd", {}, what)])
          )
        )
      ),
  });
}

// ---------- upload pill ----------

function renderUploadPill() {
  const onUploadPage = document.body.dataset.page === "upload";
  const show = uploader.busy && !onUploadPage;
  uploadPill.hidden = !show;
  if (!show) return;
  const { loaded, total, processing } = uploader.progress;
  const pct = total ? Math.floor((loaded / total) * 100) : 0;
  uploadPill.style.setProperty("--pct", `${pct}%`);
  uploadPill.replaceChildren(h("span", { class: "upload-pill-ring" }), processing ? "Processing…" : `Uploading ${pct}%`);
}

let lastUploadState = uploader.state;
uploader.addEventListener("change", () => {
  renderUploadPill();
  if (lastUploadState === "uploading" && uploader.state !== lastUploadState && document.body.dataset.page !== "upload") {
    if (uploader.state === "done") {
      toast(`“${uploader.result.title}” is published`, { action: { label: "Watch", href: watchUrl(uploader.result.id) }, duration: 10000 });
    } else if (uploader.state === "error") {
      toast(`Upload failed: ${uploader.error}`, { action: { label: "Details", href: "/upload" }, duration: 10000 });
    }
  }
  lastUploadState = uploader.state;
});

// ---------- global keys ----------

document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
  if (document.querySelector("dialog[open]")) return;
  if (e.key === "/") {
    e.preventDefault();
    if (!searchInput.offsetParent) openMobileSearch();
    searchInput.focus();
    searchInput.select();
  } else if (e.key === "?") {
    e.preventDefault();
    shortcutsDialog();
  } else if (e.key === "Escape" && document.body.classList.contains("drawer-open")) {
    setDrawer(false);
  }
});

// ---------- routes ----------

function notFoundPage(ctx) {
  ctx.setTitle("Page not found");
  return emptyState({
    iconName: "alert",
    title: "This page isn't available",
    text: "The link may be broken, or the page may have been removed.",
    action: h("a", { class: "btn btn-primary", href: "/" }, "Go home"),
  });
}

route("home", /^\/$/, homePage);
route("watch", /^\/watch\/?$/, watchPage);
route("results", /^\/results\/?$/, resultsPage);
route("upload", /^\/upload\/?$/, uploadPage);
route("my-channel", /^\/channel\/me\/?$/, myChannelPage);
route("channel", /^\/channel\/([\w-]+)\/?$/, channelPage);
route("subscriptions", /^\/feed\/subscriptions\/?$/, subscriptionsPage);
route("history", /^\/feed\/history\/?$/, historyPage);
route("liked", /^\/feed\/liked\/?$/, likedPage);
route("not-found", /^$/, notFoundPage);

// ---------- boot ----------

events.addEventListener("user", renderAccountButton);
events.addEventListener("subscriptions", loadSubscriptions);

async function boot() {
  try {
    await init();
  } catch (err) {
    outlet.replaceChildren(
      emptyState({
        iconName: "alert",
        title: "Can't reach ManTube",
        text: err.message,
        action: h("button", { class: "btn btn-primary", type: "button", onclick: () => location.reload() }, "Try again"),
      })
    );
    return;
  }
  renderAccountButton();
  loadSubscriptions();
  startRouter({
    outlet,
    onNavigate(url, name) {
      setDrawer(false);
      closeMobileSearch();
      searchInput.value = name === "results" ? url.searchParams.get("search_query") ?? "" : "";
      highlightGuide(name, url);
      renderUploadPill();
    },
  });
}

boot();

import { h, append, hueOf, firstGrapheme, autogrow } from "./dom.js";
import { icon } from "./icons.js";
import { formatTime, viewsLabel, timeAgo, parseTime } from "./format.js";
import { getProgress } from "./store.js";
import { session, patch, put, del, emit, setUser, hasChannel } from "./api.js";

export const watchUrl = (id, t) => `/watch?v=${encodeURIComponent(id)}${t ? `&t=${Math.floor(t)}s` : ""}`;
export const channelUrl = (id) => `/channel/${encodeURIComponent(id)}`;

// ---------- avatars & thumbnails ----------

export function avatar(channel, size = 36, { link = true } = {}) {
  return h(
    link ? "a" : "span",
    {
      class: "avatar",
      href: link ? channelUrl(channel.id) : null,
      title: link ? channel.name : null,
      "aria-hidden": link ? null : "true",
      style: { "--hue": hueOf(channel.id), "--size": `${size}px` },
    },
    firstGrapheme(channel.name)
  );
}

const canHover = window.matchMedia("(hover: hover) and (pointer: fine)");

/** Plays a muted preview of the video after hovering a thumbnail for a moment. */
function attachHoverPreview(thumb, video) {
  let timer = 0;
  let preview = null;

  const stop = () => {
    clearTimeout(timer);
    if (!preview) return;
    preview.pause();
    preview.removeAttribute("src");
    preview.load();
    preview.remove();
    preview = null;
    thumb.classList.remove("is-previewing");
  };

  thumb.addEventListener("pointerenter", () => {
    if (!canHover.matches) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!thumb.isConnected || preview) return;
      const from = video.duration > 30 ? Math.floor(video.duration * 0.1) : 0;
      preview = h("video", {
        class: "thumb-preview",
        muted: true,
        playsInline: true,
        loop: true,
        preload: "auto",
        src: `${video.videoUrl}#t=${from}`,
      });
      preview.muted = true;
      preview.addEventListener("playing", () => thumb.classList.add("is-previewing"), { once: true });
      preview.addEventListener("error", stop, { once: true });
      thumb.append(preview);
      preview.play().catch(() => {});
    }, 700);
  });
  thumb.addEventListener("pointerleave", stop);
}

export function thumbFallback(id) {
  return h("div", { class: "thumb-fallback", style: { "--hue": hueOf(id) } }, icon("film"));
}

export function thumbnail(video, { preview = false } = {}) {
  const thumb = h("a", { class: "thumb", href: watchUrl(video.id), tabIndex: -1, "aria-hidden": "true" });
  if (video.thumbnailUrl) {
    const img = h("img", { src: video.thumbnailUrl, alt: "", loading: "lazy", decoding: "async" });
    img.addEventListener("error", () => img.replaceWith(thumbFallback(video.id)), { once: true });
    thumb.append(img);
  } else {
    thumb.append(thumbFallback(video.id));
  }
  if (video.duration) thumb.append(h("span", { class: "thumb-duration" }, formatTime(video.duration)));

  const progress = getProgress(video.id);
  if (progress && progress.time > 2) {
    const pct = progress.time >= progress.duration - 5 ? 100 : (progress.time / progress.duration) * 100;
    thumb.append(h("div", { class: "thumb-progress" }, h("i", { style: { width: `${Math.min(100, pct)}%` } })));
  }
  if (preview) attachHoverPreview(thumb, video);
  return thumb;
}

// ---------- video cards ----------

/**
 * layout: "grid" (home), "list" (search, history), "compact" (watch sidebar).
 */
export function videoCard(video, { layout = "grid", showChannel = true, extra = null } = {}) {
  const href = watchUrl(video.id);
  const meta = h(
    "p",
    { class: "card-meta" },
    viewsLabel(video.views),
    h("span", { class: "dot", "aria-hidden": "true" }, "•"),
    video.watchedAt ? `watched ${timeAgo(video.watchedAt)}` : timeAgo(video.createdAt)
  );
  const title = h("h3", { class: "card-title" }, h("a", { href, title: video.title }, video.title));
  const channelLink = showChannel && h("a", { class: "card-channel", href: channelUrl(video.channel.id) }, video.channel.name);

  if (layout === "grid") {
    return h(
      "article",
      { class: "card card-grid" },
      thumbnail(video, { preview: true }),
      h(
        "div",
        { class: "card-body" },
        showChannel && avatar(video.channel, 36),
        h("div", { class: "card-text" }, title, channelLink, meta),
        extra
      )
    );
  }

  if (layout === "list") {
    return h(
      "article",
      { class: "card card-list" },
      thumbnail(video, { preview: true }),
      h(
        "div",
        { class: "card-text" },
        title,
        meta,
        showChannel &&
          h("div", { class: "card-channel-row" }, avatar(video.channel, 24), channelLink),
        video.description && h("p", { class: "card-desc" }, video.description.split("\n")[0])
      ),
      extra
    );
  }

  return h(
    "article",
    { class: "card card-compact" },
    thumbnail(video),
    h("div", { class: "card-text" }, title, channelLink, meta),
    extra
  );
}

export function skeletonCards(count, layout = "grid") {
  return Array.from({ length: count }, () =>
    h(
      "div",
      { class: `card card-${layout} skeleton`, "aria-hidden": "true" },
      h("div", { class: "thumb" }),
      h(
        "div",
        { class: "card-body" },
        layout === "grid" && h("div", { class: "sk-avatar" }),
        h("div", { class: "card-text" }, h("div", { class: "sk-line" }), h("div", { class: "sk-line short" }))
      )
    )
  );
}

// ---------- states ----------

export function emptyState({ iconName = "videos", title, text, action }) {
  return h(
    "div",
    { class: "empty-state" },
    h("div", { class: "empty-icon" }, icon(iconName)),
    h("h2", {}, title),
    text && h("p", {}, text),
    action
  );
}

export function errorState(message, retry) {
  return h(
    "div",
    { class: "empty-state is-error", role: "alert" },
    h("div", { class: "empty-icon" }, icon("alert")),
    h("h2", {}, "Something went wrong"),
    h("p", {}, message),
    retry && h("button", { class: "btn btn-tonal", type: "button", onclick: retry }, "Try again")
  );
}

/**
 * Paged list with infinite scroll. `load(offset, limit)` must resolve to
 * { videos, hasMore }. Returns { el, ready } where `ready` settles after the first page.
 */
export function infiniteVideos({ load, layout = "grid", cardOptions = {}, extra, empty, signal, pageSize = 24 }) {
  const list = h("div", { class: layout === "grid" ? "video-grid" : "video-list" });
  const sentinel = h("div", { class: "list-sentinel" });
  const el = h("div", { class: "infinite" }, list, sentinel);
  let offset = 0;
  let hasMore = true;
  let loading = false;
  let observer = null;

  list.append(...skeletonCards(layout === "grid" ? 12 : 6, layout));

  async function next(first = false) {
    if (loading || !hasMore) return;
    loading = true;
    sentinel.replaceChildren(first ? "" : h("div", { class: "spinner small" }));
    try {
      const page = await load(offset, pageSize);
      if (signal?.aborted) return;
      if (first) list.replaceChildren();
      offset += page.videos.length;
      hasMore = page.hasMore;
      for (const v of page.videos) {
        const card = videoCard(v, { layout, ...cardOptions });
        if (extra) card.append(extra(v, card, { removed: () => (offset = Math.max(0, offset - 1)) }));
        list.append(card);
      }
      sentinel.replaceChildren();
      if (first && page.videos.length === 0 && empty) el.replaceChildren(empty());
    } catch (err) {
      if (err.name === "AbortError" || signal?.aborted) return;
      if (first) {
        el.replaceChildren(errorState(err.message, () => location.reload()));
        hasMore = false;
      } else {
        sentinel.replaceChildren(
          h("button", { class: "btn btn-tonal", type: "button", onclick: () => next() }, "Couldn't load more. Retry")
        );
      }
    } finally {
      loading = false;
    }
    // Keep filling until the viewport is covered.
    if (hasMore && sentinel.isConnected && sentinel.getBoundingClientRect().top < innerHeight + 800) next();
  }

  const ready = next(true).then(() => {
    if (signal?.aborted || !hasMore) return;
    observer = new IntersectionObserver((entries) => entries[0].isIntersecting && next(), { rootMargin: "800px" });
    observer.observe(sentinel);
  });
  signal?.addEventListener("abort", () => observer?.disconnect());
  return { el, ready, list };
}

// ---------- rich text ----------

const TOKEN_RE = /(https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]}])|(?<![\d:])((?:\d{1,2}:)?\d{1,2}:\d{2})(?![\d:])/g;

/** Plain text with clickable links and (optionally) video timestamps like 1:23. */
export function richText(text, { onTimestamp, timestampHref, maxSeconds = Infinity } = {}) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    if (m[1]) {
      frag.append(h("a", { href: m[1], target: "_blank", rel: "noopener noreferrer nofollow" }, m[1]));
    } else {
      const seconds = parseTime(m[2]);
      if (onTimestamp && seconds != null && seconds <= maxSeconds) {
        frag.append(
          h(
            "a",
            {
              class: "timestamp",
              href: timestampHref ? timestampHref(seconds) : "#",
              onclick: (e) => {
                e.preventDefault();
                onTimestamp(seconds);
              },
            },
            m[2]
          )
        );
      } else {
        frag.append(m[2]);
      }
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

// ---------- toasts ----------

export function toast(message, { action, duration = 5000 } = {}) {
  const host = document.getElementById("toasts");
  let timer = 0;
  const dismiss = () => {
    clearTimeout(timer);
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  };
  const el = h(
    "div",
    { class: "toast", role: "status" },
    h("span", { class: "toast-text" }, message),
    action &&
      h(
        action.href ? "a" : "button",
        {
          class: "toast-action",
          href: action.href || null,
          type: action.href ? null : "button",
          onclick: () => {
            action.onClick?.();
            dismiss();
          },
        },
        action.label
      )
  );
  host.append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("show")));
  timer = setTimeout(dismiss, duration);
  return dismiss;
}

// ---------- dialogs ----------

/**
 * Opens a modal <dialog>. `build(close)` returns the body; `footer(close)` returns buttons.
 * Resolves `closed` with whatever value close() was called with (undefined on dismiss).
 */
export function modal({ title, build, footer, className = "", onSubmit }) {
  let result;
  let busy = false;
  const dialog = h("dialog", { class: `dialog ${className}`, "aria-label": title });
  const close = (value) => {
    result = value;
    dialog.close();
  };
  const setBusy = (value) => {
    busy = value;
    dialog.classList.toggle("is-busy", value);
    for (const el of dialog.querySelectorAll("button, input, textarea, select")) el.disabled = value;
  };

  const form = h("form", { class: "dialog-inner", method: "dialog", noValidate: true });
  append(form, [
    h(
      "header",
      { class: "dialog-head" },
      h("h2", {}, title),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: () => !busy && close() }, icon("close"))
    ),
    h("div", { class: "dialog-body" }, build?.(close, setBusy)),
    footer && h("footer", { class: "dialog-foot" }, footer(close, setBusy)),
  ]);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!busy) onSubmit?.(close, setBusy, e.submitter);
  });
  dialog.append(form);

  // Click on the backdrop (outside .dialog-inner) closes, but not a drag that ends there.
  let downOnBackdrop = false;
  dialog.addEventListener("pointerdown", (e) => (downOnBackdrop = e.target === dialog));
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog && downOnBackdrop && !busy) close();
  });
  dialog.addEventListener("cancel", (e) => busy && e.preventDefault());

  const opener = document.activeElement;
  const closed = new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      // Don't leave focus on an element that's about to be detached: key events
      // would keep going to it and every keyboard shortcut would stop working.
      if (dialog.contains(document.activeElement)) document.activeElement.blur();
      dialog.remove();
      if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
      resolve(result);
    });
  });

  document.body.append(dialog);
  dialog.showModal();
  const firstField = dialog.querySelector("input:not([type=hidden]), textarea, select");
  (firstField || dialog.querySelector(".dialog-foot .btn-primary"))?.focus();
  return { dialog, close, closed, setBusy };
}

export function confirmDialog({ title, message, confirmLabel = "OK", danger = false }) {
  const { closed } = modal({
    title,
    className: "dialog-small",
    build: () => h("p", { class: "dialog-text" }, message),
    footer: (close) => [
      h("button", { class: "btn btn-text", type: "button", onclick: () => close(false) }, "Cancel"),
      h("button", { class: `btn ${danger ? "btn-danger" : "btn-primary"}`, type: "submit" }, confirmLabel),
    ],
    onSubmit: (close) => close(true),
  });
  return closed.then((v) => v === true);
}

export function field({ label, input, counter, hint }) {
  const wrap = h("label", { class: "field" }, h("span", { class: "field-label" }, label), input);
  if (counter) {
    const count = h("span", { class: "field-count" });
    const update = () => {
      count.textContent = `${input.value.length}/${counter}`;
      wrap.classList.toggle("is-over", input.value.length > counter);
    };
    input.addEventListener("input", update);
    update();
    wrap.append(count);
  }
  if (hint) wrap.append(h("span", { class: "field-hint" }, hint));
  return wrap;
}

export function formError() {
  const el = h("p", { class: "form-error", role: "alert", hidden: true });
  return {
    el,
    show(message) {
      el.textContent = message;
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
  };
}

/** Create or rename the viewer's channel. Resolves true once saved. */
export function channelDialog({ mode = "create", reason } = {}) {
  const limits = session.config.limits;
  const me = session.user;
  const nameInput = h("input", {
    type: "text",
    class: "input",
    value: me.name || "",
    maxLength: limits.name,
    required: true,
    autocomplete: "nickname",
    placeholder: "e.g. Nora Makes Things",
  });
  const aboutInput =
    mode === "edit" &&
    h("textarea", { class: "input", rows: 4, maxLength: limits.about, placeholder: "Tell viewers about your channel" });
  if (aboutInput) aboutInput.value = me.about || "";
  const preview = h("div", { class: "channel-preview" });
  const renderPreview = () =>
    preview.replaceChildren(avatar({ id: me.id, name: nameInput.value || "?" }, 72, { link: false }));
  nameInput.addEventListener("input", renderPreview);
  renderPreview();
  const error = formError();

  const { closed } = modal({
    title: mode === "create" ? "Create your channel" : "Customize channel",
    className: "dialog-small",
    build: () => [
      reason && h("p", { class: "dialog-text" }, reason),
      preview,
      field({ label: "Channel name", input: nameInput, counter: limits.name }),
      aboutInput && field({ label: "Description", input: aboutInput, counter: limits.about }),
      error.el,
    ],
    footer: (close) => [
      h("button", { class: "btn btn-text", type: "button", onclick: () => close(false) }, "Cancel"),
      h("button", { class: "btn btn-primary", type: "submit" }, mode === "create" ? "Create channel" : "Save"),
    ],
    onSubmit: async (close, setBusy) => {
      const name = nameInput.value.trim();
      if (!name) {
        error.show("Give your channel a name.");
        nameInput.focus();
        return;
      }
      setBusy(true);
      try {
        const body = { name };
        if (aboutInput) body.about = aboutInput.value;
        setUser(await patch("/api/me", body));
        close(true);
        toast(mode === "create" ? `Welcome to ManTube, ${name}!` : "Channel updated");
      } catch (err) {
        setBusy(false);
        error.show(err.message);
      }
    },
  });
  if (aboutInput) autogrow(aboutInput, 240);
  return closed.then((v) => v === true);
}

/** Resolves true if the viewer has (or just created) a channel. */
export async function ensureChannel(reason) {
  if (hasChannel()) return true;
  return channelDialog({ mode: "create", reason });
}

// ---------- clipboard ----------

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context (fails on plain-http LAN addresses).
    const ta = h("textarea", { value: text, readOnly: true, class: "offscreen" });
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

// ---------- menus ----------

let activeMenu = null;

export function closeMenu() {
  activeMenu?.close();
}

/**
 * Popup menu anchored to `anchor`. Items: { icon, label, onClick, href, danger, checked }
 * or { divider: true } or { element: Node } for custom content.
 */
export function openMenu(anchor, items, { className = "", label = "Menu" } = {}) {
  if (activeMenu?.anchor === anchor) {
    activeMenu.close();
    return;
  }
  closeMenu();

  const menu = h("div", { class: `menu ${className}`, role: "menu", "aria-label": label });
  for (const item of items) {
    if (!item) continue;
    if (item.divider) menu.append(h("div", { class: "menu-divider", role: "separator" }));
    else if (item.element) menu.append(item.element);
    else {
      menu.append(
        h(
          item.href ? "a" : "button",
          {
            class: `menu-item${item.danger ? " is-danger" : ""}${item.checked ? " is-checked" : ""}`,
            role: "menuitem",
            type: item.href ? null : "button",
            href: item.href || null,
            onclick: () => {
              close();
              item.onClick?.();
            },
          },
          item.icon ? icon(item.icon) : h("span", { class: "menu-icon-space" }),
          h("span", { class: "menu-label" }, item.label),
          item.checked && icon("check", "menu-check"),
          item.chevron && icon("chevronRight", "menu-check")
        )
      );
    }
  }

  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let top = rect.bottom + 6;
  if (top + mh > innerHeight - 8 && rect.top - mh - 6 > 8) top = rect.top - mh - 6;
  let left = rect.right - mw;
  if (left < 8) left = Math.min(rect.left, innerWidth - mw - 8);
  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.left = `${Math.max(8, left)}px`;
  anchor.setAttribute("aria-expanded", "true");

  const onPointerDown = (e) => {
    if (!menu.contains(e.target) && !anchor.contains(e.target)) close();
  };
  const onKey = (e) => {
    const buttons = [...menu.querySelectorAll(".menu-item")];
    const i = buttons.indexOf(document.activeElement);
    if (e.key === "Escape") {
      close();
      anchor.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      buttons[(i + 1) % buttons.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
    }
  };
  const onViewportChange = (e) => {
    if (e?.target instanceof Node && menu.contains(e.target)) return;
    close();
  };

  function close() {
    if (menu.contains(document.activeElement)) {
      document.activeElement.blur();
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    }
    menu.remove();
    anchor.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("scroll", onViewportChange, true);
    if (activeMenu?.menu === menu) activeMenu = null;
  }

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onViewportChange, true);
  activeMenu = { menu, anchor, close };
  return close;
}

// ---------- subscribe button ----------

/** Subscribe / Subscribed toggle. Mutates `channel.subscribed` and `channel.subscribers`. */
export function subscribeButton(channel, { onChange } = {}) {
  const button = h("button", { class: "btn subscribe-btn", type: "button" });
  const render = () => {
    button.classList.toggle("is-subscribed", channel.subscribed);
    button.setAttribute("aria-pressed", String(channel.subscribed));
    button.replaceChildren(...(channel.subscribed ? [icon("check"), "Subscribed"] : ["Subscribe"]));
  };
  button.addEventListener("click", async () => {
    const subscribe = !channel.subscribed;
    if (!subscribe) {
      const ok = await confirmDialog({ title: `Unsubscribe from ${channel.name}?`, message: "Their new videos will stop showing in your Subscriptions feed.", confirmLabel: "Unsubscribe" });
      if (!ok) return;
    }
    button.disabled = true;
    try {
      const url = `/api/channels/${encodeURIComponent(channel.id)}/subscription`;
      const res = subscribe ? await put(url) : await del(url);
      channel.subscribed = res.subscribed;
      channel.subscribers = res.subscribers;
      render();
      onChange?.(channel);
      emit("subscriptions");
      toast(subscribe ? `Subscribed to ${channel.name}` : "Subscription removed");
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
    }
  });
  render();
  return button;
}

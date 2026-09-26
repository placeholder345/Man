import { h, autogrow } from "../dom.js";
import { icon } from "../icons.js";
import { get, post, put, patch, del, session, hasChannel, events } from "../api.js";
import { createPlayer } from "../player.js";
import { navigate } from "../router.js";
import { prefs, getProgress } from "../store.js";
import {
  avatar,
  videoCard,
  skeletonCards,
  emptyState,
  richText,
  toast,
  modal,
  field,
  formError,
  confirmDialog,
  openMenu,
  copyText,
  subscribeButton,
  ensureChannel,
  watchUrl,
  channelUrl,
} from "../components.js";
import { compact, fullNumber, plural, viewsLabel, subscribersLabel, timeAgo, formatDate, formatTime, parseStartParam } from "../format.js";

export async function watchPage(ctx) {
  const id = ctx.query.get("v");
  let video;
  try {
    if (!id) throw Object.assign(new Error("Missing video"), { status: 404 });
    video = await get(`/api/videos/${encodeURIComponent(id)}`, { signal: ctx.signal });
  } catch (err) {
    if (err.status !== 404) throw err;
    ctx.setTitle("Video unavailable");
    return emptyState({
      iconName: "videos",
      title: "This video isn't available anymore",
      text: "It may have been deleted by the person who uploaded it.",
      action: h("a", { class: "btn btn-primary", href: "/" }, "Browse videos"),
    });
  }
  ctx.setTitle(video.title);

  const layout = h("div", { class: `watch${prefs.theater ? " is-theater" : ""}` });

  // ---------- player ----------

  const player = createPlayer({
    video,
    startAt: parseStartParam(ctx.query.get("t")),
    onView: () =>
      post(`/api/videos/${encodeURIComponent(video.id)}/view`)
        .then((r) => {
          video.views = r.views;
          description.renderStats();
        })
        .catch(() => {}),
    onTheater: toggleTheater,
    onNext: (next) => navigate(watchUrl(next.id)),
  });
  player.setTheater(prefs.theater);
  ctx.onCleanup(() => player.destroy());

  function toggleTheater() {
    const on = !layout.classList.contains("is-theater");
    layout.classList.toggle("is-theater", on);
    prefs.theater = on;
    player.setTheater(on);
  }

  const seekAndShow = (seconds) => {
    player.seekTo(seconds);
    player.el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const textOptions = {
    onTimestamp: seekAndShow,
    timestampHref: (t) => watchUrl(video.id, t),
    maxSeconds: video.duration || Infinity,
  };

  // ---------- title & actions ----------

  const title = h("h1", { class: "watch-title" }, video.title);
  const subscriberLine = h("span", { class: "owner-subs" }, subscribersLabel(video.channel.subscribers));

  const ownerRow = h(
    "div",
    { class: "watch-owner" },
    h(
      "div",
      { class: "owner-left" },
      avatar(video.channel, 40),
      h("div", { class: "owner-text" }, h("a", { class: "owner-name", href: channelUrl(video.channel.id) }, video.channel.name), subscriberLine),
      video.isOwner
        ? h("a", { class: "btn btn-tonal", href: channelUrl(video.channel.id) }, "Your channel")
        : subscribeButton(video.channel, { onChange: (c) => (subscriberLine.textContent = subscribersLabel(c.subscribers)) })
    ),
    h(
      "div",
      { class: "watch-actions" },
      ratingPill(video),
      h("button", { class: "btn btn-tonal", type: "button", onclick: () => shareDialog(video, player.currentTime) }, icon("share"), h("span", {}, "Share")),
      h("a", { class: "btn btn-tonal", href: `/api/videos/${encodeURIComponent(video.id)}/download`, download: "", title: "Download the original file" }, icon("download"), h("span", {}, "Download")),
      video.isOwner &&
        h(
          "button",
          {
            class: "icon-btn btn-tonal-round",
            type: "button",
            "aria-label": "More actions",
            "aria-haspopup": "menu",
            onclick: (e) =>
              openMenu(e.currentTarget, [
                { icon: "edit", label: "Edit details", onClick: () => editDialog(video, applyEdits) },
                { icon: "trash", label: "Delete video", danger: true, onClick: () => deleteVideo(video) },
              ]),
          },
          icon("more")
        )
    )
  );

  const description = descriptionBox(video, textOptions);

  function applyEdits(updated) {
    Object.assign(video, { title: updated.title, description: updated.description, category: updated.category });
    title.textContent = video.title;
    ctx.setTitle(video.title);
    description.renderText();
    description.renderStats();
  }

  // ---------- up next ----------

  const related = h("div", { class: "related" }, skeletonCards(8, "compact"));
  get(`/api/videos/${encodeURIComponent(video.id)}/related?limit=20`, { signal: ctx.signal })
    .then(({ videos }) => {
      related.replaceChildren(
        ...(videos.length
          ? videos.map((v) => videoCard(v, { layout: "compact" }))
          : [h("p", { class: "related-empty" }, "No other videos yet. Upload one!")])
      );
      // Prefer something not already watched to the end, so autoplay doesn't ping-pong.
      const unfinished = videos.find((v) => {
        const p = getProgress(v.id);
        return !p || p.time < p.duration - 5;
      });
      player.setNext(unfinished ?? videos[0] ?? null);
    })
    .catch((err) => {
      if (err.name !== "AbortError") related.replaceChildren(h("p", { class: "related-empty" }, "Couldn't load more videos."));
    });

  // ---------- layout ----------

  layout.append(
    h("div", { class: "watch-player" }, player.el),
    h("div", { class: "watch-primary" }, title, ownerRow, description.el),
    h("aside", { class: "watch-secondary", "aria-label": "Up next" }, related),
    commentsSection(video, textOptions, ctx)
  );
  return layout;
}

// ---------- likes ----------

function ratingPill(video) {
  const likeCount = h("span");
  const likeButton = h("button", { class: "pill-btn", type: "button", onclick: () => rate(1) }, icon("like"), likeCount);
  const dislikeButton = h("button", { class: "pill-btn", type: "button", onclick: () => rate(-1) }, icon("dislike"));

  const render = () => {
    likeCount.textContent = video.likes ? compact(video.likes) : "";
    likeButton.classList.toggle("is-active", video.myRating === 1);
    dislikeButton.classList.toggle("is-active", video.myRating === -1);
    likeButton.setAttribute("aria-pressed", String(video.myRating === 1));
    dislikeButton.setAttribute("aria-pressed", String(video.myRating === -1));
    likeButton.setAttribute("aria-label", `Like this video along with ${fullNumber(video.likes)} ${video.likes === 1 ? "other person" : "other people"}`);
    dislikeButton.setAttribute("aria-label", "Dislike this video");
  };

  let pending = Promise.resolve();
  function rate(value) {
    const next = video.myRating === value ? 0 : value;
    const before = { likes: video.likes, dislikes: video.dislikes, myRating: video.myRating };
    // Optimistic update
    if (video.myRating === 1) video.likes--;
    if (video.myRating === -1) video.dislikes--;
    if (next === 1) video.likes++;
    if (next === -1) video.dislikes++;
    video.myRating = next;
    render();
    if (next === 1) {
      likeButton.classList.remove("pop");
      void likeButton.offsetWidth;
      likeButton.classList.add("pop");
    }
    pending = pending.then(async () => {
      try {
        const res = await put(`/api/videos/${encodeURIComponent(video.id)}/rating`, { value: next });
        Object.assign(video, res);
        render();
        if (next === 1) toast("Added to Liked videos", { action: { label: "View", href: "/feed/liked" } });
        else if (before.myRating === 1) toast("Removed from Liked videos");
      } catch (err) {
        Object.assign(video, before);
        render();
        toast(err.message);
      }
    });
  }

  render();
  return h("div", { class: "rating-pill" }, likeButton, h("span", { class: "pill-divider" }), dislikeButton);
}

// ---------- description ----------

function descriptionBox(video, textOptions) {
  const stats = h("p", { class: "desc-stats" });
  const text = h("div", { class: "desc-text" });
  const toggle = h("button", { class: "desc-toggle", type: "button" });
  const el = h("div", { class: "desc-box is-collapsed" }, stats, text, toggle);

  const expanded = () => !el.classList.contains("is-collapsed");

  function renderStats() {
    stats.replaceChildren(
      h("strong", {}, expanded() ? `${fullNumber(video.views)} ${video.views === 1 ? "view" : "views"}` : viewsLabel(video.views)),
      h("strong", {}, expanded() ? formatDate(video.createdAt) : timeAgo(video.createdAt)),
      h("span", { class: "desc-category" }, video.category)
    );
  }
  function renderText() {
    text.replaceChildren(
      video.description ? richText(video.description, textOptions) : h("span", { class: "muted" }, "No description has been added to this video.")
    );
  }
  function setExpanded(open) {
    el.classList.toggle("is-collapsed", !open);
    toggle.textContent = open ? "Show less" : "…more";
    toggle.setAttribute("aria-expanded", String(open));
    renderStats();
  }

  el.addEventListener("click", (e) => {
    if (!expanded() && !e.target.closest("a, button")) setExpanded(true);
  });
  toggle.addEventListener("click", () => setExpanded(!expanded()));

  renderText();
  setExpanded(false);
  return { el, renderStats, renderText };
}

// ---------- share / edit / delete ----------

function shareDialog(video, time) {
  const plainLink = new URL(watchUrl(video.id), location.origin).href;
  const timedLink = new URL(watchUrl(video.id, time), location.origin).href;
  const input = h("input", { class: "input", readOnly: true, value: plainLink, "aria-label": "Link to this video", onfocus: (e) => e.target.select() });
  const startAt = h("input", { type: "checkbox", onchange: () => (input.value = startAt.checked ? timedLink : plainLink) });

  modal({
    title: "Share",
    className: "dialog-small",
    build: () => [
      h(
        "div",
        { class: "key-row" },
        input,
        h(
          "button",
          { class: "btn btn-primary", type: "button", onclick: async () => toast((await copyText(input.value)) ? "Link copied to clipboard" : "Couldn't copy. Select the link and copy it manually.") },
          "Copy"
        )
      ),
      time >= 1 && h("label", { class: "check-row" }, startAt, `Start at ${formatTime(time)}`),
      typeof navigator.share === "function" &&
        h(
          "button",
          {
            class: "btn btn-tonal share-native",
            type: "button",
            onclick: () => navigator.share({ title: video.title, url: input.value }).catch(() => {}),
          },
          icon("share"),
          "More sharing options"
        ),
    ],
  });
}

function editDialog(video, onSaved) {
  const limits = session.config.limits;
  const titleInput = h("input", { class: "input", type: "text", value: video.title, maxLength: limits.title, required: true });
  const descInput = h("textarea", { class: "input", rows: 6, maxLength: limits.description });
  descInput.value = video.description;
  const categorySelect = h(
    "select",
    { class: "input" },
    session.config.categories.map((c) => h("option", { value: c, selected: c === video.category }, c))
  );
  const error = formError();

  modal({
    title: "Edit video details",
    build: () => [
      field({ label: "Title", input: titleInput, counter: limits.title }),
      field({ label: "Description", input: descInput, counter: limits.description }),
      field({ label: "Category", input: categorySelect }),
      error.el,
    ],
    footer: (close) => [
      h("button", { class: "btn btn-text", type: "button", onclick: () => close() }, "Cancel"),
      h("button", { class: "btn btn-primary", type: "submit" }, "Save"),
    ],
    onSubmit: async (close, setBusy) => {
      if (!titleInput.value.trim()) {
        error.show("Your video needs a title.");
        titleInput.focus();
        return;
      }
      setBusy(true);
      try {
        const updated = await patch(`/api/videos/${encodeURIComponent(video.id)}`, {
          title: titleInput.value,
          description: descInput.value,
          category: categorySelect.value,
        });
        onSaved(updated);
        close();
        toast("Changes saved");
      } catch (err) {
        setBusy(false);
        error.show(err.message);
      }
    },
  });
  autogrow(descInput, 320);
}

async function deleteVideo(video) {
  const ok = await confirmDialog({
    title: "Delete this video?",
    message: `“${video.title}” and its comments will be deleted permanently. This can't be undone.`,
    confirmLabel: "Delete forever",
    danger: true,
  });
  if (!ok) return;
  try {
    await del(`/api/videos/${encodeURIComponent(video.id)}`);
    toast("Video deleted");
    navigate(channelUrl(video.channel.id), { replace: true });
  } catch (err) {
    toast(err.message);
  }
}

// ---------- comments ----------

function commentsSection(video, textOptions, ctx) {
  let total = video.commentCount;
  let offset = 0;
  const heading = h("h2", { class: "comments-count" });
  const renderCount = () => (heading.textContent = total ? plural(total, "Comment", "Comments", { full: true }) : "Comments");
  const list = h("div", { class: "comments-list" });
  const more = h("div", { class: "comments-more" });

  const itemOptions = {
    video,
    textOptions,
    onDeleted: () => {
      total = Math.max(0, total - 1);
      offset = Math.max(0, offset - 1);
      renderCount();
    },
  };

  async function loadMore() {
    more.replaceChildren(h("div", { class: "spinner small" }));
    try {
      const page = await get(`/api/videos/${encodeURIComponent(video.id)}/comments?offset=${offset}&limit=20`, { signal: ctx.signal });
      offset += page.comments.length;
      total = page.total;
      renderCount();
      list.append(...page.comments.map((c) => commentItem(c, itemOptions)));
      more.replaceChildren(
        page.hasMore ? h("button", { class: "btn btn-tonal", type: "button", onclick: loadMore }, "Show more comments") : ""
      );
    } catch (err) {
      if (err.name === "AbortError") return;
      more.replaceChildren(h("button", { class: "btn btn-tonal", type: "button", onclick: loadMore }, "Couldn't load comments. Retry"));
    }
  }

  const composer = commentComposer(video, ctx, (comment) => {
    total += 1;
    offset += 1;
    renderCount();
    list.prepend(commentItem(comment, itemOptions));
  });

  renderCount();
  loadMore();
  return h("section", { class: "watch-comments", "aria-label": "Comments" }, h("header", { class: "comments-head" }, heading), composer, list, more);
}

function commentComposer(video, ctx, onPosted) {
  const limit = session.config.limits.comment;
  const avatarSlot = h("div", { class: "composer-avatar" });
  const renderAvatar = () =>
    avatarSlot.replaceChildren(hasChannel() ? avatar(session.user, 40, { link: false }) : h("span", { class: "account-anon large" }, icon("user")));
  renderAvatar();
  events.addEventListener("user", renderAvatar);
  ctx.onCleanup(() => events.removeEventListener("user", renderAvatar));

  const input = h("textarea", { class: "composer-input", rows: 1, maxLength: limit, placeholder: "Add a comment…", "aria-label": "Add a comment" });
  const submit = h("button", { class: "btn btn-primary", type: "submit", disabled: true }, "Comment");
  const cancel = h("button", { class: "btn btn-text", type: "button" }, "Cancel");
  const form = h("form", { class: "composer" }, avatarSlot, h("div", { class: "composer-main" }, input, h("div", { class: "composer-actions" }, cancel, submit)));
  autogrow(input, 300);

  const reset = () => {
    input.value = "";
    input.dispatchEvent(new Event("input"));
    form.classList.remove("is-active");
    input.blur();
  };

  input.addEventListener("focus", async () => {
    form.classList.add("is-active");
    if (!hasChannel()) {
      input.blur();
      if (await ensureChannel("Create a channel to join the conversation. Your channel name is shown next to your comments.")) input.focus();
      else form.classList.remove("is-active");
    }
  });
  input.addEventListener("input", () => (submit.disabled = !input.value.trim()));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  cancel.addEventListener("click", reset);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    submit.disabled = true;
    input.disabled = true;
    try {
      const comment = await post(`/api/videos/${encodeURIComponent(video.id)}/comments`, { body });
      onPosted(comment);
      input.disabled = false;
      reset();
    } catch (err) {
      toast(err.message);
      input.disabled = false;
      submit.disabled = false;
    }
  });
  return form;
}

function commentItem(comment, { video, textOptions, onDeleted }) {
  const long = comment.body.length > 400 || comment.body.split("\n").length > 5;
  const body = h("div", { class: `comment-body${long ? " is-clamped" : ""}` }, richText(comment.body, textOptions));
  const isCreator = comment.author.id === video.channel.id;

  const item = h(
    "article",
    { class: "comment" },
    avatar(comment.author, 40),
    h(
      "div",
      { class: "comment-main" },
      h(
        "div",
        { class: "comment-head" },
        h("a", { class: `comment-author${isCreator ? " is-creator" : ""}`, href: channelUrl(comment.author.id) }, comment.author.name),
        h("span", { class: "comment-time", title: formatDate(comment.createdAt) }, timeAgo(comment.createdAt))
      ),
      body,
      long &&
        h(
          "button",
          {
            class: "link-btn comment-more",
            type: "button",
            onclick: (e) => {
              const clamped = body.classList.toggle("is-clamped");
              e.currentTarget.textContent = clamped ? "Read more" : "Show less";
            },
          },
          "Read more"
        )
    ),
    comment.canDelete &&
      h(
        "button",
        {
          class: "icon-btn comment-menu",
          type: "button",
          "aria-label": "Comment actions",
          "aria-haspopup": "menu",
          onclick: (e) =>
            openMenu(e.currentTarget, [
              {
                icon: "trash",
                label: "Delete",
                danger: true,
                onClick: async () => {
                  const ok = await confirmDialog({ title: "Delete comment?", message: "Delete your comment permanently?", confirmLabel: "Delete", danger: true });
                  if (!ok) return;
                  try {
                    await del(`/api/comments/${comment.id}`);
                    item.remove();
                    onDeleted();
                    toast("Comment deleted");
                  } catch (err) {
                    toast(err.message);
                  }
                },
              },
            ]),
        },
        icon("moreVertical")
      )
  );
  return item;
}

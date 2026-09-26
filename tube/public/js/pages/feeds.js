import { h } from "../dom.js";
import { icon } from "../icons.js";
import { get, del, query } from "../api.js";
import { infiniteVideos, emptyState, confirmDialog, toast } from "../components.js";
import { clearAllProgress } from "../store.js";

function feedPage({ title, iconName, layout, endpoint, empty, actions, extra }) {
  return async (ctx) => {
    ctx.setTitle(title);
    const list = infiniteVideos({
      layout,
      signal: ctx.signal,
      extra,
      load: (offset, limit) => get(`${endpoint}${query({ offset, limit })}`, { signal: ctx.signal }),
      empty: () => emptyState({ iconName, ...empty }),
    });
    await list.ready;
    return h(
      "div",
      { class: `page-feed feed-${layout}` },
      h("header", { class: "feed-head" }, h("h1", {}, icon(iconName), title), actions?.(ctx)),
      list.el
    );
  };
}

export const subscriptionsPage = feedPage({
  title: "Subscriptions",
  iconName: "subscriptions",
  layout: "grid",
  endpoint: "/api/feed/subscriptions",
  empty: {
    title: "Don't miss new videos",
    text: "Subscribe to channels you like and their latest uploads show up here.",
    action: h("a", { class: "btn btn-primary", href: "/" }, "Find videos"),
  },
});

export const likedPage = feedPage({
  title: "Liked videos",
  iconName: "like",
  layout: "list",
  endpoint: "/api/feed/liked",
  empty: {
    title: "No liked videos yet",
    text: "Tap the thumbs-up on videos you enjoy and they're saved here.",
  },
});

export const historyPage = feedPage({
  title: "Watch history",
  iconName: "history",
  layout: "list",
  endpoint: "/api/feed/history",
  empty: {
    title: "This list has no videos",
    text: "Videos you watch show up here, so you can find them again.",
  },
  actions: (ctx) =>
    h(
      "button",
      {
        class: "btn btn-tonal",
        type: "button",
        onclick: async () => {
          const ok = await confirmDialog({
            title: "Clear watch history?",
            message: "Your history and saved playback positions will be cleared on this device.",
            confirmLabel: "Clear history",
            danger: true,
          });
          if (!ok) return;
          try {
            await del("/api/feed/history");
            clearAllProgress();
            toast("Watch history cleared");
            document.querySelector(".page-feed .infinite")?.replaceChildren(
              emptyState({ iconName: "history", title: "This list has no videos", text: "Videos you watch show up here, so you can find them again." })
            );
          } catch (err) {
            toast(err.message);
          }
        },
      },
      icon("trash"),
      "Clear all watch history"
    ),
  extra: (video, card, list) =>
    h(
      "button",
      {
        class: "icon-btn card-remove",
        type: "button",
        "aria-label": `Remove “${video.title}” from watch history`,
        title: "Remove from watch history",
        onclick: async () => {
          try {
            await del(`/api/feed/history/${encodeURIComponent(video.id)}`);
            card.remove();
            list.removed();
            toast("Removed from watch history");
          } catch (err) {
            toast(err.message);
          }
        },
      },
      icon("close")
    ),
});

import { h } from "../dom.js";
import { get, query } from "../api.js";
import { infiniteVideos, emptyState } from "../components.js";

/** Combines the page's signal with a narrower one (e.g. a category switch). */
function linkedController(parent) {
  const controller = new AbortController();
  if (parent.aborted) controller.abort();
  else parent.addEventListener("abort", () => controller.abort(), { once: true });
  return controller;
}

export async function homePage(ctx) {
  ctx.setTitle("");
  let categories = [];
  try {
    categories = await get("/api/categories", { signal: ctx.signal });
  } catch (err) {
    if (err.name === "AbortError") throw err;
  }

  let category = "";
  let feedController = null;
  const chips = h("div", { class: "chips", role: "toolbar", "aria-label": "Filter by category" });
  const feed = h("div", { class: "home-feed" });

  function renderChips() {
    chips.replaceChildren(
      ...["", ...categories.map((c) => c.name)].map((name) =>
        h(
          "button",
          {
            class: `chip${name === category ? " is-active" : ""}`,
            type: "button",
            "aria-pressed": String(name === category),
            onclick: () => {
              if (name === category) return;
              category = name;
              renderChips();
              loadFeed();
            },
          },
          name || "All"
        )
      )
    );
  }

  function loadFeed() {
    feedController?.abort();
    feedController = linkedController(ctx.signal);
    const signal = feedController.signal;
    const list = infiniteVideos({
      signal,
      load: (offset, limit) => get(`/api/videos${query({ category, offset, limit })}`, { signal }),
      empty: () =>
        emptyState({
          iconName: "videos",
          title: category ? `No ${category} videos yet` : "Nothing to watch yet",
          text: category ? "Try another category." : "Upload the first video and get things started.",
          action: category ? null : h("a", { class: "btn btn-primary btn-lg", href: "/upload" }, "Upload a video"),
        }),
    });
    feed.replaceChildren(list.el);
    return list.ready;
  }

  if (categories.length > 1) renderChips();
  await loadFeed();
  return h("div", { class: "page-home" }, categories.length > 1 && h("div", { class: "chips-bar" }, chips), feed);
}

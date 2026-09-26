import { h } from "../dom.js";
import { get, query } from "../api.js";
import { infiniteVideos, emptyState } from "../components.js";

const SORTS = [
  ["", "Relevance"],
  ["new", "Upload date"],
  ["popular", "View count"],
];

export async function resultsPage(ctx) {
  const q = (ctx.query.get("search_query") || "").trim();
  if (!q) {
    ctx.setTitle("Search");
    return emptyState({ iconName: "search", title: "Search ManTube", text: "Type what you're looking for in the search box above." });
  }
  ctx.setTitle(q);
  const sort = SORTS.some(([key]) => key === ctx.query.get("sort")) ? ctx.query.get("sort") : "";

  const list = infiniteVideos({
    layout: "list",
    signal: ctx.signal,
    load: (offset, limit) => get(`/api/videos${query({ q, sort, offset, limit })}`, { signal: ctx.signal }),
    empty: () =>
      emptyState({
        iconName: "search",
        title: "No results found",
        text: "Try different keywords, or check the spelling.",
      }),
  });
  await list.ready;

  return h(
    "div",
    { class: "page-results" },
    h(
      "div",
      { class: "chips", role: "toolbar", "aria-label": "Sort results" },
      SORTS.map(([key, label]) =>
        h(
          "a",
          {
            class: `chip${key === sort ? " is-active" : ""}`,
            href: `/results${query({ search_query: q, sort: key })}`,
            "aria-current": key === sort ? "true" : null,
          },
          label
        )
      )
    ),
    list.el
  );
}

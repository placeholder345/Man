import { h, hueOf } from "../dom.js";
import { icon } from "../icons.js";
import { get, query, session, hasChannel } from "../api.js";
import { navigate, reload } from "../router.js";
import { avatar, infiniteVideos, emptyState, subscribeButton, channelDialog, channelUrl } from "../components.js";
import { plural, subscribersLabel, formatDate, fullNumber } from "../format.js";

const SORTS = [
  ["new", "Latest"],
  ["popular", "Popular"],
  ["old", "Oldest"],
];

export async function myChannelPage(ctx) {
  if (hasChannel()) {
    navigate(channelUrl(session.user.id), { replace: true });
    return h("div");
  }
  ctx.setTitle("Your channel");
  return emptyState({
    iconName: "channel",
    title: "Create your channel",
    text: "Your channel is where your uploads live. Viewers can subscribe to it to see your new videos.",
    action: h(
      "button",
      {
        class: "btn btn-primary btn-lg",
        type: "button",
        onclick: async () => {
          if (await channelDialog({ mode: "create" })) navigate(channelUrl(session.user.id), { replace: true });
        },
      },
      "Create channel"
    ),
  });
}

export async function channelPage(ctx) {
  const id = ctx.params[0];
  let channel;
  try {
    channel = await get(`/api/channels/${encodeURIComponent(id)}`, { signal: ctx.signal });
  } catch (err) {
    if (err.status !== 404) throw err;
    ctx.setTitle("Channel not found");
    return emptyState({
      iconName: "channel",
      title: "This channel doesn't exist",
      action: h("a", { class: "btn btn-primary", href: "/" }, "Go home"),
    });
  }
  ctx.setTitle(channel.name);
  const hue = hueOf(channel.id);

  const subsLine = h("span", {}, subscribersLabel(channel.subscribers));
  const about = channel.about
    ? h("p", { class: "channel-about is-clamped", title: "Show more", onclick: (e) => e.currentTarget.classList.toggle("is-clamped") }, channel.about)
    : null;

  const actions = channel.isMe
    ? [
        h(
          "button",
          {
            class: "btn btn-tonal",
            type: "button",
            onclick: async () => {
              if (await channelDialog({ mode: "edit" })) reload();
            },
          },
          icon("edit"),
          "Customize channel"
        ),
        h("a", { class: "btn btn-primary", href: "/upload" }, icon("upload"), "Upload video"),
      ]
    : [subscribeButton(channel, { onChange: (c) => (subsLine.textContent = subscribersLabel(c.subscribers)) })];

  const header = h(
    "header",
    { class: "channel-header" },
    h("div", { class: "channel-banner", style: { "--hue": hue } }),
    h(
      "div",
      { class: "channel-info" },
      avatar(channel, 144, { link: false }),
      h(
        "div",
        { class: "channel-text" },
        h("h1", { class: "channel-name" }, channel.name),
        h(
          "p",
          { class: "channel-meta" },
          subsLine,
          h("span", { class: "dot", "aria-hidden": "true" }, "•"),
          plural(channel.videoCount, "video"),
          h("span", { class: "dot", "aria-hidden": "true" }, "•"),
          `${fullNumber(channel.totalViews)} ${channel.totalViews === 1 ? "view" : "views"}`,
          h("span", { class: "dot", "aria-hidden": "true" }, "•"),
          `Joined ${formatDate(channel.createdAt)}`
        ),
        about,
        h("div", { class: "channel-actions" }, actions)
      )
    )
  );

  const sort = SORTS.some(([key]) => key === ctx.query.get("sort")) ? ctx.query.get("sort") : "new";
  const list = infiniteVideos({
    signal: ctx.signal,
    cardOptions: { showChannel: false },
    load: (offset, limit) => get(`/api/videos${query({ channel: channel.id, sort, offset, limit })}`, { signal: ctx.signal }),
    empty: () =>
      channel.isMe
        ? emptyState({
            iconName: "upload",
            title: "Upload your first video",
            text: "Share something you've made. It keeps its full original quality.",
            action: h("a", { class: "btn btn-primary btn-lg", href: "/upload" }, "Upload video"),
          })
        : emptyState({ iconName: "videos", title: "No videos yet", text: `${channel.name} hasn't uploaded anything yet.` }),
  });
  await list.ready;

  return h(
    "div",
    { class: "page-channel" },
    header,
    h(
      "div",
      { class: "channel-tabs" },
      h("h2", { class: "channel-tab is-active" }, "Videos"),
      channel.videoCount > 1 &&
        h(
          "div",
          { class: "chips" },
          SORTS.map(([key, label]) =>
            h("a", { class: `chip${key === sort ? " is-active" : ""}`, href: `${channelUrl(channel.id)}${query({ sort: key === "new" ? "" : key })}` }, label)
          )
        )
    ),
    list.el
  );
}

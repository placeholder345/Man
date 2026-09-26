import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../src/app.js";

let server;
let base;
let dataDir;
let dirs;

// Smallest thing our sniffing accepts as an MP4: an ISO-BMFF "ftyp" box.
const fakeMp4 = (size = 4096) => {
  const buf = Buffer.alloc(size);
  buf.writeUInt32BE(24, 0);
  buf.write("ftypisom", 4, "latin1");
  return buf;
};
const fakeJpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]);

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mantube-test-"));
  const created = createApp({ dataDir, maxUploadBytes: 1024 * 1024 });
  dirs = created.dirs;
  server = http.createServer(created.app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function call(method, url, { token, body, form, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (form) init.body = form;
  else if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(base + url, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text, headers: res.headers };
}

async function newUser(name) {
  const { json } = await call("POST", "/api/session");
  if (name) await call("PATCH", "/api/me", { token: json.token, body: { name } });
  return { token: json.token, id: json.user.id };
}

function uploadForm({ title = "My video", file = fakeMp4(), filename = "clip.mp4", thumbnail, extra = {} } = {}) {
  const form = new FormData();
  form.append("title", title);
  form.append("description", "Watch this at 0:05\r\nsecond line");
  form.append("category", "Music");
  form.append("duration", "12.5");
  form.append("width", "1920");
  form.append("height", "1080");
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  if (thumbnail) form.append("thumbnail", new Blob([thumbnail]), "thumb.jpg");
  form.append("video", new Blob([file]), filename);
  return form;
}

const tmpFiles = () => fs.readdirSync(dirs.tmp);

test("serves the app shell with security headers and SPA fallback", async () => {
  for (const url of ["/", "/watch?v=abc", "/channel/UCxyz", "/upload"]) {
    const res = await call("GET", url);
    assert.equal(res.status, 200, url);
    assert.match(res.text, /<div id="app">/);
    assert.match(res.headers.get("content-security-policy"), /default-src 'self'/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  }
  assert.equal((await call("GET", "/js/main.js")).status, 200);
  assert.equal((await call("GET", "/missing.js")).status, 404);
  const api404 = await call("GET", "/api/nope");
  assert.equal(api404.status, 404);
  assert.equal(api404.json.error, "Not found.");
});

test("sessions and channel names", async () => {
  const { json: session } = await call("POST", "/api/session");
  assert.ok(session.token.length >= 40);
  assert.equal(session.user.name, null);

  assert.equal((await call("GET", "/api/me")).status, 401);
  assert.equal((await call("GET", "/api/me", { token: "x".repeat(43) })).status, 401);

  const bad = await call("PATCH", "/api/me", { token: session.token, body: { name: "   " } });
  assert.equal(bad.status, 400);
  const tooLong = await call("PATCH", "/api/me", { token: session.token, body: { name: "x".repeat(51) } });
  assert.equal(tooLong.status, 400);

  const ok = await call("PATCH", "/api/me", { token: session.token, body: { name: "  Nora \n Makes  " } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.name, "Nora Makes");

  const badJson = await fetch(`${base}/api/me`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
    body: "{nope",
  });
  assert.equal(badJson.status, 400);
});

test("uploading requires a channel", async () => {
  const anon = await newUser();
  const res = await call("POST", "/api/videos", { token: anon.token, form: uploadForm() });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, "NO_CHANNEL");
  const noSession = await call("POST", "/api/videos", { form: uploadForm() });
  assert.equal(noSession.status, 401);
});

test("full upload → list → watch → stream → download → edit → delete", async () => {
  const me = await newUser("Uploader");
  const res = await call("POST", "/api/videos", { token: me.token, form: uploadForm({ title: "  Hello   world ", thumbnail: fakeJpeg() }) });
  assert.equal(res.status, 201, res.text);
  const video = res.json;
  assert.equal(video.id.length, 11);
  assert.equal(video.title, "Hello world");
  assert.equal(video.description, "Watch this at 0:05\nsecond line");
  assert.equal(video.category, "Music");
  assert.equal(video.duration, 12.5);
  assert.equal(video.width, 1920);
  assert.equal(video.size, 4096);
  assert.equal(video.isOwner, true);
  assert.match(video.thumbnailUrl, /\.jpg$/);
  assert.deepEqual(tmpFiles(), []);

  const list = await call("GET", "/api/videos");
  assert.ok(list.json.videos.some((v) => v.id === video.id));

  const other = await newUser();
  const detail = await call("GET", `/api/videos/${video.id}`, { token: other.token });
  assert.equal(detail.json.isOwner, false);
  assert.equal(detail.json.channel.name, "Uploader");

  // Byte-range streaming (what the <video> element uses for seeking)
  const media = await fetch(base + video.videoUrl, { headers: { Range: "bytes=0-99" } });
  assert.equal(media.status, 206);
  assert.equal(media.headers.get("content-range"), "bytes 0-99/4096");
  assert.equal((await media.arrayBuffer()).byteLength, 100);
  assert.equal(media.headers.get("content-type"), "video/mp4");

  const thumb = await fetch(base + video.thumbnailUrl);
  assert.equal(thumb.status, 200);
  assert.equal(thumb.headers.get("content-type"), "image/jpeg");

  const download = await fetch(`${base}/api/videos/${video.id}/download`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /attachment; filename="Hello world\.mp4"/);

  // Only the owner can edit or delete
  const hijack = await call("PATCH", `/api/videos/${video.id}`, { token: other.token, body: { title: "pwned" } });
  assert.equal(hijack.status, 403);
  assert.equal((await call("DELETE", `/api/videos/${video.id}`, { token: other.token })).status, 403);

  const edited = await call("PATCH", `/api/videos/${video.id}`, { token: me.token, body: { title: "New title" } });
  assert.equal(edited.status, 200);
  assert.equal(edited.json.title, "New title");
  assert.equal(edited.json.category, "Music");
  assert.equal((await call("PATCH", `/api/videos/${video.id}`, { token: me.token, body: { category: "Nope" } })).status, 400);
  assert.equal((await call("PATCH", `/api/videos/${video.id}`, { token: me.token, body: { title: "" } })).status, 400);

  assert.equal((await call("DELETE", `/api/videos/${video.id}`, { token: me.token })).status, 204);
  assert.equal((await call("GET", `/api/videos/${video.id}`)).status, 404);
  assert.equal((await fetch(base + video.videoUrl)).status, 404);
  assert.deepEqual(fs.readdirSync(dirs.videos).filter((f) => f.startsWith(video.id)), []);
  assert.deepEqual(fs.readdirSync(dirs.thumbs).filter((f) => f.startsWith(video.id)), []);
});

test("rejects files that aren't videos and cleans up", async () => {
  const me = await newUser("Rejecter");
  const renamed = await call("POST", "/api/videos", {
    token: me.token,
    form: uploadForm({ file: Buffer.from("<html><script>alert(1)</script></html>".padEnd(600, " ")), filename: "evil.mp4" }),
  });
  assert.equal(renamed.status, 415);

  const wrongExt = await call("POST", "/api/videos", { token: me.token, form: uploadForm({ filename: "notes.txt" }) });
  assert.equal(wrongExt.status, 415);

  const badThumb = await call("POST", "/api/videos", {
    token: me.token,
    form: uploadForm({ thumbnail: Buffer.from("<svg onload=alert(1)></svg>".padEnd(64)) }),
  });
  assert.equal(badThumb.status, 415);

  const empty = await call("POST", "/api/videos", { token: me.token, form: uploadForm({ file: Buffer.alloc(0) }) });
  assert.equal(empty.status, 400);

  const noFile = new FormData();
  noFile.append("title", "x");
  assert.equal((await call("POST", "/api/videos", { token: me.token, form: noFile })).status, 400);

  const notMultipart = await call("POST", "/api/videos", { token: me.token, body: { title: "x" } });
  assert.equal(notMultipart.status, 400);

  const longTitle = await call("POST", "/api/videos", { token: me.token, form: uploadForm({ title: "x".repeat(101) }) });
  assert.equal(longTitle.status, 400);

  // Empty title falls back to the file name
  const fallback = await call("POST", "/api/videos", { token: me.token, form: uploadForm({ title: "", filename: "Summer_trip.webm", file: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(100)]) }) });
  assert.equal(fallback.status, 201);
  assert.equal(fallback.json.title, "Summer_trip");
  assert.match(fallback.json.videoUrl, /\.webm$/);

  assert.deepEqual(tmpFiles(), []);
  const leftovers = fs.readdirSync(dirs.videos).filter((f) => !f.startsWith(fallback.json.id));
  const known = (await call("GET", "/api/videos?limit=100")).json.videos.map((v) => v.id);
  assert.ok(leftovers.every((f) => known.some((id) => f.startsWith(id))), "no orphaned video files");
});

test("enforces the configured size limit and removes the partial file", async () => {
  const me = await newUser("Big");
  const res = await call("POST", "/api/videos", { token: me.token, form: uploadForm({ file: fakeMp4(1024 * 1024 + 10) }) });
  assert.equal(res.status, 413);
  assert.match(res.json.error, /1\.0 MB/);
  assert.deepEqual(tmpFiles(), []);
});

test("a cancelled upload leaves nothing behind", async () => {
  const me = await newUser("Canceller");
  const boundary = "----mantubeboundary";
  const head =
    `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nCancelled\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="big.mp4"\r\nContent-Type: video/mp4\r\n\r\n`;
  const before = (await call("GET", "/api/videos?limit=100")).json.videos.length;

  await new Promise((resolve) => {
    const req = http.request(`${base}/api/videos`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${me.token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": 10_000_000,
      },
    });
    req.on("error", () => resolve());
    req.write(head);
    req.write(fakeMp4(200_000));
    setTimeout(() => {
      req.destroy();
      resolve();
    }, 150);
  });

  // Give the server a moment to notice and clean up.
  for (let i = 0; i < 40 && tmpFiles().length; i++) await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(tmpFiles(), []);
  assert.equal((await call("GET", "/api/videos?limit=100")).json.videos.length, before);
});

test("views are counted once per viewer per 30 minutes and feed history", async () => {
  const owner = await newUser("Viewed");
  const { json: video } = await call("POST", "/api/videos", { token: owner.token, form: uploadForm() });
  const viewer = await newUser();

  assert.equal((await call("POST", `/api/videos/${video.id}/view`)).status, 401);
  assert.equal((await call("POST", `/api/videos/${video.id}/view`, { token: viewer.token })).json.views, 1);
  assert.equal((await call("POST", `/api/videos/${video.id}/view`, { token: viewer.token })).json.views, 1);
  assert.equal((await call("POST", `/api/videos/${video.id}/view`, { token: owner.token })).json.views, 2);

  const history = await call("GET", "/api/feed/history", { token: viewer.token });
  assert.equal(history.json.videos[0].id, video.id);
  assert.ok(history.json.videos[0].watchedAt > 0);

  assert.equal((await call("DELETE", `/api/feed/history/${video.id}`, { token: viewer.token })).status, 204);
  assert.equal((await call("GET", "/api/feed/history", { token: viewer.token })).json.videos.length, 0);
  await call("POST", `/api/videos/${video.id}/view`, { token: viewer.token });
  assert.equal((await call("DELETE", "/api/feed/history", { token: viewer.token })).status, 204);
  assert.equal((await call("GET", "/api/feed/history", { token: viewer.token })).json.videos.length, 0);
});

test("likes and dislikes", async () => {
  const owner = await newUser("Rated");
  const { json: video } = await call("POST", "/api/videos", { token: owner.token, form: uploadForm() });
  const a = await newUser();
  const b = await newUser();
  const rate = (u, value) => call("PUT", `/api/videos/${video.id}/rating`, { token: u.token, body: { value } });

  assert.deepEqual((await rate(a, 1)).json, { likes: 1, dislikes: 0, myRating: 1 });
  assert.deepEqual((await rate(b, -1)).json, { likes: 1, dislikes: 1, myRating: -1 });
  assert.deepEqual((await rate(a, -1)).json, { likes: 0, dislikes: 2, myRating: -1 });
  assert.deepEqual((await rate(a, 0)).json, { likes: 0, dislikes: 1, myRating: 0 });
  assert.equal((await rate(a, 5)).status, 400);
  assert.equal((await rate(a, "1")).status, 400);

  await rate(a, 1);
  const liked = await call("GET", "/api/feed/liked", { token: a.token });
  assert.deepEqual(liked.json.videos.map((v) => v.id), [video.id]);
  const detail = await call("GET", `/api/videos/${video.id}`, { token: a.token });
  assert.equal(detail.json.myRating, 1);
  assert.equal(detail.json.likes, 1);
});

test("comments: post, list, permissions, delete", async () => {
  const owner = await newUser("Commented");
  const { json: video } = await call("POST", "/api/videos", { token: owner.token, form: uploadForm() });
  const fan = await newUser("Fan");
  const stranger = await newUser("Stranger");
  const anon = await newUser();

  const anonPost = await call("POST", `/api/videos/${video.id}/comments`, { token: anon.token, body: { body: "hi" } });
  assert.equal(anonPost.status, 403);
  assert.equal((await call("POST", `/api/videos/${video.id}/comments`, { token: fan.token, body: { body: "   " } })).status, 400);
  assert.equal((await call("POST", `/api/videos/${video.id}/comments`, { token: fan.token, body: { body: "x".repeat(10001) } })).status, 400);

  const first = await call("POST", `/api/videos/${video.id}/comments`, { token: fan.token, body: { body: "<b>First!</b>" } });
  assert.equal(first.status, 201);
  assert.equal(first.json.body, "<b>First!</b>");
  assert.equal(first.json.author.name, "Fan");
  assert.equal(first.json.canDelete, true);
  const second = await call("POST", `/api/videos/${video.id}/comments`, { token: stranger.token, body: { body: "Second" } });

  const asStranger = await call("GET", `/api/videos/${video.id}/comments`, { token: stranger.token });
  assert.equal(asStranger.json.total, 2);
  assert.equal(asStranger.json.comments[0].id, second.json.id, "newest first");
  assert.deepEqual(asStranger.json.comments.map((c) => c.canDelete), [true, false]);

  const asOwner = await call("GET", `/api/videos/${video.id}/comments`, { token: owner.token });
  assert.deepEqual(asOwner.json.comments.map((c) => c.canDelete), [true, true]);

  const paged = await call("GET", `/api/videos/${video.id}/comments?limit=1`);
  assert.equal(paged.json.comments.length, 1);
  assert.equal(paged.json.hasMore, true);

  assert.equal((await call("DELETE", `/api/comments/${first.json.id}`, { token: stranger.token })).status, 403);
  assert.equal((await call("DELETE", `/api/comments/${first.json.id}`, { token: owner.token })).status, 204);
  assert.equal((await call("DELETE", `/api/comments/${first.json.id}`, { token: owner.token })).status, 404);
  assert.equal((await call("DELETE", `/api/comments/abc`, { token: owner.token })).status, 404);
  assert.equal((await call("GET", `/api/videos/${video.id}`)).json.commentCount, 1);
});

test("channels and subscriptions", async () => {
  const creator = await newUser("Creator");
  await call("PATCH", "/api/me", { token: creator.token, body: { about: "About me" } });
  await call("POST", "/api/videos", { token: creator.token, form: uploadForm({ title: "Creator vid" }) });
  const fan = await newUser();
  const anon = await newUser();

  const channel = await call("GET", `/api/channels/${creator.id}`, { token: fan.token });
  assert.equal(channel.json.name, "Creator");
  assert.equal(channel.json.about, "About me");
  assert.equal(channel.json.videoCount, 1);
  assert.equal(channel.json.subscribed, false);
  assert.equal((await call("GET", `/api/channels/${anon.id}`)).status, 404, "nameless users aren't channels");
  assert.equal((await call("GET", "/api/channels/UCnope")).status, 404);

  const sub = await call("PUT", `/api/channels/${creator.id}/subscription`, { token: fan.token });
  assert.deepEqual(sub.json, { subscribed: true, subscribers: 1 });
  assert.equal((await call("PUT", `/api/channels/${creator.id}/subscription`, { token: fan.token })).json.subscribers, 1);
  assert.equal((await call("PUT", `/api/channels/${creator.id}/subscription`, { token: creator.token })).status, 400);

  assert.deepEqual((await call("GET", "/api/me/subscriptions", { token: fan.token })).json, [{ id: creator.id, name: "Creator" }]);
  const feed = await call("GET", "/api/feed/subscriptions", { token: fan.token });
  assert.deepEqual(feed.json.videos.map((v) => v.title), ["Creator vid"]);

  const unsub = await call("DELETE", `/api/channels/${creator.id}/subscription`, { token: fan.token });
  assert.deepEqual(unsub.json, { subscribed: false, subscribers: 0 });
  assert.equal((await call("GET", "/api/feed/subscriptions", { token: fan.token })).json.videos.length, 0);
});

test("search, filters, sorting, paging and related videos", async () => {
  const a = await newUser("Searchable Sam");
  const ids = {};
  for (const [title, category] of [
    ["Banana bread recipe", "Howto & Style"],
    ["Guitar solo 100% live", "Music"],
    ["Bread and butter_pudding", "Howto & Style"],
  ]) {
    const form = uploadForm({ title });
    form.set("category", category);
    ids[title] = (await call("POST", "/api/videos", { token: a.token, form })).json.id;
  }

  const bread = await call("GET", `/api/videos?q=${encodeURIComponent("bread")}`);
  assert.deepEqual(new Set(bread.json.videos.map((v) => v.id)), new Set([ids["Banana bread recipe"], ids["Bread and butter_pudding"]]));

  const both = await call("GET", `/api/videos?q=${encodeURIComponent("banana bread")}`);
  assert.deepEqual(both.json.videos.map((v) => v.id), [ids["Banana bread recipe"]]);

  // LIKE wildcards in the query are treated literally
  const pct = await call("GET", `/api/videos?channel=${a.id}&q=${encodeURIComponent("100%")}`);
  assert.deepEqual(pct.json.videos.map((v) => v.id), [ids["Guitar solo 100% live"]]);
  const underscore = await call("GET", `/api/videos?channel=${a.id}&q=${encodeURIComponent("_")}`);
  assert.deepEqual(underscore.json.videos.map((v) => v.id), [ids["Bread and butter_pudding"]]);

  const byChannelName = await call("GET", `/api/videos?q=${encodeURIComponent("searchable sam")}`);
  assert.equal(byChannelName.json.videos.length, 3);

  const music = await call("GET", `/api/videos?category=${encodeURIComponent("Music")}&channel=${a.id}`);
  assert.deepEqual(music.json.videos.map((v) => v.id), [ids["Guitar solo 100% live"]]);

  const page1 = await call("GET", `/api/videos?channel=${a.id}&limit=2&sort=old`);
  assert.equal(page1.json.videos.length, 2);
  assert.equal(page1.json.hasMore, true);
  assert.equal(page1.json.videos[0].id, ids["Banana bread recipe"]);
  const page2 = await call("GET", `/api/videos?channel=${a.id}&limit=2&offset=2&sort=old`);
  assert.equal(page2.json.hasMore, false);
  assert.deepEqual(page2.json.videos.map((v) => v.id), [ids["Bread and butter_pudding"]]);

  const weird = await call("GET", "/api/videos?limit=abc&offset=-5&sort=nope&q=");
  assert.equal(weird.status, 200);

  const related = await call("GET", `/api/videos/${ids["Banana bread recipe"]}/related`);
  assert.ok(!related.json.videos.some((v) => v.id === ids["Banana bread recipe"]));
  assert.equal(related.json.videos[0].id, ids["Bread and butter_pudding"], "same channel + category ranks first");

  const cats = await call("GET", "/api/categories");
  assert.ok(cats.json.some((c) => c.name === "Howto & Style" && c.count >= 2));
});

test("long descriptions are trimmed in lists but complete on the watch page", async () => {
  const me = await newUser("Wordy");
  const form = uploadForm();
  form.set("description", "word ".repeat(400));
  const { json: video } = await call("POST", "/api/videos", { token: me.token, form });
  const list = await call("GET", `/api/videos?channel=${me.id}`);
  assert.ok(list.json.videos[0].description.length <= 241);
  assert.equal((await call("GET", `/api/videos/${video.id}`)).json.description.length, "word ".repeat(400).trim().length);
});

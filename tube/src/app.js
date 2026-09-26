import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { openDatabase, transaction } from "./db.js";
import { HttpError, parseVideoUpload, looksLikeVideo, imageExtension } from "./upload.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

export const CATEGORIES = [
  "Film & Animation",
  "Autos & Vehicles",
  "Music",
  "Pets & Animals",
  "Sports",
  "Travel & Events",
  "Gaming",
  "People & Blogs",
  "Comedy",
  "Entertainment",
  "News & Politics",
  "Howto & Style",
  "Education",
  "Science & Technology",
  "Nonprofits & Activism",
];
const DEFAULT_CATEGORY = "People & Blogs";

const LIMITS = { title: 100, description: 5000, comment: 10000, name: 50, about: 1000 };

// The same viewer re-watching within this window doesn't add another view.
const VIEW_COOLDOWN_MS = 30 * 60 * 1000;

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const newVideoId = () => crypto.randomBytes(8).toString("base64url");
const newUserId = () => "UC" + crypto.randomBytes(16).toString("base64url");
const newToken = () => crypto.randomBytes(32).toString("base64url");
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

/** A single line of text: no control characters, whitespace collapsed. */
const cleanLine = (value) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Multi-line text: normalized newlines, no control characters other than tab/newline. */
const cleanText = (value) =>
  String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

/** First value of a query parameter as a string (repeated params arrive as arrays). */
const queryString = (value) => (Array.isArray(value) ? String(value[0] ?? "") : typeof value === "string" ? value : "");

const escapeLike = (s) => s.replace(/[\\%_]/g, "\\$&");

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(queryString(value), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function pageParams(query, fallback = 24) {
  return { limit: clampInt(query.limit, 1, 100, fallback), offset: clampInt(query.offset, 0, 1e9, 0) };
}

function downloadName(title, ext) {
  const base = title
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${base || "video"}${ext}`;
}

export function createApp({ dataDir, maxUploadBytes = 0 }) {
  const dirs = {
    videos: path.join(dataDir, "videos"),
    thumbs: path.join(dataDir, "thumbs"),
    tmp: path.join(dataDir, "tmp"),
  };
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
  // Anything left in tmp is a partial upload from a previous run.
  for (const f of fs.readdirSync(dirs.tmp)) fs.rmSync(path.join(dirs.tmp, f), { force: true, recursive: true });

  const db = openDatabase(path.join(dataDir, "mantube.db"));

  const SELECT_VIDEO = `SELECT v.*, u.name AS channel_name FROM videos v JOIN users u ON u.id = v.user_id`;

  const sql = {
    userByToken: db.prepare(`SELECT * FROM users WHERE token_hash = ?`),
    userById: db.prepare(`SELECT * FROM users WHERE id = ?`),
    insertUser: db.prepare(`INSERT INTO users (id, token_hash, name, created_at) VALUES (?, ?, ?, ?)`),
    updateUser: db.prepare(`UPDATE users SET name = ?, about = ? WHERE id = ?`),

    videoById: db.prepare(`${SELECT_VIDEO} WHERE v.id = ?`),
    insertVideo: db.prepare(`
      INSERT INTO videos (id, user_id, title, description, category, file, original_name,
                          size, duration, width, height, thumb, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    updateVideo: db.prepare(`UPDATE videos SET title = ?, description = ?, category = ? WHERE id = ?`),
    deleteVideo: db.prepare(`DELETE FROM videos WHERE id = ?`),
    incrementViews: db.prepare(`UPDATE videos SET views = views + 1 WHERE id = ? RETURNING views`),
    viewsOf: db.prepare(`SELECT views FROM videos WHERE id = ?`),
    usedCategories: db.prepare(
      `SELECT category AS name, COUNT(*) AS count FROM videos GROUP BY category ORDER BY count DESC, name`
    ),
    related: db.prepare(`
      ${SELECT_VIDEO}
      WHERE v.id <> ?
      ORDER BY (CASE WHEN v.user_id = ? THEN 2 ELSE 0 END) + (CASE WHEN v.category = ? THEN 1 ELSE 0 END) DESC,
               v.created_at DESC
      LIMIT ?`),

    ratingCounts: db.prepare(`
      SELECT COALESCE(SUM(value = 1), 0) AS likes, COALESCE(SUM(value = -1), 0) AS dislikes
      FROM ratings WHERE video_id = ?`),
    myRating: db.prepare(`SELECT value FROM ratings WHERE user_id = ? AND video_id = ?`),
    setRating: db.prepare(`
      INSERT INTO ratings (user_id, video_id, value, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, video_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`),
    clearRating: db.prepare(`DELETE FROM ratings WHERE user_id = ? AND video_id = ?`),

    watchOf: db.prepare(`SELECT last_at FROM watches WHERE user_id = ? AND video_id = ?`),
    upsertWatch: db.prepare(`
      INSERT INTO watches (user_id, video_id, last_at) VALUES (?, ?, ?)
      ON CONFLICT (user_id, video_id) DO UPDATE SET last_at = excluded.last_at`),
    clearHistory: db.prepare(`DELETE FROM watches WHERE user_id = ?`),
    removeFromHistory: db.prepare(`DELETE FROM watches WHERE user_id = ? AND video_id = ?`),
    history: db.prepare(`
      SELECT v.*, u.name AS channel_name, w.last_at AS watched_at
      FROM watches w JOIN videos v ON v.id = w.video_id JOIN users u ON u.id = v.user_id
      WHERE w.user_id = ? ORDER BY w.last_at DESC LIMIT ? OFFSET ?`),
    liked: db.prepare(`
      SELECT v.*, u.name AS channel_name
      FROM ratings r JOIN videos v ON v.id = r.video_id JOIN users u ON u.id = v.user_id
      WHERE r.user_id = ? AND r.value = 1 ORDER BY r.created_at DESC LIMIT ? OFFSET ?`),
    subscriptionFeed: db.prepare(`
      ${SELECT_VIDEO}
      WHERE v.user_id IN (SELECT channel_id FROM subscriptions WHERE subscriber_id = ?)
      ORDER BY v.created_at DESC LIMIT ? OFFSET ?`),

    commentCount: db.prepare(`SELECT COUNT(*) AS n FROM comments WHERE video_id = ?`),
    comments: db.prepare(`
      SELECT c.*, u.name AS author_name FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.video_id = ? ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`),
    commentById: db.prepare(`
      SELECT c.*, u.name AS author_name, v.user_id AS video_owner
      FROM comments c JOIN users u ON u.id = c.user_id JOIN videos v ON v.id = c.video_id
      WHERE c.id = ?`),
    insertComment: db.prepare(`INSERT INTO comments (video_id, user_id, body, created_at) VALUES (?, ?, ?, ?)`),
    deleteComment: db.prepare(`DELETE FROM comments WHERE id = ?`),

    channelStats: db.prepare(`
      SELECT (SELECT COUNT(*) FROM subscriptions WHERE channel_id = $id) AS subscribers,
             (SELECT COUNT(*) FROM videos WHERE user_id = $id) AS videos,
             (SELECT COALESCE(SUM(views), 0) FROM videos WHERE user_id = $id) AS views`),
    subscriberCount: db.prepare(`SELECT COUNT(*) AS n FROM subscriptions WHERE channel_id = ?`),
    isSubscribed: db.prepare(`SELECT 1 FROM subscriptions WHERE subscriber_id = ? AND channel_id = ?`),
    subscribe: db.prepare(
      `INSERT OR IGNORE INTO subscriptions (subscriber_id, channel_id, created_at) VALUES (?, ?, ?)`
    ),
    unsubscribe: db.prepare(`DELETE FROM subscriptions WHERE subscriber_id = ? AND channel_id = ?`),
    mySubscriptions: db.prepare(`
      SELECT u.id, u.name FROM subscriptions s JOIN users u ON u.id = s.channel_id
      WHERE s.subscriber_id = ? AND u.name IS NOT NULL ORDER BY lower(u.name)`),
  };

  // ---------- JSON shapes ----------

  const meJson = (u) => ({ id: u.id, name: u.name, about: u.about, createdAt: u.created_at });

  const videoJson = (v) => ({
    id: v.id,
    title: v.title,
    description: v.description,
    category: v.category,
    duration: v.duration,
    width: v.width,
    height: v.height,
    size: v.size,
    views: v.views,
    createdAt: v.created_at,
    videoUrl: `/media/videos/${v.file}`,
    thumbnailUrl: v.thumb ? `/media/thumbs/${v.thumb}` : null,
    channel: { id: v.user_id, name: v.channel_name },
  });

  // List entries carry a short description only (enough for search snippets).
  const listItemJson = (v) => {
    const json = videoJson(v);
    if (json.description.length > 240) json.description = json.description.slice(0, 240) + "…";
    if (v.watched_at != null) json.watchedAt = v.watched_at;
    return json;
  };

  const listJson = (rows, limit) => ({
    videos: rows.slice(0, limit).map(listItemJson),
    hasMore: rows.length > limit,
  });

  const ratingJson = (videoId, user) => {
    const { likes, dislikes } = sql.ratingCounts.get(videoId);
    const mine = user ? sql.myRating.get(user.id, videoId) : null;
    return { likes, dislikes, myRating: mine?.value ?? 0 };
  };

  function videoDetail(id, user) {
    const v = sql.videoById.get(id);
    if (!v) return null;
    return {
      ...videoJson(v),
      ...ratingJson(id, user),
      commentCount: sql.commentCount.get(id).n,
      isOwner: user?.id === v.user_id,
      channel: {
        id: v.user_id,
        name: v.channel_name,
        subscribers: sql.subscriberCount.get(v.user_id).n,
        subscribed: Boolean(user && sql.isSubscribed.get(user.id, v.user_id)),
      },
    };
  }

  function channelJson(u, viewer) {
    const stats = sql.channelStats.get({ id: u.id });
    return {
      id: u.id,
      name: u.name,
      about: u.about,
      createdAt: u.created_at,
      subscribers: stats.subscribers,
      videoCount: stats.videos,
      totalViews: stats.views,
      subscribed: Boolean(viewer && sql.isSubscribed.get(viewer.id, u.id)),
      isMe: viewer?.id === u.id,
    };
  }

  const commentJson = (c, viewer, videoOwner) => ({
    id: c.id,
    body: c.body,
    createdAt: c.created_at,
    author: { id: c.user_id, name: c.author_name },
    canDelete: Boolean(viewer && (viewer.id === c.user_id || viewer.id === videoOwner)),
  });

  // ---------- validation ----------

  function validateChannelName(value) {
    const name = cleanLine(value);
    if (!name) throw new HttpError(400, "Channel name can't be empty.");
    if (name.length > LIMITS.name) throw new HttpError(400, `Channel name can be at most ${LIMITS.name} characters.`);
    return name;
  }

  function validateVideoText(input, { partial = false, fallbackTitle = "" } = {}) {
    const out = {};
    if (!partial || input.title !== undefined) {
      out.title = cleanLine(input.title) || cleanLine(fallbackTitle);
      if (!out.title) throw new HttpError(400, "Your video needs a title.");
      if (out.title.length > LIMITS.title) throw new HttpError(400, `Titles can be at most ${LIMITS.title} characters.`);
    }
    if (!partial || input.description !== undefined) {
      out.description = cleanText(input.description);
      if (out.description.length > LIMITS.description) {
        throw new HttpError(400, `Descriptions can be at most ${LIMITS.description} characters.`);
      }
    }
    if (!partial || input.category !== undefined) {
      out.category = cleanLine(input.category) || DEFAULT_CATEGORY;
      if (!CATEGORIES.includes(out.category)) throw new HttpError(400, "Unknown category.");
    }
    return out;
  }

  const positiveNumber = (value, max) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && n <= max ? n : null;
  };
  const positiveInt = (value) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n > 0 && n <= 100_000 ? n : null;
  };

  // ---------- app & middleware ----------

  const app = express();
  app.disable("x-powered-by");
  app.set("etag", "weak");

  app.use((req, res, next) => {
    res.set({
      "Content-Security-Policy": CONTENT_SECURITY_POLICY,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "SAMEORIGIN",
    });
    next();
  });

  const mediaOptions = { fallthrough: false, index: false, dotfiles: "deny", maxAge: "30d", immutable: true };
  app.use("/media/videos", express.static(dirs.videos, mediaOptions));
  app.use("/media/thumbs", express.static(dirs.thumbs, mediaOptions));
  app.use(express.static(PUBLIC_DIR, { index: false }));

  const api = express.Router();
  app.use("/api", api);

  api.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    const match = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.get("authorization") ?? "");
    req.user = match ? sql.userByToken.get(hashToken(match[1])) ?? null : null;
    next();
  });
  api.use(express.json({ limit: "100kb" }));

  const requireUser = (req, res, next) => {
    if (!req.user) throw new HttpError(401, "Your session has expired. Reload the page.", "NO_SESSION");
    next();
  };
  const requireChannel = (req, res, next) => {
    if (!req.user) throw new HttpError(401, "Your session has expired. Reload the page.", "NO_SESSION");
    if (!req.user.name) throw new HttpError(403, "Create a channel first.", "NO_CHANNEL");
    next();
  };

  function loadVideo(id) {
    const v = sql.videoById.get(id);
    if (!v) throw new HttpError(404, "This video isn't available anymore.", "NOT_FOUND");
    return v;
  }

  function loadOwnVideo(req) {
    const v = loadVideo(req.params.id);
    if (v.user_id !== req.user.id) throw new HttpError(403, "Only the uploader can change this video.");
    return v;
  }

  // ---------- config & session ----------

  api.get("/config", (req, res) => {
    res.json({ categories: CATEGORIES, defaultCategory: DEFAULT_CATEGORY, maxUploadBytes, limits: LIMITS });
  });

  api.post("/session", (req, res) => {
    const token = newToken();
    const id = newUserId();
    sql.insertUser.run(id, hashToken(token), null, Date.now());
    res.status(201).json({ token, user: meJson(sql.userById.get(id)) });
  });

  api.get("/me", requireUser, (req, res) => res.json(meJson(req.user)));

  api.patch("/me", requireUser, (req, res) => {
    const body = req.body ?? {};
    const name = body.name !== undefined ? validateChannelName(body.name) : req.user.name;
    if (!name) throw new HttpError(400, "Choose a channel name first.");
    const about = body.about !== undefined ? cleanText(body.about) : req.user.about;
    if (about.length > LIMITS.about) throw new HttpError(400, `Descriptions can be at most ${LIMITS.about} characters.`);
    sql.updateUser.run(name, about, req.user.id);
    res.json(meJson(sql.userById.get(req.user.id)));
  });

  api.get("/me/subscriptions", requireUser, (req, res) => {
    res.json(sql.mySubscriptions.all(req.user.id));
  });

  // ---------- videos ----------

  api.get("/categories", (req, res) => res.json(sql.usedCategories.all()));

  api.get("/videos", (req, res) => {
    const { limit, offset } = pageParams(req.query);
    const where = [];
    const params = [];
    const orderParams = [];

    const category = queryString(req.query.category);
    if (category) {
      where.push("v.category = ?");
      params.push(category);
    }
    const channel = queryString(req.query.channel);
    if (channel) {
      where.push("v.user_id = ?");
      params.push(channel);
    }

    const q = cleanLine(queryString(req.query.q)).slice(0, 200);
    const orders = {
      new: "v.created_at DESC",
      popular: "v.views DESC, v.created_at DESC",
      old: "v.created_at ASC",
    };
    let order = orders[queryString(req.query.sort)];
    if (q) {
      for (const term of q.split(" ").slice(0, 10)) {
        const like = `%${escapeLike(term)}%`;
        where.push(
          `(v.title LIKE ? ESCAPE '\\' OR v.description LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')`
        );
        params.push(like, like, like);
      }
      if (!order) {
        // Relevance: whole phrase in the title, then every term in the title, then popularity.
        const titleTerms = q.split(" ").slice(0, 10).map(() => `v.title LIKE ? ESCAPE '\\'`);
        order = `(v.title LIKE ? ESCAPE '\\') DESC, (${titleTerms.join(" AND ")}) DESC, v.views DESC, v.created_at DESC`;
        orderParams.push(`%${escapeLike(q)}%`, ...q.split(" ").slice(0, 10).map((t) => `%${escapeLike(t)}%`));
      }
    }
    order ??= orders.new;

    const rows = db
      .prepare(`${SELECT_VIDEO} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, ...orderParams, limit + 1, offset);
    res.json(listJson(rows, limit));
  });

  api.post("/videos", requireChannel, async (req, res) => {
    const upload = await parseVideoUpload(req, { tmpDir: dirs.tmp, maxBytes: maxUploadBytes });
    const id = newVideoId();
    let thumbPath = null;
    try {
      if (!upload.video) throw new HttpError(400, "No video file was attached.");
      const { size } = await fs.promises.stat(upload.video.tmpPath);
      if (size === 0) throw new HttpError(400, "That video file is empty.");
      if (!(await looksLikeVideo(upload.video.tmpPath))) {
        throw new HttpError(415, "That file doesn't look like a video. Upload a video such as MP4, WebM or MOV.");
      }

      const fallbackTitle = path.basename(upload.video.originalName, path.extname(upload.video.originalName));
      const text = validateVideoText(upload.fields, { fallbackTitle });

      let thumb = null;
      if (upload.thumbnail) {
        const ext = imageExtension(upload.thumbnail);
        if (!ext) throw new HttpError(415, "Thumbnails must be JPEG, PNG or WebP images.");
        thumb = id + ext;
        thumbPath = path.join(dirs.thumbs, thumb);
        await fs.promises.writeFile(thumbPath, upload.thumbnail);
      }

      const file = id + upload.video.ext;
      await fs.promises.rename(upload.video.tmpPath, path.join(dirs.videos, file));
      try {
        sql.insertVideo.run(
          id,
          req.user.id,
          text.title,
          text.description,
          text.category,
          file,
          upload.video.originalName.slice(0, 255),
          size,
          positiveNumber(upload.fields.duration, 1e7),
          positiveInt(upload.fields.width),
          positiveInt(upload.fields.height),
          thumb,
          Date.now()
        );
      } catch (err) {
        await fs.promises.rm(path.join(dirs.videos, file), { force: true });
        throw err;
      }
    } catch (err) {
      await upload.cleanup();
      if (thumbPath) await fs.promises.rm(thumbPath, { force: true });
      throw err;
    }
    res.status(201).json(videoDetail(id, req.user));
  });

  api.get("/videos/:id", (req, res) => {
    const video = videoDetail(req.params.id, req.user);
    if (!video) throw new HttpError(404, "This video isn't available anymore.", "NOT_FOUND");
    res.json(video);
  });

  api.patch("/videos/:id", requireUser, (req, res) => {
    const v = loadOwnVideo(req);
    const text = validateVideoText(req.body ?? {}, { partial: true });
    sql.updateVideo.run(
      text.title ?? v.title,
      text.description ?? v.description,
      text.category ?? v.category,
      v.id
    );
    res.json(videoDetail(v.id, req.user));
  });

  api.delete("/videos/:id", requireUser, async (req, res) => {
    const v = loadOwnVideo(req);
    sql.deleteVideo.run(v.id);
    await fs.promises.rm(path.join(dirs.videos, v.file), { force: true });
    if (v.thumb) await fs.promises.rm(path.join(dirs.thumbs, v.thumb), { force: true });
    res.status(204).end();
  });

  api.get("/videos/:id/related", (req, res) => {
    const v = loadVideo(req.params.id);
    const limit = clampInt(req.query.limit, 1, 50, 20);
    res.json({ videos: sql.related.all(v.id, v.user_id, v.category, limit).map(listItemJson) });
  });

  api.get("/videos/:id/download", (req, res, next) => {
    const v = loadVideo(req.params.id);
    res.download(path.join(dirs.videos, v.file), downloadName(v.title, path.extname(v.file)), (err) => {
      if (err && !res.headersSent) next(err);
    });
  });

  api.post("/videos/:id/view", requireUser, (req, res) => {
    const v = loadVideo(req.params.id);
    const now = Date.now();
    const views = transaction(db, () => {
      const watch = sql.watchOf.get(req.user.id, v.id);
      sql.upsertWatch.run(req.user.id, v.id, now);
      if (!watch || now - watch.last_at >= VIEW_COOLDOWN_MS) return sql.incrementViews.get(v.id).views;
      return sql.viewsOf.get(v.id).views;
    });
    res.json({ views });
  });

  api.put("/videos/:id/rating", requireUser, (req, res) => {
    const v = loadVideo(req.params.id);
    const value = req.body?.value;
    if (value !== 1 && value !== -1 && value !== 0) throw new HttpError(400, "Rating must be 1, -1 or 0.");
    if (value === 0) sql.clearRating.run(req.user.id, v.id);
    else sql.setRating.run(req.user.id, v.id, value, Date.now());
    res.json(ratingJson(v.id, req.user));
  });

  // ---------- comments ----------

  api.get("/videos/:id/comments", (req, res) => {
    const v = loadVideo(req.params.id);
    const { limit, offset } = pageParams(req.query, 20);
    const rows = sql.comments.all(v.id, limit + 1, offset);
    res.json({
      comments: rows.slice(0, limit).map((c) => commentJson(c, req.user, v.user_id)),
      total: sql.commentCount.get(v.id).n,
      hasMore: rows.length > limit,
    });
  });

  api.post("/videos/:id/comments", requireChannel, (req, res) => {
    const v = loadVideo(req.params.id);
    const body = cleanText(req.body?.body);
    if (!body) throw new HttpError(400, "Write something first.");
    if (body.length > LIMITS.comment) throw new HttpError(400, `Comments can be at most ${LIMITS.comment} characters.`);
    const { lastInsertRowid } = sql.insertComment.run(v.id, req.user.id, body, Date.now());
    res.status(201).json(commentJson(sql.commentById.get(lastInsertRowid), req.user, v.user_id));
  });

  api.delete("/comments/:id", requireUser, (req, res) => {
    const c = sql.commentById.get(clampInt(req.params.id, 0, Number.MAX_SAFE_INTEGER, 0));
    if (!c) throw new HttpError(404, "That comment was already deleted.");
    if (c.user_id !== req.user.id && c.video_owner !== req.user.id) {
      throw new HttpError(403, "You can only delete your own comments.");
    }
    sql.deleteComment.run(c.id);
    res.status(204).end();
  });

  // ---------- channels & subscriptions ----------

  function loadChannel(id) {
    const u = sql.userById.get(id);
    if (!u || !u.name) throw new HttpError(404, "This channel doesn't exist.", "NOT_FOUND");
    return u;
  }

  api.get("/channels/:id", (req, res) => res.json(channelJson(loadChannel(req.params.id), req.user)));

  api.put("/channels/:id/subscription", requireUser, (req, res) => {
    const u = loadChannel(req.params.id);
    if (u.id === req.user.id) throw new HttpError(400, "You can't subscribe to your own channel.");
    sql.subscribe.run(req.user.id, u.id, Date.now());
    res.json({ subscribed: true, subscribers: sql.subscriberCount.get(u.id).n });
  });

  api.delete("/channels/:id/subscription", requireUser, (req, res) => {
    const u = loadChannel(req.params.id);
    sql.unsubscribe.run(req.user.id, u.id);
    res.json({ subscribed: false, subscribers: sql.subscriberCount.get(u.id).n });
  });

  // ---------- personal feeds ----------

  api.get("/feed/subscriptions", requireUser, (req, res) => {
    const { limit, offset } = pageParams(req.query);
    res.json(listJson(sql.subscriptionFeed.all(req.user.id, limit + 1, offset), limit));
  });

  api.get("/feed/liked", requireUser, (req, res) => {
    const { limit, offset } = pageParams(req.query);
    res.json(listJson(sql.liked.all(req.user.id, limit + 1, offset), limit));
  });

  api.get("/feed/history", requireUser, (req, res) => {
    const { limit, offset } = pageParams(req.query);
    res.json(listJson(sql.history.all(req.user.id, limit + 1, offset), limit));
  });

  api.delete("/feed/history", requireUser, (req, res) => {
    sql.clearHistory.run(req.user.id);
    res.status(204).end();
  });

  api.delete("/feed/history/:id", requireUser, (req, res) => {
    sql.removeFromHistory.run(req.user.id, req.params.id);
    res.status(204).end();
  });

  api.use((req, res) => {
    throw new HttpError(404, "Not found.");
  });

  // ---------- pages ----------

  // Every other extension-less GET is a client-side route of the single-page app.
  app.use((req, res, next) => {
    if ((req.method === "GET" || req.method === "HEAD") && !path.extname(req.path)) {
      res.set("Cache-Control", "no-cache");
      return res.sendFile(path.join(PUBLIC_DIR, "index.html"));
    }
    next();
  });

  app.use((req, res) => {
    res.status(404).type("text").send("Not found");
  });

  app.use((err, req, res, _next) => {
    const status = err instanceof HttpError ? err.status : err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    let message;
    if (err instanceof HttpError) message = err.message;
    else if (status === 404) message = "Not found.";
    else if (err.type === "entity.parse.failed") message = "The request body isn't valid JSON.";
    else if (err.type === "entity.too.large") message = "The request body is too large.";
    else if (status < 500 && err.expose) message = err.message;
    else message = status < 500 ? "Bad request." : "Something went wrong on the server.";
    res.status(status).json({ error: message, code: err instanceof HttpError ? err.code : undefined });
  });

  return { app, db, dirs };
}

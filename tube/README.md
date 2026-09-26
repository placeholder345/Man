# ManTube

A self-hosted video site in the spirit of YouTube. Upload videos, watch them in a
full-featured player, and share them with anyone who can reach your computer, such as
people on the same Wi-Fi.

Videos are stored **exactly as uploaded**: no compression and no re-encoding, so they
keep full original quality. There's **no file size limit** by default.

## Run it

Needs **Node.js 22.13 or newer**. It uses Node's built-in SQLite, so there's nothing
native to compile.

```bash
cd tube
npm install
npm start
```

Open http://localhost:4000. The terminal also prints a network address, like
`http://192.168.1.20:4000`, that phones and other computers on your network can open.

## What you can do

**Upload**
- Drag and drop a video, or pick a file. MP4, WebM, MOV, MKV, AVI and more are accepted.
- Thumbnails are generated automatically from three moments in your video. Pick
  one, or upload your own image. Near-black frames are skipped, and vertical videos
  get a blurred backdrop instead of being cropped.
- Add a title, description and category while the upload runs, with live progress,
  speed and time remaining. You can cancel and retry.
- Keep browsing during an upload. A progress pill in the header tracks it.

**Watch**
- Custom player with seek bar (hover time preview, buffered range), volume, playback speed,
  loop, theater mode, full screen, picture-in-picture and autoplay-next with a countdown.
- Resumes where you left off. Red bars on thumbnails show how much you've watched.
- `?t=1m30s` links start at a moment. Timestamps like `1:23` in descriptions and
  comments are clickable.
- YouTube-style keyboard shortcuts. Press `?` to see them all.
- Streaming uses HTTP range requests, so seeking is instant even in huge files.
- Download the original file with one click.

**Everything around it**
- Channels with subscriber counts, subscribe and unsubscribe, and a Subscriptions feed.
- Likes and dislikes, a Liked videos list, view counts, and watch history.
- Comments, which the video owner can moderate.
- Search with relevance, date or view-count sorting, plus category filters on the home page.
- Hover previews on thumbnails, light and dark themes, and layouts for phone and desktop.
- Uploaders can edit a video's details or delete it.

## Accounts, without passwords

Each browser gets a private **sign-in key** automatically. Pick a channel name when you
first upload or comment. To use the same channel on another device, open the account
menu, choose **Use this channel on another device**, and copy the key across. Anyone
with the key can manage that channel, so keep it private.

## Configuration

Copy `.env.example` to `.env` to change these:

| Variable        | Purpose                                          | Default  |
| --------------- | ------------------------------------------------ | -------- |
| `PORT`          | Port the server listens on                       | `4000`   |
| `DATA_DIR`      | Where videos, thumbnails and the database live   | `./data` |
| `MAX_UPLOAD_MB` | Largest upload in megabytes (`0` = no limit)     | `0`      |

## Formats

Files are served as-is, so what plays depends on the viewer's browser. **MP4 (H.264/AAC)**
and **WebM (VP8/VP9/AV1)** play everywhere. MOV usually works. MKV and AVI often don't.
In that case the player explains why and offers a download. The upload page warns you
before you publish a file your own browser can't play.

## How it's built

- `server.js`: starts the server and prints local and network addresses. Long uploads are
  never timed out.
- `src/app.js`: Express routes for the JSON API, media streaming and the page.
- `src/upload.js`: streams multipart uploads straight to disk (memory stays flat even for
  multi-gigabyte files), checks file signatures, and cleans up cancelled uploads.
- `src/db.js`: SQLite schema (users, videos, ratings, comments, subscriptions, watches).
- `public/`: the frontend. Plain HTML, CSS and ES modules, with no build step or framework.
  Thumbnails and video length are read in the browser, so the server doesn't need ffmpeg.

## Tests

```bash
npm test
```

Runs the API test suite: uploads, validation, size limits, cancelled uploads, streaming,
permissions, likes, comments, subscriptions, feeds and search.

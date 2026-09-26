// Client-side video analysis: duration, dimensions and thumbnail frames are
// read straight from the chosen file, so the server never needs ffmpeg.

const WIDTH = 1280;
const HEIGHT = 720;
const JPEG_QUALITY = 0.92;

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Loads a local video file. Resolves to { video, playable } where `playable`
 * means the browser can decode its picture (and so can make thumbnails).
 */
export function probeVideo(url) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ video, playable: !video.error && video.readyState >= 2 && video.videoWidth > 0 });
    };
    const timer = setTimeout(finish, 20000);
    video.addEventListener("loadeddata", finish, { once: true });
    video.addEventListener("error", finish, { once: true });
    video.src = url;
  });
}

/** Real duration in seconds, or null. Handles recorder-made WebM files that report Infinity. */
export function resolveDuration(video) {
  if (Number.isFinite(video.duration) && video.duration > 0) return Promise.resolve(video.duration);
  return new Promise((resolve) => {
    const done = (value) => {
      video.removeEventListener("durationchange", check);
      clearTimeout(timer);
      resolve(value);
    };
    const check = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) done(video.duration);
    };
    const timer = setTimeout(() => done(null), 10000);
    video.addEventListener("durationchange", check);
    // Seeking far past the end makes the browser scan to the end and learn the duration.
    video.currentTime = 1e101;
  });
}

function seek(video, time) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      video.removeEventListener("seeked", onSeeked);
      reject(new Error("Seeking timed out"));
    }, 10000);
    video.addEventListener("seeked", onSeeked, { once: true });
    video.currentTime = time;
  });
}

/**
 * Draws `source` into a 1280×720 canvas. Sources that aren't 16:9 (vertical
 * phone videos, square images) are shown whole over a blurred copy of
 * themselves instead of being cropped.
 */
export function drawThumbnail(source, sw, sh) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  if (Math.abs(sw / sh - WIDTH / HEIGHT) < 0.03) {
    ctx.drawImage(source, 0, 0, WIDTH, HEIGHT);
    return canvas;
  }

  const cover = Math.max(WIDTH / sw, HEIGHT / sh) * 1.15;
  const cw = sw * cover;
  const ch = sh * cover;
  if ("filter" in ctx) {
    ctx.filter = "blur(40px) brightness(0.55) saturate(1.15)";
    ctx.drawImage(source, (WIDTH - cw) / 2, (HEIGHT - ch) / 2, cw, ch);
    ctx.filter = "none";
  } else {
    ctx.drawImage(source, (WIDTH - cw) / 2, (HEIGHT - ch) / 2, cw, ch);
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  const fit = Math.min(WIDTH / sw, HEIGHT / sh);
  const fw = sw * fit;
  const fh = sh * fit;
  ctx.drawImage(source, (WIDTH - fw) / 2, (HEIGHT - fh) / 2, fw, fh);
  return canvas;
}

/** Average brightness 0–1, used to skip black frames (fade-ins, cuts). */
function brightness(canvas) {
  const small = document.createElement("canvas");
  small.width = 32;
  small.height = 18;
  const ctx = small.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, 32, 18);
  const { data } = ctx.getImageData(0, 0, 32, 18);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  return sum / (data.length / 4) / 255;
}

const toBlob = (canvas) =>
  new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't encode the thumbnail"))), "image/jpeg", JPEG_QUALITY)
  );

/**
 * Captures `count` candidate thumbnails spread through the video, nudging
 * away from near-black frames. Resolves to [{ blob, url, time }].
 */
export async function captureFrames(video, duration, count = 3) {
  // Some browsers (iOS Safari) only paint frames after playback has started once.
  try {
    await video.play();
    video.pause();
  } catch {
    /* fine: muted play may be blocked, frames usually still decode */
  }

  const anchors = Array.from({ length: count }, (_, i) => (i + 1) / (count + 1));
  const frames = [];
  for (const anchor of anchors) {
    let best = null;
    for (const nudge of [0, 0.07, -0.07, 0.14]) {
      const time = duration
        ? clamp((anchor + nudge) * duration, 0, Math.max(0, duration - 0.1))
        : clamp(anchor * 8 + nudge * 8, 0, 60);
      try {
        await seek(video, time);
        await delay(60);
      } catch {
        continue;
      }
      if (!video.videoWidth) break;
      const canvas = drawThumbnail(video, video.videoWidth, video.videoHeight);
      const light = brightness(canvas);
      if (!best || light > best.light) best = { canvas, light, time };
      if (light > 0.09) break;
    }
    if (best) {
      const blob = await toBlob(best.canvas);
      frames.push({ blob, url: URL.createObjectURL(blob), time: best.time });
    }
  }
  return frames;
}

/** Turns any image the browser can decode into a 1280×720 JPEG thumbnail. */
export async function imageToThumbnail(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Couldn't read that image. Use a JPEG, PNG or WebP file.");
  }
  const canvas = drawThumbnail(bitmap, bitmap.width, bitmap.height);
  bitmap.close?.();
  const blob = await toBlob(canvas);
  return { blob, url: URL.createObjectURL(blob) };
}

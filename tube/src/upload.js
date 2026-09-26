import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import busboy from "busboy";

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".m4v", ".mov", ".webm", ".mkv", ".ogv", ".ogg",
  ".avi", ".wmv", ".flv", ".3gp", ".3g2", ".mpg", ".mpeg", ".ts", ".mts", ".m2ts",
]);

const EXTENSION_BY_MIME = {
  "video/mp4": ".mp4",
  "video/x-m4v": ".m4v",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-matroska": ".mkv",
  "video/ogg": ".ogv",
  "video/x-msvideo": ".avi",
  "video/x-ms-wmv": ".wmv",
  "video/x-flv": ".flv",
  "video/3gpp": ".3gp",
  "video/3gpp2": ".3g2",
  "video/mpeg": ".mpg",
  "video/mp2t": ".ts",
};

export function videoExtension(filename, mimeType) {
  const ext = path.extname(filename || "").toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) return ext;
  return EXTENSION_BY_MIME[(mimeType || "").toLowerCase()] ?? null;
}

/**
 * Checks the first bytes of a file against the signatures of common video
 * containers, so a renamed text file or image can't be published as a video.
 */
export async function looksLikeVideo(file) {
  const handle = await fs.promises.open(file, "r");
  try {
    const buf = Buffer.alloc(512);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    const b = buf.subarray(0, bytesRead);
    const ascii = (start, end) => b.subarray(start, end).toString("latin1");

    if (b.length < 12) return false;
    // ISO BMFF: MP4, MOV, M4V, 3GP (box type at offset 4)
    if (["ftyp", "moov", "mdat", "free", "wide", "skip", "pnot"].includes(ascii(4, 8))) return true;
    // EBML: WebM, Matroska
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return true;
    // Ogg
    if (ascii(0, 4) === "OggS") return true;
    // RIFF AVI
    if (ascii(0, 4) === "RIFF" && ascii(8, 12).startsWith("AVI")) return true;
    // ASF / WMV
    if (b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xb2 && b[3] === 0x75) return true;
    // FLV
    if (ascii(0, 3) === "FLV") return true;
    // MPEG program stream / elementary stream
    if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && (b[3] === 0xba || b[3] === 0xb3)) return true;
    // MPEG transport stream: sync byte every 188 bytes (or 192 for M2TS)
    if (b[0] === 0x47 && b.length > 188 && b[188] === 0x47) return true;
    if (b.length > 196 && b[4] === 0x47 && b[196] === 0x47) return true;
    return false;
  } finally {
    await handle.close();
  }
}

/** Returns the file extension for a JPEG/PNG/WebP buffer, or null for anything else. */
export function imageExtension(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return ".webp";
  return null;
}

export function formatBytes(bytes) {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${i === 0 ? bytes : bytes.toFixed(bytes < 10 ? 1 : 0)} ${units[i]}`;
}

const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024;

/**
 * Streams a multipart upload containing a `video` file (written straight to
 * disk, so size is only bounded by `maxBytes`) and an optional `thumbnail`
 * image (buffered in memory). Partial files are always removed on failure or
 * when the client disconnects.
 *
 * Resolves to { fields, video, thumbnail, cleanup }.
 */
export function parseVideoUpload(req, { tmpDir, maxBytes }) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = busboy({
        headers: req.headers,
        limits: {
          files: 2,
          fields: 20,
          parts: 30,
          fieldSize: 64 * 1024,
          fileSize: maxBytes > 0 ? maxBytes : Infinity,
        },
      });
    } catch {
      reject(new HttpError(400, "Expected a multipart/form-data upload."));
      return;
    }

    const fields = Object.create(null);
    const tmpFiles = [];
    const fileStreams = new Set();
    const writes = [];
    let video = null;
    let thumbChunks = null;
    let thumbBytes = 0;
    let error = null;
    let settled = false;

    const cleanup = () => Promise.all(tmpFiles.map((f) => fs.promises.rm(f, { force: true })));
    const fail = (err) => {
      error ??= err;
    };

    const finish = async () => {
      if (settled) return;
      settled = true;
      await Promise.allSettled(writes);
      if (error) {
        await cleanup();
        reject(error);
      } else {
        const thumbnail = thumbChunks?.length ? Buffer.concat(thumbChunks) : null;
        resolve({ fields, video, thumbnail, cleanup });
      }
    };

    bb.on("field", (name, value, info) => {
      if (info.valueTruncated) fail(new HttpError(413, `The "${name}" field is too long.`));
      fields[name] = value;
    });

    bb.on("file", (name, stream, info) => {
      fileStreams.add(stream);
      stream.on("close", () => fileStreams.delete(stream));

      if (name === "video" && !video) {
        const ext = videoExtension(info.filename, info.mimeType);
        if (!ext) {
          fail(new HttpError(415, "That file type isn't supported. Upload a video such as MP4, WebM or MOV."));
          stream.resume();
          return;
        }
        const tmpPath = path.join(tmpDir, `${crypto.randomBytes(12).toString("hex")}${ext}`);
        tmpFiles.push(tmpPath);
        video = { tmpPath, ext, originalName: info.filename || "" };
        stream.on("limit", () =>
          fail(new HttpError(413, `That video is larger than the ${formatBytes(maxBytes)} upload limit.`))
        );
        writes.push(pipeline(stream, fs.createWriteStream(tmpPath)).catch(fail));
      } else if (name === "thumbnail" && !thumbChunks) {
        thumbChunks = [];
        stream.on("data", (chunk) => {
          thumbBytes += chunk.length;
          if (thumbBytes > MAX_THUMBNAIL_BYTES) {
            fail(new HttpError(413, "The thumbnail image is larger than 10 MB."));
            thumbChunks.length = 0;
          } else {
            thumbChunks.push(chunk);
          }
        });
      } else {
        stream.resume();
      }
    });

    bb.on("filesLimit", () => fail(new HttpError(400, "Too many files in one upload.")));
    bb.on("close", finish);
    bb.on("error", () => {
      fail(new HttpError(400, "The upload was interrupted or malformed."));
      finish();
    });

    // A cancelled upload never lets busboy finish, so tear everything down here.
    req.on("close", () => {
      if (req.complete || settled) return;
      fail(new HttpError(499, "Upload cancelled."));
      for (const s of fileStreams) s.destroy();
      bb.destroy();
      finish();
    });

    req.pipe(bb);
  });
}

import { session } from "./api.js";

/**
 * Owns the in-flight upload so it keeps going while the viewer browses other
 * pages. Emits "change" whenever state or progress changes.
 *
 * state: "idle" | "uploading" | "done" | "error"
 */
class Uploader extends EventTarget {
  state = "idle";
  /** Unsent upload form (file, fields, thumbnails), kept while the viewer browses. */
  draft = null;
  title = "";
  progress = { loaded: 0, total: 0, speed: 0, processing: false };
  result = null;
  error = null;
  #xhr = null;
  #request = null;

  #emit() {
    this.dispatchEvent(new Event("change"));
  }

  get busy() {
    return this.state === "uploading";
  }

  start({ file, fields, thumbnail }) {
    if (this.busy) return;
    this.#request = { file, fields, thumbnail };

    const form = new FormData();
    // Text fields go first so the server has them before the (large) video bytes.
    for (const [key, value] of Object.entries(fields)) if (value != null) form.append(key, String(value));
    if (thumbnail) form.append("thumbnail", thumbnail, "thumbnail.jpg");
    form.append("video", file, file.name);

    const xhr = new XMLHttpRequest();
    this.#xhr = xhr;
    this.state = "uploading";
    this.title = fields.title;
    this.error = null;
    this.result = null;
    this.progress = { loaded: 0, total: file.size, speed: 0, processing: false };

    const samples = [];
    xhr.upload.addEventListener("progress", (e) => {
      const now = performance.now();
      samples.push([now, e.loaded]);
      while (samples.length > 2 && now - samples[0][0] > 5000) samples.shift();
      const [t0, b0] = samples[0];
      const speed = now - t0 > 500 ? ((e.loaded - b0) / (now - t0)) * 1000 : this.progress.speed;
      const total = e.lengthComputable ? e.total : file.size;
      this.progress = { loaded: Math.min(e.loaded, total), total, speed, processing: e.loaded >= total };
      this.#emit();
    });
    xhr.upload.addEventListener("load", () => {
      this.progress = { ...this.progress, loaded: this.progress.total, processing: true };
      this.#emit();
    });
    xhr.addEventListener("load", () => {
      if (this.#xhr !== xhr) return;
      this.#xhr = null;
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error page */
      }
      if (xhr.status === 201 && data?.id) {
        this.state = "done";
        this.result = data;
        this.draft?.dispose?.();
        this.draft = null;
      } else {
        this.state = "error";
        this.error = data?.error || `The upload failed (HTTP ${xhr.status}).`;
      }
      this.#emit();
    });
    xhr.addEventListener("error", () => {
      if (this.#xhr !== xhr) return;
      this.#xhr = null;
      this.state = "error";
      this.error = "The connection to the server was lost during the upload.";
      this.#emit();
    });
    xhr.addEventListener("abort", () => {
      if (this.#xhr !== xhr) return;
      this.#xhr = null;
      this.state = "idle";
      this.#emit();
    });

    xhr.open("POST", "/api/videos");
    if (session.token) xhr.setRequestHeader("Authorization", `Bearer ${session.token}`);
    xhr.send(form);
    this.#emit();
  }

  /** Retries the last failed upload with the same file and details. */
  retry() {
    if (this.state === "error" && this.#request) {
      this.state = "idle";
      this.start(this.#request);
    }
  }

  cancel() {
    this.#xhr?.abort();
  }

  reset() {
    this.cancel();
    this.state = "idle";
    this.result = null;
    this.error = null;
    this.#request = null;
    this.#emit();
  }
}

export const uploader = new Uploader();

window.addEventListener("beforeunload", (e) => {
  if (uploader.busy || uploader.draft) {
    e.preventDefault();
    e.returnValue = "";
  }
});

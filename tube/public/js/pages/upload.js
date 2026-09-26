import { h, autogrow } from "../dom.js";
import { icon } from "../icons.js";
import { session } from "../api.js";
import { uploader } from "../uploader.js";
import { probeVideo, resolveDuration, captureFrames, imageToThumbnail } from "../thumbs.js";
import { formatBytes, formatTime, formatDurationWords } from "../format.js";
import { ensureChannel, field, formError, toast, confirmDialog, copyText, watchUrl, thumbFallback } from "../components.js";

const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|ogv|ogg|avi|wmv|flv|3gp|3g2|mpe?g|ts|mts|m2ts)$/i;
const ACCEPT = "video/*,.mkv,.mov,.m4v,.avi,.wmv,.flv,.3gp,.3g2,.mpg,.mpeg,.ts,.mts,.m2ts,.ogv";

const isVideoFile = (file) => file.type.startsWith("video/") || VIDEO_EXTENSIONS.test(file.name);
const titleFromFilename = (name) =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

// ---------- draft ----------

function createDraft(file) {
  const draft = {
    file,
    url: URL.createObjectURL(file),
    title: titleFromFilename(file.name),
    description: "",
    category: session.config.defaultCategory,
    duration: null,
    width: null,
    height: null,
    playable: null,
    analyzing: true,
    frames: [],
    custom: null,
    selected: 0, // index into frames, or "custom"
    listeners: new Set(),
    notify() {
      for (const fn of this.listeners) fn();
    },
    dispose() {
      URL.revokeObjectURL(this.url);
      for (const f of this.frames) URL.revokeObjectURL(f.url);
      if (this.custom) URL.revokeObjectURL(this.custom.url);
      this.listeners.clear();
    },
  };
  draft.analysis = analyze(draft);
  return draft;
}

async function analyze(draft) {
  const { video, playable } = await probeVideo(draft.url);
  try {
    draft.playable = playable;
    if (playable) {
      draft.width = video.videoWidth;
      draft.height = video.videoHeight;
      draft.duration = await resolveDuration(video);
      draft.notify();
      draft.frames = await captureFrames(video, draft.duration);
    } else if (Number.isFinite(video.duration) && video.duration > 0) {
      draft.duration = video.duration;
    }
  } catch (err) {
    console.warn("Couldn't analyze video", err);
  } finally {
    video.removeAttribute("src");
    video.load();
    draft.analyzing = false;
    draft.notify();
  }
}

function discardDraft() {
  uploader.draft?.dispose();
  uploader.draft = null;
}

// ---------- page ----------

export async function uploadPage(ctx) {
  ctx.setTitle("Upload video");
  const root = h("div", { class: "page-upload" });
  let shown = null;
  let progressView = null;

  const render = () => {
    shown = `${uploader.state}:${Boolean(uploader.draft)}`;
    progressView = null;
    if (uploader.state === "uploading") {
      progressView = renderProgress();
      root.replaceChildren(progressView.el);
    } else if (uploader.state === "done") {
      root.replaceChildren(renderDone(uploader.result));
    } else if (uploader.state === "error") {
      root.replaceChildren(renderError());
    } else if (uploader.draft) {
      root.replaceChildren(renderDetails(uploader.draft, render, ctx));
    } else {
      root.replaceChildren(renderPicker(render, ctx));
    }
  };

  const onChange = () => {
    if (`${uploader.state}:${Boolean(uploader.draft)}` !== shown) render();
    else progressView?.update();
  };
  uploader.addEventListener("change", onChange);

  // Dropping a file anywhere on this page shouldn't make the browser navigate to it.
  const blockDrop = (e) => {
    if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
  };
  window.addEventListener("dragover", blockDrop);
  window.addEventListener("drop", blockDrop);

  ctx.onCleanup(() => {
    uploader.removeEventListener("change", onChange);
    window.removeEventListener("dragover", blockDrop);
    window.removeEventListener("drop", blockDrop);
    if (uploader.state === "done") uploader.reset();
  });

  render();
  return root;
}

// ---------- step 1: pick a file ----------

function renderPicker(rerender) {
  const input = h("input", { type: "file", accept: ACCEPT, class: "visually-hidden", tabIndex: -1 });
  const max = session.config.maxUploadBytes;

  async function choose(file) {
    if (!file) return;
    if (!isVideoFile(file)) {
      toast(`“${file.name}” isn't a video file.`);
      return;
    }
    if (max && file.size > max) {
      toast(`That file is ${formatBytes(file.size)}. The limit on this server is ${formatBytes(max)}.`);
      return;
    }
    if (!(await ensureChannel("Your videos live on your channel. Pick a name for it to start uploading."))) return;
    uploader.draft = createDraft(file);
    rerender();
  }

  input.addEventListener("change", () => choose(input.files[0]));

  let depth = 0;
  const zone = h(
    "div",
    {
      class: "dropzone",
      ondragenter: (e) => {
        e.preventDefault();
        depth++;
        zone.classList.add("is-over");
      },
      ondragover: (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      },
      ondragleave: () => {
        depth = Math.max(0, depth - 1);
        if (!depth) zone.classList.remove("is-over");
      },
      ondrop: (e) => {
        e.preventDefault();
        depth = 0;
        zone.classList.remove("is-over");
        choose(e.dataTransfer.files[0]);
      },
    },
    h("div", { class: "dz-icon" }, icon("upload")),
    h("h1", { class: "dz-title" }, "Drag and drop a video to upload"),
    h("p", { class: "dz-text" }, "Your video stays exactly as you made it: full resolution, full quality, nothing re-encoded."),
    h("button", { class: "btn btn-primary btn-lg", type: "button", onclick: () => input.click() }, "Select file"),
    input
  );

  return h(
    "section",
    { class: "upload-pick" },
    zone,
    h(
      "p",
      { class: "upload-fineprint" },
      max ? `Files up to ${formatBytes(max)}.` : "No file size limit.",
      " MP4 (H.264) and WebM play in every browser. Other formats (MOV, MKV, AVI…) upload fine, but some browsers can't play them."
    )
  );
}

// ---------- step 2: details ----------

function renderDetails(draft, rerender) {
  const limits = session.config.limits;
  const error = formError();

  const titleInput = h("textarea", {
    class: "input input-title",
    rows: 1,
    maxLength: limits.title,
    required: true,
    placeholder: "Add a title that describes your video",
  });
  titleInput.value = draft.title;
  titleInput.addEventListener("input", () => {
    titleInput.value = titleInput.value.replace(/\n/g, " ");
    draft.title = titleInput.value;
  });
  titleInput.addEventListener("keydown", (e) => e.key === "Enter" && e.preventDefault());

  const descInput = h("textarea", {
    class: "input",
    rows: 5,
    maxLength: limits.description,
    placeholder: "Tell viewers about your video. Type a time like 1:23 and it becomes a link to that moment.",
  });
  descInput.value = draft.description;
  descInput.addEventListener("input", () => (draft.description = descInput.value));

  const categorySelect = h(
    "select",
    { class: "input", onchange: () => (draft.category = categorySelect.value) },
    session.config.categories.map((c) => h("option", { value: c, selected: c === draft.category }, c))
  );

  // Thumbnail picker
  const picker = h("div", { class: "thumb-picker", role: "radiogroup", "aria-label": "Thumbnail" });
  const imageInput = h("input", { type: "file", accept: "image/*", class: "visually-hidden", tabIndex: -1 });
  imageInput.addEventListener("change", async () => {
    const file = imageInput.files[0];
    imageInput.value = "";
    if (!file) return;
    try {
      const thumb = await imageToThumbnail(file);
      if (draft.custom) URL.revokeObjectURL(draft.custom.url);
      draft.custom = thumb;
      draft.selected = "custom";
      renderThumbs();
    } catch (err) {
      toast(err.message);
    }
  });

  const option = (key, url, label) =>
    h(
      "button",
      {
        class: `thumb-option${draft.selected === key ? " is-selected" : ""}`,
        type: "button",
        role: "radio",
        "aria-checked": String(draft.selected === key),
        "aria-label": label,
        onclick: () => {
          draft.selected = key;
          renderThumbs();
        },
      },
      h("img", { src: url, alt: "" }),
      h("span", { class: "thumb-option-check" }, icon("check"))
    );

  function renderThumbs() {
    const tiles = [
      h(
        "button",
        { class: "thumb-option thumb-upload", type: "button", onclick: () => imageInput.click() },
        icon("image"),
        h("span", {}, draft.custom ? "Change image" : "Upload image")
      ),
    ];
    if (draft.custom) tiles.push(option("custom", draft.custom.url, "Your image"));
    draft.frames.forEach((f, i) => tiles.push(option(i, f.url, `Frame at ${formatTime(f.time)}`)));
    if (draft.analyzing) {
      for (let i = draft.frames.length; i < 3; i++) tiles.push(h("div", { class: "thumb-option is-loading", "aria-hidden": "true" }));
    } else if (!draft.frames.length && !draft.custom) {
      tiles.push(h("p", { class: "thumb-picker-note" }, "We couldn't grab frames from this file. Upload an image, or leave it and a placeholder is used."));
    }
    picker.replaceChildren(...tiles, imageInput);
  }

  // Preview column
  const previewBox = h("div", { class: "ud-video" });
  const facts = h("dl", { class: "ud-facts" });
  function renderPreview() {
    if (draft.playable === false) {
      previewBox.replaceChildren(
        h("div", { class: "ud-noplay" }, icon("alert"), h("p", {}, "This browser can't play this file, so there's no preview. It will still upload with its full quality, but viewers whose browsers can't play it will need to download it."))
      );
    } else if (!previewBox.firstChild) {
      previewBox.replaceChildren(h("video", { src: draft.url, controls: true, playsInline: true, preload: "metadata", muted: true }));
    }
    const rows = [
      ["File", draft.file.name],
      ["Size", formatBytes(draft.file.size)],
      ["Length", draft.duration ? `${formatTime(draft.duration)} (${formatDurationWords(draft.duration)})` : draft.analyzing ? "Checking…" : "Unknown"],
      ["Resolution", draft.width ? `${draft.width} × ${draft.height}` : draft.analyzing ? "Checking…" : "Unknown"],
    ];
    facts.replaceChildren(...rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
  }

  const publishButton = h("button", { class: "btn btn-primary btn-lg", type: "submit" }, "Publish");
  const status = h("span", { class: "ud-status" });
  const renderStatus = () => {
    status.replaceChildren(
      draft.analyzing ? h("span", { class: "spinner small" }) : icon("check", "ud-status-ok"),
      draft.analyzing ? "Preparing thumbnails…" : "Ready to publish"
    );
  };

  const onDraftChange = () => {
    renderThumbs();
    renderPreview();
    renderStatus();
  };
  draft.listeners.clear();
  draft.listeners.add(onDraftChange);

  const form = h(
    "form",
    { class: "upload-details", noValidate: true },
    h(
      "header",
      { class: "ud-head" },
      h("h1", {}, "Video details"),
      h(
        "button",
        {
          class: "btn btn-text",
          type: "button",
          onclick: async () => {
            const ok = await confirmDialog({ title: "Discard this video?", message: "The details you've entered will be lost.", confirmLabel: "Discard", danger: true });
            if (ok) {
              discardDraft();
              rerender();
            }
          },
        },
        "Discard"
      )
    ),
    h(
      "div",
      { class: "ud-grid" },
      h(
        "div",
        { class: "ud-form" },
        field({ label: "Title (required)", input: titleInput, counter: limits.title }),
        field({ label: "Description", input: descInput, counter: limits.description }),
        field({ label: "Category", input: categorySelect }),
        h(
          "div",
          { class: "field" },
          h("span", { class: "field-label" }, "Thumbnail"),
          h("span", { class: "field-hint" }, "Pick a frame from your video or upload your own image. Thumbnails are saved at 1280 × 720."),
          picker
        )
      ),
      h("aside", { class: "ud-preview" }, previewBox, facts)
    ),
    h("footer", { class: "ud-actions" }, status, error.el, publishButton)
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.hide();
    const title = titleInput.value.trim();
    if (!title) {
      error.show("Your video needs a title.");
      titleInput.focus();
      return;
    }
    if (title.length > limits.title || descInput.value.length > limits.description) {
      error.show("Some fields are too long.");
      return;
    }
    publishButton.disabled = true;
    publishButton.textContent = "Preparing…";
    await draft.analysis.catch(() => {});
    if (uploader.draft !== draft) return;
    const thumb = draft.selected === "custom" ? draft.custom : draft.frames[draft.selected] ?? draft.frames[0] ?? draft.custom;
    draft.previewUrl = thumb?.url ?? null;
    uploader.start({
      file: draft.file,
      thumbnail: thumb?.blob ?? null,
      fields: {
        title,
        description: descInput.value,
        category: categorySelect.value,
        duration: draft.duration,
        width: draft.width,
        height: draft.height,
      },
    });
  });

  onDraftChange();
  requestAnimationFrame(() => {
    autogrow(titleInput, 120);
    autogrow(descInput, 420);
  });
  return form;
}

// ---------- step 3: uploading ----------

function renderProgress() {
  const draft = uploader.draft;
  const bar = h("i");
  const percent = h("strong", { class: "up-percent" });
  const stats = h("p", { class: "up-stats" });

  const el = h(
    "section",
    { class: "upload-progress" },
    h(
      "div",
      { class: "up-card" },
      h("div", { class: "up-thumb" }, draft?.previewUrl ? h("img", { src: draft.previewUrl, alt: "" }) : thumbFallback(uploader.title)),
      h(
        "div",
        { class: "up-info" },
        h("h1", { class: "up-title" }, uploader.title),
        draft && h("p", { class: "muted" }, `${draft.file.name} · ${formatBytes(draft.file.size)}`),
        h("div", { class: "up-row" }, percent, h("div", { class: "up-bar", role: "progressbar", "aria-label": "Upload progress" }, bar)),
        stats,
        h(
          "div",
          { class: "up-actions" },
          h(
            "button",
            {
              class: "btn btn-text",
              type: "button",
              onclick: async () => {
                const ok = await confirmDialog({ title: "Cancel upload?", message: "The upload will stop. Your details are kept so you can try again.", confirmLabel: "Cancel upload", danger: true });
                if (ok) uploader.cancel();
              },
            },
            "Cancel upload"
          )
        )
      )
    ),
    h("p", { class: "up-note" }, icon("videos"), "Feel free to keep browsing ManTube while this uploads. Just keep this tab open.")
  );

  function update() {
    const { loaded, total, speed, processing } = uploader.progress;
    const pct = total ? Math.min(100, (loaded / total) * 100) : 0;
    bar.style.setProperty("width", `${pct}%`);
    bar.parentElement.setAttribute("aria-valuenow", String(Math.floor(pct)));
    percent.textContent = `${Math.floor(pct)}%`;
    if (processing) {
      stats.textContent = "Upload complete. Publishing…";
      return;
    }
    const parts = [`${formatBytes(loaded)} of ${formatBytes(total)}`];
    if (speed > 0) {
      parts.push(`${formatBytes(speed)}/s`);
      parts.push(`about ${formatDurationWords((total - loaded) / speed)} left`);
    }
    stats.textContent = parts.join(" · ");
  }
  update();
  return { el, update };
}

// ---------- step 4: done / error ----------

function renderDone(video) {
  const link = new URL(watchUrl(video.id), location.origin).href;
  return h(
    "section",
    { class: "upload-done" },
    h("div", { class: "done-badge" }, icon("check")),
    h("h1", {}, "Your video is live"),
    h("p", { class: "muted" }, "Anyone who can reach this server can now watch it."),
    h(
      "a",
      { class: "done-card", href: watchUrl(video.id) },
      h("div", { class: "done-thumb" }, video.thumbnailUrl ? h("img", { src: video.thumbnailUrl, alt: "" }) : thumbFallback(video.id), video.duration ? h("span", { class: "thumb-duration" }, formatTime(video.duration)) : null),
      h("strong", {}, video.title)
    ),
    h(
      "div",
      { class: "key-row" },
      h("input", { class: "input", readOnly: true, value: link, "aria-label": "Video link", onfocus: (e) => e.target.select() }),
      h("button", { class: "btn btn-tonal", type: "button", onclick: async () => toast((await copyText(link)) ? "Link copied" : "Couldn't copy the link") }, icon("copy"), "Copy")
    ),
    h(
      "div",
      { class: "done-actions" },
      h("button", { class: "btn btn-text", type: "button", onclick: () => uploader.reset() }, "Upload another"),
      h("a", { class: "btn btn-primary btn-lg", href: watchUrl(video.id) }, "Watch video")
    )
  );
}

function renderError() {
  return h(
    "section",
    { class: "upload-done is-error" },
    h("div", { class: "done-badge" }, icon("alert")),
    h("h1", {}, "The upload didn't finish"),
    h("p", { class: "muted" }, uploader.error),
    h(
      "div",
      { class: "done-actions" },
      h(
        "button",
        {
          class: "btn btn-text",
          type: "button",
          onclick: () => uploader.reset(),
        },
        "Edit details"
      ),
      h("button", { class: "btn btn-primary btn-lg", type: "button", onclick: () => uploader.retry() }, "Try again")
    )
  );
}

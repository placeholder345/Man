import { h, isTyping } from "./dom.js";
import { icon } from "./icons.js";
import { formatTime } from "./format.js";
import { prefs, getProgress, setProgress } from "./store.js";
import { thumbFallback } from "./components.js";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const AUTOPLAY_COUNTDOWN = 8;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const speedLabel = (s) => (s === 1 ? "Normal" : `${s}×`);

/**
 * A full custom video player.
 *
 * options:
 *   video      – { id, title, videoUrl, thumbnailUrl, duration, channel }
 *   startAt    – seconds to start from (e.g. from a ?t= link); otherwise resumes saved progress
 *   onView     – called once after the viewer has actually watched a few seconds
 *   onTheater  – toggles theater mode (the page owns layout)
 *   onNext     – called with the next video (autoplay / next button)
 */
export function createPlayer({ video: meta, startAt = null, onView, onTheater, onNext }) {
  let nextVideo = null;
  let theater = false;
  let scrubbing = false;
  let wasPlayingBeforeScrub = false;
  let scrubFraction = 0;
  let seekQueued = false;
  let settingsOpen = false;
  let idleTimer = 0;
  let spinnerTimer = 0;
  let raf = 0;
  let lastPointerType = "mouse";
  let watchedSeconds = 0;
  let lastTime = null;
  let viewSent = false;
  let lastSave = 0;
  let countdownTimer = 0;
  let destroyed = false;

  // ---------- elements ----------

  const video = h("video", {
    class: "p-video",
    playsInline: true,
    preload: "auto",
    poster: meta.thumbnailUrl || null,
  });

  const tipButton = (iconName, label, onclick, extraClass = "") =>
    h("button", { class: `pbtn ${extraClass}`, type: "button", "aria-label": label, dataset: { tip: label }, onclick }, icon(iconName));
  const setButton = (button, iconName, label) => {
    button.replaceChildren(icon(iconName));
    button.setAttribute("aria-label", label);
    button.dataset.tip = label;
  };

  const playButton = tipButton("play", "Play (k)", () => togglePlay());
  const nextButton = tipButton("next", "Next (Shift+N)", () => nextVideo && goNext(), "p-next");
  nextButton.hidden = true;
  const muteButton = tipButton("volumeHigh", "Mute (m)", () => toggleMute());
  const volumeSlider = h("input", {
    type: "range",
    class: "p-volume-slider",
    min: 0,
    max: 1,
    step: 0.01,
    "aria-label": "Volume",
  });
  const timeCurrent = h("span", { class: "p-time-current" }, "0:00");
  const timeDuration = h("span", { class: "p-time-duration" }, formatTime(meta.duration || 0));

  const autoplaySwitch = h(
    "button",
    {
      class: "pbtn p-autoplay",
      type: "button",
      "aria-pressed": String(prefs.autoplay),
      "aria-label": "Autoplay",
      onclick: () => {
        prefs.autoplay = !prefs.autoplay;
        renderAutoplay();
        hint(prefs.autoplay ? "Autoplay is on" : "Autoplay is off");
        if (!prefs.autoplay) hideEndscreen();
      },
    },
    h("span", { class: "p-switch" }, h("span", { class: "p-switch-knob" }, icon("play")))
  );
  const settingsButton = tipButton("settings", "Settings", () => toggleSettings(), "p-settings-btn");
  const pipButton = tipButton("pip", "Picture-in-picture (i)", () => togglePip(), "p-pip");
  const theaterButton = tipButton("theater", "Theater mode (t)", () => onTheater?.(), "p-theater");
  const fullscreenButton = tipButton("fullscreen", "Full screen (f)", () => toggleFullscreen(), "p-fullscreen");

  pipButton.hidden = !(document.pictureInPictureEnabled && "requestPictureInPicture" in video);
  theaterButton.hidden = !onTheater;
  const canFullscreen = Boolean(
    document.fullscreenEnabled || document.webkitFullscreenEnabled || "webkitEnterFullscreen" in video
  );
  fullscreenButton.hidden = !canFullscreen;

  const buffered = h("div", { class: "p-buffered" });
  const hoverBar = h("div", { class: "p-hoverbar" });
  const played = h("div", { class: "p-played" });
  const scrubber = h("div", { class: "p-scrubber" });
  const tooltip = h("div", { class: "p-tooltip" });
  const progress = h(
    "div",
    {
      class: "p-progress",
      role: "slider",
      tabIndex: 0,
      "aria-label": "Seek",
      "aria-valuemin": "0",
      "aria-valuemax": String(Math.round(meta.duration || 0)),
      "aria-valuenow": "0",
    },
    h("div", { class: "p-track" }, buffered, hoverBar, played),
    scrubber,
    tooltip
  );

  // Settings panel: main view + speed list
  const settingsPanel = h("div", { class: "p-panel", role: "menu", hidden: true });
  const speedValue = h("span", { class: "p-panel-value" });
  const loopState = h("span", { class: "p-panel-toggle" });

  const renderSettingsMain = () => {
    speedValue.textContent = speedLabel(video.playbackRate);
    loopState.classList.toggle("is-on", video.loop);
    settingsPanel.replaceChildren(
      h(
        "button",
        {
          class: "p-panel-row",
          type: "button",
          role: "menuitemcheckbox",
          "aria-checked": String(video.loop),
          onclick: () => {
            video.loop = !video.loop;
            renderSettingsMain();
            hint(video.loop ? "Loop is on" : "Loop is off");
          },
        },
        icon("loop"),
        h("span", { class: "p-panel-label" }, "Loop"),
        loopState
      ),
      h(
        "button",
        { class: "p-panel-row", type: "button", role: "menuitem", onclick: renderSettingsSpeed },
        icon("speed"),
        h("span", { class: "p-panel-label" }, "Playback speed"),
        speedValue,
        icon("chevronRight", "p-panel-chevron")
      )
    );
  };
  const renderSettingsSpeed = () => {
    settingsPanel.replaceChildren(
      h(
        "button",
        { class: "p-panel-row p-panel-back", type: "button", onclick: renderSettingsMain },
        icon("chevronLeft"),
        h("span", { class: "p-panel-label" }, "Playback speed")
      ),
      ...SPEEDS.map((s) =>
        h(
          "button",
          {
            class: `p-panel-row p-speed${video.playbackRate === s ? " is-current" : ""}`,
            type: "button",
            role: "menuitemradio",
            "aria-checked": String(video.playbackRate === s),
            onclick: () => {
              video.playbackRate = s;
              renderSettingsMain();
            },
          },
          h("span", { class: "p-check" }, video.playbackRate === s ? icon("check") : null),
          h("span", { class: "p-panel-label" }, speedLabel(s))
        )
      )
    );
    settingsPanel.querySelector(".is-current")?.focus();
  };

  const controls = h(
    "div",
    { class: "p-controls" },
    progress,
    h(
      "div",
      { class: "p-bar" },
      h(
        "div",
        { class: "p-left" },
        playButton,
        nextButton,
        h("div", { class: "p-volume" }, muteButton, volumeSlider),
        h("div", { class: "p-time" }, timeCurrent, h("span", { class: "p-time-sep" }, " / "), timeDuration)
      ),
      h("div", { class: "p-right" }, autoplaySwitch, settingsButton, pipButton, theaterButton, fullscreenButton)
    )
  );

  const bigPlay = h("button", { class: "p-bigplay", type: "button", "aria-label": "Play", onclick: () => play() }, icon("play"));
  const spinner = h("div", { class: "p-spinner", "aria-hidden": "true" });
  const flashEl = h("div", { class: "p-flash", "aria-hidden": "true" });
  const hintEl = h("div", { class: "p-hint", "aria-live": "polite" });
  const errorEl = h("div", { class: "p-error", hidden: true });
  const endscreen = h("div", { class: "p-endscreen", hidden: true });

  const root = h(
    "div",
    { class: "player is-paused is-unstarted", tabIndex: 0, role: "region", "aria-label": `Video player: ${meta.title}` },
    video,
    h("div", { class: "p-gradient", "aria-hidden": "true" }),
    spinner,
    flashEl,
    hintEl,
    bigPlay,
    errorEl,
    endscreen,
    settingsPanel,
    controls
  );

  // ---------- helpers ----------

  const duration = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : meta.duration || 0);

  function play() {
    hideEndscreen();
    if (video.ended) video.currentTime = 0;
    const p = video.play();
    p?.catch((err) => {
      if (err.name === "NotAllowedError") root.classList.add("is-paused", "is-unstarted");
    });
  }

  function togglePlay(showFlash = false) {
    if (video.paused || video.ended) {
      play();
      if (showFlash) flash("play");
    } else {
      video.pause();
      if (showFlash) flash("pause");
    }
  }

  function flash(content) {
    flashEl.replaceChildren(typeof content === "string" && !content.includes(" ") && !/\d/.test(content) ? icon(content) : h("span", {}, content));
    flashEl.classList.remove("is-on");
    void flashEl.offsetWidth; // restart the animation
    flashEl.classList.add("is-on");
  }

  let hintTimer = 0;
  function hint(text) {
    hintEl.textContent = text;
    hintEl.classList.add("is-on");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hintEl.classList.remove("is-on"), 1100);
  }

  function seekTo(seconds) {
    const d = duration();
    video.currentTime = clamp(seconds, 0, d || seconds);
    hideEndscreen();
    renderTime();
  }

  function seekBy(delta) {
    seekTo(video.currentTime + delta);
    flash(delta < 0 ? `−${Math.abs(delta)} s` : `+${delta} s`);
  }

  function setVolume(v) {
    video.volume = clamp(Math.round(v * 100) / 100, 0, 1);
    video.muted = video.volume === 0;
  }

  function toggleMute() {
    if (video.muted || video.volume === 0) {
      if (video.volume === 0) video.volume = 0.5;
      video.muted = false;
    } else {
      video.muted = true;
    }
  }

  // ---------- rendering ----------

  function renderPlayState() {
    const paused = video.paused;
    root.classList.toggle("is-paused", paused);
    root.classList.toggle("is-playing", !paused);
    root.classList.toggle("is-ended", video.ended);
    if (video.ended) setButton(playButton, "replay", "Replay");
    else if (paused) setButton(playButton, "play", "Play (k)");
    else setButton(playButton, "pause", "Pause (k)");
    if (paused) wake();
  }

  let lastRenderedSecond = -1;
  function renderTime() {
    const d = duration();
    const t = scrubbing ? scrubFraction * d : video.currentTime;
    const fraction = d ? clamp(t / d, 0, 1) : 0;
    progress.style.setProperty("--played", fraction);
    const second = Math.floor(t);
    if (second !== lastRenderedSecond) {
      lastRenderedSecond = second;
      timeCurrent.textContent = formatTime(t);
      progress.setAttribute("aria-valuenow", String(second));
      progress.setAttribute("aria-valuetext", `${formatTime(t)} of ${formatTime(d)}`);
    }
  }

  function renderDuration() {
    const d = duration();
    timeDuration.textContent = formatTime(d);
    progress.setAttribute("aria-valuemax", String(Math.round(d)));
    lastRenderedSecond = -1;
    renderTime();
  }

  function renderBuffered() {
    const d = duration();
    const b = video.buffered;
    let end = 0;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= video.currentTime + 0.5 && b.end(i) >= video.currentTime) end = b.end(i);
    }
    progress.style.setProperty("--buffered", d ? clamp(end / d, 0, 1) : 0);
  }

  function renderVolume() {
    const level = video.muted ? 0 : video.volume;
    volumeSlider.value = String(level);
    volumeSlider.style.setProperty("--level", `${level * 100}%`);
    setButton(muteButton, level === 0 ? "volumeMute" : level < 0.5 ? "volumeLow" : "volumeHigh", level === 0 ? "Unmute (m)" : "Mute (m)");
    root.classList.toggle("is-muted", level === 0);
  }

  function renderAutoplay() {
    autoplaySwitch.setAttribute("aria-pressed", String(prefs.autoplay));
    autoplaySwitch.dataset.tip = prefs.autoplay ? "Autoplay is on" : "Autoplay is off";
    autoplaySwitch.classList.toggle("is-on", prefs.autoplay);
  }

  const tick = () => {
    renderTime();
    raf = requestAnimationFrame(tick);
  };
  const startTicking = () => {
    if (!raf) raf = requestAnimationFrame(tick);
  };
  const stopTicking = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    renderTime();
  };

  // ---------- controls visibility ----------

  function wake() {
    root.classList.remove("is-idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!video.paused && !scrubbing && !settingsOpen && !controls.matches(":hover")) root.classList.add("is-idle");
    }, lastPointerType === "touch" ? 3000 : 2500);
  }

  function hideSoon() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!video.paused && !scrubbing && !settingsOpen) root.classList.add("is-idle");
    }, 600);
  }

  // ---------- settings ----------

  function toggleSettings(open = !settingsOpen) {
    settingsOpen = open;
    settingsPanel.hidden = !open;
    settingsButton.classList.toggle("is-active", open);
    settingsButton.setAttribute("aria-expanded", String(open));
    if (open) {
      renderSettingsMain();
      settingsPanel.querySelector("button")?.focus({ preventScroll: true });
    }
    wake();
  }

  // ---------- fullscreen / pip ----------

  const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;

  function toggleFullscreen() {
    if (fullscreenElement()) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      return;
    }
    if (root.requestFullscreen) {
      root
        .requestFullscreen({ navigationUI: "hide" })
        .then(() => {
          const landscape = (video.videoWidth || 16) >= (video.videoHeight || 9);
          if (landscape && lastPointerType === "touch") screen.orientation?.lock?.("landscape").catch(() => {});
        })
        .catch(() => {});
    } else if (root.webkitRequestFullscreen) {
      root.webkitRequestFullscreen();
    } else if (video.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
    }
  }

  function onFullscreenChange() {
    const active = fullscreenElement() === root;
    root.classList.toggle("is-fullscreen", active);
    setButton(fullscreenButton, active ? "exitFullscreen" : "fullscreen", active ? "Exit full screen (f)" : "Full screen (f)");
    theaterButton.hidden = !onTheater || active;
    if (!active) screen.orientation?.unlock?.();
  }

  async function togglePip() {
    try {
      if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      hint("Picture-in-picture isn't available");
    }
  }

  // ---------- end screen / autoplay ----------

  function hideEndscreen() {
    clearInterval(countdownTimer);
    countdownTimer = 0;
    endscreen.hidden = true;
    root.classList.remove("has-endscreen");
  }

  function goNext() {
    hideEndscreen();
    if (nextVideo) onNext?.(nextVideo);
  }

  function showEndscreen() {
    if (!nextVideo) return;
    let remaining = AUTOPLAY_COUNTDOWN;
    const count = h("strong", {}, String(remaining));
    const thumb = nextVideo.thumbnailUrl ? h("img", { src: nextVideo.thumbnailUrl, alt: "" }) : thumbFallback(nextVideo.id);
    endscreen.replaceChildren(
      h(
        "div",
        { class: "p-upnext" },
        h("p", { class: "p-upnext-label" }, "Up next in ", count),
        h(
          "button",
          { class: "p-upnext-card", type: "button", onclick: goNext },
          h("div", { class: "p-upnext-thumb" }, thumb, h("span", { class: "p-upnext-play" }, icon("play"))),
          h("div", { class: "p-upnext-text" }, h("strong", {}, nextVideo.title), h("span", {}, nextVideo.channel.name))
        ),
        h(
          "div",
          { class: "p-upnext-actions" },
          h("button", { class: "p-upnext-btn", type: "button", onclick: cancelAutoplay }, "Cancel"),
          h("button", { class: "p-upnext-btn is-primary", type: "button", onclick: goNext }, "Play now")
        )
      )
    );
    endscreen.hidden = false;
    root.classList.add("has-endscreen");
    countdownTimer = setInterval(() => {
      remaining -= 1;
      count.textContent = String(remaining);
      if (remaining <= 0) goNext();
    }, 1000);
  }

  function cancelAutoplay() {
    hideEndscreen();
    root.focus({ preventScroll: true });
  }

  // ---------- progress bar scrubbing ----------

  function fractionAt(clientX) {
    const rect = progress.getBoundingClientRect();
    return rect.width ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
  }

  function showTooltip(fraction) {
    const width = progress.clientWidth;
    tooltip.textContent = formatTime(fraction * duration());
    const half = tooltip.offsetWidth / 2;
    tooltip.style.setProperty("--x", `${clamp(fraction * width, half, width - half)}px`);
    progress.style.setProperty("--hover", fraction);
    progress.classList.add("is-hovering");
  }

  function scrubTo(clientX) {
    scrubFraction = fractionAt(clientX);
    renderTime();
    if (seekQueued) return;
    seekQueued = true;
    requestAnimationFrame(() => {
      seekQueued = false;
      if (scrubbing) video.currentTime = scrubFraction * duration();
    });
  }

  progress.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !duration()) return;
    e.preventDefault();
    progress.setPointerCapture(e.pointerId);
    scrubbing = true;
    wasPlayingBeforeScrub = !video.paused;
    root.classList.add("is-scrubbing");
    hideEndscreen();
    if (wasPlayingBeforeScrub) video.pause();
    scrubTo(e.clientX);
    showTooltip(scrubFraction);
  });
  progress.addEventListener("pointermove", (e) => {
    if (!duration()) return;
    if (scrubbing) scrubTo(e.clientX);
    showTooltip(fractionAt(e.clientX));
  });
  const endScrub = () => {
    if (!scrubbing) return;
    scrubbing = false;
    root.classList.remove("is-scrubbing");
    video.currentTime = scrubFraction * duration();
    // Dropping the scrubber at the very end lets the video end instead of restarting it.
    if (wasPlayingBeforeScrub && scrubFraction < 0.999) play();
    renderTime();
    wake();
  };
  progress.addEventListener("pointerup", endScrub);
  progress.addEventListener("pointercancel", endScrub);
  progress.addEventListener("lostpointercapture", endScrub);
  progress.addEventListener("pointerleave", () => {
    if (!scrubbing) progress.classList.remove("is-hovering");
  });

  // ---------- pointer & click ----------

  root.addEventListener("pointerdown", (e) => {
    lastPointerType = e.pointerType || "mouse";
  });
  root.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "touch") wake();
  });
  root.addEventListener("pointerleave", () => {
    if (!video.paused) hideSoon();
  });
  root.addEventListener("focusin", wake);

  video.addEventListener("click", () => {
    if (settingsOpen) {
      toggleSettings(false);
      return;
    }
    if (lastPointerType === "touch" && root.classList.contains("is-idle")) {
      wake();
      return;
    }
    togglePlay(true);
    root.focus({ preventScroll: true });
  });
  video.addEventListener("dblclick", (e) => {
    e.preventDefault();
    toggleFullscreen();
  });

  volumeSlider.addEventListener("input", () => setVolume(Number(volumeSlider.value)));

  // Close the settings panel when clicking elsewhere.
  const onDocPointerDown = (e) => {
    if (settingsOpen && !settingsPanel.contains(e.target) && !settingsButton.contains(e.target)) toggleSettings(false);
  };
  document.addEventListener("pointerdown", onDocPointerDown, true);

  // ---------- keyboard ----------

  function onKey(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    if (document.querySelector("dialog[open]") || document.querySelector(".menu")) return;
    const target = e.target instanceof Element ? e.target : null;
    const inPlayer = root.contains(document.activeElement);
    const onControl = target && target !== root && target.closest("button, a, [role=slider]");
    const key = e.key;

    if ((key === " " || key === "Enter") && onControl) return; // let the focused control activate
    if (key === "Escape" && settingsOpen) {
      toggleSettings(false);
      settingsButton.focus();
      e.preventDefault();
      return;
    }

    let handled = true;
    switch (key) {
      case " ":
      case "k":
      case "K":
        togglePlay(true);
        break;
      case "j":
      case "J":
        seekBy(-10);
        break;
      case "l":
      case "L":
        seekBy(10);
        break;
      case "ArrowLeft":
        seekBy(-5);
        break;
      case "ArrowRight":
        seekBy(5);
        break;
      case "ArrowUp":
      case "ArrowDown":
        if (!inPlayer) {
          handled = false;
          break;
        }
        setVolume((video.muted ? 0 : video.volume) + (key === "ArrowUp" ? 0.05 : -0.05));
        hint(`Volume ${Math.round((video.muted ? 0 : video.volume) * 100)}%`);
        break;
      case "m":
      case "M":
        toggleMute();
        hint(video.muted ? "Muted" : `Volume ${Math.round(video.volume * 100)}%`);
        break;
      case "f":
      case "F":
        if (canFullscreen) toggleFullscreen();
        break;
      case "t":
      case "T":
        if (onTheater && !fullscreenElement()) onTheater();
        break;
      case "i":
      case "I":
        if (!pipButton.hidden) togglePip();
        break;
      case "Home":
      case "End":
        if (!inPlayer) {
          handled = false;
          break;
        }
        seekTo(key === "Home" ? 0 : duration());
        break;
      case ">":
      case "<": {
        const i = SPEEDS.indexOf(video.playbackRate);
        const next = SPEEDS[clamp((i === -1 ? 3 : i) + (key === ">" ? 1 : -1), 0, SPEEDS.length - 1)];
        video.playbackRate = next;
        break;
      }
      case ".":
      case ",":
        if (!video.paused) {
          handled = false;
          break;
        }
        seekTo(video.currentTime + (key === "." ? 1 / 30 : -1 / 30));
        break;
      case "N":
        if (!e.shiftKey || !nextVideo) {
          handled = false;
          break;
        }
        goNext();
        break;
      default:
        if (/^[0-9]$/.test(key) && duration()) {
          seekTo((Number(key) / 10) * duration());
        } else {
          handled = false;
        }
    }
    if (handled) {
      e.preventDefault();
      wake();
    }
  }
  document.addEventListener("keydown", onKey);

  // ---------- media events ----------

  function saveProgress(force = false) {
    const d = duration();
    if (!d || destroyed) return;
    const now = Date.now();
    if (!force && now - lastSave < 4000) return;
    lastSave = now;
    setProgress(meta.id, video.ended ? d : video.currentTime, d);
  }

  const showSpinner = () => {
    clearTimeout(spinnerTimer);
    spinnerTimer = setTimeout(() => root.classList.add("is-waiting"), 350);
  };
  const hideSpinner = () => {
    clearTimeout(spinnerTimer);
    root.classList.remove("is-waiting");
  };

  video.addEventListener("play", () => {
    root.classList.remove("is-unstarted");
    renderPlayState();
    startTicking();
    wake();
  });
  video.addEventListener("playing", () => {
    hideSpinner();
    startTicking();
  });
  video.addEventListener("pause", () => {
    renderPlayState();
    stopTicking();
    saveProgress(true);
  });
  video.addEventListener("waiting", showSpinner);
  video.addEventListener("seeking", () => {
    lastTime = null;
    if (!video.paused) showSpinner();
    renderTime();
  });
  for (const type of ["seeked", "canplay", "error", "loadeddata"]) video.addEventListener(type, hideSpinner);
  video.addEventListener("loadedmetadata", renderDuration);
  video.addEventListener("durationchange", renderDuration);
  video.addEventListener("progress", renderBuffered);
  video.addEventListener("volumechange", () => {
    renderVolume();
    prefs.volume = video.volume;
    prefs.muted = video.muted;
  });
  video.addEventListener("ratechange", () => {
    hint(speedLabel(video.playbackRate) === "Normal" ? "Normal speed" : `${video.playbackRate}× speed`);
    if (settingsOpen) renderSettingsMain();
  });
  video.addEventListener("timeupdate", () => {
    if (video.paused) renderTime();
    renderBuffered();
    const t = video.currentTime;
    if (lastTime != null && !video.seeking) {
      const dt = t - lastTime;
      if (dt > 0 && dt < 1.5) watchedSeconds += dt;
    }
    lastTime = t;
    if (!viewSent && watchedSeconds >= Math.min(3, (duration() || 6) * 0.5)) {
      viewSent = true;
      onView?.();
    }
    saveProgress();
  });
  video.addEventListener("ended", () => {
    renderPlayState();
    stopTicking();
    saveProgress(true);
    if (!viewSent) {
      viewSent = true;
      onView?.();
    }
    if (prefs.autoplay && nextVideo) showEndscreen();
  });
  video.addEventListener("enterpictureinpicture", () => root.classList.add("is-pip"));
  video.addEventListener("leavepictureinpicture", () => root.classList.remove("is-pip"));

  video.addEventListener("error", () => {
    if (destroyed || !video.error) return;
    const messages = {
      1: "Playback was stopped.",
      2: "A network problem interrupted the video.",
      3: "This video couldn't be decoded. The file may be damaged.",
      4: "Your browser can't play this video's format. You can still download it and watch it in a video player app.",
    };
    errorEl.replaceChildren(
      h(
        "div",
        { class: "p-error-box" },
        icon("alert"),
        h("p", {}, messages[video.error.code] || "This video can't be played right now."),
        h(
          "div",
          { class: "p-error-actions" },
          video.error.code === 2 &&
            h(
              "button",
              {
                class: "p-upnext-btn",
                type: "button",
                onclick: () => {
                  const t = video.currentTime;
                  errorEl.hidden = true;
                  video.load();
                  video.currentTime = t;
                  play();
                },
              },
              "Try again"
            ),
          h("a", { class: "p-upnext-btn is-primary", href: `/api/videos/${encodeURIComponent(meta.id)}/download`, download: "" }, "Download video")
        )
      )
    );
    errorEl.hidden = false;
    root.classList.add("has-error");
  });

  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);
  const onPageHide = () => saveProgress(true);
  window.addEventListener("pagehide", onPageHide);

  // ---------- media session (OS media keys, lock screen) ----------

  const session = "mediaSession" in navigator ? navigator.mediaSession : null;
  const sessionActions = {
    play: () => play(),
    pause: () => video.pause(),
    seekbackward: () => seekBy(-10),
    seekforward: () => seekBy(10),
    seekto: (d) => seekTo(d.seekTime),
    nexttrack: () => nextVideo && goNext(),
  };
  if (session) {
    try {
      session.metadata = new MediaMetadata({
        title: meta.title,
        artist: meta.channel?.name ?? "",
        album: "ManTube",
        artwork: meta.thumbnailUrl ? [{ src: new URL(meta.thumbnailUrl, location.href).href, sizes: "1280x720" }] : [],
      });
      for (const [action, handler] of Object.entries(sessionActions)) {
        try {
          session.setActionHandler(action, handler);
        } catch {
          /* unsupported action */
        }
      }
    } catch {
      /* MediaMetadata unsupported */
    }
  }

  // ---------- start ----------

  video.volume = prefs.volume;
  video.muted = prefs.muted;
  renderVolume();
  renderAutoplay();
  renderDuration();

  let resumeAt = startAt;
  if (resumeAt == null) {
    const saved = getProgress(meta.id);
    if (saved && saved.time > 5 && saved.time < saved.duration - 10) resumeAt = saved.time;
  }
  video.src = resumeAt ? `${meta.videoUrl}#t=${resumeAt.toFixed(1)}` : meta.videoUrl;
  if (resumeAt) {
    progress.style.setProperty("--played", meta.duration ? clamp(resumeAt / meta.duration, 0, 1) : 0);
    timeCurrent.textContent = formatTime(resumeAt);
  }
  play();

  return {
    el: root,
    video,
    seekTo(seconds) {
      seekTo(seconds);
      play();
    },
    get currentTime() {
      return video.currentTime;
    },
    setTheater(on) {
      theater = on;
      setButton(theaterButton, on ? "defaultView" : "theater", on ? "Default view (t)" : "Theater mode (t)");
    },
    setNext(v) {
      nextVideo = v;
      nextButton.hidden = !v;
      if (v) {
        nextButton.dataset.tip = `Next: ${v.title}`;
        nextButton.setAttribute("aria-label", `Next: ${v.title}`);
      }
      if (video.ended && prefs.autoplay && v && endscreen.hidden) showEndscreen();
    },
    get theater() {
      return theater;
    },
    destroy() {
      saveProgress(true);
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(idleTimer);
      clearTimeout(spinnerTimer);
      clearTimeout(hintTimer);
      clearInterval(countdownTimer);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
      window.removeEventListener("pagehide", onPageHide);
      if (document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {});
      if (fullscreenElement() === root) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      if (session) {
        for (const action of Object.keys(sessionActions)) {
          try {
            session.setActionHandler(action, null);
          } catch {
            /* ignore */
          }
        }
        session.metadata = null;
      }
      video.pause();
      video.removeAttribute("src");
      video.load();
    },
  };
}

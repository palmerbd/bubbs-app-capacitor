/**
 * Bubbs-Talks content detail view (batch V2-1).
 *
 * Full-screen overlay opened from a Learn-tab card: 16:9 player at the
 * top, title + duration + category line, collapsible description, and
 * a horizontally-scrolling "Related Content" row.
 *
 * videoProvider drives the render (BUBBS-V2-UI-YOUTUBE-STYLE.md):
 *   - youtube / vimeo → <iframe> embed with kid-safe chrome params
 *   - mp4             → <video controls playsinline>
 *
 * The player src is set on open and cleared on close so audio never
 * keeps playing behind the feed.
 */
(function () {
  "use strict";

  let currentItem = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function fmtDuration(totalSeconds) {
    const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
    if (!s) return "";
    const m = Math.floor(s / 60);
    return m + ":" + String(s % 60).padStart(2, "0");
  }

  /** Build the embed/player element for a content item. */
  function buildPlayer(item) {
    const provider = String(item.videoProvider || "youtube").toLowerCase();
    const url = String(item.videoUrl || "");

    if (provider === "mp4") {
      const v = document.createElement("video");
      v.className = "cd-player";
      v.setAttribute("controls", "");
      v.setAttribute("playsinline", "");
      v.setAttribute("preload", "metadata");
      v.src = url;
      return v;
    }

    const iframe = document.createElement("iframe");
    iframe.className = "cd-player";
    iframe.setAttribute("allowfullscreen", "");
    iframe.setAttribute(
      "allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    );
    iframe.setAttribute("frameborder", "0");
    iframe.title = item.title || "video";

    let src = url;
    const sep = src.indexOf("?") === -1 ? "?" : "&";
    if (provider === "vimeo") {
      src += sep + "dnt=1";
    } else {
      // youtube
      src += sep + "playsinline=1&modestbranding=1&rel=0";
    }
    iframe.src = src;
    return iframe;
  }

  function open(item, related) {
    const view = document.getElementById("content-detail");
    if (!view || !item) return;
    currentItem = item;

    const playerHost = document.getElementById("cd-player-host");
    playerHost.innerHTML = "";
    playerHost.appendChild(buildPlayer(item));

    document.getElementById("cd-title").textContent = item.title || "";
    const dur = fmtDuration(item.durationSeconds);
    document.getElementById("cd-meta").textContent = [dur].filter(Boolean).join(" · ");

    const descEl = document.getElementById("cd-desc");
    const desc = String(item.shortDescription || "");
    descEl.textContent = desc;
    descEl.classList.add("collapsed");
    document.getElementById("cd-desc-toggle").style.display =
      desc.length > 120 ? "" : "none";
    document.getElementById("cd-desc-toggle").textContent = "Show more";

    const relHost = document.getElementById("cd-related");
    relHost.innerHTML = "";
    (related || []).forEach((r) => {
      const card = document.createElement("button");
      card.className = "cd-related-card";
      card.setAttribute("aria-label", r.title || "video");
      card.innerHTML =
        '<div class="cd-related-thumb">' +
        (r.thumbnailUrl
          ? '<img src="' + esc(r.thumbnailUrl) + '" alt="" loading="lazy" />'
          : '<span class="cd-related-emoji">🎬</span>') +
        "</div>" +
        '<span class="cd-related-title">' + esc(r.title) + "</span>";
      card.addEventListener("click", () => {
        // Re-open with the tapped item; related row recomputed by caller
        // next time from the feed — here we just reuse the same list.
        open(r, (related || []).filter((x) => x.id !== r.id).concat([item]));
      });
      relHost.appendChild(card);
    });
    document.getElementById("cd-related-wrap").style.display =
      related && related.length ? "" : "none";

    view.classList.add("open");
    view.scrollTop = 0;
  }

  function close() {
    const view = document.getElementById("content-detail");
    if (!view) return;
    view.classList.remove("open");
    // Tear down the player so audio stops.
    const playerHost = document.getElementById("cd-player-host");
    if (playerHost) playerHost.innerHTML = "";
    currentItem = null;
  }

  function init() {
    const back = document.getElementById("cd-back");
    if (back) back.addEventListener("click", close);

    const toggle = document.getElementById("cd-desc-toggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        const descEl = document.getElementById("cd-desc");
        const collapsed = descEl.classList.toggle("collapsed");
        toggle.textContent = collapsed ? "Show more" : "Show less";
      });
    }
  }

  window.BubbsContentDetail = { open: open, close: close };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

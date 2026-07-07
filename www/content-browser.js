/**
 * Bubbs-Talks Learn tab — YouTube-style content browser (batch V2-1).
 *
 * Renders: search bar → chip filter row → vertical feed of content
 * cards (thumbnail 16:9, duration badge, title). Tapping a card opens
 * the detail view (content-detail.js).
 *
 * Data:
 *   /content            where published == true   (onSnapshot, live)
 *   /content-categories where active == true      (onSnapshot, live)
 *
 * Both result sets are sorted CLIENT-SIDE by orderHint desc so V2-1
 * has zero composite-index dependencies — with a personal content
 * library (tens of items, not thousands) this is deliberate: chip
 * filtering + search are instant, offline-cached, and can't be broken
 * by a missing index. (Indexes are still declared in the monorepo's
 * firestore.indexes.json for when the library grows.)
 *
 * Search is client-side substring match over title + shortDescription
 * per BUBBS-V2-UI-YOUTUBE-STYLE.md.
 */
(function () {
  "use strict";

  const log = (...args) => console.log("[learn]", ...args);
  const err = (...args) => console.error("[learn]", ...args);

  let allContent = [];    // published items, sorted by orderHint desc
  let allCategories = []; // active categories, sorted by orderHint desc
  let selectedChip = "all";
  let searchQuery = "";
  let unsubContent = null;
  let unsubCategories = null;
  let started = false;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function fmtDuration(totalSeconds) {
    const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
    if (!s) return "";
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ":" + String(r).padStart(2, "0");
  }

  function byOrderHintDesc(a, b) {
    return (Number(b.orderHint) || 0) - (Number(a.orderHint) || 0);
  }

  /* ---------------- data ---------------- */

  async function start() {
    if (started) return;
    started = true;

    if (!window.BubbsFirebase || !window.BubbsFirebase.ready) {
      showEmpty("Content isn't available right now. Check your internet connection and restart the app.");
      return;
    }
    let ctx;
    try {
      ctx = await window.BubbsFirebase.ready;
    } catch (e) {
      err("firebase not ready", e);
      showEmpty("Content isn't available right now. Check your internet connection and restart the app.");
      return;
    }
    const db = ctx.db;

    unsubCategories = db
      .collection("content-categories")
      .where("active", "==", true)
      .onSnapshot(
        (snap) => {
          allCategories = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort(byOrderHintDesc);
          renderChips();
        },
        (e) => err("categories subscription failed", e)
      );

    unsubContent = db
      .collection("content")
      .where("published", "==", true)
      .onSnapshot(
        (snap) => {
          allContent = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort(byOrderHintDesc);
          log("content items:", allContent.length);
          renderFeed();
        },
        (e) => {
          err("content subscription failed", e);
          showEmpty("Couldn't load content. Check your internet connection.");
        }
      );
  }

  function visibleItems() {
    let items = allContent;
    if (selectedChip !== "all") {
      items = items.filter(
        (it) => Array.isArray(it.categoryIds) && it.categoryIds.indexOf(selectedChip) !== -1
      );
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      items = items.filter(
        (it) =>
          String(it.title || "").toLowerCase().indexOf(q) !== -1 ||
          String(it.shortDescription || "").toLowerCase().indexOf(q) !== -1
      );
    }
    return items;
  }

  /* ---------------- rendering ---------------- */

  function renderChips() {
    const host = document.getElementById("learn-chips");
    if (!host) return;
    host.innerHTML = "";

    const mk = (id, label, icon) => {
      const b = document.createElement("button");
      b.className = "learn-chip" + (selectedChip === id ? " selected" : "");
      b.setAttribute("role", "button");
      b.setAttribute("aria-pressed", selectedChip === id ? "true" : "false");
      b.innerHTML =
        (icon ? '<span class="learn-chip-icon">' + esc(icon) + "</span>" : "") +
        "<span>" + esc(label) + "</span>";
      b.addEventListener("click", () => {
        selectedChip = id;
        renderChips();
        renderFeed();
      });
      return b;
    };

    host.appendChild(mk("all", "All", "⭐"));
    allCategories.forEach((c) => host.appendChild(mk(c.id, c.label || c.id, c.icon || "")));
  }

  function showEmpty(message) {
    const feed = document.getElementById("learn-feed");
    if (!feed) return;
    feed.innerHTML =
      '<div class="learn-empty" role="status">' +
      '<div class="learn-empty-emoji">🎬</div>' +
      "<p>" + esc(message) + "</p></div>";
  }

  function renderFeed() {
    const feed = document.getElementById("learn-feed");
    if (!feed) return;

    const items = visibleItems();
    if (!items.length) {
      if (!allContent.length) {
        showEmpty("No videos yet — new content is coming soon!");
      } else {
        showEmpty("Nothing matches. Try a different filter or search.");
      }
      return;
    }

    feed.innerHTML = "";
    const reduceMotion =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    items.forEach((item, i) => {
      const card = document.createElement("button");
      card.className = "content-card";
      card.setAttribute("aria-label", item.title || "video");
      const dur = fmtDuration(item.durationSeconds);
      card.innerHTML =
        '<div class="relative w-full aspect-video overflow-hidden rounded-2xl bg-slate-200">' +
        (item.thumbnailUrl
          ? '<img src="' + esc(item.thumbnailUrl) + '" alt="" loading="lazy" class="w-full h-full object-cover" />'
          : '<div class="w-full h-full flex items-center justify-center text-5xl">🎬</div>') +
        (dur
          ? '<span class="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">' + dur + "</span>"
          : "") +
        "</div>" +
        '<h3 class="mt-3 text-lg font-bold leading-tight text-slate-800">' + esc(item.title) + "</h3>";
      if (!reduceMotion) {
        card.style.animation = "learn-card-in 0.25s ease both";
        card.style.animationDelay = Math.min(i * 40, 300) + "ms";
      }
      card.addEventListener("click", () => {
        if (window.BubbsContentDetail) {
          window.BubbsContentDetail.open(item, relatedFor(item));
        }
      });
      feed.appendChild(card);
    });
  }

  /** Related = other visible items sharing at least one category. */
  function relatedFor(item) {
    const cats = Array.isArray(item.categoryIds) ? item.categoryIds : [];
    const rel = allContent.filter(
      (o) =>
        o.id !== item.id &&
        Array.isArray(o.categoryIds) &&
        o.categoryIds.some((c) => cats.indexOf(c) !== -1)
    );
    const fill = allContent.filter((o) => o.id !== item.id && rel.indexOf(o) === -1);
    return rel.concat(fill).slice(0, 8);
  }

  /* ---------------- wiring ---------------- */

  function init() {
    const search = document.getElementById("learn-search");
    if (search) {
      search.addEventListener("input", () => {
        searchQuery = search.value || "";
        renderFeed();
      });
    }

    if (window.BubbsNav) {
      window.BubbsNav.registerTab({
        id: "learn",
        label: "Learn",
        emoji: "🎓",
        viewId: "learn-view",
        onShow: start, // lazy-start subscriptions on first open
        onHide: function () {
          if (window.BubbsContentDetail) window.BubbsContentDetail.close();
        },
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

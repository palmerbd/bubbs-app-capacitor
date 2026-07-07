/**
 * Bubbs-Talks app-level bottom navigation — V2 (batch V2-1).
 *
 * v1 had a single view: the AAC board (#app), toggled against
 * #parent-shell by role-select.js. v2 introduces sibling views
 * (Learn, later Games + Rewards) behind a bottom nav bar.
 *
 * Design constraints (v1 must not regress):
 *   - The nav ONLY appears in child mode after paywall + role resolve.
 *     Parent mode and all pre-role screens never see it.
 *   - The AAC board's own markup/CSS is untouched; when the nav is
 *     visible we shrink #app via a body.has-nav class so the board
 *     lays out exactly as before, just above the nav bar.
 *   - Tabs register themselves (BubbsNav.registerTab) so batches can
 *     add Games/Rewards later without touching this file.
 *
 * Public API on window.BubbsNav:
 *   - registerTab({ id, label, emoji, onShow, onHide })
 *   - show(id)      — switch to a tab
 *   - current()     — active tab id
 *   - setBadge(id, on) — red-dot badge on a tab icon (rewards uses this)
 */
(function () {
  "use strict";

  const log = (...args) => console.log("[nav]", ...args);

  const tabs = []; // { id, label, emoji, viewId, onShow, onHide }
  let activeId = "home";
  let navVisible = false;

  function el(id) { return document.getElementById(id); }

  function renderBar() {
    const bar = el("main-nav");
    if (!bar) return;
    bar.innerHTML = "";
    tabs.forEach((t) => {
      const btn = document.createElement("button");
      btn.className = "main-nav-btn" + (t.id === activeId ? " active" : "");
      btn.setAttribute("aria-label", t.label);
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", t.id === activeId ? "true" : "false");
      btn.dataset.tabId = t.id;
      btn.innerHTML =
        '<span class="main-nav-emoji">' + t.emoji + '</span>' +
        '<span class="main-nav-label">' + t.label + '</span>' +
        '<span class="main-nav-badge" style="display:none"></span>';
      btn.addEventListener("click", () => show(t.id));
      bar.appendChild(btn);
    });
  }

  function applyVisibility() {
    tabs.forEach((t) => {
      if (t.id === "home") {
        // Home = the v1 AAC board. role-select.js owns its display in
        // parent mode; in child mode we own it.
        const app = el("app");
        if (app) app.style.display = activeId === "home" ? "" : "none";
        return;
      }
      const view = el(t.viewId);
      if (view) view.classList.toggle("open", t.id === activeId);
    });
  }

  function show(id) {
    if (id === activeId) return;
    const prev = tabs.find((t) => t.id === activeId);
    const next = tabs.find((t) => t.id === id);
    if (!next) return;
    activeId = id;
    if (prev && prev.onHide) { try { prev.onHide(); } catch (e) {} }
    applyVisibility();
    renderBar();
    if (next.onShow) { try { next.onShow(); } catch (e) {} }
    log("switched to tab:", id);
  }

  function setNavVisible(on) {
    navVisible = on;
    const bar = el("main-nav");
    if (bar) bar.style.display = on ? "flex" : "none";
    document.body.classList.toggle("has-nav", on);
    if (!on) {
      // Leaving child mode: land back on Home so parent mode /
      // role screens never sit on top of a hidden Learn view.
      activeId = "home";
      tabs.forEach((t) => {
        if (t.viewId) {
          const view = el(t.viewId);
          if (view) view.classList.remove("open");
        }
      });
    }
  }

  function setBadge(id, on) {
    const bar = el("main-nav");
    if (!bar) return;
    const btn = bar.querySelector('[data-tab-id="' + id + '"] .main-nav-badge');
    if (btn) btn.style.display = on ? "block" : "none";
  }

  window.BubbsNav = {
    registerTab: function (t) {
      if (!t || !t.id || tabs.some((x) => x.id === t.id)) return;
      tabs.push(t);
      renderBar();
      applyVisibility();
    },
    show: show,
    current: function () { return activeId; },
    setBadge: setBadge,
  };

  // Home tab is always first.
  window.BubbsNav.registerTab({ id: "home", label: "Home", emoji: "🏠" });

  // Follow role changes. Child → nav on; anything else → nav off.
  window.addEventListener("bubbs:role-ready", (ev) => {
    const role = ev && ev.detail ? ev.detail.role : null;
    setNavVisible(role === "child");
  });

  // If role already resolved before we loaded (defensive), reconcile.
  if (window.BubbsRole && window.BubbsRole.get && window.BubbsRole.get() === "child") {
    const app = el("app");
    // Only flip the nav on if role-select has already revealed the board.
    if (app && app.style.display !== "none") setNavVisible(true);
  }
})();

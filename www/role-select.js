/**
 * Bubbs-Talks role selection — V1-B (commit batch 3).
 *
 * Boot orchestration after the paywall passes:
 *
 *   paywall.js dispatches `bubbs:paywall-pass`
 *      ↓
 *   we look up `localStorage['bubbs-role']`
 *      ├─ "child"  → hide #role-screen, hide #parent-shell, show #app (AAC board)
 *      ├─ "parent" → hide #role-screen, hide #app, show #parent-shell
 *      └─ unset    → show #role-screen, wait for user click, persist + dispatch
 *
 * After the choice is persisted we dispatch `bubbs:role-ready` with detail
 * `{ role: 'child' | 'parent' }` so other modules (parent-fanout, pairing,
 * Firebase init) can decide how to behave on this device.
 *
 * Caregiver mode in the AAC board has a "Reset role" button which calls
 * `BubbsRole.reset()` — same effect as a fresh install.
 *
 * The script is no-op safe before the paywall passes: nothing visible
 * happens until `bubbs:paywall-pass` fires. If the paywall is disabled
 * (placeholder config), paywall.js still dispatches the pass event so
 * role select still runs — which is desirable for development.
 */
(function () {
  "use strict";

  const STORAGE_KEY = "bubbs-role";
  const VALID_ROLES = ["child", "parent"];

  const log = (...args) => console.log("[role]", ...args);

  function getRole() {
    try {
      const r = localStorage.getItem(STORAGE_KEY);
      return VALID_ROLES.includes(r) ? r : null;
    } catch (e) {
      return null;
    }
  }

  function setRole(role) {
    if (!VALID_ROLES.includes(role)) return;
    try {
      localStorage.setItem(STORAGE_KEY, role);
    } catch (e) {
      // Private mode / quota — fail soft. Role state will be lost on
      // next launch but the current session still works.
    }
  }

  function clearRole() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  function showScreen(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add("open");
  }

  function hideScreen(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("open");
  }

  function applyRole(role) {
    const child = document.getElementById("app");
    const parent = document.getElementById("parent-shell");
    const lockBtn = document.getElementById("lock-btn");

    if (role === "child") {
      // Show AAC board, keep caregiver lock button visible.
      if (child) child.style.display = "";
      if (parent) parent.classList.remove("open");
      if (lockBtn) lockBtn.style.display = "";
    } else if (role === "parent") {
      // Hide AAC board, show parent shell, hide caregiver lock button
      // (caregiver settings only make sense on the child's device).
      if (child) child.style.display = "none";
      if (parent) parent.classList.add("open");
      if (lockBtn) lockBtn.style.display = "none";
    }

    window.dispatchEvent(
      new CustomEvent("bubbs:role-ready", { detail: { role } })
    );
  }

  function attachRoleButtons() {
    const childBtn = document.getElementById("role-child-btn");
    const parentBtn = document.getElementById("role-parent-btn");

    function pick(role) {
      log("user picked role:", role);
      setRole(role);
      hideScreen("role-screen");
      applyRole(role);
    }

    if (childBtn) childBtn.addEventListener("click", () => pick("child"));
    if (parentBtn) parentBtn.addEventListener("click", () => pick("parent"));
  }

  function attachParentShellButtons() {
    const switchBtn = document.getElementById("parent-switch-role-btn");
    if (switchBtn) {
      switchBtn.addEventListener("click", () => {
        // User wants to switch this device from Parent → Child.
        // Clear the role and re-prompt.
        clearRole();
        hideScreen("parent-shell");
        showScreen("role-screen");
      });
    }

    // Pair button is wired in V1-B batch 4 (pairing.js). For now it
    // shows a placeholder so the screen isn't a dead-end.
    const pairBtn = document.getElementById("parent-pair-btn");
    if (pairBtn) {
      pairBtn.addEventListener("click", () => {
        if (window.BubbsPairing && window.BubbsPairing.startScan) {
          window.BubbsPairing.startScan();
        } else {
          alert(
            "Pairing arrives in the next update. Please install the latest version from TestFlight."
          );
        }
      });
    }
  }

  function init() {
    attachRoleButtons();
    attachParentShellButtons();

    // Hide both shells until paywall passes + role decided.
    const child = document.getElementById("app");
    const parent = document.getElementById("parent-shell");
    const lockBtn = document.getElementById("lock-btn");
    if (child) child.style.display = "none";
    if (parent) parent.classList.remove("open");
    if (lockBtn) lockBtn.style.display = "none";

    function onPaywallPass() {
      const role = getRole();
      if (!role) {
        log("no role stored — showing chooser");
        showScreen("role-screen");
        return;
      }
      log("stored role found:", role);
      applyRole(role);
    }

    window.addEventListener("bubbs:paywall-pass", onPaywallPass);

    // If paywall already dispatched pass before our listener registered
    // (happens with placeholder config / dev bypass — the dispatch is
    // synchronous inside paywall.js init which runs first), reconcile by
    // checking the paywall state and running our handler now.
    const paywall = document.getElementById("paywall-screen");
    const alreadyPassed =
      paywall &&
      (paywall.classList.contains("closed") ||
        !paywall.classList.contains("open"));
    if (alreadyPassed) {
      // Defer to next tick so any pending paywall init code finishes first.
      setTimeout(onPaywallPass, 0);
    }
  }

  // Public API for caregiver mode + dev tools.
  window.BubbsRole = {
    get: getRole,
    set: function (r) {
      setRole(r);
      hideScreen("role-screen");
      applyRole(r);
    },
    reset: function () {
      clearRole();
      const child = document.getElementById("app");
      const parent = document.getElementById("parent-shell");
      const lockBtn = document.getElementById("lock-btn");
      if (child) child.style.display = "none";
      if (parent) parent.classList.remove("open");
      if (lockBtn) lockBtn.style.display = "none";
      showScreen("role-screen");
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

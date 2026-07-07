/**
 * Bubbs-Talks rewards — V2 (batch V2-6).
 *
 * Rewards tab lists admin-configured rewards from /rewards. When the
 * child's balance covers a reward, its card unlocks and the tab shows
 * a red-dot badge. Redeeming spends points through the same audited
 * ledger transaction as earning (points.js), then launches YouTube
 * Kids.
 *
 * APP REVIEW SAFETY (BUBBS-V2-YOUTUBE-LAUNCH.md): the launch target is
 * HARD-CODED to the YouTube Kids app (youtubekids://) with a
 * youtubekids.com fallback. It is deliberately NOT read from the
 * reward document and NOT editable in the admin panel — Bubbs is
 * rated 4+, and YouTube Kids is the only approved outbound
 * destination in v2. Do not "fix" this by making it configurable.
 */
(function () {
  "use strict";

  var YTK_SCHEME = "youtubekids://";
  var YTK_FALLBACK = "https://www.youtubekids.com/";

  const log = (...args) => console.log("[rewards]", ...args);
  const err = (...args) => console.error("[rewards]", ...args);

  let rewards = [];        // active rewards, sorted cost asc
  let balance = 0;
  let started = false;
  let pendingReward = null;

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /* ---------------- YouTube Kids launch ---------------- */

  async function launchYouTubeKids() {
    const AL = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AppLauncher;
    // 1. the YouTube Kids app itself
    try {
      if (AL && AL.openUrl) {
        const res = await AL.openUrl({ url: YTK_SCHEME });
        if (res && res.completed) return true;
      }
    } catch (e) { log("app scheme failed, trying fallback", e); }
    // 2. youtubekids.com in the system browser
    try {
      if (AL && AL.openUrl) {
        const res = await AL.openUrl({ url: YTK_FALLBACK });
        if (res && res.completed) return true;
      }
    } catch (e) { log("fallback via AppLauncher failed", e); }
    // 3. last resort for non-native contexts
    try { window.open(YTK_FALLBACK, "_blank"); return true; } catch (e) {}
    return false;
  }

  /* ---------------- rendering ---------------- */

  function cheapestCost() {
    return rewards.length ? rewards[0].cost : Infinity;
  }

  function updateBadge() {
    if (window.BubbsNav) {
      window.BubbsNav.setBadge("rewards", rewards.length > 0 && balance >= cheapestCost());
    }
  }

  function render() {
    const host = el("rewards-list");
    if (!host) return;
    host.innerHTML = "";
    if (!rewards.length) {
      host.innerHTML = '<div class="learn-empty"><div class="learn-empty-emoji">🎁</div><p>No rewards yet — keep earning points!</p></div>';
      return;
    }
    rewards.forEach((r) => {
      const affordable = balance >= r.cost;
      const card = document.createElement("button");
      card.className = "reward-card" + (affordable ? " unlocked" : " locked");
      card.setAttribute("aria-label", r.name + ", costs " + r.cost + " points" + (affordable ? "" : ", locked"));
      card.innerHTML =
        '<span class="reward-emoji">' + esc(r.iconEmoji || "🎁") + "</span>" +
        '<span class="reward-name">' + esc(r.name) + "</span>" +
        '<span class="reward-desc">' + esc(r.description || "") + "</span>" +
        (affordable
          ? '<span class="reward-cost unlocked">⭐ ' + r.cost + " — Tap to unlock!</span>"
          : '<span class="reward-cost">⭐ ' + r.cost + " — earn " + (r.cost - balance) + " more</span>");
      card.addEventListener("click", () => { if (affordable) confirmRedeem(r); });
      host.appendChild(card);
    });
  }

  /* ---------------- redeem flow ---------------- */

  function confirmRedeem(r) {
    pendingReward = r;
    el("reward-confirm-text").textContent =
      "Ready for " + r.name + "? This will use " + r.cost + " points.";
    el("reward-confirm").classList.add("open");
  }

  function closeConfirm() {
    el("reward-confirm").classList.remove("open");
    pendingReward = null;
  }

  async function redeem() {
    const r = pendingReward;
    closeConfirm();
    if (!r || !window.BubbsPoints) return;
    try {
      await window.BubbsPoints.spend(r.cost, "reward-redeem", r.id);
    } catch (e) {
      err("spend failed", e);
      alert(e && e.message === "insufficient"
        ? "Not enough points yet — keep playing!"
        : "Couldn't redeem right now. Check the internet connection and try again.");
      return;
    }
    log("redeemed", r.id, "for", r.cost);
    await launchYouTubeKids();
  }

  /* ---------------- data ---------------- */

  async function start() {
    if (started) return;
    started = true;
    if (!window.BubbsFirebase || !window.BubbsFirebase.ready) return;
    let ctx;
    try { ctx = await window.BubbsFirebase.ready; } catch (e) { return; }
    ctx.db.collection("rewards").where("active", "==", true).onSnapshot(
      (snap) => {
        rewards = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.cost || 0) - (b.cost || 0));
        render();
        updateBadge();
      },
      (e) => err("rewards subscription failed", e)
    );
  }

  /* ---------------- boot ---------------- */

  function init() {
    if (window.BubbsNav) {
      window.BubbsNav.registerTab({
        id: "rewards",
        label: "Rewards",
        emoji: "🎁",
        viewId: "rewards-view",
        onShow: function () { start(); render(); },
      });
    }
    if (window.BubbsPoints) {
      window.BubbsPoints.onChange(function (s) {
        balance = s.balance;
        render();
        updateBadge();
      });
    }
    // subscribe early (not just on tab open) so the badge can appear
    // while the kid is playing games on other tabs
    window.addEventListener("bubbs:role-ready", function (ev) {
      if (ev && ev.detail && ev.detail.role === "child") start();
    });

    const yes = el("reward-confirm-yes");
    const no = el("reward-confirm-no");
    if (yes) yes.addEventListener("click", redeem);
    if (no) no.addEventListener("click", closeConfirm);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/**
 * Bubbs-Talks points system — V2 (batch V2-2).
 *
 * Spark-plan design (no Cloud Functions — decided 2026-07-07):
 * every balance change happens inside a Firestore TRANSACTION that
 * simultaneously creates an append-only points-log entry. Security
 * rules verify the ledger math server-side via getAfter() and reject
 * any balance write that isn't backed by a brand-new log entry, so a
 * tampered client still can't mint points.
 *
 * Public API on window.BubbsPoints:
 *   ready                              — Promise, resolves after user doc ensured
 *   getBalance()                       — last known balance (number)
 *   earn(amount, reason, gameType)     — Promise<newBalance>
 *   spend(amount, reason, rewardId)    — Promise<newBalance> (rejects "insufficient")
 *   onChange(cb)                       — cb({balance, earned, spent}) on every change
 */
(function () {
  "use strict";

  const log = (...args) => console.log("[points]", ...args);
  const err = (...args) => console.error("[points]", ...args);

  let db = null;
  let uid = null;
  let state = { balance: 0, earned: 0, spent: 0 };
  const listeners = [];

  let resolveReady;
  const ready = new Promise((res) => { resolveReady = res; });

  function notify() {
    listeners.forEach((cb) => { try { cb({ ...state }); } catch (e) {} });
    renderBadge();
  }

  /* ---------------- badge UI (top-right, next to caregiver gear) ---------------- */

  function renderBadge() {
    const el = document.getElementById("points-badge");
    if (!el) return;
    el.textContent = "⭐ " + state.balance;
    el.setAttribute("aria-label", state.balance + " points");
  }

  function setBadgeVisible(on) {
    const el = document.getElementById("points-badge");
    if (el) el.style.display = on ? "flex" : "none";
  }

  /* ---------------- Firestore ---------------- */

  async function ensureUserDoc() {
    const refDoc = db.collection("users").doc(uid);
    const snap = await refDoc.get();
    if (!snap.exists) {
      await refDoc.set({
        pointsBalance: 0,
        pointsEarned: 0,
        pointsSpent: 0,
        lastGamePlayedAt: null,
        gamesPlayed: {
          "match-word-picture": { sessions: 0, totalScore: 0 },
          "tap-the-order": { sessions: 0, totalScore: 0 },
          "category-sort": { sessions: 0, totalScore: 0 },
        },
        createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
      });
      log("created user doc for", uid);
    }
  }

  function subscribe() {
    db.collection("users").doc(uid).onSnapshot(
      (snap) => {
        const d = snap.data() || {};
        state = {
          balance: Number(d.pointsBalance) || 0,
          earned: Number(d.pointsEarned) || 0,
          spent: Number(d.pointsSpent) || 0,
        };
        notify();
      },
      (e) => err("user doc subscription failed", e)
    );
  }

  /**
   * Core ledger transaction. type: 'earn' | 'spend'.
   * extras: additional fields merged into the log entry.
   * userExtras: additional fields merged into the user doc update
   *             (used by games for gamesPlayed counters).
   */
  function applyPoints(type, amount, extras, userExtras) {
    amount = Math.round(Number(amount));
    if (!(amount > 0 && amount < 1000)) {
      return Promise.reject(new Error("invalid amount"));
    }
    const userRef = db.collection("users").doc(uid);
    const logRef = userRef.collection("points-log").doc(); // fresh id
    const FV = window.firebase.firestore.FieldValue;

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const d = snap.data() || {};
      const bal = Number(d.pointsBalance) || 0;
      const earned = Number(d.pointsEarned) || 0;
      const spent = Number(d.pointsSpent) || 0;

      if (type === "spend" && bal < amount) {
        throw new Error("insufficient");
      }

      tx.set(logRef, {
        type: type,
        amount: amount,
        reason: (extras && extras.reason) || "",
        gameType: (extras && extras.gameType) || null,
        rewardId: (extras && extras.rewardId) || null,
        createdAt: FV.serverTimestamp(),
      });

      const update = {
        pointsBalance: type === "earn" ? bal + amount : bal - amount,
        pointsEarned: type === "earn" ? earned + amount : earned,
        pointsSpent: type === "spend" ? spent + amount : spent,
        lastPointsLogId: logRef.id,
      };
      if (userExtras) Object.assign(update, userExtras);
      tx.update(userRef, update);
      return update.pointsBalance;
    }).then((newBal) => {
      log(type, amount, "→ balance", newBal);
      return newBal;
    });
  }

  /* ---------------- boot ---------------- */

  async function init() {
    if (!window.BubbsFirebase || !window.BubbsFirebase.ready) {
      err("firebase missing — points disabled");
      return;
    }
    let ctx;
    try {
      ctx = await window.BubbsFirebase.ready;
    } catch (e) {
      err("firebase not ready — points disabled", e);
      return;
    }
    db = ctx.db;
    uid = ctx.uid;
    try {
      await ensureUserDoc();
    } catch (e) {
      err("ensureUserDoc failed", e);
    }
    subscribe();
    resolveReady({ uid: uid });
  }

  // Badge follows role: child mode only (same rule as the nav).
  window.addEventListener("bubbs:role-ready", (ev) => {
    const role = ev && ev.detail ? ev.detail.role : null;
    setBadgeVisible(role === "child");
  });

  window.BubbsPoints = {
    ready: ready,
    getBalance: function () { return state.balance; },
    earn: function (amount, reason, gameType, userExtras) {
      return applyPoints("earn", amount, { reason: reason, gameType: gameType }, userExtras);
    },
    spend: function (amount, reason, rewardId) {
      return applyPoints("spend", amount, { reason: reason, rewardId: rewardId });
    },
    onChange: function (cb) { if (typeof cb === "function") listeners.push(cb); },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

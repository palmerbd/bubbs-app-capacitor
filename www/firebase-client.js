/**
 * Bubbs-Talks Firebase Web SDK client — V1-B (commit batch 5).
 *
 * This file boots the Firebase JavaScript SDK inside Capacitor's
 * WKWebView. It does NOT use the @capacitor-firebase/* native plugins
 * (those are for batch 5.5, which adds push-notification reception on
 * iOS — getting an FCM token in the WKWebView isn't possible without
 * the native plugin).
 *
 * What ships in batch 5:
 *   - Anonymous auth (so each device gets a stable uid for security rules)
 *   - Firestore reads/writes (cross-device pairing handshake + child
 *     speak-fanout writes)
 *
 * What's still stubbed in batch 5:
 *   - Push notifications on the parent device. The cloud function
 *     onMessageCreated will fire for new /messages docs and try to
 *     send to FCM tokens stored in /pairings/{childUid}/devices/{...}.
 *     But until batch 5.5, the parent device can't register a real FCM
 *     token, so the cloud function will skip sends to "stub:" tokens
 *     and the parent will only see incoming messages by Firestore
 *     subscription (in-app foreground) — not by OS push.
 *
 * Public API on window.BubbsFirebase:
 *   - ready: Promise<{ uid, app, auth, db }>  resolves after sign-in
 *   - uid: string | null                       (current user's uid)
 *   - signOut(): Promise<void>                 (used by data-controls)
 *
 * Other modules (pairing-firestore.js, fanout-client.js) await
 * BubbsFirebase.ready before issuing reads/writes.
 */
(function () {
  "use strict";

  const log = (...args) => console.log("[firebase]", ...args);
  const err = (...args) => console.error("[firebase]", ...args);

  function isReady() {
    return (
      window.firebase &&
      window.firebase.initializeApp &&
      window.firebase.auth &&
      window.firebase.firestore
    );
  }

  /**
   * Upsert the DeviceDoc at /devices/{deviceId} so the cloud function
   * `onMessageCreated` can look up this device's pushToken when a
   * paired peer addresses a message to us.
   *
   * Shape matches bubbs-app/packages/shared/src/firestore.ts DeviceDoc:
   *   { deviceId, role, displayName, pushToken, updatedAt, platform, ownerUid }
   *
   * Phase 1 ships pushToken="stub:..." because Capacitor's WKWebView
   * can't mint a real FCM token without the @capacitor-firebase/messaging
   * native plugin (arrives in batch 5.5). That's fine — the cloud
   * function's isDeliverableToken() filter ignores stubs without
   * blowing up.
   */
  async function upsertDeviceDoc(db, ownerUid) {
    const codec = window.BubbsPairingCodec;
    if (!codec) return;
    const deviceId = codec.getOrCreateDeviceId();

    // Firestore rules require role in ['child','parent']. Skip the write
    // until BubbsRole has resolved; we listen for `bubbs:role-ready`
    // below to retry the upsert once the user has picked a role.
    let role = null;
    try {
      role = (window.BubbsRole && window.BubbsRole.get()) || null;
    } catch (e) {}
    if (role !== "child" && role !== "parent") {
      log("DeviceDoc upsert deferred — role not yet selected");
      return;
    }

    let displayName = "Bubbs device";
    try {
      const raw = localStorage.getItem("bubbs-settings");
      if (raw) {
        const s = JSON.parse(raw);
        if (s && typeof s.studentName === "string" && s.studentName.trim()) {
          displayName = s.studentName.trim();
        }
      }
    } catch (e) {}

    let pushToken;
    try {
      pushToken = localStorage.getItem("bubbs-fcm-token") || "stub:" + codec.generateNonce();
    } catch (e) {
      pushToken = "stub:web";
    }

    const docRef = db.collection("devices").doc(deviceId);
    try {
      await docRef.set(
        {
          deviceId: deviceId,
          role: role,
          displayName: displayName,
          pushToken: pushToken,
          platform: "ios", // Capacitor wraps WKWebView on iOS; web is a sub-case.
          ownerUid: ownerUid,
          updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (e) {
      err("DeviceDoc set failed", e);
    }
  }

  /** Wait up to N seconds for the Firebase SDK CDN scripts to load. */
  function waitForSdk(timeoutMs) {
    if (typeof timeoutMs !== "number") timeoutMs = 8000;
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function tick() {
        if (isReady()) return resolve();
        if (Date.now() - start > timeoutMs)
          return reject(new Error("Firebase SDK did not load within " + timeoutMs + "ms"));
        setTimeout(tick, 100);
      })();
    });
  }

  async function init() {
    if (!window.BubbsConfig || !window.BubbsConfig.firebase) {
      log("config missing — Firebase disabled (running in degraded local-only mode)");
      window.BubbsFirebase = {
        ready: Promise.reject(new Error("BubbsConfig.firebase missing")),
        uid: null,
        signOut: function () { return Promise.resolve(); },
      };
      return;
    }

    try {
      await waitForSdk();
    } catch (e) {
      err("SDK script load timeout", e);
      window.BubbsFirebase = {
        ready: Promise.reject(e),
        uid: null,
        signOut: function () { return Promise.resolve(); },
      };
      return;
    }

    const fb = window.firebase;
    let app;
    try {
      app = fb.initializeApp(window.BubbsConfig.firebase);
    } catch (e) {
      // initializeApp throws if already initialized (e.g., on a soft
      // reload during dev). Reuse the existing default app in that case.
      app = fb.app();
    }

    const auth = fb.auth();
    const db = fb.firestore();

    let resolveReady;
    const ready = new Promise((res) => { resolveReady = res; });

    let uid = null;
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        uid = user.uid;
        window.BubbsFirebase.uid = uid;
        log("anon-auth uid:", uid);
        // Try to upsert now (no-op if role isn't selected yet).
        try { await upsertDeviceDoc(db, uid); } catch (e) { err("upsertDeviceDoc failed", e); }
        resolveReady({ uid: uid, app: app, auth: auth, db: db });
        window.dispatchEvent(new CustomEvent("bubbs:firebase-ready", { detail: { uid: uid } }));
      }
    });

    // Retry the upsert once the user has chosen a role. role-select.js
    // dispatches `bubbs:role-ready` after the chooser closes (or after
    // a stored role is rehydrated). At that point we have everything
    // we need to satisfy the Firestore rules' deviceIsWellFormed check.
    window.addEventListener("bubbs:role-ready", async () => {
      if (!uid) return;
      try { await upsertDeviceDoc(db, uid); } catch (e) { err("upsertDeviceDoc on role-ready failed", e); }
    });

    try {
      await auth.signInAnonymously();
    } catch (e) {
      err("signInAnonymously failed", e);
      // ready will never resolve — consumers should also listen for
      // their own timeouts or fall back to local-only mode.
    }

    window.BubbsFirebase = {
      ready: ready,
      uid: uid,
      app: app,
      auth: auth,
      db: db,
      signOut: function () {
        try {
          return auth.signOut();
        } catch (e) {
          return Promise.resolve();
        }
      },
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

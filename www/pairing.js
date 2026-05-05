/**
 * Bubbs-Talks pairing UI — V1-B (commit batch 4).
 *
 * Two flows live in this file:
 *
 *   Child side (caregiver panel button "Show pairing code")
 *     → generate fresh payload (deviceId, name, push token)
 *     → render QR code + 6-digit fallback
 *     → poll Firestore for the parent's claim (wired in batch 5)
 *
 *   Parent side (parent shell "Pair with child's device" button)
 *     → choose between:
 *         (a) Scan QR with camera (live preview, batch 5)
 *         (b) Enter 6-digit code manually
 *     → call BubbsFanout.completePairing(payload) (batch 5)
 *
 * For batch 4 we ship the UI, codec, QR rendering, and 6-digit
 * derivation — the actual Firestore handshake stubs out by writing the
 * payload to localStorage so each side knows it's "paired" locally.
 * Real cross-device pairing arrives in batch 5 alongside Firebase init.
 *
 * QR rendering uses the qrcode-generator library loaded from CDN in
 * index.html. QR scanning is deferred — for now the parent enters the
 * 6-digit code manually. Adding live camera scan needs:
 *   1. NSCameraUsageDescription in the iOS Info.plist
 *   2. getUserMedia + jsQR loop, OR @capacitor-community/barcode-scanner
 * Both are scheduled for the batch 4.5 follow-up.
 */
(function () {
  "use strict";

  const log = (...args) => console.log("[pairing]", ...args);

  function el(id) { return document.getElementById(id); }

  function show(id) {
    const e = el(id);
    if (e) e.classList.add("open");
  }
  function hide(id) {
    const e = el(id);
    if (e) e.classList.remove("open");
  }

  /* ----------------------------------------------------------------
   * Child: generate + display QR
   * ---------------------------------------------------------------- */

  async function showChildPairingCode() {
    const codec = window.BubbsPairingCodec;
    if (!codec) {
      alert("Pairing module not loaded. Try restarting the app.");
      return;
    }

    // Resolve the child's device-display name. Prefer the caregiver-set
    // student name, fall back to a generic device label.
    let deviceName = "Bubbs device";
    try {
      const settingsRaw = localStorage.getItem("bubbs-settings");
      if (settingsRaw) {
        const settings = JSON.parse(settingsRaw);
        if (settings && typeof settings.studentName === "string" && settings.studentName.trim()) {
          deviceName = settings.studentName.trim() + "'s iPad";
        }
      }
    } catch (e) {}

    // Push token (FCM) is populated by batch 5. For batch 4 we use a
    // stub so the QR roundtrips correctly through encode/decode.
    const pushToken = (function () {
      try {
        const t = localStorage.getItem("bubbs-fcm-token");
        if (t) return t;
      } catch (e) {}
      return "stub:" + codec.generateNonce();
    })();

    const payload = codec.buildFreshPayload({
      d: codec.getOrCreateDeviceId(),
      n: deviceName,
      k: pushToken,
    });
    const encoded = codec.encodePairingPayload(payload);
    const code = await codec.deriveSixDigitCode(payload);

    // Persist the latest payload locally so the parent's "manual code"
    // entry can verify against it (batch 4 stub) — real Firestore-based
    // verification arrives in batch 5.
    try {
      localStorage.setItem("bubbs-active-pairing-payload", encoded);
      localStorage.setItem("bubbs-active-pairing-code", code);
      localStorage.setItem("bubbs-active-pairing-iat", String(payload.iat));
    } catch (e) {}

    renderChildPairingScreen(encoded, code, deviceName);
  }

  function renderChildPairingScreen(qrText, sixDigit, deviceName) {
    const container = ensureChildPairingScreen();
    container.querySelector(".cp-name").textContent = deviceName;
    container.querySelector(".cp-code").textContent =
      sixDigit.slice(0, 3) + " " + sixDigit.slice(3);

    const qrHost = container.querySelector(".cp-qr");
    qrHost.innerHTML = "";

    if (typeof qrcode === "function") {
      try {
        // Type number 0 = auto-detect minimum size for the data length.
        const q = qrcode(0, "M");
        q.addData(qrText);
        q.make();
        qrHost.innerHTML = q.createSvgTag({ scalable: true });
        const svg = qrHost.querySelector("svg");
        if (svg) {
          svg.setAttribute("width", "100%");
          svg.setAttribute("height", "100%");
        }
      } catch (e) {
        log("qrcode render failed", e);
        qrHost.textContent = "QR generation failed. Use the 6-digit code below.";
      }
    } else {
      log("qrcode library missing — falling back to 6-digit code only");
      qrHost.textContent = "QR not available. Enter the 6-digit code on the parent device.";
    }

    show("child-pairing-screen");
  }

  function ensureChildPairingScreen() {
    let s = el("child-pairing-screen");
    if (s) return s;
    s = document.createElement("div");
    s.id = "child-pairing-screen";
    s.setAttribute("role", "dialog");
    s.setAttribute("aria-modal", "true");
    s.innerHTML =
      '<div class="cp-card">' +
        '<h2>Pair this iPad</h2>' +
        '<div class="cp-tagline">On the parent\'s phone, open Bubbs &rsaquo; Parent &rsaquo; Pair, then either scan this QR or type the 6-digit code.</div>' +
        '<div class="cp-name">Bubbs device</div>' +
        '<div class="cp-qr"></div>' +
        '<div class="cp-code"></div>' +
        '<div class="cp-hint">Code is good for 5 minutes. Tap Refresh for a new one.</div>' +
        '<div class="cp-actions">' +
          '<button class="cp-refresh" type="button">Refresh</button>' +
          '<button class="cp-close" type="button">Close</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(s);

    s.querySelector(".cp-refresh").addEventListener("click", showChildPairingCode);
    s.querySelector(".cp-close").addEventListener("click", () => hide("child-pairing-screen"));

    return s;
  }

  /* ----------------------------------------------------------------
   * Parent: manual 6-digit entry
   * ---------------------------------------------------------------- */

  function startScan() {
    show("parent-pairing-screen");
    ensureParentPairingScreen();
  }

  function ensureParentPairingScreen() {
    let s = el("parent-pairing-screen");
    if (s) return s;
    s = document.createElement("div");
    s.id = "parent-pairing-screen";
    s.setAttribute("role", "dialog");
    s.setAttribute("aria-modal", "true");
    s.innerHTML =
      '<div class="pp-card">' +
        '<h2>Pair with child\'s iPad</h2>' +
        '<div class="pp-tagline">Open Bubbs on the child\'s iPad, tap the gear icon, then "Show pairing code".</div>' +
        '<div class="pp-input-row">' +
          '<input type="tel" inputmode="numeric" pattern="[0-9]*" maxlength="7" id="pp-code-input" placeholder="123 456" />' +
        '</div>' +
        '<button class="pp-submit" id="pp-submit-btn" type="button">Pair</button>' +
        '<div class="pp-status" id="pp-status"></div>' +
        '<div class="pp-hint">Camera-based scanning is coming in the next update.</div>' +
        '<button class="pp-close" id="pp-close-btn" type="button">Cancel</button>' +
      '</div>';
    document.body.appendChild(s);

    s.querySelector("#pp-close-btn").addEventListener("click", () => hide("parent-pairing-screen"));
    s.querySelector("#pp-submit-btn").addEventListener("click", submitParentCode);
    s.querySelector("#pp-code-input").addEventListener("keypress", (e) => {
      if (e.key === "Enter") submitParentCode();
    });

    return s;
  }

  async function submitParentCode() {
    const codec = window.BubbsPairingCodec;
    const input = el("pp-code-input");
    const status = el("pp-status");
    if (!codec || !input || !status) return;

    const raw = (input.value || "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(raw)) {
      status.textContent = "Enter the 6-digit code shown on the child's iPad.";
      return;
    }

    status.textContent = "Verifying…";

    // Batch 4 stub: in a real cross-device flow the parent device
    // doesn't have access to the child's localStorage. Batch 5 swaps
    // this for a Firestore lookup of /pairing-codes/{sixDigit} that
    // the child writes when generating a code.
    //
    // For batch 4 we still demonstrate the UX end-to-end on a SINGLE
    // device (e.g., during initial sandbox testing) by validating
    // against the locally-stored code.
    try {
      const expected = localStorage.getItem("bubbs-active-pairing-code");
      const payloadRaw = localStorage.getItem("bubbs-active-pairing-payload");
      if (!expected || !payloadRaw) {
        status.textContent =
          "Pairing not yet supported across devices in this build. Update both devices to the next TestFlight build.";
        return;
      }
      if (raw !== expected) {
        status.textContent = "That code doesn't match. Double-check or refresh on the child's iPad.";
        return;
      }
      const payload = codec.decodePairingPayload(payloadRaw);
      if (!payload) {
        status.textContent = "Code expired. Refresh the code on the child's iPad and try again.";
        return;
      }

      // Persist the parent-side "I'm paired with this child device" record.
      localStorage.setItem("bubbs-paired-with", JSON.stringify(payload));
      status.textContent = "Paired with " + payload.n + ". Closing…";
      setTimeout(() => {
        hide("parent-pairing-screen");
        window.dispatchEvent(
          new CustomEvent("bubbs:paired", { detail: { payload } })
        );
      }, 800);
    } catch (e) {
      log("submitParentCode failed", e);
      status.textContent = "Something went wrong. Try again or refresh the code.";
    }
  }

  /* ----------------------------------------------------------------
   * Public API
   * ---------------------------------------------------------------- */
  window.BubbsPairing = {
    showChildPairingCode: showChildPairingCode,
    startScan: startScan,
    isPaired: function () {
      try {
        return !!localStorage.getItem("bubbs-paired-with");
      } catch (e) {
        return false;
      }
    },
    getPairing: function () {
      try {
        const raw = localStorage.getItem("bubbs-paired-with");
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
    unpair: function () {
      try {
        localStorage.removeItem("bubbs-paired-with");
      } catch (e) {}
    },
  };
})();

/**
 * Bubbs-Talks pairing codec — V1-B (commit batch 4).
 *
 * Plain-JS port of bubbs-app/apps/mobile/src/pairing.ts with the same
 * security model and v2 schema. Used by both ends of the pairing flow:
 *
 *   - Child device:  buildFreshPayload(...) → encodePairingPayload(...) → QR string
 *   - Parent device: decodePairingPayload(qrString) → validates freshness
 *
 * No pre-shared secret at pair time, so this isn't HMAC-signed. The
 * mitigations are:
 *   - QR is scanned optically off the caregiver's own screen (no
 *     on-the-wire MITM).
 *   - v2 includes iat + nonce; decoder rejects QRs older than 5 minutes.
 *   - Post-pair, Firestore rules check anonymous-auth uid against
 *     DeviceDoc.ownerUid (wired in batch 5).
 *
 * The codec is exposed on window.BubbsPairingCodec so pairing.js,
 * fanout-client.js, and tests can all reuse it.
 */
(function () {
  "use strict";

  const QR_MAX_AGE_MS = 5 * 60 * 1000;

  function generateNonce() {
    const bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /**
   * Build a fresh v2 payload with iat=now and a random nonce.
   * @param {{ d: string, n: string, k: string }} base
   * @returns {{ v: 2, d: string, n: string, k: string, iat: number, nonce: string }}
   */
  function buildFreshPayload(base) {
    return {
      v: 2,
      d: base.d,
      n: base.n,
      k: base.k,
      iat: Date.now(),
      nonce: generateNonce(),
    };
  }

  function encodePairingPayload(payload) {
    return JSON.stringify(payload);
  }

  function decodePairingPayload(raw, now) {
    if (typeof now !== "number") now = Date.now();
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    if (!obj || typeof obj !== "object") return null;
    if (obj.v !== 1 && obj.v !== 2) return null;
    if (typeof obj.d !== "string" || typeof obj.n !== "string" || typeof obj.k !== "string") {
      return null;
    }
    if (obj.v === 2) {
      if (typeof obj.iat !== "number" || !isFinite(obj.iat)) return null;
      if (typeof obj.nonce !== "string" || obj.nonce.length === 0) return null;
      const age = now - obj.iat;
      if (age < -60000) return null; // future > 1 min: clock skew
      if (age > QR_MAX_AGE_MS) return null; // stale > 5 min
    }
    const out = { v: obj.v, d: obj.d, n: obj.n, k: obj.k };
    if (obj.v === 2) {
      out.iat = obj.iat;
      out.nonce = obj.nonce;
    }
    return out;
  }

  /**
   * Derive a 6-digit numeric code from the QR payload, used as the
   * manual-entry fallback when QR scanning fails (camera permission
   * denied, glare, etc.).
   *
   * The code is the last 6 decimal digits of an SHA-256 hash of the
   * payload's deviceId + nonce. This is deterministic — both ends can
   * compute the same digits from the same payload.
   *
   * Returns a Promise<string>.
   */
  async function deriveSixDigitCode(payload) {
    const enc = new TextEncoder();
    const data = enc.encode(payload.d + ":" + payload.nonce);
    const hashBuf = await window.crypto.subtle.digest("SHA-256", data);
    const view = new DataView(hashBuf);
    // Read 4 bytes from offset 28 (last 32 bits of the hash).
    const u32 = view.getUint32(28, false);
    return String(u32 % 1000000).padStart(6, "0");
  }

  /**
   * Get-or-mint the persistent child-device id stored in localStorage.
   * Used by the child side to populate `d` in the QR payload.
   */
  function getOrCreateDeviceId() {
    try {
      let id = localStorage.getItem("bubbs-device-id");
      if (!id) {
        const bytes = new Uint8Array(16);
        if (window.crypto && window.crypto.getRandomValues) {
          window.crypto.getRandomValues(bytes);
        }
        let hex = "";
        for (let i = 0; i < bytes.length; i++) {
          hex += bytes[i].toString(16).padStart(2, "0");
        }
        id = "device-" + hex;
        localStorage.setItem("bubbs-device-id", id);
      }
      return id;
    } catch (e) {
      return "device-anonymous-" + Math.random().toString(16).slice(2);
    }
  }

  window.BubbsPairingCodec = {
    QR_MAX_AGE_MS: QR_MAX_AGE_MS,
    buildFreshPayload: buildFreshPayload,
    encodePairingPayload: encodePairingPayload,
    decodePairingPayload: decodePairingPayload,
    deriveSixDigitCode: deriveSixDigitCode,
    getOrCreateDeviceId: getOrCreateDeviceId,
    generateNonce: generateNonce,
  };
})();

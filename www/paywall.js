/**
 * Bubbs-Talks paywall logic.
 *
 * STUB VERSION — full RevenueCat integration ships in the next commit
 * once Don pastes his iOS API key into config.js. For now this file
 * just verifies that config.js loaded and decides whether to even
 * attempt to show the paywall.
 *
 * Behavior matrix:
 *   - config not loaded → log, do nothing (current TestFlight behavior preserved)
 *   - keys still placeholder → log, do nothing (current behavior preserved)
 *   - keys real + devBypassPaywall=true → log, do nothing
 *   - keys real + devBypassPaywall=false → (next commit) show paywall, init RevenueCat
 *
 * This means committing this file is SAFE — it won't break the existing
 * TestFlight build. Build 1.0 (106) keeps working unchanged. Once Don
 * fills in real keys and we ship the next commit's logic, the paywall
 * activates.
 */
(function () {
  "use strict";

  const log = (...args) => console.log("[paywall]", ...args);

  function init() {
    if (!window.BubbsConfig) {
      log("config.js did not load — paywall disabled");
      return;
    }
    if (!window.BubbsConfig.isFullyConfigured()) {
      log("config has placeholder values — paywall disabled until real keys land");
      return;
    }
    if (window.BubbsConfig.devBypassPaywall) {
      log("devBypassPaywall=true — paywall skipped (NEVER ship to App Store with this on)");
      return;
    }
    log("real keys detected — paywall logic will be wired in next commit");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

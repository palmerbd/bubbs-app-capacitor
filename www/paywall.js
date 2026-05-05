/**
 * Bubbs-Talks paywall logic — V1-B (commit batch 2).
 *
 * Boot sequence:
 *   1. config.js loaded → real RC keys present → init RevenueCat SDK
 *   2. fetch active entitlements
 *   3. if `caregiver` entitlement is active → hide paywall + dispatch
 *      `bubbs:paywall-pass` (the AAC board listens and boots itself)
 *   4. else → show paywall, fetch offerings, wire Start / Restore buttons
 *   5. on successful purchase → dispatch `bubbs:paywall-pass`
 *
 * All of this is no-op safe: if the RevenueCat plugin is missing (e.g.
 * running in the iOS simulator without Capacitor, or in a desktop
 * preview), the paywall stays open with a "Subscription unavailable"
 * message and the app stays gated. That's fine — production iOS builds
 * always have the plugin compiled in.
 *
 * Don bypass: window.BubbsConfig.devBypassPaywall === true skips
 * everything. The codemagic build script greps for this and refuses to
 * publish if it's true. Safe for local development only.
 */
(function () {
  "use strict";

  const log = (...args) => console.log("[paywall]", ...args);
  const err = (...args) => console.error("[paywall]", ...args);

  function dispatchPass() {
    window.dispatchEvent(new CustomEvent("bubbs:paywall-pass"));
  }

  function showScreen() {
    const screen = document.getElementById("paywall-screen");
    if (screen) {
      screen.classList.remove("closed");
      screen.classList.add("open");
    }
  }

  function hideScreen() {
    const screen = document.getElementById("paywall-screen");
    if (screen) {
      screen.classList.remove("open");
      screen.classList.add("closed");
    }
  }

  function setStatus(text) {
    const el = document.getElementById("paywall-status");
    if (el) el.textContent = text || "";
  }

  function setBusy(busy) {
    const buttons = document.querySelectorAll("#paywall-screen button");
    buttons.forEach((b) => (b.disabled = !!busy));
  }

  async function init() {
    // Bypass guards.
    if (!window.BubbsConfig) {
      err("config.js did not load — leaving paywall hidden, app boots free");
      hideScreen();
      dispatchPass();
      return;
    }
    if (!window.BubbsConfig.isFullyConfigured()) {
      log("config has placeholder values — paywall disabled");
      hideScreen();
      dispatchPass();
      return;
    }
    if (window.BubbsConfig.devBypassPaywall) {
      log("devBypassPaywall=true — paywall skipped (NEVER ship this on)");
      hideScreen();
      dispatchPass();
      return;
    }

    // Capacitor/RevenueCat plugin available?
    const Plugins =
      (window.Capacitor && window.Capacitor.Plugins) || {};
    const Purchases = Plugins.Purchases;
    if (!Purchases) {
      log("RevenueCat plugin not available — paywall blocks app");
      showScreen();
      setStatus(
        "Subscription system unavailable. Reinstall the app or contact support@bubbs-app.com."
      );
      return;
    }

    // Show the paywall while we check entitlement.
    showScreen();
    setStatus("Checking your subscription…");
    setBusy(true);

    try {
      await Purchases.setLogLevel({ level: "INFO" });
      await Purchases.configure({
        apiKey: window.BubbsConfig.revenueCatApiKey,
      });
    } catch (e) {
      err("configure failed", e);
      setStatus("Could not start the subscription system. Try again later.");
      setBusy(false);
      return;
    }

    // 1. Active entitlement → pass through.
    const entitlementId = window.BubbsConfig.revenueCatEntitlement;
    let customerInfo;
    try {
      const res = await Purchases.getCustomerInfo();
      customerInfo = res.customerInfo || res;
    } catch (e) {
      err("getCustomerInfo failed", e);
      customerInfo = null;
    }

    if (
      customerInfo &&
      customerInfo.entitlements &&
      customerInfo.entitlements.active &&
      customerInfo.entitlements.active[entitlementId] &&
      customerInfo.entitlements.active[entitlementId].isActive
    ) {
      log("active entitlement found — passing through");
      hideScreen();
      dispatchPass();
      return;
    }

    // 2. No entitlement → fetch offerings and wire buttons.
    let monthly = null;
    try {
      const res = await Purchases.getOfferings();
      const offerings = res.offerings || res;
      const current = offerings.current || offerings;
      const packages =
        (current && current.availablePackages) ||
        (current && current.packages) ||
        [];
      monthly =
        packages.find(
          (p) =>
            p.packageType === "MONTHLY" ||
            p.identifier === "$rc_monthly" ||
            p.identifier === "monthly"
        ) || packages[0];
    } catch (e) {
      err("getOfferings failed", e);
    }

    if (!monthly) {
      setStatus(
        "Subscription is unavailable right now. Please try again later."
      );
      setBusy(false);
      return;
    }

    setStatus("");
    setBusy(false);
    const trialBtn = document.getElementById("paywall-start-trial");
    const restoreBtn = document.getElementById("paywall-restore");

    if (trialBtn) {
      trialBtn.addEventListener("click", async () => {
        setBusy(true);
        setStatus("Loading purchase sheet…");
        try {
          const result = await Purchases.purchasePackage({
            aPackage: monthly,
          });
          const info = result.customerInfo || result;
          if (
            info &&
            info.entitlements &&
            info.entitlements.active &&
            info.entitlements.active[entitlementId] &&
            info.entitlements.active[entitlementId].isActive
          ) {
            hideScreen();
            dispatchPass();
          } else {
            setStatus("Purchase did not complete. Please try again.");
            setBusy(false);
          }
        } catch (e) {
          if (e && (e.userCancelled || e.code === "1")) {
            setStatus("");
          } else {
            err("purchasePackage failed", e);
            setStatus(
              "Purchase failed: " + (e && e.message ? e.message : "unknown error")
            );
          }
          setBusy(false);
        }
      });
    }

    if (restoreBtn) {
      restoreBtn.addEventListener("click", async () => {
        setBusy(true);
        setStatus("Restoring your subscription…");
        try {
          const res = await Purchases.restorePurchases();
          const info = res.customerInfo || res;
          if (
            info &&
            info.entitlements &&
            info.entitlements.active &&
            info.entitlements.active[entitlementId] &&
            info.entitlements.active[entitlementId].isActive
          ) {
            hideScreen();
            dispatchPass();
          } else {
            setStatus(
              "No active subscription was found on this Apple ID. Tap Start Free Trial to subscribe."
            );
            setBusy(false);
          }
        } catch (e) {
          err("restorePurchases failed", e);
          setStatus(
            "Restore failed: " + (e && e.message ? e.message : "unknown error")
          );
          setBusy(false);
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

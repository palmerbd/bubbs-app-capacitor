/**
 * Bubbs-Talks runtime configuration.
 *
 * These are CLIENT-SIDE PUBLIC keys — designed to ship in the iOS app
 * binary. They're protected by Firebase Security Rules + AppCheck and
 * RevenueCat's server-side receipt validation. Safe to commit.
 *
 * Don to fill in the placeholder values below before the next build.
 */
window.BubbsConfig = {
  // RevenueCat iOS public SDK key. Starts with `appl_`.
  // Find at: https://app.revenuecat.com → Project settings → API keys → Apple App Store row.
  revenueCatApiKey: "appl_htrVigSLYHunYWRTPYaMPbhMUMw",

  // Entitlement identifier configured in RevenueCat.
  // Find at: https://app.revenuecat.com → Entitlements.
  revenueCatEntitlement: "caregiver",

  // Firebase web app config — copy/paste from Firebase Console → Project settings → Your apps → Web → Config.
  firebase: {
    apiKey: "AIzaSyB1dLZnpQDx6lHFTCDi_7Jlt_mQ3etWOMY",
    authDomain: "bubbs-app-prod.firebaseapp.com",
    projectId: "bubbs-app-prod",
    storageBucket: "bubbs-app-prod.firebasestorage.app",
    messagingSenderId: "103336467618",
    appId: "1:103336467618:web:ac218dcbf62fc08949cbfb",
  },

  // Set to true to bypass the paywall during development. MUST be false
  // in shipped builds — the App Store review will reject if the paywall
  // can be skipped. The build script in codemagic.yaml verifies this.
  devBypassPaywall: false,
};

/** True when both RevenueCat + Firebase are configured with real values. */
window.BubbsConfig.isFullyConfigured = function () {
  const rc = this.revenueCatApiKey;
  const fb = this.firebase.apiKey;
  return (
    typeof rc === "string" &&
    rc.startsWith("appl_") &&
    typeof fb === "string" &&
    fb.startsWith("AIza")
  );
};

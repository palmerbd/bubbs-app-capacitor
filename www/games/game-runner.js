/**
 * Bubbs-Talks shared game infrastructure — V2 (batch V2-3).
 *
 * Owns the Games tab: a launcher grid of registered games, the shared
 * session shell (round header, caregiver Skip, quit), celebration and
 * wrong-answer feedback, the score screen, and session bookkeeping
 * (game-sessions doc + BubbsPoints.earn with gamesPlayed counters).
 *
 * Games register themselves:
 *   window.BubbsGames.register({
 *     id: "match-word-picture",
 *     name: "Match the Word",
 *     emoji: "🍎",
 *     description: "Tap the picture that matches the word",
 *     start(api) { ... }   // api = the session api below
 *   });
 *
 * Session api handed to start():
 *   api.stage             — DOM element to render the game into
 *   api.setProgress(text) — header label ("Round 2 of 5")
 *   api.speak(text)       — TTS with the caregiver-selected voice
 *   api.celebrate(text)   — chime + confetti + spoken praise
 *   api.wrong(el)         — wobble an element, gentle "try again"
 *   api.onSkip(cb)        — caregiver Skip button pressed
 *   api.end({rounds, perfectRounds, totalRounds}) — finish session,
 *        awards points by the shared scoring ladder and shows the
 *        score screen. Returns the awarded amount.
 *
 * Scoring ladder (BUBBS-V2-GAMES-DESIGN.md): perfect = 10, one miss
 * = 7, two misses = 5, else 3. Category Sort passes its own override.
 */
(function () {
  "use strict";

  const log = (...args) => console.log("[games]", ...args);
  const err = (...args) => console.error("[games]", ...args);

  const games = [];
  let activeGame = null;
  let skipCb = null;
  let sessionStartedAt = null;

  function el(id) { return document.getElementById(id); }

  /* ---------------- vocab access (shared with the AAC board) ---------------- */

  // The AAC board's inline script defines DEFAULT_VOCAB + state (with the
  // caregiver-customized vocab). Both are top-level lexical globals, so we
  // reach them via an indirect eval-safe typeof check at call time.
  function getVocab() {
    try {
      if (typeof state !== "undefined" && state && state.vocab) return state.vocab;
    } catch (e) {}
    try {
      if (typeof DEFAULT_VOCAB !== "undefined") return DEFAULT_VOCAB;
    } catch (e) {}
    return null;
  }

  /* ---------------- speech ---------------- */

  function speak(text) {
    if (!window.speechSynthesis || !text) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      try {
        const raw = localStorage.getItem("talk-settings-v2");
        if (raw) {
          const s = JSON.parse(raw);
          const voices = window.speechSynthesis.getVoices();
          const v = voices.find((v) => v.voiceURI === s.voiceURI);
          if (v) u.voice = v;
          if (s.rate) u.rate = s.rate;
        }
      } catch (e) {}
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  /* ---------------- feedback: chime, confetti, wobble ---------------- */

  let audioCtx = null;
  function chime(kind) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const notes = kind === "big" ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 880];
      notes.forEach((freq, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = "sine";
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.001, audioCtx.currentTime + i * 0.09);
        g.gain.exponentialRampToValueAtTime(0.18, audioCtx.currentTime + i * 0.09 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * 0.09 + 0.35);
        o.connect(g).connect(audioCtx.destination);
        o.start(audioCtx.currentTime + i * 0.09);
        o.stop(audioCtx.currentTime + i * 0.09 + 0.4);
      });
    } catch (e) {}
  }

  const reduceMotion = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function confetti() {
    if (reduceMotion()) return;
    const host = el("game-session-view") || document.body;
    const emojis = ["🎉", "⭐", "✨", "🎈", "💛"];
    for (let i = 0; i < 14; i++) {
      const p = document.createElement("span");
      p.className = "game-confetti";
      p.textContent = emojis[i % emojis.length];
      p.style.left = 10 + Math.random() * 80 + "%";
      p.style.animationDelay = Math.random() * 0.25 + "s";
      p.style.fontSize = 18 + Math.random() * 18 + "px";
      host.appendChild(p);
      setTimeout(() => p.remove(), 1600);
    }
  }

  function celebrate(praiseText) {
    chime("small");
    confetti();
    if (praiseText) setTimeout(() => speak(praiseText), 150);
  }

  function wrong(target) {
    if (target && target.classList && !reduceMotion()) {
      target.classList.remove("game-wobble");
      void target.offsetWidth; // restart animation
      target.classList.add("game-wobble");
    }
  }

  /* ---------------- launcher ---------------- */

  function renderLauncher() {
    const host = el("games-launcher");
    if (!host) return;
    host.innerHTML = "";
    games.forEach((g) => {
      const card = document.createElement("button");
      card.className = "game-card";
      card.setAttribute("aria-label", "Play " + g.name);
      card.innerHTML =
        '<span class="game-card-emoji">' + g.emoji + "</span>" +
        '<span class="game-card-name">' + g.name + "</span>" +
        '<span class="game-card-desc">' + (g.description || "") + "</span>" +
        '<span class="game-card-play">▶ Play</span>';
      card.addEventListener("click", () => startGame(g));
      host.appendChild(card);
    });
    if (!games.length) {
      host.innerHTML = '<div class="learn-empty"><div class="learn-empty-emoji">🎮</div><p>Games are coming soon!</p></div>';
    }
  }

  /* ---------------- session shell ---------------- */

  function startGame(g) {
    activeGame = g;
    skipCb = null;
    sessionStartedAt = new Date();
    el("games-launcher").style.display = "none";
    el("game-score-view").style.display = "none";
    const shell = el("game-session-view");
    shell.style.display = "flex";
    el("game-progress").textContent = "";
    el("game-stage").innerHTML = "";
    log("session start:", g.id);
    try {
      g.start(api);
    } catch (e) {
      err("game crashed on start", e);
      exitToLauncher();
    }
  }

  function exitToLauncher() {
    activeGame = null;
    skipCb = null;
    el("game-session-view").style.display = "none";
    el("game-score-view").style.display = "none";
    el("games-launcher").style.display = "";
  }

  function scoreFor(perfectRounds, totalRounds) {
    if (perfectRounds >= totalRounds) return 10;
    if (perfectRounds === totalRounds - 1) return 7;
    if (perfectRounds === totalRounds - 2) return 5;
    return 3;
  }

  async function endSession(opts) {
    const g = activeGame;
    if (!g) return 0;
    const rounds = opts.rounds || [];
    const totalRounds = opts.totalRounds != null ? opts.totalRounds : rounds.length;
    const perfectRounds = opts.perfectRounds != null
      ? opts.perfectRounds
      : rounds.filter((r) => r.correct && r.attempts === 1).length;
    const points = opts.pointsOverride != null ? opts.pointsOverride : scoreFor(perfectRounds, totalRounds);

    // score screen first — never block the kid's celebration on network
    el("game-session-view").style.display = "none";
    const scoreView = el("game-score-view");
    scoreView.style.display = "flex";
    el("game-score-points").textContent = "+" + points;
    el("game-score-detail").textContent =
      perfectRounds + " of " + totalRounds + " first try";
    chime("big");
    confetti();
    setTimeout(() => speak("Great job! " + points + " points!"), 250);

    // bookkeeping (best-effort)
    try {
      const FV = window.firebase && window.firebase.firestore.FieldValue;
      if (window.BubbsFirebase && window.BubbsFirebase.ready && window.BubbsPoints && FV) {
        const ctx = await window.BubbsFirebase.ready;
        // per-session detail doc
        try {
          await ctx.db.collection("users").doc(ctx.uid)
            .collection("game-sessions").add({
              gameType: g.id,
              startedAt: sessionStartedAt,
              endedAt: FV.serverTimestamp(),
              rounds: rounds,
              totalScore: points,
              bonusEarned: 0,
            });
        } catch (e) { err("game-session write failed", e); }
        // points + gamesPlayed counters in one ledger transaction
        const extras = { lastGamePlayedAt: FV.serverTimestamp() };
        extras["gamesPlayed." + g.id + ".sessions"] = FV.increment(1);
        extras["gamesPlayed." + g.id + ".totalScore"] = FV.increment(points);
        await window.BubbsPoints.earn(points, g.id + "-session", g.id, extras);
      }
    } catch (e) {
      err("points award failed (session still counts locally)", e);
    }
    return points;
  }

  const api = {
    get stage() { return el("game-stage"); },
    setProgress: function (text) { el("game-progress").textContent = text || ""; },
    speak: speak,
    celebrate: celebrate,
    wrong: wrong,
    onSkip: function (cb) { skipCb = cb; },
    end: endSession,
    getVocab: getVocab,
  };

  /* ---------------- boot ---------------- */

  function init() {
    if (window.BubbsNav) {
      window.BubbsNav.registerTab({
        id: "games",
        label: "Games",
        emoji: "🎮",
        viewId: "games-view",
        onShow: renderLauncher,
        onHide: function () {
          // leaving the tab mid-game abandons the session quietly
          exitToLauncher();
          if (window.speechSynthesis) window.speechSynthesis.cancel();
        },
      });
    }
    const skipBtn = el("game-skip");
    if (skipBtn) skipBtn.addEventListener("click", () => { if (skipCb) { try { skipCb(); } catch (e) {} } });
    const quitBtn = el("game-quit");
    if (quitBtn) quitBtn.addEventListener("click", exitToLauncher);
    const againBtn = el("game-again");
    if (againBtn) againBtn.addEventListener("click", () => {
      const g = activeGame;
      exitToLauncher();
      if (g) startGame(g);
    });
    const doneBtn = el("game-done");
    if (doneBtn) doneBtn.addEventListener("click", exitToLauncher);
  }

  window.BubbsGames = {
    register: function (g) {
      if (!g || !g.id || games.some((x) => x.id === g.id)) return;
      games.push(g);
      renderLauncher();
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

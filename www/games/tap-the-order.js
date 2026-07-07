/**
 * Mini-game #2: Tap the Order — V2 (batch V2-4).
 *
 * A simple sentence ("Kase wants pizza") is shown as scrambled picture
 * tiles. The kid taps the tiles in the right order; each correct tap
 * locks the tile into the sentence row above. Wrong tap = wobble, no
 * penalty. 5 sentences per session; caregiver Skip advances.
 *
 * Sentence source: 20 hard-coded three-word sentences built from the
 * DEFAULT_VOCAB starter words (BUBBS-V2-GAMES-DESIGN.md). The subject
 * uses the caregiver-configured student name so it reads as the child.
 * Admin-authored sentences are a v2.1 idea — hard-coded here on purpose.
 */
(function () {
  "use strict";

  const ROUNDS = 5;

  // [word, emoji] triples; SUBJ placeholder = student name.
  const SENTENCES = [
    [["SUBJ", null], ["wants", "🤲"], ["milk", "🥛"]],
    [["SUBJ", null], ["wants", "🤲"], ["pizza", "🍕"]],
    [["SUBJ", null], ["wants", "🤲"], ["juice", "🧃"]],
    [["SUBJ", null], ["wants", "🤲"], ["water", "💧"]],
    [["SUBJ", null], ["wants", "🤲"], ["cereal", "🥣"]],
    [["mom", "👩"], ["eats", "😋"], ["apple", "🍎"]],
    [["dad", "👨"], ["eats", "😋"], ["bread", "🍞"]],
    [["SUBJ", null], ["eats", "😋"], ["cookie", "🍪"]],
    [["mom", "👩"], ["eats", "😋"], ["cheese", "🧀"]],
    [["dad", "👨"], ["drinks", "🥤"], ["juice", "🧃"]],
    [["mom", "👩"], ["drinks", "🥤"], ["water", "💧"]],
    [["SUBJ", null], ["drinks", "🥤"], ["milk", "🥛"]],
    [["SUBJ", null], ["goes", "🚶"], ["home", "🏠"]],
    [["SUBJ", null], ["goes", "🚶"], ["outside", "🌞"]],
    [["dad", "👨"], ["goes", "🚶"], ["school", "🏫"]],
    [["mom", "👩"], ["goes", "🚶"], ["store", "🏪"]],
    [["SUBJ", null], ["feels", "💗"], ["happy", "😊"]],
    [["SUBJ", null], ["feels", "💗"], ["tired", "😴"]],
    [["SUBJ", null], ["wants", "🤲"], ["hug", "🤗"]],
    [["SUBJ", null], ["wants", "🤲"], ["break", "⏸️"]],
  ];

  function studentInfo() {
    let name = "Kase", emoji = "👦";
    try {
      const raw = localStorage.getItem("talk-settings-v2");
      if (raw) {
        const s = JSON.parse(raw);
        if (s.studentName) name = s.studentName;
        if (s.studentEmoji) emoji = s.studentEmoji;
      }
    } catch (e) {}
    return { name: name, emoji: emoji };
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Ensure the scrambled order differs from the correct order. */
  function scramble(words) {
    for (let tries = 0; tries < 10; tries++) {
      const s = shuffle(words);
      if (s.some((w, i) => w.word !== words[i].word)) return s;
    }
    return words.slice().reverse();
  }

  function start(api) {
    const kid = studentInfo();
    const rounds = shuffle(SENTENCES).slice(0, ROUNDS).map((tpl) =>
      tpl.map((pair) => ({
        word: pair[0] === "SUBJ" ? kid.name : pair[0],
        emoji: pair[0] === "SUBJ" ? kid.emoji : pair[1],
      }))
    );

    let idx = 0;
    const results = [];
    let wrongTaps = 0;
    let nextPos = 0;
    let advancing = false;

    function sentenceText(words) { return words.map((w) => w.word).join(" "); }

    function playRound() {
      advancing = false;
      wrongTaps = 0;
      nextPos = 0;
      const words = rounds[idx];
      api.setProgress("Round " + (idx + 1) + " of " + ROUNDS);
      api.stage.innerHTML =
        '<div class="tto-instruction">Tap the tiles in the right order:</div>' +
        '<div class="tto-locked"></div>' +
        '<div class="tto-pool"></div>';
      const locked = api.stage.querySelector(".tto-locked");
      const pool = api.stage.querySelector(".tto-pool");

      // placeholder slots
      words.forEach(() => {
        const slot = document.createElement("div");
        slot.className = "tto-slot";
        locked.appendChild(slot);
      });

      scramble(words).forEach((w) => {
        const b = document.createElement("button");
        b.className = "tto-tile";
        b.setAttribute("aria-label", w.word);
        b.innerHTML = '<span class="tto-emoji">' + (w.emoji || "⭐") + '</span><span class="tto-label">' + w.word + "</span>";
        b.addEventListener("click", () => onTap(w, b, words));
        pool.appendChild(b);
      });

      api.speak(sentenceText(words));
      api.stage.querySelector(".tto-instruction").addEventListener("click", () => api.speak(sentenceText(words)));
    }

    function onTap(w, btn, words) {
      if (advancing || btn.disabled) return;
      if (w.word === words[nextPos].word) {
        // lock it in
        const slot = api.stage.querySelectorAll(".tto-slot")[nextPos];
        slot.innerHTML = btn.innerHTML;
        slot.classList.add("filled");
        btn.disabled = true;
        btn.classList.add("tto-used");
        api.speak(w.word);
        nextPos++;
        if (nextPos >= words.length) {
          advancing = true;
          results.push({ roundNumber: idx + 1, correct: true, attempts: wrongTaps + 1, pointsEarned: wrongTaps === 0 ? 2 : 1 });
          api.celebrate(sentenceText(words) + "!");
          setTimeout(next, 1300);
        }
      } else {
        wrongTaps++;
        api.wrong(btn);
      }
    }

    function next() {
      idx++;
      if (idx >= ROUNDS) {
        api.end({
          rounds: results,
          totalRounds: ROUNDS,
          perfectRounds: results.filter((r) => r.correct && r.attempts === 1).length,
        });
      } else {
        playRound();
      }
    }

    api.onSkip(() => {
      if (advancing) return;
      advancing = true;
      results.push({ roundNumber: idx + 1, correct: false, attempts: wrongTaps, pointsEarned: 0 });
      next();
    });

    playRound();
  }

  if (window.BubbsGames) {
    window.BubbsGames.register({
      id: "tap-the-order",
      name: "Tap the Order",
      emoji: "🧩",
      description: "Build the sentence, one tile at a time",
      start: start,
    });
  }
})();

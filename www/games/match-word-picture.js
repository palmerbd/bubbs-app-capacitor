/**
 * Mini-game #1: Match the Word to the Picture — V2 (batch V2-3).
 *
 * 5 rounds. Each round speaks + shows a word; the kid taps the matching
 * picture from 4 tiles (1 correct + 3 distractors, same category where
 * possible). Correct = celebration + auto-advance after 1s. Wrong =
 * wobble, no penalty, try again. Caregiver Skip advances a stuck round.
 *
 * Scoring (shared ladder in game-runner): 5/5 first-try → +10,
 * 4/5 → +7, 3/5 → +5, else +3.
 *
 * Vocabulary: the child's customized AAC vocab (state.vocab) with
 * DEFAULT_VOCAB fallback — same pictures they already know.
 */
(function () {
  "use strict";

  const ROUNDS = 5;
  const TILES = 4;

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Build ROUNDS rounds: { word, display, correct, options[] } */
  function buildRounds(vocab) {
    // flatten with category + require a visual (emoji or photo)
    const pool = [];
    Object.keys(vocab).forEach((cat) => {
      (vocab[cat] || []).forEach((item) => {
        if ((item.emoji || item.photo) && item.word) {
          pool.push({ ...item, cat: cat });
        }
      });
    });
    if (pool.length < TILES) return null;

    const targets = shuffle(pool).slice(0, ROUNDS);
    return targets.map((target) => {
      const sameCat = pool.filter((p) => p.cat === target.cat && p.word !== target.word);
      const otherCat = pool.filter((p) => p.cat !== target.cat && p.word !== target.word);
      const distractors = shuffle(sameCat).slice(0, TILES - 1);
      while (distractors.length < TILES - 1 && otherCat.length) {
        const pick = otherCat.splice(Math.floor(Math.random() * otherCat.length), 1)[0];
        if (!distractors.some((d) => d.word === pick.word)) distractors.push(pick);
      }
      return { target: target, options: shuffle([target].concat(distractors)) };
    });
  }

  function tileHtml(item) {
    if (item.photo) {
      return '<img class="mwp-photo" src="' + item.photo + '" alt="" />';
    }
    return '<span class="mwp-emoji">' + (item.emoji || "⭐") + "</span>";
  }

  function start(api) {
    const vocab = api.getVocab();
    const rounds = vocab ? buildRounds(vocab) : null;
    if (!rounds) {
      api.stage.innerHTML = '<div class="learn-empty"><p>Not enough pictures to play yet.</p></div>';
      return;
    }

    let idx = 0;
    const results = []; // {roundNumber, correct, attempts, pointsEarned}
    let attempts = 0;
    let advancing = false;

    function playRound() {
      advancing = false;
      attempts = 0;
      const round = rounds[idx];
      api.setProgress("Round " + (idx + 1) + " of " + ROUNDS);
      api.stage.innerHTML =
        '<div class="mwp-word">' + round.target.word.toUpperCase() + "</div>" +
        '<div class="mwp-grid"></div>';
      const grid = api.stage.querySelector(".mwp-grid");
      round.options.forEach((opt) => {
        const b = document.createElement("button");
        b.className = "mwp-tile";
        b.setAttribute("aria-label", opt.word);
        b.innerHTML = tileHtml(opt);
        b.addEventListener("click", () => onTap(opt, b, round));
        grid.appendChild(b);
      });
      api.speak(round.target.word);

      // tap the word to hear it again
      api.stage.querySelector(".mwp-word").addEventListener("click", () => api.speak(round.target.word));
    }

    function onTap(opt, btn, round) {
      if (advancing) return;
      attempts++;
      if (opt.word === round.target.word) {
        advancing = true;
        btn.classList.add("mwp-correct");
        results.push({ roundNumber: idx + 1, correct: true, attempts: attempts, pointsEarned: attempts === 1 ? 2 : 1 });
        api.celebrate("Yes! " + round.target.word + "!");
        setTimeout(next, 1100);
      } else {
        api.wrong(btn);
      }
    }

    function next() {
      idx++;
      if (idx >= ROUNDS) {
        api.end({ rounds: results, totalRounds: ROUNDS });
      } else {
        playRound();
      }
    }

    api.onSkip(() => {
      if (advancing) return;
      advancing = true;
      results.push({ roundNumber: idx + 1, correct: false, attempts: attempts, pointsEarned: 0 });
      next();
    });

    playRound();
  }

  if (window.BubbsGames) {
    window.BubbsGames.register({
      id: "match-word-picture",
      name: "Match the Word",
      emoji: "🍎",
      description: "Hear a word, tap its picture",
      start: start,
    });
  }
})();

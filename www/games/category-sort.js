/**
 * Mini-game #3: Category Sort — V2 (batch V2-5).
 *
 * 6 picture tiles from 3 mixed categories; 3 labeled buckets on top.
 * Tap-select flow (BUBBS-V2-GAMES-DESIGN.md recommends tap-select over
 * HTML5 drag-drop, which is unreliable in WKWebView): tap a tile to
 * pick it up, tap a bucket to drop it. Right bucket = tile locks in;
 * wrong bucket = tile bounces back. One sort board = one session.
 *
 * Scoring: all 6 first-try → +12, 4-5 → +8, else +5.
 */
(function () {
  "use strict";

  const CAT_META = {
    food:   { label: "Food",     emoji: "🍎" },
    people: { label: "People",   emoji: "👤" },
    places: { label: "Places",   emoji: "📍" },
    feel:   { label: "Feelings", emoji: "😊" },
  };
  const TILES_PER_CAT = 2;
  const CATS_PER_ROUND = 3;

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function tileVisual(item) {
    if (item.photo) return '<img class="cs-photo" src="' + item.photo + '" alt="" />';
    return '<span class="cs-emoji">' + (item.emoji || "⭐") + "</span>";
  }

  function start(api) {
    const vocab = api.getVocab() || {};
    const usable = Object.keys(CAT_META).filter(
      (c) => (vocab[c] || []).filter((i) => i.word && (i.emoji || i.photo)).length >= TILES_PER_CAT
    );
    if (usable.length < CATS_PER_ROUND) {
      api.stage.innerHTML = '<div class="learn-empty"><p>Not enough pictures to play yet.</p></div>';
      return;
    }

    const cats = shuffle(usable).slice(0, CATS_PER_ROUND);
    let tiles = [];
    cats.forEach((c) => {
      const items = shuffle(vocab[c].filter((i) => i.word && (i.emoji || i.photo))).slice(0, TILES_PER_CAT);
      items.forEach((i) => tiles.push({ ...i, cat: c }));
    });
    tiles = shuffle(tiles);

    let firstTry = 0;
    let missed = {};   // word -> had a wrong attempt
    let placed = 0;
    let selected = null; // {tile, btn}

    api.setProgress("Sort them!");
    api.stage.innerHTML =
      '<div class="cs-buckets"></div>' +
      '<div class="cs-instruction">Tap a picture, then tap where it belongs</div>' +
      '<div class="cs-pool"></div>';
    const bucketsHost = api.stage.querySelector(".cs-buckets");
    const pool = api.stage.querySelector(".cs-pool");

    cats.forEach((c) => {
      const b = document.createElement("button");
      b.className = "cs-bucket";
      b.dataset.cat = c;
      b.setAttribute("aria-label", CAT_META[c].label + " bucket");
      b.innerHTML =
        '<span class="cs-bucket-head">' + CAT_META[c].emoji + " " + CAT_META[c].label + "</span>" +
        '<span class="cs-bucket-items"></span>';
      b.addEventListener("click", () => onBucket(c, b));
      bucketsHost.appendChild(b);
    });

    tiles.forEach((t) => {
      const b = document.createElement("button");
      b.className = "cs-tile";
      b.setAttribute("aria-label", t.word);
      b.innerHTML = tileVisual(t) + '<span class="cs-label">' + t.word + "</span>";
      b.addEventListener("click", () => onTile(t, b));
      pool.appendChild(b);
    });

    api.speak("Sort the pictures!");

    function onTile(tile, btn) {
      if (btn.disabled) return;
      // deselect previous
      pool.querySelectorAll(".cs-tile").forEach((x) => x.classList.remove("cs-selected"));
      selected = { tile: tile, btn: btn };
      btn.classList.add("cs-selected");
      api.speak(tile.word);
    }

    function onBucket(cat, bucketEl) {
      if (!selected) return;
      const { tile, btn } = selected;
      if (tile.cat === cat) {
        if (!missed[tile.word]) firstTry++;
        btn.disabled = true;
        btn.classList.remove("cs-selected");
        btn.classList.add("cs-placed");
        btn.style.visibility = "hidden";
        const items = bucketEl.querySelector(".cs-bucket-items");
        const chip = document.createElement("span");
        chip.className = "cs-bucket-chip";
        chip.innerHTML = tileVisual(tile);
        items.appendChild(chip);
        selected = null;
        placed++;
        api.celebrate(tile.word + "! Yes!");
        if (placed >= tiles.length) {
          const points = firstTry >= 6 ? 12 : firstTry >= 4 ? 8 : 5;
          setTimeout(() => {
            api.end({
              rounds: tiles.map((t, i) => ({
                roundNumber: i + 1,
                correct: true,
                attempts: missed[t.word] ? 2 : 1,
                pointsEarned: missed[t.word] ? 1 : 2,
              })),
              totalRounds: tiles.length,
              perfectRounds: firstTry,
              pointsOverride: points,
            });
          }, 900);
        }
      } else {
        missed[tile.word] = true;
        api.wrong(btn);
        api.wrong(bucketEl);
      }
    }

    api.onSkip(() => {
      // caregiver bail-out: end with whatever was placed
      const points = 5;
      api.end({
        rounds: [],
        totalRounds: tiles.length,
        perfectRounds: firstTry,
        pointsOverride: points,
      });
    });
  }

  if (window.BubbsGames) {
    window.BubbsGames.register({
      id: "category-sort",
      name: "Category Sort",
      emoji: "🗂️",
      description: "Put each picture in its group",
      start: start,
    });
  }
})();

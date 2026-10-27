// Star Catcher: classic script (no modules, no build step).
// T2 start flow, T3 controls (keyboard move, clamp, pointer/touch drag), T4 star rules (random-x
// falling stars, catch +1, uncaught star -1 life, live HUD) and T5 end states (10 points = "won",
// third life lost = "lost", Restart from either end screen by button or Enter/Space).
(function () {
  "use strict";

  var FIELD_W = 400;
  var FIELD_H = 600;
  var BASKET_W = 80;
  var BASKET_H = 16;
  var BASKET_Y = FIELD_H - 40;
  var MAX_DT = 0.05; // seconds; clamp so a stalled tab cannot teleport the simulation
  var LIVES_START = 3;
  var WIN_SCORE = 10; // reaching this score wins the round (R4)
  var BASKET_SPEED = 260; // logical units per second, constant for every movement key
  var STAR_SIZE = 20; // logical units; a star is a STAR_SIZE x STAR_SIZE square
  var STAR_FALL_SPEED = 140; // logical units per second, constant for every star
  var STAR_SPAWN_INTERVAL = 0.9; // seconds between spawns while playing
  var MAX_STARS = 20; // hard cap on live stars so the array stays bounded (R5)

  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");
  var scoreEl = document.getElementById("score");
  var livesEl = document.getElementById("lives");
  var screenEl = document.getElementById("screen");
  var titleEl = document.getElementById("screen-title");
  var startBtn = document.getElementById("start-btn");
  var restartBtn = document.getElementById("restart-btn");

  // Overlay titles for the end states. The start title is set in syncScreen as well.
  var END_TITLES = { won: "You Win", lost: "Game Over" };

  // Internal game state. Only the loop and the state machine write here.
  // States: "start" (before the first round), "playing", "won", "lost".
  var game = {
    state: "start",
    score: 0,
    lives: LIVES_START,
    basketX: (FIELD_W - BASKET_W) / 2,
    stars: []
  };

  // Held movement directions while playing: { left: bool, right: bool }.
  var held = { left: false, right: false };
  // True while a pointer/touch drag that started on the playfield is in progress.
  var dragging = false;
  // Seconds accumulated towards the next star spawn. Reset when a round starts.
  var spawnTimer = 0;

  // Key -> movement direction. Arrow keys and A/D (either case) are the same controls.
  var MOVE_KEYS = {
    ArrowLeft: "left",
    a: "left",
    A: "left",
    ArrowRight: "right",
    d: "right",
    D: "right"
  };

  function clamp(v, lo, hi) {
    return Math.min(Math.max(v, lo), hi);
  }

  // Read-only test hook. Accessor without a setter, non-configurable: assignments are ignored
  // and every read returns a fresh frozen snapshot, so mutating it cannot change the game.
  Object.defineProperty(window, "__game", {
    enumerable: true,
    configurable: false,
    get: function () {
      return Object.freeze({
        state: game.state,
        score: game.score,
        lives: game.lives,
        basketX: game.basketX,
        stars: Object.freeze(
          game.stars.map(function (s) {
            return Object.freeze({ x: s.x, y: s.y });
          })
        )
      });
    },
    set: undefined
  });

  function syncHud() {
    var score = "Score: " + game.score;
    var lives = "Lives: " + game.lives;
    if (scoreEl.textContent !== score) scoreEl.textContent = score;
    if (livesEl.textContent !== lives) livesEl.textContent = lives;
  }

  function isEnded() {
    return game.state === "won" || game.state === "lost";
  }

  // Overlay follows the state: Start on the start screen, Restart on a won/lost screen, nothing
  // while playing. Each DOM write is guarded so the per-frame sync does not touch unchanged nodes.
  function syncScreen() {
    var overlayHidden = game.state === "playing";
    if (screenEl.hidden !== overlayHidden) screenEl.hidden = overlayHidden;
    var title = game.state === "start" ? "Star Catcher" : END_TITLES[game.state];
    if (title && titleEl.textContent !== title) titleEl.textContent = title;
    var showStart = game.state === "start";
    var showRestart = isEnded();
    if (startBtn.hidden !== !showStart) startBtn.hidden = !showStart;
    if (restartBtn.hidden !== !showRestart) restartBtn.hidden = !showRestart;
  }

  // Single entry point for leaving the start screen (button and keys both call it). It only acts
  // in state "start", so repeated presses while playing cannot restart or double-start the game.
  // Start does not change score or lives; stars only appear once playing begins (spawning happens
  // in updateStars, which only runs while playing).
  function startGame() {
    if (game.state !== "start") return false;
    game.state = "playing";
    spawnTimer = 0;
    syncScreen();
    return true;
  }

  // Restart from a won or lost screen (button or Enter/Space). Resets score, lives, stars, basket
  // position, input and the spawn timer, then returns straight to playing without a page reload.
  // It does nothing in any other state, so a second Enter/Space or click cannot restart twice.
  function restartGame() {
    if (!isEnded()) return false;
    game.state = "playing";
    game.score = 0;
    game.lives = LIVES_START;
    game.basketX = (FIELD_W - BASKET_W) / 2;
    game.stars = [];
    spawnTimer = 0;
    clearInput();
    syncScreen();
    return true;
  }

  // Leaves the round with an end state. Stars are dropped so nothing falls, scores or costs lives
  // once the round is over; updateStars returns early for any state other than "playing".
  function endRound(state) {
    game.state = state;
    game.stars = [];
    clearInput();
    syncScreen();
  }

  function clearInput() {
    held.left = false;
    held.right = false;
    dragging = false;
  }

  // Movement is only meaningful while playing. Leaving playing drops any held or dragged input so
  // a key held through a state change cannot keep moving the basket afterwards.
  function update(dt) {
    if (game.state !== "playing") {
      clearInput();
    } else {
      var direction = (held.right ? 1 : 0) - (held.left ? 1 : 0);
      game.basketX += direction * BASKET_SPEED * dt;
    }
    // The basket is kept inside the playfield every frame, after keyboard or pointer input.
    game.basketX = clamp(game.basketX, 0, FIELD_W - BASKET_W);
    updateStars(dt);
  }

  // True when a star's square overlaps the basket's rectangle.
  function touchesBasket(star) {
    return (
      star.x < game.basketX + BASKET_W &&
      star.x + STAR_SIZE > game.basketX &&
      star.y < BASKET_Y + BASKET_H &&
      star.y + STAR_SIZE > BASKET_Y
    );
  }

  // Star rules, only while playing. A star spawns at the top at a uniformly random x and falls at a
  // fixed speed. Overlapping the basket scores +1; reaching the bottom uncaught costs 1 life. Both
  // remove the star. Stars are checked for a catch before a miss in the same frame.
  function updateStars(dt) {
    if (game.state !== "playing") return;

    spawnTimer += dt;
    if (spawnTimer >= STAR_SPAWN_INTERVAL) {
      spawnTimer -= STAR_SPAWN_INTERVAL;
      if (game.stars.length < MAX_STARS) {
        game.stars.push({ x: Math.random() * (FIELD_W - STAR_SIZE), y: 0 });
      }
    }

    var kept = [];
    for (var i = 0; i < game.stars.length; i++) {
      var star = game.stars[i];
      star.y += STAR_FALL_SPEED * dt;
      if (touchesBasket(star)) {
        game.score += 1;
      } else if (star.y >= FIELD_H) {
        game.lives = Math.max(0, game.lives - 1);
      } else {
        kept.push(star);
      }
    }
    game.stars = kept;

    // End-state rule, resolved once per frame after that frame's catches and misses. Win is checked
    // first, so a frame that reaches WIN_SCORE and also empties the last life is a win (documented
    // tie rule). Ending the round clears the stars and stops all score and life changes.
    if (game.score >= WIN_SCORE) {
      endRound("won");
    } else if (game.lives <= 0) {
      endRound("lost");
    }
  }

  function render() {
    ctx.fillStyle = "#121a33";
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);
    ctx.fillStyle = "#ffd166";
    for (var i = 0; i < game.stars.length; i++) {
      ctx.fillRect(game.stars[i].x, game.stars[i].y, STAR_SIZE, STAR_SIZE);
    }
    ctx.fillStyle = "#4cc9f0";
    ctx.fillRect(game.basketX, BASKET_Y, BASKET_W, BASKET_H);
  }

  // Backing store follows the CSS size times devicePixelRatio (R5), so the canvas stays sharp on
  // HiDPI phones. Game coordinates stay in the FIELD_W x FIELD_H logical units: the context transform
  // maps them onto the backing store, so window.__game values and pointer mapping are unchanged.
  function resizeBacking() {
    var rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    // Assigning width/height resets the transform, so it is set again on every resize.
    ctx.setTransform(w / FIELD_W, 0, 0, h / FIELD_H, 0, 0);
  }

  // Re-arms a one-shot listener for the current devicePixelRatio, so a DPR change (zoom, moving the
  // window to another screen) also resizes the backing store.
  function watchDpr() {
    if (typeof window.matchMedia !== "function") return;
    var mq = window.matchMedia("(resolution: " + (window.devicePixelRatio || 1) + "dppx)");
    var onChange = function () {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      resizeBacking();
      watchDpr();
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
  }

  function watchDisplay() {
    resizeBacking();
    window.addEventListener("resize", resizeBacking);
    if (typeof window.ResizeObserver === "function") {
      new window.ResizeObserver(resizeBacking).observe(canvas);
    }
    watchDpr();
  }

  var last = null;
  function frame(ts) {
    if (last === null) last = ts;
    var dt = clamp((ts - last) / 1000, 0, MAX_DT);
    last = ts;
    update(dt);
    render();
    syncHud();
    syncScreen();
    window.requestAnimationFrame(frame);
  }

  // Maps a client (CSS pixel) x to a basket position so the basket centre sits under the pointer.
  // The canvas is scaled by CSS, so the conversion uses its current bounding box.
  function setBasketFromClientX(clientX) {
    var rect = canvas.getBoundingClientRect();
    if (rect.width <= 0) return;
    var logicalX = ((clientX - rect.left) * FIELD_W) / rect.width;
    game.basketX = clamp(logicalX - BASKET_W / 2, 0, FIELD_W - BASKET_W);
  }

  startBtn.addEventListener("click", function () {
    startGame();
  });

  restartBtn.addEventListener("click", function () {
    restartGame();
  });

  // Keyboard. Enter/Space start the game on the start screen and restart it on a won/lost screen;
  // while playing they do nothing. Movement keys only register while playing, and their default
  // action (page scroll) is prevented so arrows do not scroll the page.
  window.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " " || e.code === "Space") {
      e.preventDefault();
      if (game.state === "start") {
        startGame();
      } else {
        restartGame();
      }
      return;
    }
    var dir = MOVE_KEYS[e.key];
    if (dir && game.state === "playing") {
      e.preventDefault();
      held[dir] = true;
    }
  });

  window.addEventListener("keyup", function (e) {
    var dir = MOVE_KEYS[e.key];
    if (dir) held[dir] = false;
  });

  // Losing focus (tab switch, alt-tab) can swallow the matching keyup, so drop all input.
  window.addEventListener("blur", clearInput);

  // Pointer and touch drag on the playfield. Pointer events cover mouse, pen and touch; the canvas
  // uses touch-action:none so a touch drag is not turned into page scrolling.
  canvas.addEventListener("pointerdown", function (e) {
    if (game.state !== "playing") return;
    dragging = true;
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    setBasketFromClientX(e.clientX);
    e.preventDefault();
  });

  canvas.addEventListener("pointermove", function (e) {
    if (!dragging || game.state !== "playing") return;
    setBasketFromClientX(e.clientX);
  });

  function endDrag() {
    dragging = false;
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  watchDisplay();
  window.requestAnimationFrame(frame);
  syncHud();
  syncScreen();
})();

# Star Catcher — original request and completion conditions

Build a small, dependency-free browser game in this repository. Plain HTML, CSS and JavaScript only
(no build step, no npm packages). `index.html` is served as a static file and draws on a `<canvas>`.

## Original request (verbatim)
Make a simple game I can play in the browser on a laptop and a phone. A basket at the bottom moves
left and right with the arrow keys (or A/D, or by touching/dragging). Stars fall from the top; catching
a star scores a point, missing three stars loses. Reach 10 points to win. After winning or losing I can
restart without reloading the page. It must show the score and lives while playing, and a clear Start,
Game Over and You Win screen. The basket must never leave the playfield. It should look right on a
375px wide phone and on a desktop, and have no console errors.

## Requirements
- R1 Start: a Start screen with a visible Start button (also Enter/Space); gameplay begins only after Start.
- R2 Controls: Left/Right arrows and A/D move the basket at a constant speed; the basket is clamped to the canvas; touch/drag also moves it.
- R3 Rules: stars fall from random x positions; catching one gives +1 score; a star that reaches the bottom uncaught costs 1 life; 3 lives; score and lives are visible and update live.
- R4 End states: 10 points shows "You Win"; losing the third life shows "Game Over"; both offer Restart (button and Enter/Space) which resets score, lives and stars without a page reload.
- R5 Layout/robustness: playable at 375x700 and 1280x800, canvas scales to fit with no horizontal scroll, zero console errors, and the loop stays responsive (no frame stalls from unbounded star arrays).

## Completion conditions
Every requirement is verified by real checks in a real Chromium (actual key presses and clicks driving the
live game, observing score/lives/state text and canvas pixels, both viewports, screenshots), independent
Sonnet review and a final Opus audit. A screenshot alone, or a passing build, is not verification. The game
must be reachable to both Win and Game Over by real play. Do not weaken or delete requirements.
Expose a small read-only test hook `window.__game` (state, score, lives, basketX, stars[]) so checks can observe play.

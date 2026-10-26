# Todo web app — original request and completion conditions

Build a small, dependency-free, single-page Todo web app in this repository. Plain HTML, CSS and
JavaScript only (no build step, no npm packages). Serve `index.html` as a static file.

## Original request (verbatim)
Make a Todo list web app I can use on my phone and my laptop. I can add a task by typing it and
pressing Enter or a button, tick a task as done, delete a task, and filter the list by All /
Active / Done. The list must still be there after I reload the page. Empty tasks must not be
added. It must look usable on a 375px wide phone and on a desktop, with no console errors.

## Requirements
- R1 Add: typing text and pressing Enter or the Add button appends a task; surrounding whitespace is trimmed; an empty or whitespace-only input adds nothing.
- R2 Complete/delete: each task has a checkbox that toggles done (visually distinguishable) and a delete button that removes it.
- R3 Filter: All / Active / Done controls show the matching tasks; the active filter is visibly marked; the item counter shows the number of active tasks.
- R4 Persistence: tasks, done state and the chosen filter survive a page reload (localStorage); corrupted stored data must not crash the page.
- R5 Layout: usable at 375x700 and 1280x800 with no horizontal scroll, controls reachable, and zero console errors.

## Completion conditions
Every requirement is verified by real checks in a real Chromium (typed input, clicks, reload,
both viewports, screenshots), independent Sonnet review and a final Opus audit. A screenshot
alone, or a passing build, is not verification. Do not weaken or delete requirements.

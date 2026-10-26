# Architecture — web-todo (profile: web-app)

Author: Opus long-term design (re-done after the first architect was stopped by the 10-minute
background ceiling; the backlog/contract it left were audited and extended, not replaced).
Authoritative requirements: `DESIGN.md` / `.autodev/mission.json` R1-R5. Nothing here weakens,
merges away or deletes any of them. Assumptions are listed separately in section 10 and never
substitute for a requirement.

## 0. Original request (verbatim, from DESIGN.md)

> Make a Todo list web app I can use on my phone and my laptop. I can add a task by typing it and
> pressing Enter or a button, tick a task as done, delete a task, and filter the list by All /
> Active / Done. The list must still be there after I reload the page. Empty tasks must not be
> added. It must look usable on a 375px wide phone and on a desktop, with no console errors.

Constraints: plain HTML, CSS and JavaScript only, no build step, no npm packages, `index.html`
served as a static file. Completion: every requirement verified by real checks in a real Chromium
(typed input, clicks, reload, both viewports, screenshots), independent Sonnet review and a final
Opus audit. A screenshot alone, or a passing build, is not verification.

| Req | Text (verbatim) |
| --- | --- |
| R1 | Add: typing text and pressing Enter or the Add button appends a task; surrounding whitespace is trimmed; an empty or whitespace-only input adds nothing. |
| R2 | Complete/delete: each task has a checkbox that toggles done (visually distinguishable) and a delete button that removes it. |
| R3 | Filter: All / Active / Done controls show the matching tasks; the active filter is visibly marked; the item counter shows the number of active tasks. |
| R4 | Persistence: tasks, done state and the chosen filter survive a page reload (localStorage); corrupted stored data must not crash the page. |
| R5 | Layout: usable at 375x700 and 1280x800 with no horizontal scroll, controls reachable, and zero console errors. |

## 1. Product file layout

Repository root (the static site root; no build output, no `package.json`, no `node_modules`):

| File | Role |
| --- | --- |
| `index.html` | Static markup and the DOM contract (section 2). `<!doctype html>`, `<meta name="viewport" content="width=device-width, initial-scale=1">`, `<link rel="stylesheet" href="style.css">`, `<link rel="icon" href="data:,">`, `<script src="app.js" defer></script>` (classic script, NOT `type="module"`). |
| `style.css` | Mobile-first responsive styles (section 5). No `@import`/`url()` to the network. |
| `app.js` | State, storage, rendering and event wiring, wrapped in an IIFE or block with `"use strict"`. No `import`/`export`/`require`. |
| `checks/build-check.mjs` | Planner-owned static bundle check (kind `build`). |
| `checks/browser-check.mjs` | Planner-owned Playwright/Chromium check (kinds `test`, `behavior`, `visual`). |

The `checks/` directory and `.autodev/` are hidden from the check's static server (404) so the
product cannot accidentally depend on them. Implementers (Haiku/Sonnet) MUST NOT edit anything in
`checks/`; changing a check is a planning decision that returns to Opus and invalidates evidence
(the product fingerprint includes untracked files such as `checks/`).

No favicon file is required, but the `data:,` icon link is mandatory: without it Chromium requests
`/favicon.ico`, the server answers 404, and the check correctly reports that as an error (R5).

## 2. DOM contract (binding for implementation and checks)

The checks locate elements only through these selectors and texts. They are the interface between
`app.js`/`index.html` and `checks/browser-check.mjs`.

| Selector | Requirement | Contract |
| --- | --- | --- |
| `form#new-todo-form` (recommended) | R1 | Wraps input + button; `submit` handler calls `preventDefault()`. Enter in the input and clicking/tapping the button both submit. |
| `#new-todo` | R1 | `<input type="text">`, visible, with an accessible label (`<label for>` or `aria-label`), `autocomplete="off"`, placeholder e.g. "What needs doing?". |
| `#add-btn` | R1 | `<button type="submit">` with visible text "Add". |
| `#todo-list` | R1-R3 | `<ul>`; each task is `<li class="todo-item">` (plus class `done` when done, exactly mirroring the checkbox). Non-task children (e.g. an empty-state hint) must not carry `todo-item`. |
| `li.todo-item .todo-text` | R1, R2 | `<span>` whose `textContent` equals the stored (trimmed) text exactly. Set via `textContent`, never `innerHTML` (the check types `<b>Pay</b> rent & bills` and asserts no `<b>` element appears). |
| `li.todo-item input.toggle` | R2 | `<input type="checkbox" class="toggle">`, `checked` == done, with an accessible name (wrapping `<label>` or `aria-label="Mark <text> done"`). |
| `li.todo-item button.delete` | R2 | `<button type="button" class="delete" aria-label="Delete <text>">`, visible glyph/text (e.g. "×" or "Delete"). |
| `#filters` | R3 | Container (e.g. `<nav aria-label="Filter tasks">` or `<div role="group">`). |
| `#filters [data-filter="all"\|"active"\|"done"]` | R3 | `<button type="button">` with trimmed text exactly `All`, `Active`, `Done`. Exactly one has `aria-pressed="true"`, others `aria-pressed="false"`. The selected one is also visibly different (computed style and pixels). |
| `#counter` | R3 | Text exactly `N item left` when N == 1, otherwise `N items left`, where N = number of not-done tasks across ALL tasks (independent of the current filter). Use `aria-live="polite"`. |

Coupling note for task order: every check compares the rendered page with an oracle string
`visible: ...; filter=<pressed>; counter=<#counter text>`. Therefore T1 must already ship the full
skeleton: `#filters` with All pressed by default and a correct `#counter`. T3 then adds filter
switching. T1 cannot pass with only the input and list.

## 3. State model and rendering (app.js)

```
state = { todos: Array<{ id: string, text: string, done: boolean }>, filter: "all"|"active"|"done" }
```

- Single source of truth; every mutation is `mutate -> save() -> render()`.
- `add(raw)`: `text = raw.trim()`; if `text === ""` do nothing (do not save, do not render a new
  row; the input may keep or clear its whitespace). Otherwise push `{ id: newId(), text, done:false }`
  at the END (append order), clear the input, keep focus in the input (phone keyboard stays open).
  The current filter is NOT changed by adding (adding under the Done filter keeps showing Done; the
  new active task is simply not visible there, and the counter increases).
- `toggle(id)`: flip `done`. `remove(id)`: delete by id. `setFilter(f)`: only accepts the three values.
- `newId()`: `crypto.randomUUID()` when available, else `Date.now().toString(36) + "-" + counter`.
  Ids are used for event targeting so duplicate texts are allowed.
- `render()`: rebuild the list from `state` (small data, full re-render is fine) using
  `document.createElement` + `textContent`; show only tasks matching the filter
  (`all`: every task; `active`: `!done`; `done`: `done`); set `li.done` iff done; update
  `aria-pressed` on the three filter buttons; update `#counter`.
- Event delegation: one `change` listener on `#todo-list` for `input.toggle`, one `click` listener for
  `button.delete`; one `click` listener on `#filters`; one `submit` listener on the form.
- No `console.error`, no uncaught exceptions, no failed requests anywhere, including the
  corrupted-storage paths (the check counts `console.error`, `pageerror`, `requestfailed` and any
  HTTP status >= 400 as errors).
- No CSS transitions/animations longer than 200 ms on task text or filter buttons (visual checks
  settle for 300 ms before comparing pixels). Prefer none.

## 4. localStorage schema, filter persistence and corrupted-data handling (R4)

Key: `todo-app.v1`. Value (JSON):

```json
{ "version": 1, "todos": [ { "id": "string, non-empty", "text": "string, trimmed, non-empty", "done": true } ], "filter": "all" }
```

- `save()` writes the whole state after every mutation, including filter changes (that is how the
  chosen filter survives reload). Wrapped in `try/catch`; a throwing `setItem` (quota, privacy mode)
  leaves the app working in memory without logging an error.
- `load()` on startup, wrapped in `try/catch` around both `getItem` and `JSON.parse`:
  1. Missing key -> defaults `{ todos: [], filter: "all" }`.
  2. Unparseable JSON, or parsed value that is not a plain object (null, number, string, array), or
     `todos` is not an array -> the whole payload is invalid -> defaults (filter `all`, even if a
     valid-looking `filter` was stored next to an invalid `todos`).
  3. Otherwise salvage item by item: keep an item only if it is a non-null object, `typeof text ===
     "string"` with non-empty `text.trim()`, and `typeof done === "boolean"`. Keep the trimmed text.
     A missing/empty/non-string `id` gets a fresh id (the item is kept). Everything else is dropped.
  4. `filter` is kept only if it is one of `all|active|done`, else `all`.
  5. If anything was repaired (cases 2-4, i.e. the normalized JSON differs from what was stored),
     immediately `save()` the normalized state so storage holds valid data again.
- No error is surfaced to the console; optionally a non-error UI hint is acceptable but not required.
- Same-origin new tab (same context) shows the same state: it reads the same key.

The check (`scenarioPersist`) injects exactly these corruptions and expects these results:
`{not json`, `null`, `42`, `"just a string"`, `[]`, `{"version":1,"todos":"nope","filter":"active"}`
-> empty list, filter `all`; a mixed array `[valid, null, 7, text:5, done:"yes", text:"   ",
{text:"No id",done:true}]` with filter `bogus` -> `Keep me` (active) and `No id` (done), filter `all`.

## 5. Accessibility and mobile/desktop layout (R5)

- Mobile-first CSS: `*, *::before, *::after { box-sizing: border-box }`, `body { margin: 0 }`,
  main container `width: 100%; max-width: 40rem; margin: 0 auto; padding: 1rem`.
  At >= 48rem the container can grow padding; nothing has a fixed width larger than 375 px.
- Form row: `display: flex; gap: .5rem`; input `flex: 1 1 auto; min-width: 0`; button fixed.
- Task row: `display: flex; align-items: flex-start` (or grid `auto 1fr auto`), checkbox | text | delete.
  Text: `flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; word-break: break-word;` NO
  `overflow: hidden`/`text-overflow: ellipsis`/`white-space: nowrap` (the check requires
  `scrollWidth <= clientWidth + 1`, i.e. long words wrap, nothing is clipped, and text never
  overlaps the checkbox or delete button).
- Filter bar: `display: flex; flex-wrap: wrap; gap`, buttons can shrink; counter on its own line
  or wrapping row at 375 px.
- Touch targets: all of `#new-todo`, `#add-btn`, the three filter buttons, every visible checkbox
  and delete button MUST have an effective hit area >= 44x44 CSS px at both 375x700 and 1280x800.
  The effective hit area is the larger of the control's own box and its `<label>` box (width and
  height each). The check enforces 44x44 as a hard minimum (amended in section 8.3; it was 24x24
  before, which narrowed the target). Checkbox: e.g. a `width: 1.75rem; height: 1.75rem` input inside
  a wrapping label padded to >= 44x44 (`display: inline-flex; min-width: 44px; min-height: 44px`).
  Nothing may cover a control: the check hit-tests the control centre with `elementFromPoint`.
- Done style (R2 visual): `li.done .todo-text { text-decoration: line-through; color: <muted>; }`
  — computed style and pixels must differ from an active task, and revert on untick.
- Selected filter (R3 visual): `[aria-pressed="true"]` gets a different background, text colour and
  border (not colour alone: also e.g. `font-weight: 600` / border), so it is visible to colour-blind
  users too.
- `:focus-visible` outlines kept; text contrast >= 4.5:1; `lang="en"`, `<h1>` heading, `<main>`.
- No horizontal scroll at 375x700 (isMobile, touch, DPR 2) and 1280x800: document and body
  `scrollWidth <= clientWidth`, `scrollX` stays 0, `innerWidth` equals the device width, and the
  full-page PNG width equals viewport width x DPR.

## 6. Check design

Both scripts are run only through the harness: `node COMMON/scripts/record.mjs --target TARGET
--check ID`, which sets cwd to the target root and supplies `AUTODEV_NODE`, `AUTODEV_COMMON`,
`AUTODEV_CHECK_CONTEXT` (check_id, kind, nonce, ...) and `AUTODEV_REPORT_PATH`. Reports are written
through `COMMON/scripts/lib/reports.mjs#writeReport`, which validates `schemas/report.schema.json`;
`validateReport` recomputes PASS/FAIL from assertions, behaviour `after === expected`, test
`passed/failed/total`, build `exit_code/outputs`, and real PNG/JPEG magic bytes for visual captures.
Every failing assertion stays in the report and makes the process exit 1. Nothing is filtered out.

### 6.1 `checks/build-check.mjs` (kind build)
No build step exists by design, so "build" proves the shippable static bundle: the three files
exist and are non-empty, doctype, device-width viewport meta, relative stylesheet link, classic
`app.js` script, no network-loaded resources, `app.js` parses (`vm.Script`), no
`import/export/require`, no `node_modules`, no npm dependencies. Shipped files and a manifest are
copied into evidence with sha256. A build PASS is never accepted as behaviour verification.

### 6.2 `checks/browser-check.mjs` (kinds test, behavior, visual)
- Chromium resolution at runtime: `process.env.AUTODEV_CHROMIUM_EXECUTABLE` is read when the check
  runs (not baked into the contract); used if it is an executable regular file. Otherwise Playwright's
  own detected Chromium (`chromium.executablePath()`) if that file exists. Otherwise the script exits
  3 WITHOUT writing a report, so record/verify keep the check UNVERIFIED (never a fake PASS). A
  launch failure also exits 3. The launched binary, its version and the resolution source are
  recorded as the first assertion. Playwright is imported from `COMMON/node_modules`, so the product
  stays dependency-free.
- Static server: Node `http` on `127.0.0.1:<random port>`, serving only the product root, `GET/HEAD`
  only, `cache-control: no-store`, 404 for `.git`, `.autodev`, `checks`, `node_modules` and traversal.
- Viewports: `375x700` (isMobile, hasTouch, DPR 2; actions use `tap()` / `touchscreen.tap`) and
  `1280x800` (mouse `click()` / `mouse.click`). Each scenario gets a fresh browser context (clean
  localStorage).
- Input is real: `keyboard.type` with per-key delay, `keyboard.press("Enter")`, real clicks/taps on
  the Add button, checkboxes, delete buttons and filters. `pointAt` additionally clicks/taps the
  raw centre coordinates of a control (no Playwright actionability help) to prove reachability.
- Reload is a real `page.reload()`; persistence is also checked by opening a second tab in the same
  context.
- Oracle: an independent `Model` class implements R1-R4 (trim, ignore empty, append, toggle, delete,
  filter, active counter). Each action records `before`, `after`, `expected` (behaviour schema) and
  an assertion `after === expected`.
- Errors: listeners on `console` (type error), `pageerror`, `requestfailed` and responses >= 400,
  per context; every scenario ends with the assertion "zero console errors, page errors and failed
  requests", and behaviour scenarios append an explicit `errors: none` action.
- Screenshots: PNGs written next to the report as `<check>-<nonce>-<viewport>-<name>.png`, hashed
  (sha256) into `artifacts`; visual reports list them in `details.captures`. Visual assertions never
  rely on the file existing: they compare element pixels before/after an interaction, compare
  computed styles, compare full-page PNG width with viewport x DPR, and measure layout.
- Pixel comparison (`comparePng`, `pixelsSame`, `pixelsDiffer`; amended in section 8.2): byte
  equality is the fast path. Otherwise both PNGs are decoded (built-in decoder, `node:zlib`) and
  compared per pixel. "Same" means equal size, every channel delta <= 16/255, and <= 0.5% of the
  pixels differing. "Differs" means anything beyond that (or a size change). A PNG that cannot be
  decoded fails both. Every assertion records the measured count, share, max delta and bbox.

Scenario catalogue (function -> what it asserts):

| Scenario | Reqs | Assertions |
| --- | --- | --- |
| `add` | R1 | empty initial state; `"  Buy milk  "`+Enter trimmed; input cleared; Add button adds; Enter on empty, spaces+Enter, spaces+Add add nothing; HTML text rendered literally; append order. |
| `complete` | R2 | one checkbox + one named delete per task; tick/untick/tick; `li.done` mirrors checkbox; done computed style differs and reverts; delete active, delete done, delete last. |
| `filter` | R3 | labels All/Active/Done; exactly one aria-pressed; Active/Done/All views; untick under Done hides it; delete under Active; add under Done keeps Done; counter number = active count. |
| `persist` | R4 | storage shape `{version:1, todos:[{id,text,done}], filter}`; reload keeps tasks/done/filter; new tab; Done+reload; 7 corruption payloads each: no crash, expected salvage, typing still works, storage rewritten valid, zero errors. |
| `layout` | R5 | meta viewport; innerWidth == device width; no horizontal scroll with all 3 filters; every control inside viewport, effective hit area (max of control and label box) >= 44x44 CSS px (section 8.3), hit-test reachable; long word/sentence rows not clipped and not overlapping. |
| `reach` | R5 (+R1-R4 via pointer) | raw-coordinate pointer on input, Add, checkbox, each filter, delete; reload; errors: none. |
| `journey` | R1-R5 | the original request end to end, reload, overflow measurement, screenshot, corruption + recovery, errors: none. |
| `visualAdd` | R1 | empty vs populated page pixels differ; each added text visible inside viewport and literal; whitespace input adds no row; list/page captures. |
| `visualDone` | R2 | element pixels of a task's text differ before/after ticking; computed styles differ; full-page capture. |
| `visualFilter` | R3 | Active button pixels differ unselected vs selected; computed styles differ; aria-pressed; page capture. |
| `visualPersist` | R4 | list+filter element pixels identical (bytes, or within the section 6.2 raster tolerance) before/after reload; state identical; negative controls rejected by the same comparison: one more task done, list under Active (done row missing), filter bar with Active marked; filter still marked; page after corrupted storage still renders input/Add and an empty list. |
| `visualLayout` | R5 | empty vs populated page differ; full-page PNG width == viewport x DPR (no horizontal overflow); layout measurement; Done-filter capture. |

Check -> scenario plan (in `PLANS` inside the script; contract ids map 1:1):

| Check | Kind | Task | Reqs | Runs |
| --- | --- | --- | --- | --- |
| T1-test | test | T1 | R1 | add @1280 |
| T1-build | build | T1 | R1 | build-check.mjs |
| T1-behavior | behavior | T1 | R1 | add @375 |
| T1-visual | visual | T1 | R1 | visualAdd @375 |
| T2-test | test | T2 | R2 | complete @1280 |
| T2-behavior | behavior | T2 | R2 | complete @375 |
| T2-visual | visual | T2 | R2 | visualDone @1280 |
| T3-test | test | T3 | R3 | filter @1280 |
| T3-behavior | behavior | T3 | R3 | filter @375 |
| T3-visual | visual | T3 | R3 | visualFilter @1280 |
| T4-test | test | T4 | R4 | persist @1280 |
| T4-behavior | behavior | T4 | R4 | persist @375 |
| T4-visual | visual | T4 | R4 | visualPersist @1280 |
| T5-test | test | T5 | R5 | layout @375 and @1280 |
| T5-behavior | behavior | T5 | R5 | reach @375 and @1280 |
| T5-visual-375 | visual | T5 | R5 | visualLayout @375 |
| T5-visual-1280 | visual | T5 | R5 | visualLayout @1280 |
| T6-build | build | T6 | R5 | build-check.mjs |
| T6-test | test | T6 | R1-R5 | add, complete, filter, persist, layout, reach @375 and @1280 |
| T6-behavior-375 | behavior | T6 | R1-R5 | journey @375 |
| T6-behavior-1280 | behavior | T6 | R1-R5 | journey @1280 |
| T6-visual-375 | visual | T6 | R1-R5 | visualAdd, visualDone, visualFilter, visualPersist, visualLayout @375 |
| T6-visual-1280 | visual | T6 | R1-R5 | visualAdd, visualDone, visualFilter, visualPersist, visualLayout @1280 |

Every requirement therefore has test + behavior + visual evidence at both viewports by T6, plus a
build check, matching the web-app profile (test, build, behavior, visual).

## 7. Backlog and per-task execution order

Dependency chain: `T1 -> T2 -> T3 -> T4 -> T5 -> T6` (T5 depends on T4 because its `reach`
scenario reloads and expects the state to survive; this was corrected from the earlier T3
dependency).

| Order | Task | Scope (implementation) | Done when |
| --- | --- | --- | --- |
| 1 | T1 (R1) | Create `index.html` (full DOM skeleton of section 2 incl. `#filters` with All pressed and `#counter`, icon link), minimal `style.css`, `app.js` with state, `add`, `render`, counter. No storage yet is acceptable. | T1-test, T1-build, T1-behavior, T1-visual PASS |
| 2 | T2 (R2) | Checkbox toggle, `li.done`, done style, delete button with aria-label, delegated events. | T2-* PASS; T1-* still PASS |
| 3 | T3 (R3) | Filter switching, aria-pressed, selected style, counter across filters. | T3-* PASS; earlier checks still PASS |
| 4 | T4 (R4) | `load()`/`save()` per section 4, filter persistence, corruption salvage + rewrite, try/catch. | T4-* PASS; earlier checks still PASS |
| 5 | T5 (R5) | Responsive CSS per section 5, touch target sizes, wrapping, no overflow, a11y polish. | T5-* PASS; earlier checks still PASS |
| 6 | T6 (R1-R5) | No new feature: full regression of everything at both viewports, final journey and visuals; fix regressions only. | T6-* PASS, then independent Sonnet final review and Opus final audit |

Per-sprint flow (harness): Sonnet short plan -> Haiku implement (product files only) -> independent
Sonnet review (read-only) -> Sonnet verifier runs `record.mjs --check` for each of the task's
`check_refs` (and re-runs earlier tasks' checks when shared files changed) -> task gate.
Milestone Opus audit every 2 completed tasks (progress.json). Two code failures -> Sonnet diagnosis;
four -> Opus replan; a contradiction between this design and a check -> back to Opus immediately.
Missing Chromium / environment failures are recorded as environment blockers (UNVERIFIED), never as
code failures and never bypassed.

## 8. Planner-owned check integrity

Reviewers compare these files with the hashes below; any mismatch means a check was edited outside
planning and all evidence is suspect.

- `checks/browser-check.mjs` sha256: `cc813a6cbc5f2ccc8262f9e34d658b37ce2863a9438475ee9a5d9c953dac3d8c` (amended 2026-10-26, section 8.3,
  44x44 hit area; hash computed by the parent with `sha256sum` after `node --check` passed).
  - Superseded (section 8.2, 24x24 hard minimum): `d0fa1c028d7a8a427764f9b3e6ecda8928e9eb7a161835ad4bfde8fcdc16413e`.
    T5/T6 passed with a 28x28 checkbox under this hash. That evidence is stale.
  - Superseded (original): `3c7dca8343b03f5ef0d3f52ea7ae322ecf53c4680fc92d9c12857ba8e2e8a236`.
    T4-visual FAILED under this hash.
- `checks/build-check.mjs` sha256: `80b372589dd535e401cadd290739c0827cbdc1619cd5f22409fd4fddab0bfcf7` (unchanged)

### 8.1 Audit of the inherited backlog/contract (this design pass)

Inherited: T1-T6 and 19 checks from the interrupted architect. Audited against R1-R5, DESIGN.md
completion conditions and the web-app profile (test, build, behavior, visual):

| Finding | Action |
| --- | --- |
| Profile kinds were present mission-wide, but R1 and R4 had no visual check, so "screenshots" for add and reload were not verified per requirement. | Added `T1-visual` (visualAdd @375) and `T4-visual` (visualPersist @1280). |
| The final task T6 had no visual check, so the final regression lacked screenshot verification at both viewports. | Added `T6-visual-375` and `T6-visual-1280` (all five visual scenarios per viewport). |
| T5 depended on T3, but `T5-behavior` (reach) reloads and expects the state to survive (R4). | T5 dependencies changed to `["T4"]`. |
| Check selectors/wording were only implicit in the script. | DOM contract made explicit in section 2. |
| `/favicon.ico` 404 would count as a console/network error. | Mandatory `data:,` icon link (section 1). |
| No scope was dropped; all 19 original checks are kept unchanged. | Contract is now 23 checks. |

Validation: `contracts()` from `COMMON/scripts/lib/core.mjs` (the same validator used by
context/verify) accepts the backlog and contract: 6 tasks, 23 checks. Every requirement is covered by
test + behavior + visual, and R1/R5 also by build. Plan digest at the time of writing:
`161448e6312e8ba128d2fe7e844d7aa4b378466054c430d2cf69a14fcf9203fa`.

Not executed in this pass (still UNVERIFIED): the browser and build checks have not been run. The
product does not exist yet, and running the browser check outside `record.mjs` was not permitted in
this session. `node --check` passes for both scripts. The first real `record.mjs --check` run must
confirm that Chromium resolves and that every check fails honestly (nonzero, FAIL assertions)
before implementation starts.

### 8.2 Check amendment: pixel equality after reload (T4-visual, 2026-10-26)

Observed failure (kept on record, not erased): `T4-visual` FAILED at 1280x800 under the superseded
hash on two assertions, "task list pixels identical before/after reload" and "filter bar pixels
identical before/after reload" (`Buffer.equals` on element-screenshot PNGs). The same run passed
"rendered state identical after reload", so DOM, done state and filter marking survived. Evidence:
`.autodev/evidence/T4-visual-9ce69043-cdd8-4bdd-817f-c950ce395eee-1280x800-persist-{list,filters}-{before,after}-reload.png`.
Decoded diffs:

| Pair | Size | Differing px | Share | Max channel delta | Bbox |
| --- | --- | --- | --- | --- | --- |
| run 9ce69043 list | 576x184 | 36 | 0.034% | 1/255 | x532-575 y8-171 |
| run 9ce69043 filters | 576x45 | 7 | 0.027% | 8/255 | x0-203 y3-41 |
| run 60304d43 list | 576x184 | 36 | 0.034% | 1/255 | x532-575 y8-171 |
| run 60304d43 filters | 576x45 | 6 | 0.023% | 1/255 | x202-203 y3-41 |
| T2-visual 300a01db water-plants active vs done (real change) | 480x31 | 629 | 4.227% | 153/255 | x0-94 y13-28 |
| T3-visual 391764fa Active unselected vs selected (real change) | 74x45 vs 79x45 | size differs | - | - | - |

Decision: this is a flaw in the test design, not a product defect. Chromium does not promise
byte-identical rasterisation of the same DOM in a freshly loaded document and in a long-lived one.
Glyph and anti-aliasing caches differ between the two, and so do the antialiased edges of the 6 px
rounded borders. That is where the differing pixels are (right edge of the delete buttons, borders
of the filter buttons). `style.css` has no hover or transition rules, and `settle()` already moves
the mouse away and blurs. No product change could make this deterministic, so changing product
files is not the right fix. The 375px variant passed byte-exactly, which fits renderer noise that
depends on the run.

Amendment (`checks/browser-check.mjs`, new hash in section 8):
- New helpers `decodePng`, `comparePng`, `pixelsSame` and `pixelsDiffer`, plus the constant
  `PIXEL_TOL = { maxDelta: 16, maxShare: 0.005 }`. Byte equality stays the fast path. "Same"
  requires equal size, max per-channel delta <= 16/255 and <= 0.5% of pixels differing. The measured
  numbers are always written into `actual`.
- The tolerance is 16 rather than 8 because 8 was the observed maximum. A limit equal to the
  observed noise would flake. 16/255 (6%) is still far below every real change measured here
  (153/255, or a size change). No bounding-box limit was added: the measured noise is sparse but
  spread over rows (bbox 44x164 px), so a "tiny bbox" rule would reject the noise it exists to absorb.
  The delta and share limits catch real changes on their own.
- R4 is not weakened. `rendered state identical after reload` is unchanged. Three new negative
  controls in `visualPersist` must each be rejected by the same comparison, so a tolerance that is
  too loose turns into a FAIL: (1) the list after ticking one more task (done styling), (2) the list
  under the Active filter after reload (a row is missing), (3) the filter bar with Active marked
  instead of All (filter marking). New captures: `persist-list-control-extra-done`,
  `persist-list-active-after-reload`, `persist-filters-active-after-reload`.
- Applied consistently: the four "pixels differ" assertions (visualDone, visualFilter, visualLayout,
  visualAdd) now use `pixelsDiffer`. These get stricter, because raster noise alone can no longer
  satisfy "differs". No other exact-pixel assertions exist in the file. `build-check.mjs` is unchanged.
- Offline validation of the helper against the real evidence PNGs listed above: all 4 reload pairs
  are within tolerance, both real changes are rejected, an identical pair is accepted, and synthetic
  cases are rejected (a single pixel changed by 216/255; 600 pixels (0.57%) changed by 1/255; a
  non-PNG input gives `error`). `node --check` passes. The amended check has NOT yet been run
  in Chromium through `record.mjs`. Until it is, all browser checks are UNVERIFIED under the new hash.

Consequences: the contract digest covers `checks/`, so every earlier browser-check report (whatever its
status, including both T4-visual FAIL records) is stale against the new digest. They stay in
`.autodev/evidence` as history. All 21 browser-check-backed checks must be re-recorded. The two
build checks are unchanged, but they are re-recorded too if the harness invalidates by contract
digest. `contract.json` (check ids, commands, kinds, requirement refs) and `backlog.json` were
not edited. No requirement was removed or narrowed.

### 8.3 Check amendment: 44x44 hit area for every control (2026-10-26)

Finding (kept on record): section 5 set the touch-target design target for every visible
interactive control at >= 44x44 CSS px, including each task checkbox. But `measureLayout` in
`checks/browser-check.mjs` only failed below 24x24. The wording "44 recommended, check hard minimum
24" let the check accept a weaker condition than the design. A 28x28 checkbox therefore PASSED T5/T6
(`layout` in T5-test/T6-test, and `visualLayout` in T5-visual-*/T6-visual-*) even though the design
target was not met. The completion conditions forbid silently narrowing a design target, so this was
a narrowing in the check (and in the "recommended" wording of section 5/A7), not a product choice.

Change (`checks/browser-check.mjs`, `measureLayout`, the per-control assertion loop only):
- New local constant `MIN_TARGET = 44`. The assertion now requires `c.w >= 44 && c.h >= 44`
  instead of `>= 24`. The assertion name and its `expected` text both say 44x44.
- The measurement is unchanged: the effective hit area is `max(control box, label box)` in each
  dimension (`el.labels[0]`, which covers a wrapping `<label>` around the checkbox). The rest of the
  assertion is unchanged too: the viewport-containment bounds, the 0.5 px edge tolerance, and the
  `elementFromPoint` reachability. The rule applies to every control `measureLayout` collects:
  `#new-todo`, `#add-btn`, the three filter buttons, and every visible `input.toggle` and
  `button.delete`. It applies at both 375x700 (touch) and 1280x800, because `layout` and
  `visualLayout` run at both viewports.
- Nothing else changed: no other scenario, no pixel tolerance (`PIXEL_TOL`), no plan, and no
  `build-check.mjs`. `contract.json` and `backlog.json` were not edited. Section 5, the `layout` row
  in 6.2 and assumption A7 now say 44.

Consequences:
- The check file hash changed (section 8), and the contract digest covers `checks/`. So EVERY
  earlier browser-check report, PASS or FAIL, is stale. All earlier reports stay in
  `.autodev/evidence` as history. That includes the T5/T6 PASS records made under 24x24, which must
  not count as verification of the 44x44 target.
- All tasks T1-T6 must be re-verified by re-recording all 21 browser-check-backed checks through
  `record.mjs`. The two build checks must be re-recorded too if the harness invalidates by contract
  digest.
- The product as last verified (28x28 checkbox) is expected to FAIL T5-test, T5-visual-375,
  T5-visual-1280, T6-test, T6-visual-375 and T6-visual-1280 until the product change lands. That
  change is a wrapping label or padding that gives each checkbox (and any other control under 44 px)
  a >= 44x44 effective hit area. T1-T4 and the behavior checks do not call `measureLayout`. They are
  stale only because of the digest, and must still be re-recorded.
- Not executed in this amendment: `node --check` and hash computation (no shell available to the
  amending agent), and no Chromium run. Status under the new hash: UNVERIFIED.

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| No runnable Chromium in the verifier environment | Script exits 3 without a report -> UNVERIFIED; recorded as environment blocker; set `AUTODEV_CHROMIUM_EXECUTABLE` or `npx playwright install chromium` in COMMON. Never replaced by a screenshot-only or build-only PASS. |
| `/favicon.ico` 404 counted as an error | Mandatory `<link rel="icon" href="data:,">`. |
| T1 fails because filter/counter skeleton missing | Section 2 coupling note; T1 scope includes the skeleton. |
| Counter wording mismatch (`items left`) | Exact wording fixed in section 2 (assumption A1). |
| Long words clip/overflow at 375 px; mobile innerWidth grows when content overflows | `min-width: 0` + `overflow-wrap: anywhere`; no fixed widths; measured by T5/T6. |
| Padding labels/controls to 44x44 pushes rows or the filter bar wider than 375 px | Filter bar wraps (`flex-wrap`); the text column keeps `min-width: 0`; T5/T6 measure overflow and the 44x44 hit area together (section 8.3). |
| Visual pixel comparisons flaky (transitions, caret, focus) | No long transitions; checks blur, move the mouse away and wait 300 ms; Playwright hides the caret; element-level shots. Raster noise between a fresh and a long-lived page (seen at 1280x800, max delta 8/255) is absorbed by the documented tolerance in 6.2, which negative controls prove still rejects real changes (section 8.2). |
| Corrupted storage logs `console.error` or throws | Silent salvage per section 4; every corruption case asserts zero errors. |
| localStorage unavailable/throwing | try/catch, in-memory fallback (assumption A5: not separately checked). |
| Implementer edits checks to pass | Hashes in section 8; reviewers must compare; fingerprint includes `checks/`. |
| Interrupted planning / CLAIMED burst lease | Not touched by this design pass; the parent must resolve the lease (terminal proof -> burst finish -> state recover) before any Workflow continues. `repair-plan.mjs` is NOT needed for content because backlog, contract and now architecture are complete, but lease recovery is still required. |
| Shared harness edited during the run | Do not modify COMMON during the mission (contract digest includes the verifier version). |
| Long check runtimes (T6-test 12 contexts) | Timeouts 120-480 s per check. |

## 10. Assumptions (separate from requirements; none narrows R1-R5)

- A1 Counter text format is `N item left` / `N items left`; R3 only requires the number of active
  tasks, which the check also asserts numerically.
- A2 Storage key `todo-app.v1` and schema `{version, todos[{id,text,done}], filter}` are design choices.
- A3 Salvage policy of section 4 (structurally invalid payload -> full reset; otherwise keep valid
  items, drop invalid ones, default filter `all`) is the interpretation of "must not crash"; the app
  must additionally stay fully usable and rewrite valid data.
- A4 "Console errors" includes `console.error`, uncaught page errors, failed requests and HTTP >= 400
  responses. Warnings are not errors (but the app should not emit any).
- A5 localStorage being unavailable is outside R4's literal scope; it is handled defensively but has no
  dedicated check.
- A6 Tasks are not editable after creation and there is no "clear completed" action; neither was
  requested. Duplicate texts are allowed (checks use unique texts).
- A7 "Reachable" means: inside the viewport when scrolled to, an effective hit area of at least
  44x44 CSS px (amended from 24x24 in section 8.3), not covered (hit-test), and operable by raw
  pointer/touch at its centre.
- A8 Chromium fallback to Playwright's detected binary when `AUTODEV_CHROMIUM_EXECUTABLE` is unset is
  still a real Chromium and is recorded in the report; it is not a weaker verification.

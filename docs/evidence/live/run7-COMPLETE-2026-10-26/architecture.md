# Architecture — mission 2662e4c8-6f54-4cdc-8acd-23554aeb386e

Author role: opus-architect (claude-opus-5-5). Run live-probe-c52977ff-6f83-46ab-8684-77daa98b2328,
attempt c6861861-11d1-4784-88b9-33ddc6c31450. Profile: backend.
Status of every task at time of writing: UNVERIFIED. This document is a plan, not evidence.

## 1. Original mission (verbatim, preserved)

> Implement all four specified functions, independent review, real tests/HTTP, interruption and resume. Do not edit the acceptance tests to weaken them.

Structured requirements (verbatim from `.autodev/mission.json`):

| ID | Text |
| -- | ---- |
| R1 | Addition: add(5,3)=8, add(-1,2)=1. |
| R2 | Division: divide(8,2)=4; division by zero throws. |
| R3 | Greeting: trim names, empty name uses friend; return Hello, NAME. |
| R4 | Clamp returns lower/upper bounds outside range and original value inside. |

Process requirements contained in the original sentence (no machine IDs in mission.json; kept here
so none is dropped, enforced by harness gates rather than product backlog items):

| ID | Requirement | Enforced by |
| -- | ----------- | ----------- |
| P1 | "all four specified functions" | Backlog R1..R4, every one must be PASS; verify.mjs rejects incomplete backlog |
| P2 | "independent review" | Per-task Sonnet reviewer (read-only native agent) + final Sonnet review + Opus final audit, persisted via assess.mjs/assessment.mjs |
| P3 | "real tests/HTTP" | Contract kinds `test` and `api` per task; api check starts a real `node:http` server and performs a real `fetch` with response artifact hash |
| P4 | "interruption and resume" | operation.mjs receipts, next.mjs structured resume, burst/termination proof, checkpoint save/restore; no double-apply of partial edits |
| P5 | "Do not edit the acceptance tests to weaken them" | Acceptance tests live in the common repo (`$AUTODEV_COMMON/examples/api-check.mjs`), outside the target and outside product fingerprint; writers must never modify the common repo or contract assertions; reviewers must flag any contract/test weakening as critical |

## 2. Current product state (observed)

Product file: `autodev-probe/app.mjs` (ES module, four named exports). Observed stubs, all wrong:

- `add=(a,b)=>a-b` (subtracts; R1 fails: add(5,3)=2)
- `divide=(a,b)=>0` (R2 fails: returns 0, never throws)
- `greet=name=>""` (R3 fails)
- `clamp=(n,min,max)=>0` (R4 fails)

Product fingerprint at architecture start: `b3102b4f4b9e5562d95e345f380bcdbd7a707fa97ad27bd2b3441004859ca7a2`.

## 3. Design

Single module `autodev-probe/app.mjs`; keep the export names and signatures unchanged because the
acceptance adapter imports `add`, `divide`, `greet`, `clamp` by name from that exact path.

- R1 `add(a, b)` returns `a + b`.
- R2 `divide(a, b)`: if `b === 0` (covers `-0`) throw an `Error` (RangeError recommended, message
  "Division by zero"); otherwise return `a / b`.
- R3 `greet(name)`: `const n = String(name ?? "").trim();` return `` `Hello, ${n || "friend"}` ``.
  Output format is exactly `Hello, NAME` (comma, single space, no trailing punctuation).
- R4 `clamp(n, min, max)`: `n < min` returns `min`; `n > max` returns `max`; otherwise `n`
  (returned unchanged, i.e. the original value).

No dependencies, no build step, no new packages. The HTTP surface used by the api checks is
provided by the acceptance adapter (GET returns `{sum: add(5,3), greeting: greet(" Ada ")}`), so the
product must keep `add` and `greet` non-throwing for those inputs.

## 4. Backlog, dependencies, acceptance mapping

Backlog (`.autodev/backlog.json`, schema v2) and contract (`.autodev/contract.json`, schema v2) are
retained as published; they already map every original requirement and are executable.

| Task | requirement_refs | dependencies | check_refs (kind) | Acceptance assertions (from adapter, unmodified) |
| ---- | ---------------- | ------------ | ----------------- | ------------------------------------------------ |
| R1 | R1 | none | R1-test (test), R1-api (api) | add(5,3)===8; add(-1,2)===1; real HTTP GET 200 with numeric `sum` |
| R2 | R2 | none | R2-test (test), R2-api (api) | divide(8,2)===4; divide(1,0) throws; real HTTP GET 200 |
| R3 | R3 | none | R3-test (test), R3-api (api) | greet(" Ada ")==="Hello, Ada"; greet(" ")==="Hello, friend"; real HTTP GET 200 |
| R4 | R4 | none | R4-test (test), R4-api (api) | clamp(12,0,10)===10; clamp(-1,0,10)===0; clamp(5,0,10)===5; real HTTP GET 200 |

Check command (all eight): `"$AUTODEV_NODE" "$AUTODEV_COMMON/examples/api-check.mjs"`, timeout 15000 ms.
The adapter selects assertions by `task_id` and adds the real HTTP request when `kind === "api"`,
writes a report plus hashed response artifact, and exits nonzero on any failed assertion.

Dependencies: the four functions are logically independent, so there are no `dependencies` edges.
All four edit the same file, so writers stay serial (protocol rule: write agents run one at a
time). Recommended order: R1, R2, R3, R4 (R1 and R3 feed the HTTP payload used by every api check).

## 5. Milestones

1. M1 — R1 and R2 PASS (task gate: Haiku implement, independent Sonnet review, Sonnet verify of
   R*-test and R*-api with current fingerprint). Opus milestone audit at `milestone_every`=2.
2. M2 — R3 and R4 PASS, then the second milestone audit.
3. Final — final Sonnet review + Opus final audit against current product/contract/executions,
   parent-only termination proof, `state end`, then independent `verify.mjs`.

## 6. Verification and resume rules specific to this mission

- A task is PASS only through `task.mjs --action complete` with current reports; never by hand.
- Any change to `autodev-probe/app.mjs` after review invalidates that review (fingerprint change).
- On interruption, inspect the actual diff of `autodev-probe/app.mjs` against the receipt `before`
  fingerprint before replay; if the function is already implemented, resume at REVIEW, not IMPLEMENT.
- Failure escalation: 2 code failures → Sonnet diagnosis; 4 → Opus replan. Environment/permission
  failures are recorded but do not count as code failures.

## 7. Assumptions (separate from requirements; none removes or narrows a requirement)

- A1: "division by zero throws" means a synchronous thrown `Error` for divisor `0` or `-0`;
  `Infinity`/`NaN` results are not acceptable for zero divisors.
- A2: "empty name" includes whitespace-only strings, `""`, `undefined` and `null`; all yield
  `Hello, friend`. Non-string names are coerced with `String()` before trimming.
- A3: Clamp with `min > max` is unspecified; the implementation keeps the natural order of checks
  (lower bound first) and does not throw. This is not tested and must not be used to claim extra
  behavior.
- A4: Numeric inputs are JavaScript numbers; no BigInt/string-number parsing is required.
- A5: The HTTP requirement is satisfied by the contract's real `node:http` server + `fetch` in the
  acceptance adapter; the mission does not ask for a standalone production server, auth, or
  persistence. If a reviewer/auditor judges a product-owned endpoint necessary, it is added as a new
  backlog task rather than by weakening the existing checks.
- A6: Process requirements P1–P5 are enforced by harness gates and are reported by the final
  review/audit; they have no product code of their own.

## 8. Open items (visible, not hidden)

- All tasks UNVERIFIED; no implementation, review, verification, milestone audit or final audit
  has been performed yet.
- Live model-routing evidence for this architecture stage is imported later by
  checkpoint-architecture (`import-runtime.mjs`); until then architecture provenance is UNVERIFIED.

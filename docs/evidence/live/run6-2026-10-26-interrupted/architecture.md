# Architecture — dream-box (mission d51f216e-f22d-4bc8-9ad8-20d6d324b37c)

Author: opus-architect (claude-opus-5-5), run live-probe-f21e2eee-3442-4142-9a44-407be66cce23,
root attempt 4c76d79a-82f3-4b70-a540-7a90b301d208, profile `backend`.

## 1. Original mission (verbatim, preserved)

> Implement all four specified functions, independent review, real tests/HTTP, interruption and resume. Do not edit the acceptance tests to weaken them.

| ID | Requirement (verbatim) |
| -- | ---------------------- |
| R1 | Addition: add(5,3)=8, add(-1,2)=1. |
| R2 | Division: divide(8,2)=4; division by zero throws. |
| R3 | Greeting: trim names, empty name uses friend; return Hello, NAME. |
| R4 | Clamp returns lower/upper bounds outside range and original value inside. |

Process requirements in the original sentence (not reduced, not converted into product tasks):

| ID | Requirement | How it is satisfied / proven |
| -- | ----------- | ---------------------------- |
| P1 | "Implement all four specified functions" | Backlog tasks R1–R4, each gated by its own checks. COMPLETE needs all four PASS. |
| P2 | "independent review" | A separate Sonnet reviewer (Read/Grep/Glob only) for each task, saved verbatim via assessment.mjs. Plus a final Sonnet review and an Opus final audit tied to the current product/contract/execution. |
| P3 | "real tests/HTTP" | Each task has a `test` check (node:assert) and an `api` check, which starts a real `http` server on 127.0.0.1 and fetches it. Both run through the contract runner, which records a report and the response artifact. |
| P4 | "interruption and resume" | Writer receipts in operations/ (start/complete, stable operation_id), the structured resume from next.mjs, burst claim/attach/finish with terminal+drained proof, and checkpoint save/restore. The task reaches PASS only with real runtime evidence, never by assertion. |
| P5 | "Do not edit the acceptance tests to weaken them" | The acceptance adapter `$AUTODEV_COMMON/examples/api-check.mjs` lives in the read-only common repo. Builders must not change it, the contract commands, or timeouts. Any change to contract.json changes the contract fingerprint and invalidates evidence. |

## 2. Current state (observed, fingerprint b3102b4f…ca7a2)

`autodev-probe/app.mjs` (untracked) exports four functions that are all deliberately wrong:
`add=(a,b)=>a-b`, `divide=()=>0`, `greet=()=>""`, `clamp=()=>0`. All checks are expected to FAIL
before implementation. That failure is the baseline. It is not an error to hide.

## 3. Target design

One ES module, `autodev-probe/app.mjs`, with four pure functions and no dependencies:

- `add(a, b)` returns `a + b`. (R1)
- `divide(a, b)` returns `a / b` and throws an `Error` when `b === 0`. It must not return Infinity or NaN. (R2)
- `greet(name)` trims `name` and returns `` `Hello, ${trimmed || "friend"}` ``. An empty or whitespace-only name becomes "friend". Expected values are `"Hello, Ada"` and `"Hello, friend"`, with no trailing punctuation. (R3)
- `clamp(n, min, max)` returns `min` if `n < min`, `max` if `n > max`, otherwise `n`. (R4)

The exported names and signatures must stay the same, because the acceptance adapter imports them by name. Do not add a build step. Node ESM runs it directly.

## 4. Backlog, dependencies, acceptance mapping

| Task | requirement_refs | dependencies | check_refs | Acceptance (asserted by adapter) |
| ---- | ---------------- | ------------ | ---------- | -------------------------------- |
| R1 | R1 | — | R1-test, R1-api | add(5,3)=8, add(-1,2)=1. HTTP GET returns 200 with numeric `sum` |
| R2 | R2 | — | R2-test, R2-api | divide(8,2)=4, divide(1,0) throws. HTTP 200 JSON |
| R3 | R3 | — | R3-test, R3-api | greet(" Ada ")="Hello, Ada", greet(" ")="Hello, friend". HTTP 200 JSON |
| R4 | R4 | — | R4-test, R4-api | clamp(12,0,10)=10, clamp(-1,0,10)=0, clamp(5,0,10)=5. HTTP 200 JSON |

The tasks are logically independent and have no backlog dependencies. They all edit the same file, though, so writers run one at a time (one sprint at a time, as the protocol requires). Suggested order is R1→R2→R3→R4. R1 goes first because the HTTP payload uses `add` and `greet`.

## 5. Contract (backend profile)

The backend profile requires both `test` and `api` kinds, and every task has both. Every command is
`"$AUTODEV_NODE" "$AUTODEV_COMMON/examples/api-check.mjs"`, with a 15000 ms timeout.
The adapter picks assertions by `task_id`, exits nonzero on any failed assertion, and for `api` it
starts a real HTTP server, saves the response body as a hashed artifact, and asserts status 200
and the payload type. `human_review: false`. No visual or play checks apply (backend profile).

## 6. Milestones

1. M1: R1 and R2 PASS (task gate, independent review, verifier). Opus milestone audit after 2 completions (milestone_every=2).
2. M2: R3 and R4 PASS. Milestone audit.
3. Final: Sonnet final review and Opus final audit on the current fingerprint. Then the parent confirms terminal+drained, runs `state end`, then `verify.mjs`.

## 7. Risks and decisions

- If the adapter is changed to pass, that weakens the tests (P5). A reviewer must flag any diff outside `autodev-probe/app.mjs`.
- `greet` formatting: the adapter expects exactly `Hello, Ada` with no trailing punctuation. "Hello, NAME" in R3 is read the same way.
- `divide` by zero must throw. In JS, `1/0` is Infinity and does not throw, so the explicit guard is required.
- `clamp` with `min > max` is outside the spec. It is not asserted, so it is not invented (see assumptions).
- The HTTP endpoint covers `add` and `greet` only. For R2 and R4, the real-HTTP requirement is met by the shared server round-trip, and their function behavior is checked by the node:assert checks in the same run.

## 8. Assumptions (separate from requirements; none removes a requirement)

- A1: The product file is `autodev-probe/app.mjs` (from the probe adapter's import path). Its untracked status in git is expected for this probe.
- A2: `divide(a, 0)` should throw for any `a`, including `0`. The adapter only checks `1/0`.
- A3: `greet` on non-string input is unspecified. Treating `undefined` or `null` as empty ("friend") is acceptable but is not required.
- A4: `clamp` is inclusive at both bounds. Behavior when `min > max` is unspecified and is left unchanged.
- A5: Interruption/resume (P4) and independent review (P2) are proven by harness runtime evidence (operation receipts, burst proofs, assessments, verify). If that evidence is missing, the result stays UNVERIFIED and is never marked PASS.

## 9. Known open items (kept visible)

- All 8 checks are currently expected to FAIL against the baseline product. None has been run in this architecture step.
- Claude Code V1 real-machine acceptance is UNVERIFIED until the final verify.
- G1 (coverage gap, visible, not hidden): the `api` check's HTTP payload only covers `add` and `greet`. For R2 (divide) and R4 (clamp), real-HTTP coverage is indirect: the round-trip proves the module loads and serves, and the function assertions run in the same process. The adapter is in the read-only common repo and must not be changed by builders (P5). If a reviewer or auditor rules this indirect coverage insufficient for "real tests/HTTP", the gap goes to the Opus milestone audit. It does not become a silent PASS.
- G2: the backend profile names errors, authentication and state changes. The adapter's HTTP endpoint has no auth and no state, and it does not test HTTP error responses. The R2 error path (throw on divide by zero) is asserted only in-process. Authentication and state changes are not applicable to these four pure functions. That is recorded here as an assessment, not as a removed requirement.

## 10. Re-observation log

- Operation `…|architecture|fab169f5…` (same run/attempt): re-read the mission verbatim, the adapter, the backend profile and docs 02/03. architecture.md (before this edit), backlog.json and contract.json matched the hashes recorded by the prior completed operation `…|architecture|b110f90a…`. No partial diff was found, so nothing was replayed. Product fingerprint is unchanged at b3102b4f…ca7a2. Contract fingerprint is a39de8f3…21ce. context.mjs observation_id at re-read was 1c06f012…1f86, which differs from the request's fab169f5…. The difference is recorded, not overwritten.
- backlog.json and contract.json are unchanged. Every requirement R1–R4 maps to one task, and each task has a `test` and an `api` check (backend profile). No check was executed in this step.

# Durability projects

These small projects are authored for regression testing. `tests/durability.test.mjs`
copies each project into a temporary target repository and invokes the real
`record.mjs` runner and independent `verify.mjs` gate.

| Project | Actual checks | Injected defect |
| --- | --- | --- |
| Field notes web app | Three routes, form input, completion state, localStorage after reload, settings, mobile overflow, Chromium screenshot | Saving only in memory loses notes after reload, while static build still succeeds |
| Courier circuit game | Arrow input, parcel progression, loss, restart after loss/win, boundary handling, forty inputs under ten seconds, canvas bounds, screenshot | Parcel collection cannot increase score, while static build still succeeds |
| Existing quote service | Separate pricing/API modules and preserved configuration, legacy tax/currency, new volume discount, invalid input, real HTTP 200/400/404 | Legacy tax regression, then an API integration that bypasses the corrected pricing function |

Each defect must fail before the original implementation is restored. All required
profile checks are then rerun against the restored product, including fresh typed
reports and artifact hashes. A repaired product must reach `TEST_COMPLETE`; the
same evidence must remain `UNVERIFIED` without explicit fixture mode.

The browser, HTTP requests, module assertions, static distribution, images and
timings are real local observations. Reviewer/model/Workflow records are explicitly
`TEST_FIXTURE`, produced by the existing fixture helpers. These tests do not prove
Claude routing, `/goal`, cloud permissions, subjective visual quality, or gameplay
enjoyment. The timing bound detects a severe local input stall; it is not an FPS or
cross-device performance guarantee.

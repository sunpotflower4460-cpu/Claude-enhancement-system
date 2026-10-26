// Live run 5: real models dropped required flags; the CLIs must say which one.
import test from "node:test";
import assert from "node:assert/strict";
import { fixture, allPass } from "./helpers/fixture.mjs";
import { nextAction } from "../scripts/next.mjs";
import { failureAction } from "../scripts/failure.mjs";
import { state } from "../scripts/state.mjs";

test("N1 next.mjs without --run on an active root names the missing argument, not a foreign owner", (t) => {
  const f = fixture(t);
  state({ target: f.target, action: "begin", run: "r1", task: "mission", attempt: "a1" });
  assert.equal(nextAction({ target: f.target }).action, "MISSING_ARGUMENT");
  assert.equal(nextAction({ target: f.target, run: "other" }).action, "WAIT_OR_RECOVER");
  assert.notEqual(nextAction({ target: f.target, run: "r1" }).action, "WAIT_OR_RECOVER");
});
test("N2 failure.mjs without --action fails with a usage message; summary stays read-only", (t) => {
  const f = fixture(t);
  assert.throws(() => failureAction({ target: f.target }), /requires --action summary\|record\|strategy/);
  assert.equal(failureAction({ target: f.target, action: "summary" }).status, "OBSERVED");
});

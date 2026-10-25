import { checkEvidence } from "./verify.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  contracts,
  fingerprint,
  hash,
  json,
  validate,
  mutex,
  main,
  shared,
  binding,
  context,
  evidenceName,
  artifactPath,
} from "./lib/core.mjs";
import { validateReport } from "./lib/reports.mjs";
export function record(o) {
  return mutex(o.target, () => {
    const c = contracts(o.target),
      check = c.contract.checks.find((x) => x.id === o.check);
    if (!check) throw Error("Unknown check");
    const task = c.backlog.items.find((x) => x.id === check.task_id),
      ctx = context(c, task),
      nonce = crypto.randomUUID(),
      reportName = hash(check.id) + ".report.json",
      reportPath = artifactPath(c.dir, reportName);
    // A previous result cannot be silently reused by a successful placeholder command.
    fs.rmSync(reportPath, { force: true });
    const before = fingerprint(o.target),
      started = new Date().toISOString();
    const commandContext = {
      ...ctx,
      kind: check.kind,
      check_id: check.id,
      nonce,
    };
    const runner = spawnSync(
      process.execPath,
      [
        path.join(shared, "scripts/lib/run-check.mjs"),
        check.command,
        String(check.timeout_ms),
      ],
      {
        cwd: c.session.root,
        encoding: "utf8",
        timeout: check.timeout_ms + 5000,
        maxBuffer: 24 * 1024 * 1024,
        env: {
          ...process.env,
          AUTODEV_CHECK_CONTEXT: JSON.stringify(commandContext),
          AUTODEV_REPORT_PATH: reportPath,
          AUTODEV_RUNNER_STATE: artifactPath(
            c.dir,
            "runner-" + nonce + ".json",
          ),
        },
      },
    );
    if (runner.status !== 0)
      throw Error(
        "Check runner failed: " + (runner.error?.message || runner.stderr),
      );
    const result = JSON.parse(runner.stdout),
      output =
        (result.stdout || "") +
        (result.stderr || "") +
        (result.error?.message || ""),
      logName = hash(check.id) + ".log";
    fs.writeFileSync(artifactPath(c.dir, logName), output);
    let report = null,
      report_error = null;
    try {
      report = {
        path: reportName,
        sha256: hash(fs.readFileSync(reportPath)),
        media_type: "application/json",
      };
      validateReport(c, report, commandContext);
    } catch (e) {
      report = null;
      report_error = e.message;
    }
    const after = contracts(o.target),
      e = validate("evidence", {
        version: 2,
        check_id: check.id,
        kind: check.kind,
        nonce,
        ...ctx,
        product: before,
        contract: c.digest,
        identity: binding(c),
        started,
        ended: new Date().toISOString(),
        command: check.command,
        exit_code: result.error ? null : result.status,
        signal: result.signal,
        stable: before === fingerprint(o.target) && c.digest === after.digest,
        log: logName,
        log_hash: hash(output),
        environment: `${process.platform}/${process.arch} node ${process.version}`,
        report,
        report_error,
      });
    json(artifactPath(c.dir, evidenceName(check.id)), e);
    return e;
  });
}
if (process.argv[1] === new URL(import.meta.url).pathname)
  main((o) => {
    const e = record(o);
    const c = contracts(o.target),
      check = c.contract.checks.find((x) => x.id === o.check),
      result = checkEvidence(c, check, fingerprint(o.target));
    console.log(JSON.stringify({ ...e, check_status: result.status }, null, 2));
    if (result.status !== "PASS") process.exitCode = 1;
  });

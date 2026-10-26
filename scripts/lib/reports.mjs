import fs from "node:fs";
import { validate, artifactPath, hash, read } from "./core.mjs";
export function validateReport(c, ref, expected) {
  const raw = fs.readFileSync(artifactPath(c.dir, ref.path));
  if (hash(raw) !== ref.sha256) throw Error("Report changed");
  const r = validate("report", JSON.parse(raw));
  for (const [k, v] of Object.entries(expected))
    if (r[k] !== v) throw Error("Report context mismatch: " + k);
  for (const a of r.artifacts) {
    if (hash(fs.readFileSync(artifactPath(c.dir, a.path))) !== a.sha256)
      throw Error("Artifact changed/missing: " + a.path);
  }
  const files = new Map(r.artifacts.map((a) => [a.path, a]));
  if (files.size !== r.artifacts.length) throw Error("Duplicate artifact path");
  if (r.kind === "test") {
    const d = r.details;
    if (d.passed + d.failed + d.skipped !== d.total)
      throw Error("No executed passing tests");
    if (d.failed > 0) return { status: "FAIL", report: r };
    if (d.passed < 1) throw Error("No executed passing tests");
  }
  if (r.kind === "build") {
    if (r.details.exit_code !== 0) return { status: "FAIL", report: r };
    if (r.details.outputs.some((n) => !files.has(n)))
      throw Error("Build output missing");
  }
  if (
    r.kind === "api" &&
    r.details.requests.some(
      (x) =>
        !files.has(x.response_artifact) ||
        files.get(x.response_artifact).sha256 !== x.response_sha256,
    )
  )
    throw Error("API response artifact missing/mismatched");
  if (
    r.kind === "api" &&
    r.details.requests.some((x) => x.status !== x.expected_status)
  )
    return { status: "FAIL", report: r };
  if (
    r.kind === "behavior" &&
    r.details.actions.some((x) => x.after !== x.expected)
  )
    return { status: "FAIL", report: r };
  if (["visual", "play"].includes(r.kind)) {
    if (
      r.details.captures.some(
        (n) => !files.has(n) || !files.get(n).media_type.startsWith("image/"),
      )
    )
      throw Error("Actual image capture required");
    for (const n of r.details.captures) {
      const b = fs.readFileSync(artifactPath(c.dir, n));
      const png = b
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        jpeg = b[0] === 255 && b[1] === 216;
      if (!png && !jpeg) throw Error("Capture is not a supported image");
    }
  }
  if (r.kind === "play" && r.details.outcome !== r.details.expected_outcome)
    return { status: "FAIL", report: r };
  const status = r.assertions.some((a) => a.status === "FAIL")
    ? "FAIL"
    : r.assertions.some((a) => a.status !== "PASS")
      ? "UNVERIFIED"
      : "PASS";
  return { status, report: r };
}
// Interface for trusted test frameworks/browser runners. Results are produced by actual assertions.
export function writeReport({ tool, assertions, artifacts = [], details }) {
  const env = JSON.parse(process.env.AUTODEV_CHECK_CONTEXT || "null");
  if (!env || !process.env.AUTODEV_REPORT_PATH)
    throw Error("Run via record.mjs");
  const report = validate("report", {
    version: 2,
    ...env,
    tool,
    assertions,
    artifacts,
    details,
  });
  fs.writeFileSync(
    process.env.AUTODEV_REPORT_PATH,
    JSON.stringify(report, null, 2) + "\n",
  );
  return report;
}

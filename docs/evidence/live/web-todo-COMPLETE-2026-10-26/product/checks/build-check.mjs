// Planner-owned "build" acceptance check for the dependency-free static app (Opus initial plan).
// There is no build step by design; this check proves the shippable static bundle instead:
// index.html/style.css/app.js exist at the repository root, app.js parses as a classic script,
// index.html links them relatively with a device-width viewport, nothing is loaded from the network,
// and no npm dependency/node_modules is present. The shipped files are copied into the evidence
// directory and hashed. A passing build is NOT behaviour verification (see the browser checks).
// Implementers MUST NOT edit this file; run only via `record.mjs --check ID`.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const COMMON = process.env.AUTODEV_COMMON;
const env = JSON.parse(process.env.AUTODEV_CHECK_CONTEXT || "null");
if (!COMMON || !env || !process.env.AUTODEV_REPORT_PATH) {
  console.error("Run through record.mjs: AUTODEV_COMMON, AUTODEV_CHECK_CONTEXT and AUTODEV_REPORT_PATH are required");
  process.exit(2);
}
if (env.kind !== "build") {
  console.error("build-check.mjs only serves kind=build, got " + env.kind);
  process.exit(2);
}
const { writeReport } = await import(pathToFileURL(path.join(COMMON, "scripts/lib/reports.mjs")).href);
const ROOT = process.cwd();
const OUT = path.dirname(process.env.AUTODEV_REPORT_PATH);
const assertions = [],
  artifacts = [],
  outputs = [];
const ok = (name, condition, actual, expected) =>
  assertions.push({ name, status: condition ? "PASS" : "FAIL", expected: String(expected), actual: String(actual) || '""' });
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const read = (f) => (fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f)) : null);

const files = { "index.html": read("index.html"), "style.css": read("style.css"), "app.js": read("app.js") };
for (const [name, bytes] of Object.entries(files)) {
  ok(`${name} exists at the repository root and is non-empty`, bytes && bytes.length > 0, bytes ? `${bytes.length} bytes` : "missing", "non-empty file");
  if (bytes) {
    const file = `${env.check_id}-${env.nonce}-${name}`;
    fs.writeFileSync(path.join(OUT, file), bytes);
    artifacts.push({ path: file, sha256: sha(bytes), media_type: name.endsWith(".html") ? "text/html" : name.endsWith(".css") ? "text/css" : "text/javascript" });
    outputs.push(file);
  }
}
const html = files["index.html"]?.toString("utf8") || "";
const js = files["app.js"]?.toString("utf8") || "";
const css = files["style.css"]?.toString("utf8") || "";
ok("index.html starts with <!doctype html>", /^\s*<!doctype html>/i.test(html), html.slice(0, 20), "<!doctype html>");
ok("index.html has a device-width viewport meta", /<meta[^>]+name=["']viewport["'][^>]+width\s*=\s*device-width/i.test(html), (html.match(/<meta[^>]+viewport[^>]*>/i) || ["none"])[0], "meta viewport width=device-width");
ok("index.html links style.css relatively", /<link[^>]+rel=["']stylesheet["'][^>]+href=["'](\.\/)?style\.css["']/i.test(html) || /<link[^>]+href=["'](\.\/)?style\.css["'][^>]+rel=["']stylesheet["']/i.test(html), (html.match(/<link[^>]*stylesheet[^>]*>/i) || ["none"])[0], 'link rel="stylesheet" href="style.css"');
const scriptTag = (html.match(/<script[^>]*src=["'](\.\/)?app\.js["'][^>]*>/i) || [""])[0];
ok("index.html loads app.js as a classic script", scriptTag !== "" && !/type=["']module["']/i.test(scriptTag), scriptTag || "none", '<script src="app.js" defer>');
const remote = [...html.matchAll(/(?:src|href)\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi), ...css.matchAll(/url\(\s*["']?((?:https?:)?\/\/[^)"']+)/gi), ...css.matchAll(/@import\s+["']?((?:https?:)?\/\/[^"';]+)/gi)].map((m) => m[1]);
ok("no network-loaded resources (dependency-free)", remote.length === 0, remote.join(", ") || "none", "none");
let parse = "ok";
try {
  new vm.Script(js, { filename: "app.js" });
} catch (e) {
  parse = e.message;
}
ok("app.js parses as a classic browser script", js.length > 0 && parse === "ok", js.length ? parse : "app.js missing", "ok");
const modules = [...js.matchAll(/\brequire\s*\(|^\s*import\s[^(]|^\s*export\s/gm)].length;
ok("app.js uses no require/import/export", modules === 0, `${modules} occurrence(s)`, "0 occurrence(s)");
ok("no node_modules directory in the product", !fs.existsSync(path.join(ROOT, "node_modules")), fs.existsSync(path.join(ROOT, "node_modules")) ? "present" : "absent", "absent");
const pkg = read("package.json");
let deps = "no package.json";
if (pkg) {
  try {
    const p = JSON.parse(pkg);
    deps = Object.keys({ ...p.dependencies, ...p.devDependencies, ...p.optionalDependencies, ...p.peerDependencies }).join(",") || "none";
  } catch (e) {
    deps = "invalid package.json: " + e.message;
  }
}
ok("no npm package dependencies", deps === "no package.json" || deps === "none", deps, "no package.json or no dependencies");

const manifest = Buffer.from(
  JSON.stringify({ files: Object.fromEntries(Object.entries(files).map(([n, b]) => [n, b ? sha(b) : null])), remote, parse }, null, 2) + "\n",
);
const manifestName = `${env.check_id}-${env.nonce}-manifest.json`;
fs.writeFileSync(path.join(OUT, manifestName), manifest);
artifacts.push({ path: manifestName, sha256: sha(manifest), media_type: "application/json" });
outputs.push(manifestName);
const failed = assertions.some((a) => a.status !== "PASS");
writeReport({
  tool: { name: "node static-bundle check", version: process.version },
  assertions,
  artifacts,
  details: { exit_code: failed ? 1 : 0, outputs },
});
console.log(JSON.stringify({ check: env.check_id, failed: assertions.filter((a) => a.status !== "PASS").map((a) => a.name) }));
if (failed) process.exitCode = 1;

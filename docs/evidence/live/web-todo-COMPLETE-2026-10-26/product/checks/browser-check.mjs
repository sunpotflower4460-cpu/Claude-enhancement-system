// Planner-owned acceptance checks for the web-todo mission (Opus initial plan, run1/root1).
// Implementers (Haiku/Sonnet) MUST NOT edit this file to make a check pass; reviewers compare it
// against the sha256 recorded in .autodev/architecture.md. It is run only through
// `record.mjs --check ID`, which supplies AUTODEV_COMMON, AUTODEV_CHECK_CONTEXT and AUTODEV_REPORT_PATH.
//
// Every scenario drives a real Chromium through Playwright (from the shared harness's node_modules,
// the product itself stays dependency-free): real typed key events, real clicks/taps, real reloads,
// 375x700 (mobile, touch, isMobile) and 1280x800 viewports, console/page/network error capture and
// PNG screenshots written next to the report. Missing Chromium => no report => UNVERIFIED (exit 3).
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";

const COMMON = process.env.AUTODEV_COMMON;
const env = JSON.parse(process.env.AUTODEV_CHECK_CONTEXT || "null");
if (!COMMON || !env || !process.env.AUTODEV_REPORT_PATH) {
  console.error(
    "Run through record.mjs: AUTODEV_COMMON, AUTODEV_CHECK_CONTEXT and AUTODEV_REPORT_PATH are required",
  );
  process.exit(2);
}
const { writeReport } = await import(
  pathToFileURL(path.join(COMMON, "scripts/lib/reports.mjs")).href
);
const playwrightDir = path.join(COMMON, "node_modules/playwright");
const { chromium } = await import(
  pathToFileURL(path.join(playwrightDir, "index.mjs")).href
);
const playwrightVersion = JSON.parse(
  fs.readFileSync(path.join(playwrightDir, "package.json"), "utf8"),
).version;
const ROOT = fs.realpathSync(process.cwd());
const OUT = path.dirname(process.env.AUTODEV_REPORT_PATH);
const STORAGE_KEY = "todo-app.v1";

// ---------------------------------------------------------------- Chromium resolution
// 1. AUTODEV_CHROMIUM_EXECUTABLE, when set and executable.
// 2. Otherwise Playwright's own detection (chromium.executablePath()), when that file exists.
// 3. Otherwise no browser: exit 3 without a report (record/verify => UNVERIFIED). Never faked.
function resolveChromium() {
  const notes = [];
  const configured = process.env.AUTODEV_CHROMIUM_EXECUTABLE;
  if (configured) {
    try {
      fs.accessSync(configured, fs.constants.X_OK);
      if (fs.statSync(configured).isFile())
        return { executablePath: configured, source: "AUTODEV_CHROMIUM_EXECUTABLE", notes };
      notes.push(`AUTODEV_CHROMIUM_EXECUTABLE=${configured} is not a regular file`);
    } catch (e) {
      notes.push(`AUTODEV_CHROMIUM_EXECUTABLE=${configured} is not executable (${e.code})`);
    }
  } else notes.push("AUTODEV_CHROMIUM_EXECUTABLE is not set");
  let detected = null;
  try {
    detected = chromium.executablePath();
  } catch (e) {
    notes.push("Playwright detection failed: " + e.message.split("\n")[0]);
  }
  if (detected && fs.existsSync(detected))
    return { executablePath: detected, source: "playwright-detected", notes };
  notes.push(`Playwright-detected Chromium missing: ${detected}`);
  return { error: notes.join("; ") };
}

// ---------------------------------------------------------------- static server (product root only)
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};
const HIDDEN = new Set([".git", ".autodev", "checks", "node_modules"]);
const served = [];
const server = http.createServer((req, res) => {
  let status = 200;
  try {
    let rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.resolve(ROOT, "." + rel);
    const top = path.relative(ROOT, file).split(path.sep)[0];
    if (req.method !== "GET" && req.method !== "HEAD") status = 405;
    else if (
      !file.startsWith(ROOT + path.sep) ||
      HIDDEN.has(top) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    )
      status = 404;
    if (status !== 200) {
      res.statusCode = status;
      res.end();
    } else {
      res.setHeader("content-type", TYPES[path.extname(file)] || "application/octet-stream");
      res.setHeader("cache-control", "no-store");
      res.end(req.method === "HEAD" ? undefined : fs.readFileSync(file));
    }
  } catch {
    status = 400;
    res.statusCode = 400;
    res.end();
  }
  served.push(`${req.method} ${req.url} ${status}`);
});

// ---------------------------------------------------------------- result collection
const assertions = [],
  actions = [],
  artifacts = [],
  captures = [],
  inspections = [];
const show = (v) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s === undefined ? "undefined" : s.length ? s : '""';
};
function expect(name, actual, expected) {
  const a = show(actual),
    e = show(expected);
  assertions.push({ name, status: a === e ? "PASS" : "FAIL", expected: e, actual: a });
  return a === e;
}
function ok(name, condition, actual, expected = "true") {
  assertions.push({
    name,
    status: condition ? "PASS" : "FAIL",
    expected: show(expected),
    actual: show(actual === undefined ? Boolean(condition) : actual),
  });
  return Boolean(condition);
}
const firstLine = (e) => String(e?.message || e).split("\n")[0];

// ---------------------------------------------------------------- browser sessions
const MOBILE = {
  label: "375x700",
  viewport: { width: 375, height: 700 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
};
const DESKTOP = {
  label: "1280x800",
  viewport: { width: 1280, height: 800 },
  isMobile: false,
  hasTouch: false,
  deviceScaleFactor: 1,
};
let browser, origin;
async function open(vp) {
  const context = await browser.newContext({
    viewport: vp.viewport,
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    deviceScaleFactor: vp.deviceScaleFactor,
  });
  const s = { vp, L: vp.label, context, errors: [], status: 0, page: null };
  s.newPage = async () => {
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on("console", (m) => {
      if (m.type() === "error") s.errors.push("console.error: " + m.text());
    });
    page.on("pageerror", (e) => s.errors.push("pageerror: " + firstLine(e)));
    page.on("requestfailed", (r) =>
      s.errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText || ""}`),
    );
    page.on("response", (r) => {
      if (r.status() >= 400) s.errors.push(`http ${r.status()}: ${r.url()}`);
    });
    const response = await page.goto(origin + "/", { waitUntil: "load" });
    s.status = response ? response.status() : 0;
    s.page = page;
    return page;
  };
  await s.newPage();
  return s;
}
async function press(s, locator) {
  if (s.vp.hasTouch) await locator.tap();
  else await locator.click();
}
async function typeTask(s, text) {
  await press(s, s.page.locator("#new-todo"));
  await s.page.keyboard.press("ControlOrMeta+A");
  await s.page.keyboard.press("Backspace");
  if (text) await s.page.keyboard.type(text, { delay: 5 });
}
async function addEnter(s, text) {
  await typeTask(s, text);
  await s.page.keyboard.press("Enter");
}
async function addButton(s, text) {
  await typeTask(s, text);
  await press(s, s.page.locator("#add-btn"));
}
async function item(s, text) {
  const i = await s.page.evaluate(
    (t) =>
      [...document.querySelectorAll("#todo-list li.todo-item")].findIndex(
        (li) => li.querySelector(".todo-text")?.textContent === t,
      ),
    text,
  );
  if (i < 0) throw Error(`No rendered task "${text}"`);
  return s.page.locator("#todo-list li.todo-item").nth(i);
}
const toggle = async (s, text) => press(s, (await item(s, text)).locator("input.toggle"));
const remove = async (s, text) => press(s, (await item(s, text)).locator("button.delete"));
const filter = async (s, f) => press(s, s.page.locator(`#filters [data-filter="${f}"]`));
async function reload(s) {
  const r = await s.page.reload({ waitUntil: "load" });
  s.status = r ? r.status() : 0;
}
// Real pointer at the element's centre (no Playwright actionability help): proves reachability.
async function pointAt(s, locator, name) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  if (!b) throw Error(`${name} is not rendered`);
  const { width, height } = s.vp.viewport;
  ok(
    `[${s.L}] ${name} lies inside the viewport when scrolled to`,
    b.x >= 0 && b.y >= 0 && b.x + b.width <= width + 0.5 && b.y + b.height <= height + 0.5,
    `x=${b.x.toFixed(1)} y=${b.y.toFixed(1)} w=${b.width.toFixed(1)} h=${b.height.toFixed(1)}`,
    `inside ${width}x${height}`,
  );
  const x = b.x + b.width / 2,
    y = b.y + b.height / 2;
  if (s.vp.hasTouch) await s.page.touchscreen.tap(x, y);
  else await s.page.mouse.click(x, y);
}
async function settle(s) {
  await s.page.mouse.move(0, 0);
  await s.page.evaluate(() => document.activeElement?.blur?.());
  await s.page.waitForTimeout(300); // let CSS transitions finish before pixel comparisons
}
async function observe(s) {
  return s.page.evaluate(() => {
    const vis = (el) =>
      !!el &&
      (el.checkVisibility
        ? el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: false })
        : el.offsetParent !== null);
    const items = [...document.querySelectorAll("#todo-list li.todo-item")].map((li) => ({
      text: li.querySelector(".todo-text")?.textContent ?? null,
      done: li.querySelector("input.toggle")?.checked ?? null,
      doneClass: li.classList.contains("done"),
      visible: vis(li),
    }));
    const pressed = [...document.querySelectorAll("#filters [data-filter]")]
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.dataset.filter);
    const counter = document.querySelector("#counter");
    return {
      items,
      filter: pressed.join("+") || "none",
      counter: counter ? counter.textContent.trim().replace(/\s+/g, " ") : "(no #counter)",
      input: document.querySelector("#new-todo")?.value ?? null,
    };
  });
}
const counterText = (n) => `${n} item${n === 1 ? "" : "s"} left`;
function describe(o) {
  const list =
    o.items
      .filter((i) => i.visible)
      .map((i) => `${i.done ? "[x]" : "[ ]"} ${i.text}`)
      .join(" | ") || "(none)";
  return `visible: ${list}; filter=${o.filter}; counter=${o.counter}`;
}
// Independent oracle of the required behaviour (R1-R4).
class Model {
  constructor(items = [], filter = "all") {
    this.items = items.map((i) => ({ ...i }));
    this.filter = filter;
  }
  add(text) {
    const t = text.trim();
    if (t) this.items.push({ text: t, done: false });
  }
  toggle(text) {
    const i = this.items.find((x) => x.text === text);
    i.done = !i.done;
  }
  remove(text) {
    this.items = this.items.filter((x) => x.text !== text);
  }
  visible() {
    return this.items.filter(
      (i) => this.filter === "all" || (this.filter === "done") === i.done,
    );
  }
  describe() {
    const list =
      this.visible()
        .map((i) => `${i.done ? "[x]" : "[ ]"} ${i.text}`)
        .join(" | ") || "(none)";
    return `visible: ${list}; filter=${this.filter}; counter=${counterText(
      this.items.filter((i) => !i.done).length,
    )}`;
  }
}
async function act(s, input, fn, model) {
  let before;
  try {
    before = describe(await observe(s));
  } catch (e) {
    before = "ERROR: " + firstLine(e);
  }
  let after;
  try {
    await fn();
    after = describe(await observe(s));
  } catch (e) {
    after = "ERROR: " + firstLine(e);
  }
  const expected = model.describe();
  actions.push({ input: `[${s.L}] ${input}`, before, after, expected });
  expect(`[${s.L}] ${input}`, after, expected);
  return after === expected;
}
async function doneClassConsistent(s) {
  const o = await observe(s);
  expect(
    `[${s.L}] li.done class matches checkbox state for every task`,
    o.items.map((i) => i.doneClass === i.done),
    o.items.map(() => true),
  );
}
async function errorsAction(s, label = "collect console/page/network errors so far") {
  const after = s.errors.length ? "errors: " + s.errors.join(" || ") : "errors: none";
  actions.push({ input: `[${s.L}] ${label}`, before: "page in use", after, expected: "errors: none" });
}
async function capture(s, name, opts = {}) {
  const file = `${env.check_id}-${env.nonce}-${s.L}-${name}.png`;
  const target = opts.locator || s.page;
  const bytes = await target.screenshot({
    path: path.join(OUT, file),
    ...(opts.locator ? {} : { fullPage: opts.fullPage !== false }),
  });
  artifacts.push({
    path: file,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    media_type: "image/png",
  });
  captures.push(file);
  return bytes;
}
const pngWidth = (b) => b.readUInt32BE(16);
// Pixel comparison of two PNG screenshots. Byte equality is the fast path. Otherwise both PNGs are
// decoded (8-bit RGB/RGBA, non-interlaced, as Chromium writes them) and compared per pixel.
// "Same within tolerance" requires: equal width and height, every channel delta <= PIXEL_TOL.maxDelta,
// and at most PIXEL_TOL.maxShare of the pixels differing at all. Measured reload raster noise at
// 1280x800: max delta 1-8/255 on <= 0.03% of the pixels; a real done-style change on the same element:
// delta 153 on 4.2%; a filter-marking change or a missing row changes the image size.
// A PNG that cannot be decoded is reported as "error" and fails both similarity and difference checks.
const PIXEL_TOL = { maxDelta: 16, maxShare: 0.005 };
function decodePng(b) {
  if (b.readUInt32BE(0) !== 0x89504e47) throw Error("not a PNG");
  let p = 8, w = 0, h = 0, ct = -1;
  const idat = [];
  while (p + 8 <= b.length) {
    const len = b.readUInt32BE(p), type = b.toString("ascii", p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9];
      if (d[8] !== 8 || d[12] !== 0 || (ct !== 2 && ct !== 6)) throw Error(`unsupported PNG depth=${d[8]} colour=${ct} interlace=${d[12]}`);
    } else if (type === "IDAT") idat.push(d);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length < h * (stride + 1)) throw Error("truncated PNG data");
  const px = Buffer.alloc(w * h * 4, 255);
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, up = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) {
        const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      } else if (f !== 0) throw Error("bad PNG filter " + f);
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < bpp; k++) px[(y * w + x) * 4 + k] = cur[x * bpp + k];
    [prev, cur] = [cur, prev];
  }
  return { w, h, px };
}
function comparePng(a, b) {
  if (a.equals(b)) return { verdict: "identical", text: "identical bytes" };
  let A, B;
  try {
    A = decodePng(a);
    B = decodePng(b);
  } catch (e) {
    return { verdict: "error", text: "PNG decode failed: " + firstLine(e) };
  }
  if (A.w !== B.w || A.h !== B.h) return { verdict: "differs", text: `size differs: ${A.w}x${A.h} vs ${B.w}x${B.h}` };
  let n = 0, max = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let i = 0; i < A.w * A.h; i++) {
    let d = 0;
    for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(A.px[i * 4 + k] - B.px[i * 4 + k]));
    if (!d) continue;
    n++; max = Math.max(max, d);
    const x = i % A.w, y = (i / A.w) | 0;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const share = n / (A.w * A.h);
  const stats = `${n} of ${A.w}x${A.h} pixels differ (${(share * 100).toFixed(3)}%), max channel delta ${max}/255, bbox ${n ? `x${x0}-${x1} y${y0}-${y1}` : "none"}`;
  const within = max <= PIXEL_TOL.maxDelta && share <= PIXEL_TOL.maxShare;
  return { verdict: within ? "within-tolerance" : "differs", text: (within ? "within tolerance: " : "differs: ") + stats };
}
const SAME_EXPECTED = `identical bytes, or same size with max channel delta <= ${PIXEL_TOL.maxDelta}/255 and <= ${PIXEL_TOL.maxShare * 100}% of pixels differing`;
const DIFF_EXPECTED = `differs beyond tolerance (size change, or max channel delta > ${PIXEL_TOL.maxDelta}/255, or > ${PIXEL_TOL.maxShare * 100}% of pixels differing)`;
function pixelsSame(name, a, b) {
  const r = comparePng(a, b);
  return ok(name, r.verdict === "identical" || r.verdict === "within-tolerance", r.text, SAME_EXPECTED);
}
function pixelsDiffer(name, a, b) {
  const r = comparePng(a, b);
  return ok(name, r.verdict === "differs", r.text, DIFF_EXPECTED);
}
async function styleOf(locator, props) {
  return locator.evaluate(
    (el, ps) => {
      const cs = getComputedStyle(el);
      return Object.fromEntries(ps.map((p) => [p, cs[p]]));
    },
    props,
  );
}
async function loaded(s) {
  expect(`[${s.L}] index.html served with HTTP 200`, s.status, 200);
  expect(
    `[${s.L}] #new-todo is a visible text input`,
    await s.page
      .locator("#new-todo")
      .evaluate((el) => `${el.tagName}/${el.type}/${el.checkVisibility()}`)
      .catch((e) => "missing: " + firstLine(e)),
    "INPUT/text/true",
  );
  expect(
    `[${s.L}] #add-btn is a visible button`,
    await s.page
      .locator("#add-btn")
      .evaluate((el) => `${el.tagName}/${el.checkVisibility()}`)
      .catch((e) => "missing: " + firstLine(e)),
    "BUTTON/true",
  );
}

// ---------------------------------------------------------------- R1 add
async function scenarioAdd(s) {
  const m = new Model();
  await loaded(s);
  expect(`[${s.L}] initial empty state`, describe(await observe(s)), m.describe());
  m.add("  Buy milk  ");
  await act(s, 'type "  Buy milk  " and press Enter', () => addEnter(s, "  Buy milk  "), m);
  expect(`[${s.L}] input is cleared after a successful add`, (await observe(s)).input, "");
  m.add("Walk the dog");
  await act(s, 'type "Walk the dog" and press the Add button', () => addButton(s, "Walk the dog"), m);
  await act(s, "press Enter with an empty input", () => addEnter(s, ""), m);
  await act(s, 'type "     " (spaces only) and press Enter', () => addEnter(s, "     "), m);
  await act(s, 'type "   " (spaces only) and press the Add button', () => addButton(s, "   "), m);
  m.add("<b>Pay</b> rent & bills");
  await act(s, 'type "<b>Pay</b> rent & bills" and press Enter', () => addEnter(s, "<b>Pay</b> rent & bills"), m);
  expect(
    `[${s.L}] typed text is rendered literally (no HTML injection)`,
    await s.page.locator("#todo-list b").count(),
    0,
  );
  m.add("Call mom");
  await act(s, 'type "Call mom" and press Enter', () => addEnter(s, "Call mom"), m);
  expect(
    `[${s.L}] tasks are appended in input order`,
    (await observe(s)).items.map((i) => i.text),
    ["Buy milk", "Walk the dog", "<b>Pay</b> rent & bills", "Call mom"],
  );
}

// ---------------------------------------------------------------- R2 complete / delete
const TEXT_STYLE = ["textDecorationLine", "color", "opacity", "fontStyle", "backgroundColor"];
async function scenarioComplete(s) {
  const m = new Model();
  await loaded(s);
  for (const t of ["Read book", "Water plants", "Call mom"]) {
    m.add(t);
    await act(s, `type "${t}" and press Enter`, () => addEnter(s, t), m);
  }
  const structure = await s.page.evaluate(() =>
    [...document.querySelectorAll("#todo-list li.todo-item")].map((li) => {
      const boxes = li.querySelectorAll('input.toggle[type="checkbox"]');
      const dels = li.querySelectorAll("button.delete");
      const name = dels[0] ? (dels[0].getAttribute("aria-label") || dels[0].textContent).trim() : "";
      return `${boxes.length} checkbox/${dels.length} delete/named=${name.length > 0}`;
    }),
  );
  expect(
    `[${s.L}] each task has one checkbox and one named delete button`,
    structure,
    ["1 checkbox/1 delete/named=true", "1 checkbox/1 delete/named=true", "1 checkbox/1 delete/named=true"],
  );
  m.toggle("Water plants");
  await act(s, 'tick the checkbox of "Water plants"', () => toggle(s, "Water plants"), m);
  await doneClassConsistent(s);
  await settle(s);
  const activeStyle = await styleOf((await item(s, "Read book")).locator(".todo-text"), TEXT_STYLE);
  const doneStyle = await styleOf((await item(s, "Water plants")).locator(".todo-text"), TEXT_STYLE);
  ok(
    `[${s.L}] a done task is visually distinguishable from an active one (computed style)`,
    JSON.stringify(activeStyle) !== JSON.stringify(doneStyle),
    `active=${JSON.stringify(activeStyle)} done=${JSON.stringify(doneStyle)}`,
    "computed styles differ",
  );
  m.toggle("Water plants");
  await act(s, 'untick the checkbox of "Water plants"', () => toggle(s, "Water plants"), m);
  await settle(s);
  expect(
    `[${s.L}] an un-ticked task looks like an active task again`,
    await styleOf((await item(s, "Water plants")).locator(".todo-text"), TEXT_STYLE),
    activeStyle,
  );
  m.toggle("Water plants");
  await act(s, 'tick "Water plants" again', () => toggle(s, "Water plants"), m);
  m.remove("Read book");
  await act(s, 'press the delete button of "Read book"', () => remove(s, "Read book"), m);
  m.remove("Water plants");
  await act(s, 'press the delete button of done task "Water plants"', () => remove(s, "Water plants"), m);
  m.toggle("Call mom");
  await act(s, 'tick "Call mom"', () => toggle(s, "Call mom"), m);
  m.remove("Call mom");
  await act(s, 'press the delete button of "Call mom"', () => remove(s, "Call mom"), m);
  await doneClassConsistent(s);
}

// ---------------------------------------------------------------- R3 filter / counter
async function filterMarking(s, expected) {
  const o = await observe(s);
  expect(`[${s.L}] exactly the "${expected}" filter is marked aria-pressed=true`, o.filter, expected);
}
async function scenarioFilter(s) {
  const m = new Model();
  await loaded(s);
  expect(
    `[${s.L}] filter controls are labelled All / Active / Done`,
    await s.page.evaluate(() =>
      ["all", "active", "done"].map(
        (f) => document.querySelector(`#filters [data-filter="${f}"]`)?.textContent.trim() ?? "missing",
      ),
    ),
    ["All", "Active", "Done"],
  );
  await filterMarking(s, "all");
  for (const t of ["Alpha", "Bravo", "Charlie"]) {
    m.add(t);
    await act(s, `type "${t}" and press Enter`, () => addEnter(s, t), m);
  }
  m.toggle("Bravo");
  await act(s, 'tick "Bravo"', () => toggle(s, "Bravo"), m);
  m.filter = "active";
  await act(s, "press the Active filter", () => filter(s, "active"), m);
  await filterMarking(s, "active");
  m.filter = "done";
  await act(s, "press the Done filter", () => filter(s, "done"), m);
  await filterMarking(s, "done");
  m.toggle("Bravo");
  await act(s, 'untick "Bravo" while the Done filter is shown', () => toggle(s, "Bravo"), m);
  m.filter = "all";
  await act(s, "press the All filter", () => filter(s, "all"), m);
  await filterMarking(s, "all");
  m.toggle("Alpha");
  await act(s, 'tick "Alpha"', () => toggle(s, "Alpha"), m);
  m.toggle("Charlie");
  await act(s, 'tick "Charlie"', () => toggle(s, "Charlie"), m);
  m.filter = "active";
  await act(s, "press the Active filter", () => filter(s, "active"), m);
  m.remove("Bravo");
  await act(s, 'delete "Bravo" while the Active filter is shown', () => remove(s, "Bravo"), m);
  m.filter = "done";
  await act(s, "press the Done filter", () => filter(s, "done"), m);
  m.add("Delta");
  await act(s, 'type "Delta" and press Enter while the Done filter is shown', () => addEnter(s, "Delta"), m);
  m.filter = "all";
  await act(s, "press the All filter", () => filter(s, "all"), m);
  await filterMarking(s, "all");
  const counted = await s.page.evaluate(() => document.querySelector("#counter")?.textContent ?? "");
  expect(`[${s.L}] counter number equals the number of active tasks`, (counted.match(/\d+/) || ["none"])[0], "1");
}

// ---------------------------------------------------------------- R4 persistence / corruption
const CORRUPT = [
  ["unparseable JSON", "{not json", [], "all"],
  ["JSON null", "null", [], "all"],
  ["a number", "42", [], "all"],
  ["a string", '"just a string"', [], "all"],
  ["an array", "[]", [], "all"],
  ["todos is not an array", '{"version":1,"todos":"nope","filter":"active"}', [], "all"],
  [
    "mixed valid/invalid items and an unknown filter",
    JSON.stringify({
      version: 1,
      todos: [
        { id: "a", text: "Keep me", done: false },
        null,
        7,
        { id: "b", text: 5, done: false },
        { id: "c", text: "Bad done", done: "yes" },
        { id: "d", text: "   ", done: false },
        { text: "No id", done: true },
      ],
      filter: "bogus",
    }),
    [
      { text: "Keep me", done: false },
      { text: "No id", done: true },
    ],
    "all",
  ],
];
async function stored(s) {
  return s.page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
}
async function scenarioPersist(s) {
  const m = new Model();
  await loaded(s);
  for (const t of ["  Read book  ", "Water plants", "Call mom"]) {
    m.add(t);
    await act(s, `type "${t}" and press Enter`, () => addEnter(s, t), m);
  }
  m.toggle("Water plants");
  await act(s, 'tick "Water plants"', () => toggle(s, "Water plants"), m);
  m.remove("Call mom");
  await act(s, 'delete "Call mom"', () => remove(s, "Call mom"), m);
  m.filter = "active";
  await act(s, "press the Active filter", () => filter(s, "active"), m);
  let parsed = null;
  try {
    parsed = JSON.parse(await stored(s));
  } catch {}
  expect(
    `[${s.L}] localStorage["${STORAGE_KEY}"] holds tasks, done state and filter`,
    parsed && {
      version: parsed.version,
      todos: Array.isArray(parsed.todos)
        ? parsed.todos.map((t) => ({ text: t.text, done: t.done, id: typeof t.id === "string" && t.id.length > 0 }))
        : parsed.todos,
      filter: parsed.filter,
    },
    {
      version: 1,
      todos: [
        { text: "Read book", done: false, id: true },
        { text: "Water plants", done: true, id: true },
      ],
      filter: "active",
    },
  );
  await act(s, "reload the page", () => reload(s), m);
  await filterMarking(s, "active");
  await act(s, "open the app again in a new tab", () => s.newPage(), m);
  m.filter = "all";
  await act(s, "press the All filter", () => filter(s, "all"), m);
  await doneClassConsistent(s);
  m.filter = "done";
  await act(s, "press the Done filter and reload", async () => {
    await filter(s, "done");
    await reload(s);
  }, m);
  for (const [label, value, items, f] of CORRUPT) {
    const seen = s.errors.length;
    const salvage = new Model(items, f);
    await act(s, `store ${label} in localStorage and reload`, async () => {
      await s.page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, value]);
      await reload(s);
    }, salvage);
    salvage.add("Recovered");
    await act(s, `after ${label}: type "Recovered" and press Enter`, () => addEnter(s, "Recovered"), salvage);
    await act(s, `after ${label}: reload again`, () => reload(s), salvage);
    let valid = false;
    try {
      const p = JSON.parse(await stored(s));
      valid = Array.isArray(p.todos) && p.todos.every((t) => typeof t.text === "string" && typeof t.done === "boolean");
    } catch {}
    ok(`[${s.L}] after ${label}: storage was rewritten as valid data`, valid, valid, true);
    expect(
      `[${s.L}] after ${label}: no uncaught error or console error`,
      s.errors.slice(seen).join(" || ") || "none",
      "none",
    );
  }
}

// ---------------------------------------------------------------- R5 layout
const LONG_WORD = "Pneumonoultramicroscopicsilicovolcanoconiosis-renewal-paperwork-2027-without-any-spaces";
const LONG_SENTENCE =
  "Pick up the dry cleaning, buy birthday candles for Sam, and remember to call the landlord about the leaking kitchen tap";
async function populate(s, m) {
  for (const t of ["Buy milk", LONG_WORD, LONG_SENTENCE]) {
    m.add(t);
    await act(s, `type "${t.slice(0, 24)}..." and press Enter`, () => addEnter(s, t), m);
  }
  m.toggle("Buy milk");
  await act(s, 'tick "Buy milk"', () => toggle(s, "Buy milk"), m);
}
async function measureLayout(s) {
  const { width, height } = s.vp.viewport;
  const r = await s.page.evaluate(() => {
    const de = document.documentElement;
    window.scrollTo(100000, window.scrollY);
    const scrollX = window.scrollX;
    window.scrollTo(0, 0);
    const vis = (el) => el.checkVisibility({ checkVisibilityCSS: true });
    const queries = [
      "#new-todo",
      "#add-btn",
      "#filters [data-filter]",
      "#todo-list li.todo-item input.toggle",
      "#todo-list li.todo-item button.delete",
    ];
    const controls = queries.flatMap((q) =>
      [...document.querySelectorAll(q)].filter(vis).map((el, i) => {
        el.scrollIntoView({ block: "center", inline: "nearest" });
        const b = el.getBoundingClientRect();
        const lab = el.labels && el.labels[0] ? el.labels[0].getBoundingClientRect() : null;
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        const reach =
          !!hit && (hit === el || el.contains(hit) || hit.closest?.("label")?.control === el);
        return {
          name: `${q}[${i}]`,
          left: b.left,
          right: b.right,
          top: b.top,
          bottom: b.bottom,
          w: Math.max(b.width, lab ? lab.width : 0),
          h: Math.max(b.height, lab ? lab.height : 0),
          reach,
          hit: hit ? hit.tagName + (hit.id ? "#" + hit.id : "") + (hit.className ? "." + String(hit.className).split(" ")[0] : "") : "none",
        };
      }),
    );
    window.scrollTo(0, 0);
    const area = (a, b) =>
      Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const rows = [...document.querySelectorAll("#todo-list li.todo-item")].filter(vis).map((li) => {
      const t = li.querySelector(".todo-text"),
        c = li.querySelector("input.toggle"),
        d = li.querySelector("button.delete");
      const tr = t?.getBoundingClientRect();
      return {
        text: (t?.textContent || "").slice(0, 20),
        overlap: tr && c && d ? Math.round(area(tr, c.getBoundingClientRect()) + area(tr, d.getBoundingClientRect())) : -1,
        clipped: t ? t.scrollWidth > t.clientWidth + 1 : true,
        right: tr ? tr.right : -1,
      };
    });
    return {
      innerWidth,
      clientWidth: de.clientWidth,
      docScroll: de.scrollWidth,
      bodyScroll: document.body.scrollWidth,
      scrollX,
      meta: document.querySelector('meta[name="viewport"]')?.getAttribute("content") || "",
      controls,
      rows,
    };
  });
  ok(`[${s.L}] meta viewport uses width=device-width`, /width\s*=\s*device-width/.test(r.meta), r.meta || "(none)", "width=device-width");
  expect(`[${s.L}] layout viewport width equals the device width`, r.innerWidth, width);
  ok(
    `[${s.L}] no horizontal scroll (document/body scrollWidth <= clientWidth, scrollX stays 0)`,
    r.docScroll <= r.clientWidth && r.bodyScroll <= r.clientWidth && r.scrollX === 0,
    `doc=${r.docScroll} body=${r.bodyScroll} client=${r.clientWidth} scrollX=${r.scrollX}`,
    `<= ${r.clientWidth}, scrollX=0`,
  );
  const expectedControls = 2 + 3 + 2 * r.rows.length;
  expect(`[${s.L}] all controls are rendered and visible`, r.controls.length, expectedControls);
  // Design target (architecture.md section 5, amended in 8.3): every visible control has an effective
  // hit area (larger of the control box and its <label> box) of at least MIN_TARGET x MIN_TARGET CSS px.
  const MIN_TARGET = 44;
  for (const c of r.controls) {
    ok(
      `[${s.L}] ${c.name} reachable: inside viewport, >=${MIN_TARGET}x${MIN_TARGET} hit area, not covered`,
      c.left >= -0.5 && c.right <= r.clientWidth + 0.5 && c.top >= -0.5 && c.bottom <= height + 0.5 && c.w >= MIN_TARGET && c.h >= MIN_TARGET && c.reach,
      `l=${c.left.toFixed(1)} r=${c.right.toFixed(1)} t=${c.top.toFixed(1)} b=${c.bottom.toFixed(1)} target=${c.w.toFixed(1)}x${c.h.toFixed(1)} hit=${c.hit}`,
      `inside ${r.clientWidth}x${height}, hit area >=${MIN_TARGET}x${MIN_TARGET} CSS px (max of control and label box), hit-test reaches control`,
    );
  }
  for (const row of r.rows)
    ok(
      `[${s.L}] task "${row.text}" text is fully shown and does not overlap its controls`,
      row.overlap === 0 && !row.clipped && row.right <= r.clientWidth + 0.5,
      `overlap=${row.overlap}px2 clipped=${row.clipped} right=${row.right}`,
      "overlap=0 clipped=false inside viewport",
    );
  inspections.push(
    `[${s.L}] meta viewport, layout width, horizontal overflow, ${r.controls.length} control targets/hit-tests, ${r.rows.length} task rows for overlap/clipping`,
  );
  return r;
}
async function scenarioLayout(s) {
  const m = new Model();
  await loaded(s);
  await populate(s, m);
  await measureLayout(s);
  for (const f of ["active", "done", "all"]) {
    m.filter = f;
    await act(s, `press the ${f} filter`, () => filter(s, f), m);
    const r = await s.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    ok(`[${s.L}] no horizontal scroll with the ${f} filter`, r[0] <= r[1], `scrollWidth=${r[0]} clientWidth=${r[1]}`, "scrollWidth <= clientWidth");
  }
}
async function scenarioReach(s) {
  const m = new Model();
  await loaded(s);
  const typeAt = async (text) => {
    await pointAt(s, s.page.locator("#new-todo"), "#new-todo");
    await s.page.keyboard.press("ControlOrMeta+A");
    await s.page.keyboard.press("Backspace");
    await s.page.keyboard.type(text, { delay: 5 });
  };
  m.add("Buy milk");
  await act(s, 'pointer on the input, type "Buy milk", pointer on Add', async () => {
    await typeAt("Buy milk");
    await pointAt(s, s.page.locator("#add-btn"), "#add-btn");
  }, m);
  m.add(LONG_SENTENCE);
  await act(s, "pointer on the input, type a long sentence, press Enter", async () => {
    await typeAt(LONG_SENTENCE);
    await s.page.keyboard.press("Enter");
  }, m);
  m.add(LONG_WORD);
  await act(s, "pointer on the input, type a long unbroken word, pointer on Add", async () => {
    await typeAt(LONG_WORD);
    await pointAt(s, s.page.locator("#add-btn"), "#add-btn");
  }, m);
  m.toggle("Buy milk");
  await act(s, 'pointer on the checkbox of "Buy milk"', async () =>
    pointAt(s, (await item(s, "Buy milk")).locator("input.toggle"), "checkbox"), m);
  for (const f of ["active", "done", "all"]) {
    m.filter = f;
    await act(s, `pointer on the ${f} filter`, () => pointAt(s, s.page.locator(`#filters [data-filter="${f}"]`), `${f} filter`), m);
  }
  m.remove(LONG_WORD);
  await act(s, "pointer on the delete button of the long-word task", async () =>
    pointAt(s, (await item(s, LONG_WORD)).locator("button.delete"), "delete button"), m);
  await act(s, "reload the page", () => reload(s), m);
  await errorsAction(s, "collect console/page/network errors after all pointer interactions and reload");
}

// ---------------------------------------------------------------- original-request journey (R1-R5)
async function scenarioJourney(s) {
  const m = new Model();
  await loaded(s);
  m.add("Buy milk");
  await act(s, 'type "Buy milk" and press Enter', () => addEnter(s, "Buy milk"), m);
  m.add("Book dentist");
  await act(s, 'type "Book dentist" and press the Add button', () => addButton(s, "Book dentist"), m);
  await act(s, "press Enter with an empty input", () => addEnter(s, ""), m);
  await act(s, "type spaces only and press the Add button", () => addButton(s, "    "), m);
  m.toggle("Buy milk");
  await act(s, 'tick "Buy milk" as done', () => toggle(s, "Buy milk"), m);
  for (const f of ["active", "done", "all"]) {
    m.filter = f;
    await act(s, `press the ${f} filter`, () => filter(s, f), m);
  }
  m.add("Call mom");
  await act(s, 'type "Call mom" and press Enter', () => addEnter(s, "Call mom"), m);
  m.remove("Book dentist");
  await act(s, 'delete "Book dentist"', () => remove(s, "Book dentist"), m);
  m.filter = "active";
  await act(s, "press the Active filter", () => filter(s, "active"), m);
  await act(s, "reload the page", () => reload(s), m);
  const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  actions.push({
    input: `[${s.L}] measure horizontal overflow`,
    before: "page in use",
    after: overflow > 0 ? `horizontal overflow: ${overflow}px` : "horizontal overflow: none",
    expected: "horizontal overflow: none",
  });
  expect(`[${s.L}] no horizontal overflow`, overflow > 0 ? overflow : 0, 0);
  await capture(s, "journey-after-reload");
  const empty = new Model();
  await act(s, "corrupt the stored data and reload", async () => {
    await s.page.evaluate((k) => localStorage.setItem(k, "{broken"), STORAGE_KEY);
    await reload(s);
  }, empty);
  empty.add("Fresh start");
  await act(s, 'type "Fresh start" and press Enter', () => addEnter(s, "Fresh start"), empty);
  await errorsAction(s);
}

// ---------------------------------------------------------------- visual
async function visualDone(s) {
  const m = new Model();
  await loaded(s);
  for (const t of ["Read book", "Water plants"]) {
    m.add(t);
    await act(s, `type "${t}" and press Enter`, () => addEnter(s, t), m);
  }
  await settle(s);
  const before = await capture(s, "water-plants-active", { locator: (await item(s, "Water plants")).locator(".todo-text") });
  m.toggle("Water plants");
  await act(s, 'tick "Water plants"', () => toggle(s, "Water plants"), m);
  await settle(s);
  const after = await capture(s, "water-plants-done", { locator: (await item(s, "Water plants")).locator(".todo-text") });
  pixelsDiffer(`[${s.L}] done task text pixels differ from the same task when active`, before, after);
  const a = await styleOf((await item(s, "Read book")).locator(".todo-text"), TEXT_STYLE);
  const d = await styleOf((await item(s, "Water plants")).locator(".todo-text"), TEXT_STYLE);
  ok(`[${s.L}] done vs active computed styles differ`, JSON.stringify(a) !== JSON.stringify(d), `active=${JSON.stringify(a)} done=${JSON.stringify(d)}`, "styles differ");
  await capture(s, "mixed-done-active");
  inspections.push("Element screenshot of one task's text before/after ticking must differ", "Computed text style of done vs active task must differ", "Full-page capture with one done and one active task");
}
const FILTER_STYLE = ["backgroundColor", "color", "borderTopColor", "borderBottomWidth", "fontWeight", "textDecorationLine", "boxShadow", "outlineStyle"];
async function visualFilter(s) {
  const m = new Model();
  await loaded(s);
  for (const t of ["Alpha", "Bravo"]) {
    m.add(t);
    await act(s, `type "${t}" and press Enter`, () => addEnter(s, t), m);
  }
  m.toggle("Bravo");
  await act(s, 'tick "Bravo"', () => toggle(s, "Bravo"), m);
  const activeBtn = s.page.locator('#filters [data-filter="active"]');
  await settle(s);
  const before = await capture(s, "active-filter-unselected", { locator: activeBtn });
  m.filter = "active";
  await act(s, "press the Active filter", () => filter(s, "active"), m);
  await settle(s);
  const after = await capture(s, "active-filter-selected", { locator: activeBtn });
  pixelsDiffer(`[${s.L}] selected filter button pixels differ from unselected`, before, after);
  const sel = await styleOf(activeBtn, FILTER_STYLE);
  const unsel = await styleOf(s.page.locator('#filters [data-filter="done"]'), FILTER_STYLE);
  ok(`[${s.L}] selected vs unselected filter computed styles differ`, JSON.stringify(sel) !== JSON.stringify(unsel), `selected=${JSON.stringify(sel)} unselected=${JSON.stringify(unsel)}`, "styles differ");
  await filterMarking(s, "active");
  await capture(s, "active-filter-page");
  inspections.push("Element screenshot of the Active filter before/after selection must differ", "Computed style of selected vs unselected filter must differ", "aria-pressed marks exactly one filter");
}
async function visualLayout(s) {
  const m = new Model();
  await loaded(s);
  const { width } = s.vp.viewport;
  const empty = await capture(s, "empty");
  await populate(s, m);
  await settle(s);
  const full = await capture(s, "populated-all");
  pixelsDiffer(`[${s.L}] populated page renders differently from the empty page`, empty, full);
  expect(`[${s.L}] full-page PNG width equals viewport width (no horizontal overflow)`, pngWidth(full), width * s.vp.deviceScaleFactor);
  await measureLayout(s);
  m.filter = "done";
  await act(s, "press the Done filter", () => filter(s, "done"), m);
  await settle(s);
  const doneShot = await capture(s, "done-filter");
  expect(`[${s.L}] Done-filter PNG width equals viewport width`, pngWidth(doneShot), width * s.vp.deviceScaleFactor);
  inspections.push("Empty vs populated full-page capture differ", "Full-page PNG width equals viewport width x DPR", "Done-filter capture");
}

async function visualAdd(s) {
  const m = new Model();
  await loaded(s);
  await settle(s);
  const empty = await capture(s, "add-empty");
  m.add("  Buy milk  ");
  await act(s, 'type "  Buy milk  " and press Enter', () => addEnter(s, "  Buy milk  "), m);
  m.add("Walk the dog");
  await act(s, 'type "Walk the dog" and press the Add button', () => addButton(s, "Walk the dog"), m);
  await act(s, 'type "    " (spaces only) and press the Add button', () => addButton(s, "    "), m);
  m.add("<b>Pay</b> rent & bills");
  await act(s, 'type "<b>Pay</b> rent & bills" and press Enter', () => addEnter(s, "<b>Pay</b> rent & bills"), m);
  await settle(s);
  const full = await capture(s, "add-populated");
  pixelsDiffer(`[${s.L}] page with added tasks renders differently from the empty page`, empty, full);
  const { width, height } = s.vp.viewport;
  const rows = await s.page.evaluate(() =>
    [...document.querySelectorAll("#todo-list li.todo-item .todo-text")].map((t) => {
      const b = t.getBoundingClientRect();
      return { text: t.textContent, w: b.width, h: b.height, l: b.left, r: b.right, top: b.top };
    }),
  );
  expect(`[${s.L}] exactly the three non-empty tasks are rendered (trimmed, literal)`, rows.map((r) => r.text), ["Buy milk", "Walk the dog", "<b>Pay</b> rent & bills"]);
  for (const r of rows)
    ok(
      `[${s.L}] task "${r.text}" text is painted with a visible box inside the viewport`,
      r.w > 0 && r.h > 0 && r.l >= -0.5 && r.r <= width + 0.5 && r.top >= -0.5 && r.top < height,
      `w=${r.w.toFixed(1)} h=${r.h.toFixed(1)} l=${r.l.toFixed(1)} r=${r.r.toFixed(1)} top=${r.top.toFixed(1)}`,
      `visible box inside ${width}x${height}`,
    );
  expect(`[${s.L}] no injected <b> element in the list`, await s.page.locator("#todo-list b").count(), 0);
  await capture(s, "add-list", { locator: s.page.locator("#todo-list") });
  inspections.push("Empty vs populated full-page capture must differ", "Added task texts trimmed, literal, painted inside the viewport", "Whitespace-only input adds no row", "List element capture");
}
async function visualPersist(s) {
  const m = new Model();
  await loaded(s);
  for (const t of ["Read book", "Water plants", "Call mom"]) {
    m.add(t);
    await act(s, `type "${t}" and press Enter`, () => addEnter(s, t), m);
  }
  m.toggle("Water plants");
  await act(s, 'tick "Water plants"', () => toggle(s, "Water plants"), m);
  m.filter = "done";
  await act(s, "press the Done filter", () => filter(s, "done"), m);
  m.filter = "all";
  await act(s, "press the All filter", () => filter(s, "all"), m);
  await settle(s);
  const listBefore = await capture(s, "persist-list-before-reload", { locator: s.page.locator("#todo-list") });
  const filtersBefore = await capture(s, "persist-filters-before-reload", { locator: s.page.locator("#filters") });
  const stateBefore = describe(await observe(s));
  await act(s, "reload the page", () => reload(s), m);
  await settle(s);
  const listAfter = await capture(s, "persist-list-after-reload", { locator: s.page.locator("#todo-list") });
  const filtersAfter = await capture(s, "persist-filters-after-reload", { locator: s.page.locator("#filters") });
  expect(`[${s.L}] rendered state identical after reload`, describe(await observe(s)), stateBefore);
  pixelsSame(`[${s.L}] task list pixels identical (within raster tolerance) before/after reload`, listBefore, listAfter);
  pixelsSame(`[${s.L}] filter bar pixels identical (within raster tolerance) before/after reload`, filtersBefore, filtersAfter);
  // Negative control: the same tolerance comparison must reject a real done-style change.
  m.toggle("Call mom");
  await act(s, 'tick "Call mom" (negative control for the pixel tolerance)', () => toggle(s, "Call mom"), m);
  await settle(s);
  const listControl = await capture(s, "persist-list-control-extra-done", { locator: s.page.locator("#todo-list") });
  pixelsDiffer(`[${s.L}] control: list with one more task done is rejected as different`, listAfter, listControl);
  m.toggle("Call mom");
  await act(s, 'untick "Call mom" (restore after control)', () => toggle(s, "Call mom"), m);
  m.filter = "active";
  await act(s, "press the Active filter and reload", async () => {
    await filter(s, "active");
    await reload(s);
  }, m);
  await filterMarking(s, "active");
  await settle(s);
  // Negative controls: a hidden (missing) row and a different filter marking must be rejected.
  const listActive = await capture(s, "persist-list-active-after-reload", { locator: s.page.locator("#todo-list") });
  const filtersActive = await capture(s, "persist-filters-active-after-reload", { locator: s.page.locator("#filters") });
  pixelsDiffer(`[${s.L}] control: list under Active (done row missing) is rejected as different from the All list`, listBefore, listActive);
  pixelsDiffer(`[${s.L}] control: filter bar with Active marked is rejected as different from All marked`, filtersBefore, filtersActive);
  await capture(s, "persist-active-after-reload");
  const empty = new Model();
  await act(s, "store unparseable JSON and reload", async () => {
    await s.page.evaluate((k) => localStorage.setItem(k, "{not json"), STORAGE_KEY);
    await reload(s);
  }, empty);
  await settle(s);
  await capture(s, "persist-after-corrupt");
  expect(
    `[${s.L}] after corrupted storage the input and Add button are still rendered`,
    await s.page.evaluate(() => `${!!document.querySelector("#new-todo")?.checkVisibility()}/${!!document.querySelector("#add-btn")?.checkVisibility()}`),
    "true/true",
  );
  inspections.push("List/filter element pixels identical (bytes, or within documented raster tolerance) before and after reload", "Negative controls: extra done task, missing row and changed filter marking are each rejected by the same comparison","Active filter still marked after reload", "Page still renders input/Add after corrupted storage");
}

// ---------------------------------------------------------------- plans
const S = {
  visualAdd,
  visualPersist,
  add: scenarioAdd,
  complete: scenarioComplete,
  filter: scenarioFilter,
  persist: scenarioPersist,
  layout: scenarioLayout,
  reach: scenarioReach,
  journey: scenarioJourney,
  visualDone,
  visualFilter,
  visualLayout,
};
const both = (names) => [MOBILE, DESKTOP].flatMap((vp) => names.map((n) => [n, vp]));
const PLANS = {
  "T1-test": { kind: "test", runs: [["add", DESKTOP]] },
  "T1-behavior": { kind: "behavior", runs: [["add", MOBILE]] },
  "T1-visual": { kind: "visual", runs: [["visualAdd", MOBILE]] },
  "T2-test": { kind: "test", runs: [["complete", DESKTOP]] },
  "T2-behavior": { kind: "behavior", runs: [["complete", MOBILE]] },
  "T2-visual": { kind: "visual", runs: [["visualDone", DESKTOP]] },
  "T3-test": { kind: "test", runs: [["filter", DESKTOP]] },
  "T3-behavior": { kind: "behavior", runs: [["filter", MOBILE]] },
  "T3-visual": { kind: "visual", runs: [["visualFilter", DESKTOP]] },
  "T4-test": { kind: "test", runs: [["persist", DESKTOP]] },
  "T4-behavior": { kind: "behavior", runs: [["persist", MOBILE]] },
  "T4-visual": { kind: "visual", runs: [["visualPersist", DESKTOP]] },
  "T5-test": { kind: "test", runs: both(["layout"]) },
  "T5-behavior": { kind: "behavior", runs: both(["reach"]) },
  "T5-visual-375": { kind: "visual", runs: [["visualLayout", MOBILE]] },
  "T5-visual-1280": { kind: "visual", runs: [["visualLayout", DESKTOP]] },
  "T6-test": { kind: "test", runs: both(["add", "complete", "filter", "persist", "layout", "reach"]) },
  "T6-behavior-375": { kind: "behavior", runs: [["journey", MOBILE]] },
  "T6-behavior-1280": { kind: "behavior", runs: [["journey", DESKTOP]] },
  "T6-visual-375": { kind: "visual", runs: ["visualAdd", "visualDone", "visualFilter", "visualPersist", "visualLayout"].map((n) => [n, MOBILE]) },
  "T6-visual-1280": { kind: "visual", runs: ["visualAdd", "visualDone", "visualFilter", "visualPersist", "visualLayout"].map((n) => [n, DESKTOP]) },
};
const plan = PLANS[env.check_id];
if (!plan || plan.kind !== env.kind) {
  console.error(`No browser plan for check ${env.check_id} of kind ${env.kind}`);
  process.exit(2);
}

// ---------------------------------------------------------------- run
const chromiumChoice = resolveChromium();
if (chromiumChoice.error) {
  console.error("UNVERIFIED: no runnable Chromium: " + chromiumChoice.error);
  process.exit(3);
}
await new Promise((r) => server.listen(0, "127.0.0.1", r));
origin = "http://127.0.0.1:" + server.address().port;
try {
  try {
    browser = await chromium.launch({ headless: true, executablePath: chromiumChoice.executablePath });
  } catch (e) {
    console.error("UNVERIFIED: Chromium failed to launch: " + firstLine(e) + "; " + chromiumChoice.notes.join("; "));
    process.exitCode = 3;
  }
  if (browser) {
    ok(
      "Real Chromium launched",
      true,
      `Chromium ${browser.version()} via ${chromiumChoice.source}: ${chromiumChoice.executablePath}${chromiumChoice.notes.length ? " (" + chromiumChoice.notes.join("; ") + ")" : ""}`,
      "a launched Chromium binary",
    );
    for (const [name, vp] of plan.runs) {
      const s = await open(vp);
      try {
        await S[name](s);
      } catch (e) {
        ok(`[${vp.label}] ${name} scenario completed without exception`, false, firstLine(e), "no exception");
        if (plan.kind === "behavior" && !actions.length)
          actions.push({ input: `[${vp.label}] scenario ${name}`, before: "not started", after: "ERROR: " + firstLine(e), expected: "scenario completed" });
      } finally {
        expect(`[${vp.label}] ${name}: zero console errors, page errors and failed requests`, s.errors.join(" || ") || "none", "none");
        if (plan.kind === "visual" && !captures.length) await capture(s, "fallback").catch(() => {});
        await s.context.close();
      }
    }
    let details;
    if (plan.kind === "test") {
      const passed = assertions.filter((a) => a.status === "PASS").length,
        failed = assertions.filter((a) => a.status === "FAIL").length;
      details = { total: assertions.length, passed, failed, skipped: assertions.length - passed - failed };
    } else if (plan.kind === "behavior") details = { actions };
    else
      details = {
        browser: `Chromium ${browser.version()}`,
        viewport: { ...plan.runs[0][1].viewport },
        captures,
        inspections: inspections.length ? inspections : ["scenario aborted before inspections"],
      };
    writeReport({
      tool: { name: "Playwright Chromium", version: `playwright ${playwrightVersion} / Chromium ${browser.version()}` },
      assertions,
      artifacts,
      details,
    });
    console.log(
      JSON.stringify({ check: env.check_id, assertions: assertions.length, failed: assertions.filter((a) => a.status !== "PASS").map((a) => a.name), served: served.length }),
    );
    if (assertions.some((a) => a.status !== "PASS")) process.exitCode = 1;
  }
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  server.close();
}

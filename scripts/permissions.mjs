import fs from "node:fs";
import path from "node:path";
import { shared, json, main, isMain, load } from "./lib/core.mjs";
import { probePermissions } from "./live-probe.mjs";
import { superviseDir } from "./supervise.mjs";

// Live runs 3-7 and the game/existing-app runs: child agents were repeatedly refused
// Bash (node -e, Chromium checks, git) by the headless permission gate, so the parent
// had to run their checks. Requesting an autonomous /goal is the grant, so we write the
// allowlist up front and pass it with --settings (headless `claude -p` ignores project
// settings.json allow rules in untrusted workspaces; --settings is honoured).
export function devPermissions(root, o = {}) {
  const base = probePermissions(root);
  const allow = [
    ...base.permissions.allow,
    // Real check runners and package scripts a builder legitimately needs.
    "Bash(npm test*)",
    "Bash(npm run*)",
    "Bash(npx playwright*)",
    "Bash(node --test*)",
  ];
  const deny = base.permissions.deny.filter(
    (d) => !(o.allow_publish && /git (-C\* )?push/.test(d)),
  );
  // Publishing the Git checkpoint is opt-in: the only pushes allowed are to the
  // dedicated autodev/checkpoint/* refs, never to the working branch or main.
  if (o.allow_publish)
    allow.push(
      "Bash(git push origin autodev/checkpoint/*)",
      "Bash(git push -u origin autodev/checkpoint/*)",
      "Bash(git push origin HEAD:refs/heads/autodev/checkpoint/*)",
    );
  return { permissions: { allow, deny } };
}
export function writePermissions(o) {
  let root = path.resolve(o.target);
  try {
    root = load(o.target).session.root;
  } catch {}
  const out = o.out || path.join(superviseDir(root), "permissions.json"),
    settings = devPermissions(root, {
      allow_publish: o.allow_publish === "true" || o.allow_publish === true,
    });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  json(out, settings);
  return {
    status: "WRITTEN",
    settings: out,
    use: "claude --settings " + out + " ...",
    shared,
  };
}
if (isMain(import.meta.url))
  main((o) => console.log(JSON.stringify(writePermissions(o), null, 2)));

import fs from "node:fs";
import path from "node:path";
import { git } from "./core.mjs";

// Local to this clone: never replace the application's tracked ignore/settings files.
export function excludeState(root, pattern = "/.autodev/") {
  const filename = path.resolve(
    root,
    git(root, "rev-parse", "--git-path", "info/exclude"),
  );
  const previous = fs.existsSync(filename)
    ? fs.readFileSync(filename, "utf8")
    : "";
  if (previous.split(/\r?\n/).includes(pattern)) return;
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.appendFileSync(
    filename,
    (previous && !previous.endsWith("\n") ? "\n" : "") + pattern + "\n",
  );
}

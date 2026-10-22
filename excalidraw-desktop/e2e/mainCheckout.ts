import { execFileSync } from "node:child_process";
import path from "node:path";

// The main checkout (shared across git worktrees), resolved from git's common dir.
const mainCheckout = () =>
  path.dirname(
    execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
    }).trim(),
  );

/** A path under the main checkout's git-ignored personal/ folder (opt-in screenshot output). */
export const personalPath = (...segments: string[]) =>
  path.join(mainCheckout(), "personal", ...segments);

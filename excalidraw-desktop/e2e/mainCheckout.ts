import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The main checkout (shared across git worktrees), resolved from git's common dir.
// Without git metadata (an exported or copied tree, e.g. a Linux VM or a CI
// tarball) fall back to this repo root; the folder is git-ignored scratch anyway,
// and throwing here at module load would abort the whole test collection.
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const mainCheckout = () => {
  try {
    return path.dirname(
      execFileSync(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim(),
    );
  } catch {
    return repoRoot;
  }
};

/** A path under the main checkout's git-ignored personal/ folder (opt-in screenshot output). */
export const personalPath = (...segments: string[]) =>
  path.join(mainCheckout(), "personal", ...segments);

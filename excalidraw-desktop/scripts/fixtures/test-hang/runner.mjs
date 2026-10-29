// A tier runner in miniature: runs the fake Playwright under run-guarded, like test-tier.mjs.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { exitOnSignals, runGuarded } from "../../run-guarded.mjs";

exitOnSignals();
const here = path.dirname(fileURLToPath(import.meta.url));
const r = await runGuarded({
  cmd: process.execPath,
  args: [path.join(here, "fake-playwright.mjs"), "hang-pass"],
  stdio: "ignore",
  progressFile: process.env.E2E_PROGRESS_FILE,
  graceMs: 600_000,
});
process.exit(r.ok ? 0 : 1);

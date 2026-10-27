/**
 * Builds every official plugin (plugins/official/<id>/build.mjs) into its dist/.
 * `--quiet` prints nothing when all builds pass (the end-to-end run uses it).
 * Add a plugin by giving its folder a build.mjs; nothing else to register here.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const quiet = process.argv.includes("--quiet");
let failed = false;
for (const id of readdirSync(here, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()) {
  const script = path.join(here, id, "build.mjs");
  if (!existsSync(script)) {
    continue;
  }
  const r = spawnSync(
    process.execPath,
    [script, ...process.argv.slice(2).filter((a) => a !== "--quiet")],
    {
      encoding: "utf8",
    },
  );
  if (r.status !== 0 || !quiet) {
    process.stdout.write(r.stdout ?? "");
    process.stderr.write(r.stderr ?? "");
  }
  failed ||= r.status !== 0;
}
process.exit(failed ? 1 : 0);

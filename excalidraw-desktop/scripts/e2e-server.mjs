#!/usr/bin/env node
// The e2e web server (plugin build, vite build, vite preview) for Playwright's `webServer`.
//
// Exit paths, and why each ends the preview (see scripts/process-group.mjs):
// - Playwright's normal stop is SIGKILL to our process group. We can't react, but the preview's
//   group holds a guard that sees our pipe close and kills the preview.
// - The runner itself is killed (even with SIGKILL): our stdin, a pipe from the runner, ends, and
//   we stop the preview. The guard covers us too if we die first.
// - SIGTERM, SIGINT, SIGHUP: we stop the preview and exit.
// The preview's output goes through our own pipes, never straight into Playwright's: a preview
// that somehow survived must not keep Playwright waiting for its stdout to close (toimprove 104:
// runs printed every test as passed, then waited for 1 h 25 min to 1 h 50 min).
import { fstatSync } from "node:fs";

import { spawnGroup } from "./process-group.mjs";

const command =
  process.env.E2E_SERVER_COMMAND ??
  "node ../plugins/official/build.mjs --quiet --no-check && npx vite build --config vite.e2e.config.mts --logLevel warn && exec npx vite preview --config vite.e2e.config.mts";
const { child, stop: stopGroup } = spawnGroup(command, {
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
// Our reader went away (the runner died): writing would throw EPIPE; just stop.
process.stdout.on("error", () => stop(0));
process.stderr.on("error", () => stop(0));

let stopping = false;
function stop(code = 0) {
  if (stopping) {
    return;
  }
  stopping = true;
  stopGroup("SIGTERM");
  setTimeout(() => {
    stopGroup("SIGKILL");
    process.exit(code);
  }, 2000).unref();
}
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(sig, () => stop(0));
}
child.on("exit", (code) => stop(code ?? 1));

// The runner gave us a pipe as stdin; it ends when the runner ends in any way.
let stdinIsPipe = false;
try {
  stdinIsPipe = fstatSync(0).isFIFO() || fstatSync(0).isSocket();
} catch {
  // no stdin
}
if (stdinIsPipe) {
  process.stdin.on("end", () => stop(0));
  process.stdin.on("error", () => stop(0));
  process.stdin.resume();
}
// Backup: re-parented means the parent died.
const parent = process.ppid;
setInterval(() => {
  if (process.ppid !== parent) {
    stop(0);
  }
}, 1000).unref();

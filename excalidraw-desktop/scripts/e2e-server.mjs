#!/usr/bin/env node
// The e2e web server (plugin build, vite build, vite preview) in its own process group, so no
// exit path leaves a preview holding the port: Playwright's normal stop (SIGTERM), Ctrl-C, and
// a killed runner (SIGKILL never reaches us, so we watch the parent and leave when it goes).
// On 2026-10-28 three orphaned previews held heavy.sh's ports 1421/1431/1441 for over an hour.
import { spawn } from "node:child_process";

const command =
  process.env.E2E_SERVER_COMMAND ??
  "node ../plugins/official/build.mjs --quiet --no-check && npx vite build --config vite.e2e.config.mts --logLevel warn && exec npx vite preview --config vite.e2e.config.mts";
const child = spawn("sh", ["-c", command], {
  stdio: "inherit",
  detached: true,
});
const parent = process.ppid;

let stopping = false;
const stop = (code = 0) => {
  if (!stopping) {
    stopping = true;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // already gone
    }
    setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
      process.exit(code);
    }, 2000).unref();
  }
};
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(sig, () => stop(0));
}
child.on("exit", (code) => {
  if (!stopping) {
    stop(code ?? 1);
  }
});
// Parent gone (killed runner): we were re-parented, so stop too.
setInterval(() => {
  if (process.ppid !== parent) {
    stop(0);
  }
}, 1000).unref();
// Keep the event loop alive while the child runs.
setInterval(() => {}, 1 << 30);

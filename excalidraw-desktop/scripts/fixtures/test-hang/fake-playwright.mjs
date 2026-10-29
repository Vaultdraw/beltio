// Stands in for a Playwright run in run-guarded tests. Leaves a child that holds stdout open
// (like the orphaned vite preview did), reports progress, then behaves as `mode` says.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const mode = process.argv[2];
const child = spawn("sleep", ["600"], { stdio: "inherit" });
writeFileSync(process.env.PIDS_FILE, JSON.stringify([process.pid, child.pid]));
const progress = {
  "hang-pass": { total: 2, done: 2, failed: [], ended: false },
  "hang-fail": { total: 2, done: 2, failed: ["spec › broken"], ended: false },
  never: { total: 2, done: 1, failed: [], ended: false },
}[mode];
if (progress && process.env.E2E_PROGRESS_FILE) {
  writeFileSync(process.env.E2E_PROGRESS_FILE, JSON.stringify(progress));
}
if (mode === "exit-leave") {
  child.unref();
  process.exit(0);
}
setInterval(() => {}, 1 << 30);

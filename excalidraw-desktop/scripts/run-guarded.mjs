// Run one test step so it can't hang the tier or leave processes behind (toimprove 104).
//
// - The step runs in its own process group with a guard (process-group.mjs): when the step ends,
//   is stopped, or this runner dies in any way (SIGKILL included), the whole group goes.
// - A hard deadline stops a step that runs too long.
// - With a progress file (pw-progress-reporter.mjs), the result comes from the file: once every
//   test has its final result, Playwright gets `graceMs` to exit; if it doesn't, it is stopped and
//   the step passes or fails on what the tests reported.
import { existsSync, readFileSync } from "node:fs";

import { shQuote, spawnGroup } from "./process-group.mjs";

let current = null;

/** Stop the step that is running now (for the caller's signal handlers). */
export function stopCurrent(signal = "SIGTERM") {
  current?.(signal);
}

/** On a catchable signal, stop the running step's group, then exit with the usual code. */
export function exitOnSignals() {
  for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
    process.on(sig, () => {
      stopCurrent("SIGTERM");
      setTimeout(() => process.exit(code), 500);
    });
  }
}

export function readProgress(file) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  } catch {
    return null; // never half-written (rename), but be safe
  }
}

/** All tests have their final result, or Playwright already reported the end. */
export const progressComplete = (p) =>
  !!p && (p.ended !== false || (p.total > 0 && p.done >= p.total));
const progressOk = (p) =>
  p.failed.length === 0 &&
  !p.errors &&
  (p.ended === false || p.ended === "passed");

/**
 * @returns {Promise<{ ok: boolean, code: number | null, note?: string }>}
 */
export function runGuarded({
  cmd,
  args = [],
  cwd,
  env = process.env,
  stdio = "inherit",
  deadlineMs,
  progressFile,
  graceMs = 90_000,
  pollMs = 1000,
}) {
  return new Promise((resolve) => {
    const { child, stop } = spawnGroup([cmd, ...args].map(shQuote).join(" "), {
      cwd,
      env,
      stdio,
    });
    let verdict = null; // set when we stop the step ourselves
    let completeAt = 0;
    const halt = (result) => {
      if (verdict) {
        return;
      }
      verdict = result;
      stop("SIGTERM");
      setTimeout(() => stop("SIGKILL"), 5000).unref();
    };
    current = (signal) => halt({ ok: false, note: `stopped by ${signal}` });
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (deadlineMs && Date.now() - t0 > deadlineMs) {
        halt({
          ok: false,
          note: `no result after the ${Math.round(
            deadlineMs / 60_000,
          )} min deadline; stopped it`,
        });
        return;
      }
      if (!progressFile) {
        return;
      }
      const p = readProgress(progressFile);
      if (!progressComplete(p)) {
        return;
      }
      completeAt ||= Date.now();
      if (Date.now() - completeAt > graceMs) {
        halt({
          ok: progressOk(p),
          note: `all ${p.total} tests finished (${
            p.failed.length
          } failed) but Playwright did not exit within ${Math.round(
            graceMs / 1000,
          )} s; stopped it and took the result from the progress file`,
        });
      }
    }, pollMs);
    child.on("exit", (code, signal) => {
      clearInterval(timer);
      current = null;
      if (verdict) {
        resolve({ ...verdict, code });
      } else {
        resolve({
          ok: code === 0,
          code,
          note: signal ? `ended by ${signal}` : undefined,
        });
      }
    });
  });
}

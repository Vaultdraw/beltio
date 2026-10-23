/** Shows new lines of the app's dev log (`<state>/plugin-logs/<id>.log`) while `dev` runs. */
import { closeSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";

import { resolveDirs } from "./dirs.mjs";

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} id
 * @returns {string | null} null when the state folder cannot be resolved
 */
export function devLogPath(env, id) {
  try {
    return path.join(resolveDirs(env).state, "plugin-logs", `${id}.log`);
  } catch {
    return null;
  }
}

/**
 * Prints lines appended to `file` from now on (polling; the file may not exist yet and the
 * app trims it when it grows past 1 MB, which restarts reading at the top).
 * @param {string} file
 * @param {(s: string) => void} out
 * @param {number} [intervalMs]
 * @returns {() => void} stop
 */
export function tailLog(file, out, intervalMs = 400) {
  const size = () => {
    try {
      return statSync(file).size;
    } catch {
      return 0;
    }
  };
  let offset = size();
  let partial = "";
  const poll = () => {
    const now = size();
    if (now < offset) {
      offset = 0;
      partial = "";
    }
    if (now === offset) {
      return;
    }
    const buf = Buffer.alloc(Math.min(now - offset, 256 * 1024));
    let fd;
    try {
      fd = openSync(file, "r");
      const n = readSync(fd, buf, 0, buf.length, offset);
      offset += n;
      const lines = (partial + buf.subarray(0, n).toString("utf8")).split("\n");
      partial = lines.pop() ?? "";
      for (const l of lines) {
        out(`log | ${l}`);
      }
    } catch {
      // unreadable for now: try again on the next tick
    } finally {
      if (fd !== undefined) {
        closeSync(fd);
      }
    }
  };
  const timer = setInterval(poll, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

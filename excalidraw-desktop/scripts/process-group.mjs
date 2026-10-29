// Run a shell command in its own process group that can never outlive the caller.
//
// The group also holds a tiny shell guard. It blocks reading fd 3, a pipe whose only write end is
// in the calling Node process. When the caller ends in any way (normal exit, a signal, SIGKILL),
// the kernel closes that write end, the guard's read returns, and the guard kills the whole group:
// SIGTERM, then SIGKILL 3 s later. The caller can also end the group itself with `stop()`.
//
// Why (toimprove 104, 2026-10-29): Playwright stops its web server with SIGKILL to the server's
// group. scripts/e2e-server.mjs had moved vite preview into a second group, so the preview lived
// on, kept Playwright's stdout pipe open, and Playwright waited for that pipe forever after
// printing every test as passed. A SIGKILL can't be caught, so the cleanup must not depend on the
// killed process: it lives in the guard instead.
import { spawn, spawnSync } from "node:child_process";

const GUARD =
  '(trap "" TERM INT HUP; read _ <&3; kill -TERM 0 2>/dev/null; sleep 3; kill -KILL 0 2>/dev/null) </dev/null >/dev/null 2>&1 &';

/** Quote one argument for sh. */
export const shQuote = (s) =>
  /^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * Start `command` (a sh command line) as the leader of a new process group with a guard.
 * `stdio` gives fds 0-2 ("inherit", "pipe", "ignore" or an array of three); fd 3 is the guard pipe.
 * Returns { child, stop(signal?) }: stop() signals the whole group and releases the guard.
 */
export function spawnGroup(command, { stdio = "inherit", ...options } = {}) {
  const io = Array.isArray(stdio) ? stdio.slice(0, 3) : [stdio, stdio, stdio];
  const child = spawn("sh", ["-c", `${GUARD} exec 3<&-; ${command}`], {
    ...options,
    stdio: [...io, "pipe"],
    detached: true,
  });
  const guardPipe = child.stdio[3];
  // The pipe must not keep the caller's event loop alive, and EPIPE on it is expected.
  guardPipe.on("error", () => {});
  guardPipe.unref?.();
  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      return false; // group already gone
    }
  };
  let stopped = false;
  const stop = (signal = "SIGTERM") => {
    if (stopped) {
      return signalGroup(signal);
    }
    stopped = true;
    const alive = signalGroup(signal);
    // Closing our end wakes the guard, which SIGKILLs anything that ignored the signal.
    guardPipe.destroy();
    return alive;
  };
  // When the leader exits, sweep whatever it left behind in its group (a background child).
  child.on("exit", () => {
    if (!stopped) {
      stop("SIGTERM");
    }
  });
  return { child, stop };
}

/** True when a process with this pid exists (`kill -0` is blocked in some sandboxes; ps isn't). */
export function isAlive(pid) {
  return spawnSync("ps", ["-p", String(pid)], { stdio: "ignore" }).status === 0;
}

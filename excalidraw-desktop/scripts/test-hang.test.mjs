// toimprove 104: a test step can't hang the tier and leaves no process behind, however it ends.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { isAlive } from "./process-group.mjs";
import { progressComplete, runGuarded } from "./run-guarded.mjs";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(scripts, "fixtures/test-hang");
const desktop = path.dirname(scripts);
const tmp = mkdtempSync(path.join(tmpdir(), "test-hang-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;
const files = () => {
  n += 1;
  return {
    pids: path.join(tmp, `pids-${n}.json`),
    progress: path.join(tmp, `progress-${n}.json`),
  };
};
const pidsIn = (file) => JSON.parse(readFileSync(file, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(check, ms, what) {
  for (let i = 0; i < ms / 100; i++) {
    if (check()) {
      return;
    }
    await sleep(100);
  }
  assert.fail(`timed out after ${ms} ms waiting for ${what}`);
}
// The guard sends SIGKILL 3 s after SIGTERM; allow for a loaded machine.
const assertAllGone = (pids) =>
  waitFor(() => pids.every((p) => !isAlive(p)), 10_000, `pids ${pids} to end`);
const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const fake = (mode, f, extra = {}) =>
  runGuarded({
    cmd: process.execPath,
    args: [path.join(fixtures, "fake-playwright.mjs"), mode],
    stdio: "ignore",
    env: { ...process.env, PIDS_FILE: f.pids, E2E_PROGRESS_FILE: f.progress },
    progressFile: f.progress,
    graceMs: 1000,
    pollMs: 100,
    ...extra,
  });

test("progressComplete: done when every test has a result or the run reported its end", () => {
  const cases = [
    [null, false],
    [{ total: 0, done: 0, failed: [], ended: false }, false],
    [{ total: 3, done: 2, failed: [], ended: false }, false],
    [{ total: 3, done: 3, failed: [], ended: false }, true],
    [{ total: 0, done: 0, failed: [], ended: "passed" }, true],
  ];
  for (const [p, want] of cases) {
    assert.equal(progressComplete(p), want, JSON.stringify(p));
  }
});

// Each row: what the step does -> the verdict the tier must give, and nothing may be left running.
const rows = [
  {
    mode: "hang-pass",
    ok: true,
    note: /did not exit/,
    why: "all passed, then hangs: pass, stopped after the grace",
  },
  {
    mode: "hang-fail",
    ok: false,
    note: /1 failed/,
    why: "a test failed, then hangs: fail",
  },
  {
    mode: "never",
    ok: false,
    note: /deadline/,
    extra: { deadlineMs: 1500 },
    why: "never finishes: fail at the deadline",
  },
  {
    mode: "exit-leave",
    ok: true,
    note: undefined,
    why: "exits 0 but leaves a child: pass, child swept",
  },
];
for (const row of rows) {
  test(`runGuarded: ${row.why}`, async () => {
    const f = files();
    const t = Date.now();
    const r = await fake(row.mode, f, row.extra);
    assert.equal(r.ok, row.ok);
    if (row.note) {
      assert.match(r.note, row.note);
    } else {
      assert.equal(r.note, undefined);
    }
    assert.ok(Date.now() - t < 15_000, "the step ended promptly");
    await assertAllGone(pidsIn(f.pids));
  });
}

for (const signal of ["SIGTERM", "SIGKILL"]) {
  test(`the tier runner gets ${signal} mid-step: the step's processes all end`, async () => {
    const f = files();
    const runner = spawn(
      process.execPath,
      [path.join(fixtures, "runner.mjs")],
      {
        stdio: "ignore",
        env: {
          ...process.env,
          PIDS_FILE: f.pids,
          E2E_PROGRESS_FILE: f.progress,
        },
      },
    );
    await waitFor(
      () => {
        try {
          return pidsIn(f.pids).length === 2;
        } catch {
          return false;
        }
      },
      15_000,
      "the fake step to start",
    );
    const pids = pidsIn(f.pids);
    assert.ok(pids.every(isAlive));
    runner.kill(signal);
    await assertAllGone([runner.pid, ...pids]);
  });
}

// The real thing: Playwright with scripts/e2e-server.mjs. Before the fix this run printed
// "2 passed" and then waited forever on the orphaned server's stdout.
const playwrightCli = createRequire(path.join(desktop, "package.json")).resolve(
  "@playwright/test/cli",
);
const playwright = (port, f, env = {}) =>
  spawn(
    process.execPath,
    [playwrightCli, "test", "-c", path.join(fixtures, "pw.config.mjs")],
    {
      cwd: desktop,
      stdio: "ignore",
      env: {
        ...process.env,
        E2E_PORT: String(port),
        PIDS_FILE: f.pids,
        PW_OUTPUT_DIR: path.join(tmp, `pw-results-${n}`),
        E2E_SERVER_COMMAND: `exec node ${path.join(fixtures, "server.cjs")}`,
        ...env,
      },
    },
  );

test("real Playwright with e2e-server.mjs exits with the right status and stops the server", async () => {
  const f = files();
  const pw = playwright(await freePort(), f);
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      pw.kill("SIGKILL");
      resolve("hung");
    }, 90_000);
    pw.on("exit", (c) => {
      clearTimeout(timer);
      resolve(c);
    });
  });
  assert.equal(code, 0, "Playwright exits 0 instead of hanging");
  await assertAllGone(pidsIn(f.pids));
});

test("real Playwright runner killed with SIGKILL: its web server does not survive", async () => {
  const f = files();
  const pw = playwright(await freePort(), f, { SLOW_MS: "60000" });
  await waitFor(
    () => {
      try {
        return pidsIn(f.pids).length === 1;
      } catch {
        return false;
      }
    },
    60_000,
    "the web server to start",
  );
  const server = pidsIn(f.pids)[0];
  // A hard kill of the Playwright runner process itself: nothing can clean up on the way out.
  pw.kill("SIGKILL");
  await assertAllGone([server]);
});

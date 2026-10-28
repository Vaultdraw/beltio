import { execFileSync } from "node:child_process";

import { defineConfig, devices } from "@playwright/test";

// Drives the real VaultApp UI in a browser (see e2e.html). WebKit matches the
// macOS Tauri WKWebView; Chromium guards against engine-specific fixes.
//
// `yarn test:e2e` runs WebKit only with 4 workers (2: 273 s, 4: 150 s for the
// functional suite on 2026-10-17; fullyParallel gave nothing on top).
// `yarn test:e2e:full` (E2E_FULL=1) adds Chromium, screenshots and the
// screenshot gallery spec.
const full = process.env.E2E_FULL === "1";

// Every run gets its own port, so e2e runs (any worktree) go in parallel and
// take no lock. E2E_PORT pins one (heavy.sh gives its slots 1421/1431);
// otherwise the OS picks a free one. It is written back to the env so the
// workers (which re-read this config) and the web server use the same port.
const freePort = () =>
  execFileSync(
    process.execPath,
    [
      "-e",
      "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})",
    ],
    { encoding: "utf8" },
  ).trim();
if (!process.env.E2E_PORT) {
  process.env.E2E_PORT = freePort();
  process.env.E2E_PORT_AUTO = "1";
}
const port = process.env.E2E_PORT;

// A pinned port belongs to the heavy.sh slot this run holds, so a vite preview still
// listening there is a leftover of a killed run: free it before starting (2026-10-28).
if (process.env.E2E_PORT_AUTO !== "1" && !process.env.TEST_WORKER_INDEX) {
  try {
    const pids = execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    for (const pid of pids) {
      const cmd = execFileSync("ps", ["-o", "command=", "-p", pid], {
        encoding: "utf8",
      });
      if (/vite(\.js)? preview/.test(cmd) && cmd.includes("vite.e2e.config")) {
        process.kill(Number(pid), "SIGTERM");
        console.warn(
          `e2e: stopped a stale preview server on port ${port} (pid ${pid})`,
        );
      }
    }
  } catch {
    // Nothing listening (lsof exits 1) or no lsof: nothing to free.
  }
}

// E2E_TIMEOUT_FACTOR slows every timeout for emulated machines (the Linux x86_64 VM
// on an Apple-silicon Mac runs under Rosetta, about 2x slower). Default 1.
const factor = Number(process.env.E2E_TIMEOUT_FACTOR) || 1;

const viewport = { width: 1280, height: 850 };

export default defineConfig({
  testDir: "./e2e",
  testIgnore: full ? [] : ["gallery.spec.ts"],
  globalTeardown: "./e2e/teardown.ts",
  timeout: 60_000 * factor,
  expect: { timeout: 5_000 * factor },
  fullyParallel: process.env.E2E_FULLY_PARALLEL === "1",
  workers: Number(process.env.E2E_WORKERS) || 4,
  reporter: [["list"]],
  outputDir: `../.cache/e2e-results-${port}`,
  use: {
    baseURL: `http://localhost:${port}`,
    viewport,
    trace: "retain-on-failure",
  },
  webServer: {
    // scripts/e2e-server.mjs: build + preview in one process group that dies with the run.
    command: "node scripts/e2e-server.mjs",
    url: `http://localhost:${port}/e2e.html`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], viewport },
    },
    ...(full
      ? [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport } }]
      : []),
  ],
});

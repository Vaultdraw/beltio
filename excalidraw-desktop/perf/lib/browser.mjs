// Chromium perf mode: serves the built perf harness + fixture vault over HTTP
// and drives it with Playwright (CDP metrics, optional CPU throttling).
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { cdpDeltas } from "./cdp-metrics.mjs";
import { leakSummary } from "./leak.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, "../..");
const defaultWtRoot = path.resolve(desktopDir, "..");
const EXT = ".excalidraw";
const THROTTLE_RATE = 4;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".excalidraw": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

export const PERF_PAGE = "perf/browser/perf.html";

export async function hasPerfPage(distDir) {
  return fs
    .access(path.join(distDir, PERF_PAGE))
    .then(() => true, () => false);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) {
    return NaN;
  }
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function walkVault(vaultDir) {
  const out = [];
  const walk = async (rel) => {
    const entries = await fs.readdir(path.join(vaultDir, rel), {
      withFileTypes: true,
    });
    for (const e of entries) {
      if (e.name.startsWith(".")) {
        continue;
      }
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out.push({ path: p, kind: "folder", name: e.name });
        await walk(p);
      } else if (e.isFile() && e.name.endsWith(EXT)) {
        const st = await fs.stat(path.join(vaultDir, p));
        out.push({ path: p, kind: "drawing", name: e.name, size: st.size });
      }
    }
  };
  await walk("");
  return out;
}

async function startServer({ distDir, vaultDir }) {
  const index = JSON.stringify(await walkVault(vaultDir));
  const send = async (res, file) => {
    const body = await fs.readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "content-length": body.length,
      "cache-control": "no-store",
    });
    res.end(body);
  };
  const inside = (root, rel) => {
    const abs = path.resolve(root, `.${path.sep}${rel}`);
    return abs === root || abs.startsWith(root + path.sep) ? abs : null;
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      const p = decodeURIComponent(url.pathname);
      let file;
      if (p === "/perf-vault/index.json") {
        res.writeHead(200, { "content-type": TYPES[".json"] });
        res.end(index);
        return;
      } else if (p.startsWith("/perf-vault/")) {
        file = inside(vaultDir, p.slice("/perf-vault/".length));
      } else {
        file = inside(
          distDir,
          p === "/" ? PERF_PAGE : p.slice(1),
        );
      }
      if (!file) {
        throw Object.assign(new Error("bad path"), { code: "ENOENT" });
      }
      await send(res, file);
    } catch (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500);
      res.end(String(error.message));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

function runVite(cwd, log) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      [
        "vite",
        "build",
        "--config",
        "perf/browser/vite.perf.config.mts",
        "--logLevel",
        "warn",
      ],
      { cwd, stdio: ["ignore", "pipe", "pipe"] },
    );
    let tail = "";
    const onData = (d) => {
      tail = (tail + d).slice(-4000);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`vite build failed (${code}):\n${tail}`)),
    );
    log?.("[browser] vite build…");
  });
}

const INIT_SCRIPT = `
  window.__longTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__longTasks.push({ start: e.startTime, duration: e.duration });
      }
    }).observe({ type: "longtask", buffered: true });
  } catch (e) {}
`;

// Long tasks overlapping the typing / pan / zoom phases. A phase runs from its
// `phase:<name>` mark to the next phase mark (or the end of the run).
function longTaskStats(tasks, marks, endT) {
  const wanted = /^phase:.*(typing|pan|zoom)/i;
  let count = 0;
  let totalMs = 0;
  marks.forEach((m, i) => {
    if (!wanted.test(m.name)) {
      return;
    }
    const from = m.t;
    const to = i + 1 < marks.length ? marks[i + 1].t : endT;
    for (const t of tasks) {
      if (t.start >= from && t.start < to) {
        count += 1;
        totalMs += t.duration;
      }
    }
  });
  return { count, totalMs };
}

/** Page URL: leak flags plus the scenario filter (?scenarios= allow-list, ?skip= deny-list). */
export function pageUrl(port, { leak, leakOnly, scenarios, skipScenarios } = {}) {
  const q = new URLSearchParams();
  if (leak) q.set("leak", "1");
  if (leak && leakOnly) q.set("only", "1");
  if (scenarios?.length) q.set("scenarios", scenarios.join(","));
  if (skipScenarios?.length) q.set("skip", skipScenarios.join(","));
  const qs = q.toString();
  return `http://127.0.0.1:${port}/${qs ? `?${qs}` : ""}`;
}

async function onePage(browser, { port, mode, timeoutMs, log, leak, leakOnly, scenarios, skipScenarios }) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 850 },
  });
  try {
    await context.addInitScript(INIT_SCRIPT);
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.text().startsWith("[perf]") || process.env.PERF_BROWSER_DEBUG) {
        log?.(`${msg.type()} ${msg.text()}`);
      }
    });
    page.on("pageerror", (e) => log?.(`[pageerror] ${e.message}`));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    if (mode === "low-end") {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE_RATE });
    }
    const getMetrics = async () =>
      (await cdp.send("Performance.getMetrics")).metrics;
    const startMetrics = await getMetrics();
    let peak = 0;
    const sampleHeap = async () => {
      try {
        const { metrics } = await cdp.send("Performance.getMetrics");
        const v = metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? 0;
        if (v > peak) {
          peak = v;
        }
      } catch {}
    };
    const timer = setInterval(sampleHeap, 250);
    let result;
    let tasks = [];
    let marks = [];
    let endT = 0;
    let endMetrics = [];
    let leakHeap = [];
    try {
      const response = await page.goto(pageUrl(port, { leak, leakOnly, scenarios, skipScenarios }));
      if (!response?.ok()) {
        throw new Error(`perf page not served: HTTP ${response?.status()} (is the perf bundle built?)`);
      }
      try {
        await page.waitForFunction(
          () => window.__perfResult !== undefined,
          null,
          {
            timeout: timeoutMs,
            polling: 500,
          },
        );
      } catch (error) {
        const probe = await Promise.race([
          page.evaluate(async () => ({
            visibility: document.visibilityState,
            raf: await Promise.race([
              new Promise((r) => requestAnimationFrame(() => r(true))),
              new Promise((r) => setTimeout(() => r(false), 3000)),
            ]),
            textarea: !!document.querySelector("textarea.excalidraw-wysiwyg"),
            lastPhaseAt: (window.__perfMarks || []).slice(-1)[0]?.t,
            now: performance.now(),
            editorId: document
              .querySelector(".vault-editor")
              ?.getAttribute("data-document-id"),
            sceneReady: document
              .querySelector(".vault-editor")
              ?.getAttribute("data-scene-ready"),
            busy: !!document.querySelector(".vault-editor-container--busy"),
            loading: !!document.querySelector(".LoadingMessage"),
            marks: (window.__perfMarks || []).map((m) => m.name).join(","),
          })),
          new Promise((r) =>
            setTimeout(() => r("main thread unresponsive"), 5000),
          ),
        ]).catch((e) => String(e));
        await page
          .screenshot({
            path: path.join(
              path.dirname(fileURLToPath(import.meta.url)),
              "../../../.cache/perf/browser-stall.png",
            ),
            timeout: 5000,
          })
          .catch(() => {});
        throw new Error(
          `perf page stalled: ${JSON.stringify(probe)} (${
            error.message.split("\n")[0]
          })`,
        );
      }
      await sampleHeap();
      endMetrics = await getMetrics();
      ({ result, tasks, marks, endT, leakHeap } = await page.evaluate(() => ({
        leakHeap: window.__leakHeap ?? [],
        result: window.__perfResult,
        tasks: window.__longTasks,
        marks: window.__perfMarks,
        endT: performance.now(),
      })));
    } finally {
      clearInterval(timer);
    }
    return {
      result,
      tasks,
      marks,
      endT,
      leakHeap,
      peakMB: peak / (1024 * 1024),
      cdp: { start: startMetrics, end: endMetrics },
    };
  } finally {
    await context.close().catch(() => {});
  }
}

export async function runBrowser({
  mode = "normal",
  runs = 3,
  warmup = 1,
  vaultDir,
  config,
  wtRoot = defaultWtRoot,
  build = true,
  onRun = () => {},
  leak = false,
  leakOnly = false,
  scenarios,
  skipScenarios,
  log = () => {},
}) {
  const desktop = path.join(wtRoot, "excalidraw-desktop");
  const distDir = path.join(wtRoot, ".cache/perf/browser-dist");
  // `--no-build` reuses the packaged app; the Chromium bundle is separate and a fresh
  // worktree has none (perf.html would 404 and the page would wait forever with no marks).
  if (build || !(await hasPerfPage(distDir))) {
    await runVite(desktop, log);
  }

  const { server, port } = await startServer({ distDir, vaultDir });
  let browser;
  const cleanup = async () => {
    await browser?.close().catch(() => {});
    server.close();
  };
  const onSigint = () => cleanup().finally(() => process.exit(130));
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigint);

  const timeoutMs =
    Number(process.env.PERF_BROWSER_TIMEOUT_MS) ||
    (mode === "low-end" ? 5 * 60_000 : 90_000) + (leak ? 120_000 : 0);
  const samplesPerRun = [];
  const errors = [];
  const info = { engine: "chromium", mode, warmup, runs };
  if (mode === "low-end") {
    info.cpuThrottlingRate = THROTTLE_RATE;
  }
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--disable-background-timer-throttling",
        // Leak mode reads performance.memory after a forced GC.
        ...(leak ? ["--js-flags=--expose-gc", "--enable-precise-memory-info"] : []),
      ],
    });
    info.browserVersion = browser.version();
    for (let i = 0; i < warmup + runs; i++) {
      const isWarmup = i < warmup;
      log(
        `[browser] ${
          isWarmup ? "warmup" : `run ${i - warmup + 1}/${runs}`
        } (${mode})`,
      );
      if (!isWarmup) {
        onRun(i - warmup);
      }
      let page;
      // Headless rAF occasionally stalls under heavy machine load: retry a stalled run once.
      for (let attempt = 0; ; attempt++) {
        try {
          page = await onePage(browser, { port, mode, timeoutMs, log, leak, leakOnly, scenarios, skipScenarios });
          break;
        } catch (error) {
          if (
            attempt >= 1 ||
            !String(error.message).startsWith("perf page stalled")
          ) {
            throw error;
          }
          info.stalledRetries = (info.stalledRetries ?? 0) + 1;
          log(`[browser] ${error.message.slice(0, 300)}; retrying`);
        }
      }
      const { result, tasks, marks, endT, leakHeap, peakMB, cdp } = page;
      if (!info.cdpMetricNames) {
        info.cdpMetricNames = cdp.end.map((m) => m.name);
      }
      if (isWarmup) {
        continue;
      }
      const out = {};
      for (const [k, v] of Object.entries(result.samples ?? {})) {
        out[`browser.${k}`] = v;
      }
      out["browser.memory.jsHeapPeakMB"] = [peakMB];
      const lt = longTaskStats(tasks, marks, endT);
      out["browser.longTasks.count"] = [lt.count];
      out["browser.longTasks.totalMs"] = [lt.totalMs];
      // CPU time / event counts over the whole page run: far less load-sensitive than wall time.
      Object.assign(out, cdpDeltas(cdp.start, cdp.end));
      if (leak) {
        const { samples: leakSamples, rows } = leakSummary(
          leakHeap.map((c) => ({ label: c.label, procs: { jsHeap: c.jsHeapMB } })),
        );
        Object.assign(out, leakSamples);
        info.leakJsHeapMB = rows.map((r) => `${r.label}=${r.totalMB.toFixed(1)}`).join(" ");
      }
      samplesPerRun.push(out);
      Object.assign(info, result.info ?? {});
      for (const e of result.errors ?? []) {
        errors.push(`run ${i - warmup + 1}: ${e}`);
      }
    }
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigint);
    await cleanup();
  }
  return { samplesPerRun, info, errors };
}

// -------------------------------------------------------------- CLI ----
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const mode = args.includes("--low-end") ? "low-end" : "normal";
  const ri = args.indexOf("--runs");
  const runs = ri >= 0 ? Number(args[ri + 1]) : 3;
  const { ensureVault } = await import("./fixtures.mjs");
  const config = JSON.parse(
    await fs.readFile(
      path.join(desktopDir, "perf/fixtures.config.json"),
      "utf8",
    ),
  );
  const { vaultDir } = await ensureVault({
    cacheDir: path.join(defaultWtRoot, ".cache/perf/fixtures"),
    config,
  });
  const started = Date.now();
  const { samplesPerRun, info, errors } = await runBrowser({
    mode,
    runs,
    vaultDir,
    config,
    build: !args.includes("--no-build"),
    log: console.log,
  });
  const all = {};
  for (const run of samplesPerRun) {
    for (const [k, v] of Object.entries(run)) {
      (all[k] ??= []).push(...v);
    }
  }
  for (const k of Object.keys(all).sort()) {
    console.log(
      `${k.padEnd(40)} median ${median(all[k]).toFixed(2)}  (n=${
        all[k].length
      })`,
    );
  }
  console.log("info", JSON.stringify(info));
  if (errors.length) {
    console.log("errors", errors);
  }
  console.log(`elapsed ${((Date.now() - started) / 1000).toFixed(0)}s`);
  process.exit(errors.length ? 1 : 0);
}

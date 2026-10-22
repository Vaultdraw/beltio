import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test, webkit, type Page } from "@playwright/test";

import { openDrawing, openVault } from "./helpers";
import { largeSceneJson, typicalSceneJson } from "./memoryProbeScene";

// Opt-in headless WebKit memory probe (E2E_MEMORY=1) for fast relative A/Bs
// when the packaged app cannot be measured. Per phase it reports the live
// canvas backing-store bytes (page side) and the WebContent process footprint
// (OS side). It asserts nothing but that every phase ran.
//
//   cd excalidraw-desktop && sh ../personal/metrics/heavy.sh \
//     env E2E_MEMORY=1 E2E_WORKERS=1 npx playwright test memoryProbe
//
// Output: `MEMPROBE {json}` lines and test-results/memory-probe.json.

test.skip(process.env.E2E_MEMORY !== "1", "opt-in: set E2E_MEMORY=1");
test.use({ viewport: { width: 1280, height: 850 }, deviceScaleFactor: 2 });

const MB = 2 ** 20;

/** Tracks every canvas the page creates (DOM or not) via WeakRef. */
const trackCanvases = (page: Page) =>
  page.addInitScript(() => {
    const w = window as any;
    w.__canvases = [] as WeakRef<HTMLCanvasElement>[];
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function (
      this: Document,
      name: string,
      options?: ElementCreationOptions,
    ) {
      const el = create.call(this, name, options);
      if (String(name).toLowerCase() === "canvas") {
        w.__canvases.push(new WeakRef(el as HTMLCanvasElement));
      }
      return el;
    } as typeof Document.prototype.createElement;
  });

const pageStats = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    const live = new Set<HTMLCanvasElement>(
      document.querySelectorAll("canvas"),
    );
    for (const ref of w.__canvases as WeakRef<HTMLCanvasElement>[]) {
      const c = ref.deref();
      if (c) {
        live.add(c);
      }
    }
    const size = (c: HTMLCanvasElement | null) =>
      c ? `${c.width}x${c.height}` : "none";
    let liveBytes = 0;
    let domBytes = 0;
    for (const c of live) {
      const b = c.width * c.height * 4;
      liveBytes += b;
      if (c.isConnected) {
        domBytes += b;
      }
    }
    const imgs = [...document.querySelectorAll("img")];
    const decoded = imgs.reduce(
      (n, i) => n + i.naturalWidth * i.naturalHeight * 4,
      0,
    );
    return {
      liveCanvasMB: liveBytes / 2 ** 20,
      domCanvasMB: domBytes / 2 ** 20,
      canvasCount: live.size,
      interactiveCanvas: size(document.querySelector("canvas.interactive")),
      staticCanvas: size(document.querySelector("canvas.static")),
      imageCount: imgs.length,
      imageDecodedMB: decoded / 2 ** 20,
    };
  });

// ---- process footprint ----------------------------------------------------

type Proc = { pid: number; kind: "content" | "gpu" | "network" };

/** Playwright WebKit helper processes (XPC children of launchd, not of the browser). */
const webkitProcs = (): Proc[] => {
  try {
    const out = execFileSync("ps", ["-axo", "pid=,command="], {
      encoding: "utf8",
    });
    const procs: Proc[] = [];
    for (const l of out.split("\n")) {
      if (!/ms-playwright\/webkit/.test(l)) {
        continue;
      }
      const pid = Number(l.trim().split(/\s+/)[0]);
      const kind = /WebContent/.test(l)
        ? "content"
        : /WebKit\.GPU/.test(l)
        ? "gpu"
        : /WebKit\.Networking/.test(l)
        ? "network"
        : null;
      if (pid && kind) {
        procs.push({ pid, kind });
      }
    }
    return procs;
  } catch {
    return [];
  }
};

const UNIT: Record<string, number> = { B: 1, KB: 1024, MB, GB: 1024 * MB };
const toMB = (n: string, u: string) => (Number(n) * UNIT[u]) / MB;

/** `footprint -p <pid>` text: total phys_footprint and the graphics-ish categories. */
const footprintOf = (pid: number) => {
  try {
    const raw = execFileSync("/usr/bin/footprint", ["-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const total = /Footprint:\s+([\d.]+)\s+(B|KB|MB|GB)/.exec(raw);
    if (!total) {
      return null;
    }
    let graphics = 0;
    for (const l of raw.split("\n")) {
      const m = /^\s*([\d.]+)\s+(B|KB|MB|GB)\s+.*?\s(\S.*)$/.exec(l);
      if (m && /graphics|IOSurface|IOAccelerator|CG image/i.test(l)) {
        graphics += toMB(m[1], m[2]);
      }
    }
    return { totalMB: toMB(total[1], total[2]), graphicsMB: graphics };
  } catch {
    return null;
  }
};

const sampleFootprint = (procs: Proc[]) => {
  const out: Record<string, number | null> = {
    contentMB: null,
    contentGraphicsMB: null,
    gpuMB: null,
    footprintMB: null,
  };
  let total = 0;
  let any = false;
  for (const { pid, kind } of procs) {
    const f = footprintOf(pid);
    if (!f) {
      continue;
    }
    any = true;
    if (kind === "content") {
      out.contentMB = round((out.contentMB ?? 0) + f.totalMB);
      out.contentGraphicsMB = round(
        (out.contentGraphicsMB ?? 0) + f.graphicsMB,
      );
    } else if (kind === "gpu") {
      out.gpuMB = round((out.gpuMB ?? 0) + f.totalMB);
    }
    total += f.totalMB;
  }
  out.footprintMB = any ? round(total) : null;
  return out;
};

const round = (n: number) => Math.round(n * 10) / 10;

test("memory probe: typical 300-element drawing with 2 images", async ({
  baseURL,
}) => {
  test.setTimeout(180_000);
  // Own browser: helper processes that appear after this point are ours
  // (another concurrent WebKit run would be counted too; contentPids shows it).
  const before = new Set(webkitProcs().map((p) => p.pid));
  const browser = await webkit.launch();
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 850 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await trackCanvases(page);
  // MEMPROBE_SCENE=large: the stress open target (5000 elements, 6 x 3 MB images).
  const scene =
    process.env.MEMPROBE_SCENE === "large"
      ? largeSceneJson()
      : typicalSceneJson();
  await page.addInitScript((s) => {
    (window as any).__memprobeScene = s;
  }, scene);

  const records: Record<string, unknown>[] = [];
  const phase = async (name: string) => {
    await page.waitForTimeout(3000);
    const procs = webkitProcs().filter((p) => !before.has(p.pid));
    const rec = {
      phase: name,
      contentPids: procs.filter((p) => p.kind === "content").length,
      ...sampleFootprint(procs),
      ...(await pageStats(page)),
    };
    const r = { ...rec } as any;
    for (const k of ["liveCanvasMB", "domCanvasMB", "imageDecodedMB"]) {
      r[k] = round(r[k]);
    }
    records.push(r);
    // eslint-disable-next-line no-console
    console.log(`MEMPROBE ${JSON.stringify(r)}`);
  };

  await openVault(page, "?seed=memprobe");
  await phase("home");

  await page
    .locator(".vault-tree-item__name", { hasText: "Projects" })
    .first()
    .click();
  await openDrawing(page, "Architecture 300");
  await phase("drawing-open");

  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ControlOrMeta+s");
  await phase("select-move-save");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(2500);
  await phase("escape-idle");

  await page.mouse.move(640, 425);
  await page.keyboard.down("Shift");
  const t0 = Date.now();
  while (Date.now() - t0 < 1000) {
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(16);
  }
  await page.keyboard.up("Shift");
  await phase("pan");

  await page.keyboard.press("ControlOrMeta+=");
  await page.keyboard.press("ControlOrMeta+=");
  await phase("zoom-in-x2");

  await phase("idle");

  // another small drawing
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  await phase("switch-small-drawing");

  await phase("switch-idle");

  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/memory-probe.json",
    JSON.stringify(records, null, 2),
  );
  await context.close();
  await browser.close();
  expect(records.length).toBe(9);
});

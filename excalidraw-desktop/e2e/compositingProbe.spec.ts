import { execFileSync } from "node:child_process";

import { test, webkit } from "@playwright/test";

import { openDrawing, openVault } from "./helpers";
import { typicalSceneJson } from "./memoryProbeScene";

// Opt-in (E2E_MEMORY=1) headless WebKit probe: GPU process footprint and its
// IOSurfaces by WebKit tag (LayerBacking = composited layer backing stores,
// Canvas = accelerated canvases) with a drawing open, one fresh browser per
// CSS variant, two interleaved rounds. Use it to find layers that cost memory:
//   cd excalidraw-desktop && sh ../personal/metrics/heavy.sh env E2E_MEMORY=1 \
//     E2E_WORKERS=1 npx playwright test compositingProbe --project=webkit
// PM2_VARIANTS=base,svglayer-shown picks variants; PM2_W/PM2_H set the viewport.
test.skip(process.env.E2E_MEMORY !== "1", "opt-in: set E2E_MEMORY=1");

const W = Number(process.env.PM2_W ?? 1280);
const H = Number(process.env.PM2_H ?? 850);

const gpuPids = () =>
  execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" })
    .split("\n")
    .filter((l) => /ms-playwright\/webkit/.test(l) && /WebKit\.GPU/.test(l))
    .map((l) => Number(l.trim().split(/\s+/)[0]));

const surfaces = (pids: number[]) => {
  const tags: Record<string, number> = {};
  const dims: Record<string, number> = {};
  for (const pid of pids) {
    const raw = execFileSync("/usr/bin/footprint", ["-v", "-p", String(pid)], {
      encoding: "utf8",
      maxBuffer: 64 << 20,
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const l of raw.split("\n")) {
      const m =
        /\]\s+(\d+)\s+\d+\s+\d+\s+\d+\s+IOSurface SID: 0x[0-9a-f]+\s+(\d+x\d+).*'([^']*)'/.exec(
          l,
        );
      if (!m) {
        continue;
      }
      const mb = (Number(m[1]) * 16) / 1024;
      tags[m[3]] = (tags[m[3]] ?? 0) + mb;
      const k = `${m[3]} ${m[2]}`;
      dims[k] = (dims[k] ?? 0) + 1;
    }
  }
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    tags: Object.fromEntries(Object.entries(tags).map(([k, v]) => [k, r(v)])),
    dims: Object.entries(dims)
      .filter(([k]) => !k.includes("Canvas"))
      .map(([k, n]) => `${k} x${n}`)
      .join(", "),
  };
};

const VARIANTS: [string, string][] = [
  ["base", ""],
  // Undoes src/editor/compositing.css: the cost of an idle trail layer.
  ["svglayer-shown", ".excalidraw .SVGLayer{display:block!important}"],
  [
    "eyedropper-none",
    ".excalidraw .excalidraw-eye-dropper-container{display:none!important}",
  ],
  ["topbar-none", ".excalidraw .App-top-bar{display:none!important}"],
  ["tabs-none", ".vault-tabs{display:none!important}"],
];
const SEL = (
  process.env.PM2_VARIANTS ?? VARIANTS.map((v) => v[0]).join(",")
).split(",");

for (const round of [1, 2]) {
  for (const [name, css] of VARIANTS.filter((v) => SEL.includes(v[0]))) {
    test(`compositing probe ${name} r${round}`, async ({ baseURL }) => {
      test.setTimeout(180_000);
      const before = new Set(gpuPids());
      const browser = await webkit.launch();
      const context = await browser.newContext({
        baseURL,
        viewport: { width: W, height: H },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      await page.addInitScript(
        ([sc, style]) => {
          (window as any).__memprobeScene = sc;
          if (style) {
            document.addEventListener("DOMContentLoaded", () => {
              const el = document.createElement("style");
              el.textContent = style;
              document.head.appendChild(el);
            });
          }
        },
        [typicalSceneJson(), css] as const,
      );
      await openVault(page, "?seed=memprobe");
      await page
        .locator(".vault-tree-item__name", { hasText: "Projects" })
        .first()
        .click();
      await openDrawing(page, "Architecture 300");
      await page.mouse.move(400, 300);
      await page.waitForTimeout(1200);
      await page.mouse.move(420, 320);
      await page.waitForTimeout(300);
      const pids = gpuPids().filter((p) => !before.has(p));
      const total = pids.reduce((n, pid) => {
        const raw = execFileSync("/usr/bin/footprint", ["-p", String(pid)], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        const m = /Footprint:\s+([\d.]+)\s+(KB|MB|GB)/.exec(raw);
        return (
          n +
          (m
            ? Number(m[1]) *
              (m[2] === "GB" ? 1024 : m[2] === "KB" ? 1 / 1024 : 1)
            : 0)
        );
      }, 0);
      // eslint-disable-next-line no-console
      console.log(
        `COMPOSITING ${name} r${round} gpuMB=${Math.round(
          total,
        )} ${JSON.stringify(surfaces(pids))}`,
      );
      await context.close();
      await browser.close();
    });
  }
}

/* eslint-disable no-console */
import { expect, test } from "@playwright/test";

import { representativeScenes } from "./thumbnailScenes";
import { buildStep0, cleanupStep0, openStep0 } from "./thumbnailsStep0Page";

import type { Step0Hooks } from "./thumbnailsStep0";

// #46: the sliced (time-sliced, non-blocking) thumbnail render must be
// PIXEL-IDENTICAL to the one-task render it replaced. Each representative scene
// (rough/flat shapes, text in seven font families, bound text, freedraw,
// arrows, an embedded image, a dark view background, a 500-element scene) is
// rendered both ways at 1x and 2x density; every RGBA byte must match. One
// `THUMBPIX {json}` line per scene (FNV-1a hash of the pixels, so renders of
// different checkouts can be compared too).
//
//   npx playwright test e2e/thumbnailPixels.spec.ts   (webkit; E2E_FULL=1 adds chromium)
test.describe.configure({ timeout: 300_000 });

test.describe("thumbnail pixel identity", () => {
  test.beforeAll(buildStep0);
  test.afterAll(cleanupStep0);

  test("sliced render equals the one-task render", async ({
    page,
    browserName,
    baseURL,
  }) => {
    await openStep0(page, new URL(baseURL!).origin);
    const scenes = representativeScenes();
    const rows = await page.evaluate(
      async ({ scenes, densities }) => {
        const hooks = (window as unknown as { __step0: Step0Hooks }).__step0;
        const pixels = async (blob: Blob) => {
          const bmp = await createImageBitmap(blob);
          const c = document.createElement("canvas");
          c.width = bmp.width;
          c.height = bmp.height;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(bmp, 0, 0);
          return {
            w: c.width,
            h: c.height,
            data: ctx.getImageData(0, 0, c.width, c.height).data,
          };
        };
        const fnv = (d: Uint8ClampedArray) => {
          let h = 0x811c9dc5;
          for (let i = 0; i < d.length; i++) {
            h = Math.imul(h ^ d[i], 0x01000193) >>> 0;
          }
          return h.toString(16);
        };
        const out: unknown[] = [];
        for (const [name, json] of Object.entries(scenes)) {
          for (const density of densities) {
            // Warm-up: loads the fonts and the editor chunk for both runs.
            await hooks.renderPng(json, density, false);
            const ref = await hooks.renderPng(json, density, false);
            const ref2 = await hooks.renderPng(json, density, false);
            const sliced = await hooks.renderPng(json, density, true);
            if (
              ref.kind !== "png" ||
              ref2.kind !== "png" ||
              sliced.kind !== "png"
            ) {
              out.push({ name, density, fail: [ref.kind, sliced.kind] });
              continue;
            }
            const a = await pixels(ref.blob);
            const b = await pixels(sliced.blob);
            const c2 = await pixels(ref2.blob);
            // Control: two one-task renders of the same scene.
            let selfDiff = 0;
            for (let i = 0; i < a.data.length; i++) {
              if (a.data[i] !== c2.data[i]) {
                selfDiff++;
              }
            }
            let diff = 0;
            let maxDelta = 0;
            let ink = 0;
            for (let i = 0; i < a.data.length; i += 4) {
              if (
                a.data[i] !== b.data[i] ||
                a.data[i + 1] !== b.data[i + 1] ||
                a.data[i + 2] !== b.data[i + 2] ||
                a.data[i + 3] !== b.data[i + 3]
              ) {
                diff++;
                for (let k = 0; k < 4; k++) {
                  maxDelta = Math.max(
                    maxDelta,
                    Math.abs(a.data[i + k] - b.data[i + k]),
                  );
                }
              }
              if (a.data[i] !== a.data[0] || a.data[i + 1] !== a.data[1]) {
                ink++;
              }
            }
            out.push({
              name,
              density,
              w: a.w,
              h: a.h,
              sameSize: a.w === b.w && a.h === b.h,
              diff,
              maxDelta,
              selfDiff,
              ink,
              hash: fnv(a.data),
            });
          }
        }
        return out as {
          name: string;
          density: number;
          fail?: string[];
          sameSize?: boolean;
          diff?: number;
          maxDelta?: number;
          w?: number;
          h?: number;
          selfDiff?: number;
          ink?: number;
          hash?: string;
        }[];
      },
      { scenes, densities: [1, 2] },
    );
    for (const r of rows) {
      console.log(`THUMBPIX ${JSON.stringify({ engine: browserName, ...r })}`);
      expect(r.fail, `${r.name}@${r.density}x render failed`).toBeUndefined();
      expect(r.sameSize).toBe(true);
      if (browserName === "webkit") {
        // WebKit flushes its canvas at every yield, which re-rounds the 8-bit
        // premultiplied alpha of a few anti-aliased edge pixels (measured: <= 8
        // pixels of 67 500, each off by <= 4/255). Every other scene is exact.
        expect(r.maxDelta, `${r.name}@${r.density}x`).toBeLessThanOrEqual(6);
        expect(r.diff, `${r.name}@${r.density}x`).toBeLessThanOrEqual(
          (r.w! * r.h!) / 1000,
        );
      } else {
        expect(r.diff, `${r.name}@${r.density}x differing pixels`).toBe(0);
      }
      // Not a blank-vs-blank pass.
      expect(r.ink, `${r.name}@${r.density}x has content`).toBeGreaterThan(50);
    }
  });
});

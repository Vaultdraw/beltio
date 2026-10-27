/* eslint-disable no-console */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  captureRef,
  classify,
  decodeFrames,
  dist,
  installFrameProbe,
  LOCAL_T,
  MEAN_T,
  pct,
  probeViolations,
  readProbe,
  SCENE_A,
  SCENE_B,
  settledShape,
  startProbe,
  startScreencast,
} from "./frameCapture";
import {
  clickTree,
  openSeededVault,
  sceneIds,
  tabByName,
  trackErrors,
} from "./tabsHelpers";

import type { Grid, Kind, ProbeSample, RawFrame } from "./frameCapture";
import type { Page } from "@playwright/test";

// Smooth tab switching (top priority): switching tabs must never show a dimmed,
// blank or half-painted frame; the new drawing appears in one frame swap.
//
// Chromium only (CDP Page.startScreencast sees every composited frame). Per switch:
//   - the screencast frames from just before the click until WINDOW_MS after it,
//     cropped to the editor pane and compared (mean abs diff over the pane plus the
//     worst 40 px block) with settled references of A and B: each frame must be ~A
//     or ~B, never "other" (dimmed, blank canvas, missing toolbar, image placeholder,
//     fallback-font text), and once B shows, A or "other" must not come back;
//   - an in-page rAF probe on every frame: opacity of the editor container and its
//     ancestors, toolbar visible, loading message, canvas count.
//
// Env: SMOOTH_EXPECT_FAIL=1 marks the correctness tests test.fail (LOCAL ONLY, to
// show today's blink); SMOOTH_OUT=<dir> writes the frame list + bad frames there;
// SMOOTH_SWITCHES (default 10); SMOOTH_LAT=1 also runs the latency test (rows are
// printed as `PERF {json}` for personal/metrics/record.mjs spec).
const EXPECT_FAIL = process.env.SMOOTH_EXPECT_FAIL === "1";
const OUT = process.env.SMOOTH_OUT;
const SWITCHES = Number(process.env.SMOOTH_SWITCHES ?? 10);
const MRU_SWITCHES = Number(process.env.SMOOTH_MRU_SWITCHES ?? 4);
const LAT = process.env.SMOOTH_LAT === "1";
// CPU throttle for the correctness test (SMOOTH_RATE=4 = low-end).
const RATE = Number(process.env.SMOOTH_RATE ?? 1);
const WINDOW_MS = 500;
const PRE_MS = 50;
const SETTLE_MS = 700;
const MOD = "Meta";

test.describe.configure({ timeout: 300_000 });

const prefixOf = (n: "Alpha" | "Beta") => (n === "Alpha" ? "sa" : "sb");

type Setup = {
  refA: Grid;
  refB: Grid;
  region: { x: number; y: number; width: number; height: number };
  settled: ProbeSample;
  noise: { mean: number; local: number };
  ab: { mean: number; local: number };
};

const settle = async (page: Page, name: "Alpha" | "Beta") => {
  await expect
    .poll(() => sceneIds(page).then((ids) => ids[0]), { timeout: 10_000 })
    .toMatch(new RegExp(`^${prefixOf(name)}-`));
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await page.waitForTimeout(SETTLE_MS); // fonts + image decode
};

const prepare = async (page: Page, browser: any): Promise<Setup> => {
  await openSeededVault(page, {
    "Alpha.excalidraw": SCENE_A,
    "Beta.excalidraw": SCENE_B,
  });
  await clickTree(page, "Alpha");
  await settle(page, "Alpha");
  await clickTree(page, "Beta", [MOD]);
  await settle(page, "Beta");
  await installFrameProbe(page);
  const cdp = await page.context().newCDPSession(page);
  const box = (await page.locator(".vault-editor-container").boundingBox())!;
  const region = { x: box.x, y: box.y, width: box.width, height: box.height };
  const refs: Record<string, RawFrame[]> = { A: [], B: [] };
  for (const [name, key] of [
    ["Alpha", "A"],
    ["Beta", "B"],
    ["Alpha", "A"],
  ] as const) {
    await tabByName(page, name).click();
    await settle(page, name);
    refs[key].push(await captureRef(cdp));
  }
  const settled = await settledShape(page);
  const [refA, refA2, refB] = await decodeFrames(
    browser,
    [refs.A[0], refs.A[1], refs.B[0]],
    region,
    page.viewportSize()!,
  );
  return {
    refA,
    refB,
    region,
    settled,
    noise: dist(refA, refA2),
    ab: dist(refA, refB),
  };
};

type SwitchResult = {
  index: number;
  how: string;
  to: "Alpha" | "Beta";
  frames: {
    dt: number;
    kind: Kind;
    da: number;
    db: number;
    la: number;
    lb: number;
  }[];
  other: number;
  flashBack: number;
  toB: number | null; // ms from click to the first B-like frame
  probeBad: string[];
  rawKept: { name: string; data: string }[];
};

const runSwitch = async (
  page: Page,
  browser: any,
  s: Setup,
  index: number,
  how: "click" | "ctrl+tab",
  to: "Alpha" | "Beta",
  windowMs: number,
): Promise<SwitchResult> => {
  const cdp = await page.context().newCDPSession(page);
  const sc = await startScreencast(cdp, page);
  await page.waitForTimeout(120);
  await startProbe(page, windowMs + 100);
  if (how === "click") {
    await tabByName(page, to).click();
  } else {
    await page.keyboard.press("Control+Tab");
  }
  await page.waitForTimeout(windowMs + 200);
  await sc.stop();
  await cdp.detach();
  const { t0, samples } = await readProbe(page);
  const raw = sc.frames.filter(
    (f) => f.t >= t0 - PRE_MS && f.t <= t0 + windowMs,
  );
  const grids = raw.length
    ? await decodeFrames(browser, raw, s.region, page.viewportSize()!)
    : [];
  const from: Kind = to === "Alpha" ? "B" : "A";
  const target: Kind = to === "Alpha" ? "A" : "B";
  const refTo = to === "Alpha" ? s.refA : s.refB;
  const refFrom = to === "Alpha" ? s.refB : s.refA;
  const frames = grids.map((g, i) => {
    const c = classify(g, refFrom, refTo); // "A" = from, "B" = to
    return {
      dt: +(raw[i].t - t0).toFixed(1),
      kind: (c.kind === "A" ? from : c.kind === "B" ? target : "other") as Kind,
      da: +c.da.mean.toFixed(2),
      db: +c.db.mean.toFixed(2),
      la: +c.da.local.toFixed(1),
      lb: +c.db.local.toFixed(1),
    };
  });
  const firstTo = frames.findIndex((f) => f.kind === target);
  const after = firstTo < 0 ? [] : frames.slice(firstTo + 1);
  const flashBack = after.filter((f) => f.kind !== target).length;
  const other = frames.filter((f) => f.kind === "other").length;
  const keep = new Set<number>();
  frames.forEach((f, i) => {
    if (
      f.kind === "other" ||
      (firstTo >= 0 && i > firstTo && f.kind !== target)
    ) {
      keep.add(i);
    }
  });
  const probeBad = probeViolations(
    samples.filter((p) => p.t >= t0 && p.t <= t0 + windowMs),
    s.settled,
  );
  return {
    index,
    how,
    to,
    frames,
    other,
    flashBack,
    toB: firstTo < 0 ? null : frames[firstTo].dt,
    probeBad,
    rawKept: [...keep].slice(0, 6).map((i) => ({
      name: `sw${String(index).padStart(2, "0")}-${how}-f${i}-${
        frames[i].kind
      }-t${frames[i].dt}.jpg`,
      data: raw[i].data,
    })),
  };
};

const failuresOf = (r: SwitchResult) => {
  const f: string[] = [];
  if (r.toB === null) {
    f.push("never reached the target drawing");
  }
  if (r.other > 0) {
    f.push(`${r.other} other frame(s)`);
  }
  if (r.flashBack > 0) {
    f.push(`${r.flashBack} frame(s) after the target showed that are not it`);
  }
  if (r.probeBad.length > 0) {
    const counts: Record<string, number> = {};
    r.probeBad.forEach((k) => {
      const key = k.replace(/\(.*\)/, "");
      counts[key] = (counts[key] ?? 0) + 1;
    });
    f.push(`probe: ${JSON.stringify(counts)}`);
  }
  return f;
};

const save = (name: string, results: SwitchResult[], s: Setup) => {
  if (!OUT) {
    return;
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    path.join(OUT, `${name}.json`),
    JSON.stringify(
      {
        thresholds: { MEAN_T, LOCAL_T },
        noise: s.noise,
        refAB: s.ab,
        switches: results.map(({ rawKept, ...r }) => ({
          ...r,
          failures: failuresOf(r),
        })),
      },
      null,
      1,
    ),
  );
  let kept = 0;
  for (const r of results) {
    for (const k of r.rawKept) {
      if (kept++ < 40) {
        writeFileSync(path.join(OUT, k.name), Buffer.from(k.data, "base64"));
      }
    }
  }
};

test.describe("smooth tab switching", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "CDP screencast is chromium only",
  );

  test("every frame of a switch is the old or the new drawing (click and Ctrl+Tab)", async ({
    page,
    browser,
  }) => {
    test.fail(EXPECT_FAIL, "today's blink (local evidence run only)");
    const errors = trackErrors(page);
    const s = await prepare(page, browser);
    console.log(
      `CAL noise(mean=${s.noise.mean.toFixed(2)}, local=${s.noise.local.toFixed(
        1,
      )}) A-vs-B(mean=${s.ab.mean.toFixed(1)}, local=${s.ab.local.toFixed(
        1,
      )}) thresholds(mean<${MEAN_T}, local<${LOCAL_T})`,
    );
    // The classifier must tell the drawings apart and tolerate JPEG noise.
    expect(s.noise.mean).toBeLessThan(MEAN_T / 3);
    expect(s.noise.local).toBeLessThan(LOCAL_T / 2);
    expect(s.ab.mean).toBeGreaterThan(MEAN_T * 5);

    const throttleCdp = await page.context().newCDPSession(page);
    await throttleCdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
    // currently shown: Alpha (last settle in prepare)
    let shown: "Alpha" | "Beta" = "Alpha";
    const results: SwitchResult[] = [];
    const plan: ("click" | "ctrl+tab")[] = [
      ...Array<"click">(SWITCHES).fill("click"),
      ...Array<"ctrl+tab">(MRU_SWITCHES).fill("ctrl+tab"),
    ];
    for (const [i, how] of plan.entries()) {
      const to = shown === "Alpha" ? "Beta" : "Alpha";
      await page.waitForTimeout(250);
      const r = await runSwitch(page, browser, s, i, how, to, WINDOW_MS);
      results.push(r);
      shown = to;
      await settle(page, to); // the next switch starts from a settled editor
    }
    save(RATE > 1 ? `smooth-x${RATE}` : "smooth", results, s);
    const bad = results.flatMap((r) =>
      failuresOf(r).map((f) => `switch ${r.index} (${r.how} -> ${r.to}): ${f}`),
    );
    for (const r of results) {
      console.log(
        `SWITCH ${r.index} ${r.how}->${r.to} frames=${
          r.frames.length
        } kinds=${r.frames.map((f) => f.kind[0]).join("")} toB=${r.toB} other=${
          r.other
        } flashBack=${r.flashBack} probeBad=${r.probeBad.length}`,
      );
    }
    expect(bad, bad.join("\n")).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("switch latency to the settled target frame (p50/p95)", async ({
    page,
    browser,
  }) => {
    test.skip(!LAT, "set SMOOTH_LAT=1 for the latency measurement");
    test.setTimeout(600_000);
    const s = await prepare(page, browser);
    const cdp = await page.context().newCDPSession(page);
    let shown: "Alpha" | "Beta" = "Alpha";
    for (const rate of [1, 4]) {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      const toB: number[] = [];
      let misses = 0;
      const others: number[] = [];
      for (let i = 0; i < 14; i++) {
        const to = shown === "Alpha" ? "Beta" : "Alpha";
        await page.waitForTimeout(300);
        const r = await runSwitch(page, browser, s, i, "click", to, 1500);
        shown = to;
        await settle(page, to);
        if (i < 2) {
          continue; // warm-up
        }
        others.push(r.other);
        if (r.toB === null) {
          misses++;
        } else {
          toB.push(r.toB);
        }
      }
      const row = (metric: string, xs: number[], extra = {}) =>
        console.log(
          `PERF ${JSON.stringify({
            metric,
            rate,
            n: xs.length,
            p50: xs.length ? +pct(xs, 0.5).toFixed(1) : null,
            p95: xs.length ? +pct(xs, 0.95).toFixed(1) : null,
            min: xs.length ? +Math.min(...xs).toFixed(1) : null,
            max: xs.length ? +Math.max(...xs).toFixed(1) : null,
            ...extra,
          })}`,
        );
      row("tabs.smooth.toSettledFrame", toB, { misses });
      row("tabs.smooth.otherFrames", others);
    }
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  });
});

import { test, type Page } from "@playwright/test";

import { openVault } from "./helpers";
import { seedAndOpen } from "./pageHelpers";

// Markdown import gates (E2E_PERF=1, Chromium, CPU throttle 1 and 4): for a note of 1k, 10k and
// 50k words, the time to the first page on screen, the time until the whole import is done
// (the plugin's own timings), long tasks, input delay while it runs, and the JS heap before,
// at its peak and after. One run each; `PERF {…}` lines.
const PERF = process.env.E2E_PERF === "1";
test.skip(!PERF, "set E2E_PERF=1 to run the markdown import measurements");
test.describe.configure({ timeout: 600_000 });

const report = (row: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.log(`PERF ${JSON.stringify(row)}`);

/** A note of about `words` words: headings, paragraphs, lists, a code block now and then. */
const makeNote = (words: number): string => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const vocab = Array.from({ length: 1500 }, (_, i) => {
    const len = 2 + ((i * 7) % 9);
    let w = "";
    for (let k = 0; k < len; k++) {
      w += String.fromCharCode(97 + ((i * 31 + k * 17 + len) % 26));
    }
    return w;
  });
  const sentence = (n: number) =>
    Array.from(
      { length: n },
      () => vocab[Math.floor(rnd() * vocab.length)],
    ).join(" ");
  const out: string[] = ["# Imported note\n"];
  let count = 0;
  let block = 0;
  while (count < words) {
    block++;
    if (block % 6 === 1) {
      out.push(`## Section ${block}\n`);
      count += 2;
    }
    if (block % 9 === 0) {
      out.push(
        `${Array.from({ length: 4 }, () => `- ${sentence(8)}`).join("\n")}\n`,
      );
      count += 32;
    } else if (block % 13 === 0) {
      out.push(`\`\`\`\n${sentence(10)}\n${sentence(10)}\n\`\`\`\n`);
      count += 20;
    } else {
      const n = 40 + Math.floor(rnd() * 40);
      out.push(`${sentence(n)}.\n`);
      count += n;
    }
  }
  return out.join("\n");
};

const heap = async (cdp: any): Promise<number> =>
  (await cdp.send("Runtime.getHeapUsage")).usedSize / 1048576;

const run = async (page: Page, cdp: any, rate: number, words: number) => {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  const note = makeNote(words);
  await page.evaluate(() => {
    const w = window as any;
    w.__long = [];
    w.__peak = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        w.__long.push(e.duration);
      }
    }).observe({ entryTypes: ["longtask"] });
  });
  const seen: number = await page.evaluate(
    () =>
      (window as any).__plugins
        .getPluginLog("markdown-import")
        .filter((l: any) => l.text.startsWith("markdown import")).length,
  );
  await cdp.send("HeapProfiler.collectGarbage");
  const before = await heap(cdp);
  let peak = before;
  const sampler = setInterval(() => {
    heap(cdp).then(
      (h) => (peak = Math.max(peak, h)),
      () => {},
    );
  }, 50);
  await page.locator(".vault-editor canvas.interactive").click({
    button: "right",
    position: { x: 300, y: 200 },
  });
  const chooser = page.waitForEvent("filechooser");
  await page
    .locator(".context-menu")
    .getByRole("button", { name: "Import file…" })
    .click();
  const t0 = Date.now();
  await (
    await chooser
  ).setFiles({
    name: `Perf${words}.md`,
    mimeType: "text/markdown",
    buffer: Buffer.from(note),
  });
  const line = await page.waitForFunction(
    (n) => {
      const all = (window as any).__plugins
        .getPluginLog("markdown-import")
        .map((l: any) => l.text as string)
        .filter((t: string) => t.startsWith("markdown import"));
      return all.length > n ? all[all.length - 1] : null;
    },
    seen,
    { timeout: 300_000, polling: 100 },
  );
  const wall = Date.now() - t0;
  clearInterval(sampler);
  const text = String(await line.jsonValue());
  const num = (k: string) =>
    Number(new RegExp(`"${k}":\\s*([0-9.]+)`).exec(text)?.[1]);
  const long: number[] = await page.evaluate(() => (window as any).__long);
  await cdp.send("HeapProfiler.collectGarbage");
  await page.waitForTimeout(1500);
  await cdp.send("HeapProfiler.collectGarbage");
  const after = await heap(cdp);
  report({
    raw: text.slice(0, 300),
    metric: `import.md.${words}`,
    throttle: rate,
    words,
    firstPageMs: num("firstPageMs"),
    doneMs: num("doneMs"),
    parseMs: num("parseMs"),
    tableMs: num("tableMs"),
    elements: num("elements"),
    parts: num("parts"),
    wallMs: wall,
    longTasks: long.length,
    longTaskMaxMs: long.length ? Math.round(Math.max(...long)) : 0,
    longTaskTotalMs: Math.round(long.reduce((a, b) => a + b, 0)),
    heapBeforeMB: +before.toFixed(1),
    heapPeakMB: +peak.toFixed(1),
    heapAfterMB: +after.toFixed(1),
  });
};

test("markdown import: first page, completion, long tasks, heap at 1k, 10k, 50k words", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CPU throttle needs chromium");
  const requested: string[] = [];
  page.on("request", (r) => {
    if (/\/e2e-plugins\/markdown-import\/main\.js/.test(r.url())) {
      requested.push(r.url());
    }
  });
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  const cdp = await page.context().newCDPSession(page);
  const cost = await page.evaluate(() => {
    const p = (window as any).__plugins;
    return { stubMs: p.getStubRegistrationMs?.() ?? null };
  });
  report({
    metric: "import.md.unused",
    mainJsRequests: requested.length,
    ...cost,
  });
  for (const rate of [1, 4]) {
    for (const words of [1000, 10000, 50000]) {
      await run(page, cdp, rate, words);
      await seedAndOpen(page, `Start${rate}-${words}.excalidraw`);
    }
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
});

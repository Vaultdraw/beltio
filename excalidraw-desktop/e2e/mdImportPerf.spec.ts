import { expect, test, type Page } from "@playwright/test";

import { clickMainMenuItem, openVault } from "./helpers";
import { runPaletteCommand } from "./historyHelpers";
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

// ---- Obsidian vault import at scale (synthetic vaults, no real data) ----
// 600 notes + 500 attachments and 5,000 notes + 2,000 attachments, each with callouts, tables,
// embeds, wikilinks and 20 .excalidraw.md drawings. The import is clicked through the main menu;
// while it runs a probe measures how late the main thread answers (event-loop lag) and how long
// typing in an unrelated input takes to reach its handler; a second run is cancelled after 1 s and
// the time until the import stops is measured. One run each, `PERF {…}` lines.
const VAULT_BUDGETS: Record<
  string,
  { maxMs: number; maxLongMs: number; maxLagMs: number; maxHeapMB: number }
> = {
  // Budgets (headless Chromium, fake backend): see DECISIONS.md "obsidian-import-scale".
  "600:1": { maxMs: 20_000, maxLongMs: 120, maxLagMs: 150, maxHeapMB: 250 },
  "600:4": { maxMs: 60_000, maxLongMs: 300, maxLagMs: 400, maxHeapMB: 250 },
  "5000:1": { maxMs: 120_000, maxLongMs: 120, maxLagMs: 150, maxHeapMB: 700 },
  "5000:4": { maxMs: 400_000, maxLongMs: 300, maxLagMs: 400, maxHeapMB: 700 },
};

/** Builds the vault inside the page (a 5,000-note vault is too big to pass through the protocol). */
const seedVault = (page: Page, notes: number, attachments: number) =>
  page.evaluate(
    ({ notes, attachments }) => {
      let seed = 11;
      const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      const vocab = Array.from({ length: 800 }, (_, i) => {
        let w = "";
        for (let k = 0; k < 2 + ((i * 7) % 9); k++) {
          w += String.fromCharCode(97 + ((i * 31 + k * 17) % 26));
        }
        return w;
      });
      const words = (n: number) =>
        Array.from({ length: n }, () => vocab[Math.floor(rnd() * 800)]).join(
          " ",
        );
      const files: Record<string, string | Uint8Array> = {};
      const dirs = 40;
      const noteName = (i: number) => `Area ${i % dirs}/Note ${i}.md`;
      for (let i = 0; i < notes; i++) {
        const link = () => `[[Note ${Math.floor(rnd() * notes)}]]`;
        const img = `![[img-${Math.floor(rnd() * attachments)}.png]]`;
        files[noteName(i)] = [
          `---\ntags: [a, b]\n---\n# Note ${i}\n`,
          `${words(60)} ${link()} ${words(20)} ${link()}.\n`,
          `> [!note] A callout\n> ${words(25)}\n`,
          `| a | b | c |\n| - | - | - |\n| ${words(2)} | ${words(2)} | ${words(
            2,
          )} |\n| ${words(2)} | ${words(2)} | ${words(2)} |\n`,
          `${img}\n`,
          `## Section\n\n${words(80)}\n\n- ${words(6)}\n- ${words(6)}\n`,
        ].join("\n");
      }
      const sketch = JSON.stringify({
        type: "excalidraw",
        version: 2,
        elements: [],
        appState: {},
        files: {},
      });
      for (let i = 0; i < 20; i++) {
        files[
          `Drawings/Sketch ${i}.excalidraw.md`
        ] = `## Drawing\n\`\`\`json\n${sketch}\n\`\`\`\n`;
      }
      for (let i = 0; i < attachments; i++) {
        files[`attachments/img-${i}.png`] = new Uint8Array(
          2048 + (i % 7) * 4096,
        );
      }
      (window as any).__plugins.backend.folders.sourcePick = {
        name: `Scale ${notes}`,
        files,
      };
      return Object.keys(files).length;
    },
    { notes, attachments },
  );

const lagProbe = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    w.__lag = { max: 0, count: 0, sum: 0 };
    w.__keyDelay = [] as number[];
    const input = document.createElement("input");
    input.id = "__probe";
    input.style.cssText =
      "position:fixed;left:0;bottom:0;width:60px;z-index:99999";
    document.body.appendChild(input);
    input.addEventListener("keydown", (e) =>
      w.__keyDelay.push(performance.now() - e.timeStamp),
    );
    let last = performance.now();
    w.__lagTimer = setInterval(() => {
      const now = performance.now();
      const late = now - last - 20;
      last = now;
      w.__lag.count++;
      w.__lag.sum += Math.max(0, late);
      w.__lag.max = Math.max(w.__lag.max, late);
    }, 20);
  });

const lagResult = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    clearInterval(w.__lagTimer);
    document.getElementById("__probe")?.remove();
    const d: number[] = w.__keyDelay;
    const sorted = [...d].sort((a, b) => a - b);
    return {
      lagMaxMs: Math.round(w.__lag.max),
      lagMeanMs: +(w.__lag.sum / Math.max(1, w.__lag.count)).toFixed(1),
      keys: d.length,
      keyDelayP95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
      keyDelayMaxMs: Math.round(sorted[sorted.length - 1] ?? 0),
    };
  });

const importVaultRun = async (
  page: Page,
  cdp: any,
  rate: number,
  notes: number,
  attachments: number,
  cancelAfterMs: number | null,
) => {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const entries = await seedVault(page, notes, attachments);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  // A toast of the previous run must be gone before this run's final toast is awaited.
  await page.waitForFunction(
    () =>
      !/Imported \d+ notes|Import cancelled/.test(
        document.body.textContent ?? "",
      ),
    null,
    { timeout: 30_000 },
  );
  await page.evaluate(() => {
    const w = window as any;
    w.__long = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        w.__long.push(e.duration);
      }
    }).observe({ entryTypes: ["longtask"] });
    // When the import's final toast shows (the plugin's own wording).
    w.__doneAt = 0;
    new MutationObserver(() => {
      if (
        !w.__doneAt &&
        /Imported \d+ notes|Import cancelled/.test(
          document.body.textContent ?? "",
        )
      ) {
        w.__doneAt = performance.now();
        w.__doneText = /Imported \d+ notes[^\n]*|Import cancelled[^\n]*/.exec(
          document.body.textContent ?? "",
        )?.[0];
      }
    }).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    w.__written = () => {
      const t = Object.values(
        w.__plugins.backend.folders.targets as Record<string, any>,
      ).pop();
      return Object.keys(t?.files ?? {}).length;
    };
  });
  await cdp.send("HeapProfiler.collectGarbage");
  const before = await heap(cdp);
  let peak = before;
  const sampler = setInterval(() => {
    heap(cdp).then(
      (h) => (peak = Math.max(peak, h)),
      () => {},
    );
  }, 250);
  await lagProbe(page);
  const t0 = await page.evaluate(() => performance.now());
  await clickMainMenuItem(page, "Import Obsidian vault…");
  // Type into the unrelated input every 200 ms while the import runs.
  let typing = true;
  const typer = (async () => {
    await page.locator("#__probe").focus();
    while (typing) {
      await page.keyboard.press("a");
      await page.waitForTimeout(200);
    }
  })();
  let cancelLatency: number | null = null;
  if (cancelAfterMs !== null) {
    await page.waitForTimeout(cancelAfterMs);
    typing = false;
    await typer;
    const clickAt = await page.evaluate(() => performance.now());
    await runPaletteCommand(page, "Import: Cancel");
    await page.waitForFunction(() => (window as any).__doneAt > 0, null, {
      timeout: 120_000,
      polling: 20,
    });
    const doneAt: number = await page.evaluate(() => (window as any).__doneAt);
    cancelLatency = Math.round(doneAt - clickAt);
  } else {
    await page.waitForFunction(() => (window as any).__doneAt > 0, null, {
      timeout: 900_000,
      polling: 250,
    });
    typing = false;
    await typer;
  }
  clearInterval(sampler);
  const doneAt: number = await page.evaluate(() => (window as any).__doneAt);
  const text: string = await page.evaluate(() => (window as any).__doneText);
  const written: number = await page.evaluate(() =>
    (window as any).__written(),
  );
  const lag = await lagResult(page);
  const long: number[] = await page.evaluate(() => (window as any).__long);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await cdp.send("HeapProfiler.collectGarbage");
  const after = await heap(cdp);
  const totalMs = Math.round(doneAt - t0);
  const row = {
    metric: `import.obsidian.${notes}${
      cancelAfterMs === null ? "" : ".cancel"
    }`,
    throttle: rate,
    notes,
    attachments,
    entries,
    totalMs,
    filesWritten: written,
    filesPerSec: +((written * 1000) / Math.max(1, totalMs)).toFixed(1),
    longTasks: long.length,
    longTaskMaxMs: long.length ? Math.round(Math.max(...long)) : 0,
    longTaskTotalMs: Math.round(long.reduce((a, b) => a + b, 0)),
    heapBeforeMB: +before.toFixed(1),
    heapPeakMB: +peak.toFixed(1),
    heapAfterMB: +after.toFixed(1),
    cancelLatencyMs: cancelLatency,
    ...lag,
    toast: text?.slice(0, 120),
  };
  report(row);
  return row;
};

test("obsidian vault import at scale: time, throughput, long tasks, heap, input delay, cancel", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CPU throttle needs chromium");
  const only = process.env.SCALE_ONLY; // "600" or "5000" to run one size
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  const cdp = await page.context().newCDPSession(page);
  const sizes: [number, number][] = [
    [600, 500],
    [5000, 2000],
  ];
  for (const rate of [1, 4]) {
    for (const [notes, attachments] of sizes) {
      if (only && String(notes) !== only) {
        continue;
      }
      await seedAndOpen(page, `Scale${rate}-${notes}.excalidraw`);
      const row = await importVaultRun(
        page,
        cdp,
        rate,
        notes,
        attachments,
        null,
      );
      const b = VAULT_BUDGETS[`${notes}:${rate}`];
      expect.soft(row.totalMs, "import total").toBeLessThan(b.maxMs);
      expect.soft(row.longTaskMaxMs, "longest task").toBeLessThan(b.maxLongMs);
      expect.soft(row.lagMaxMs, "event-loop lag").toBeLessThan(b.maxLagMs);
      expect.soft(row.heapPeakMB, "heap peak").toBeLessThan(b.maxHeapMB);
      expect.soft(row.keyDelayMaxMs, "typing delay").toBeLessThan(b.maxLagMs);
      await seedAndOpen(page, `ScaleCancel${rate}-${notes}.excalidraw`);
      const c = await importVaultRun(page, cdp, rate, notes, attachments, 1000);
      expect.soft(c.cancelLatencyMs, "cancel latency").toBeLessThan(500);
    }
  }
});

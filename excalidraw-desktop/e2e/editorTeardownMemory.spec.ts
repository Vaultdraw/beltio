import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault } from "./helpers";

// Closing a drawing must release its editor canvases' backing stores at once:
// WebKit keeps a detached canvas's pixels until GC, so Excalidraw's static,
// interactive and new-element canvases are shrunk to 0x0 on unmount.

/** Records every canvas the page creates (some never enter the DOM). */
const trackCanvases = (page: Page) =>
  page.addInitScript(() => {
    const w = window as any;
    w.__canvases = [] as WeakRef<HTMLCanvasElement>[];
    // canvases seen inside an editor while connected (detached nodes no
    // longer match `.vault-editor canvas` reliably)
    w.__editorCanvases = new WeakSet<HTMLCanvasElement>();
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
    const mark = () => {
      document
        .querySelectorAll<HTMLCanvasElement>(".vault-editor canvas")
        .forEach((c) => w.__editorCanvases.add(c));
    };
    setInterval(mark, 50);
    new MutationObserver(mark).observe(document, {
      childList: true,
      subtree: true,
    });
  });

const editorCanvasMemory = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    const all = new Set<HTMLCanvasElement>(document.querySelectorAll("canvas"));
    for (const ref of w.__canvases as WeakRef<HTMLCanvasElement>[]) {
      const c = ref.deref();
      if (c) {
        all.add(c);
      }
    }
    let detached = 0;
    let mounted = 0;
    for (const c of all) {
      if (!w.__editorCanvases.has(c)) {
        continue;
      }
      const bytes = c.width * c.height * 4;
      if (c.isConnected) {
        mounted += bytes;
      } else {
        detached += bytes;
      }
    }
    return {
      detachedMB: detached / 2 ** 20,
      mountedMB: mounted / 2 ** 20,
      staticWidth:
        document.querySelector<HTMLCanvasElement>(".vault-editor canvas.static")
          ?.width ?? 0,
    };
  });

test("closed editors release their canvas backing stores", async ({ page }) => {
  await trackCanvases(page);
  await openVault(page, "?seed=search");
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  for (const name of ["Graphs", "Shortest Paths", "Graphs", "Shortest Paths"]) {
    await openDrawing(page, name);
  }
  await page.waitForTimeout(500);

  const mem = await editorCanvasMemory(page);
  // eslint-disable-next-line no-console
  console.log(`MEM ${JSON.stringify(mem)}`);
  expect(mem.detachedMB).toBeLessThan(1);
  // the mounted editor still renders
  expect(mem.staticWidth).toBeGreaterThan(0);
  expect(mem.mountedMB).toBeGreaterThan(0);
});

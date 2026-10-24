import { expect, test, type Page } from "@playwright/test";

import { canvasBox, openVault, trackErrors } from "./helpers";
import { focusCanvas, seedAndOpen, toScene } from "./pageHelpers";

// The text-import example (sdk/examples/text-import) through the real UI:
// a dropped .txt is imported by a plugin that loads only at that moment, and
// the result is one undo step at the drop point.

const DRAWING = "Notes.excalidraw";
const TEXT = "Hello from a file";

const mainRequests = (page: Page) => {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (/\/e2e-plugins\/[^/]+\/main\.js/.test(r.url())) {
      urls.push(r.url());
    }
  });
  return urls;
};

/** The live text elements, read from the editor instance (found through React's fibers). */
const readTexts = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector(".vault-editor canvas.interactive")!;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
    let fiber = (el as any)[key];
    while (fiber) {
      const s = fiber.stateNode;
      if (s && s.scene && s.state && typeof s.state.scrollX === "number") {
        return s.scene
          .getNonDeletedElements()
          .filter((e: any) => e.type === "text")
          .map((e: any) => ({ text: e.text, x: e.x, y: e.y }));
      }
      fiber = fiber.return;
    }
    throw new Error("editor instance not found");
  });

test("a dropped .txt is imported by the text-import plugin, in one undo step", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const mains = mainRequests(page);
  await openVault(page, "?plugins=text-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, DRAWING);
  expect(mains).toEqual([]);

  const box = await canvasBox(page);
  const client = { x: box.x + 220, y: box.y + 160 };
  const expected = await toScene(page, client.x, client.y);

  // Drop, then wait (inside the page) for the text to be in the scene.
  const ms = await page.evaluate(
    async ({ x, y, text }) => {
      const target = document.querySelector(".vault-editor .excalidraw")!;
      const scene = () => {
        const el = document.querySelector(".vault-editor canvas.interactive")!;
        const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
        let fiber = (el as any)[key];
        while (fiber) {
          const s = fiber.stateNode;
          if (s && s.scene && s.state && typeof s.state.scrollX === "number") {
            return s.scene;
          }
          fiber = fiber.return;
        }
        throw new Error("editor instance not found");
      };
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(
        new File([text], "hello.txt", { type: "text/plain" }),
      );
      const init = {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientX: x,
        clientY: y,
      };
      const t0 = performance.now();
      for (const t of ["dragenter", "dragover", "drop"]) {
        target.dispatchEvent(new DragEvent(t, init));
      }
      return new Promise<number>((resolve, reject) => {
        const tick = () => {
          const hit = scene()
            .getNonDeletedElements()
            .some((e: any) => e.type === "text" && e.text === text);
          if (hit) {
            resolve(performance.now() - t0);
          } else if (performance.now() - t0 > 10_000) {
            reject(new Error("text did not appear"));
          } else {
            requestAnimationFrame(tick);
          }
        };
        tick();
      });
    },
    { x: client.x, y: client.y, text: TEXT },
  );
  // Budget: 50 ms (cold plugin, normal speed); frame polling adds up to ~16 ms.
  // eslint-disable-next-line no-console
  console.log(`text-import: drop to text in scene ${ms.toFixed(1)} ms`);

  expect(mains).toHaveLength(1);
  const texts = await readTexts(page);
  expect(texts).toHaveLength(1);
  expect(texts[0].text).toBe(TEXT);
  expect(Math.abs(texts[0].x - expected.x)).toBeLessThan(2);
  expect(Math.abs(texts[0].y - expected.y)).toBeLessThan(2);

  await focusCanvas(page);
  await page.keyboard.press("ControlOrMeta+KeyZ");
  await expect.poll(() => readTexts(page)).toEqual([]);
  expect(errors).toEqual([]);
});

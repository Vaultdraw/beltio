import { expect, type Page } from "@playwright/test";

import { canvasBox, openDrawing, openVault } from "../helpers";
import { AFTER_AUTOSAVE_MS } from "../constants";

import { journey } from "./journey";

// Journey: a new drawing from nothing. Write text, add shapes, paste a web picture, undo all of it,
// redo all of it, reload: everything is still there. (Writing in Markdown mode joins when that
// feature has merged.) Excalidraw and Obsidian Canvas both keep every step undoable and the file
// as the user left it.

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#f00"/></svg>`;
const PIC = "https://images.example.org/static/journey?purpose=inline";

const live = (page: Page) =>
  page.evaluate(() => {
    const api = (window as any).__editorApis()[0];
    return api
      ? (api.getSceneElements() as any[])
          .filter((e) => !e.isDeleted)
          .map((e) => e.type as string)
          .sort()
      : [];
  });

const saved = (page: Page) =>
  page.evaluate(async () => {
    const repo = (window as any).__vaultRepo;
    const file = await repo.readDrawing(repo.handle, "Journey.excalidraw");
    return (JSON.parse(file.json).elements as any[])
      .filter((e) => !e.isDeleted)
      .map((e) => e.type as string)
      .sort();
  });

const drag = async (
  page: Page,
  key: string,
  dx: number,
  dy: number,
  y: number,
) => {
  const box = await canvasBox(page);
  const x0 = box.x + 260;
  const y0 = box.y + y;
  await page.keyboard.press(key);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + dx, y0 + dy, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
};

const ALL = ["ellipse", "image", "rectangle", "text"];

journey({
  title: "new-drawing-journey",
  setup: async (page) => {
    await openVault(page, "?plugins=markdown-import");
    await page.waitForFunction(() => (window as any).__pluginsReady === true);
    await page.evaluate(
      ([svg, pic]) => {
        (window as any).__plugins.backend.network.images = {
          [pic]: new TextEncoder().encode(svg),
        };
      },
      [SVG, PIC] as const,
    );
  },
  steps: [
    {
      name: "New drawing button: name it and the empty page opens",
      run: async (page) => {
        await page
          .getByLabel("Vault file navigator")
          .getByRole("button", { name: "New drawing" })
          .first()
          .click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Name").fill("Journey");
        await dialog.getByRole("button", { name: "Create" }).click();
        await expect(dialog).toHaveCount(0);
        await expect(
          page.locator(".vault-editor canvas.interactive"),
        ).toBeVisible();
        await expect(page.locator(".vault-breadcrumbs")).toContainText(
          "Journey",
        );
        expect(await live(page)).toEqual([]);
      },
    },
    {
      name: "write a line of text",
      run: async (page) => {
        const box = await canvasBox(page);
        await page.mouse.dblclick(box.x + 260, box.y + 120);
        await expect(page.locator("textarea.excalidraw-wysiwyg")).toBeFocused();
        await page.keyboard.type("Hello from the journey", { delay: 5 });
        await page.keyboard.press("Escape");
        expect(await live(page)).toEqual(["text"]);
      },
    },
    {
      name: "draw a rectangle and an ellipse",
      run: async (page) => {
        await drag(page, "r", 150, 90, 220);
        await drag(page, "o", 150, 90, 380);
        expect(await live(page)).toEqual(["ellipse", "rectangle", "text"]);
      },
    },
    {
      name: "paste a picture address from the web: the picture lands on the page",
      run: async (page) => {
        const box = await canvasBox(page);
        await page.mouse.click(box.x + 700, box.y + 200);
        await page.evaluate((pic) => {
          const dt = new DataTransfer();
          dt.setData("text/plain", pic);
          document.dispatchEvent(
            new ClipboardEvent("paste", {
              clipboardData: dt,
              bubbles: true,
              cancelable: true,
            }),
          );
        }, PIC);
        await expect.poll(() => live(page), { timeout: 15_000 }).toEqual(ALL);
      },
    },
    {
      name: "wait for the autosave: the file holds all four",
      run: async (page) => {
        await expect
          .poll(async () => {
            await page.waitForTimeout(AFTER_AUTOSAVE_MS);
            return saved(page);
          })
          .toEqual(ALL);
      },
    },
    {
      name: "undo everything: the page is empty again",
      keyboard: true,
      run: async (page) => {
        for (let i = 0; i < 12 && (await live(page)).length; i++) {
          await page.keyboard.press("Meta+KeyZ");
          await page.waitForTimeout(60);
        }
        expect(await live(page)).toEqual([]);
      },
    },
    {
      name: "redo everything: all four are back, the picture too",
      keyboard: true,
      run: async (page) => {
        for (let i = 0; i < 12 && (await live(page)).length < 4; i++) {
          await page.keyboard.press("Meta+Shift+KeyZ");
          await page.waitForTimeout(60);
        }
        expect(await live(page)).toEqual(ALL);
        // The picture has its bytes again, not an empty box.
        const missing = await page.evaluate(() => {
          const api = (window as any).__editorApis()[0];
          const files = api.getFiles();
          return (api.getSceneElements() as any[])
            .filter((e) => e.type === "image" && !e.isDeleted)
            .filter((e) => !files[e.fileId]?.dataURL).length;
        });
        expect(missing, "pictures without their file after redo").toBe(0);
      },
    },
    {
      name: "leave for another drawing and come back: all four are still there",
      run: async (page) => {
        // The test vault lives in memory and does not survive a page reload; leaving and coming
        // back loads the saved file again, which is what a reload does for the user.
        await page.waitForTimeout(AFTER_AUTOSAVE_MS);
        await expect.poll(() => saved(page)).toEqual(ALL);
        await page
          .locator(".vault-tree-item__name", { hasText: /^DSA$/ })
          .first()
          .click();
        await openDrawing(page, "Graphs");
        await openDrawing(page, "Journey");
        await expect.poll(() => live(page)).toEqual(ALL);
      },
    },
  ],
});

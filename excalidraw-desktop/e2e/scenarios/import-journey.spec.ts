import { expect, type Page } from "@playwright/test";

import { clickMainMenuItem, openVault, readScene } from "../helpers";
import { openPanelByShortcut, panel, rows } from "../historyHelpers";
import { live, near, pixelAtScene, seedAndOpen } from "../pageHelpers";

import { journey } from "./journey";

// Journey: bring an Obsidian vault in, open the notes, see the picture, switch the theme and see
// the headings recolour, import again, then bring the earlier version back from History.
// Obsidian is the answer key: notes keep their links, pictures show, headings follow the theme.

const PIC = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#ff0000"/></svg>`;
const PIC_URL = `data:image/svg+xml;base64,${Buffer.from(PIC).toString(
  "base64",
)}`;
const SKETCH = JSON.stringify({
  type: "excalidraw",
  version: 2,
  elements: [
    {
      id: "img1",
      type: "image",
      x: 0,
      y: 0,
      width: 120,
      height: 120,
      angle: 0,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 1,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
      status: "saved",
      fileId: "f1",
      scale: [1, 1],
    },
  ],
  appState: {},
  files: {
    f1: { id: "f1", mimeType: "image/svg+xml", dataURL: PIC_URL, created: 1 },
  },
});

const SOURCE = {
  name: "Obsidian Notes",
  files: {
    "Home.md":
      "# Home\n\nWelcome to my notes.\n\n## Today\n\nSee [[Projects/Plan]] and [[Plan|the plan]] and [[Sketch]].\n\n### Later\n\nBack to the start.\n",
    "Projects/Plan.md": "# Plan\n\nBack to [[Home]].\n",
    "Drawings/Sketch.excalidraw.md": `## Drawing\n\`\`\`json\n${SKETCH}\n\`\`\`\n`,
    "attachments/pic.svg": PIC,
    ".obsidian/app.json": "{}",
  } as Record<string, string>,
};

const row = (page: Page, path: string) =>
  page.locator(
    `.vault-tree-container .vault-tree-item[data-tree-path="${path}"]`,
  );

const texts = async (page: Page, path: string) =>
  (await readScene(page, path)).elements
    .filter((e: any) => e.type === "text" && !e.isDeleted)
    .map((e: any) => e.text as string);

const token = (page: Page, name: string) =>
  page.evaluate(
    (n) =>
      getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  );

const setMode = async (page: Page, mode: "Light" | "Dark") => {
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Appearance", exact: true }).click();
  await dialog
    .getByRole("group", { name: "Mode" })
    .getByRole("button", { name: mode })
    .click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
};

journey({
  title: "import-journey",
  known: [
    {
      match: /picture colours change/,
      bug: "toimprove TN-2: pictures are inverted and washed out in the dark theme",
      theme: "dark",
    },
  ],
  setup: async (page) => {
    await openVault(page, "?plugins=markdown-import");
    await page.waitForFunction(() => (window as any).__pluginsReady === true);
    // The import entry is in the editor's main menu, so a drawing is open first.
    await seedAndOpen(page, "Start.excalidraw");
    await page.evaluate((src) => {
      (window as any).__plugins.backend.folders.sourcePick = src;
    }, SOURCE);
  },
  steps: [
    {
      name: "Import Obsidian vault from the main menu: a folder of notes appears",
      run: async (page) => {
        await clickMainMenuItem(page, "Import Obsidian vault…");
        await expect(row(page, "Obsidian Notes")).toBeVisible({
          timeout: 30_000,
        });
        await expect(row(page, "Obsidian Notes/Home.excalidraw")).toBeVisible({
          timeout: 30_000,
        });
        for (const sub of ["Projects", "Drawings"]) {
          await row(page, `Obsidian Notes/${sub}`)
            .locator(".vault-tree-item__toggle")
            .click();
        }
        await expect(
          row(page, "Obsidian Notes/Projects/Plan.excalidraw"),
        ).toBeVisible();
      },
    },
    {
      name: "open Home: the text and its links are on the page",
      run: async (page) => {
        await row(page, "Obsidian Notes/Home.excalidraw").click();
        await expect
          .poll(() => texts(page, "Obsidian Notes/Home.excalidraw"), {
            timeout: 20_000,
          })
          .toEqual(
            expect.arrayContaining([expect.stringContaining("Welcome")]),
          );
        const t = (await texts(page, "Obsidian Notes/Home.excalidraw")).join(
          "\n",
        );
        expect(t).toContain("[[Projects/Plan]]");
        expect(t).toContain("[[Drawings/Sketch|Sketch]]");
        await expect(
          page.locator(".vault-editor canvas.interactive"),
        ).toBeVisible();
      },
    },
    {
      name: "open the drawing with the picture: the picture shows its own colours (red)",
      run: async (page, ctx) => {
        await row(page, "Obsidian Notes/Drawings/Sketch.excalidraw").click();
        const centre = async () => {
          const img = (await live(page)).elements.find(
            (e) => e.type === "image",
          );
          return img
            ? pixelAtScene(page, img.x + img.width / 2, img.y + img.height / 2)
            : null;
        };
        await expect.poll(centre, { timeout: 20_000 }).not.toBeNull();
        // Obsidian shows a picture as it is, in light and dark.
        const c = (await centre()) ?? [0, 0, 0];
        if (!near(c, [255, 0, 0], 40)) {
          ctx.report(
            `a red picture shows as rgb(${c.join(",")}) in the ${
              ctx.theme
            } theme: picture colours change`,
          );
        }
      },
    },
    {
      name: "open Home again, switch the theme: headings and links recolour",
      run: async (page, ctx) => {
        await row(page, "Obsidian Notes/Home.excalidraw").click();
        await expect
          .poll(() => texts(page, "Obsidian Notes/Home.excalidraw"))
          .toEqual(
            expect.arrayContaining([expect.stringContaining("Welcome")]),
          );
        const first = ctx.theme === "light" ? "Dark" : "Light";
        const second = ctx.theme === "light" ? "Light" : "Dark";
        const seen: Record<string, string> = {};
        const seenLink: Record<string, string> = {};
        for (const mode of [first, second] as const) {
          await setMode(page, mode);
          seen[mode] = await token(page, "--vault-md-h1");
          seenLink[mode] = await token(page, "--vault-md-link");
          expect(seen[mode]).toMatch(/^#[0-9a-f]{6}$/i);
        }
        expect(
          seen.Light,
          "heading colour differs between Light and Dark",
        ).not.toBe(seen.Dark);
        expect(
          seenLink.Light,
          "link colour differs between Light and Dark",
        ).not.toBe(seenLink.Dark);
        const scene = await readScene(page, "Obsidian Notes/Home.excalidraw");
        expect(
          scene.elements.some(
            (e: any) =>
              e.type === "text" &&
              e.customData?.["plugins.markdown-import"]?.heading === 1,
          ),
        ).toBe(true);
        await expect(
          page.locator(".vault-editor canvas.interactive"),
        ).toBeVisible();
      },
    },
    {
      name: "re-import Home from its Markdown: a notice says so",
      run: async (page) => {
        await row(page, "Obsidian Notes/Home.excalidraw").click({
          button: "right",
        });
        await page
          .getByRole("menuitem", { name: "Re-import from its Markdown" })
          .click();
        await expect(page.getByText(/Re-imported 1 note/)).toBeVisible({
          timeout: 30_000,
        });
        expect(
          (await texts(page, "Obsidian Notes/Home.excalidraw")).join("\n"),
        ).toContain("Welcome");
      },
      check: { notices: undefined },
    },
    {
      name: "History keeps Home as it was before the re-import; Restore brings it back",
      keyboard: true,
      run: async (page) => {
        await openPanelByShortcut(page);
        await expect(rows(page).first()).toBeVisible();
        const before = rows(page).filter({ hasText: /before|Re-import/i });
        await expect(before.first()).toBeVisible();
        await before.first().click();
        await page.getByTestId("history-restore").click();
        const dialog = page.getByRole("dialog", { name: /^Restore / });
        await dialog
          .getByRole("button", { name: "Replace current drawing" })
          .click();
        await expect(dialog).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(panel(page)).toHaveCount(0);
      },
    },
  ],
});

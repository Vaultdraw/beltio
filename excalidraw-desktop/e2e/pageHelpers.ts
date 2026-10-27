import { expect, type Page } from "@playwright/test";

import { canvasBox, openDrawing } from "./helpers";

// Shared by the page mode specs (pageMode, pdfExport, pageModePerf).

export const PAGE_SHOTS = "../.cache/page-mode-shots";

export type Setup = {
  enabled: boolean;
  layout: "continuous" | "separate";
  size: string;
  orientation: "portrait" | "landscape";
  width: number;
  height: number;
  pageCount: number;
  paperTheme: "normal" | "oldSchool" | "match";
};

export const A4 = { width: 794, height: 1123 };

export const setupOf = (over: Partial<Setup> = {}): Setup => ({
  enabled: true,
  layout: "separate",
  size: "a4",
  orientation: "portrait",
  ...A4,
  pageCount: 1,
  paperTheme: "normal",
  ...over,
});

export const rect = (
  id: string,
  x: number,
  y: number,
  width = 120,
  height = 80,
) => ({
  id,
  type: "rectangle",
  x,
  y,
  width,
  height,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  boundElements: [],
  link: null,
  locked: false,
  isDeleted: false,
});

export type SeedOptions = {
  pageSetup?: Setup | null;
  elements?: unknown[];
  appState?: Record<string, unknown>;
};

/** Adds a drawing to the in-memory vault (the navigator rescans). */
export const seed = async (page: Page, name: string, o: SeedOptions = {}) => {
  await page.evaluate(
    ([n, opts]) => {
      const repo = (window as any).__vaultRepo;
      const o = opts as any;
      repo.seedDrawing(
        n,
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          elements: o.elements ?? [],
          appState: {
            viewBackgroundColor: "#ffffff",
            ...(o.pageSetup ? { pageSetup: o.pageSetup } : {}),
            ...(o.appState ?? {}),
          },
          files: {},
        }),
      );
      repo.emit({ handle: repo.handle, paths: [], rescan: true });
    },
    [name, o] as const,
  );
  await expect(
    page.locator(".vault-tree-item__name", {
      hasText: name.replace(/\.excalidraw$/, ""),
    }),
  ).toBeVisible();
};

export const seedAndOpen = async (
  page: Page,
  name: string,
  o: SeedOptions = {},
) => {
  await seed(page, name, o);
  await openDrawing(page, name.replace(/\.excalidraw$/, ""));
  await page.waitForTimeout(400);
};

export type Live = {
  scrollX: number;
  scrollY: number;
  zoom: number;
  width: number;
  height: number;
  pageSetup: Setup | null;
  hasConstraints: boolean;
  elements: {
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
};

/** The editor's live appState and elements (found through React's fibers: the e2e bundle has no window.h). */
export const live = (page: Page): Promise<Live> =>
  page.evaluate(() => {
    const el = document.querySelector(".vault-editor canvas.interactive")!;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
    let fiber = (el as any)[key];
    while (fiber) {
      const s = fiber.stateNode;
      if (
        s &&
        s.state &&
        s.scene &&
        typeof s.state.scrollX === "number" &&
        "zoom" in s.state
      ) {
        const st = s.state;
        return {
          scrollX: st.scrollX,
          scrollY: st.scrollY,
          zoom: st.zoom.value,
          width: st.width,
          height: st.height,
          pageSetup: st.pageSetup ?? null,
          hasConstraints: !!st.scrollConstraints,
          elements: s.scene.getNonDeletedElements().map((e: any) => ({
            id: e.id,
            type: e.type,
            x: e.x,
            y: e.y,
            width: e.width,
            height: e.height,
          })),
        };
      }
      fiber = fiber.return;
    }
    throw new Error("editor instance not found");
  });

/** Scene point -> client (viewport) coordinates. */
export const toClient = async (page: Page, sx: number, sy: number) => {
  const [box, st] = await Promise.all([canvasBox(page), live(page)]);
  return {
    x: box.x + (sx + st.scrollX) * st.zoom,
    y: box.y + (sy + st.scrollY) * st.zoom,
  };
};

/** Client point -> scene point. */
export const toScene = async (page: Page, cx: number, cy: number) => {
  const [box, st] = await Promise.all([canvasBox(page), live(page)]);
  return {
    x: (cx - box.x) / st.zoom - st.scrollX,
    y: (cy - box.y) / st.zoom - st.scrollY,
  };
};

/** RGB of the static canvas at a client point. */
export const pixelAtClient = (page: Page, cx: number, cy: number) =>
  page.evaluate(
    ([x, y]) => {
      const c = document.querySelector<HTMLCanvasElement>(
        ".vault-editor canvas.static",
      )!;
      const r = c.getBoundingClientRect();
      const px = Math.round((x - r.left) * (c.width / r.width));
      const py = Math.round((y - r.top) * (c.height / r.height));
      const d = c.getContext("2d")!.getImageData(px, py, 1, 1).data;
      return [d[0], d[1], d[2]];
    },
    [cx, cy],
  );

export const pixelAtScene = async (page: Page, sx: number, sy: number) => {
  const c = await toClient(page, sx, sy);
  return pixelAtClient(page, c.x, c.y);
};

export const near = (a: number[], b: number[], tol = 3) =>
  a.every((v, i) => Math.abs(v - b[i]) <= tol);

export const hex = (h: string) => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });

/** Runs a palette command by its title (commands mode, first match must be it). */
export const runCommand = async (page: Page, title: string) => {
  await page.keyboard.press("Meta+Shift+KeyP");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type(title);
  await expect(palette(page).getByRole("option").first()).toContainText(title);
  await page.keyboard.press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await page.waitForTimeout(150);
};

/** Focuses the canvas without drawing (click far right, inside the surround). */
export const focusCanvas = async (page: Page) => {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width - 6, box.y + box.height - 6);
  await page.mouse.click(box.x + box.width - 6, box.y + box.height - 6);
};

export const pickTool = (page: Page, key: string) => page.keyboard.press(key);

/** Drags with the given tool between two client points. */
export const dragTool = async (
  page: Page,
  tool: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
) => {
  await page.keyboard.press(tool);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
};

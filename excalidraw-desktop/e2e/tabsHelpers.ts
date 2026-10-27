import { expect, type Locator, type Page } from "@playwright/test";

import { enterVault, trackErrors } from "./helpers";

export { trackErrors };

const base = {
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
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
  version: 1,
  versionNonce: 1,
  index: null,
  updated: 1,
};

type Shape = {
  id: string;
  type?: "rectangle" | "ellipse";
  x?: number;
  y?: number;
  w?: number;
  h?: number;
};

/** A scene of named shapes (ids are what the specs look for on the canvas). */
export const sceneJson = (shapes: Shape[], extra: object[] = [], files = {}) =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "e2e-tabs",
    elements: [
      ...shapes.map((s, i) => ({
        ...base,
        id: s.id,
        type: s.type ?? "rectangle",
        x: s.x ?? 150,
        y: s.y ?? 150,
        width: s.w ?? 160,
        height: s.h ?? 100,
        seed: 10 + i,
      })),
      ...extra,
    ],
    appState: { viewBackgroundColor: "#ffffff" },
    files,
  });

export const seedDrawings = (page: Page, drawings: Record<string, string>) =>
  page.evaluate((d) => {
    const repo = (window as any).__vaultRepo;
    for (const [path, json] of Object.entries(d)) {
      repo.seedDrawing(path, json);
    }
    // The e2e vault may already be open (auto-reopen): ask for a rescan.
    repo.emit({ handle: repo.handle, paths: [], rescan: true });
  }, drawings);

/** Opens the e2e page, seeds extra drawings before the vault is chosen, opens the vault. */
export const openSeededVault = async (
  page: Page,
  drawings: Record<string, string> = {},
  query = "",
) => {
  await page.goto(`/e2e.html${query}`);
  await enterVault(page, () => seedDrawings(page, drawings));
  await seedDrawings(page, drawings);
};

export const treeName = (page: Page, name: string): Locator =>
  page
    .locator(".vault-tree-item__name")
    .filter({ hasText: new RegExp(`^${name}$`) })
    .first();

export const clickTree = (
  page: Page,
  name: string,
  modifiers: Array<"Meta" | "Shift"> = [],
) => treeName(page, name).click({ modifiers });

export const strip = (page: Page) => page.getByTestId("vault-tabs");
export const tabEls = (page: Page) => page.getByTestId("vault-tab");

export type TabInfo = { name: string; path: string; active: boolean };

/** What the strip shows now. */
export const readTabs = (page: Page): Promise<TabInfo[]> =>
  page.getByTestId("vault-tab").evaluateAll((els) =>
    els.map((el) => ({
      name: (el.querySelector(".vault-tabs__name")?.textContent ?? "").trim(),
      path: (el as HTMLElement).dataset.path ?? "",
      active: el.getAttribute("aria-selected") === "true",
    })),
  );

export const tabNames = async (page: Page) =>
  (await readTabs(page)).map((t) => t.name);

export const activeTab = async (page: Page) =>
  (await readTabs(page)).find((t) => t.active)?.name ?? null;

export const tabByName = (page: Page, name: string): Locator =>
  page.getByTestId("vault-tab").filter({
    has: page.locator(".vault-tabs__name", {
      hasText: new RegExp(`^${name}$`),
    }),
  });

export const mounted = (page: Page) =>
  page.evaluate(() => (window as any).__editorApis().length as number);

/** Ids of the live (not deleted) elements of the shown editor. */
export const sceneIds = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const api = (window as any).__editorApis()[0];
    return api
      ? api
          .getSceneElements()
          .filter((e: any) => !e.isDeleted)
          .map((e: any) => e.id as string)
      : [];
  });

/** Ids of the shapes whose bounds intersect the visible viewport. */
export const onScreenIds = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const api = (window as any).__editorApis()[0];
    if (!api) {
      return [];
    }
    const s = api.getAppState();
    const left = -s.scrollX;
    const top = -s.scrollY;
    const right = left + s.width / s.zoom.value;
    const bottom = top + s.height / s.zoom.value;
    return api
      .getSceneElements()
      .filter(
        (e: any) =>
          !e.isDeleted &&
          e.x < right &&
          e.x + e.width > left &&
          e.y < bottom &&
          e.y + e.height > top,
      )
      .map((e: any) => e.id as string);
  });

export const zoomLabel = (page: Page) =>
  page.locator(".vault-editor .reset-zoom-button");

export const viewOf = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__editorApis()[0]?.getAppState();
    return s
      ? { scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom.value as number }
      : null;
  });

/** Waits until the shown editor holds exactly these shapes (a drawing is "painted"). */
export const expectShown = async (page: Page, ids: string[]) => {
  await expect.poll(() => sceneIds(page), { timeout: 8000 }).toEqual(ids);
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
};

export const drawRectangle = async (page: Page) => {
  const box = (await page
    .locator(".vault-editor canvas.interactive")
    .boundingBox())!;
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  const x0 = box.x + box.width * 0.55;
  const y0 = box.y + box.height * 0.6;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 60, y0 + 40, { steps: 5 });
  await page.mouse.move(x0 + 140, y0 + 90, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("1");
};

export const A = "Alpha";
export const B = "Beta";
export const SCENE_A = sceneJson([{ id: "a-rect", x: 150, y: 150 }]);
export const SCENE_B = sceneJson([
  { id: "b-ellipse", type: "ellipse", x: 300, y: 220 },
]);
export const PAIR = {
  [`${A}.excalidraw`]: SCENE_A,
  [`${B}.excalidraw`]: SCENE_B,
};

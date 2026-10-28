/**
 * Put a rendered formula on the canvas with `ctx.scene.batch`: one undo step each. The SVG is the
 * element's picture and the TeX is its `latex` data (the plugin's `data_key`), so the drawing opens
 * without the plugin and shows the last picture.
 */
import { parseFormulaData, toFormulaData } from "./types";

import type { PluginContext } from "@vaultdraw/api";

import type { FormulaData, RenderedFormula } from "./types";

type Scene = PluginContext["scene"];

const picture = (svg: string) => ({
  mime: "image/svg+xml" as const,
  bytes: new TextEncoder().encode(svg),
});

/** Adds the formula at the middle of the view and selects it; resolves to the element id. */
export async function insertFormula(
  scene: Scene,
  r: RenderedFormula,
): Promise<string> {
  const c = scene.viewportCenter();
  const { ids } = await scene.batch([
    {
      op: "add",
      element: {
        type: "image",
        x: c.x - r.width / 2,
        y: c.y - r.height / 2,
        width: r.width,
        height: r.height,
        image: picture(r.svg),
        data: toFormulaData(r) as never,
      },
    },
  ]);
  scene.scrollTo(ids[0]);
  return ids[0];
}

/** The one selected, unlocked formula image, or null. */
export function selectedFormula(
  scene: Scene,
): { id: string; data: FormulaData } | null {
  const ids = scene.selection();
  if (ids.length !== 1) {
    return null;
  }
  const [el] = scene.get(ids, { data: true });
  if (!el || el.type !== "image" || el.locked) {
    return null;
  }
  const data = parseFormulaData(el.data);
  return data ? { id: el.id, data } : null;
}

/**
 * Draws the edited formula on the same element (same centre and scale) in one undo step. The
 * picture changes in place (API 0.25.0), so the id, z-order, groups, arrows, angle, opacity and
 * link stay. Resolves to the element id.
 */
export async function replaceFormula(
  scene: Scene,
  id: string,
  old: FormulaData,
  r: RenderedFormula,
): Promise<string> {
  const [el] = scene.get([id]);
  if (!el) {
    throw new Error("The formula is gone");
  }
  const s = el.width / old.width;
  const width = r.width * s;
  const height = r.height * s;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  await scene.batch([
    {
      op: "update",
      id,
      props: {
        x: cx - width / 2,
        y: cy - height / 2,
        width,
        height,
        image: picture(r.svg),
        data: toFormulaData(r) as never,
      },
    },
  ]);
  scene.scrollTo(id);
  return id;
}

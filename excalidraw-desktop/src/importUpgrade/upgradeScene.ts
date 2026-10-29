/**
 * Notes imported before the import followed the vault (toimprove #102) kept the old look: a
 * white "normal" page in the dark theme and the hand-drawn Excalifont. This brings one such
 * drawing to the user's look. Pure: JSON in, JSON out, nothing else in the file changes.
 *
 * Only drawings the Markdown import made are touched (its `customData` mark on headings and
 * callouts), so a page or font the user chose in their own drawings stays as it is. Code text
 * (Cascadia) keeps its monospace font; only Excalifont text takes the user's drawing font.
 */
import type { ImportDrawingLook } from "../vault/newDrawingPaper";

/** The `customData` key the Markdown import writes on the headings and callouts it lays out. */
export const IMPORT_MARK = "plugins.markdown-import";
/** Excalifont: the old import's body font (the editor's hand-drawn default). */
export const OLD_IMPORT_FONT = 5;

export interface UpgradeTarget {
  look: ImportDrawingLook;
  /** The user's drawing font (`[editor] font_family`). */
  fontFamily: number;
}

export interface UpgradeResult {
  json: string;
  /** The page now follows the user's paper theme. */
  paper: boolean;
  /** Text elements that took the user's font. */
  fonts: number;
}

type El = Record<string, unknown> & { type?: string; customData?: unknown };
type Scene = { elements?: El[]; appState?: Record<string, unknown> };

const marked = (e: El): boolean =>
  typeof e.customData === "object" &&
  e.customData !== null &&
  IMPORT_MARK in (e.customData as object);

/** True when the scene was made by the Markdown import. */
export const isImportedScene = (scene: Scene): boolean =>
  (scene.elements ?? []).some(marked);

const pageSetupOf = (scene: Scene) =>
  scene.appState?.pageSetup as Record<string, unknown> | undefined;

const needsPaper = (scene: Scene, t: UpgradeTarget): boolean => {
  const setup = pageSetupOf(scene);
  return (
    !!setup && setup.paperTheme === "normal" && t.look.paperTheme !== "normal"
  );
};

const oldFontTexts = (scene: Scene, t: UpgradeTarget): El[] =>
  t.fontFamily === OLD_IMPORT_FONT
    ? []
    : (scene.elements ?? []).filter(
        (e) =>
          e.type === "text" &&
          e.isDeleted !== true &&
          e.fontFamily === OLD_IMPORT_FONT,
      );

/** Families of the import's `font` setting (plugins/official/markdown-import settings.ts). */
const IMPORT_FONTS: Record<string, number> = {
  document: 9, // Liberation Sans
  excalifont: 5,
  nunito: 6,
  "comic-shanns": 8,
  virgil: 1,
  helvetica: 2,
  cascadia: 3,
};

/**
 * The font imported notes should have: the import's own `font` setting when it names one,
 * otherwise ("default") the user's drawing font, as a new import would.
 */
export const importFontFamily = (
  setting: unknown,
  drawingFont: number,
): number =>
  (typeof setting === "string" && IMPORT_FONTS[setting]) || drawingFont;

/**
 * Web pictures the old import left as labelled boxes ("Web image ..." text inside a box that
 * links to an https address). "Download web images in this drawing" turns them into pictures.
 */
export const webPictureBoxes = (scene: Scene): number => {
  const els = (scene.elements ?? []).filter((e) => e.isDeleted !== true);
  const links = new Set(
    els
      .filter(
        (e) =>
          e.type === "text" &&
          typeof e.text === "string" &&
          e.text.startsWith("Web image") &&
          typeof e.link === "string",
      )
      .map((e) => e.link as string),
  );
  return els.filter(
    (e) =>
      e.type === "rectangle" &&
      typeof e.link === "string" &&
      /^https?:\/\//i.test(e.link) &&
      links.has(e.link),
  ).length;
};

/** True when an imported scene still has the old page or font. */
export const hasOldLook = (scene: Scene, t: UpgradeTarget): boolean =>
  isImportedScene(scene) &&
  (needsPaper(scene, t) || oldFontTexts(scene, t).length > 0);

/** The upgraded drawing, or null when it is not an import or already has the user's look. */
export function upgradeScene(
  json: string,
  t: UpgradeTarget,
): UpgradeResult | null {
  let scene: Scene;
  try {
    scene = JSON.parse(json) as Scene;
  } catch {
    return null;
  }
  if (!scene || !Array.isArray(scene.elements) || !hasOldLook(scene, t)) {
    return null;
  }
  const paper = needsPaper(scene, t);
  if (paper) {
    const appState = { ...scene.appState };
    appState.pageSetup = {
      ...pageSetupOf(scene),
      paperTheme: t.look.paperTheme,
    };
    appState.viewBackgroundColor = t.look.viewBackgroundColor;
    if (t.look.viewBackgroundPattern && !appState.viewBackgroundPattern) {
      appState.viewBackgroundPattern = t.look.viewBackgroundPattern;
    }
    scene.appState = appState;
  }
  const old = new Set(oldFontTexts(scene, t));
  if (old.size > 0) {
    scene.elements = scene.elements.map((e) =>
      old.has(e)
        ? {
            ...e,
            fontFamily: t.fontFamily,
            version: (typeof e.version === "number" ? e.version : 1) + 1,
          }
        : e,
    );
  }
  return { json: JSON.stringify(scene, null, 2), paper, fonts: old.size };
}

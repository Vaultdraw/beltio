/**
 * Notes imported before the import followed the vault (toimprove #102) kept the old look: a
 * white "normal" page in the dark theme and the hand-drawn Excalifont. This brings one such
 * drawing to the user's look. Pure: JSON in, JSON out, nothing else in the file changes.
 *
 * Only drawings the Markdown import made are touched (its `customData` mark on headings and
 * callouts), so a page or font the user chose in their own drawings stays as it is. Code text
 * (Cascadia) keeps its monospace font; only Excalifont text takes the user's drawing font.
 */
import {
  ROLE_COLORS,
  headingRoleOf,
} from "../../../sdk/api/shared/markdownRoles";

import { pageGeometryOf, reflowScene, overflows } from "./reflow";
import { editState, stampElements } from "./stamp";

import type { TextMeasure } from "./reflow";
import type { ImportDrawingLook } from "../vault/newDrawingPaper";

/** The `customData` key the Markdown import writes on the headings and callouts it lays out. */
export const IMPORT_MARK = "plugins.markdown-import";
/** Excalifont: the old import's body font (the editor's hand-drawn default). */
export const OLD_IMPORT_FONT = 5;

export interface UpgradeTarget {
  look: ImportDrawingLook;
  /** The user's drawing font (`[editor] font_family`). */
  fontFamily: number;
  /** Measures and wraps text (the editor's); without it clipped text is not detected or re-wrapped. */
  measure?: TextMeasure;
  /** `[plugin.markdown-import] heading_colors` (default on): headings in their theme colour. */
  headingColors?: boolean;
}

export interface UpgradeResult {
  json: string;
  /** The page now follows the user's paper theme. */
  paper: boolean;
  /** Text elements that took the user's font. */
  fonts: number;
  /** Clipped texts re-wrapped to their width. */
  rewrapped: number;
  /** Headings that took their role (theme colour), or lost it with heading colours off. */
  headings: number;
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

export { webPictureBoxes } from "./placeholders";

const TEXT_COLOR = "#1e1e1e";
/** Colours the import itself gives a heading: a colour the user picked is never replaced. */
const IMPORT_HEADING_COLORS = new Set<unknown>([
  TEXT_COLOR,
  ROLE_COLORS.h1,
  ROLE_COLORS.h2,
  ROLE_COLORS.h3,
  ROLE_COLORS.h4,
  ROLE_COLORS.h5,
  ROLE_COLORS.h6,
]);

const withoutRole = (data: object): object => {
  const { role: _role, ...rest } = data as Record<string, unknown>;
  return rest;
};

type ImportData = { heading?: unknown; role?: unknown };
const importData = (e: El): ImportData | null =>
  marked(e)
    ? (e.customData as Record<string, ImportData>)[IMPORT_MARK] ?? null
    : null;

const headingLevel = (e: El): number | null => {
  if (e.type !== "text" || e.isDeleted === true) {
    return null;
  }
  const level = importData(e)?.heading;
  return typeof level === "number" && level >= 1 && level <= 6 ? level : null;
};

/** The colour and role a heading gets with the settings now. */
const headingLook = (level: number, t: UpgradeTarget) =>
  t.headingColors === false
    ? { color: TEXT_COLOR, role: undefined }
    : { color: ROLE_COLORS[headingRoleOf(level)], role: headingRoleOf(level) };

/** Imported headings whose colour or role is not the one the settings give them now. */
const headingsToStyle = (scene: Scene, t: UpgradeTarget): El[] =>
  (scene.elements ?? []).filter((e) => {
    const level = headingLevel(e);
    if (level === null || !IMPORT_HEADING_COLORS.has(e.strokeColor)) {
      return false;
    }
    const want = headingLook(level, t);
    const topRole = (e.customData as { role?: unknown } | undefined)?.role;
    return (
      e.strokeColor !== want.color ||
      importData(e)?.role !== want.role ||
      topRole !== want.role
    );
  });

const clippedTexts = (scene: Scene, t: UpgradeTarget): boolean =>
  !!t.measure &&
  (scene.elements ?? []).some(
    (e) =>
      e.type === "text" &&
      e.isDeleted !== true &&
      !e.containerId &&
      overflows(e, t.measure!),
  );

/** True when an imported scene still has the old look (page, font or clipped text). */
export const hasOldLook = (
  scene: Scene,
  t: UpgradeTarget,
  /** Known to be an import some other way (recognise.ts), or the user said "anyway". */
  imported = isImportedScene(scene),
): boolean =>
  imported &&
  (needsPaper(scene, t) ||
    oldFontTexts(scene, t).length > 0 ||
    headingsToStyle(scene, t).length > 0 ||
    clippedTexts(scene, t));

/** The upgraded drawing, or null when it is not an import or already has the user's look. */
export function upgradeScene(
  json: string,
  t: UpgradeTarget,
  imported?: boolean,
): UpgradeResult | null {
  let scene: Scene;
  try {
    scene = JSON.parse(json) as Scene;
  } catch {
    return null;
  }
  if (
    !scene ||
    !Array.isArray(scene.elements) ||
    !hasOldLook(scene, t, imported ?? isImportedScene(scene))
  ) {
    return null;
  }
  // An untouched import stays "untouched" after the app's own update (A-2): re-stamped below.
  const wasUntouched = editState(scene) === "untouched";
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
  const oldFamilies = new Map<string, number>();
  for (const e of old) {
    oldFamilies.set(String(e.id), OLD_IMPORT_FONT);
  }
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
  const restyle = new Set(headingsToStyle(scene, t));
  if (restyle.size > 0) {
    scene.elements = scene.elements.map((e) => {
      if (!restyle.has(e)) {
        return e;
      }
      const look = headingLook(headingLevel(e)!, t);
      const { role: _old, ...rest } = importData(e) ?? {};
      return {
        ...e,
        strokeColor: look.color,
        customData: {
          ...withoutRole(e.customData as object),
          ...(look.role ? { role: look.role } : {}),
          [IMPORT_MARK]: look.role ? { ...rest, role: look.role } : rest,
        },
        version: (typeof e.version === "number" ? e.version : 1) + 1,
      };
    });
  }
  let rewrapped = 0;
  if (t.measure) {
    const flow = reflowScene(
      scene.elements,
      pageGeometryOf(pageSetupOf(scene)),
      t.measure,
      oldFamilies,
    );
    if (flow) {
      scene.elements = flow.elements as El[];
      rewrapped = flow.rewrapped;
      const setup = pageSetupOf(scene);
      if (setup && Number(setup.pageCount) < flow.pageCount) {
        scene.appState = {
          ...scene.appState,
          pageSetup: { ...setup, pageCount: flow.pageCount },
        };
      }
    }
  }
  if (wasUntouched) {
    stampElements(scene.elements);
  }
  return {
    json: JSON.stringify(scene, null, 2),
    paper,
    fonts: old.size,
    rewrapped,
    headings: restyle.size,
  };
}

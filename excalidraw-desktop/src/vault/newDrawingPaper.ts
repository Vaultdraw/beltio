/**
 * The paper a new drawing starts on: canvas colour, background pattern and
 * page setup, from the `[appearance]`, `[paper]` and `[page]` preferences.
 *
 * The one TypeScript implementation (VaultApp uses it). The CLI creates
 * drawings with the app closed through the Rust twin `new_drawing.rs` in
 * vaultdraw-core; `newDrawingPaper.test.ts` and a cargo test both check the
 * golden file `vaultdraw-core/tests/fixtures/new-drawing-parity.json`, so a
 * change to either side fails a test until both agree.
 */
import type { BackgroundPattern } from "@excalidraw/excalidraw/data/backgroundPattern";

import {
  PAPER_THEME_COLORS,
  type PageSetup,
  type PaperTheme,
} from "@excalidraw/excalidraw/data/pageSetup";

import { getPageSetupPatch } from "../page/pageSetupChange";

import { pageSetupFromPagePrefs } from "./pageDefaults";
import { patternForNewDrawing } from "./paperDefaults";
import { getPreferences } from "./preferences";
import { getVaultSettingsSnapshot, resolveSetting } from "./vaultSettings";

import type { PagePrefs } from "./pageDefaults";
import type { PaperPrefs } from "./paperDefaults";
import type { VaultPreferences } from "./preferences";

export type NewDrawingPaper = {
  viewBackgroundColor: string;
  viewBackgroundPattern: BackgroundPattern | null;
  pageSetup: PageSetup | null;
};

/**
 * `prefs`: the effective preferences; `paperStyle`: the paper style after the
 * open vault's override; `themeBackground`: the canvas colour when no default
 * canvas background is set.
 */
export function newDrawingPaper(
  prefs: PaperPrefs &
    PagePrefs &
    Pick<VaultPreferences, "defaultCanvasBackground">,
  paperStyle: PaperPrefs["paperStyle"],
  themeBackground: string,
): NewDrawingPaper {
  const paper: NewDrawingPaper = {
    viewBackgroundColor: prefs.defaultCanvasBackground || themeBackground,
    viewBackgroundPattern: patternForNewDrawing(prefs, paperStyle),
    pageSetup: null,
  };
  const setup = pageSetupFromPagePrefs(prefs);
  // Page mode default: the paper theme stamps the page colours
  return setup.enabled
    ? { ...paper, ...getPageSetupPatch(paper, setup) }
    : paper;
}

/** The paper for a drawing created now: live preferences and the open vault's override. */
export const getNewDrawingPaper = (
  win: Window | null | undefined,
  themeBackground: string,
): NewDrawingPaper => {
  const prefs = getPreferences(win);
  return newDrawingPaper(
    prefs,
    resolveSetting("paperStyle", getVaultSettingsSnapshot().overrides, prefs),
    themeBackground,
  );
};

/**
 * How an imported drawing looks: the paper and tool defaults a new drawing
 * gets, so a note imported in the dark theme is not a white page in a
 * hand-drawn font. Imports are always page-mode drawings: they take the
 * paper theme of the default page setup when that is "Page" mode, and
 * "Match current theme" (the page follows the app theme on screen) when the
 * default is Normal. The file keeps the paper theme's own colours (the page
 * fill and pattern colour), like a drawing made in the app.
 */
export type ImportDrawingLook = {
  paperTheme: PaperTheme;
  viewBackgroundColor: string;
  viewBackgroundPattern: BackgroundPattern | null;
};

export function importDrawingLook(
  prefs: PaperPrefs &
    PagePrefs &
    Pick<VaultPreferences, "defaultCanvasBackground">,
  paperStyle: PaperPrefs["paperStyle"],
): ImportDrawingLook {
  const paper = newDrawingPaper(prefs, paperStyle, "#ffffff");
  const paperTheme = paper.pageSetup?.paperTheme ?? "match";
  const colors = PAPER_THEME_COLORS[paperTheme];
  const pattern = paper.viewBackgroundPattern;
  return {
    paperTheme,
    viewBackgroundColor: colors.background,
    viewBackgroundPattern: pattern
      ? { ...pattern, color: colors.patternColor }
      : null,
  };
}

/** The look of a drawing imported now: live preferences and the open vault's paper override. */
export const getImportDrawingLook = (
  win: Window | null | undefined,
): ImportDrawingLook => {
  const prefs = getPreferences(win);
  return importDrawingLook(
    prefs,
    resolveSetting("paperStyle", getVaultSettingsSnapshot().overrides, prefs),
  );
};

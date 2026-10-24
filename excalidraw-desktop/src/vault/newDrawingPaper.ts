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

import type { PageSetup } from "@excalidraw/excalidraw/data/pageSetup";

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

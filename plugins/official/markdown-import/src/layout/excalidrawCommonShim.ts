/**
 * A stand-in for `@excalidraw/common` with only what the editor's
 * `textWrapping.ts` and `textMeasurements.ts` import. The plugin bundles the
 * editor's own `wrapText` (packages/element/src/textWrapping.ts) so line
 * breaks match the editor exactly; the real `@excalidraw/common` index would
 * pull tinycolor, promise pools and modules that touch `document` at load
 * (33 KB minified, and a crash inside a worker). esbuild maps
 * `@excalidraw/common` to this file for the plugin and worker bundles (see
 * src/worker/esbuild.mjs); vitest keeps the real package.
 */
/* eslint-disable no-restricted-imports, import/no-restricted-paths -- the editor's own wrapText is bundled by esbuild so line breaks match the editor exactly (PHASE4-PLAN, E1); the shim keeps the rest of the editor out of the bundle. */
import type { FontString } from "../../../../../packages/element/src/types";

export const isTestEnv = () => false;
export const isDevEnv = () => false;

// Same values as packages/common/src/constants.ts.
export const BOUND_TEXT_PADDING = 5;
export const DEFAULT_FONT_SIZE = 20;
export const DEFAULT_FONT_FAMILY = 5;

export const getFontString = ({
  fontSize,
  fontFamily,
}: {
  fontSize: number;
  fontFamily: number;
}) => `${fontSize}px ${fontFamily}` as FontString;

export const normalizeEOL = (str: string) => str.replace(/\r?\n|\r/g, "\n");

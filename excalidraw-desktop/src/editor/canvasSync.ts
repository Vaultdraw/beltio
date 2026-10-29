/**
 * "Sync canvas with theme": installs the theme engine's display colour
 * transform into the editor (setDisplayColorTransform) and asks mounted
 * editors to repaint. Display only: scene data and exports keep standard
 * colours (exports run inside `withStandardCanvasColors`).
 */

import {
  invertColorForDarkMode,
  setDisplayColorTransform,
  setDisplayTextRoleColor,
} from "@excalidraw/excalidraw";

import { buildCanvasColorTransform } from "../theme";
import { buildRoleColor } from "../markdown/roleColors";

import type { ThemeMode, ThemeVariant } from "../theme";

type Transform = (color: string, isDarkMode: boolean) => string;
type SyncSource = { variant: ThemeVariant; mode: ThemeMode; key: string };

// One entry: the global sync and the page "match" display share the same
// variant/mode key, hence the same transform (and display colour key).
let built: { key: string; transform: Transform } | null = null;
const transformFor = (source: SyncSource): Transform => {
  if (built?.key !== source.key) {
    built = {
      key: source.key,
      transform: buildCanvasColorTransform(
        source.variant,
        source.mode,
        // NOT applyDarkModeFilter: that delegates back to this transform.
        invertColorForDarkMode,
      ),
    };
  }
  return built.transform;
};

/** What the canvas shows now (ignoring suspension), null = standard colours. */
const effectiveDisplay = (): {
  transform: Transform;
  canvas: string | null;
} | null => {
  if (pageDisplay === "identity") {
    return { transform: identityTransform, canvas: null };
  }
  if (pageDisplay === "match" && themeSource) {
    return {
      transform: transformFor(themeSource),
      canvas: themeSource.variant.mSurface,
    };
  }
  return currentTransform
    ? { transform: currentTransform, canvas: currentCanvas }
    : null;
};

// Role colours (Markdown headings) follow the theme whether or not the canvas
// syncs with it, held to contrast on the canvas actually shown.
const STANDARD_CANVAS = "#ffffff";
let roleColorFor: {
  key: string;
  resolve: (role: string, isDark: boolean) => string | null;
} | null = null;
const roleResolver = (
  canvas: string | null,
): ((role: string, isDark: boolean) => string | null) | null => {
  if (!themeSource) {
    return null;
  }
  const key = `${themeSource.key}|${canvas ?? ""}`;
  if (roleColorFor?.key !== key) {
    const { variant } = themeSource;
    const light = buildRoleColor(variant, canvas ?? STANDARD_CANVAS);
    const dark = canvas
      ? light
      : buildRoleColor(variant, invertColorForDarkMode(STANDARD_CANVAS));
    roleColorFor = {
      key,
      resolve: (role, isDark) => (isDark ? dark : light)(role),
    };
  }
  return roleColorFor.resolve;
};

const applyRoleColors = () => {
  const display = effectiveDisplay();
  setDisplayTextRoleColor(
    roleResolver(
      pageDisplay === "identity" ? STANDARD_CANVAS : display?.canvas ?? null,
    ),
  );
};

const applyDisplay = () => {
  const display = effectiveDisplay();
  setDisplayColorTransform(display?.transform ?? null, display?.canvas ?? null);
  applyRoleColors();
};

let currentKey = "off";
let currentTransform: Transform | null = null;
// The theme surface: the canvas background shown on screen while sync is on.
let currentCanvas: string | null = null;
let suspended = 0;
// Page mode: the drawing's paper theme decides the display colours instead of
// the global sync toggle. "identity" = standard light colours (also in a dark
// UI); "match" = the theme transform + surface, whatever the toggle says.
export type PageDisplay = "identity" | "match";
let pageDisplay: PageDisplay | null = null;
let themeSource: SyncSource | null = null;
const identityTransform: Transform = (color) => color;
const repainters = new Set<() => void>();

const repaintAll = () => {
  for (const repaint of repainters) {
    try {
      repaint();
    } catch {
      // an unmounting editor must not break the others
    }
  }
};

/**
 * Turns canvas sync on (variant given) or off (null). `key` identifies the
 * variant + mode; calling again with the same key does nothing. Returns true
 * when the transform changed.
 */
export const setCanvasSync = (
  sync: { variant: ThemeVariant; mode: ThemeMode; key: string } | null,
): boolean => {
  const key = sync ? `on:${sync.key}` : "off";
  if (key === currentKey) {
    return false;
  }
  currentKey = key;
  currentTransform = sync ? transformFor(sync) : null;
  currentCanvas = sync ? sync.variant.mSurface : null;
  if (suspended === 0) {
    applyDisplay();
  }
  repaintAll();
  return true;
};

/**
 * The active theme's canvas palette, always (even with sync off): what a
 * page-mode "match current theme" paper is drawn through.
 */
export const setCanvasThemeSource = (source: SyncSource | null): void => {
  if (themeSource?.key === source?.key) {
    return;
  }
  themeSource = source;
  if (suspended === 0) {
    if (pageDisplay === "match") {
      applyDisplay();
    } else {
      applyRoleColors();
    }
  }
  repaintAll();
};

/** Page mode's display override (null = page mode off: today's behaviour). Returns true when it changed. */
export const setPageDisplay = (display: PageDisplay | null): boolean => {
  if (display === pageDisplay) {
    return false;
  }
  pageDisplay = display;
  if (suspended === 0) {
    applyDisplay();
  }
  repaintAll();
  return true;
};

export const isCanvasSyncActive = () => currentTransform !== null;

/** Editors register a repaint callback (invalidate caches + re-render). */
export const registerCanvasRepaint = (repaint: () => void) => {
  repainters.add(repaint);
  return () => {
    repainters.delete(repaint);
  };
};

/**
 * Shows standard (untransformed) colours until the returned release is
 * called. Nests (counter); the last release restores the theme transform and
 * repaints. The release is idempotent.
 */
export const suspendCanvasSync = (): (() => void) => {
  if (suspended++ === 0) {
    if (effectiveDisplay()) {
      setDisplayColorTransform(null);
    }
    setDisplayTextRoleColor(null);
  }
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    if (--suspended === 0) {
      applyDisplay();
      repaintAll();
    }
  };
};

/**
 * Runs `task` with the standard (untransformed) colours, e.g. PNG/SVG export,
 * then restores the theme transform and repaints.
 */
export const withStandardCanvasColors = async <T>(
  task: () => Promise<T>,
): Promise<T> => {
  if (!effectiveDisplay() && !themeSource && suspended === 0) {
    return task();
  }
  const release = suspendCanvasSync();
  try {
    return await task();
  } finally {
    release();
  }
};

/** Test helper: back to "off" with no registered editors. */
export const resetCanvasSync = () => {
  currentKey = "off";
  currentTransform = null;
  currentCanvas = null;
  suspended = 0;
  pageDisplay = null;
  themeSource = null;
  built = null;
  roleColorFor = null;
  repainters.clear();
  setDisplayColorTransform(null);
  setDisplayTextRoleColor(null);
};

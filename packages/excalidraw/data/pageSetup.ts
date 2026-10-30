/**
 * Page mode: simulated paper pages (continuous roll or separate sheets)
 * instead of the infinite canvas.
 *
 * Saved in the drawing's appState as `pageSetup` (null = normal infinite
 * canvas, as are files that predate page mode). This module is the shared
 * model: types, size presets, validation of untrusted input, paper themes
 * and the page geometry used by the editor (view lock, element clamping),
 * the renderer and the exporters. Pure: no DOM, no React.
 *
 * Units: 1 scene px = 1 CSS px at 96 dpi, so A4 portrait is 794 x 1123.
 * Pages run down the y axis from scene (0, 0): page i's top-left corner is
 * (0, i * pitch), where pitch = height (+ PAGE_GAP between separate sheets).
 */

export const PAGE_LAYOUTS = ["continuous", "separate"] as const;
export type PageLayout = typeof PAGE_LAYOUTS[number];

export const PAGE_ORIENTATIONS = ["portrait", "landscape"] as const;
export type PageOrientation = typeof PAGE_ORIENTATIONS[number];

export const PAPER_THEMES = ["normal", "oldSchool", "match"] as const;
export type PaperTheme = typeof PAPER_THEMES[number];

export interface PageSizePresetInfo {
  label: string;
  /** portrait size in scene px (96 dpi) */
  width: number;
  height: number;
  /** portrait size in PDF points (1/72 in), the exact paper size */
  widthPt: number;
  heightPt: number;
}

const mm = (w: number, h: number) => ({
  width: Math.round((w * 96) / 25.4),
  height: Math.round((h * 96) / 25.4),
  widthPt: Math.round((w * 72) / 25.4),
  heightPt: Math.round((h * 72) / 25.4),
});

/** Screen-shaped pages (tablets, phones): digital sizes, 1 px = 0.75 pt. */
const px = (width: number, height: number) => ({
  width,
  height,
  widthPt: Math.round(width * 0.75),
  heightPt: Math.round(height * 0.75),
});

const PRESETS = {
  a3: { label: "A3", ...mm(297, 420) },
  a4: { label: "A4", ...mm(210, 297) },
  a5: { label: "A5", ...mm(148, 210) },
  b5: { label: "B5", ...mm(176, 250) },
  letter: { label: "Letter", ...mm(215.9, 279.4) },
  legal: { label: "Legal", ...mm(215.9, 355.6) },
  tablet: { label: "Tablet (iPad 11-inch)", ...px(834, 1194) },
  tabletLarge: { label: "Tablet (iPad 13-inch)", ...px(1032, 1376) },
  phone: { label: "Phone", ...px(393, 852) },
};

export type PageSizePresetId = keyof typeof PRESETS;

export const PAGE_SIZE_PRESETS: Readonly<
  Record<PageSizePresetId, Readonly<PageSizePresetInfo>>
> = PRESETS;
export type PageSize = PageSizePresetId | "custom";

export const PAGE_SIZE_PRESET_IDS = Object.keys(
  PAGE_SIZE_PRESETS,
) as PageSizePresetId[];

export const PAGE_LIMITS = {
  /** custom page side, scene px */
  side: { min: 100, max: 5000 },
  pageCount: { min: 1, max: 500 },
} as const;

/** Space between separate pages, scene px. */
export const PAGE_GAP = 40;

/**
 * Auto-extend: a new page (or more length) is added once content reaches
 * into the last quarter of the last page.
 */
export const PAGE_EXTEND_FRACTION = 0.75;

export interface PageSetup {
  /** false = normal infinite canvas (the setup is kept for switching back) */
  enabled: boolean;
  layout: PageLayout;
  size: PageSize;
  orientation: PageOrientation;
  /**
   * Page size in scene px with the orientation applied. Always stored, so a
   * file reopens identically; for presets it is derived from `size`.
   */
  width: number;
  height: number;
  /** Pages in the drawing (continuous: page-size sections of the roll). */
  pageCount: number;
  paperTheme: PaperTheme;
}

export const DEFAULT_PAGE_SETUP: Readonly<PageSetup> = {
  enabled: true,
  layout: "separate",
  size: "a4",
  orientation: "portrait",
  width: PAGE_SIZE_PRESETS.a4.width,
  height: PAGE_SIZE_PRESETS.a4.height,
  pageCount: 1,
  paperTheme: "normal",
};

export interface PaperThemeColors {
  /** page fill, stamped into viewBackgroundColor */
  background: string;
  /** pattern colour stamped into the pattern; null = the style's automatic */
  patternColor: string | null;
}

/**
 * File colours of each paper theme. "match" stores Normal's colours; on
 * screen it is drawn through the theme's canvas colour transform (display
 * only, like "Sync canvas with theme").
 */
export const PAPER_THEME_COLORS: Readonly<
  Record<PaperTheme, PaperThemeColors>
> = {
  normal: { background: "#ffffff", patternColor: null },
  oldSchool: { background: "#f8efd4", patternColor: "#8fb1d9" },
  match: { background: "#ffffff", patternColor: null },
};

export const PAPER_THEME_LABELS: Readonly<Record<PaperTheme, string>> = {
  normal: "Normal",
  oldSchool: "Old school",
  match: "Match current theme",
};

// --- validation ------------------------------------------------------------

const includes = <T extends string>(list: readonly T[], v: unknown): v is T =>
  (list as readonly unknown[]).includes(v);

export const isPageLayout = (v: unknown): v is PageLayout =>
  includes(PAGE_LAYOUTS, v);
export const isPageOrientation = (v: unknown): v is PageOrientation =>
  includes(PAGE_ORIENTATIONS, v);
export const isPaperTheme = (v: unknown): v is PaperTheme =>
  includes(PAPER_THEMES, v);
export const isPageSize = (v: unknown): v is PageSize =>
  v === "custom" || includes(PAGE_SIZE_PRESET_IDS, v);

const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const clampTo = (value: number, { min, max }: { min: number; max: number }) =>
  Math.min(max, Math.max(min, value));

/** Portrait/landscape size of a preset in scene px. */
export const getPresetPageSize = (
  size: PageSizePresetId,
  orientation: PageOrientation,
): { width: number; height: number } => {
  const { width, height } = PAGE_SIZE_PRESETS[size];
  return orientation === "landscape"
    ? { width: height, height: width }
    : { width, height };
};

/**
 * Untrusted input (file, config, UI) -> a valid setup or null (normal
 * canvas). Bad fields fall back to the defaults; preset sizes are derived
 * from the preset and orientation; numbers are clamped and rounded.
 */
export const normalizePageSetup = (input: unknown): PageSetup | null => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const raw = input as Record<string, unknown>;
  const d = DEFAULT_PAGE_SETUP;
  const size = isPageSize(raw.size) ? raw.size : d.size;
  const orientation = isPageOrientation(raw.orientation)
    ? raw.orientation
    : d.orientation;
  const dims =
    size === "custom"
      ? {
          width: Math.round(
            clampTo(finite(raw.width, d.width), PAGE_LIMITS.side),
          ),
          height: Math.round(
            clampTo(finite(raw.height, d.height), PAGE_LIMITS.side),
          ),
        }
      : getPresetPageSize(size, orientation);
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : d.enabled,
    layout: isPageLayout(raw.layout) ? raw.layout : d.layout,
    size,
    orientation,
    ...dims,
    pageCount: Math.round(
      clampTo(finite(raw.pageCount, d.pageCount), PAGE_LIMITS.pageCount),
    ),
    paperTheme: isPaperTheme(raw.paperTheme) ? raw.paperTheme : d.paperTheme,
  };
};

/** A valid setup from `base` with `changes` applied (sizes re-derived). */
export const updatePageSetup = (
  base: PageSetup | null,
  changes: Partial<PageSetup>,
): PageSetup =>
  normalizePageSetup({ ...(base ?? DEFAULT_PAGE_SETUP), ...changes })!;

/** Page mode is on for this appState-like value. */
export const isPageModeOn = (
  setup: PageSetup | null | undefined,
): setup is PageSetup => !!setup?.enabled;

/** Stable key for change detection (save signature, caches). */
export const pageSetupKey = (setup: PageSetup | null | undefined): string =>
  setup
    ? `${+setup.enabled}${setup.layout}${setup.size}${setup.orientation}${
        setup.width
      }x${setup.height}#${setup.pageCount}${setup.paperTheme}`
    : "";

// --- geometry ----------------------------------------------------------------

export interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Gap between consecutive pages (0 in the continuous layout). */
export const getPageGap = (setup: PageSetup) =>
  setup.layout === "separate" ? PAGE_GAP : 0;

/** Distance from one page's top to the next one's. */
export const getPagePitch = (setup: PageSetup) =>
  setup.height + getPageGap(setup);

export const getPageRect = (setup: PageSetup, index: number): PageRect => ({
  x: 0,
  y: index * getPagePitch(setup),
  width: setup.width,
  height: setup.height,
});

/** Height of the whole page column (all pages and the gaps between). */
export const getPageAreaHeight = (setup: PageSetup) =>
  setup.pageCount * getPagePitch(setup) - getPageGap(setup);

/** [x1, y1, x2, y2] of the whole page column. */
export const getPageAreaBounds = (
  setup: PageSetup,
): [number, number, number, number] => [
  0,
  0,
  setup.width,
  getPageAreaHeight(setup),
];

/** Index of the page nearest to scene y (gaps split halfway), clamped. */
export const getPageIndexAt = (setup: PageSetup, y: number): number => {
  const gap = getPageGap(setup);
  const index = Math.floor((y + gap / 2) / getPagePitch(setup));
  return Math.min(setup.pageCount - 1, Math.max(0, index));
};

/** Index of the page containing the scene point, or -1 (outside/gap). */
export const getPageIndexContaining = (
  setup: PageSetup,
  x: number,
  y: number,
): number => {
  if (x < 0 || x > setup.width || y < 0) {
    return -1;
  }
  const pitch = getPagePitch(setup);
  const index = Math.floor(y / pitch);
  if (index >= setup.pageCount || y - index * pitch > setup.height) {
    return -1;
  }
  return index;
};

/** Pages intersecting the scene y range [y1, y2] (inclusive indices). */
export const getPageIndexRange = (
  setup: PageSetup,
  y1: number,
  y2: number,
): [number, number] | null => {
  const pitch = getPagePitch(setup);
  const first = Math.max(0, Math.floor(y1 / pitch));
  const last = Math.min(setup.pageCount - 1, Math.floor(y2 / pitch));
  return first > last ? null : [first, last];
};

/**
 * The widest a free text may grow to without leaving the page column: from
 * the edge its alignment pins (left: its left edge, right: its right edge,
 * centre: its centre) to the nearer side of the column. A text that already
 * starts past the edge keeps room for a few letters (the clamp moves it in
 * once, never per key).
 */
export const getPageTextMaxWidth = (
  setup: PageSetup,
  text: {
    x: number;
    width: number;
    fontSize: number;
    textAlign: string;
  },
): number => {
  const left = 0;
  const right = setup.width;
  let room: number;
  if (text.textAlign === "right") {
    room = text.x + text.width - left;
  } else if (text.textAlign === "center") {
    const centre = text.x + text.width / 2;
    room = 2 * Math.min(centre - left, right - centre);
  } else {
    room = right - text.x;
  }
  return Math.max(room, Math.min(right - left, text.fontSize * 6));
};

/** Clamps a scene point into page `index`. */
export const clampPointToPage = (
  setup: PageSetup,
  index: number,
  x: number,
  y: number,
): { x: number; y: number } => {
  const page = getPageRect(setup, index);
  return {
    x: Math.min(page.x + page.width, Math.max(page.x, x)),
    y: Math.min(page.y + page.height, Math.max(page.y, y)),
  };
};

const clampAxis = (start: number, end: number, min: number, max: number) => {
  if (end - start >= max - min || start < min) {
    // too big to fit: align to the start edge
    return min - start;
  }
  return end > max ? max - end : 0;
};

/**
 * Translation that moves the bounds [x1, y1, x2, y2] to where content may
 * be. Separate layout: fully inside one page (by default the page nearest
 * the bounds' centre, so content can hop to another sheet). Continuous
 * layout: inside the page column (page breaks are only where the PDF
 * splits, so content may straddle them). Bounds larger than the area are
 * aligned to its top-left corner. { dx: 0, dy: 0 } = already inside.
 */
export const getClampToPageOffset = (
  setup: PageSetup,
  [x1, y1, x2, y2]: readonly [number, number, number, number],
  index = getPageIndexAt(setup, (y1 + y2) / 2),
): { dx: number; dy: number; index: number } => {
  if (setup.layout === "continuous") {
    return {
      dx: clampAxis(x1, x2, 0, setup.width),
      dy: clampAxis(y1, y2, 0, getPageAreaHeight(setup)),
      index,
    };
  }
  const page = getPageRect(setup, index);
  return {
    dx: clampAxis(x1, x2, page.x, page.x + page.width),
    dy: clampAxis(y1, y2, page.y, page.y + page.height),
    index,
  };
};

/** True when the bounds lie where content may be (see getClampToPageOffset). */
export const isBoundsInsidePage = (
  setup: PageSetup,
  bounds: readonly [number, number, number, number],
) => {
  const { dx, dy } = getClampToPageOffset(setup, bounds);
  return dx === 0 && dy === 0;
};

/**
 * Pages needed so the lowest content (scene y `contentBottom`) leaves at
 * least a quarter page free below it; never fewer than `setup.pageCount`
 * (pages are only added automatically, never removed).
 */
export const getAutoExtendedPageCount = (
  setup: PageSetup,
  contentBottom: number,
): number => {
  if (!Number.isFinite(contentBottom) || contentBottom <= 0) {
    return setup.pageCount;
  }
  const pitch = getPagePitch(setup);
  const index = Math.floor(contentBottom / pitch);
  const intoPage = contentBottom - index * pitch;
  const needed =
    index + 1 + (intoPage > setup.height * PAGE_EXTEND_FRACTION ? 1 : 0);
  return Math.min(PAGE_LIMITS.pageCount.max, Math.max(setup.pageCount, needed));
};

/** Zoom at which the page width fills `viewportWidth` minus side margins. */
export const getFitPageWidthZoom = (
  setup: PageSetup,
  viewportWidth: number,
  sideMargin: number,
) => Math.max(0.01, (viewportWidth - 2 * sideMargin) / setup.width);

/** PDF page size in points for this setup (exact for paper presets). */
export const getPageSizeInPoints = (
  setup: PageSetup,
): { width: number; height: number } => {
  if (setup.size === "custom") {
    return { width: setup.width * 0.75, height: setup.height * 0.75 };
  }
  const { widthPt, heightPt } = PAGE_SIZE_PRESETS[setup.size];
  return setup.orientation === "landscape"
    ? { width: heightPt, height: widthPt }
    : { width: widthPt, height: heightPt };
};

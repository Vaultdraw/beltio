/**
 * Markdown typing settings: preference fields, config.toml keys
 * (`[markdown]`), validation and defaults. Pure data; preferences.ts and
 * settingsSync.ts spread `MARKDOWN_DEFAULTS`, `normalizeMarkdownPreferences`
 * and `MARKDOWN_MAPPINGS` in.
 */
import { DEFAULT_BLOCK_GAP, DEFAULT_HEADING_SCALES } from "./lineRules";

import type { ConfigMapping } from "../vault/settingsSync";
import type { MarkdownTypingSettings } from "./markdownTyping";

export const MARKDOWN_FIELDS = [
  "markdownTyping",
  "markdownH1Size",
  "markdownH2Size",
  "markdownH3Size",
  "markdownH4Size",
  "markdownH5Size",
  "markdownH6Size",
  "markdownBlockGap",
  "markdownHeadingBold",
] as const;
export type MarkdownField = typeof MARKDOWN_FIELDS[number];

export const HEADING_SIZE_LIMITS = { min: 0.5, max: 8 } as const;
export const BLOCK_GAP_LIMITS = { min: 0, max: 4 } as const;

export interface MarkdownPreferences {
  /** markdown.typing: Markdown mode on in new drawings. */
  markdownTyping: boolean;
  /** markdown.h1_size … h6_size: multiples of the text size. */
  markdownH1Size: number;
  markdownH2Size: number;
  markdownH3Size: number;
  markdownH4Size: number;
  markdownH5Size: number;
  markdownH6Size: number;
  /** markdown.block_gap: space above a new block, in lines. */
  markdownBlockGap: number;
  /** markdown.heading_bold: headings in the bold variant of the text's font. */
  markdownHeadingBold: boolean;
}

const SIZE_FIELDS = [
  "markdownH1Size",
  "markdownH2Size",
  "markdownH3Size",
  "markdownH4Size",
  "markdownH5Size",
  "markdownH6Size",
] as const;

export const MARKDOWN_DEFAULTS: MarkdownPreferences = {
  markdownTyping: false,
  markdownH1Size: DEFAULT_HEADING_SCALES[0],
  markdownH2Size: DEFAULT_HEADING_SCALES[1],
  markdownH3Size: DEFAULT_HEADING_SCALES[2],
  markdownH4Size: DEFAULT_HEADING_SCALES[3],
  markdownH5Size: DEFAULT_HEADING_SCALES[4],
  markdownH6Size: DEFAULT_HEADING_SCALES[5],
  markdownBlockGap: DEFAULT_BLOCK_GAP,
  markdownHeadingBold: true,
};

const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const inRange =
  (r: { min: number; max: number }) =>
  (v: unknown): boolean =>
    typeof v === "number" && Number.isFinite(v) && v >= r.min && v <= r.max;

const VALID: Record<MarkdownField, (v: unknown) => boolean> = {
  markdownTyping: isBool,
  markdownH1Size: inRange(HEADING_SIZE_LIMITS),
  markdownH2Size: inRange(HEADING_SIZE_LIMITS),
  markdownH3Size: inRange(HEADING_SIZE_LIMITS),
  markdownH4Size: inRange(HEADING_SIZE_LIMITS),
  markdownH5Size: inRange(HEADING_SIZE_LIMITS),
  markdownH6Size: inRange(HEADING_SIZE_LIMITS),
  markdownBlockGap: inRange(BLOCK_GAP_LIMITS),
  markdownHeadingBold: isBool,
};

export const MARKDOWN_MAPPINGS: readonly ConfigMapping[] = [
  {
    field: "markdownTyping",
    key: "markdown.typing",
    expected: "true or false",
    valid: isBool,
  },
  ...SIZE_FIELDS.map(
    (field, i): ConfigMapping => ({
      field,
      key: `markdown.h${i + 1}_size`,
      expected: `a number from ${HEADING_SIZE_LIMITS.min} to ${HEADING_SIZE_LIMITS.max} (times the text size)`,
      valid: VALID[field],
    }),
  ),
  {
    field: "markdownBlockGap",
    key: "markdown.block_gap",
    expected: `a number from ${BLOCK_GAP_LIMITS.min} to ${BLOCK_GAP_LIMITS.max} (lines)`,
    valid: VALID.markdownBlockGap,
  },
  {
    field: "markdownHeadingBold",
    key: "markdown.heading_bold",
    expected: "true or false",
    valid: isBool,
  },
];

/** Stored preferences -> valid Markdown fields; bad ones default. */
export function normalizeMarkdownPreferences(
  input: Record<string, unknown>,
): MarkdownPreferences {
  return Object.fromEntries(
    MARKDOWN_FIELDS.map((field) => [
      field,
      VALID[field](input[field]) ? input[field] : MARKDOWN_DEFAULTS[field],
    ]),
  ) as unknown as MarkdownPreferences;
}

/** The typing behaviour's settings from the preferences. */
export const typingSettingsFrom = (
  prefs: MarkdownPreferences,
): MarkdownTypingSettings => ({
  headingScales: SIZE_FIELDS.map((f) => prefs[f]),
  blockGap: prefs.markdownBlockGap,
  headingBold: prefs.markdownHeadingBold,
});

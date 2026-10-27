/**
 * `[files] speculative_open`: preference field, config.toml key and default.
 * Pure data; preferences.ts and settingsSync.ts spread it in.
 */
import type { ConfigMapping } from "../vault/settingsSync";

export const SPECULATIVE_FIELDS = ["filesSpeculativeOpen"] as const;
export type SpeculativeField = typeof SPECULATIVE_FIELDS[number];

export interface SpeculativePreferences {
  /** files.speculative_open: read and parse a drawing on pointer-down, before the click. */
  filesSpeculativeOpen: boolean;
}

export const SPECULATIVE_DEFAULTS: SpeculativePreferences = {
  filesSpeculativeOpen: true,
};

export const SPECULATIVE_MAPPINGS: readonly ConfigMapping[] = [
  {
    field: "filesSpeculativeOpen",
    key: "files.speculative_open",
    expected: "true or false",
    valid: (v) => typeof v === "boolean",
  },
];

/** Stored preferences -> valid fields; a bad value gets the default. */
export const normalizeSpeculativePreferences = (
  input: Record<string, unknown>,
): SpeculativePreferences => ({
  filesSpeculativeOpen:
    typeof input.filesSpeculativeOpen === "boolean"
      ? input.filesSpeculativeOpen
      : SPECULATIVE_DEFAULTS.filesSpeculativeOpen,
});

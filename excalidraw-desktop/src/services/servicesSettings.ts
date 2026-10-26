/**
 * When each vault service starts (D8): `[search] start`, `[links] start`,
 * `[history] start` and `[files] list_start` in config.toml. Pure data; preferences.ts and
 * settingsSync.ts spread `SERVICES_DEFAULTS`, `normalizeServicesPreferences`
 * and `SERVICES_MAPPINGS` in.
 *
 * - "open": when the vault opens (eager).
 * - "idle": after the first paint, once input has been quiet for a moment.
 * - "use":  on the first action that needs it.
 */
import type { ConfigMapping } from "../vault/settingsSync";

export const START_MODES = ["open", "idle", "use"] as const;
export type StartMode = typeof START_MODES[number];

export const isStartMode = (v: unknown): v is StartMode =>
  typeof v === "string" && (START_MODES as readonly string[]).includes(v);

export const SERVICES_FIELDS = [
  "searchStart",
  "linksStart",
  "historyStart",
  "filesListStart",
] as const;
export type ServicesField = typeof SERVICES_FIELDS[number];

export interface ServicesPreferences {
  /** search.start */
  searchStart: StartMode;
  /** links.start (starting links also starts search) */
  linksStart: StartMode;
  /** history.start */
  historyStart: StartMode;
  /**
   * files.list_start: the webview's walk of every vault folder (the file
   * list behind recent drawings, the file switcher, link names and the move
   * dialog). The file tree itself always loads at open.
   */
  filesListStart: StartMode;
}

export const SERVICES_DEFAULTS: ServicesPreferences = {
  searchStart: "idle",
  linksStart: "idle",
  historyStart: "open",
  filesListStart: "idle",
};

const mapping = (field: ServicesField, key: string): ConfigMapping => ({
  field,
  key,
  expected: '"open", "idle" or "use"',
  valid: isStartMode,
});

export const SERVICES_MAPPINGS: readonly ConfigMapping[] = [
  mapping("searchStart", "search.start"),
  mapping("linksStart", "links.start"),
  mapping("historyStart", "history.start"),
  mapping("filesListStart", "files.list_start"),
];

/** Stored preferences -> valid start modes; bad ones default. */
export function normalizeServicesPreferences(
  input: Record<string, unknown>,
): ServicesPreferences {
  return Object.fromEntries(
    SERVICES_FIELDS.map((field) => [
      field,
      isStartMode(input[field]) ? input[field] : SERVICES_DEFAULTS[field],
    ]),
  ) as unknown as ServicesPreferences;
}

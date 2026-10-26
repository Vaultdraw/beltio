/**
 * `[extensions]` in config.toml: one boolean per built-in extension, a missing
 * key means the extension's default. Pure data; settingsSync.ts and
 * preferences.ts spread `EXTENSION_MAPPINGS`, `EXTENSION_DEFAULTS` in.
 */
import {
  BUILTIN_EXTENSIONS,
  EXTENSION_FIELDS,
  EXTENSION_IDS,
  type ExtensionField,
} from "./registry";

import type { ConfigMapping } from "../vault/settingsSync";

export type { ExtensionField } from "./registry";

export const EXTENSION_FIELD_LIST: readonly ExtensionField[] =
  EXTENSION_IDS.map((id) => EXTENSION_FIELDS[id]);

export type ExtensionPreferences = Record<ExtensionField, boolean>;

export const EXTENSION_DEFAULTS: ExtensionPreferences = Object.fromEntries(
  BUILTIN_EXTENSIONS.map((e) => [EXTENSION_FIELDS[e.id], e.defaultOn]),
) as ExtensionPreferences;

const isBool = (v: unknown): v is boolean => typeof v === "boolean";

export const EXTENSION_MAPPINGS: readonly ConfigMapping[] = EXTENSION_IDS.map(
  (id) => ({
    field: EXTENSION_FIELDS[id],
    key: `extensions.${id}`,
    expected: "true or false",
    valid: isBool,
  }),
);

/** Stored (localStorage) preferences -> valid extension fields; bad ones default. */
export function normalizeExtensionPreferences(
  input: Record<string, unknown>,
): ExtensionPreferences {
  return Object.fromEntries(
    EXTENSION_FIELD_LIST.map((field) => [
      field,
      isBool(input[field]) ? input[field] : EXTENSION_DEFAULTS[field],
    ]),
  ) as ExtensionPreferences;
}

/**
 * Joins the docs table with the live key table, defaults and per-vault list.
 * Used by scripts/gen-config-reference.ts and the config reference and schema
 * tests only.
 */
import { MAX_PEN_PRESETS } from "../pens/penPresets";
import { STYLE_KEY_RULES } from "../toolDefaults/toolStyles";

import { renderConfigReference } from "./configReference";
import { buildConfigSchema, renderSchema } from "./configSchema";
import { DEFAULT_PREFERENCES } from "./preferences";
import { CONFIG_MAPPING, TOOL_NESTED_KEYS } from "./settingsSync";
import { PER_VAULT_FIELDS } from "./vaultSettings";

export const DOC_PATH = "docs/configuration.md";

const defaults = DEFAULT_PREFERENCES as unknown as Record<string, unknown>;

export const currentReference = (): string =>
  renderConfigReference({
    mappings: CONFIG_MAPPING,
    defaults,
    perVaultFields: PER_VAULT_FIELDS,
  });

export const schemaInput = () => ({
  mappings: CONFIG_MAPPING,
  defaults,
  toolKeys: TOOL_NESTED_KEYS,
  styleRules: STYLE_KEY_RULES,
  maxPens: MAX_PEN_PRESETS,
});

export const currentSchema = (): string =>
  renderSchema(buildConfigSchema(schemaInput()));

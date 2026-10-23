/**
 * Joins the docs table with the live key table, defaults and per-vault list.
 * Used by scripts/gen-config-reference.ts and configReference.test.ts only.
 */
import { renderConfigReference } from "./configReference";
import { DEFAULT_PREFERENCES } from "./preferences";
import { CONFIG_MAPPING } from "./settingsSync";
import { PER_VAULT_FIELDS } from "./vaultSettings";

export const DOC_PATH = "docs/configuration.md";

export const currentReference = (): string =>
  renderConfigReference({
    mappings: CONFIG_MAPPING,
    defaults: DEFAULT_PREFERENCES as unknown as Record<string, unknown>,
    perVaultFields: PER_VAULT_FIELDS,
  });

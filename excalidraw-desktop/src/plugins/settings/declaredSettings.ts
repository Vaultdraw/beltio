/**
 * Declared plugin settings: the schema a plugin registers and the pure rules
 * on it. Values are plain TOML scalars; the stored value is only checked
 * against its declaration when it is read, so a config written before the
 * plugin registered (or by hand) is never lost.
 */
import type { PluginSettingValue } from "../../vault/pluginSettingsTable";

export type SettingScopeName = "global" | "vault";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SettingDecl {
  key: string;
  type: "bool" | "int" | "number" | "string" | "select" | "color";
  title: string;
  description?: string;
  default: PluginSettingValue;
  min?: number;
  max?: number;
  /** select only. */
  options?: readonly SelectOption[];
  /** Layers that may hold a value; defaults to both. */
  scope?: readonly SettingScopeName[];
}

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const inBounds = (decl: SettingDecl, n: number): string | null =>
  (decl.min !== undefined && n < decl.min) ||
  (decl.max !== undefined && n > decl.max)
    ? `a number between ${decl.min ?? "-inf"} and ${decl.max ?? "inf"}`
    : null;

/** null when `value` is valid for `decl`, else what was expected. */
const expectedFor = (decl: SettingDecl, value: unknown): string | null => {
  switch (decl.type) {
    case "bool":
      return typeof value === "boolean" ? null : "true or false";
    case "int":
    case "number": {
      const isInt = decl.type === "int";
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        (isInt && !Number.isInteger(value))
      ) {
        return isInt ? "a whole number" : "a number";
      }
      return inBounds(decl, value);
    }
    case "string":
      return typeof value === "string" ? null : "text";
    case "select":
      return decl.options?.some((o) => o.value === value)
        ? null
        : `one of ${(decl.options ?? [])
            .map((o) => `"${o.value}"`)
            .join(", ")}`;
    case "color":
      return typeof value === "string" && HEX_COLOR.test(value)
        ? null
        : "a hex colour like #1e1e1e";
  }
};

export type SettingValidation =
  | { ok: true; value: PluginSettingValue }
  | { ok: false; problem: string };

export const validateSettingValue = (
  decl: SettingDecl,
  value: unknown,
): SettingValidation => {
  const expected = expectedFor(decl, value);
  return expected === null
    ? { ok: true, value: value as PluginSettingValue }
    : { ok: false, problem: `${decl.key}: expected ${expected}` };
};

export const allowsScope = (decl: SettingDecl, scope: SettingScopeName) =>
  (decl.scope ?? ["global", "vault"]).includes(scope);

/**
 * Vault override, then global value, then the declared default; a value that
 * fails validation is skipped, as is a layer the declaration does not allow.
 */
export const effectiveSetting = (
  decl: SettingDecl,
  global: unknown,
  vault: unknown,
): PluginSettingValue => {
  const layers: [SettingScopeName, unknown][] = [
    ["vault", vault],
    ["global", global],
  ];
  for (const [scope, value] of layers) {
    if (
      value !== undefined &&
      allowsScope(decl, scope) &&
      validateSettingValue(decl, value).ok
    ) {
      return value as PluginSettingValue;
    }
  }
  return decl.default;
};

/** A declaration the registry accepts: unique keys, a valid default. */
export const declProblem = (decl: SettingDecl): string | null => {
  const bad = expectedFor(decl, decl.default);
  return bad ? `${decl.key}: default must be ${bad}` : null;
};

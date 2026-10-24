/**
 * Where a config value comes from: the highest layer that sets it, and the value a
 * lower layer says when the higher one hides it. Pure functions over the `layers[]`
 * that `load_settings` already returns (config.toml, then overrides.toml), so a chip
 * costs one object lookup and nothing is read again. Mirrors `key_source` in
 * vaultdraw-core (`vaultdraw config get <key> --source`).
 */
import type { LayerPayload } from "./settingsSync";

export type SourceFile = "default" | "config.toml" | "overrides.toml";

export interface KeySource {
  source: SourceFile;
  /** The value a lower layer sets when a higher layer hides it with another one. */
  hidden?: { file: "config.toml" | "overrides.toml"; value: unknown };
}

const fileOf = (layer: LayerPayload): "config.toml" | "overrides.toml" =>
  layer.kind === "overrides" ? "overrides.toml" : "config.toml";

/** Looks `key` up in one layer's content; `hotkeys.<id>` keeps dots inside the id. */
const lookup = (config: Record<string, unknown>, key: string) => {
  const dot = key.indexOf(".");
  const table = dot < 0 ? null : config[key.slice(0, dot)];
  const sub = dot < 0 ? key : key.slice(dot + 1);
  const holder =
    table && typeof table === "object"
      ? (table as Record<string, unknown>)
      : dot < 0
      ? config
      : null;
  return holder && Object.prototype.hasOwnProperty.call(holder, sub)
    ? { value: holder[sub] }
    : null;
};

const same = (a: unknown, b: unknown): boolean =>
  typeof a === "object" && a !== null && typeof b === "object" && b !== null
    ? JSON.stringify(a) === JSON.stringify(b)
    : a === b;

/** The winning layer for a dotted config key, with the value it hides. */
export function keySource(
  layers: readonly LayerPayload[] | undefined,
  key: string,
): KeySource & { value?: unknown } {
  const set = [...(layers ?? [])].reverse().flatMap((layer) => {
    const found = layer.config ? lookup(layer.config, key) : null;
    return found ? [{ file: fileOf(layer), value: found.value }] : [];
  });
  const [top, below] = set;
  if (!top) {
    return { source: "default" };
  }
  return {
    source: top.file,
    value: top.value,
    ...(below && !same(below.value, top.value)
      ? { hidden: { file: below.file, value: below.value } }
      : {}),
  };
}

/** The file a value in the merged config was written in (for error messages). */
export const sourceFileOf = (
  layers: readonly LayerPayload[] | undefined,
  key: string,
): "config.toml" | "overrides.toml" => {
  const found = keySource(layers, key).source;
  return found === "overrides.toml" ? found : "config.toml";
};

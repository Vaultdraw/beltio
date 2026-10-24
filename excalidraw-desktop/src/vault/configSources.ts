/**
 * Where a config value comes from: the highest layer that sets it, and the value a
 * lower layer says when the higher one hides it. Pure functions over the `layers[]`
 * that `load_settings` already returns (config.toml, then overrides.toml), so a chip
 * costs one object lookup and nothing is read again. Mirrors `key_source` in
 * vaultdraw-core (`vaultdraw config get <key> --source`).
 */
import type { LayerPayload } from "./settingsSync";

/** `default`, `config.toml`, `overrides.toml` or the name of an included file. */
export type SourceFile = string;

export interface KeySource {
  source: SourceFile;
  /** Full path of the winning file when it is an included file. */
  path?: string;
  /** The value a lower layer sets when a higher layer hides it with another one. */
  hidden?: { file: string; value: unknown };
}

/** The file a layer is read from, by name (an included file's own name). */
export const layerFileName = (layer: LayerPayload): string =>
  layer.kind === "overrides"
    ? "overrides.toml"
    : layer.kind === "include"
    ? layer.name ?? layer.path.split(/[\\/]/).pop() ?? layer.path
    : "config.toml";

const fileOf = layerFileName;

/** Looks `key` up in one layer's content; `hotkeys.<id>` keeps dots inside the id. */
const lookup = (config: Record<string, unknown>, key: string) => {
  // `keys.labels.<sequence>`: the sequence may hold dots.
  if (key.startsWith("keys.labels.")) {
    const labels = (
      config.keys as { labels?: Record<string, unknown> } | undefined
    )?.labels;
    const seq = key.slice("keys.labels.".length);
    return labels && Object.prototype.hasOwnProperty.call(labels, seq)
      ? { value: labels[seq] }
      : null;
  }
  const dot = key.indexOf(".");
  const table = dot < 0 ? null : config[key.slice(0, dot)];
  const sub = dot < 0 ? key : key.slice(dot + 1);
  const holder =
    table && typeof table === "object"
      ? (table as Record<string, unknown>)
      : dot < 0
      ? config
      : null;
  if (holder && Object.prototype.hasOwnProperty.call(holder, sub)) {
    return { value: holder[sub] };
  }
  // Deeper paths (`tools.arrow.roughness`): a plain walk.
  let node: unknown = config;
  for (const part of key.split(".")) {
    if (
      !node ||
      typeof node !== "object" ||
      !Object.prototype.hasOwnProperty.call(node, part)
    ) {
      return null;
    }
    node = (node as Record<string, unknown>)[part];
  }
  return { value: node };
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
    return found
      ? [
          {
            file: fileOf(layer),
            path: layer.kind === "include" ? layer.path : undefined,
            value: found.value,
          },
        ]
      : [];
  });
  const [top, below] = set;
  if (!top) {
    return { source: "default" };
  }
  return {
    source: top.file,
    ...(top.path ? { path: top.path } : {}),
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
): string => {
  const found = keySource(layers, key).source;
  return found === "default" ? "config.toml" : found;
};

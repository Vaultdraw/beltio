/** The plugin's settings (`[plugin.auto-export]`), read from `ctx.settings` as one typed object. */
import type { PluginContext } from "@vaultdraw/api";

export interface Config {
  enabled: boolean;
  formats: ("svg" | "png")[];
  scale: number;
  background: boolean;
  dark: boolean;
  /** A vault folder (no slashes at the ends), or "" for next to the drawing. */
  folder: string;
  exclude: string[];
  skipTag: string;
  moveOnRename: boolean;
  removeOnDelete: boolean;
  debounceMs: number;
  notify: boolean;
}

/** "Private, Scratch/old/" to ["Private", "Scratch/old"]. */
export const parseFolders = (text: string): string[] =>
  text
    .split(",")
    .map((s) => s.trim().replace(/^\/+|\/+$/g, ""))
    .filter((s) => s !== "");

export function readConfig(ctx: PluginContext): Config {
  const get = <T>(key: string) => ctx.settings.get<T>(key);
  const formats = get<string>("formats");
  return {
    enabled: get<boolean>("enabled") === true,
    formats:
      formats === "both" ? ["svg", "png"] : [formats === "png" ? "png" : "svg"],
    scale: get<number>("scale"),
    background: get<boolean>("background") !== false,
    dark: get<string>("theme") === "dark",
    folder: String(get<string>("folder") ?? "")
      .trim()
      .replace(/^\/+|\/+$/g, ""),
    exclude: parseFolders(String(get<string>("exclude") ?? "")),
    skipTag: String(get<string>("skip_tag") ?? "").trim(),
    moveOnRename: get<string>("on_rename") !== "leave",
    removeOnDelete: get<string>("on_delete") !== "leave",
    debounceMs: get<number>("debounce_ms"),
    notify: get<boolean>("notify") === true,
  };
}

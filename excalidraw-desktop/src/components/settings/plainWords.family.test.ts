import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { clashText } from "./pages/Plugins";
import { SETTINGS_SCHEMA } from "./schema";

/**
 * Family sweep (bug hunt BH-16; owner bug "consent dialog shows config keys"): text the user
 * reads never shows config keys (`files.auto_reload`), table headers (`[backup]`), backticks
 * or snake_case names. Covers every Settings description and label, the plugin importer
 * problem lines, and the string literals of the Settings pages.
 */
const KEYISH = [
  /(^|[^[])\[[a-z_.]+\](?!\])/, // [table] header ([[links]] is note syntax)
  /`/, // code formatting
  /\b[a-z]+(?:\.[a-z]+)*\.[a-z]+_[a-z_]+\b/, // dotted key with an underscore
  /\bplugins\.importers\b|\bnetwork\.allow\w*/, // dotted keys without one
];
const keyish = (text: string) => KEYISH.some((re) => re.test(text));

describe("plain words in Settings", () => {
  it("descriptions and labels show no config keys", () => {
    const bad = SETTINGS_SCHEMA.flatMap((s) =>
      [s.label, s.description]
        .filter((t): t is string => typeof t === "string" && keyish(t))
        .map((t) => `${s.id}: ${t}`),
    );
    expect(bad).toEqual([]);
  });

  it.each([
    { extension: "txt", others: [{ pluginId: "b" }], unknownChoice: "zed" },
    {
      extension: "txt",
      others: [{ pluginId: "b" }],
      winner: { pluginId: "a" },
    },
    { extension: "txt", others: [{ pluginId: "b" }] },
  ])("plugin importer problem %# reads as plain words", (clash) => {
    const text = clashText(clash as never);
    expect(keyish(text)).toBe(false);
  });

  it("Settings page sources have no config keys in quoted user text", () => {
    const pages = ["Plugins.tsx", "Files.tsx", "Links.tsx", "Appearance.tsx"];
    const bad = pages.flatMap((p) => {
      const src = readFileSync(join(__dirname, "pages", p), "utf8");
      // JSX text and template/string literals that look like sentences (contain a space).
      const strings = src.match(/(["`])(?:(?!\1)[^\\\n]|\\.){12,}\1/g) ?? [];
      return strings
        .filter(
          (s) =>
            / /.test(s) &&
            /[A-Z]/.test(s) &&
            /\b(config|plugins|network|files)\.[a-z_]+/.test(s),
        )
        .map((s) => `${p}: ${s}`);
    });
    expect(bad).toEqual([]);
  });
});

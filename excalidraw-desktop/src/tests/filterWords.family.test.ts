/**
 * Family (validator, night 2026-10-30, from hunter K's toimprove 223): every type-to-filter list
 * finds a name from each word in any order, with case and accents folded, as Obsidian's search and
 * quick switcher, Zed's pickers and Neovim's Telescope do ("mocha catppuccin" finds "Catppuccin
 * Mocha", "cafe" finds "Café"). One row per filter; a broken member is `it.fails` with its toimprove
 * entry and flips to a pass when fixed. Filters written inline in a component (theme repo picker,
 * tag rename picker) are listed in toimprove 246 until they use a shared helper.
 */
import { describe, expect, it } from "vitest";

import { filterThemes } from "../components/ThemePicker";
import { searchSettings, SETTINGS_SCHEMA } from "../components/settings/schema";
import { searchRegistry } from "../plugins/registry/client";
import { filterEntries, NO_FILTERS } from "../theme/catalogue/search";
import { searchEntries } from "../vault/treeStore";

import type { ThemeEntry } from "../theme/registry";
import type { CatalogueEntry } from "../theme/catalogue/types";
import type { RegistryEntry } from "../plugins/registry/types";
import type { VaultEntry } from "../vault/types";

/** A filter under test: the names it keeps from `names` for `query`. */
type Filter = (names: string[], query: string) => string[];

const MEMBERS: {
  name: string;
  filter: Filter;
  broken?: { words?: string; fold?: string };
}[] = [
  {
    name: "vault search: folder and name matches (treeStore searchEntries)",
    filter: (names, q) =>
      searchEntries(
        names.map(
          (n) =>
            ({ kind: "folder", name: n, path: n } as unknown as VaultEntry),
        ),
        q,
      ).map((e) => e.name),
  },
  {
    name: "installed theme picker (ThemePicker filterThemes)",
    filter: (names, q) =>
      filterThemes(
        names.map((n) => ({ key: n, id: n, name: n } as ThemeEntry)),
        q,
      ).map((e) => e.name),
  },
  {
    name: "theme browser (catalogue filterEntries)",
    filter: (names, q) =>
      filterEntries(
        names.map(
          (n) =>
            ({
              name: n,
              path: n,
              author: "",
              description: "",
              tags: [],
              modes: ["dark"],
            } as unknown as CatalogueEntry),
        ),
        { ...NO_FILTERS, query: q },
      ).map((e) => e.name),
  },
  {
    name: "plugin browser (registry searchRegistry)",
    filter: (names, q) =>
      searchRegistry(
        names.map(
          (n) =>
            ({
              id: "x",
              name: n,
              author: "",
              description: "",
            } as unknown as RegistryEntry),
        ),
        q,
      ).map((e) => e.name),
  },
  {
    name: "Settings search (searchSettings)",
    filter: (names, q) =>
      searchSettings(
        q,
        names.map((n) => ({
          ...SETTINGS_SCHEMA[0],
          label: n,
          description: "",
          keywords: [],
          configKey: "",
        })),
      ).map((s) => s.label),
  },
];

const NAMES = ["Catppuccin Mocha", "Café Notes", "Nord"];

describe("family: type-to-filter lists match each word in any order, folded", () => {
  for (const m of MEMBERS) {
    (m.broken?.words ? it.fails : it)(`${m.name}: words in any order`, () => {
      expect(m.filter(NAMES, "mocha catppuccin")).toEqual(["Catppuccin Mocha"]);
    });
    (m.broken?.fold ? it.fails : it)(`${m.name}: accents folded`, () => {
      expect(m.filter(NAMES, "cafe")).toEqual(["Café Notes"]);
    });
    it(`${m.name}: plain substring still matches`, () => {
      expect(m.filter(NAMES, "noR")).toEqual(["Nord"]);
    });
  }
});

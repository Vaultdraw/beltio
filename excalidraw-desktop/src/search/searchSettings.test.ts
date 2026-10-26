import { describe, expect, it } from "vitest";

import { configToPreferences } from "../vault/settingsSync";
import { MAX_THUMB_CACHE_MB } from "../thumbnails/limits";

import { SEARCH_DEFAULTS } from "./searchSettings";

describe("search and thumbnail cache keys", () => {
  it("defaults equal the old constants", () => {
    const { values, problems } = configToPreferences({});
    expect(problems).toEqual([]);
    expect(values.searchDebounceMs).toBe(60);
    expect(values.searchMaxDrawings).toBe(50);
    expect(values.searchMaxSnippets).toBe(5);
    expect(values.thumbnailCacheMb).toBe(128);
  });
  it("reads overrides", () => {
    const { values, problems } = configToPreferences({
      search: { debounce_ms: 0, max_drawings: 200, max_snippets: 1 },
      interface: { thumbnail_cache_mb: 8 },
    });
    expect(problems).toEqual([]);
    expect(values.searchDebounceMs).toBe(0);
    expect(values.searchMaxDrawings).toBe(200);
    expect(values.searchMaxSnippets).toBe(1);
    expect(values.thumbnailCacheMb).toBe(8);
  });
  it.each([
    ["search", "debounce_ms", 2001],
    ["search", "max_drawings", 0],
    ["search", "max_drawings", 201],
    ["search", "max_snippets", 6],
    ["search", "max_snippets", "3"],
    ["interface", "thumbnail_cache_mb", 7],
    ["interface", "thumbnail_cache_mb", MAX_THUMB_CACHE_MB + 1],
  ])("rejects %s.%s = %j and keeps the default", (table, name, bad) => {
    const { values, problems } = configToPreferences({
      [table]: { [name]: bad },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain(`${table}.${name}`);
    expect(values.searchDebounceMs).toBe(SEARCH_DEFAULTS.searchDebounceMs);
    expect(values.searchMaxDrawings).toBe(SEARCH_DEFAULTS.searchMaxDrawings);
    expect(values.searchMaxSnippets).toBe(SEARCH_DEFAULTS.searchMaxSnippets);
    expect(values.thumbnailCacheMb).toBe(128);
  });
});

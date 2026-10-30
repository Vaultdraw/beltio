/** Family (toimprove 169): a note and a drawing with the same name must read differently on every list. */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SearchResults } from "../components/search/SearchResults";

import type { SearchResponse, VaultSearch } from "../search/types";

const status = { handle: "h", state: "ready" as const, indexed: 2, total: 2 };
const hit = (name: string) => ({
  path: name,
  name,
  score: 1,
  nameHighlights: [] as [number, number][],
  matchCount: 0,
  matches: [],
});

describe("same-named note and drawing in search results", () => {
  it("shows different labels", async () => {
    const res: SearchResponse = {
      query: "idea",
      results: [hit("Idea.md"), hit("Idea.excalidraw")],
      status,
      tookMs: 0,
    } as unknown as SearchResponse;
    const search: VaultSearch = {
      search: vi.fn(async () => res),
      listNames: vi.fn(async () => ({ paths: [], status })),
      status: vi.fn(async () => status),
      subscribe: vi.fn(async () => () => {}),
      tags: async () => ({ tags: [], byPath: {}, status, tookMs: 0 }),
    } as unknown as VaultSearch;
    render(
      <SearchResults
        query="idea"
        inputRef={{ current: null }}
        search={search}
        handle="h"
        allIndexedEntries={[]}
        activePath={null}
        onOpenDrawing={() => {}}
        onOpenMatch={() => {}}
        onOpenFolder={() => {}}
      />,
    );
    await screen.findAllByRole("option");
    const names = [...document.querySelectorAll(".vault-search-row__name")].map(
      (e) => e.textContent,
    );
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });
});

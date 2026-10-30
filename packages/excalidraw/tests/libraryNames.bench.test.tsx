import { getLibraryItemSearchText } from "../components/LibraryMenuItems";

import { API } from "./helpers/api";

import type { LibraryItem } from "../types";

// Timing check, outside the fast tier (wall-clock).
const makeItem = (id: string, name?: string, text?: string): LibraryItem => ({
  id,
  ...(name !== undefined ? { name } : {}),
  status: "unpublished",
  created: 1,
  elements: [
    API.createElement({ type: "rectangle", id: `el-${id}` }),
    ...(text
      ? [API.createElement({ type: "text", id: `txt-${id}`, text })]
      : []),
  ],
});

describe("library search speed", () => {
  it("filters 2000 items quickly once the search text is cached", () => {
    const many = Array.from({ length: 2000 }, (_, i) =>
      makeItem(`i${i}`, i % 7 ? `Item ${i}` : undefined, `text ${i}`),
    );
    const filter = (query: string) =>
      many.filter((item) => getLibraryItemSearchText(item).includes(query));
    expect(filter("text 1999")).toHaveLength(1); // warms the cache
    const start = performance.now();
    const found = filter("item 19");
    const elapsed = performance.now() - start;
    expect(found.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });
});

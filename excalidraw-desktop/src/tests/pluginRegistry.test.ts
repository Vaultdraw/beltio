import { describe, expect, it } from "vitest";

import {
  loadRegistry,
  registryStatus,
  searchRegistry,
  compareVersions,
} from "../plugins/registry/client";
import { parseRegistryIndex } from "../plugins/registry/parseIndex";

import type { CatalogueBackend, RawIndex } from "../theme/catalogue/types";

const SHA = "a".repeat(64);
const entry = (over: Record<string, unknown> = {}) => ({
  id: "word-count",
  name: "Word count",
  author: "ada",
  description: "Counts words",
  version: "1.2.0",
  api: 0,
  permissions: ["vault.read"],
  sha256: SHA,
  url: "word-count-1.2.0.zip",
  ...over,
});
const index = (plugins: unknown[], schema: unknown = 1) =>
  JSON.stringify({ schema, plugins });

describe("parseRegistryIndex", () => {
  it("reads good entries and skips bad ones", () => {
    const list = parseRegistryIndex(
      index([
        entry(),
        entry({ id: "Bad Id" }),
        entry({ id: "no-sha", sha256: "xyz" }),
        entry({ id: "evil", url: "../evil.zip" }),
        entry({ id: "http", url: "http://example.com/a.zip" }),
        entry({ id: "abs", url: "https://example.com/a.zip" }),
        entry({ id: "word-count", name: "duplicate" }),
        "junk",
      ]),
    );
    expect(list.map((e) => e.id)).toEqual(["word-count", "abs"]);
    expect(list[0].permissions).toEqual(["vault.read"]);
  });

  it("rejects a file it cannot trust", () => {
    expect(() => parseRegistryIndex("nope")).toThrow(/not valid JSON/);
    expect(() => parseRegistryIndex("{}")).toThrow(/plugins/);
    expect(() => parseRegistryIndex(index([], 2))).toThrow(/Update Vaultdraw/);
  });
});

describe("status and search", () => {
  const e = parseRegistryIndex(index([entry()]))[0];
  it("compares versions", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBe(0);
    expect(registryStatus(e, undefined)).toBe("available");
    expect(registryStatus(e, "1.2.0")).toBe("installed");
    expect(registryStatus(e, "1.1.9")).toBe("update");
    expect(registryStatus(e, "2.0.0")).toBe("installed");
  });
  it("searches every word", () => {
    expect(searchRegistry([e], "count ada")).toHaveLength(1);
    expect(searchRegistry([e], "count zed")).toHaveLength(0);
    expect(searchRegistry([e], "")).toHaveLength(1);
  });
});

describe("loadRegistry", () => {
  const raw = (fetchedAt: number): RawIndex => ({
    json: index([entry()]),
    sha256: "s",
    fetched_at: fetchedAt,
    url: "https://x.test/index.json",
  });
  const backend = (
    cached: RawIndex | null,
    hits: { n: number },
    fail = false,
  ): CatalogueBackend => ({
    cached: async () => cached,
    refresh: async () => {
      hits.n++;
      if (fail) {
        throw new Error("offline");
      }
      return raw(2000);
    },
    preview: async () => new Uint8Array(),
  });
  const opts = { url: "https://x.test/index.json", ttlHours: 1, now: 1000 };

  it("a fresh cache costs no request", async () => {
    const hits = { n: 0 };
    const r = await loadRegistry(backend(raw(900), hits), opts);
    expect(r.stale).toBe(false);
    expect(r.catalogue.entries).toHaveLength(1);
    expect(hits.n).toBe(0);
  });
  it("fetches when stale and keeps the cache when offline", async () => {
    const hits = { n: 0 };
    await loadRegistry(backend(raw(-10000), hits), opts);
    expect(hits.n).toBe(1);
    const r = await loadRegistry(backend(raw(-10000), hits, true), opts);
    expect(r.stale).toBe(true);
    expect(r.notice).toMatch(/offline/);
  });
});

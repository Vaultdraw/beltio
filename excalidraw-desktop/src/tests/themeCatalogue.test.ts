import { describe, expect, it, vi } from "vitest";

import {
  createLimiter,
  entryStatus,
  entryUrl,
  imageMime,
  installEntry,
  loadCatalogue,
} from "../theme/catalogue/client";
import { parseIndex } from "../theme/catalogue/parseIndex";
import {
  NO_FILTERS,
  filterEntries,
  tagCounts,
} from "../theme/catalogue/search";
import { InstallError } from "../theme/install/types";

import type {
  CatalogueBackend,
  CatalogueEntry,
  RawIndex,
} from "../theme/catalogue/types";
import type { InstallBackend } from "../theme/install/types";

const SHA = "a".repeat(64);
const SHA2 = "b".repeat(64);

const theme = (over: Record<string, unknown> = {}) => ({
  name: "Vesper",
  path: "Vesper/Vesper.json",
  author: "Rauno",
  description: "Warm dark theme",
  tags: ["dark", "warm"],
  modes: ["dark"],
  swatch: { dark: ["#101010", "#ffffff", "#ffc799"] },
  sha256: SHA,
  previews: [],
  ...over,
});

const index = (themes: unknown[], schemaVersion: unknown = 1) =>
  JSON.stringify({ schemaVersion, themes });

describe("parseIndex", () => {
  it("reads entries with their fields", () => {
    const [e] = parseIndex(
      index([
        theme({
          credit: "Rauno",
          licence: "MIT",
          homepage: "https://example.com/v",
          previews: ["Vesper/shot.png"],
        }),
      ]),
    );
    expect(e).toMatchObject({
      name: "Vesper",
      path: "Vesper/Vesper.json",
      modes: ["dark"],
      swatch: { dark: ["#101010", "#ffffff", "#ffc799"] },
      credit: "Rauno",
      licence: "MIT",
      homepage: "https://example.com/v",
      previews: ["Vesper/shot.png"],
    });
  });

  it("skips entries with a bad hash, name or unsafe path", () => {
    const out = parseIndex(
      index([
        theme({ sha256: "xyz" }),
        theme({ name: "" }),
        theme({ name: "A", path: "../etc/passwd.json" }),
        theme({ name: "B", path: "/abs.json" }),
        theme({ name: "C", path: "a\\b.json" }),
        theme({ name: "D", path: "x/y.txt" }),
        theme({ name: "Fine" }),
        null,
        "text",
      ]),
    );
    expect(out.map((e) => e.name)).toEqual(["Fine"]);
  });

  it("drops duplicates by name ignoring case and keeps the first", () => {
    const out = parseIndex(
      index([theme(), theme({ name: "VESPER", sha256: SHA2 })]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].sha256).toBe(SHA);
  });

  it("drops bad colours, unsafe previews and non-https homepages", () => {
    const [e] = parseIndex(
      index([
        theme({
          swatch: { dark: ["#fff", "red", "url(x)"], light: ["nope"] },
          previews: ["a.svg", "../x.png", "ok.webp"],
          // eslint-disable-next-line no-script-url
          homepage: "javascript:alert(1)",
        }),
      ]),
    );
    expect(e.swatch).toEqual({ dark: ["#fff"] });
    expect(e.previews).toEqual(["ok.webp"]);
    expect(e.homepage).toBeUndefined();
  });

  it("falls back to the swatch modes when modes is missing", () => {
    const [e] = parseIndex(index([theme({ modes: undefined })]));
    expect(e.modes).toEqual(["dark"]);
  });

  it("refuses a bad file with a stable code", () => {
    const code = (text: string) => {
      try {
        parseIndex(text);
      } catch (err) {
        return (err as InstallError).code;
      }
      return "";
    };
    expect(code("{")).toBe("INVALID_INDEX");
    expect(code("[]")).toBe("INVALID_INDEX");
    expect(code(JSON.stringify({ schemaVersion: 1 }))).toBe("INVALID_INDEX");
    expect(code(index([], 2))).toBe("INDEX_VERSION");
  });
});

const entry = (over: Partial<CatalogueEntry>): CatalogueEntry => ({
  name: "X",
  path: "X/X.json",
  author: "",
  description: "",
  tags: [],
  modes: ["dark"],
  swatch: {},
  sha256: SHA,
  previews: [],
  ...over,
});

describe("search", () => {
  const all = [
    entry({ name: "Nord", tags: ["dark", "cold"], author: "Arctic" }),
    entry({
      name: "Northern Lights",
      modes: ["dark", "light"],
      tags: ["cold"],
    }),
    entry({
      name: "Paper",
      modes: ["light"],
      description: "A north-facing page",
    }),
    entry({ name: "Vesper", tags: ["warm"] }),
  ];

  it("returns everything in index order without filters", () => {
    expect(filterEntries(all, NO_FILTERS).map((e) => e.name)).toEqual([
      "Nord",
      "Northern Lights",
      "Paper",
      "Vesper",
    ]);
  });

  it("ranks name prefix above description matches", () => {
    const names = filterEntries(all, { ...NO_FILTERS, query: "nor" }).map(
      (e) => e.name,
    );
    expect(names).toEqual(["Nord", "Northern Lights", "Paper"]);
  });

  it("needs every word to match", () => {
    expect(
      filterEntries(all, { ...NO_FILTERS, query: "nord arctic" }),
    ).toHaveLength(1);
    expect(filterEntries(all, { ...NO_FILTERS, query: "nord warm" })).toEqual(
      [],
    );
  });

  it("filters by tag and by mode", () => {
    expect(
      filterEntries(all, { ...NO_FILTERS, tag: "cold" }).map((e) => e.name),
    ).toEqual(["Nord", "Northern Lights"]);
    expect(
      filterEntries(all, { ...NO_FILTERS, mode: "light" }).map((e) => e.name),
    ).toEqual(["Northern Lights", "Paper"]);
  });

  it("counts tags without dark and light", () => {
    expect(tagCounts(all)).toEqual([
      { tag: "cold", count: 2 },
      { tag: "warm", count: 1 },
    ]);
  });
});

const raw = (themes: unknown[], over: Partial<RawIndex> = {}): RawIndex => ({
  json: index(themes),
  sha256: "idx",
  fetched_at: 1000,
  url: "https://x.test/index.json",
  ...over,
});

const catalogueBackend = (
  cached: RawIndex | null,
  refresh: () => Promise<RawIndex>,
): CatalogueBackend & { refresh: ReturnType<typeof vi.fn> } => ({
  cached: async () => cached,
  refresh: vi.fn(refresh),
  preview: async () => new Uint8Array(),
});

const OPTS = {
  url: "https://x.test/index.json",
  ttlHours: 24,
  now: 1000 + 3600,
};

describe("loadCatalogue", () => {
  it("uses a fresh cache without any request", async () => {
    const b = catalogueBackend(raw([theme()]), async () => {
      throw new Error("no");
    });
    const out = await loadCatalogue(b, OPTS);
    expect(out.stale).toBe(false);
    expect(out.catalogue.entries).toHaveLength(1);
    expect(b.refresh).not.toHaveBeenCalled();
  });

  it("fetches when the cache is older than the ttl, when forced, or when ttl is 0", async () => {
    const fresh = raw([theme(), theme({ name: "Two" })], { fetched_at: 5000 });
    const make = () => catalogueBackend(raw([theme()]), async () => fresh);
    for (const o of [
      { ...OPTS, now: 1000 + 25 * 3600 },
      { ...OPTS, force: true },
      { ...OPTS, ttlHours: 0 },
    ]) {
      const b = make();
      const out = await loadCatalogue(b, o);
      expect(b.refresh).toHaveBeenCalledOnce();
      expect(out.catalogue.entries).toHaveLength(2);
    }
  });

  it("ignores a cache made for another address", async () => {
    const b = catalogueBackend(
      raw([theme()], { url: "https://other/x.json" }),
      async () => raw([theme(), theme({ name: "Two" })]),
    );
    const out = await loadCatalogue(b, OPTS);
    expect(out.catalogue.entries).toHaveLength(2);
  });

  it("shows the cached list with the reason when offline", async () => {
    const b = catalogueBackend(raw([theme()]), async () => {
      throw new InstallError("NETWORK_ERROR", "Could not reach x.test");
    });
    const out = await loadCatalogue(b, { ...OPTS, force: true });
    expect(out.stale).toBe(true);
    expect(out.notice).toBe("Could not reach x.test");
    expect(out.catalogue.entries).toHaveLength(1);
  });

  it("throws when offline with no cache", async () => {
    const b = catalogueBackend(null, async () => {
      throw new InstallError("NETWORK_ERROR", "Could not reach x.test");
    });
    await expect(loadCatalogue(b, OPTS)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });

  it("does not hide a bad list behind the cache", async () => {
    const b = catalogueBackend(raw([theme()]), async () =>
      raw([theme()], { json: "{" }),
    );
    await expect(
      loadCatalogue(b, { ...OPTS, force: true }),
    ).rejects.toMatchObject({ code: "INVALID_INDEX" });
  });

  it("shows the consent error instead of a stale list", async () => {
    const b = catalogueBackend(raw([theme()]), async () => {
      throw new InstallError("NETWORK_NOT_ALLOWED", "not allowed");
    });
    await expect(
      loadCatalogue(b, { ...OPTS, force: true }),
    ).rejects.toMatchObject({ code: "NETWORK_NOT_ALLOWED" });
  });

  it("ignores an unreadable cache", async () => {
    const b = catalogueBackend(raw([], { json: "nope" }), async () =>
      raw([theme()]),
    );
    expect((await loadCatalogue(b, OPTS)).catalogue.entries).toHaveLength(1);
  });
});

describe("install flow", () => {
  const MIDNIGHT = JSON.stringify({
    name: "Vesper",
    dark: { mPrimary: "#ffc799", mSurface: "#101010", mOnSurface: "#ffffff" },
  });

  const installBackend = (sha: string) => {
    const write = vi.fn(async (r: { name: string; json?: string }) => ({
      name: r.name,
    }));
    const fetch = vi.fn(async (ref: { kind: string; url?: string }) => ({
      json: MIDNIGHT,
      sha256: sha,
      url: ref.url ?? "",
    }));
    return {
      backend: { fetch, write } as unknown as InstallBackend,
      write,
      fetch,
    };
  };
  const e = entry({ name: "Vesper", path: "Vesper/Vesper.json" });

  it("builds the file address next to the index and encodes the path", () => {
    expect(entryUrl("https://r.test/o/main/index.json", "A B/A B.json")).toBe(
      "https://r.test/o/main/A%20B/A%20B.json",
    );
  });

  it("downloads, checks the hash and writes with the source", async () => {
    const { backend, write, fetch } = installBackend(SHA);
    const name = await installEntry(
      backend,
      e,
      "https://r.test/o/main/index.json",
      64 * 1024,
    );
    expect(name).toBe("Vesper");
    expect(fetch).toHaveBeenCalledWith(
      { kind: "url", url: "https://r.test/o/main/Vesper/Vesper.json" },
      64 * 1024,
    );
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        replace: false,
        source: {
          url: "https://r.test/o/main/Vesper/Vesper.json",
          sha256: SHA,
        },
      }),
    );
  });

  it("refuses a file that does not match the list and writes nothing", async () => {
    const { backend, write } = installBackend(SHA2);
    await expect(
      installEntry(backend, e, "https://r.test/o/main/index.json", 1024),
    ).rejects.toMatchObject({ code: "HASH_MISMATCH" });
    expect(write).not.toHaveBeenCalled();
  });

  it("replaces on update", async () => {
    const { backend, write } = installBackend(SHA);
    await installEntry(backend, e, "https://r.test/o/main/index.json", 1024, {
      replace: true,
    });
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ replace: true }),
    );
  });

  it("installs under the list's name when the file says another", async () => {
    const { backend, write } = installBackend(SHA);
    const name = await installEntry(
      backend,
      entry({ name: "Vesper Two", path: "Vesper/Vesper.json" }),
      "https://r.test/o/main/index.json",
      1024,
    );
    expect(name).toBe("Vesper Two");
    expect(write.mock.calls[0][0].json).toContain('"Vesper Two"');
  });

  it("never offers to overwrite a theme with no recorded hash", () => {
    expect(entryStatus(e, [{ name: "Vesper", source: {} as never }])).toBe(
      "installed",
    );
  });

  it("tells available, installed and update apart", () => {
    const mine = (sha256: string) => [{ name: "vesper", source: { sha256 } }];
    expect(entryStatus(e, [])).toBe("available");
    expect(entryStatus(e, mine(SHA))).toBe("installed");
    expect(entryStatus(e, mine(SHA2))).toBe("update");
  });
});

describe("helpers", () => {
  it("limits parallel jobs", async () => {
    const limit = createLimiter(2);
    let running = 0;
    let peak = 0;
    const job = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    };
    await Promise.all(Array.from({ length: 6 }, () => limit(job)));
    expect(peak).toBe(2);
  });

  it("sniffs image types", () => {
    expect(imageMime(new Uint8Array([0x89, 0x50, 0x4e]))).toBe("image/png");
    expect(imageMime(new Uint8Array([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(imageMime(new Uint8Array([0x52, 0x49]))).toBe("image/webp");
  });
});

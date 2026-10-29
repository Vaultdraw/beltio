import { describe, expect, test } from "vitest";

import { createWebImages } from "../src/webImages";

import type { NetworkApi } from "@vaultdraw/api";
import type { PageItem } from "../src/layout/types";

// Bug hunter A (2026-10-30): a `data:` picture is its own bytes, whatever the data URL's
// spelling (percent-encoded SVG, extra parameters); it is never a network request.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>`;
const item = (target: string): PageItem =>
  ({
    type: "image",
    page: 0,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    mimeType: "application/octet-stream",
    target,
  } as PageItem);

const ROWS: [string, string][] = [
  ["base64", `data:image/svg+xml;base64,${btoa(SVG)}`],
  ["percent-encoded", `data:image/svg+xml,${encodeURIComponent(SVG)}`],
  [
    "charset then percent-encoded",
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`,
  ],
  [
    "charset then base64",
    `data:image/svg+xml;charset=utf-8;base64,${btoa(SVG)}`,
  ],
];

describe("data: pictures in a note", () => {
  test.each(ROWS)("%s gets its bytes without any request", async (_n, url) => {
    const fetched: string[] = [];
    const net: NetworkApi = {
      async askImages() {
        return true;
      },
      async fetchImage(u: string) {
        fetched.push(u);
        throw Object.assign(new Error("refused"), { code: "INVALID_URL" });
      },
    } as unknown as NetworkApi;
    const it = item(url);
    await createWebImages(net).fill([it]);
    expect(fetched).toEqual([]);
    expect((it as { bytes?: Uint8Array }).bytes?.length ?? 0).toBeGreaterThan(
      0,
    );
  });
});

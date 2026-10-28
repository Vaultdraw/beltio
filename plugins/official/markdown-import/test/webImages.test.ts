import { describe, expect, test } from "vitest";

import { createWebImages } from "../src/webImages";

import type { NetworkApi } from "@vaultdraw/api";
import type { PageItem } from "../src/layout/types";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

const item = (target: string, alt = ""): PageItem =>
  ({
    type: "image",
    page: 0,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    mimeType: "application/octet-stream",
    target,
    ...(alt ? { alt } : {}),
  } as PageItem);

const fake = (answer: boolean, images: Record<string, Uint8Array | string>) => {
  const log = { asked: [] as string[][], fetched: [] as string[] };
  const net: NetworkApi = {
    async askImages(urls) {
      log.asked.push([...urls]);
      return answer;
    },
    async fetchImage(url) {
      log.fetched.push(url);
      const hit = images[url];
      if (typeof hit === "string") {
        throw Object.assign(new Error(hit), { code: hit });
      }
      if (!hit) {
        throw Object.assign(new Error("x"), { code: "NETWORK_ERROR" });
      }
      return hit;
    },
  };
  return { net, log };
};

describe("web pictures", () => {
  test("asked once per import, then downloaded and typed by their bytes", async () => {
    const { net, log } = fake(true, {
      "https://a.example/1.png": PNG,
      "https://b.example/2": PNG,
    });
    const web = createWebImages(net);
    const first = item("https://a.example/1.png");
    await web.fill([first]);
    const second = item("https://b.example/2");
    await web.fill([second]);
    expect(log.asked).toHaveLength(1);
    for (const i of [first, second]) {
      expect((i as any).bytes).toBeDefined();
      expect((i as any).mimeType).toBe("image/png");
    }
    expect(web.downloaded).toBe(2);
  });

  test("a no stays a no for the import and every box says why", async () => {
    const { net, log } = fake(false, {});
    const web = createWebImages(net);
    const a = item("https://a.example/1.png", "Chip");
    const b = item("https://a.example/2.png");
    await web.fill([a]);
    await web.fill([b]);
    expect(log.asked).toHaveLength(1);
    expect(log.fetched).toHaveLength(0);
    expect((a as any).alt).toBe("Web image, not downloaded: Chip");
    expect((b as any).bytes).toBeUndefined();
  });

  test("a web page, an oversize file and a failure stay labelled boxes", async () => {
    const { net } = fake(true, {
      "https://a.example/page": "NOT_AN_IMAGE",
      "https://a.example/big.png": "TOO_LARGE",
    });
    const web = createWebImages(net);
    const items = [
      item("https://a.example/page"),
      item("https://a.example/big.png"),
      item("https://a.example/gone.png"),
    ];
    await web.fill(items);
    expect(items.map((i) => (i as any).alt)).toEqual([
      "Web page, not a picture: https://a.example/page",
      "Image over 10 MB: https://a.example/big.png",
      "Web image could not be downloaded: https://a.example/gone.png",
    ]);
  });

  test("http is never downloaded, data: pictures need no network, no network API means boxes", async () => {
    const { net, log } = fake(true, {});
    const web = createWebImages(net);
    const plain = item("http://a.example/1.png");
    const data = item(
      `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`,
    );
    await web.fill([plain, data]);
    expect((plain as any).alt).toMatch(/not https/);
    expect((data as any).bytes).toBeDefined();
    expect(log.asked).toHaveLength(0);
    const none = item("https://a.example/1.png");
    await createWebImages(undefined).fill([none]);
    expect((none as any).alt).toMatch(/not downloaded/);
  });

  test("the same address is downloaded once", async () => {
    const { net, log } = fake(true, { "https://a.example/1.png": PNG });
    const web = createWebImages(net);
    await web.fill([item("https://a.example/1.png")]);
    await web.fill([item("https://a.example/1.png")]);
    expect(log.fetched).toHaveLength(1);
  });
});

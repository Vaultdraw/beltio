import { describe, expect, it } from "vitest";

import { pastedPictureUrls, pictureType } from "./pasteWebImage";

describe("which pastes are web pictures", () => {
  it.each([
    [
      { text: "https://images.example.org/x?purpose=inline" },
      ["https://images.example.org/x?purpose=inline"],
      false,
    ],
    [
      { text: "  http://example.org/a.png \n" },
      ["http://example.org/a.png"],
      false,
    ],
    [{ text: "see https://example.org/a.png" }, null, false],
    [{ text: "https://a.example/1 https://a.example/2" }, null, false],
    [{ text: "ftp://example.org/a.png" }, null, false],
    [
      {
        text: "Chip",
        mixedContent: [
          { type: "text", value: "Chip" },
          { type: "imageUrl", value: "https://cdn.example/c.png" },
        ],
      },
      ["https://cdn.example/c.png"],
      true,
    ],
    // A page part with only a data: or local picture is left to the editor.
    [
      {
        text: "x",
        mixedContent: [{ type: "imageUrl", value: "data:image/png;base64,AA" }],
      },
      null,
      false,
    ],
    [
      {
        text: "https://a.example/p.png",
        mixedContent: [{ type: "text", value: "https://a.example/p.png" }],
      },
      null,
      false,
    ],
  ])("%j", (data, urls, fromPage) => {
    const got = pastedPictureUrls(data);
    expect(got?.urls ?? null).toEqual(urls);
    if (got) {
      expect(got.fromPage).toBe(fromPage);
    }
  });
});

describe("pictureType goes by the bytes", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it.each([
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), "image/png"],
    [new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"],
    [enc("GIF89a..."), "image/gif"],
    [enc("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "), "image/webp"],
    [enc('<?xml version="1.0"?><svg xmlns="x"/>'), "image/svg+xml"],
    [enc("<!doctype html><html>"), null],
  ])("%#", (bytes, type) => expect(pictureType(bytes)).toBe(type));
});

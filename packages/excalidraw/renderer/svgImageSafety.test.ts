import { IMAGE_MIME_TYPES } from "@excalidraw/common";

import { exportToSvg } from "../scene/export";
import { API } from "../tests/helpers/api";

import { isSafeImageDataURL } from "./staticSvgScene";

import type { BinaryFileData } from "../types";

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const svgWith = async (dataURL: string) => {
  const image = API.createElement({
    type: "image",
    x: 0,
    y: 0,
    width: 40,
    height: 40,
    fileId: "f1" as any,
  });
  const files = {
    f1: {
      id: "f1",
      mimeType: "image/png",
      dataURL,
      created: 1,
    } as unknown as BinaryFileData,
  };
  return (
    await exportToSvg(
      [image],
      { exportBackground: false, viewBackgroundColor: "#ffffff" },
      files,
      { skipInliningFonts: true },
    )
  ).outerHTML;
};

describe("SVG export of image files", () => {
  it("accepts only base64 data: images", () => {
    expect(isSafeImageDataURL(PIXEL)).toBe(true);
    expect(isSafeImageDataURL("data:image/svg+xml;base64,PHN2Zy8+")).toBe(true);
    // Every type the editor accepts as an image is kept (ICO and JFIF used to be dropped).
    for (const type of Object.values(IMAGE_MIME_TYPES)) {
      expect(isSafeImageDataURL(`data:${type};base64,AAAA`)).toBe(true);
      expect(
        isSafeImageDataURL(`data:${type.toUpperCase()};charset=x;base64,AAAA`),
      ).toBe(true);
      expect(isSafeImageDataURL(`data:${type},AAAA`)).toBe(false);
    }
    expect(isSafeImageDataURL("data:image/x-iconx;base64,AAAA")).toBe(false);
    for (const bad of [
      "https://tracker.example/p.png",
      "http://x/p.png",
      "file:///etc/passwd",
      // eslint-disable-next-line no-script-url
      "javascript:alert(1)",
      "data:text/html;base64,PGI+",
      "data:image/png,rawbytes",
      "//tracker.example/p.png",
      42,
      undefined,
    ]) {
      expect(isSafeImageDataURL(bad)).toBe(false);
    }
  });

  it("keeps an embedded image and drops a remote one, keeping the element", async () => {
    const ok = await svgWith(PIXEL);
    expect(ok).toContain('href="data:image/png;base64,');
    const bad = await svgWith("https://tracker.example/p.png");
    expect(bad).not.toContain("tracker.example");
    expect(bad).not.toMatch(/href="https?:/);
    expect(bad).toContain("<use");
    expect(bad).toContain("<image");
  });
});

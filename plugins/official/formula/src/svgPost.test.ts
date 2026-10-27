import fs from "fs";
import path from "path";

import { normalizeSVG } from "../../../../packages/element/src/image";

import { postProcessSvg, svgToDataURL } from "./svgPost";

const fx = (n: string) =>
  fs.readFileSync(path.join(__dirname, "__fixtures__", `${n}.svg`), "utf8");

const dims = (svg: string) => {
  const d = new DOMParser().parseFromString(svg, "image/svg+xml");
  const el = d.querySelector("svg")!;
  return [
    el.getAttribute("width"),
    el.getAttribute("height"),
    el.getAttribute("viewBox"),
  ];
};

describe("postProcessSvg", () => {
  it.each(["simple", "text", "frac"])("processes %s", (name) => {
    const r = postProcessSvg(fx(name), "#ff0000");
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.svg).not.toMatch(
      /currentColor|data-mml-node|data-c=|role=|focusable|aria-/,
    );
    expect(r.svg).toContain("#ff0000");
    expect(r.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(r.svg).not.toMatch(/<svg[^>]*style=/);
    const doc = new DOMParser().parseFromString(r.svg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    const [w, h, vb] = dims(r.svg);
    const [, , vw, vh] = vb!.split(" ").map(Number);
    expect(Number(w)).toBeCloseTo((vw * 20) / 1000, 2);
    expect(Number(h)).toBeCloseTo((vh * 20) / 1000, 2);
    expect(r.width).toBe(Number(w));
    expect(r.height).toBe(Number(h));
    expect(w).not.toMatch(/ex|%/);
  });

  it("survives normalizeSVG unchanged in size and viewBox (incl. é)", () => {
    for (const name of ["simple", "text", "frac"]) {
      const r = postProcessSvg(fx(name), "#1e1e1e");
      if (!r.ok) {
        throw new Error("fail");
      }
      expect(dims(normalizeSVG(r.svg))).toEqual(dims(r.svg));
    }
  });

  it("keeps non-Latin1 text intact through dataURL round trip", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"><text>é漢😀</text></svg>`;
    const url = svgToDataURL(svg);
    expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const bin = atob(url.split(",")[1]);
    const text = new TextDecoder().decode(
      Uint8Array.from(bin, (c) => c.charCodeAt(0)),
    );
    expect(text).toBe(svg);
  });

  it("falls back on unsafe colours and bad input", () => {
    const r = postProcessSvg(fx("simple"), 'red" onload="x');
    expect(r.ok && r.svg).toContain("#1e1e1e");
    expect(postProcessSvg("nope", "#000").ok).toBe(false);
    expect(postProcessSvg("<svg></svg>", "#000").ok).toBe(false);
  });
});

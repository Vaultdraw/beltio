/**
 * The update pass re-wraps clipped text and reflows the page (toimprove #111, #113): after it,
 * no line is wider than its element, nothing overlaps and real line breaks survive. A fake monospace measure stands in for the editor's: Excalifont
 * 0.5 em per character, Cascadia 0.6 em (wider, as in the owner's notes).
 */
import { describe, expect, it } from "vitest";

import { overflows } from "./reflow";
import { upgradeScene } from "./upgradeScene";

import type { TextMeasure } from "./reflow";
import type { UpgradeTarget } from "./upgradeScene";

const EM: Record<number, number> = { 5: 0.5, 3: 0.6, 9: 0.55 };
const charW = (family: number, size: number) => (EM[family] ?? 0.5) * size;

/** Greedy word wrap, long words broken by characters, like the editor's wrapText. */
const fakeWrap = (
  text: string,
  family: number,
  size: number,
  max: number,
): string[] => {
  const per = Math.max(1, Math.floor(max / charW(family, size)));
  const out: string[] = [];
  for (const hard of text.split("\n")) {
    let line = "";
    for (const word of hard.split(" ")) {
      let w = word;
      while (w.length > per) {
        if (line) {
          out.push(line);
          line = "";
        }
        out.push(w.slice(0, per));
        w = w.slice(per);
      }
      const next = line ? `${line} ${w}` : w;
      if (next.length > per) {
        out.push(line);
        line = w;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
};

const measure: TextMeasure = {
  width: (t, f, s) => t.length * charW(f, s),
  wrap: fakeWrap,
};

const MARK = "plugins.markdown-import";
const WIDTH = 682;
const PARA =
  "To understand cpu lets first understand what a transistor is A transistor is basically an electrically controlled switch It controls the flow of electricity through it By controlling the flow of electicity is can create a YES NO state";

let ids = 0;
const text = (
  body: string,
  y: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => {
  const fontFamily = (extra.fontFamily as number) ?? 5;
  const fontSize = (extra.fontSize as number) ?? 16;
  const lines = fakeWrap(body, fontFamily, fontSize, WIDTH);
  return {
    id: `t${ids++}`,
    type: "text",
    x: 56,
    y,
    width: WIDTH,
    height: lines.length * fontSize * 1.25,
    text: lines.join("\n"),
    originalText: lines.join("\n"),
    fontFamily,
    fontSize,
    lineHeight: 1.25,
    strokeColor: "#1e1e1e",
    version: 1,
    ...extra,
  };
};

const setup = (pageCount = 1) => ({
  enabled: true,
  layout: "separate",
  size: "a4",
  orientation: "portrait",
  width: 794,
  height: 1123,
  pageCount,
  paperTheme: "match",
});

const target = (over: Partial<UpgradeTarget> = {}): UpgradeTarget => ({
  look: {
    paperTheme: "match",
    viewBackgroundColor: "#ffffff",
    viewBackgroundPattern: null,
  } as unknown as UpgradeTarget["look"],
  fontFamily: 3,
  measure,
  ...over,
});

/** A drawing the import made: the first element carries the import's mark. */
const scene = (elements: Record<string, unknown>[], pageCount = 1) =>
  JSON.stringify({
    type: "excalidraw",
    elements: elements.map((e, i) =>
      i === 0 && !e.customData
        ? { ...e, customData: { [MARK]: { callout: "note" } } }
        : e,
    ),
    appState: { pageSetup: setup(pageCount) },
  });

type E = Record<string, unknown> & { y: number; height: number };
const run = (json: string, t = target()) => {
  const out = upgradeScene(json, t);
  return out
    ? {
        ...out,
        scene: JSON.parse(out.json) as {
          elements: E[];
          appState: { pageSetup: { pageCount: number } };
        },
      }
    : null;
};

const noOverlap = (els: E[]) => {
  const sorted = [...els].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    expect(sorted[i].y).toBeGreaterThanOrEqual(
      sorted[i - 1].y + sorted[i - 1].height - 0.01,
    );
  }
};

describe("update pass: clipped text is re-wrapped and the page reflows", () => {
  it("a paragraph that took a wider font fits its width again (the owner's CPU note)", () => {
    const head = text("Transistors", 56, {
      fontSize: 28.5,
      customData: { [MARK]: { heading: 1 } },
    });
    const para = text(PARA, 110);
    const after = text("U combine millions of such switches", 300);
    const out = run(scene([head, para, after]))!;
    expect(out.rewrapped).toBeGreaterThan(0);
    for (const e of out.scene.elements) {
      expect(overflows(e, measure), String(e.text)).toBe(false);
      expect(e.fontFamily).toBe(3);
    }
    const p = out.scene.elements[1];
    // Soft breaks joined: the words read in order, nothing lost.
    expect(String(p.text).replace(/\n/g, " ")).toBe(PARA);
    expect(p.originalText).toBe(p.text);
    expect(p.height).toBeGreaterThan(para.height as number);
    noOverlap(out.scene.elements);
  });

  it("a real line break of the note is kept", () => {
    const body = "Short first line.\nSecond line of the note, also short.";
    const para = text(body, 56, {
      text: body,
      originalText: body,
      width: 300,
      height: 40,
    });
    para.text = "Short first line.\nSecond line of the note, also short.";
    const out = run(scene([para]))!;
    const lines = String(out.scene.elements[0].text).split("\n");
    expect(lines[0]).toBe("Short first line.");
  });

  it("list items stay items; their continuation lines join them", () => {
    const body = [
      "• first item",
      "• second item that is long",
      "  continues",
    ].join("\n");
    const list = text("", 56, {
      text: body,
      originalText: body,
      width: 120,
      height: 60,
    });
    const out = run(scene([list]))!;
    const lines = String(out.scene.elements[0].text).split("\n");
    expect(lines.filter((l) => l.startsWith("• "))).toHaveLength(2);
    expect(lines.join(" ")).toContain("first item");
    for (const l of lines) {
      expect(measure.width(l, 3, 16)).toBeLessThanOrEqual(120);
    }
  });

  it("code on a code box keeps every line; a too-long line is broken", () => {
    const code = `let a = 1;\n${"x".repeat(80)}`;
    const box = {
      id: "box",
      type: "rectangle",
      x: 50,
      y: 50,
      width: 400,
      height: 80,
      backgroundColor: "#e9ecef",
      version: 1,
    };
    const el = text("", 56, {
      text: code,
      originalText: code,
      fontFamily: 3,
      width: 390,
      height: 40,
    });
    const out = run(scene([box, el]), target({ fontFamily: 9 }))!;
    // Code kept Cascadia; the clipped line is broken, the others stay.
    expect(out.fonts).toBe(0);
    expect(out.rewrapped).toBe(1);
    const lines = String(out.scene.elements[1].text).split("\n");
    expect(lines[0]).toBe("let a = 1;");
    expect(lines.length).toBe(3);
  });

  it("a block that no longer fits moves to the next page", () => {
    const els = [text(PARA, 56)];
    let y = 56 + (els[0].height as number) + 12;
    while (y < 1000) {
      const t = text(PARA, y);
      els.push(t);
      y += (t.height as number) + 12;
    }
    const out = run(scene(els))!;
    expect(out.scene.appState.pageSetup.pageCount).toBeGreaterThan(1);
    const pitch = 1123 + 40;
    for (const e of out.scene.elements) {
      const top = e.y % pitch;
      expect(top + e.height).toBeLessThanOrEqual(1123 - 56 + 0.01);
    }
    noOverlap(out.scene.elements);
  });

  it("nothing clipped: the note is left alone", () => {
    const head = text("Title", 56, {
      fontFamily: 3,
      fontSize: 28.5,
      customData: { [MARK]: { heading: 1 } },
    });
    expect(run(scene([head]))).toBeNull();
  });
});

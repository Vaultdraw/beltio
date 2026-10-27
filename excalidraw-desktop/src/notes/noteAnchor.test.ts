// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { findAnchorElement, queueAnchor, takeAnchor } from "./noteAnchor";

const root = (html: string) => {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d;
};

describe("anchors", () => {
  it("queues once per path", () => {
    queueAnchor("a.md", { heading: "X" });
    expect(takeAnchor("a.md")).toEqual({ heading: "X" });
    expect(takeAnchor("a.md")).toBeNull();
  });
  it("finds a heading by slug or by text", () => {
    const r = root(
      '<h2 id="plan-b">Plan B</h2><h3 id="x"><em>Deep</em> dive</h3>',
    );
    expect(findAnchorElement(r, { heading: "Plan B" })?.id).toBe("plan-b");
    expect(findAnchorElement(r, { heading: "deep dive" })?.id).toBe("x");
    expect(findAnchorElement(r, { heading: "nope" })).toBeNull();
  });
  it("finds a block by its trailing ^id", () => {
    const r = root(
      "<p>one ^a1</p><ul><li>item ^b2<ul><li>inner</li></ul></li></ul>",
    );
    expect(findAnchorElement(r, { block: "a1" })?.tagName).toBe("P");
    expect(findAnchorElement(r, { block: "b2" })?.tagName).toBe("LI");
    expect(findAnchorElement(r, { block: "zz" })).toBeNull();
  });
});

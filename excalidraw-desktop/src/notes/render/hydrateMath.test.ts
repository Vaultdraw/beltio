import { afterEach, describe, expect, it } from "vitest";

import { setMathProvider } from "../../plugins/mathService";

import { hydrateMath } from "./hydrate";

const note = () => {
  const root = document.createElement("div");
  root.innerHTML =
    '<span class="note-math" data-math="x^2" data-display="0">$x^2$</span>';
  document.body.appendChild(root);
  return root;
};

let off: (() => void) | null = null;
afterEach(() => {
  off?.();
  off = null;
  document.body.innerHTML = "";
});

describe("hydrateMath", () => {
  it("leaves the TeX source as text when no plugin provides a renderer", async () => {
    const root = note();
    await hydrateMath(root, 16);
    const el = root.querySelector(".note-math")!;
    expect(el.textContent).toBe("$x^2$");
    expect(el.classList.contains("note-math-source")).toBe(true);
    expect(el.querySelector("img")).toBeNull();
  });

  it("swaps the source for the rendered picture when a renderer is provided", async () => {
    off = setMathProvider(async () => ({
      ok: true,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"/>',
      width: 40,
      height: 20,
    }));
    const root = note();
    await hydrateMath(root, 20);
    const img = root.querySelector("img.note-math-img") as HTMLImageElement;
    expect(img.alt).toBe("x^2");
    expect(img.width).toBe(40);
  });

  it("marks a TeX error and keeps the source", async () => {
    off = setMathProvider(async () => ({ ok: false, error: "Missing }" }));
    const root = note();
    await hydrateMath(root, 20);
    const el = root.querySelector(".note-math") as HTMLElement;
    expect(el.classList.contains("note-math-error")).toBe(true);
    expect(el.title).toBe("Missing }");
  });
});

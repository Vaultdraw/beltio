describe("mathjaxEngine", () => {
  let engine: { render: (r: any) => any };
  beforeAll(async () => {
    const { createMathJaxEngine } = await import("./mathjaxEngine");
    engine = createMathJaxEngine();
  });
  const r = (source: string, display = false, color = "#336699") =>
    engine.render({ source, display, color });

  it("renders a formula to a clean SVG", () => {
    const out = r("x^2+\\frac{a}{b}");
    expect(out.ok).toBe(true);
    expect(out.svg).toContain("#336699");
    expect(out.svg).not.toMatch(/currentColor|data-mml-node/);
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
  });

  it("supports ams, boldsymbol and non-Latin1 text", () => {
    expect(
      r("\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}\\boldsymbol{\\alpha}", true)
        .ok,
    ).toBe(true);
    expect(r("\\text{é漢}").ok).toBe(true);
  });

  it("reports TeX errors without throwing", () => {
    const out = r("\\frac{");
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/brace/i);
    expect(r("   ").ok).toBe(false);
  });

  it("does not produce links or scripts for html/require escapes", () => {
    for (const src of [
      "\\href{javascript:alert(1)}{x}",
      "\\require{html}\\class{a}{x}",
    ]) {
      const out = r(src);
      expect(out.svg ?? "").not.toMatch(
        /<a[\s>]|href=|<script|onload=|class="a"/,
      );
    }
  });
});

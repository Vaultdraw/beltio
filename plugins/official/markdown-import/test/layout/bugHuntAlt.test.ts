import { describe, expect, test } from "vitest";

import { literalImages } from "../../src/layout/literalImages";

describe("bug hunt: alt text that merely ends in a number", () => {
  test("![Figure 2019](my pics/a.png) keeps its alt and gets no size", () => {
    const [img] = literalImages("![Figure 2019](my pics/a.png)")!;
    expect(img).toMatchObject({ alt: "Figure 2019" });
    expect((img as { width?: number }).width).toBeUndefined();
  });
  test("![Photo 3](my pics/a.png) is not 3px wide", () => {
    const [img] = literalImages("![Photo 3](my pics/a.png)")!;
    expect((img as { width?: number }).width).toBeUndefined();
  });
});

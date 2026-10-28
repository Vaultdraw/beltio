import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** toimprove #61: the check of a checked menu item must not sit on its label. */
describe("canvas context menu check gutter", () => {
  const css = readFileSync(
    resolve(__dirname, "../theme/excalidrawChrome.css"),
    "utf8",
  );
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return start < 0 ? "" : css.slice(start, css.indexOf("}", start));
  };

  it("reserves a start gutter wider than the check's offset plus glyph", () => {
    const item = rule(".excalidraw .context-menu-item");
    const padding = /padding:\s*0\s+\d+px\s+0\s+(\d+)px/.exec(item);
    const check = /left:\s*(\d+)px/.exec(
      rule(".excalidraw .context-menu-item.checkmark::before"),
    );
    expect(padding).not.toBeNull();
    expect(check).not.toBeNull();
    // The check glyph is about 10px wide.
    expect(Number(padding![1])).toBeGreaterThanOrEqual(Number(check![1]) + 10);
  });
});

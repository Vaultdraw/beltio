// word-count: live statistics of the active drawing.
// Shows ctx.scene.useScene used ONLY inside the panel component: while the
// panel is closed nothing subscribes to the scene and no work happens. The
// selector is one O(n) pass that returns a small plain object, and isEqual
// compares its fields, so edits that leave the numbers unchanged (moving a
// shape, recolouring) do not re-render. The command reads ctx.scene.elements()
// once, on demand, and shows a toast.
import { createElement as h } from "react";
import { definePlugin } from "@vaultdraw/api";

// A word is a run of letters/digits (with inner ' ’ - such as "don't"), or one
// Han/Kana character (those scripts have no spaces).
const CJK = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}";
const WORD = new RegExp(
  `[${CJK}]|(?:(?![${CJK}])[\\p{L}\\p{N}])+(?:['’-](?:(?![${CJK}])[\\p{L}\\p{N}])+)*`,
  "gu",
);

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const LINES = new Set(["arrow", "line"]);

/** One pass over the elements: a small plain object of counts. */
export function stats(elements) {
  const s = {
    words: 0,
    characters: 0,
    texts: 0,
    shapes: 0,
    lines: 0,
    total: 0,
  };
  for (const el of elements) {
    s.total++;
    if (el.type === "text") {
      s.texts++;
    } else if (SHAPES.has(el.type)) {
      s.shapes++;
    } else if (LINES.has(el.type)) {
      s.lines++;
    }
    if (el.text) {
      s.words += el.text.match(WORD)?.length ?? 0;
      s.characters += el.text.replace(/\s/gu, "").length;
    }
  }
  return s;
}

const sameStats = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);

const ROWS = [
  ["words", "Words"],
  ["characters", "Characters (no spaces)"],
  ["texts", "Text elements"],
  ["shapes", "Shapes"],
  ["lines", "Arrows and lines"],
  ["total", "Total elements"],
];

export default definePlugin({
  activate(ctx) {
    function Stats() {
      const s = ctx.scene.useScene(stats, sameStats);
      if (s.total === 0) {
        return h(
          "p",
          { style: { padding: 16 }, "data-testid": "stats-empty" },
          "Nothing to count. Open a drawing with some elements.",
        );
      }
      return h(
        "dl",
        { style: { padding: 16, margin: 0 } },
        ROWS.map(([key, label]) =>
          h(
            "div",
            {
              key,
              style: { display: "flex", justifyContent: "space-between" },
            },
            h("dt", null, label),
            h(
              "dd",
              { "data-testid": `stat-${key}`, style: { margin: 0 } },
              s[key],
            ),
          ),
        ),
      );
    }

    ctx.panels.register("stats", Stats);
    ctx.commands.register("count", () => {
      ctx.ui.toast(`${stats(ctx.scene.elements()).words} words`);
    });
  },
});

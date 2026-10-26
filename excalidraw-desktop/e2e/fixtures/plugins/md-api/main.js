import { createElement as h, useState } from "react";

// Plugin API 0.8.0 through one button: parse a note, measure, paginate, and
// import CodeMirror through the lazy shared module.
const NOTE =
  "# Plan\n\nShip the parser #idea and link [[Roadmap|the roadmap]].";

function MarkdownPanel({ ctx }) {
  const [out, setOut] = useState("");
  const run = async () => {
    const doc = await ctx.markdown.parse(NOTE);
    await ctx.fonts.ensure(["Liberation Sans"]);
    const widths = ctx.text.measure({ family: "Liberation Sans", size: 20 }, [
      "ab",
      "abcd",
    ]);
    const page = ctx.pages.geometry({ size: "a4" });
    const placed = ctx.pages.flow([{ height: 600 }, { height: 600 }], {
      contentHeight: page.height - 100,
    });
    const { EditorState } = await import("@codemirror/state");
    const cm = EditorState.create({ doc: NOTE }).doc.lines;
    setOut(
      [
        `blocks: ${doc.blocks.map((b) => b.kind).join(",")}`,
        `tags: ${doc.tags.join(",")}`,
        `link: ${doc.links[0].target}`,
        `wider: ${widths[1] > widths[0]}`,
        `pages: ${placed[placed.length - 1].page + 1}`,
        `codemirror lines: ${cm}`,
      ].join(" | "),
    );
  };
  return h(
    "div",
    { style: { padding: 12 } },
    h(
      "button",
      { onClick: () => run().catch((e) => setOut(`error: ${e}`)) },
      "Parse sample",
    ),
    h("output", { "data-testid": "md-out" }, out),
  );
}

export default {
  activate(ctx) {
    ctx.panels.register("markdown", () => h(MarkdownPanel, { ctx }));
  },
};

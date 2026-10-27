// checklist-view: a view in the main pane.
// A note named like groceries.checklist.md opens in this component instead of the
// Markdown note view. The plugin loads when the first such tab is shown. It reads
// the note through props.file (needs vault.read) and saves a toggled box with the
// revision it read (needs vault.write), so a change made in another program is
// never overwritten: the save is refused and the view reloads.
import { createElement as h, useCallback, useEffect, useState } from "react";
import { definePlugin } from "@vaultdraw/api";

const BOX = /^(\s*[-*]\s+\[)([ xX])(\]\s+.*)$/;

const toggleLine = (line) => {
  const m = BOX.exec(line);
  return m ? `${m[1]}${m[2] === " " ? "x" : " "}${m[3]}` : line;
};

function Checklist({ path, file }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setDoc(await file.read());
      setError(null);
    } catch (err) {
      setError(String(err?.message ?? err));
    }
  }, [file]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return h("p", { role: "alert" }, error);
  }
  if (!doc) {
    return h("p", null, "Loading…");
  }
  const lines = doc.text.split("\n");
  const toggle = async (index) => {
    const next = lines
      .map((l, i) => (i === index ? toggleLine(l) : l))
      .join("\n");
    try {
      setDoc({ text: next, ...(await file.write(next, doc.revision)) });
    } catch (err) {
      // Changed elsewhere (CONFLICT): show the newer text instead of overwriting it.
      await load();
    }
  };
  return h(
    "div",
    { className: "checklist-view", style: { padding: 16 } },
    h(
      "h2",
      null,
      path
        .split("/")
        .pop()
        .replace(/\.checklist\.md$/i, ""),
    ),
    h(
      "ul",
      { style: { listStyle: "none", padding: 0 } },
      lines.flatMap((line, i) => {
        const m = BOX.exec(line);
        if (!m) {
          return [];
        }
        return [
          h(
            "li",
            { key: i },
            h(
              "label",
              null,
              h("input", {
                type: "checkbox",
                checked: m[2] !== " ",
                onChange: () => void toggle(i),
              }),
              " ",
              m[3].replace(/^\]\s+/, ""),
            ),
          ),
        ];
      }),
    ),
  );
}

export default definePlugin({
  activate(ctx) {
    ctx.views.register("checklist", Checklist);
    // Ask the app to open a note in the view, in the main pane (a panel id would open it at the side).
    ctx.commands.register("open", () =>
      ctx.views.open("checklist", { path: ctx.settings.get("list") }),
    );
  },
});

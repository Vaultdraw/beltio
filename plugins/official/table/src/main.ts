/**
 * table: turns pasted tabular text (spreadsheet cells, CSV, a Markdown pipe table) into a grouped
 * set of ordinary Excalidraw elements. Official, bundled. It loads on the first paste of multi-line
 * text (`activation = ["onPaste"]`) or when its command runs, never at launch.
 */
import { definePlugin } from "@vaultdraw/api";

import { layoutTable, MAX_OPS, opCount } from "./layout";
import { parseTable, LIMITS, type ParsedTable } from "./parse";

import type { PluginContext, SceneOp } from "@vaultdraw/api";

const MODES = ["ask", "always", "never"] as const;
type Mode = typeof MODES[number];

const mode = (ctx: PluginContext): Mode => {
  const v = ctx.settings.get<string>("on_paste");
  return (MODES as readonly string[]).includes(v ?? "") ? (v as Mode) : "ask";
};

const TOO_BIG_ROWS = `That table is too big (most ${LIMITS.rows} rows and ${LIMITS.cols} columns)`;
const TOO_BIG_OPS =
  "That table is too big for one drawing step (about 400 filled cells); paste it in parts";

/** Why `table` cannot be inserted (`extra` = elements the same step deletes), or null when it fits. */
function whyNot(table: ParsedTable, extra = 0): string | null {
  if (table.rows.length > LIMITS.rows || table.rows[0].length > LIMITS.cols) {
    return TOO_BIG_ROWS;
  }
  return opCount(table) + extra > MAX_OPS ? TOO_BIG_OPS : null;
}

/** Inserts `table` (top-left at `at`, or centred in view); `drop` ids are deleted in the same undo step. */
async function insert(
  ctx: PluginContext,
  table: ParsedTable,
  at: { x: number; y: number } | null,
  drop: readonly string[] = [],
): Promise<boolean> {
  const why = whyNot(table, drop.length);
  if (why) {
    ctx.ui.toast(why);
    return false;
  }
  const { fontFamily, fontSize } = ctx.scene.currentTextStyle();
  const maxColWidth = Number(ctx.settings.get<number>("max_col_width")) || 260;
  try {
    await ctx.fonts.ensure(
      [fontFamily],
      table.rows.flat().join(" ").slice(0, 20_000),
    );
  } catch {
    // Measuring with the fallback font is only a little off.
  }
  const font = { family: fontFamily, size: fontSize };
  const style = {
    fontFamily,
    fontSize,
    strokeColor: ctx.scene.currentStrokeColor(),
    maxColWidth,
  };
  const measure = {
    widths: (s: readonly string[]) => ctx.text.measure(font, s),
    lineHeight: ctx.text.lineHeight(fontFamily),
  };
  const probe = layoutTable(table, style, measure, 0, 0);
  const c = ctx.scene.viewportCenter();
  const x = at ? at.x : Math.round(c.x - probe.width / 2);
  const y = at ? at.y : Math.round(c.y - probe.height / 2);
  const { ops } = layoutTable(table, style, measure, x, y);
  await ctx.scene.batch([
    ...drop.map((id): SceneOp => ({ op: "delete", id })),
    ...ops,
  ]);
  return true;
}

export default definePlugin({
  activate(ctx) {
    ctx.commands.register("insert-from-clipboard", async () => {
      const table = parseTable(await ctx.clipboard.readText());
      if (!table) {
        ctx.ui.toast(
          "The clipboard text is not a table (tab-separated, CSV or a Markdown pipe table)",
        );
        return;
      }
      await insert(ctx, table, null);
    });

    ctx.clipboard.onPaste(({ text }) => {
      const m = mode(ctx);
      if (m === "never") {
        return "pass";
      }
      const table = parseTable(text);
      if (!table) {
        return "pass";
      }
      if (m === "always") {
        if (whyNot(table)) {
          // Too big to insert: let the editor paste the text instead of swallowing the paste.
          ctx.ui.toast("That table is too big, pasted as text");
          return "pass";
        }
        void insert(ctx, table, null).catch((e) =>
          ctx.log.warn("Inserting the table failed", e),
        );
        return "handled";
      }
      // ask: the editor pastes the text as usual; the toast offers to swap it for a table.
      ctx.setTimeout(() => {
        const pasted = ctx.scene
          .get(ctx.scene.selection())
          .filter((e) => e.type === "text");
        ctx.ui.toast("That looks like a table", {
          action: {
            label: "Insert as table",
            run: () => {
              const live = ctx.scene
                .get(pasted.map((e) => e.id))
                .filter((e) => e.type === "text");
              const at = live.length
                ? {
                    x: Math.min(...live.map((e) => e.x)),
                    y: Math.min(...live.map((e) => e.y)),
                  }
                : null;
              void insert(
                ctx,
                table,
                at,
                live.map((e) => e.id),
              ).catch((e) => ctx.log.warn("Inserting the table failed", e));
            },
          },
        });
      }, 200);
      return "pass";
    });
  },
});

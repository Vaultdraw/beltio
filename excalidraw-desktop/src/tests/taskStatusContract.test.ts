/**
 * Twins (testing.md): which list lines are tasks is decided in three places, the native parser
 * (vaultdraw-core markdown/blocks.rs: import and the plugin API), the reading view
 * (notes/render/obsidian.ts) and ticking (notes/noteTasks.ts). Toimprove 235 fixed one twin after
 * the other drifted; this one case table pins all of them. Rust runs the same rows in
 * `markdown::tests::task_status_contract_table`.
 */
import { describe, expect, it } from "vitest";

import table from "../../src-tauri/crates/vaultdraw-core/src/contract/task_status_cases.json";
import { lexNote } from "../notes/render/obsidian";
import { taskLines } from "../notes/noteTasks";

import type { Tokens } from "marked";

type Row = {
  label: string;
  line: string;
  task: "none" | "open" | "done";
  /** Set while the TypeScript twins disagree with the row (a toimprove entry); flips to a pass when fixed. */
  ts_known?: string;
};

const readingView = (line: string): Row["task"] => {
  const list = lexNote(line).tokens.find((t) => t.type === "list") as
    | Tokens.List
    | undefined;
  const item = list?.items[0];
  if (!item?.task) {
    return "none";
  }
  return item.checked ? "done" : "open";
};

describe("task status contract (one table for the parser, the reading view and ticking)", () => {
  for (const row of table.cases as Row[]) {
    const check = row.ts_known ? it.fails : it;
    check(`reading view: ${row.label}`, () => {
      expect(readingView(row.line)).toBe(row.task);
    });
    check(`ticking finds it: ${row.label}`, () => {
      expect(taskLines(row.line).length).toBe(row.task === "none" ? 0 : 1);
    });
  }
});

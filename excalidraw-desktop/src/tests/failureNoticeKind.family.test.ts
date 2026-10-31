/**
 * Family hunter shell (2026-10-31), from toimprove 304: "a notice that says something failed is an
 * error notice". An info notice leaves after 5 s, looks like good news and ignores the user's
 * "Error notices stay for" setting (BH-5); an error notice follows that setting. A source scan:
 * every `toastStore.push(...)`, `notify(...)` and plugin `ctx.ui.toast(...)` whose message starts
 * with "Could not", "Couldn't", "Cannot", "Failed" or "Unable" must say `kind: "error"` (plugins:
 * `{ kind: "error" }`) in the same call. KNOWN is today's list; the ratchet test fails when it
 * grows, and when a fixed member is still listed. Messages that start otherwise ("Import failed",
 * "Nothing to ...") are not caught by this scan.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const DESKTOP = join(__dirname, "..", "..");
const FAILURE = /^(Could not|Couldn.t|Cannot|Can.t|Failed|Unable)/;
const CALL =
  /(toastStore\.push\(\s*\{|ui\.toast\(|\bnotify\(|pushToast\(|\btoast\()([^;]{0,400}?)(;|\n\s*\n)/gs;

const files = execFileSync("git", ["ls-files", "src", "../plugins/official"], {
  cwd: DESKTOP,
  encoding: "utf8",
})
  .split("\n")
  .filter(
    (f) =>
      /\.tsx?$/.test(f) &&
      !/\.(test|spec)\.|\/tests?\/|\.d\.ts|\/smoke\/|node_modules/.test(f),
  );

const found: string[] = [];
for (const f of files) {
  const text = readFileSync(join(DESKTOP, f), "utf8");
  for (const m of text.matchAll(CALL)) {
    const first = /["`'](.{0,60})/.exec(m[2]);
    if (first && FAILURE.test(first[1]) && !/["']error["']/.test(m[2])) {
      found.push(`${f}:${text.slice(0, m.index).split("\n").length}`);
    }
  }
}

/** File -> how many failure notices in it are not error notices today. */
const KNOWN: Record<string, number> = {
  "src/ai/aiSwitch.ts": 1,
  "src/notes/NoteView.tsx": 4,
  "src/sync/useSyncConflicts.tsx": 3,
  "../plugins/official/ai-assistant/src/session.ts": 1,
  "../plugins/official/favourites/src/main.tsx": 1,
  "../plugins/official/favourites/src/store.ts": 1,
  "../plugins/official/formula/src/main.tsx": 1,
};

const perFile = (list: string[]) =>
  list.reduce<Record<string, number>>((acc, at) => {
    const f = at.replace(/:\d+$/, "");
    acc[f] = (acc[f] ?? 0) + 1;
    return acc;
  }, {});

describe("family (shell hunter): a failure notice is an error notice", () => {
  it("the scan sees the notices (sanity: some are already error notices)", () => {
    expect(files.length).toBeGreaterThan(300);
    expect(
      readFileSync(join(DESKTOP, "src/components/menu/copyPath.ts"), "utf8"),
    ).toContain('kind: "error"');
  });

  it("ratchet: the list of info-kind failure notices is exactly KNOWN (toimprove 323)", () => {
    expect(perFile(found)).toEqual(KNOWN);
  });

  it.fails("no failure notice is an info notice (toimprove 323)", () => {
    expect(found).toEqual([]);
  });
});

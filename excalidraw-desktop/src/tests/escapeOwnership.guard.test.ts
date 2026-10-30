/**
 * Guard (validator, night 2026-10-30, hunter M-6 / toimprove 252): Escape leaves one layer at a
 * time, as in Neovim and Obsidian. An inner handler (a search box, an inline input, a popover) that
 * acts on Escape must mark the key used (`preventDefault`, `stopPropagation`, or a helper that does),
 * or the next owner (the narrow file-list overlay, Settings, the canvas) acts on the same key: one
 * Escape cleared the search box AND closed the file list. Each `Escape` check in the app's source
 * must have such a call within a few lines around it. KNOWN: today's exceptions with a reason;
 * delete a line when the handler marks the key.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const ESCAPE =
  /key\s*(?:===|!==)\s*"Escape"|case\s+"Escape"|chord\s*===\s*"Escape"/;
const MARKS =
  /preventDefault\(|stopPropagation\(|stopImmediatePropagation\(|swallow\(|claim\(/;
const AROUND = 15;

const KNOWN: Record<string, string> = {
  "components/readonly/ReadOnlyBadge.tsx":
    "the read-only popover closes from a document capture listener without marking the key; not seen to close a second layer yet (the overlay checks for an open popup), mark it when 252 is fixed",
};

/** Checked by hand: the key is marked elsewhere, or there is no event. Keep the reason. */
const MARKED_ELSEWHERE: Record<string, string> = {
  "components/settings/SettingsModal.tsx":
    "it reads whether a control inside already marked the key (defaultPrevented) and only then decides to close; the close itself marks the key",
  "components/settings/pages/Hotkeys.tsx":
    "the recorder's capture listener calls preventDefault and stopImmediatePropagation first",
  "components/settings/pages/sequenceRecorder.ts":
    "a pure step function, no event",
  "keys/WhichKey.tsx":
    "a dispatcher key interceptor: returning true marks the key used",
};

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!["tests", "smoke", "node_modules"].includes(name)) {
        walk(p, out);
      }
    } else if (
      /\.(ts|tsx)$/.test(name) &&
      !/\.(test|spec|bench)\.tsx?$/.test(name)
    ) {
      out.push(p);
    }
  }
  return out;
};

const unmarked = walk(SRC).flatMap((file) => {
  const lines = readFileSync(file, "utf8").split("\n");
  const rel = relative(SRC, file).split("\\").join("/");
  return lines.flatMap((line, i) =>
    ESCAPE.test(line) &&
    !MARKS.test(lines.slice(Math.max(0, i - AROUND), i + AROUND).join("\n"))
      ? [`${rel}:${i + 1}`]
      : [],
  );
});
const open = unmarked.filter(
  (at) => !MARKED_ELSEWHERE[at.replace(/:\d+$/, "")],
);
const files = [...new Set(open.map((at) => at.replace(/:\d+$/, "")))];

describe("guard: an Escape handler marks the key used", () => {
  it("no new Escape handler that leaves the key to the next owner", () => {
    expect(open.filter((at) => !KNOWN[at.replace(/:\d+$/, "")])).toEqual([]);
  });
  it("KNOWN lists only files that still have one (delete fixed ones)", () => {
    expect(Object.keys(KNOWN).filter((f) => !files.includes(f))).toEqual([]);
  });
});

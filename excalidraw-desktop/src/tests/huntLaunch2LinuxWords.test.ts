import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Launch hunter 2 (2026-10-31) [launch] [shell], toimprove 287: user text that names a macOS key or
// app is wrong on Linux. A line that picks the word by platform (isMac, detectPlatform) is fine.
const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const ROWS: [file: string, wrong: RegExp][] = [
  ["src/tabs/tabsSettingsSchema.ts", /Cmd\+click does the other one/],
  ["src/commands/commands.ts", /title: "Reveal drawing in Finder"/],
  ["src/VaultApp.tsx", /make it writable in Finder/],
  ["src/vault/readOnlyReason.ts", /permissions in Finder/],
  ["../plugins/official/ai-assistant/src/Panel.tsx", /Undo with Cmd\+Z/],
];

describe("user text does not name macOS keys or apps (toimprove 287)", () => {
  it.fails.each(ROWS)("%s", (file, wrong) => {
    expect(read(file)).not.toMatch(wrong);
  });
});

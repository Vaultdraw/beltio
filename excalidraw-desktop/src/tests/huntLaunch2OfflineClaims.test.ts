import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Launch hunter 2 (2026-10-31) [launch] [shell]: privacy wording must match what the app does.
// Since 2026-10-29 the network is ON by default (update check, theme and plugin lists, web
// pictures) and the AI assistant plugin sends requests the user asks for; "Offline mode" is the
// one switch that makes the app offline. Text that says the AI switch keeps the device "fully
// offline" or that Vaultdraw "makes no network requests" is then wrong.
const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("privacy claims match the network policy (toimprove 286)", () => {
  it.fails(
    "the Control page's AI row does not say Off keeps the device fully offline",
    () => {
      expect(read("src/components/settings/schema.ts")).not.toMatch(
        /Off keeps your device fully offline/,
      );
    },
  );
  it.fails(
    "the AI-on warning does not say Vaultdraw makes no network requests",
    () => {
      expect(read("src/ai/AiWarningDialog.tsx")).not.toMatch(
        /makes no network requests|no longer fully offline/,
      );
    },
  );
  it.fails(
    "docs/configuration.md does not say Vaultdraw is fully offline while AI is off",
    () => {
      expect(read("../docs/configuration.md")).not.toMatch(
        /while it is off Vaultdraw is fully offline/,
      );
    },
  );
});

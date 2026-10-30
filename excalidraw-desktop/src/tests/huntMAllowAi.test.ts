import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Hunter M (2026-10-30 night), toimprove M-19. The app's AI requests obey `network.allow_ai`
 * (`src-tauri/src/plugins/net.rs` PURPOSE "ai" -> `network::check_consent` reads `allow_<purpose>`),
 * and the AI assistant tells the user "AI requests are turned off in Settings (network)" when it is
 * false. But the key is in no Settings page, not in the key reference (`configReference.ts`), and
 * not in docs/configuration.md, unlike its siblings allow_themes / allow_plugins / allow_images /
 * allow_updates. A user who set it (or a synced config) cannot find the switch the message names.
 * Reference: Noctalia and Neovim document every option; Obsidian shows every switch it obeys.
 */
const REPO = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

describe("network.allow_ai is a documented, visible switch (toimprove M-19)", () => {
  it("(context) the native side obeys it and the plugin's message points to Settings", () => {
    expect(read("excalidraw-desktop/src-tauri/src/plugins/net.rs")).toContain(
      'const PURPOSE: &str = "ai";',
    );
    expect(read("plugins/official/ai-assistant/src/errors.ts")).toContain(
      "turned off in Settings",
    );
    // Its siblings are documented.
    expect(read("docs/configuration.md")).toContain("network.allow_plugins");
  });

  it.fails("docs/configuration.md documents network.allow_ai", () => {
    expect(read("docs/configuration.md")).toContain("allow_ai");
  });

  it.fails(
    "the key reference lists it (so Settings and the docs guard know it)",
    () => {
      expect(read("excalidraw-desktop/src/vault/configReference.ts")).toMatch(
        /\ballow_ai\s*:/,
      );
    },
  );
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Hunter M (2026-10-30 night), toimprove M-20. A plugin's secrets (`ctx.secret`, e.g. the AI
 * assistant's API key) live in `<state>/plugin-secrets/<id>.json` (net.rs SECRETS_DIR). Nothing that
 * removes a plugin or its data touches that file:
 * - Settings → Plugins → Delete data runs `plugins_data_delete` → `storage::delete`, which removes
 *   only `<state>/plugin-data/<id>/`;
 * - Uninstall (`install.rs uninstall` / `uninstall_dir`) removes only the plugin folder;
 * - installing different code under the same id forgets its consent (`consent::forget`), not its
 *   secrets.
 * So a key the user saved stays on disk after "Delete data" with no way to see it, and a different
 * plugin installed later under the same id has `net.request({ auth: { secret } })` attach the old
 * key to requests to its own server. Reference: Obsidian keeps a plugin's data (keys included) in
 * its folder, so removing the plugin removes them; Zed's credentials are removed with the provider.
 * Static guard over the Rust sources (no app needed); flip when the paths clear secrets.
 */
const SRC = join(__dirname, "..", "..", "src-tauri", "src", "plugins");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");
const fnBody = (text: string, name: string) => {
  const start = text.indexOf(`fn ${name}(`);
  expect(start, `fn ${name} exists`).toBeGreaterThan(-1);
  const open = text.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    depth += text[i] === "{" ? 1 : text[i] === "}" ? -1 : 0;
    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
};
const touchesSecrets = (body: string) => /secret/i.test(body);

describe("a plugin's secrets go with its data (toimprove M-20)", () => {
  it("(context) secrets live outside the data folder, by plugin id", () => {
    expect(read("net.rs")).toContain(
      'const SECRETS_DIR: &str = "plugin-secrets";',
    );
    expect(fnBody(read("mod.rs"), "plugins_data_delete")).toContain(
      "storage::delete",
    );
    // The precedent: new code under an old id loses its consent record.
    expect(
      fnBody(read("install.rs"), "install_folder_with_fresh_consent"),
    ).toContain("consent::forget");
  });

  it("Delete data also removes the plugin's secrets", () => {
    expect(
      touchesSecrets(fnBody(read("storage.rs"), "delete")) ||
        touchesSecrets(fnBody(read("mod.rs"), "plugins_data_delete")),
    ).toBe(true);
  });

  it("installing different code under an old id forgets its secrets too", () => {
    expect(
      touchesSecrets(
        fnBody(read("install.rs"), "install_folder_with_fresh_consent"),
      ),
    ).toBe(true);
  });
});

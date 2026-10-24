/**
 * D7: official and example plugins use the public API only. Lints fixture
 * sources as if they sat in a plugin folder and checks which imports the
 * ESLint config (.eslintrc.json) rejects.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const eslint = new ESLint({ cwd: root, ignore: false });

const lintAs = async (fixture: string, virtualPath: string) => {
  const toRoot = path.relative(
    path.dirname(path.join(root, virtualPath)),
    root,
  );
  const source = fs
    .readFileSync(path.join(here, "lint-fixtures", fixture), "utf8")
    .replaceAll("@@ROOT@@", toRoot);
  const [res] = await eslint.lintText(source, {
    filePath: path.join(root, virtualPath),
  });
  return res.messages.filter(
    (m) =>
      m.ruleId === "no-restricted-imports" ||
      m.ruleId === "import/no-restricted-paths",
  );
};

describe("public-API lint (D7)", () => {
  it("accepts react, @vaultdraw/api and own-folder files", async () => {
    expect(await lintAs("public-only.js", "sdk/examples/demo/main.js")).toEqual(
      [],
    );
  });

  it("rejects app internals and editor packages in an example plugin", async () => {
    const msgs = await lintAs(
      "internal-import.js",
      "sdk/examples/demo/main.js",
    );
    expect([...new Set(msgs.map((m) => m.line))]).toEqual([2, 3]);
  });

  it.each([
    "plugins/official/mermaid/main.js",
    "excalidraw-desktop/src/extensions/search/main.js",
    "excalidraw-desktop/src/smoke/plugins/demo/main.js",
    "excalidraw-desktop/e2e/fixtures/plugins/demo/main.js",
  ])("applies to %s", async (p) => {
    const msgs = await lintAs("internal-import.js", p);
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("rejects a require() of an internal file", async () => {
    const msgs = await lintAs(
      "require-internal.js",
      "plugins/official/x/main.js",
    );
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("leaves test files and app code alone", async () => {
    expect(
      await lintAs("internal-import.js", "sdk/examples/demo/main.test.ts"),
    ).toEqual([]);
    expect(
      await lintAs("internal-import.js", "excalidraw-desktop/src/foo.ts"),
    ).toEqual([]);
  });
});

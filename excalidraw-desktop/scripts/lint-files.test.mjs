import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { lintableFiles } from "./lint-files.mjs";

// A throwaway folder with its own .eslintignore, so the test does not depend on the repo's ignore list.
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "lint-files-"));
  writeFileSync(path.join(dir, ".eslintignore"), "gen/\n");
  mkdirSync(path.join(dir, "gen"));
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "gen/api.d.ts"), "export {};\n");
  writeFileSync(path.join(dir, "src/app.ts"), "export {};\n");
  return dir;
}

test("files matched by .eslintignore are dropped, the rest kept in order", async () => {
  const dir = fixture();
  try {
    const kept = await lintableFiles(["gen/api.d.ts", "src/app.ts"], dir);
    assert.deepEqual(kept, ["src/app.ts"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("only ignored files gives an empty list; no files gives an empty list", async () => {
  const dir = fixture();
  try {
    assert.deepEqual(await lintableFiles(["gen/api.d.ts"], dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(await lintableFiles([], process.cwd()), []);
});

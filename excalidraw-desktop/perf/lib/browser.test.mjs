import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PERF_PAGE, hasPerfPage } from "./browser.mjs";

test("hasPerfPage: a dist without the perf page needs a build (--no-build in a fresh worktree)", async () => {
  const dist = mkdtempSync(path.join(tmpdir(), "perf-dist-"));
  assert.equal(await hasPerfPage(dist), false);
  assert.equal(await hasPerfPage(path.join(dist, "missing")), false);
  mkdirSync(path.dirname(path.join(dist, PERF_PAGE)), { recursive: true });
  writeFileSync(path.join(dist, PERF_PAGE), "<!doctype html>");
  assert.equal(await hasPerfPage(dist), true);
});

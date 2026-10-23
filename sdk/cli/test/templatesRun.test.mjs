/**
 * Runs the generated test of each TypeScript template with the repo's vitest, against the
 * vendored mock host. The project must live inside the repo so node finds vitest and jsdom.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { run, SDK } from "./helpers.mjs";

const ROOT = path.resolve(SDK, "..");
const VITEST = path.join(ROOT, "node_modules", ".bin", "vitest");
const SCRATCH = path.join(ROOT, ".cache", "template-run");
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

describe.skipIf(!existsSync(VITEST))("template tests on the mock host", () => {
  for (const template of ["command", "panel", "scene"]) {
    it(`${template}: init, then vitest passes`, () => {
      mkdirSync(SCRATCH, { recursive: true });
      const id = `t-${template}`;
      expect(
        run(["init", id, "--template", template, "--dir", SCRATCH]).code,
      ).toBe(0);
      const r = spawnSync(VITEST, ["run", "--maxWorkers=1", "--minWorkers=1"], {
        cwd: path.join(SCRATCH, id),
        encoding: "utf8",
      });
      expect(r.stdout + r.stderr).toMatch(/1 passed/);
      expect(r.status).toBe(0);
    }, 60_000);
  }
});

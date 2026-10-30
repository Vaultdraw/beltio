/**
 * Hunter M (2026-10-30 night), toimprove M-10. A fresh TypeScript template does not type-check:
 * `init` copies `vaultdraw/testing/` and `vaultdraw/shared/`, whose files import types from
 * `../src/index`, a folder `init` does not copy. `tsc -p .` (and every editor's TypeScript
 * server, since tsconfig includes `vaultdraw`) reports 12 errors in code the author never wrote:
 * TS2307 "Cannot find module '../src/index'" plus implicit-any follow-ons. The template's own
 * tsconfig is `strict` with `noEmit`, i.e. it exists to be checked. Reference: Obsidian's sample
 * plugin and Zed's extension template type-check clean straight after scaffolding.
 * The templates test (templatesRun) only runs vitest, which strips types, so it never saw this.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { run, SDK } from "./helpers.mjs";

const ROOT = path.resolve(SDK, "..");
const TSC = path.join(ROOT, "node_modules", ".bin", "tsc");
// Same place as templatesRun.test.mjs (inside the repo so node_modules resolves), own folder.
const SCRATCH = path.join(ROOT, ".template-types-huntm");
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

describe.skipIf(!existsSync(TSC))("fresh templates type-check (toimprove M-10)", () => {
  for (const template of ["command", "panel", "scene"]) {
    it.fails(
      `${template}: init, then tsc -p . has no errors`,
      () => {
        mkdirSync(SCRATCH, { recursive: true });
        const id = `t-${template}`;
        expect(
          run(["init", id, "--template", template, "--dir", SCRATCH]).code,
        ).toBe(0);
        const r = spawnSync(TSC, ["--noEmit", "-p", "."], {
          cwd: path.join(SCRATCH, id),
          encoding: "utf8",
        });
        expect(r.stdout + r.stderr).not.toMatch(/error TS/);
        expect(r.status).toBe(0);
      },
      120_000,
    );
  }
});

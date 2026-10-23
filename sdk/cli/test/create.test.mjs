import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const BIN = path.resolve(
  import.meta.dirname,
  "../../create-vaultdraw-plugin/bin/create.mjs",
);
const dirs = [];
afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop(), { recursive: true, force: true });
  }
});

describe("create-vaultdraw-plugin", () => {
  it("prints usage and exits 2 without an id", () => {
    const r = spawnSync(process.execPath, [BIN], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/Usage: npm create vaultdraw-plugin/);
  });

  it("creates a TypeScript command plugin by default", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "vdcreate-"));
    dirs.push(dir);
    const r = spawnSync(process.execPath, [BIN, "my-plug", "--dir", dir], {
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(existsSync(path.join(dir, "my-plug", "src", "main.ts"))).toBe(true);
    expect(existsSync(path.join(dir, "my-plug", "package.json"))).toBe(true);
  });

  it("passes an explicit template through", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "vdcreate-"));
    dirs.push(dir);
    const r = spawnSync(
      process.execPath,
      [BIN, "my-panel", "--template", "panel", "--dir", dir],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    expect(existsSync(path.join(dir, "my-panel", "src", "main.tsx"))).toBe(
      true,
    );
  });
});

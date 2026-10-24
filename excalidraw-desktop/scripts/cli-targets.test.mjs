import { test } from "node:test";
import assert from "node:assert/strict";

import { cliBinaryName, planCliBuild } from "./cli-targets.mjs";

test("macOS universal builds both slices into one fat sidecar", () => {
  const p = planCliBuild("universal-apple-darwin");
  assert.equal(p.kind, "universal");
  assert.deepEqual(p.slices, ["aarch64-apple-darwin", "x86_64-apple-darwin"]);
  assert.equal(p.fileName, "vaultdraw-universal-apple-darwin");
});

test("Linux triples are one plain build named with the triple", () => {
  for (const t of ["x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu", "x86_64-unknown-linux-musl"]) {
    const p = planCliBuild(t);
    assert.equal(p.kind, "single");
    assert.deepEqual(p.slices, [t]);
    assert.equal(p.fileName, `vaultdraw-${t}`);
    assert.equal(cliBinaryName(t), "vaultdraw-cli");
  }
});

test("Windows keeps the .exe suffix, an unknown triple passes through", () => {
  assert.equal(planCliBuild("x86_64-pc-windows-msvc").fileName, "vaultdraw-x86_64-pc-windows-msvc.exe");
  assert.equal(cliBinaryName("x86_64-pc-windows-msvc"), "vaultdraw-cli.exe");
  assert.equal(planCliBuild("riscv64gc-unknown-linux-gnu").kind, "single");
});

test("an empty triple is refused", () => {
  assert.throws(() => planCliBuild(""));
  assert.throws(() => planCliBuild(undefined));
});

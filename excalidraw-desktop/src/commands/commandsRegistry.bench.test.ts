import { describe, expect, it } from "vitest";

import { allCommands, getCommand } from "./commands";
import { whenHolds } from "./context";

import type { CommandContext } from "./types";

const ctx: CommandContext = {
  vaultOpen: true,
  drawingOpen: true,
  writable: true,
  textEditing: false,
  canvasFocus: true,
  modalOpen: false,
  listFocus: false,
  galleryFocus: false,
  graphFocus: false,
};

const nsPerOp = (fn: () => void, n = 200_000) => {
  for (let i = 0; i < 1000; i++) {
    fn();
  }
  const t = performance.now();
  for (let i = 0; i < n; i++) {
    fn();
  }
  return ((performance.now() - t) * 1e6) / n;
};

// Informational numbers (printed), loose guard only: CI machines vary.
describe("registry micro-benchmark", () => {
  it("allCommands / getCommand / whenHolds stay cheap", () => {
    const all = nsPerOp(() => allCommands({}));
    const get = nsPerOp(() => getCommand("file.save"));
    const when = nsPerOp(() =>
      whenHolds(["drawingOpen", "!textEditing", "!modalOpen"], ctx),
    );
    console.info(
      `allCommands ${all.toFixed(1)} ns, getCommand ${get.toFixed(
        1,
      )} ns, whenHolds ${when.toFixed(1)} ns`,
    );
    expect(all).toBeLessThan(2000);
    expect(get).toBeLessThan(2000);
    expect(when).toBeLessThan(2000);
  });
});

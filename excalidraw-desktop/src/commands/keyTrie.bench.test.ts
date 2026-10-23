import { describe, expect, it } from "vitest";

import { COMMANDS } from "./commands";
import { installCommandDispatcher } from "./dispatcher";
import { chordFromEvent, chordFromEventUncached } from "./keys";
import { buildKeymap } from "./keymap";
import { buildKeyTrie } from "./keyTrie";

import type { CommandContext, CommandDefinition } from "./types";

const ctx: CommandContext = {
  vaultOpen: true,
  drawingOpen: true,
  writable: true,
  textEditing: false,
  canvasFocus: true,
  modalOpen: false,
  listFocus: false,
};
const nsPerOp = (fn: () => void, n = 100_000) => {
  for (let i = 0; i < 1000; i++) {
    fn();
  }
  const t = performance.now();
  for (let i = 0; i < n; i++) {
    fn();
  }
  return ((performance.now() - t) * 1e6) / n;
};
const ms = (fn: () => void, runs = 5) => {
  fn();
  const t = performance.now();
  for (let i = 0; i < runs; i++) {
    fn();
  }
  return (performance.now() - t) / runs;
};
const synthetic = (n: number): CommandDefinition[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `bench.c${i}`,
    title: `c${i}`,
    category: "File",
    keys: {
      default: [
        `<leader> ${"abcdefghij"[i % 10]} ${"klmnopqrst"[(i >> 3) % 10]} F${
          (i % 24) + 1
        }`,
      ],
    },
  }));

// Informational numbers (printed), loose guards only: CI machines vary.
describe("key resolver micro-benchmark", () => {
  it("chordFromEvent memo, trie build, dispatch", () => {
    const e = new KeyboardEvent("keydown", { code: "KeyJ", key: "j" });
    const memo = nsPerOp(() => chordFromEvent(e, "mac"));
    const raw = nsPerOp(() => chordFromEventUncached(e, "mac"));
    const modE = new KeyboardEvent("keydown", {
      code: "KeyS",
      key: "s",
      metaKey: true,
    });
    const memoMod = nsPerOp(() => chordFromEvent(modE, "mac"));
    const rawMod = nsPerOp(() => chordFromEventUncached(modE, "mac"));

    const builtins = ms(() =>
      buildKeyTrie(COMMANDS, {}, { leader: "Space" }, "mac"),
    );
    const many = synthetic(5000);
    const bigBuild = ms(
      () => buildKeyTrie(many, {}, { leader: "Space" }, "mac"),
      3,
    );
    const keymapBuild = ms(() => buildKeymap(COMMANDS, {}, "mac"));

    const seqCommands: CommandDefinition[] = [
      { id: "b.gg", title: "gg", category: "File", keys: { default: ["g g"] } },
      ...COMMANDS,
    ];
    const keymap = buildKeymap(seqCommands, {}, "mac");
    const root = buildKeyTrie(seqCommands, {}, { leader: "Space" }, "mac");
    const handler = () => undefined;
    const run = (seq: typeof root) => {
      const dispose = installCommandDispatcher(window, {
        platform: "mac",
        getKeymap: () => keymap,
        getSeqRoot: () => seq,
        getContext: () => ctx,
        getHandler: () => handler,
      });
      const unbound = new KeyboardEvent("keydown", {
        code: "KeyJ",
        key: "j",
        cancelable: true,
      });
      const bound = new KeyboardEvent("keydown", {
        code: "KeyS",
        key: "s",
        metaKey: true,
        cancelable: true,
      });
      const a = nsPerOp(() => void window.dispatchEvent(unbound), 50_000);
      const b = nsPerOp(() => void window.dispatchEvent(bound), 50_000);
      dispose();
      return [a, b];
    };
    const [unboundNo, boundNo] = run(null);
    const [unboundSeq, boundSeq] = run(root);
    console.info(
      `chordFromEvent memo ${memo.toFixed(0)} ns (uncached ${raw.toFixed(
        0,
      )}), with Mod ${memoMod.toFixed(0)} ns (uncached ${rawMod.toFixed(
        0,
      )})\n` +
        `trie build: built-ins ${builtins.toFixed(
          3,
        )} ms, 5000 bindings ${bigBuild.toFixed(
          1,
        )} ms; keymap build ${keymapBuild.toFixed(3)} ms\n` +
        `dispatch via window.dispatchEvent (includes jsdom cost), unbound/bound ns: no seq ${unboundNo.toFixed(
          0,
        )}/${boundNo.toFixed(0)}, seq root ${unboundSeq.toFixed(
          0,
        )}/${boundSeq.toFixed(0)}`,
    );
    expect(memo).toBeLessThan(2000);
    expect(builtins).toBeLessThan(50);
    expect(bigBuild).toBeLessThan(2000);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { COMMANDS } from "./commands";
import * as context from "./context";
import { installCommandDispatcher } from "./dispatcher";
import {
  getRegisteredHandler,
  registerCommandHandlers,
} from "./handlerRegistry";
import { buildKeymap } from "./keymap";
import { createToolHandlers } from "./toolCommands";

const app = { vaultOpen: true, drawingOpen: true, writable: true };
const LETTERS = "VRDOALPTNEHFKB";

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

let cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.forEach((fn) => fn());
  cleanup = [];
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// Informational numbers (printed), loose guard only: CI machines vary.
describe("tool keys dispatch benchmark", () => {
  it("100 canvas letters with tool commands registered: p95 under 1 ms", () => {
    document.body.innerHTML =
      '<div class="vault-editor"><div id="canvas" tabindex="0"></div></div>';
    const canvas = document.getElementById("canvas") as HTMLElement;
    canvas.focus();
    const activate = vi.fn(() => true);
    cleanup.push(
      registerCommandHandlers(
        createToolHandlers({ activateToolShortcut: activate }),
      ),
    );
    const read = vi.spyOn(context, "readContext");
    const keymap = buildKeymap(COMMANDS, {}, "mac");
    cleanup.push(
      installCommandDispatcher(window, {
        platform: "mac",
        getKeymap: () => keymap,
        getContext: () => context.readContext(document, app),
        getHandler: getRegisteredHandler,
      }),
    );

    const events = Array.from({ length: 100 }, (_, i) => {
      const letter = LETTERS[i % LETTERS.length];
      return new KeyboardEvent("keydown", {
        code: `Key${letter}`,
        key: letter.toLowerCase(),
        bubbles: true,
        cancelable: true,
      });
    });
    // warm up (JIT, chord memo), then measure
    for (let round = 0; round < 5; round++) {
      for (const e of events) {
        canvas.dispatchEvent(
          new KeyboardEvent("keydown", {
            code: e.code,
            key: e.key,
            bubbles: true,
          }),
        );
      }
    }
    activate.mockClear();
    read.mockClear();

    const times: number[] = [];
    for (let round = 0; round < 10; round++) {
      for (const e of events) {
        const ev = new KeyboardEvent("keydown", {
          code: e.code,
          key: e.key,
          bubbles: true,
          cancelable: true,
        });
        const t = performance.now();
        canvas.dispatchEvent(ev);
        times.push(performance.now() - t);
      }
    }
    times.sort((a, b) => a - b);
    const p50 = percentile(times, 0.5);
    const p95 = percentile(times, 0.95);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    console.info(
      `tool keys: ${times.length} hits, p50 ${(p50 * 1000).toFixed(
        1,
      )} us, p95 ${(p95 * 1000).toFixed(1)} us, mean ${(mean * 1000).toFixed(
        1,
      )} us, context reads per key ${(
        read.mock.calls.length / times.length
      ).toFixed(2)}`,
    );
    expect(activate).toHaveBeenCalledTimes(times.length);
    expect(p95).toBeLessThan(1);
  });

  it("unbound letters never read the context", () => {
    document.body.innerHTML =
      '<div class="vault-editor"><div id="canvas" tabindex="0"></div></div>';
    const canvas = document.getElementById("canvas") as HTMLElement;
    canvas.focus();
    const getContext = vi.fn(() => context.readContext(document, app));
    // list.* binds letters too (listFocus only): leave them out so R is unbound.
    const keymap = buildKeymap(
      COMMANDS.filter((c) => !c.id.startsWith("list.")),
      { "tool.rectangle": ["G"] },
      "mac",
    );
    cleanup.push(
      installCommandDispatcher(window, {
        platform: "mac",
        getKeymap: () => keymap,
        getContext,
        getHandler: getRegisteredHandler,
      }),
    );
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyR", key: "r", bubbles: true }),
    );
    expect(getContext).not.toHaveBeenCalled();
  });
});

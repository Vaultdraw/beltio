import { afterEach, describe, expect, it, vi } from "vitest";

import { renderMath, setMathProvider, setMathStarter } from "./mathService";

afterEach(() => {
  setMathStarter(null);
  vi.useRealTimers();
});

describe("renderMath", () => {
  it("returns null with no provider and no starter", async () => {
    expect(await renderMath({ tex: "x" } as never)).toBeNull();
  });

  it("waits for a provider that arrives after the starter, without polling", async () => {
    const result = { ok: true, html: "<b>x</b>" } as never;
    let remove = () => {};
    setMathStarter(async () => {
      setTimeout(() => {
        remove = setMathProvider(async () => result);
      }, 120);
    });
    expect(await renderMath({ tex: "x" } as never)).toBe(result);
    remove();
  });

  it("gives up after 2 s when no provider arrives", async () => {
    vi.useFakeTimers();
    setMathStarter(async () => {});
    const p = renderMath({ tex: "x" } as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toBeNull();
  });
});

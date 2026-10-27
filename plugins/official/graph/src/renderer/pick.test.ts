import { describe, expect, it, vi } from "vitest";

import { fakeCanvas, fakeGl, recordingCtx } from "./fakes";
import { createRenderer } from "./pick";

function host() {
  return { append: vi.fn() } as unknown as HTMLElement;
}

describe("createRenderer", () => {
  it("picks webgl2 on a real GPU string", () => {
    const f = fakeGl("ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro)");
    const canvas = fakeCanvas((t) => (t === "webgl2" ? f.gl : null));
    const r = createRenderer(host(), { createCanvas: () => canvas });
    expect(r.kind).toBe("webgl2");
    // default GPU: no high-performance request (keeps the discrete GPU asleep)
    expect(canvas.getContext).toHaveBeenCalledWith(
      "webgl2",
      expect.not.objectContaining({ powerPreference: expect.anything() }),
    );
  });

  it("falls back to canvas2d on SwiftShader, on a fresh canvas, and releases the GL context", () => {
    const f = fakeGl(
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)",
    );
    const { ctx } = recordingCtx();
    const made: HTMLCanvasElement[] = [];
    const r = createRenderer(host(), {
      createCanvas: () => {
        const c = fakeCanvas((t) =>
          t === "webgl2" ? f.gl : t === "2d" && made.length > 1 ? ctx : null,
        );
        made.push(c);
        return c;
      },
    });
    expect(r.kind).toBe("canvas2d");
    expect(made).toHaveLength(2);
    expect(r.canvas).toBe(made[1]);
    expect(f.lose.loseContext).toHaveBeenCalled();
    expect(made[0].remove).toHaveBeenCalled();
  });

  it("falls back when webgl2 is unavailable or throws", () => {
    const { ctx } = recordingCtx();
    const r = createRenderer(host(), {
      createCanvas: () =>
        fakeCanvas((t) => {
          if (t === "webgl2") {
            throw new Error("nope");
          }
          return ctx;
        }),
    });
    expect(r.kind).toBe("canvas2d");
  });

  it("forceCanvas2d never asks for webgl2", () => {
    const { ctx } = recordingCtx();
    const c = fakeCanvas((t) => (t === "2d" ? ctx : null));
    const r = createRenderer(host(), {
      forceCanvas2d: true,
      createCanvas: () => c,
    });
    expect(r.kind).toBe("canvas2d");
    expect(c.getContext).toHaveBeenCalledTimes(1);
    expect(c.getContext).toHaveBeenCalledWith("2d", expect.anything());
  });
});

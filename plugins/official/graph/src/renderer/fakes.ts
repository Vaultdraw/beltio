/** Test doubles: a recording 2D context, a counting fake GL and fake canvases (jsdom has no GL). */
import { vi } from "vitest";

export function recordingCtx() {
  const calls: Array<[string, ...unknown[]]> = [];
  const target: Record<string, unknown> = { calls };
  const ctx = new Proxy(target, {
    get(t, k: string) {
      if (k in t) {
        return t[k];
      }
      return (...a: unknown[]) => {
        calls.push([k, ...a]);
      };
    },
    set(t, k: string, v) {
      t[k] = v;
      calls.push([`set:${k}`, v]);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

export function fakeGl(renderer = "Apple GPU") {
  const calls: Record<string, unknown[][]> = {};
  const lose = { loseContext: vi.fn() };
  const gl: unknown = new Proxy(
    {},
    {
      get(_t, k: string) {
        if (/^[A-Z][A-Z0-9_]+$/.test(k)) {
          return k.length;
        } // enum stand-ins
        if (k === "getExtension") {
          return (n: string) =>
            n === "WEBGL_debug_renderer_info"
              ? { UNMASKED_RENDERER_WEBGL: 0x9246 }
              : n === "WEBGL_lose_context"
              ? lose
              : null;
        }
        if (k === "getParameter") {
          return () => renderer;
        }
        if (k === "getShaderParameter" || k === "getProgramParameter") {
          return () => true;
        }
        if (k === "getShaderInfoLog") {
          return () => "";
        }
        return (...a: unknown[]) => {
          (calls[k] ??= []).push(a);
          return {};
        };
      },
    },
  );
  return {
    gl: gl as WebGL2RenderingContext,
    calls,
    lose,
    reset: () => Object.keys(calls).forEach((k) => delete calls[k]),
  };
}

export function fakeCanvas(getContext: (type: string) => unknown) {
  const listeners: Record<string, (e: Event) => void> = {};
  const c = {
    width: 0,
    height: 0,
    style: { cssText: "", width: "", height: "" },
    getContext: vi.fn((t: string) => getContext(t)),
    remove: vi.fn(),
    addEventListener: (n: string, f: (e: Event) => void) => (listeners[n] = f),
    removeEventListener: vi.fn(),
    listeners,
  };
  return c as unknown as HTMLCanvasElement & { listeners: typeof listeners };
}

export function sampleGraph(n = 5) {
  const edges = new Uint32Array([0, 1, 1, 2, 2, 3, 3, 4]);
  return {
    n,
    edges,
    radius: new Float32Array(n).fill(4),
    colour: new Uint32Array(n).fill(0xff3366cc),
    flags: new Uint8Array(n),
  };
}

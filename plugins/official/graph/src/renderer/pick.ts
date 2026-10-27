/** Backend selection: WebGL2 unless unavailable or software-rendered (SwiftShader / llvmpipe). */
import { Canvas2DRenderer } from "./canvas2d";
import { isSoftwareRenderer } from "./shared";
import { WebGL2Renderer, unmaskedRenderer } from "./webgl2";

import type { GraphRenderer } from "./types";

export interface CreateRendererOptions {
  /** Tests / settings: skip WebGL entirely. */
  forceCanvas2d?: boolean;
  /** Injectable for tests. */
  createCanvas?: () => HTMLCanvasElement;
}

export type BackendChoice =
  | { backend: "webgl2" }
  | {
      backend: "canvas2d";
      reason: "forced" | "no-webgl2" | "software" | "error";
    };

/** Pure decision from what the probe saw. `rendererInfo` is null when there is no WebGL2 context. */
export function chooseBackend(
  rendererInfo: string | null,
  forceCanvas2d = false,
): BackendChoice {
  if (forceCanvas2d) {
    return { backend: "canvas2d", reason: "forced" };
  }
  if (rendererInfo === null) {
    return { backend: "canvas2d", reason: "no-webgl2" };
  }
  if (isSoftwareRenderer(rendererInfo)) {
    return { backend: "canvas2d", reason: "software" };
  }
  return { backend: "webgl2" };
}

/** Creates the canvas inside `host` and the best renderer for it. */
export function createRenderer(
  host: HTMLElement,
  opts: CreateRendererOptions = {},
): GraphRenderer {
  const make = opts.createCanvas ?? (() => document.createElement("canvas"));
  const fresh = () => {
    const c = make();
    c.style.cssText = "position:absolute;left:0;top:0";
    host.append(c);
    return c;
  };
  const toCanvas2d = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new Error("graph: no canvas 2d context");
    }
    return new Canvas2DRenderer(canvas, ctx);
  };

  if (opts.forceCanvas2d) {
    return toCanvas2d(fresh());
  }
  let canvas = fresh();
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
    }) as WebGL2RenderingContext | null;
  } catch {
    gl = null;
  }
  const info = gl ? unmaskedRenderer(gl) : null;
  if (gl && chooseBackend(info).backend === "webgl2") {
    try {
      return new WebGL2Renderer(canvas, gl);
    } catch {
      // shader compile/link failure: fall through to canvas2d
    }
  }
  // a canvas that held a GL context cannot hand out a 2d one: use a fresh canvas
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  canvas.remove();
  canvas = fresh();
  return toCanvas2d(canvas);
}

/**
 * WebGL2 graph renderer (port of spike R1): instanced SDF node quads and instanced hairline edge
 * quads. Positions live in an RG32F texture (one texSubImage2D per layout tick), per-node
 * visibility/highlight in an RG8 texture (uploaded only when the mask/highlight changes) and the
 * camera is a uniform, so a camera-only draw() is ~25 uniform calls + 2 drawArraysInstanced.
 * Nothing is allocated per frame.
 */
import {
  type ParsedTheme,
  edgeAlpha,
  effectiveDpr,
  parseTheme,
} from "./shared";

import type {
  CameraState,
  GraphData,
  GraphRenderer,
  GraphTheme,
  Highlight,
} from "./types";

const TW = 1024; // texture width in texels (power of two: index -> (i & 1023, i >> 10))

const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D u_pos; uniform sampler2D u_state;
uniform vec3 u_cam; uniform vec2 u_res; uniform float u_dpr; uniform float u_dim;
ivec2 tc(int i){ return ivec2(i & ${TW - 1}, i >> 10); }
vec4 clipOf(vec2 p){ return vec4(p.x/(u_res.x*0.5), -p.y/(u_res.y*0.5), 0., 1.); }
`;

const VS_E = `${HEAD}
layout(location=0) in uvec2 a_e;
uniform int u_hover; uniform float u_alpha; uniform vec4 u_col; uniform vec4 u_colHi;
out vec4 v_c;
void main(){
  int a = int(a_e.x), b = int(a_e.y);
  if (texelFetch(u_state, tc(a), 0).r < 0.5 || texelFetch(u_state, tc(b), 0).r < 0.5) {
    gl_Position = vec4(2., 2., 2., 1.); v_c = vec4(0.); return; }
  vec2 p0 = (texelFetch(u_pos, tc(a), 0).rg - u_cam.xy) * u_cam.z;
  vec2 p1 = (texelFetch(u_pos, tc(b), 0).rg - u_cam.xy) * u_cam.z;
  vec2 d = p1 - p0; float l = length(d);
  vec2 dir = l > 1e-4 ? d / l : vec2(1., 0.);
  bool hi = u_hover >= 0 && (a == u_hover || b == u_hover);
  float hw = 0.5 * (hi ? max(1.5, u_dpr * 1.25) : max(1., u_dpr * 0.75));
  float side = float(gl_VertexID >> 1) * 2. - 1.;
  vec2 p = mix(p0, p1, float(gl_VertexID & 1)) + vec2(-dir.y, dir.x) * side * hw;
  gl_Position = clipOf(p);
  v_c = hi ? u_colHi : vec4(u_col.rgb, u_col.a * u_alpha * u_dim);
}`;
const FS_E = `#version 300 es
precision mediump float; in vec4 v_c; out vec4 o; void main(){ o = v_c; }`;

const VS_N = `${HEAD}
layout(location=0) in float a_r; layout(location=1) in vec4 a_col; layout(location=2) in uint a_f;
out vec2 v_uv; out vec4 v_c; out float v_R; out float v_r; out float v_a; flat out uint v_f;
void main(){
  int i = gl_InstanceID;
  vec2 st = texelFetch(u_state, tc(i), 0).rg;
  if (st.r < 0.5) { gl_Position = vec4(2., 2., 2., 1.); v_c = vec4(0.); return; }
  vec2 w = texelFetch(u_pos, tc(i), 0).rg;
  float r = a_r * clamp(sqrt(u_cam.z / u_dpr), 0.6, 2.5) * u_dpr + 1.;
  float R = (a_f & 2u) != 0u ? r + 4. * u_dpr : r;
  vec2 q = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2. - 1.;
  v_uv = q; v_c = a_col; v_R = R; v_r = r; v_f = a_f; v_a = mix(u_dim, 1., st.g);
  gl_Position = clipOf((w - u_cam.xy) * u_cam.z + q * R);
}`;
const FS_N = `#version 300 es
precision highp float;
in vec2 v_uv; in vec4 v_c; in float v_R; in float v_r; in float v_a; flat in uint v_f;
uniform float u_dpr; uniform vec4 u_accent; out vec4 o;
void main(){
  float d = length(v_uv) * v_R; float fw = max(fwidth(d), 1e-3);
  float disc = 1. - smoothstep(v_r - fw, v_r, d);
  if ((v_f & 1u) != 0u) { float sw = 1.5 * u_dpr; disc *= smoothstep(v_r - sw - fw, v_r - sw, d); }
  float band = 0.;
  if ((v_f & 2u) != 0u) { float r0 = v_r + 1.5 * u_dpr, r1 = v_r + 3. * u_dpr;
    band = (1. - smoothstep(r1 - fw, r1, d)) * smoothstep(r0 - fw, r0, d); }
  o = band > disc ? vec4(u_accent.rgb, band * u_accent.a * v_a) : vec4(v_c.rgb, disc * v_c.a * v_a);
}`;

type GL = WebGL2RenderingContext;

interface Prog {
  p: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

function compile(gl: GL, vs: string, fs: string, names: string[]): Prog {
  const p = gl.createProgram() as WebGLProgram;
  for (const [t, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const sh = gl.createShader(t) as WebGLShader;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) ?? "shader compile failed");
    }
    gl.attachShader(p, sh);
    gl.deleteShader(sh);
  }
  gl.linkProgram(p);
  const u: Prog["u"] = {};
  for (const n of names) {
    u[n] = gl.getUniformLocation(p, n);
  }
  return { p, u };
}

export function unmaskedRenderer(gl: GL): string {
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
}

export class WebGL2Renderer implements GraphRenderer {
  readonly kind = "webgl2" as const;
  readonly rendererInfo: string;

  private readonly pe: Prog;
  private readonly pn: Prog;
  private posTex: WebGLTexture;
  private stateTex: WebGLTexture;
  private vaoE: WebGLVertexArrayObject | null = null;
  private vaoN: WebGLVertexArrayObject | null = null;
  private bufE: WebGLBuffer | null = null;
  private bufN: WebGLBuffer | null = null;

  private n = 0;
  private m = 0;
  private th = 1;
  private state = new Uint8Array(TW * 2);
  private stateDirty = false;
  private lastNeighbours: Uint8Array | null | undefined;
  private cam: CameraState = { x: 0, y: 0, scale: 1 };
  private hovered = -1;
  private dim = 1;
  private theme: ParsedTheme = parseTheme({
    background: "#f7f7fa",
    edge: "#8c99b3",
    edgeHighlight: "#3b5bdb",
    label: "#222233",
    accent: "#e8590c",
  });
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private reqDpr = 1;
  private lost = false;
  private disposed = false;
  private readonly onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };

  constructor(readonly canvas: HTMLCanvasElement, private readonly gl: GL) {
    this.rendererInfo = unmaskedRenderer(gl);
    this.pe = compile(gl, VS_E, FS_E, [
      "u_pos",
      "u_state",
      "u_cam",
      "u_res",
      "u_dpr",
      "u_dim",
      "u_hover",
      "u_alpha",
      "u_col",
      "u_colHi",
    ]);
    this.pn = compile(gl, VS_N, FS_N, [
      "u_pos",
      "u_state",
      "u_cam",
      "u_res",
      "u_dpr",
      "u_dim",
      "u_accent",
    ]);
    this.posTex = this.makeTex(gl.RG32F, 1);
    this.stateTex = this.makeTex(gl.RG8, 1);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    canvas.addEventListener("webglcontextlost", this.onLost);
  }

  private makeTex(internal: number, rows: number): WebGLTexture {
    const { gl } = this;
    const t = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, TW, rows);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  setGraph(data: GraphData): void {
    const { gl } = this;
    this.n = data.n;
    this.m = data.edges.length >> 1;
    this.th = Math.max(1, Math.ceil(data.n / TW));
    // textures are immutable-storage: recreate for the new row count
    gl.deleteTexture(this.posTex);
    gl.deleteTexture(this.stateTex);
    this.posTex = this.makeTex(gl.RG32F, this.th);
    this.stateTex = this.makeTex(gl.RG8, this.th);
    this.state = new Uint8Array(TW * this.th * 2).fill(255);
    this.lastNeighbours = undefined;
    this.hovered = -1;
    this.dim = 1;
    this.stateDirty = true;

    this.freeBuffers();
    // edges: raw (src, dst) u32 pairs
    this.vaoE = gl.createVertexArray();
    gl.bindVertexArray(this.vaoE);
    this.bufE = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufE);
    gl.bufferData(gl.ARRAY_BUFFER, data.edges, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribIPointer(0, 2, gl.UNSIGNED_INT, 0, 0);
    gl.vertexAttribDivisor(0, 1);
    // nodes: interleaved [radius f32, rgba u8x4, flags u32], index = gl_InstanceID
    this.vaoN = gl.createVertexArray();
    gl.bindVertexArray(this.vaoN);
    const buf = new ArrayBuffer(data.n * 12);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    for (let i = 0; i < data.n; i++) {
      f[3 * i] = data.radius[i];
      u[3 * i + 1] = data.colour[i];
      u[3 * i + 2] = data.flags ? data.flags[i] : 0;
    }
    this.bufN = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufN);
    gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 12, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, 12, 4);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribIPointer(2, 1, gl.UNSIGNED_INT, 12, 8);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    this.applyDpr();
  }

  setPositions(p: Float32Array): void {
    const { gl, n } = this;
    if (n === 0 || this.lost) {
      return;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.posTex);
    const full = (n / TW) | 0;
    if (full > 0) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TW, full, gl.RG, gl.FLOAT, p, 0);
    }
    const rem = n - full * TW;
    if (rem > 0) {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        full,
        rem,
        1,
        gl.RG,
        gl.FLOAT,
        p,
        full * TW * 2,
      );
    }
  }

  setCamera(c: CameraState): void {
    this.cam.x = c.x;
    this.cam.y = c.y;
    this.cam.scale = c.scale;
  }

  /**
   * The neighbour mask is re-uploaded when the array reference or the hovered node changes; the
   * hover fade (only `dimAlpha` moving) is then a single uniform. Pass a new array per hover.
   */
  setHighlight(h: Highlight): void {
    this.dim = h.neighbours ? clamp01(h.dimAlpha) : 1;
    if (h.neighbours !== this.lastNeighbours || h.hovered !== this.hovered) {
      this.lastNeighbours = h.neighbours;
      const s = this.state;
      const nb = h.neighbours;
      for (let i = 0; i < this.n; i++) {
        s[2 * i + 1] = nb ? (nb[i] ? 255 : 0) : 255;
      }
      this.stateDirty = true;
    }
    this.hovered = h.hovered;
  }

  setMask(mask: Uint8Array | null): void {
    const s = this.state;
    for (let i = 0; i < this.n; i++) {
      s[2 * i] = mask && mask[i] ? 0 : 255;
    }
    this.stateDirty = true;
  }

  setTheme(t: GraphTheme): void {
    this.theme = parseTheme(t);
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.reqDpr = dpr;
    this.applyDpr();
  }

  private applyDpr(): void {
    this.dpr = effectiveDpr(this.reqDpr, this.n);
    const w = Math.max(1, Math.round(this.cssW * this.dpr));
    const h = Math.max(1, Math.round(this.cssH * this.dpr));
    if (this.canvas.width !== w) {
      this.canvas.width = w;
    }
    if (this.canvas.height !== h) {
      this.canvas.height = h;
    }
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    this.gl.viewport(0, 0, w, h);
  }

  draw(): void {
    const { gl, theme: t } = this;
    if (this.lost || this.disposed) {
      return;
    }
    gl.clearColor(...t.background);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.n === 0) {
      return;
    }
    if (this.stateDirty) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        TW,
        this.th,
        gl.RG,
        gl.UNSIGNED_BYTE,
        this.state,
      );
      this.stateDirty = false;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.posTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex);

    const cz = this.cam.scale * this.dpr;
    const rw = this.canvas.width;
    const rh = this.canvas.height;
    const common = (p: Prog) => {
      gl.useProgram(p.p);
      gl.uniform1i(p.u.u_pos, 0);
      gl.uniform1i(p.u.u_state, 1);
      gl.uniform3f(p.u.u_cam, this.cam.x, this.cam.y, cz);
      gl.uniform2f(p.u.u_res, rw, rh);
      gl.uniform1f(p.u.u_dpr, this.dpr);
      gl.uniform1f(p.u.u_dim, this.dim);
    };
    if (this.m > 0) {
      const e = this.pe;
      common(e);
      gl.uniform1i(e.u.u_hover, this.hovered);
      gl.uniform1f(e.u.u_alpha, edgeAlpha(this.cam.scale, this.m));
      gl.uniform4f(e.u.u_col, ...t.edge);
      gl.uniform4f(e.u.u_colHi, ...t.edgeHighlight);
      gl.bindVertexArray(this.vaoE);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.m);
    }
    const nn = this.pn;
    common(nn);
    gl.uniform4f(nn.u.u_accent, ...t.accent);
    gl.bindVertexArray(this.vaoN);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.n);
  }

  private freeBuffers(): void {
    const { gl } = this;
    if (this.vaoE) {
      gl.deleteVertexArray(this.vaoE);
    }
    if (this.vaoN) {
      gl.deleteVertexArray(this.vaoN);
    }
    if (this.bufE) {
      gl.deleteBuffer(this.bufE);
    }
    if (this.bufN) {
      gl.deleteBuffer(this.bufN);
    }
    this.vaoE = this.vaoN = this.bufE = this.bufN = null;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const { gl } = this;
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.freeBuffers();
    gl.deleteTexture(this.posTex);
    gl.deleteTexture(this.stateTex);
    gl.deleteProgram(this.pe.p);
    gl.deleteProgram(this.pn.p);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    // Free the drawing buffer now; a removed canvas can otherwise linger until GC.
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.canvas.remove();
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Backend-neutral graph renderer API. All inputs are raw typed arrays. */

/** World coordinate at the viewport centre plus zoom (CSS px per world unit). */
export interface CameraState {
  x: number;
  y: number;
  scale: number;
}

export interface GraphData {
  /** Node count. */
  n: number;
  /** `(src, dst)` node index pairs, length 2m. */
  edges: Uint32Array;
  /** Base radius per node in CSS px at scale 1 (e.g. `3 + 1.5 * sqrt(degree)`). */
  radius: Float32Array;
  /** RGBA8 per node, little-endian packed (`r | g << 8 | b << 16 | a << 24`, see `packRgba`). */
  colour: Uint32Array;
  /** Optional per-node flags (`NODE_HOLLOW`, `NODE_RING`). */
  flags?: Uint8Array | null;
}

export const NODE_HOLLOW = 1; // unresolved link target: outline only
export const NODE_RING = 2; // the current drawing: accent ring

export interface Highlight {
  /** Hovered node, or -1 for none. */
  hovered: number;
  /** 1 = keep bright (hovered + neighbours), 0 = dim. Null = nothing dimmed. */
  neighbours: Uint8Array | null;
  /** Alpha of dimmed nodes/edges, 0..1 (animate it for the hover fade: it is one uniform). */
  dimAlpha: number;
}

/** CSS colour strings (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`). */
export interface GraphTheme {
  background: string;
  edge: string;
  edgeHighlight: string;
  label: string;
  /** Ring around the current drawing's node. */
  accent: string;
}

export interface GraphRenderer {
  readonly kind: "webgl2" | "canvas2d";
  /** UNMASKED_RENDERER string for webgl2, "canvas2d" otherwise. */
  readonly rendererInfo: string;
  readonly canvas: HTMLCanvasElement;
  setGraph(data: GraphData): void;
  /** Float32Array(2n). Read synchronously (uploaded or copied); the caller may reuse it afterwards. */
  setPositions(positions: Float32Array): void;
  setCamera(camera: CameraState): void;
  setHighlight(h: Highlight): void;
  /** 1 = hidden. Hidden nodes and their edges are not drawn. Null shows all. */
  setMask(mask: Uint8Array | null): void;
  setTheme(theme: GraphTheme): void;
  draw(): void;
  resize(cssW: number, cssH: number, dpr: number): void;
  /** Frees GL resources and loses the context (webgl2). */
  dispose(): void;
}

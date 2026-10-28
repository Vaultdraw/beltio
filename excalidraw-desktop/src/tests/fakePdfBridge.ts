/** In-memory PdfBridge for vitest and the e2e harness. */
/** Page size in PDF points. */
export type PdfPageInfo = { widthPt: number; heightPt: number };

/** What the native `pdf_*` calls return for an open document. */
export type PdfInfo = {
  token: number;
  name: string;
  pageCount: number;
  pages: PdfPageInfo[];
  byteSize: number;
  locked?: boolean;
};

export type PdfImageFormat = "jpeg" | "png";

export type PdfRenderOptions = {
  maxSide: number;
  format: PdfImageFormat;
  quality: number;
};

export type FakePdfDoc = { name: string; pages: PdfPageInfo[] };

export type FakePdfBridgeOptions = {
  /** Page sizes (pt) of docs created by openBytes / the default nextPick. */
  pages?: PdfPageInfo[];
  /** Per-page render delay in ms. */
  delayMs?: number;
  /** 0-based page indices whose render fails with PDF_PAGE_FAILED. */
  failPages?: number[];
  /** Error code thrown by open/pick (e.g. PDF_ENCRYPTED). */
  openError?: string;
  /** Opened docs come back `locked` until `unlock` gets this password. */
  password?: string;
  /** jsdom fallback: encoded bytes per pixel (default 0.01). */
  bytesPerPx?: number;
  /** Lines of body text per page (perf: realistic encoded sizes). Default 0. */
  textLines?: number;
};

export const A4_PT: PdfPageInfo = { widthPt: 595, heightPt: 842 };

export const makePages = (n: number, page: PdfPageInfo = A4_PT) =>
  Array.from({ length: n }, () => ({ ...page }));

const codeError = (code: string) =>
  Object.assign(new Error(`fake pdf error ${code}`), { code });

const hasCanvas = () => {
  try {
    const c = document.createElement("canvas");
    return typeof c.toBlob === "function" && c.getContext("2d") !== null;
  } catch {
    return false;
  }
};

export class FakePdfBridge {
  /** Result of the next pick(): a doc, or null for "cancelled". */
  nextPick: PdfInfo | null = null;
  delayMs: number;
  failPages: Set<number>;
  openError: string | null;
  /** Non-null: new docs are locked until unlocked with this password. */
  password: string | null;
  /** Passwords `unlock` was called with (tests; the real bridge never keeps them). */
  readonly unlockAttempts: string[] = [];
  defaultPages: PdfPageInfo[];
  bytesPerPx: number;
  textLines: number;
  /** Replaces the drawn page with these bytes (tests). */
  renderBytes?: (index: number, opts: PdfRenderOptions) => Uint8Array;

  readonly renders: {
    token: number;
    index: number;
    opts: PdfRenderOptions;
  }[] = [];
  readonly closes: number[] = [];
  readonly opened: number[] = [];
  /** File name by document token. */
  readonly names = new Map<number, string>();

  private nextToken = 1;
  private docs = new Map<number, PdfInfo>();
  private locked = new Set<number>();

  constructor(options: FakePdfBridgeOptions = {}) {
    this.defaultPages = options.pages ?? makePages(3);
    this.delayMs = options.delayMs ?? 0;
    this.failPages = new Set(options.failPages ?? []);
    this.openError = options.openError ?? null;
    this.password = options.password ?? null;
    this.bytesPerPx = options.bytesPerPx ?? 0.01;
    this.textLines = options.textLines ?? 0;
  }

  /** Registers a doc and returns its info (usable as nextPick). */
  makeDoc(name: string, pages: PdfPageInfo[] = this.defaultPages): PdfInfo {
    const info: PdfInfo = {
      token: this.nextToken++,
      name,
      pageCount: pages.length,
      pages,
      byteSize: pages.length * 50_000,
    };
    this.docs.set(info.token, info);
    this.names.set(info.token, name);
    this.opened.push(info.token);
    return this.password === null ? info : this.lock(info);
  }

  private lock(info: PdfInfo): PdfInfo {
    this.locked.add(info.token);
    return { ...info, pageCount: 0, pages: [], locked: true };
  }

  unlock = async (token: number, password: string): Promise<PdfInfo> => {
    this.unlockAttempts.push(password);
    const doc = this.docs.get(token);
    if (!doc || this.closes.includes(token)) {
      throw codeError("PDF_BAD_TOKEN");
    }
    if (this.locked.has(token) && password !== this.password) {
      throw codeError("PDF_BAD_PASSWORD");
    }
    this.locked.delete(token);
    return doc;
  };

  pick = async (): Promise<PdfInfo | null> => {
    if (this.openError) {
      throw codeError(this.openError);
    }
    const next = this.nextPick;
    this.nextPick = null;
    if (!next) {
      return null;
    }
    if (next.locked) {
      return next; // makeDoc already registered and locked it
    }
    this.docs.set(next.token, next);
    this.opened.push(next.token);
    return this.password === null ? next : this.lock(next);
  };

  openBytes = async (name: string, _bytes: Uint8Array): Promise<PdfInfo> => {
    if (this.openError) {
      throw codeError(this.openError);
    }
    return this.makeDoc(name);
  };

  renderPage = async (
    token: number,
    index: number,
    opts: PdfRenderOptions,
  ): Promise<Uint8Array> => {
    this.renders.push({ token, index, opts });
    const doc = this.docs.get(token);
    if (!doc || this.closes.includes(token)) {
      throw codeError("PDF_BAD_TOKEN");
    }
    if (this.locked.has(token)) {
      throw codeError("PDF_ENCRYPTED");
    }
    if (this.delayMs) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }
    if (this.failPages.has(index)) {
      throw codeError("PDF_PAGE_FAILED");
    }
    if (this.renderBytes) {
      return this.renderBytes(index, opts);
    }
    const page = doc.pages[index];
    const long = Math.max(page.widthPt, page.heightPt);
    const w = Math.max(1, Math.round((page.widthPt / long) * opts.maxSide));
    const h = Math.max(1, Math.round((page.heightPt / long) * opts.maxSide));
    const bytes = hasCanvas()
      ? await drawPage(
          w,
          h,
          index + 1,
          opts.format,
          opts.quality,
          this.textLines,
        )
      : fallbackBytes(w, h, index, opts.format, this.bytesPerPx);
    return withMagic(bytes, opts.format);
  };

  close = async (token: number): Promise<void> => {
    this.closes.push(token);
  };
}

const drawPage = (
  w: number,
  h: number,
  label: number,
  format: PdfImageFormat,
  quality: number,
  textLines: number,
): Promise<Uint8Array> => {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#000";
  ctx.font = `${Math.round(h / 4)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(String(label), w / 2, h / 2);
  // Dense body text like a real page (9 pt lines on A4, as the Rust bench).
  const lineH = h / 76;
  ctx.font = `${Math.round(lineH * 0.8)}px serif`;
  ctx.textAlign = "left";
  for (let i = 0; i < textLines; i++) {
    ctx.fillText(
      `Page ${label} line ${i}: the quick brown fox jumps over the lazy dog 0123456789`,
      w * 0.08,
      lineH * (3 + i),
    );
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      async (blob) =>
        blob
          ? resolve(new Uint8Array(await blob.arrayBuffer()))
          : reject(new Error("toBlob failed")),
      format === "png" ? "image/png" : "image/jpeg",
      quality,
    ),
  );
};

/** Canvas mocks return blank bytes: stamp the format's magic so mime sniffing works. */
const withMagic = (bytes: Uint8Array, format: PdfImageFormat): Uint8Array => {
  const magic =
    format === "png"
      ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      : [0xff, 0xd8, 0xff];
  if (bytes.length >= magic.length && !magic.every((b, i) => bytes[i] === b)) {
    bytes.set(magic);
  }
  return bytes;
};

/** jsdom: deterministic bytes whose length scales with the pixel count. */
const fallbackBytes = (
  w: number,
  h: number,
  index: number,
  format: PdfImageFormat,
  bytesPerPx: number,
): Uint8Array => {
  const length = Math.max(16, Math.floor(w * h * bytesPerPx));
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = (i * 31 + index * 7 + w) & 0xff;
  }
  return withMagic(bytes, format);
};

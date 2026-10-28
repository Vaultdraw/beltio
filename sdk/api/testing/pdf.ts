/**
 * `ctx.pdf` of the mock host: documents made up from page sizes, a render that returns a small
 * fixed picture, the permission `pdf` checked first, and the same error codes as the app.
 */
import { PluginApiError } from "../shared/rules";
import { requirePermission } from "../shared/vaultPaths";

import type {
  PdfApi,
  PdfDocument,
  PdfImportSettings,
  PdfPageSize,
  PdfRenderOptions,
} from "@vaultdraw/api";
import type { FakePdf } from "./types";

/** A 1x1 PNG: what `render` returns unless a test sets `renderBytes`. */
const PIXEL = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

export const DEFAULT_PDF_SETTINGS: PdfImportSettings = {
  maxSide: 1440,
  format: "jpeg",
  quality: 0.85,
  lockPages: true,
  warnPages: 50,
  pixelBudgetMp: 60,
};

export const A4: PdfPageSize = { widthPt: 595, heightPt: 842 };

export function createPdfModel(): {
  fake: FakePdf;
  api(pluginId: string, permissions: readonly string[]): PdfApi;
  reset(): void;
} {
  const fresh = (): FakePdf => ({
    nextPick: null,
    password: null,
    openError: null,
    renderBytes: () => PIXEL,
    failPages: new Set(),
    setSettings: (patch) => {
      Object.assign(settings, patch);
    },
    renders: [],
    opened: [],
    closed: [],
  });
  const settings: PdfImportSettings = { ...DEFAULT_PDF_SETTINGS };
  const fake = fresh();
  let token = 0;
  const code = (c: string) => new PluginApiError(c, `fake pdf error ${c}`);

  const document = (
    id: number,
    name: string,
    pages: readonly PdfPageSize[],
    locked: boolean,
  ): PdfDocument => ({
    name,
    pageCount: locked ? 0 : pages.length,
    pages: locked ? [] : pages,
    byteSize: 1000,
    locked,
    async render(index: number, options: PdfRenderOptions) {
      if (fake.closed.includes(id)) {
        throw code("PDF_BAD_TOKEN");
      }
      if (fake.failPages.has(index)) {
        throw code("PDF_PAGE_FAILED");
      }
      fake.renders.push({ name, index, options });
      return fake.renderBytes(index, options);
    },
    async unlock(password: string) {
      if (password !== fake.password) {
        throw code("PDF_BAD_PASSWORD");
      }
      return document(id, name, pages, false);
    },
    async close() {
      if (!fake.closed.includes(id)) {
        fake.closed.push(id);
      }
    },
  });

  const open = (name: string, pages: readonly PdfPageSize[]) => {
    if (fake.openError) {
      throw code(fake.openError);
    }
    const id = ++token;
    fake.opened.push(name);
    return document(id, name, pages, fake.password !== null);
  };

  return {
    fake,
    api: (pluginId, permissions) => ({
      async pick() {
        requirePermission(pluginId, permissions, "pdf.pick", "pdf");
        const next = fake.nextPick;
        fake.nextPick = null;
        return next ? open(next.name, next.pages) : null;
      },
      async open(name, bytes) {
        requirePermission(pluginId, permissions, "pdf.open", "pdf");
        if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
          throw new PluginApiError(
            "INVALID_ARGUMENT",
            "bytes must be a non-empty Uint8Array",
          );
        }
        return open(name, fake.nextPick?.pages ?? [A4]);
      },
      settings: () => ({ ...settings }),
    }),
    reset() {
      Object.assign(fake, fresh());
      Object.assign(settings, DEFAULT_PDF_SETTINGS);
      token = 0;
    },
  };
}

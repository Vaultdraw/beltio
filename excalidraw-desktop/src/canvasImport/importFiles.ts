/**
 * "Import file…" (canvas right-click, palette): which picked files go where.
 * PDFs go to the PDF import flow (page-range dialog), images are inserted like
 * a drop. Pure, so the routing is unit-tested without a picker or an editor.
 */
import { IMAGE_MIME_TYPES } from "@excalidraw/common";

import {
  findImporter,
  importerExtensions,
  type ImportItem,
} from "../plugins/importerMap";

const PDF_MIME = "application/pdf";

export const isPdfFile = (file: File) =>
  file.type === PDF_MIME || /\.pdf$/i.test(file.name);

const IMAGE_TYPES = new Set<string>(Object.values(IMAGE_MIME_TYPES));

export const isImportableImage = (file: File) => IMAGE_TYPES.has(file.type);

const BASE_ACCEPT = [
  PDF_MIME,
  ".pdf",
  ...Object.values(IMAGE_MIME_TYPES),
  ...Object.keys(IMAGE_MIME_TYPES).map((ext) => `.${ext}`),
];

/** The picker's `accept` without plugins: PDF plus every image type the editor inserts. */
export const IMPORT_ACCEPT = BASE_ACCEPT.join(",");

/** The picker's `accept` now: adds the extensions plugins import (read at call time). */
export const importAccept = (): string =>
  [...BASE_ACCEPT, ...importerExtensions().map((e) => `.${e}`)].join(",");

export interface ImportPlan {
  /** The first PDF (the dialog imports one document at a time). */
  pdf: File | null;
  /** Files a plugin imports (checked after PDF, before images). */
  plugin: ImportItem[];
  images: File[];
  /** Everything else, including further PDFs. */
  skipped: File[];
}

export const planImport = (files: readonly File[]): ImportPlan => {
  const plan: ImportPlan = {
    pdf: null,
    plugin: [],
    images: [],
    skipped: [],
  };
  for (const file of files) {
    if (isPdfFile(file)) {
      if (plan.pdf) {
        plan.skipped.push(file);
      } else {
        plan.pdf = file;
      }
      continue;
    }
    const match = findImporter(file.name);
    if (match) {
      plan.plugin.push({ file, match });
    } else if (isImportableImage(file)) {
      plan.images.push(file);
    } else {
      plan.skipped.push(file);
    }
  }
  return plan;
};

export const skippedMessage = (skipped: readonly File[]): string | null => {
  if (!skipped.length) {
    return null;
  }
  const names = skipped.map((f) => f.name).join(", ");
  const titles = [
    ...new Set(
      importerExtensions()
        .map((ext) => findImporter(`x.${ext}`)?.title)
        .filter((t): t is string => !!t),
    ),
  ];
  const plugins = titles.length
    ? `, and ${titles.join(", ")} files from plugins`
    : "";
  return `Not imported: ${names}. Vaultdraw imports one PDF at a time and PNG, JPEG, SVG, GIF or WebP images${plugins}.`;
};

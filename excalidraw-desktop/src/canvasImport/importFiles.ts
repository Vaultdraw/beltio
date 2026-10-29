/**
 * "Import file…" (canvas right-click, palette): which picked files go where.
 * Files a plugin imports (PDF, Markdown, …) go to it, images are inserted like
 * a drop. Pure, so the routing is unit-tested without a picker or an editor.
 */
import { IMAGE_MIME_TYPES } from "@excalidraw/common";

import {
  findImporter,
  importerExtensions,
  type ImportItem,
} from "../plugins/importerMap";

const IMAGE_TYPES = new Set<string>(Object.values(IMAGE_MIME_TYPES));

/** Extension to image type; WebKit leaves `file.type` empty for some (BMP, ICO, AVIF, JFIF). */
const EXT_TYPES: Record<string, string> = {
  ...IMAGE_MIME_TYPES,
  jpeg: IMAGE_MIME_TYPES.jpg,
  jpe: IMAGE_MIME_TYPES.jpg,
  jfif: IMAGE_MIME_TYPES.jpg,
  ico: IMAGE_MIME_TYPES.ico,
};

/** The image type of a file: its own type, or the one its extension names ("" = not an image). */
export const imageTypeOf = (file: File): string => {
  if (IMAGE_TYPES.has(file.type)) {
    return file.type;
  }
  const dot = file.name.lastIndexOf(".");
  return dot < 0 ? "" : EXT_TYPES[file.name.slice(dot + 1).toLowerCase()] ?? "";
};

export const isImportableImage = (file: File) => imageTypeOf(file) !== "";

/** The file with its real type filled in, so the editor accepts it. */
const withImageType = (file: File): File => {
  const type = imageTypeOf(file);
  return type === file.type
    ? file
    : new File([file], file.name, { type, lastModified: file.lastModified });
};

const BASE_ACCEPT = [
  ...Object.values(IMAGE_MIME_TYPES),
  ...Object.keys(IMAGE_MIME_TYPES).map((ext) => `.${ext}`),
];

/** The picker's `accept` without plugins: every image type the editor inserts. */
export const IMPORT_ACCEPT = BASE_ACCEPT.join(",");

/** The picker's `accept` now: adds the extensions plugins import (read at call time). */
export const importAccept = (): string =>
  [...BASE_ACCEPT, ...importerExtensions().map((e) => `.${e}`)].join(",");

export interface ImportPlan {
  /** Files a plugin imports (checked before images). */
  plugin: ImportItem[];
  images: File[];
  /** Everything else. */
  skipped: File[];
}

export const planImport = (files: readonly File[]): ImportPlan => {
  const plan: ImportPlan = {
    plugin: [],
    images: [],
    skipped: [],
  };
  for (const file of files) {
    const match = findImporter(file.name);
    if (match) {
      plan.plugin.push({ file, match });
    } else if (isImportableImage(file)) {
      plan.images.push(withImageType(file));
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
  return `Not imported: ${names}. Vaultdraw imports PNG, JPEG, SVG, GIF, WebP, BMP, ICO or AVIF images${plugins}.`;
};

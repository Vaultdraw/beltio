// -----------------------------------------------------------------------------
// ExcalidrawImageElement & related helpers
// -----------------------------------------------------------------------------

import { MIME_TYPES, SVG_NS } from "@excalidraw/common";

import type {
  AppClassProperties,
  DataURL,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";

import { isInitializedImageElement } from "./typeChecks";

import type {
  ExcalidrawElement,
  FileId,
  InitializedExcalidrawImageElement,
} from "./types";

export const loadHTMLImageElement = (dataURL: DataURL) => {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve(image);
    };
    image.onerror = (error) => {
      reject(error);
    };
    image.src = dataURL;
  });
};

/** NOTE: updates cache even if already populated with given image. Thus,
 * you should filter out the images upstream if you want to optimize this. */
export const updateImageCache = async ({
  fileIds,
  files,
  imageCache,
}: {
  fileIds: FileId[];
  files: BinaryFiles;
  imageCache: AppClassProperties["imageCache"];
}) => {
  const updatedFiles = new Map<FileId, true>();
  const erroredFiles = new Map<FileId, true>();

  await Promise.all(
    fileIds.reduce((promises, fileId) => {
      const fileData = files[fileId as string];
      if (fileData && !updatedFiles.has(fileId)) {
        updatedFiles.set(fileId, true);
        return promises.concat(
          (async () => {
            try {
              if (fileData.mimeType === MIME_TYPES.binary) {
                throw new Error("Only images can be added to ImageCache");
              }

              const imagePromise = loadHTMLImageElement(fileData.dataURL);
              const data = {
                image: imagePromise,
                mimeType: fileData.mimeType,
              } as const;
              // store the promise immediately to indicate there's an in-progress
              // initialization
              imageCache.set(fileId, data);

              const image = await imagePromise;

              imageCache.set(fileId, { ...data, image });
            } catch (error: any) {
              erroredFiles.set(fileId, true);
            }
          })(),
        );
      }
      return promises;
    }, [] as Promise<any>[]),
  );

  return {
    imageCache,
    /** includes errored files because they cache was updated nonetheless */
    updatedFiles,
    /** files that failed when creating HTMLImageElement */
    erroredFiles,
  };
};

export const getInitializedImageElements = (
  elements: readonly ExcalidrawElement[],
) =>
  elements.filter((element) =>
    isInitializedImageElement(element),
  ) as InitializedExcalidrawImageElement[];

export const isHTMLSVGElement = (node: Node | null): node is SVGElement => {
  // lower-casing due to XML/HTML convention differences
  // https://johnresig.com/blog/nodename-case-sensitivity
  return node?.nodeName.toLowerCase() === "svg";
};

export const normalizeSVG = (SVGString: string) => {
  const doc = new DOMParser().parseFromString(SVGString, MIME_TYPES.svg);
  const svg = doc.querySelector("svg");
  const errorNode = doc.querySelector("parsererror");
  if (errorNode || !isHTMLSVGElement(svg)) {
    throw new Error("Invalid SVG");
  } else {
    if (!svg.hasAttribute("xmlns")) {
      svg.setAttribute("xmlns", SVG_NS);
    }

    let width = svg.getAttribute("width");
    let height = svg.getAttribute("height");

    // Do not use % or auto values for width/height
    // to avoid scaling issues when rendering at different sizes/zoom levels
    if (width?.includes("%") || width === "auto") {
      width = null;
    }
    if (height?.includes("%") || height === "auto") {
      height = null;
    }

    const viewBox = svg.getAttribute("viewBox");

    if (!width || !height) {
      width = width || "50";
      height = height || "50";

      if (viewBox) {
        const match = viewBox.match(
          /\d+ +\d+ +(\d+(?:\.\d+)?) +(\d+(?:\.\d+)?)/,
        );
        if (match) {
          [, width, height] = match;
        }
      }

      svg.setAttribute("width", width);
      svg.setAttribute("height", height);
    }

    // Make sure viewBox is set
    if (!viewBox) {
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    }

    return svg.outerHTML;
  }
};

/** Below this many cached images, pruning is skipped entirely. */
export const IMAGE_CACHE_PRUNE_MIN_ENTRIES = 8;
/** An entry must stay unreferenced for this long before it is dropped. */
export const IMAGE_CACHE_PRUNE_GRACE_MS = 2000;

/**
 * Drops cache entries whose fileId is referenced by no non-deleted image
 * element (and not in `keep`). Entries missing from the scene are only
 * removed once they have been unreferenced for `graceMs`, which covers
 * insert/paste/crop flows that read the cache for an element not yet in the
 * scene. Dropped entries self-heal: the editor re-decodes any visible image
 * element without an entry (e.g. after undo restores it).
 * `unreferencedSince` is caller-owned state between calls. With `graceMs: 0`
 * every unreferenced entry goes at once (a host swapping the whole scene).
 * @returns how many entries were removed and how many are still on probation
 */
export const pruneImageCache = ({
  cache,
  elements,
  unreferencedSince,
  now,
  keep,
  graceMs = IMAGE_CACHE_PRUNE_GRACE_MS,
  minEntries = IMAGE_CACHE_PRUNE_MIN_ENTRIES,
}: {
  cache: Map<FileId, unknown>;
  elements: readonly ExcalidrawElement[];
  unreferencedSince: Map<FileId, number>;
  now: number;
  keep?: ReadonlySet<FileId>;
  graceMs?: number;
  minEntries?: number;
}) => {
  if (cache.size < minEntries) {
    unreferencedSince.clear();
    return { removed: 0, pending: 0 };
  }
  const referenced = new Set<FileId>();
  for (const element of elements) {
    if (!element.isDeleted && isInitializedImageElement(element)) {
      referenced.add(element.fileId);
    }
  }
  let removed = 0;
  let pending = 0;
  for (const fileId of [...cache.keys()]) {
    if (referenced.has(fileId) || keep?.has(fileId)) {
      unreferencedSince.delete(fileId);
      continue;
    }
    const since = unreferencedSince.get(fileId);
    if (graceMs > 0 && since === undefined) {
      unreferencedSince.set(fileId, now);
      pending++;
    } else if (graceMs <= 0 || now - since! >= graceMs) {
      cache.delete(fileId);
      unreferencedSince.delete(fileId);
      removed++;
    } else {
      pending++;
    }
  }
  for (const fileId of unreferencedSince.keys()) {
    if (!cache.has(fileId)) {
      unreferencedSince.delete(fileId);
    }
  }
  return { removed, pending };
};

/** An unreachable file must stay so for this long before it is released. */
export const FILES_RELEASE_GRACE_MS = 10_000;

/**
 * Finds files that nothing can bring back: no non-deleted image element
 * uses them, and no deleted image element that an undo or redo entry still
 * touches (`historyElementIds`) does either. Files with no element at all
 * are included (a host may preload before the elements land), so every
 * candidate must stay unreachable for `graceMs` across calls
 * (`unreachableSince` is caller-owned state). `keep` is never released.
 * Pure: it only reports ids; the caller drops them.
 * @returns the ids to release now, and how many are still on probation
 */
export const findUnreachableFileIds = ({
  fileIds,
  elements,
  historyElementIds,
  historyFileIds,
  unreachableSince,
  now,
  keep,
  graceMs = FILES_RELEASE_GRACE_MS,
}: {
  fileIds: Iterable<FileId>;
  elements: readonly ExcalidrawElement[];
  historyElementIds: ReadonlySet<string>;
  /** file ids the undo/redo entries carry themselves */
  historyFileIds?: ReadonlySet<string>;
  unreachableSince: Map<FileId, number>;
  now: number;
  keep?: ReadonlySet<FileId>;
  graceMs?: number;
}) => {
  const reachable = new Set<FileId>();
  // deleted image elements still in the scene: the only files `graceMs: 0`
  // may release at once (a file no element mentions may be mid-insert)
  const tombstoned = new Set<FileId>();
  for (const element of elements) {
    if (!isInitializedImageElement(element)) {
      continue;
    }
    if (!element.isDeleted || historyElementIds.has(element.id)) {
      reachable.add(element.fileId);
    } else {
      tombstoned.add(element.fileId);
    }
  }
  const release: FileId[] = [];
  let pending = 0;
  const seen = new Set<FileId>();
  for (const fileId of fileIds) {
    seen.add(fileId);
    if (
      reachable.has(fileId) ||
      keep?.has(fileId) ||
      historyFileIds?.has(fileId)
    ) {
      unreachableSince.delete(fileId);
      continue;
    }
    const since = unreachableSince.get(fileId);
    if (
      (graceMs <= 0 && tombstoned.has(fileId)) ||
      (since !== undefined && now - since >= Math.max(graceMs, 0))
    ) {
      release.push(fileId);
      unreachableSince.delete(fileId);
    } else {
      if (since === undefined) {
        unreachableSince.set(fileId, now);
      }
      pending++;
    }
  }
  for (const fileId of unreachableSince.keys()) {
    if (!seen.has(fileId)) {
      unreachableSince.delete(fileId);
    }
  }
  return { release, pending };
};

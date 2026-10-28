/**
 * Images in a batch (API 0.7.0). Two steps, because hashing is async and
 * applying must stay synchronous (the scene must not change between the
 * checks and the write):
 *
 *   1. `hashImages(ops)` (async): SHA-1 of every image's bytes, as the editor
 *      itself names files, so the same picture is stored once.
 *   2. `applyOps(api, ops, { images })` (sync): validate, check the size cap,
 *      build, add the files, update the scene.
 */
import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/element/types";

import {
  DRAWING_BYTES_HEADROOM,
  imageBudget,
  imageDataUrlBytes,
  IMAGE_ELEMENT_BYTES,
  isBytes,
  MAX_DRAWING_BYTES,
  MAX_IMAGE_BYTES,
  opsLimit,
} from "../../../sdk/api/shared/sceneRules";
import { PluginApiError } from "../../../sdk/api/shared/rules";
import { currentDrawingBytes } from "../pdfImport/budget";

import type { SceneApi, SceneOp } from "./types";

type AddOp = Extract<SceneOp, { op: "add" }>;
type UpdateOp = Extract<SceneOp, { op: "update" }>;

/** The image an add or an update op carries. */
const pictureOf = (op: AddOp | UpdateOp) =>
  op.op === "add" ? op.element.image! : op.props.image!;

/** Image add or update op (by identity) to the editor's file id (SHA-1 of its bytes). */
export type ImageHashes = ReadonlyMap<object, FileId>;

const sha1Hex = async (bytes: Uint8Array): Promise<FileId> => {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-1",
    bytes as BufferSource,
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("") as FileId;
};

const imageOf = (op: unknown): { bytes: Uint8Array } | null => {
  const o = op as {
    op?: unknown;
    element?: { type?: unknown; image?: { bytes?: unknown } };
    props?: { image?: { bytes?: unknown } };
  } | null;
  // An add carries the picture on its element; an update (since 0.25.0) on its props.
  const image =
    o?.op === "add" && o.element?.type === "image"
      ? o.element.image
      : o?.op === "update"
      ? o.props?.image
      : undefined;
  if (isBytes(image?.bytes)) {
    return { bytes: image!.bytes as Uint8Array };
  }
  return null;
};

/**
 * Hashes the images of `ops`. Looks at unvalidated input, so it hashes only
 * what could pass (a byte array within the size limit, in a batch within the
 * ops limit); validation in `applyOps` still decides. Hashes each distinct
 * byte array once.
 */
export const hashImages = async (
  ops: unknown,
  maxOps?: number,
): Promise<ImageHashes> => {
  const out = new Map<object, FileId>();
  if (!Array.isArray(ops) || ops.length > opsLimit(maxOps)) {
    return out;
  }
  const byArray = new Map<Uint8Array, Promise<FileId>>();
  await Promise.all(
    ops.map(async (op) => {
      const image = imageOf(op);
      if (!image || image.bytes.length > MAX_IMAGE_BYTES) {
        return;
      }
      let hash = byArray.get(image.bytes);
      if (!hash) {
        hash = sha1Hex(image.bytes);
        byArray.set(image.bytes, hash);
      }
      out.set(op, await hash);
    }),
  );
  return out;
};

/** Base64 of `bytes`, in slices so a large picture does not overflow the call stack. */
export const toBase64 = (bytes: Uint8Array): string => {
  const SLICE = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + SLICE));
  }
  return btoa(binary);
};

export interface ImagePlan {
  /** Image add or update op (by identity) to its file id. */
  fileIds: Map<object, string>;
  /** Files the drawing does not hold yet, one per distinct picture. */
  files: BinaryFileData[];
}

/**
 * Checks the images of the validated `ops` against the drawing size cap and
 * prepares their files. Throws `TOO_LARGE` (nothing written) when the drawing
 * plus the new data URLs and elements would pass the headroom share of the
 * cap. A picture already in the drawing, or repeated in the batch, costs its
 * data URL once.
 */
export const planImages = (
  api: Pick<SceneApi, "getSceneElementsIncludingDeleted" | "getFiles">,
  ops: readonly SceneOp[],
  hashes: ImageHashes | undefined,
): ImagePlan | null => {
  const adds = ops.filter(
    (op): op is AddOp | UpdateOp =>
      (op.op === "add" && op.element.type === "image") ||
      (op.op === "update" && op.props.image !== undefined),
  );
  if (!adds.length) {
    return null;
  }
  const have = api.getFiles();
  const fileIds = new Map<object, string>();
  const fresh = new Map<string, { mime: string; bytes: Uint8Array }>();
  for (const add of adds) {
    const id = hashes?.get(add);
    if (!id) {
      throw new PluginApiError(
        "INVALID_ARGUMENT",
        "images must be hashed before they are applied (hashImages)",
      );
    }
    fileIds.set(add, id);
    const image = pictureOf(add);
    if (!have[id] && !fresh.has(id)) {
      fresh.set(id, image);
    }
  }
  let added = adds.length * IMAGE_ELEMENT_BYTES;
  for (const image of fresh.values()) {
    added += imageDataUrlBytes(image.mime, image.bytes.length);
  }
  const current = currentDrawingBytes(
    api.getSceneElementsIncludingDeleted(),
    have,
  );
  if (added > imageBudget(current)) {
    const mib = (n: number) => (n / 1024 / 1024).toFixed(1);
    throw new PluginApiError(
      "TOO_LARGE",
      `the images add about ${mib(added)} MiB, and the drawing (${mib(
        current,
      )} MiB) may grow to ${mib(
        DRAWING_BYTES_HEADROOM * MAX_DRAWING_BYTES,
      )} MiB`,
    );
  }
  const created = Date.now();
  const files: BinaryFileData[] = [...fresh].map(([id, image]) => ({
    id: id as FileId,
    mimeType: image.mime as BinaryFileData["mimeType"],
    dataURL: `data:${image.mime};base64,${toBase64(
      image.bytes,
    )}` as BinaryFileData["dataURL"],
    created,
  }));
  return { fileIds, files };
};

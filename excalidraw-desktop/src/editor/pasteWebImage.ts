/**
 * Pasting a picture from the web makes a picture, like Obsidian and the browser (owner,
 * 2026-10-29): a copied picture address, or a part of a web page with <img> in it. The bytes come
 * through the app's own checked download (network/webImage.ts), never the page's fetch. What is
 * not a picture (a web page) pastes as before (a link or an embed); a picture address the checks
 * refuse (a private or local address) becomes a box that says why, so the paste is not lost.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { pictureType } from "../../../sdk/api/shared/sceneRules";

import { fetchWebImage } from "../network/webImage";
import { applyOps, hashImages, viewportCenter } from "../sceneOps";

import type { SceneOp } from "../sceneOps";

const ONE_URL = /^https?:\/\/\S+$/i;
const PICTURE_PATH = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(?:[?#]|$)/i;
/** Widest a pasted picture starts (scene pixels); larger ones are scaled down. */
const MAX_WIDTH = 600;

/** The picture type by its bytes (the same five the import accepts; one rule, sdk/api/shared/sceneRules.ts). */
export { pictureType };

/** The picture addresses a paste carries, or null when it is not a web picture paste. */
export const pastedPictureUrls = (data: {
  text?: string;
  mixedContent?: unknown;
}): { urls: string[]; fromPage: boolean } | null => {
  const mixed = Array.isArray(data.mixedContent)
    ? (data.mixedContent as { type: string; value: string }[])
    : null;
  const fromPage = (mixed ?? [])
    .filter((n) => n.type === "imageUrl" && /^https?:/i.test(n.value))
    .map((n) => n.value);
  if (fromPage.length > 0) {
    return { urls: fromPage, fromPage: true };
  }
  const text = data.text?.trim();
  return text && !mixed && ONE_URL.test(text)
    ? { urls: [text], fromPage: false }
    : null;
};

const sizeOf = async (
  bytes: Uint8Array,
  mime: string,
): Promise<{ width: number; height: number }> => {
  try {
    const bmp = await createImageBitmap(
      new Blob([bytes as BlobPart], { type: mime }),
    );
    const scale = Math.min(1, MAX_WIDTH / Math.max(1, bmp.width));
    const out = {
      width: Math.max(8, Math.round(bmp.width * scale)),
      height: Math.max(8, Math.round(bmp.height * scale)),
    };
    bmp.close();
    return out;
  } catch {
    return { width: 320, height: 240 };
  }
};

const REFUSED = new Set(["INVALID_URL", "PRIVATE_ADDRESS", "REDIRECT_REFUSED"]);

/**
 * Handles a paste of web pictures. Returns true when it did (the editor's own paste is skipped),
 * false to let the editor paste as before.
 */
export async function pasteWebPictures(
  api: ExcalidrawImperativeAPI,
  data: { text?: string; mixedContent?: unknown },
): Promise<boolean> {
  const found = pastedPictureUrls(data);
  if (!found) {
    return false;
  }
  const ops: SceneOp[] = [];
  const center = viewportCenter(api.getAppState() as never);
  let y = center.y;
  for (const url of found.urls) {
    try {
      const bytes = await fetchWebImage(url);
      const mime = pictureType(bytes);
      if (!mime) {
        throw Object.assign(new Error("not a picture"), {
          code: "NOT_AN_IMAGE",
        });
      }
      const size = await sizeOf(bytes, mime);
      ops.push({
        op: "add",
        element: {
          type: "image",
          x: center.x - size.width / 2,
          y,
          ...size,
          image: { mime: mime as never, bytes },
          link: url,
        },
      } as SceneOp);
      y += size.height + 16;
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      const refused = REFUSED.has(code);
      // A single address that is not a picture (a web page), or with web pictures off: the
      // editor's own paste (a link or an embed), as before.
      if (!found.fromPage && !(refused && PICTURE_PATH.test(url))) {
        return false;
      }
      const why = refused
        ? "Web image refused (not a public web address)"
        : code === "NETWORK_DISABLED"
        ? "Web image, not downloaded (Offline mode is on)"
        : code === "NETWORK_NOT_ALLOWED"
        ? "Web image, not downloaded (web pictures are off in Settings)"
        : code === "TOO_LARGE"
        ? "Image over 10 MB"
        : code === "NOT_AN_IMAGE"
        ? "Web page, not a picture"
        : "Web image could not be downloaded";
      const box = { width: 320, height: 120 };
      ops.push(
        {
          op: "add",
          element: {
            type: "rectangle",
            x: center.x - box.width / 2,
            y,
            ...box,
            link: url,
          },
        } as SceneOp,
        {
          op: "add",
          element: {
            type: "text",
            x: center.x - box.width / 2 + 8,
            y: y + 8,
            text: `${why}: ${url.length > 60 ? `${url.slice(0, 57)}...` : url}`,
            fontSize: 14,
          },
        } as SceneOp,
      );
      y += box.height + 16;
    }
  }
  if (ops.length === 0) {
    return false;
  }
  applyOps(api as never, ops, { images: await hashImages(ops) });
  return true;
}

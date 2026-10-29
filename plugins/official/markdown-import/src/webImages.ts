/**
 * Web pictures of a note (toimprove 71, 108). Like Obsidian, a picture on the web just shows: it is
 * downloaded during the import and embedded in the drawing, so it works offline afterwards. No
 * question is asked (owner, 2026-10-29); `ctx.network.askImages` only says whether the user turned
 * web pictures (or the network) off, and then each one stays a box that says so. Only pictures: a
 * link to a web page stays a box ("Web page, not a picture").
 */
import { pictureType } from "../../../../sdk/api/shared/sceneRules";

import type { NetworkApi } from "@vaultdraw/api";
import type { PageItem } from "./layout/types";

type ImageItem = PageItem & { type: "image" };

/** A picture a drawing can hold, by its bytes (one rule for paste, import and the native download). */
export const sniff = pictureType;

/** Largest picture downloaded (the native side enforces the same). */
export const MAX_WEB_BYTES = 10 * 1024 * 1024;
const CONCURRENCY = 4;
/** Downloaded bytes kept for notes that show one picture twice. */
const CACHE_BYTES = 32 * 1024 * 1024;

export const isWebTarget = (target: string): boolean =>
  /^(?:https?:|data:)/i.test(target);

const label = (item: ImageItem, why: string): void => {
  item.alt = `${why}: ${item.alt || item.target}`;
};

/** The bytes of a `data:image/...;base64,` address, or null. */
const dataBytes = (target: string): Uint8Array | null => {
  const m = /^data:[^,;]*;base64,(.*)$/is.exec(target);
  if (!m) {
    return null;
  }
  try {
    return Uint8Array.from(atob(m[1].replace(/\s+/g, "")), (c) =>
      c.charCodeAt(0),
    );
  } catch {
    return null;
  }
};

export interface WebImages {
  /** Fills the bytes of the web pictures in `items`, or says in their box why not. */
  fill(items: readonly PageItem[], signal?: AbortSignal): Promise<void>;
  /** How many pictures were downloaded in this import. */
  readonly downloaded: number;
}

/**
 * `net` undefined (an app without `ctx.network`) or the user saying no leaves every web picture a
 * labelled box. The setting is read once per import.
 */
export const createWebImages = (net: NetworkApi | undefined): WebImages => {
  let verdict: "ask" | "yes" | "no" = "ask";
  const cache = new Map<string, Uint8Array>();
  let cached = 0;
  let downloaded = 0;

  const remember = (url: string, bytes: Uint8Array) => {
    if (bytes.length > CACHE_BYTES / 4) {
      return;
    }
    cache.set(url, bytes);
    cached += bytes.length;
    for (const [k, v] of cache) {
      if (cached <= CACHE_BYTES) {
        break;
      }
      cache.delete(k);
      cached -= v.length;
    }
  };

  const give = (item: ImageItem, bytes: Uint8Array): void => {
    const mime = sniff(bytes);
    if (!mime) {
      label(item, "Web page, not a picture");
    } else if (bytes.length > MAX_WEB_BYTES) {
      label(item, "Image over 10 MB");
    } else {
      item.mimeType = mime;
      item.bytes = bytes;
    }
  };

  const download = async (item: ImageItem): Promise<void> => {
    const url = item.target;
    const hit = cache.get(url);
    if (hit) {
      give(item, hit);
      return;
    }
    try {
      const bytes = await net!.fetchImage(url);
      downloaded++;
      remember(url, bytes);
      give(item, bytes);
    } catch (err) {
      const code = (err as { code?: string }).code;
      label(
        item,
        code === "NOT_AN_IMAGE"
          ? "Web page, not a picture"
          : code === "TOO_LARGE"
          ? "Image over 10 MB"
          : code === "INVALID_URL" || code === "PRIVATE_ADDRESS"
          ? "Web image refused (not a public web address)"
          : code === "NETWORK_NOT_ALLOWED" || code === "NETWORK_DISABLED"
          ? "Web image, not downloaded (web pictures are off in Settings)"
          : "Web image could not be downloaded",
      );
    }
  };

  return {
    get downloaded() {
      return downloaded;
    },
    async fill(items, signal) {
      const todo: ImageItem[] = [];
      for (const item of items) {
        if (item.type !== "image" || item.bytes || !isWebTarget(item.target)) {
          continue;
        }
        const data = /^data:/i.test(item.target)
          ? dataBytes(item.target)
          : null;
        if (data) {
          give(item, data);
        } else {
          todo.push(item);
        }
      }
      if (todo.length === 0) {
        return;
      }
      if (!net) {
        todo.forEach((i) => label(i, "Web image, not downloaded"));
        return;
      }
      // Asks nothing: the answer is the user's setting.
      if (verdict === "ask") {
        verdict = (await net.askImages(todo.map((i) => i.target)))
          ? "yes"
          : "no";
      }
      if (verdict === "no") {
        todo.forEach((i) =>
          label(
            i,
            "Web image, not downloaded (web pictures are off in Settings)",
          ),
        );
        return;
      }
      let next = 0;
      const worker = async () => {
        while (next < todo.length && !signal?.aborted) {
          await download(todo[next++]);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker),
      );
    },
  };
};

/**
 * Pictures a note import left as labelled boxes, filled in afterwards from the open drawing:
 * "Download images" (web pictures, once the user allows it) and "Attach images from a folder"
 * (local pictures a single-file import could not see). Each fills what it can in ONE undo step and
 * says what it did.
 */
import { count } from "../../../../sdk/api/shared/plural";

import { LinkResolver } from "./obsidian/links";
import { planImport } from "./obsidian/plan";
import { createWebImages, isWebTarget, sniff } from "./webImages";

import type {
  PluginContext,
  SceneElement,
  SceneElementDetail,
  SceneOp,
} from "@vaultdraw/api";
import type { PageItem } from "./layout/types";

/** A box and its label, as the import draws a picture it could not place. */
export interface Box {
  box: SceneElementDetail;
  label: SceneElement;
  /** The address or path the note wrote (the box's link). */
  link: string;
}

/** The reason a newer import writes before the note's own alt text ("Web image: a cat"). */
const REASON =
  /^(Web image|Web page, not a picture|Image not found|Image over|Image type|Not a picture)[^:]*: /;

/** What `pairBoxes` reads of an element: the slim scene element or the saved JSON one. */
export interface BoxElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  link?: string | null;
  text?: string;
  containerId?: string | null;
  isDeleted?: boolean;
}

/**
 * The placeholder boxes among `els`: a linked rectangle with a free text inside it, the text
 * linked to the same address (every import before 2026-10-30) or not linked at all (newer imports,
 * so the box shows one link icon, not two). The label is the note's alt text, the address, or
 * either after a reason ("Web image: ..."); every version of the import is matched, also the
 * oldest that wrote the bare alt text (toimprove #108). A shape's own label (`containerId`) is
 * never one. Pure: the core's update pass reads the same case table
 * (test/fixtures/placeholder-boxes.json).
 */
export const pairBoxes = <T extends BoxElement>(
  els: readonly T[],
): { box: T; label: T; link: string }[] => {
  const live = els.filter((e) => e.isDeleted !== true);
  const texts = live.filter((e) => e.type === "text" && !e.containerId);
  const out: { box: T; label: T; link: string }[] = [];
  for (const box of live) {
    if (box.type !== "rectangle" || !box.link) {
      continue;
    }
    const inside = texts.filter(
      (t) =>
        t.x >= box.x &&
        t.y >= box.y &&
        t.x < box.x + box.width &&
        t.y < box.y + box.height &&
        (t.link === box.link || !t.link),
    );
    const label =
      inside.find((t) => t.link === box.link) ??
      (inside.length === 1 ? inside[0] : undefined);
    if (label) {
      out.push({ box, label, link: box.link });
    }
  }
  return out;
};

/** The note's own alt text of a label: what follows the reason, or the whole label. */
export const altOf = (label: string): string => label.replace(REASON, "");

/** The placeholder boxes of the open drawing. */
export const findBoxes = (ctx: PluginContext): Box[] => {
  const els = ctx.scene.elements();
  const wanted = els.filter((e) => e.type === "text" || e.type === "rectangle");
  const details = ctx.scene.get(wanted.map((e) => e.id));
  return pairBoxes(
    details as unknown as (BoxElement & SceneElementDetail)[],
  ).map((p) => ({ box: p.box, label: p.label, link: p.link }));
};

const MIME_OK = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

/** The picture at the box's width, with the height its own shape gives (the box's when unknown). */
const sized = async (
  bytes: Uint8Array,
  mime: string,
  box: Box["box"],
): Promise<{ width: number; height: number }> => {
  try {
    const bmp = await createImageBitmap(
      new Blob([bytes as BlobPart], { type: mime }),
    );
    const h = Math.round((box.width * bmp.height) / Math.max(1, bmp.width));
    bmp.close();
    return { width: box.width, height: Math.max(8, h) };
  } catch {
    return { width: box.width, height: box.height };
  }
};

/** Replaces `boxes` by pictures: `bytesOf` gives the bytes of each. Returns how many were replaced. */
const replace = async (
  ctx: PluginContext,
  boxes: Box[],
  bytesOf: Map<Box, Uint8Array>,
): Promise<number> => {
  const ops: SceneOp[] = [];
  let n = 0;
  for (const b of boxes) {
    const bytes = bytesOf.get(b);
    const mime = bytes ? sniff(bytes) : null;
    if (!bytes || !mime || !MIME_OK.has(mime)) {
      continue;
    }
    const size = await sized(bytes, mime, b.box);
    ops.push(
      {
        op: "add",
        element: {
          type: "image",
          x: b.box.x,
          y: b.box.y,
          ...size,
          image: { mime: mime as never, bytes },
          link: b.link,
        },
      },
      { op: "delete", id: b.box.id },
      { op: "delete", id: b.label.id },
    );
    n++;
  }
  if (ops.length > 0) {
    await ctx.scene.batch(ops);
  }
  return n;
};

/**
 * "Download images": the web pictures of the open drawing. `quiet` is the app's own call when an
 * imported note with picture boxes opens (like Obsidian, web pictures just show): nothing is said
 * unless some could not be downloaded, and then the notice offers Retry.
 */
export async function downloadImages(
  ctx: PluginContext,
  quiet = false,
): Promise<void> {
  const boxes = findBoxes(ctx).filter((b) => isWebTarget(b.link));
  if (boxes.length === 0) {
    if (!quiet) {
      ctx.ui.toast("This drawing has no web pictures to download");
    }
    return;
  }
  if (!ctx.host.has("network")) {
    if (!quiet) {
      ctx.ui.toast("This version of Vaultdraw cannot download pictures");
    }
    return;
  }
  const web = createWebImages(ctx.network);
  const items = boxes.map((b) => ({
    type: "image",
    page: 0,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    mimeType: "",
    target: b.link,
    // The note's own alt text is what follows the reason in the label.
    alt: altOf((b.label as { text?: string }).text ?? ""),
  })) as (PageItem & { type: "image"; bytes?: Uint8Array })[];
  if (!quiet) {
    ctx.ui.toast("Downloading pictures", { id: "download-images" });
  }
  await web.fill(items);
  const bytes = new Map<Box, Uint8Array>();
  items.forEach((it, i) => it.bytes && bytes.set(boxes[i], it.bytes));
  const n = await replace(ctx, boxes, bytes);
  // The boxes that stay say why now (a web page, too large, unreachable), and only the box keeps
  // the link: an old import linked the label too, so two link icons overlapped (#108).
  const relabel: SceneOp[] = [];
  items.forEach((it, i) => {
    if (it.bytes) {
      return;
    }
    const label = boxes[i].label as SceneElementDetail & { text?: string };
    const props: Record<string, unknown> = {};
    if (it.alt && it.alt !== label.text) {
      props.text = it.alt;
    }
    if (label.link) {
      props.link = null;
    }
    if (Object.keys(props).length > 0) {
      relabel.push({ op: "update", id: label.id, props } as SceneOp);
    }
  });
  if (relabel.length > 0) {
    await ctx.scene.batch(relabel);
  }
  if (quiet && n === boxes.length) {
    return;
  }
  const offline = items.some((it) => /Offline mode/.test(it.alt ?? ""));
  const off =
    offline || items.some((it) => /off in Settings/.test(it.alt ?? ""));
  ctx.ui.toast(
    n === boxes.length
      ? `Downloaded ${count(n, "picture")}`
      : n === 0
      ? `${
          boxes.length === 1 ? "The web picture" : "No web picture"
        } could not be downloaded`
      : `Downloaded ${n} of ${boxes.length} pictures`,
    {
      id: "download-images",
      ...(n < boxes.length
        ? {
            detail: off
              ? offline
                ? "Offline mode is on. Turn it off in Settings to download web pictures."
                : "Web pictures are turned off in Settings"
              : "The box says why for each one: not a picture, too large, or not reachable",
            ...(off
              ? {}
              : {
                  actions: [
                    { label: "Retry", run: () => void downloadImages(ctx) },
                  ],
                }),
          }
        : {}),
    },
  );
}

/** "Attach images from a folder": the local pictures a single-file import could not read. */
export async function attachImages(ctx: PluginContext): Promise<void> {
  const boxes = findBoxes(ctx).filter((b) => !isWebTarget(b.link));
  if (boxes.length === 0) {
    ctx.ui.toast("This drawing has no missing pictures to attach");
    return;
  }
  const source = await ctx.folders.pickSource({
    title: "Pick the folder that holds the pictures (or the whole vault)",
  });
  if (!source) {
    return;
  }
  const plan = planImport(await source.list(), {
    obsidianAttachments: true,
    obsidianExcalidraw: true,
  });
  const resolver = new LinkResolver(plan.items);
  const bytes = new Map<Box, Uint8Array>();
  for (const b of boxes) {
    const hit = resolver.resolve(b.link.split(/[?#]/)[0], ["attachment"], "");
    if (hit) {
      try {
        bytes.set(b, await source.readBytes(hit.path));
      } catch {
        // stays a box
      }
    }
  }
  const n = await replace(ctx, boxes, bytes);
  ctx.ui.toast(
    n === 0
      ? "None of the pictures were in that folder"
      : `Attached ${n} of ${count(boxes.length, "picture")}`,
    { id: "attach-images" },
  );
}

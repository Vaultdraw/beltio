/**
 * Pictures a note import left as labelled boxes, filled in afterwards from the open drawing:
 * "Download images" (web pictures, once the user allows it) and "Attach images from a folder"
 * (local pictures a single-file import could not see). Each fills what it can in ONE undo step and
 * says what it did.
 */
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

const REASON =
  /^(Web image|Web page, not a picture|Image not found|Image over|Image type|Not a picture)/;

/** The placeholder boxes of the open drawing: a rectangle and the text inside it with the same link. */
export const findBoxes = (ctx: PluginContext): Box[] => {
  const els = ctx.scene.elements();
  const texts = els.filter((e) => e.type === "text");
  const rects = els.filter((e) => e.type === "rectangle");
  const rectDetails = ctx.scene.get(rects.map((r) => r.id));
  const textDetails = new Map(
    ctx.scene.get(texts.map((t) => t.id)).map((d) => [d.id, d]),
  );
  const out: Box[] = [];
  for (const box of rectDetails) {
    if (!box.link) {
      continue;
    }
    const label = texts.find((t) => {
      const d = textDetails.get(t.id);
      return (
        d?.link === box.link &&
        t.x >= box.x &&
        t.y >= box.y &&
        t.x < box.x + box.width &&
        t.y < box.y + box.height
      );
    });
    if (label && REASON.test((label as { text?: string }).text ?? "")) {
      out.push({ box, label, link: box.link });
    }
  }
  return out;
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

/** "Download images": the web pictures of the open drawing. */
export async function downloadImages(ctx: PluginContext): Promise<void> {
  const boxes = findBoxes(ctx).filter((b) => isWebTarget(b.link));
  if (boxes.length === 0) {
    ctx.ui.toast("This drawing has no web pictures to download");
    return;
  }
  if (!ctx.host.has("network")) {
    ctx.ui.toast("This version of Vaultdraw cannot download pictures");
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
    alt: ((b.label as { text?: string }).text ?? "").replace(/^[^:]*: /, ""),
  })) as (PageItem & { type: "image"; bytes?: Uint8Array })[];
  ctx.ui.toast("Downloading pictures", { id: "download-images" });
  await web.fill(items);
  const bytes = new Map<Box, Uint8Array>();
  items.forEach((it, i) => it.bytes && bytes.set(boxes[i], it.bytes));
  const n = await replace(ctx, boxes, bytes);
  // The boxes that stay say why now (a web page, too large, unreachable).
  const relabel: SceneOp[] = [];
  items.forEach((it, i) => {
    const was = (boxes[i].label as { text?: string }).text;
    if (!it.bytes && it.alt && it.alt !== was) {
      relabel.push({
        op: "update",
        id: boxes[i].label.id,
        props: { text: it.alt },
      });
    }
  });
  if (relabel.length > 0) {
    await ctx.scene.batch(relabel);
  }
  ctx.ui.toast(
    n === boxes.length
      ? `Downloaded ${n} pictures`
      : n === 0
      ? "No picture was downloaded"
      : `Downloaded ${n} of ${boxes.length} pictures`,
    {
      id: "download-images",
      ...(n < boxes.length
        ? {
            detail:
              "The others are not pictures, are too large, or could not be reached",
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
      : `Attached ${n} of ${boxes.length} pictures`,
    { id: "attach-images" },
  );
}

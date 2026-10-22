import { createHash } from "node:crypto";
import zlib from "node:zlib";

// @ts-expect-error plain .mjs generator shared with the perf harness
import {
  generateElements,
  mulberry32,
  sceneJson,
} from "../perf/lib/fixtures.mjs";

// The "typical" drawing of perf/typical.config.json: 300 mixed elements over
// ~1.5 screens plus 2 embedded PNGs (~0.75 MB of dataURL each).

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Buffer) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

/** Incompressible RGB PNG (noise + gradient), ~targetChars of dataURL. */
const makePng = (rng: any, targetChars: number) => {
  const prefix = "data:image/png;base64,".length;
  const targetPng = Math.floor(((targetChars - prefix) * 3) / 4);
  const width = 1024;
  const height = Math.max(8, Math.ceil(targetPng / (width * 3 + 1)));
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const words = new Uint32Array(raw.buffer, raw.byteOffset, raw.length >> 2);
  for (let i = 0; i < words.length; i++) {
    words[i] = rng.u32();
  }
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const o = row + 1 + x * 3;
      raw[o] = (raw[o] + Math.floor((x * 255) / width)) & 255;
      raw[o + 1] = (raw[o + 1] + Math.floor((y * 255) / height)) & 255;
      raw[o + 2] = (raw[o + 2] + ((x + y) & 255)) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 1 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return {
    dataURL: `data:image/png;base64,${png.toString("base64")}`,
    width,
    height,
  };
};

// Same key scheme as perf/lib/fixtures.mjs orderKey.
const orderKey = (i: number) => {
  if (i < 62) {
    return `a${B62[i]}`;
  }
  i -= 62;
  if (i < 62 * 62) {
    return `b${B62[Math.floor(i / 62)]}${B62[i % 62]}`;
  }
  i -= 62 * 62;
  return `c${B62[Math.floor(i / 3844) % 62]}${B62[Math.floor(i / 62) % 62]}${
    B62[i % 62]
  }`;
};

/** JSON of the typical 300-element drawing with 2 images (deterministic). */
export const typicalSceneJson = (): string =>
  probeSceneJson({ elements: 300, images: 2, imageChars: 750 * 1024 });

/**
 * The stress open target (perf/fixtures.config.json openTargetSpecs.large):
 * 5000 elements over 6000x6000 and 6 images of ~3 MB PNG (18 MB in total).
 */
export const largeSceneJson = (): string =>
  probeSceneJson({
    elements: 5000,
    images: 6,
    imageChars: 4 * 1024 * 1024,
    area: 6000,
    textRatio: 0.3,
  });

const probeSceneJson = ({
  elements: count,
  images,
  imageChars,
  area,
  textRatio = 0.25,
}: {
  elements: number;
  images: number;
  imageChars: number;
  area?: number;
  textRatio?: number;
}): string => {
  const rng = mulberry32(20261015);
  const elements = generateElements(
    rng,
    count - images,
    textRatio,
    area ?? 1900,
    area ?? 850,
    null,
    0,
  );
  const files: Record<string, unknown> = {};
  for (let i = 0; i < images; i++) {
    const { dataURL, width, height } = makePng(rng, imageChars);
    const fileId = createHash("sha1").update(`memprobe:${i}`).digest("hex");
    files[fileId] = { mimeType: "image/png", id: fileId, dataURL, created: 1 };
    const w = 320;
    elements.push({
      id: `memprobe-img-${i}`,
      type: "image",
      x: area ? 150 + (i % 3) * 400 : 150 + i * 700,
      y: area ? 250 + Math.floor(i / 3) * 400 : 250,
      width: w,
      height: Math.round((w * height) / width),
      angle: 0,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 1 + i,
      version: 2,
      versionNonce: 1 + i,
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
      index: orderKey(count - images + i),
      fileId,
      status: "saved",
      scale: [1, 1],
    });
  }
  return sceneJson(elements, files, {
    scrollX: 0,
    scrollY: 0,
    zoom: { value: 1 },
  });
};

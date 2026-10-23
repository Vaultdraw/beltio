import { deflateSync } from "node:zlib";

// --- scene generation (deterministic, mixed element types)

let seed = 12345;
export const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
export const base = (id: string, type: string, rough: number) => ({
  id,
  type,
  x: Math.round(rnd() * 3000),
  y: Math.round(rnd() * 2000),
  width: 40 + Math.round(rnd() * 160),
  height: 30 + Math.round(rnd() * 120),
  angle: 0,
  strokeColor: ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2"][
    Math.floor(rnd() * 4)
  ],
  backgroundColor: rnd() < 0.5 ? "transparent" : "#ffc9c9",
  fillStyle: "hachure",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: rough,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  seed: Math.floor(rnd() * 2 ** 31),
  version: 1,
  versionNonce: Math.floor(rnd() * 2 ** 31),
  isDeleted: false,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
});

const element = (i: number, rough: number) => {
  const r = rnd();
  const id = `el${i}`;
  if (r < 0.5) {
    return base(id, ["rectangle", "ellipse", "diamond"][i % 3], rough);
  }
  if (r < 0.75) {
    return {
      ...base(id, "text", rough),
      text: `Node ${i}`,
      originalText: `Node ${i}`,
      fontSize: 20,
      fontFamily: 5,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      autoResize: true,
      lineHeight: 1.25,
      backgroundColor: "transparent",
    };
  }
  const b = base(id, "arrow", rough);
  return {
    ...b,
    points: [
      [0, 0],
      [b.width / 2, b.height / 3],
      [b.width, b.height],
    ],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  };
};

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) {
    c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
/** A size x size RGB gradient with mild noise (so it does not compress to nothing). */
export const pngDataUrl = (size: number) => {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      raw[o++] = (x * 255) / size;
      raw[o++] = (y * 255) / size;
      raw[o++] = Math.floor(rnd() * 64);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
};

export const scene = (n: number, rough: number, withImage = false) => {
  const elements: unknown[] = Array.from({ length: n }, (_, i) =>
    element(i, rough),
  );
  const files: Record<string, unknown> = {};
  if (withImage) {
    elements.push({
      ...base("img1", "image", rough),
      width: 600,
      height: 600,
      fileId: "file1",
      status: "saved",
      scale: [1, 1],
      crop: null,
    });
    files.file1 = {
      id: "file1",
      mimeType: "image/png",
      dataURL: pngDataUrl(900),
      created: 1,
    };
  }
  return JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements,
    appState: { viewBackgroundColor: "#ffffff" },
    files,
  });
};

const wrap = (
  elements: unknown[],
  files: Record<string, unknown> = {},
  appState: Record<string, unknown> = {},
) =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements,
    appState: { viewBackgroundColor: "#ffffff", ...appState },
    files,
  });

const textEl = (
  id: string,
  x: number,
  y: number,
  text: string,
  font: number,
) => ({
  ...base(id, "text", 1),
  x,
  y,
  width: 200,
  height: 25,
  text,
  originalText: text,
  fontSize: 20,
  fontFamily: font,
  textAlign: "left",
  verticalAlign: "top",
  containerId: null,
  autoResize: true,
  lineHeight: 1.25,
  backgroundColor: "transparent",
});

/**
 * Deterministic scenes covering what the renderer draws: shapes (rough and
 * flat), text in several font families, bound text, an embedded image,
 * freedraw, and a dark view background. Used by the pixel-identity spec.
 */
export const representativeScenes = (): Record<string, string> => {
  const shapes = Array.from({ length: 12 }, (_, i) => ({
    ...base(
      `s${i}`,
      ["rectangle", "ellipse", "diamond"][i % 3],
      i % 4 === 0 ? 0 : 1,
    ),
    x: (i % 4) * 160,
    y: Math.floor(i / 4) * 120,
    roundness: i % 2 ? { type: 3 } : null,
    fillStyle: ["hachure", "cross-hatch", "solid", "zigzag"][i % 4],
    backgroundColor: i % 3 === 0 ? "transparent" : "#a5d8ff",
  }));
  const fonts = [1, 2, 3, 5, 6, 7, 8].map((f, i) =>
    textEl(`t${i}`, 20, 20 + i * 40, `Font ${f} The quick brown fox`, f),
  );
  const container = {
    ...base("box", "rectangle", 1),
    x: 400,
    y: 20,
    width: 180,
    height: 90,
    boundElements: [{ type: "text", id: "boxText" }],
  };
  const bound = {
    ...textEl("boxText", 410, 50, "Bound label", 5),
    containerId: "box",
    textAlign: "center",
    verticalAlign: "middle",
  };
  const free = {
    ...base("free", "freedraw", 0),
    x: 420,
    y: 160,
    width: 120,
    height: 80,
    points: Array.from({ length: 40 }, (_, k) => [
      k * 3,
      Math.sin(k / 4) * 30 + 40,
    ]),
    pressures: [],
    simulatePressure: true,
    lastCommittedPoint: null,
  };
  const arrow = {
    ...base("arr", "arrow", 1),
    x: 20,
    y: 340,
    width: 300,
    height: 60,
    points: [
      [0, 0],
      [150, 50],
      [300, 20],
    ],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: "dot",
    endArrowhead: "triangle",
    elbowed: false,
  };
  const image = {
    ...base("img", "image", 1),
    x: 360,
    y: 260,
    width: 200,
    height: 200,
    fileId: "file1",
    status: "saved",
    scale: [1, 1],
    crop: null,
  };
  const files = {
    file1: {
      id: "file1",
      mimeType: "image/png",
      dataURL: pngDataUrl(160),
      created: 1,
    },
  };
  return {
    shapes: wrap(shapes),
    fonts: wrap(fonts),
    boundText: wrap([container, bound]),
    freedraw: wrap([free, arrow]),
    image: wrap([image], files),
    mixed: wrap(
      [...shapes, ...fonts, container, bound, free, arrow, image],
      files,
    ),
    darkBackground: wrap(
      [...shapes.slice(0, 6), ...fonts.slice(0, 3)],
      {},
      {
        viewBackgroundColor: "#121212",
      },
    ),
    large: scene(500, 1),
    // Past the old 2,500 cap: restore and bounds yield many times.
    huge: scene(6000, 1),
  };
};

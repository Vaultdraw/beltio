// Deterministic, cached vault generator for the perf harness.
// Same config + GENERATOR_VERSION => byte-identical vault contents.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const GENERATOR_VERSION = 1;
const COMPLETE_MARKER = ".perf-fixture-complete";
const MIB = 1024 * 1024;
const FIXED_TIME = 1700000000000;
const EXT = ".excalidraw";

// ---------------------------------------------------------------- PRNG ----
function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.u32 = () => Math.floor(next() * 4294967296) >>> 0;
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  return next;
}

function hashSeed(...parts) {
  const h = createHash("sha1").update(parts.join("|")).digest();
  return h.readUInt32LE(0);
}

// ------------------------------------------------------------- content ----
const TOP_FOLDERS = [
  "Projects", "Meetings", "Journal", "Research", "Courses", "Ideas",
  "Planning", "Design", "Engineering", "Personal", "Reading", "Notes",
  "Archive", "Clients", "Workshops", "Travel", "Finance", "Product",
  "Media", "Sketches",
];
const SUB_FOLDERS = [
  "Alpha", "Beta", "Backend", "Frontend", "Infra", "Mobile", "Onboarding",
  "Roadmap", "Sprint Reviews", "Weekly", "Standups", "Retros", "Drafts",
  "Final", "Whiteboard", "Diagrams", "Wireframes", "Flows", "Architecture",
  "Data", "Analytics", "Ops", "Launch", "Q1", "Q2", "Q3", "Q4", "Spring",
  "Autumn", "Lectures", "Labs", "Assignments", "Misc", "Old", "Inbox",
  "Team A", "Team B", "Platform", "Growth", "Security",
];
const TOPICS = [
  "roadmap", "architecture", "onboarding flow", "graph notes", "data model",
  "auth flow", "pricing", "release plan", "retro", "brainstorm", "user journey",
  "system overview", "api design", "migration", "budget", "hiring plan",
  "sprint plan", "kickoff", "design review", "network topology", "dashboard",
  "checkout", "search ranking", "caching", "billing", "incident timeline",
  "org chart", "mind map", "lecture summary", "reading list", "study plan",
  "trip itinerary", "workout plan", "meal prep", "launch checklist",
  "customer interview", "competitor map", "pipeline", "state machine",
  "sequence diagram", "cluster layout", "team goals", "okr draft",
];
const QUALIFIERS = [
  "review", "draft", "v2", "final", "overview", "sketch", "notes", "summary",
  "ideas", "plan", "update", "walkthrough", "analysis", "outline",
];
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
const SENTENCES = [
  "Ship the beta to ten customers", "Check the latency numbers again",
  "Owner: platform team", "Blocked on design sign-off", "Review after standup",
  "Follow up with finance next week", "Draft the migration plan",
  "Compare options A and B", "Cache invalidation is the open question",
  "Users drop off at step three", "Decide on pricing tiers", "Add retry with backoff",
  "Write the launch announcement", "Sync with the mobile team", "Revisit after the offsite",
  "Collect feedback from the pilot group", "Split the service by domain",
  "Budget approved for Q3", "Move the deadline by one week",
  "Open question: who owns on-call?", "Reduce cold start time", "Prototype in a day",
  "Pull metrics from the warehouse", "Archive the old dashboards",
  "Idea: offline first sync", "Needs a clearer name", "Done", "Next steps",
  "Risk: vendor lock-in", "Test with real data",
];
const STROKES = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00", "#6741d9", "#0c8599"];
const BACKGROUNDS = ["transparent", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99", "#d0bfff", "#99e9f2"];
const FILLS = ["solid", "hachure", "cross-hatch"];
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function fileNameFor(rng) {
  const r = rng();
  if (r < 0.04) {
    return `meeting 2024-${pad2(rng.int(1, 12))}-${pad2(rng.int(1, 28))}`;
  }
  if (r < 0.08) {
    return `graph notes week ${rng.int(1, 52)}`;
  }
  if (r < 0.1) {
    return `${rng.pick(QUARTERS)} roadmap ${rng.pick(QUALIFIERS)}`;
  }
  if (r < 0.4) {
    return `${rng.pick(QUARTERS)} ${rng.pick(TOPICS)} ${rng.pick(QUALIFIERS)}`;
  }
  if (r < 0.7) {
    return `${rng.pick(TOPICS)} ${rng.pick(QUALIFIERS)}`;
  }
  if (r < 0.85) {
    return `${rng.pick(TOPICS)} ${rng.pick(TOPICS)}`;
  }
  return `${rng.pick(TOPICS)} ${rng.pick(QUALIFIERS)} ${rng.int(1, 30)}`;
}

// ------------------------------------------------------ fractional index --
// Order keys for the editor's fractional indexing: "a0".."az" (head "a" + one
// base-62 digit), then "b00".."bzz", then "c000".. which covers > 250k keys.
function orderKey(i) {
  if (i < 62) {
    return `a${B62[i]}`;
  }
  i -= 62;
  if (i < 62 * 62) {
    return `b${B62[Math.floor(i / 62)]}${B62[i % 62]}`;
  }
  i -= 62 * 62;
  return `c${B62[Math.floor(i / 3844) % 62]}${B62[Math.floor(i / 62) % 62]}${B62[i % 62]}`;
}

// ------------------------------------------------------------ elements ----
function makeId(rng) {
  let s = "";
  for (let i = 0; i < 21; i++) {
    s += B62[Math.floor(rng() * 62)];
  }
  return s;
}

function baseElement(rng, type, x, y, width, height, idx) {
  return {
    id: makeId(rng),
    type,
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    width: Math.round(width * 100) / 100,
    height: Math.round(height * 100) / 100,
    angle: 0,
    strokeColor: rng.pick(STROKES),
    backgroundColor: rng.pick(BACKGROUNDS),
    fillStyle: rng.pick(FILLS),
    strokeWidth: rng.pick([1, 2, 2, 4]),
    strokeStyle: rng.pick(["solid", "solid", "dashed"]),
    roughness: rng.pick([0, 1, 1, 2]),
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: rng.u32() & 0x7fffffff,
    version: rng.int(2, 9),
    versionNonce: rng.u32() & 0x7fffffff,
    isDeleted: false,
    boundElements: null,
    updated: FIXED_TIME,
    link: null,
    locked: false,
    index: orderKey(idx),
  };
}

function makeText(rng, x, y, idx) {
  const lines = rng.int(1, 3);
  const text = Array.from({ length: lines }, () => rng.pick(SENTENCES)).join("\n");
  const fontSize = rng.pick([16, 20, 20, 28]);
  const longest = Math.max(...text.split("\n").map((l) => l.length));
  const el = baseElement(
    rng, "text", x, y,
    Math.ceil(longest * fontSize * 0.55),
    Math.ceil(lines * fontSize * 1.25),
    idx,
  );
  el.backgroundColor = "transparent";
  el.fillStyle = "solid";
  el.strokeWidth = 2;
  el.strokeStyle = "solid";
  el.roughness = 1;
  Object.assign(el, {
    text,
    originalText: text,
    fontSize,
    fontFamily: 5,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
  });
  return el;
}

/** A note: one text element of `lines` lines (everyday vault). */
function textBlock(rng, x, y, idx, lines) {
  const el = makeText(rng, x, y, idx);
  const text = Array.from({ length: lines }, () => rng.pick(SENTENCES)).join("\n");
  const longest = Math.max(...text.split("\n").map((l) => l.length));
  el.fontSize = 16;
  el.width = Math.ceil(longest * 16 * 0.55);
  el.height = Math.ceil(lines * 16 * 1.25);
  el.text = text;
  el.originalText = text;
  return el;
}

function makeShape(rng, x, y, idx) {
  const type = rng.pick(["rectangle", "rectangle", "ellipse", "diamond"]);
  const el = baseElement(rng, type, x, y, rng.int(60, 260), rng.int(40, 160), idx);
  el.roundness = type === "rectangle" ? { type: 3 } : type === "ellipse" ? null : { type: 2 };
  return el;
}

function makeArrow(rng, x, y, idx) {
  const dx = rng.int(-220, 220) || 90;
  const dy = rng.int(-160, 160);
  const mid = rng() < 0.4;
  const points = mid
    ? [[0, 0], [Math.round(dx / 2), Math.round(dy / 2) + rng.int(-30, 30)], [dx, dy]]
    : [[0, 0], [dx, dy]];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const el = baseElement(
    rng, "arrow", x, y,
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
    idx,
  );
  el.backgroundColor = "transparent";
  el.roundness = { type: 2 };
  Object.assign(el, {
    points,
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
  });
  return el;
}

function makeFreedraw(rng, x, y, idx) {
  const n = rng.int(8, 36);
  const points = [[0, 0]];
  let px = 0;
  let py = 0;
  for (let i = 1; i < n; i++) {
    px += rng.int(-6, 12);
    py += rng.int(-8, 8);
    points.push([px, py]);
  }
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const el = baseElement(
    rng, "freedraw", x, y,
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
    idx,
  );
  el.backgroundColor = "transparent";
  el.roundness = null;
  el.strokeWidth = 1;
  el.roughness = 0;
  Object.assign(el, { points, pressures: [], simulatePressure: true, lastCommittedPoint: null });
  return el;
}

function makeElement(rng, textRatio, x, y, idx) {
  if (rng() < textRatio) {
    return makeText(rng, x, y, idx);
  }
  const r = rng();
  if (r < 0.55) return makeShape(rng, x, y, idx);
  if (r < 0.85) return makeArrow(rng, x, y, idx);
  return makeFreedraw(rng, x, y, idx);
}

function bbox(el) {
  let x0 = el.x;
  let y0 = el.y;
  let x1 = el.x + el.width;
  let y1 = el.y + el.height;
  if (el.points) {
    for (const [px, py] of el.points) {
      x0 = Math.min(x0, el.x + px);
      y0 = Math.min(y0, el.y + py);
      x1 = Math.max(x1, el.x + px);
      y1 = Math.max(y1, el.y + py);
    }
  }
  return [x0, y0, x1, y1];
}

function intersects(a, b) {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

/**
 * Elements spread over [0,areaW) x [0,areaH). Boxes overlapping `avoid`
 * ([x0,y0,x1,y1]) are re-sampled. `slots` extra element slots are reserved
 * at the start of the index sequence for caller-made elements.
 */
function generateElements(rng, count, textRatio, areaW, areaH, avoid, firstIdx = 0) {
  const out = [];
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; ; attempt++) {
      const el = makeElement(rng, textRatio, rng() * areaW, rng() * areaH, firstIdx + i);
      if (!avoid || !intersects(bbox(el), avoid) || attempt > 200) {
        out.push(el);
        break;
      }
    }
  }
  return out;
}

// -------------------------------------------------------------- images ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGB 8-bit PNG of noise over a gradient; ~targetBytes of base64 data URL. */
function makePng(rng, targetDataUrlChars) {
  const prefix = "data:image/png;base64,".length;
  const targetPng = Math.floor(((targetDataUrlChars - prefix) * 3) / 4);
  const width = 1024;
  const height = Math.max(8, Math.ceil(targetPng / (width * 3 + 1)));
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const words = new Uint32Array(raw.buffer, raw.byteOffset, raw.length >> 2);
  for (let i = 0; i < words.length; i++) words[i] = rng.u32();
  // Mix a gradient into the noise (sum with uniform noise stays incompressible).
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    const gy = Math.floor((y * 255) / height);
    for (let x = 0; x < width; x++) {
      const o = row + 1 + x * 3;
      raw[o] = (raw[o] + Math.floor((x * 255) / width)) & 255;
      raw[o + 1] = (raw[o + 1] + gy) & 255;
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
  return { dataURL: `data:image/png;base64,${png.toString("base64")}`, width, height };
}

function makeImages(rng, tag, count, totalMB) {
  const each = Math.floor((totalMB * MIB) / count);
  const files = {};
  const elements = [];
  for (let i = 0; i < count; i++) {
    const { dataURL, width, height } = makePng(rng, each);
    const fileId = createHash("sha1").update(`${tag}:${i}`).digest("hex");
    files[fileId] = { mimeType: "image/png", id: fileId, dataURL, created: FIXED_TIME };
    elements.push({ fileId, width, height });
  }
  return { files, elements };
}

function imageElement(rng, fileId, x, y, w, h, idx) {
  const el = baseElement(rng, "image", x, y, w, h, idx);
  el.backgroundColor = "transparent";
  el.roundness = null;
  return Object.assign(el, { fileId, status: "saved", scale: [1, 1] });
}

// -------------------------------------------------------------- scenes ----
function sceneJson(elements, files, appState) {
  return JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "vaultdraw-perf-fixtures",
    elements,
    appState: { viewBackgroundColor: "#ffffff", gridSize: null, ...appState },
    files,
  });
}

function ordinaryScene(rng) {
  const n = rng.int(5, 60);
  return sceneJson(generateElements(rng, n, 0.25, 1400, 900, null), {}, {});
}

/**
 * Open-target scene. appState pins scrollX/scrollY to 0 and zoom to 1, so a
 * scene point (x, y) is at viewport point (x, y) relative to the canvas origin.
 * Other elements spread over 6000x6000 and keep the 300x300 area centred on
 * the typing target free.
 */
function openTargetScene(rng, tag, spec, typingTarget, imageCount, imageTotalMB) {
  const t = typingTarget;
  const cx = t.x + t.width / 2;
  const cy = t.y + t.height / 2;
  const avoid = [cx - 150, cy - 150, cx + 150, cy + 150];
  const elements = [];
  let files = {};
  if (tag === "medium") {
    const rect = baseElement(rng, "rectangle", t.x, t.y, t.width, t.height, 0);
    rect.id = t.elementId;
    rect.roundness = { type: 3 };
    elements.push(rect);
  }
  const imgCount = imageCount ?? 0;
  const imgs = imgCount ? makeImages(rng, `open-${tag}`, imgCount, imageTotalMB) : null;
  const others = spec.elements - elements.length - imgCount;
  elements.push(...generateElements(rng, others, spec.textRatio, 6000, 6000, tag === "small" ? null : avoid, elements.length));
  if (imgs) {
    files = imgs.files;
    imgs.elements.forEach((im, i) => {
      const w = 320;
      const h = Math.round((320 * im.height) / im.width);
      let x;
      let y;
      do {
        x = rng() * 5600;
        y = rng() * 5600;
      } while (intersects([x, y, x + w, y + h], avoid));
      elements.push(imageElement(rng, im.fileId, x, y, w, h, elements.length));
    });
  }
  return sceneJson(elements, files, { scrollX: 0, scrollY: 0, zoom: { value: 1 } });
}

/** Paper patterns as saved in a drawing's appState (DEFAULT_BACKGROUND_PATTERNS in data/backgroundPattern.ts). */
const PAPER = {
  plain: null,
  grid: { type: "grid", spacing: 20, color: null, opacity: 1, majorEvery: 5, marginLine: false },
  lines: { type: "lines", spacing: 32, color: null, opacity: 1, majorEvery: 1, marginLine: true },
  graph: { type: "graph", spacing: 16, color: null, opacity: 1, majorEvery: 5, marginLine: false },
  dots: { type: "dots", spacing: 20, color: null, opacity: 1, majorEvery: 1, marginLine: false },
  isometric: { type: "isometric", spacing: 24, color: null, opacity: 1, majorEvery: 1, marginLine: false },
};

export const refreshRatePath = (pattern, elements) => `hz-${pattern}-${elements}.excalidraw`;

/**
 * scrollX/scrollY/zoom that fit the elements' bounds into a 1200x800 CSS
 * viewport (centred, zoom 0.1..1.5), so a probe drawing opens with its
 * content on screen whatever view it was saved with.
 */
export function fitView(elements, width = 1200, height = 800) {
  let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const e of elements) {
    const xs = [e.x, e.x + (e.width ?? 0)];
    const ys = [e.y, e.y + (e.height ?? 0)];
    for (const [px, py] of e.points ?? []) {
      xs.push(e.x + px);
      ys.push(e.y + py);
    }
    x1 = Math.min(x1, ...xs);
    y1 = Math.min(y1, ...ys);
    x2 = Math.max(x2, ...xs);
    y2 = Math.max(y2, ...ys);
  }
  if (!Number.isFinite(x1)) return { scrollX: 0, scrollY: 0, zoom: { value: 1 } };
  const zoom = Math.min(1.5, Math.max(0.1, Math.min(width / (x2 - x1 || 1), height / (y2 - y1 || 1))));
  // viewport = (scene + scroll) * zoom
  return {
    scrollX: width / (2 * zoom) - (x1 + x2) / 2,
    scrollY: height / (2 * zoom) - (y1 + y2) / 2,
    zoom: { value: Math.round(zoom * 100) / 100 },
  };
}

/** Copies of a real drawing, one per paper style (same content, pattern swapped): [{ rel, json, pattern, elements }]. */
export function paperVariants(json, patterns, prefix = "user") {
  const scene = JSON.parse(json);
  const live = (scene.elements ?? []).filter((e) => !e.isDeleted);
  const elements = live.length;
  const view = fitView(live);
  return patterns.map((pattern) => {
    if (!(pattern in PAPER)) throw new Error(`unknown paper style ${pattern}`);
    const copy = { ...scene, appState: { ...scene.appState, ...view, viewBackgroundPattern: PAPER[pattern] } };
    return { rel: `${prefix}-${pattern}.excalidraw`, json: JSON.stringify(copy), pattern, elements };
  });
}

/** Refresh-rate probe drawings: [{ rel, json, pattern, elements }] (deterministic). */
export function refreshRateScenes(config) {
  const spec = config.refreshRate;
  if (!spec) return [];
  const out = [];
  for (const pattern of spec.patterns) {
    if (!(pattern in PAPER)) throw new Error(`unknown refreshRate pattern ${pattern}`);
    for (const n of spec.elements) {
      const rng = mulberry32(hashSeed(config.seed, "hz", n));
      const [w, h] = n > 500 ? [3200, 2000] : [1400, 900];
      const elements = generateElements(rng, n, 0.25, w, h, null);
      const json = sceneJson(elements, {}, { scrollX: 0, scrollY: 0, zoom: { value: 1 }, viewBackgroundPattern: PAPER[pattern] });
      out.push({ rel: refreshRatePath(pattern, n), json, pattern, elements: n });
    }
  }
  return out;
}

function imageHeavyScene(rng, tag, totalMB) {
  const images = Math.max(2, Math.round(totalMB / 5));
  const imgs = makeImages(rng, tag, images, totalMB);
  const elements = generateElements(rng, 300 - images, 0.3, 4000, 3000, null, 0);
  imgs.elements.forEach((im, i) => {
    const w = 360;
    elements.push(imageElement(rng, im.fileId, (i % 4) * 400, 3200 + Math.floor(i / 4) * 360, w, Math.round((w * im.height) / im.width), elements.length));
  });
  return { json: sceneJson(elements, imgs.files, {}), elements: elements.length, images };
}

// ---------------------------------------------------------- vault plan ----
function planFolders(rng, config) {
  const folders = new Set();
  const add = (p) => {
    const parts = p.split("/");
    for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join("/"));
  };
  for (const top of TOP_FOLDERS) {
    add(top);
    const subs = new Set();
    const nSub = rng.int(2, 5);
    while (subs.size < nSub) subs.add(rng.pick(SUB_FOLDERS));
    for (const s of subs) {
      add(`${top}/${s}`);
      if (rng() < 0.55) {
        const s2 = rng.pick(SUB_FOLDERS);
        if (s2 !== s) {
          add(`${top}/${s}/${s2}`);
          if (rng() < 0.4) add(`${top}/${s}/${s2}/${rng.pick(SUB_FOLDERS)}`);
        }
      }
    }
  }
  for (const y of ["2021", "2022", "2023", "2025"]) add(`Journal/${y}`);
  add(config.bigFolder.path);
  add(path.posix.dirname(config.needle.path));
  for (const h of config.imageHeavy) add(path.posix.dirname(h.path));
  return [...folders].sort();
}

function planFiles(rng, config, folders) {
  const big = config.bigFolder.path;
  const needleLower = config.needle.query.toLowerCase();
  const used = new Set();
  const files = [];
  const claim = (dir, name) => {
    const rel = dir ? `${dir}/${name}${EXT}` : `${name}${EXT}`;
    const key = rel.toLowerCase();
    if (used.has(key) || key.includes(needleLower)) return null;
    used.add(key);
    return rel;
  };
  const uniqueName = (dir) => {
    for (let attempt = 0; ; attempt++) {
      let name = fileNameFor(rng);
      if (attempt > 3) name += ` ${attempt}`;
      const rel = claim(dir, name);
      if (rel) return rel;
    }
  };
  for (let i = 0; i < config.bigFolder.drawings; i++) files.push(uniqueName(big));
  const ordinaryCount = config.drawingCount - config.bigFolder.drawings - 1;
  const candidates = folders.filter((f) => f !== big);
  // Needle's directory gets a few siblings, other folders get weighted random share.
  const weights = candidates.map((f) => (f.split("/").length <= 2 ? 3 : 1) + rng() * 2);
  const total = weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ordinaryCount; i++) {
    let r = rng() * total;
    let k = 0;
    while (k < weights.length - 1 && (r -= weights[k]) > 0) k++;
    files.push(uniqueName(candidates[k]));
  }
  files.push(config.needle.path);
  used.add(config.needle.path.toLowerCase());
  return files;
}

// ------------------------------------------------------------- writing ----
async function writeBatch(jobs) {
  for (let i = 0; i < jobs.length; i += 64) {
    await Promise.all(jobs.slice(i, i + 64).map((j) => j()));
  }
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureVault({ cacheDir, config, log = console.log }) {
  const hash = createHash("sha1")
    .update(JSON.stringify(config) + `|gen${GENERATOR_VERSION}`)
    .digest("hex")
    .slice(0, 16);
  const vaultName = `vault-${hash}`;
  const vaultDir = path.join(cacheDir, vaultName);
  const manifestPath = path.join(cacheDir, `${vaultName}.manifest.json`);
  await fs.mkdir(cacheDir, { recursive: true });

  if ((await exists(path.join(vaultDir, COMPLETE_MARKER))) && (await exists(manifestPath))) {
    log(`[fixtures] reusing ${vaultDir}`);
    return { vaultDir, manifest: JSON.parse(await fs.readFile(manifestPath, "utf8")) };
  }

  const started = Date.now();
  const tmpDir = path.join(cacheDir, `.tmp-${vaultName}-${process.pid}`);
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.mkdir(tmpDir, { recursive: true });

  const rng = mulberry32(config.seed);
  const folders = planFolders(rng, config);
  const files = planFiles(rng, config, folders);
  const sizes = new Map(); // rel path -> bytes
  const maxBytes = config.maxDrawingBytes;

  for (const f of folders) await fs.mkdir(path.join(tmpDir, f), { recursive: true });

  const put = async (rel, json) => {
    const bytes = Buffer.byteLength(json);
    if (bytes >= maxBytes) throw new Error(`fixture ${rel} is ${bytes} bytes, over maxDrawingBytes ${maxBytes}`);
    sizes.set(rel, bytes);
    await fs.writeFile(path.join(tmpDir, rel), json);
  };

  // Ordinary drawings: each gets its own seeded stream so output is order independent.
  log(`[fixtures] generating ${files.length} drawings in ${folders.length} folders`);
  let jobs = [];
  for (const rel of files) {
    jobs.push(async () => {
      const r = mulberry32(hashSeed(config.seed, rel));
      await put(rel, ordinaryScene(r));
    });
  }
  await writeBatch(jobs);

  // Open targets at vault root.
  const openTargets = {};
  const typing = config.typingTarget;
  for (const key of Object.keys(config.openTargets)) {
    const spec = config.openTargetSpecs[key];
    const rel = config.openTargets[key];
    const r = mulberry32(hashSeed(config.seed, "open", key));
    const json = openTargetScene(r, key, spec, typing, spec.images, spec.imageTotalMB);
    await put(rel, json);
    openTargets[key] = { path: rel, bytes: sizes.get(rel), elements: spec.elements, images: spec.images ?? 0 };
  }

  // Image-heavy drawings.
  const imageHeavy = [];
  for (const h of config.imageHeavy) {
    await fs.mkdir(path.join(tmpDir, path.posix.dirname(h.path)), { recursive: true });
    const r = mulberry32(hashSeed(config.seed, "heavy", h.path));
    const s = imageHeavyScene(r, h.path, h.imageTotalMB);
    await put(h.path, s.json);
    imageHeavy.push({ path: h.path, bytes: sizes.get(h.path), elements: s.elements, images: s.images, imageTotalMB: h.imageTotalMB });
  }

  // Refresh-rate probe drawings at vault root.
  const refreshRate = [];
  for (const scene of refreshRateScenes(config)) {
    await put(scene.rel, scene.json);
    refreshRate.push({ path: scene.rel, pattern: scene.pattern, elements: scene.elements });
  }
  const hzPaths = new Set(refreshRate.map((r) => r.path));

  // Manifest (search counts mirror treeStore.searchEntries: case-insensitive
  // substring on path or name over all folder + drawing entries).
  const entries = [
    ...folders.map((p) => ({ path: p, name: path.posix.basename(p), kind: "folder" })),
    ...[...sizes.keys()].map((p) => ({ path: p, name: path.posix.basename(p), kind: "drawing" })),
  ];
  const count = (q, kind) => {
    const s = q.trim().toLowerCase();
    return entries.filter((e) => (!kind || e.kind === kind) && (e.path.toLowerCase().includes(s) || e.name.toLowerCase().includes(s))).length;
  };
  const searchQueries = {};
  const searchQueriesDrawingsOnly = {};
  for (const q of config.searchQueries) {
    searchQueries[q] = count(q);
    searchQueriesDrawingsOnly[q] = count(q, "drawing");
  }
  searchQueries[config.needle.query] = count(config.needle.query);

  const bigCount = [...sizes.keys()].filter((p) => path.posix.dirname(p) === config.bigFolder.path).length;
  if (bigCount !== config.bigFolder.drawings) throw new Error(`bigFolder has ${bigCount} drawings`);
  const ordinaryTotal = [...sizes.keys()].filter((p) => !Object.values(config.openTargets).includes(p) && !config.imageHeavy.some((h) => h.path === p) && !hzPaths.has(p)).length;
  if (ordinaryTotal !== config.drawingCount) throw new Error(`expected ${config.drawingCount} ordinary drawings, got ${ordinaryTotal}`);

  const manifest = {
    hash,
    drawingCount: config.drawingCount,
    totalDrawingFiles: sizes.size,
    totalBytes: [...sizes.values()].reduce((a, b) => a + b, 0),
    folders: folders.length,
    openTargets,
    imageHeavy,
    refreshRate,
    bigFolder: { path: config.bigFolder.path, drawings: bigCount },
    needle: { path: config.needle.path, query: config.needle.query },
    searchQueries,
    searchQueriesDrawingsOnly,
  };

  await fs.writeFile(path.join(tmpDir, COMPLETE_MARKER), `${hash}\n`);
  await fs.rm(vaultDir, { recursive: true, force: true });
  await fs.rename(tmpDir, vaultDir);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  for (const name of await fs.readdir(cacheDir)) {
    if ((name.startsWith("vault-") && !name.startsWith(vaultName)) || (name.startsWith(".tmp-vault-") && name !== path.basename(tmpDir))) {
      await fs.rm(path.join(cacheDir, name), { recursive: true, force: true });
    }
  }
  log(`[fixtures] generated ${vaultDir} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return { vaultDir, manifest };
}

// Building blocks reused by extraVaults.mjs.
export { mulberry32, hashSeed, textBlock, ordinaryScene, imageHeavyScene, openTargetScene, fileNameFor, sceneJson, generateElements };

// Small deterministic vaults for the opt-in perf modes: the "typical" personal vault (typical.config.json) and the
// second vault used by the leak scenario's vault switch. Same seed + config => byte-identical contents.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { GENERATOR_VERSION, mulberry32, hashSeed, ordinaryScene, imageHeavyScene, fileNameFor, generateElements, sceneJson, textBlock } from "./fixtures.mjs";

const COMPLETE_MARKER = ".perf-fixture-complete";
const EXT = ".excalidraw";
/** Root drawing that only the second vault has: the in-app leak scenario waits for it after the switch. */
export const ALT_MARKER = `perf-alt-marker${EXT}`;
const ALT_FOLDERS = { Notes: 8, Sketches: 6 };

/** Deterministic unique drawing paths: [{ dir, rel }] for `counts` = { folder: n } plus `rootCount` at the root. */
export function planPaths(seed, counts, rootCount, reserved = []) {
  const rng = mulberry32(seed);
  const used = new Set(reserved.map((p) => p.toLowerCase()));
  const out = [];
  const add = (dir) => {
    for (let attempt = 0; ; attempt++) {
      const name = fileNameFor(rng) + (attempt > 3 ? ` ${attempt}` : "");
      const rel = dir ? `${dir}/${name}${EXT}` : `${name}${EXT}`;
      if (!used.has(rel.toLowerCase())) {
        used.add(rel.toLowerCase());
        out.push({ dir, rel });
        return;
      }
    }
  };
  for (const [dir, n] of Object.entries(counts)) for (let i = 0; i < n; i++) add(dir);
  for (let i = 0; i < rootCount; i++) add("");
  return out;
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

/** Build `<cacheDir>/<name>-<hash>` once; `fill(tmpDir)` writes files and returns the manifest body. */
async function ensureCached({ cacheDir, name, config, fill }) {
  const hash = createHash("sha1").update(JSON.stringify(config) + `|${name}|gen${GENERATOR_VERSION}`).digest("hex").slice(0, 16);
  const vaultDir = path.join(cacheDir, `${name}-${hash}`);
  const manifestPath = path.join(cacheDir, `${name}-${hash}.manifest.json`);
  await fs.mkdir(cacheDir, { recursive: true });
  if ((await exists(path.join(vaultDir, COMPLETE_MARKER))) && (await exists(manifestPath))) {
    return { vaultDir, manifest: JSON.parse(await fs.readFile(manifestPath, "utf8")) };
  }
  const tmpDir = path.join(cacheDir, `.tmp-${name}-${process.pid}`);
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.mkdir(tmpDir, { recursive: true });
  const body = await fill(tmpDir);
  const manifest = { hash, ...body };
  await fs.writeFile(path.join(tmpDir, COMPLETE_MARKER), `${hash}\n`);
  await fs.rm(vaultDir, { recursive: true, force: true });
  await fs.rename(tmpDir, vaultDir);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  for (const entry of await fs.readdir(cacheDir)) {
    if (entry.startsWith(`${name}-`) && !entry.startsWith(`${name}-${hash}`)) await fs.rm(path.join(cacheDir, entry), { recursive: true, force: true });
  }
  return { vaultDir, manifest };
}

async function writeScene(root, rel, json) {
  await fs.mkdir(path.join(root, path.posix.dirname(rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), json);
  return Buffer.byteLength(json);
}

/** The typical vault: config.folders drawings per folder, config.rootDrawings at the root, plus config.target. */
export function ensureTypicalVault({ cacheDir, config }) {
  return ensureCached({
    cacheDir, name: "typical", config,
    fill: async (root) => {
      const target = config.target;
      const plan = planPaths(config.seed, config.folders, config.rootDrawings, [target.path]);
      let bytes = 0;
      for (const { rel } of plan) bytes += await writeScene(root, rel, ordinaryScene(mulberry32(hashSeed(config.seed, rel))));
      const heavy = imageHeavyScene(mulberry32(hashSeed(config.seed, "target", target.path)), target.path, target.imageTotalMB);
      const targetBytes = await writeScene(root, target.path, heavy.json);
      return {
        drawingCount: plan.length + 1,
        folders: Object.keys(config.folders),
        totalBytes: bytes + targetBytes,
        target: { path: target.path, bytes: targetBytes, elements: heavy.elements, images: heavy.images },
      };
    },
  });
}

/** The owner's typical use (2026-10-27): drawings of 12 shapes and about 100 lines of text, in `Notes/`. */
export const EVERYDAY_NOTES = ["Notes/everyday-a.excalidraw", "Notes/everyday-b.excalidraw", "Notes/everyday-c.excalidraw"];

/** 12 shapes in view at zoom 1 plus four 25-line text blocks (two in view, two below). */
export function everydayScene(rng) {
  const shapes = generateElements(rng, 12, 0, 900, 700, null);
  const texts = [[960, 40], [1300, 40], [40, 760], [700, 760]].map(([x, y], i) => textBlock(rng, x, y, shapes.length + i, 25));
  return sceneJson([...shapes, ...texts], {}, { scrollX: 0, scrollY: 0, zoom: { value: 1 } });
}

/** The typical vault plus the everyday note drawings (EVERYDAY_NOTES). */
export function ensureEverydayVault({ cacheDir, config }) {
  return ensureCached({
    cacheDir, name: "everyday", config: { ...config, everyday: EVERYDAY_NOTES },
    fill: async (root) => {
      const target = config.target;
      const plan = planPaths(config.seed, config.folders, config.rootDrawings, [target.path, ...EVERYDAY_NOTES]);
      let bytes = 0;
      for (const { rel } of plan) bytes += await writeScene(root, rel, ordinaryScene(mulberry32(hashSeed(config.seed, rel))));
      const heavy = imageHeavyScene(mulberry32(hashSeed(config.seed, "target", target.path)), target.path, target.imageTotalMB);
      bytes += await writeScene(root, target.path, heavy.json);
      for (const rel of EVERYDAY_NOTES) bytes += await writeScene(root, rel, everydayScene(mulberry32(hashSeed(config.seed, "everyday", rel))));
      return { drawingCount: plan.length + 1 + EVERYDAY_NOTES.length, folders: [...Object.keys(config.folders), "Notes"], totalBytes: bytes, notes: EVERYDAY_NOTES };
    },
  });
}

/** Second vault for the leak scenario's switch: a marker drawing at the root plus a few small drawings in two folders. */
export function ensureAltVault({ cacheDir, seed }) {
  return ensureCached({
    cacheDir, name: "alt", config: { seed, ALT_FOLDERS, ALT_MARKER },
    fill: async (root) => {
      const plan = planPaths(seed, ALT_FOLDERS, 0, [ALT_MARKER]);
      let bytes = await writeScene(root, ALT_MARKER, ordinaryScene(mulberry32(hashSeed(seed, ALT_MARKER))));
      for (const { rel } of plan) bytes += await writeScene(root, rel, ordinaryScene(mulberry32(hashSeed(seed, rel))));
      return { drawingCount: plan.length + 1, totalBytes: bytes, marker: ALT_MARKER };
    },
  });
}

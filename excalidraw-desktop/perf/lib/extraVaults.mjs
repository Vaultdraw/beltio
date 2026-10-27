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

const NOTE_WORDS = ("the of and to in is that for it with as was on be at by this have from or one had not but what all were when we there can an your which their said if do will each about how up out them then she many some so these would other into has more her two like him see time could no make than first been its who now people my made over did down only way find use may water long little very after words called just where most know get through back much before go good new write our used me man too any day same right look think also around another came come work three word must because does part even place well such here take why things help put years different away again off went old number great tell men say small every found still between name should home big give air line set own under read last never us left end along while might next sound below saw something thought both few those always looked show large often together asked house don't world going want school important until form food keep children feet land side without boy once animals life enough took sometimes four head above kind began almost live page got earth need far hand high year mother light parts country father let night following picture being study second eyes soon times story boys since white days ever paper hard near sentence better best across during today however sure knew try told young sun thing whole hear example heard several change answer room sea against top turned learn point city play toward five using himself usually").split(" ");

/** Deterministic Markdown notes: headings, #tags, [[links]], one code block; about `kb` KB each, 100 per folder. */
export function noteText(rng, i, count, kb) {
  const pick = () => NOTE_WORDS[Math.floor(rng() * NOTE_WORDS.length)];
  const sentence = () => { const n = 6 + Math.floor(rng() * 10); const w = Array.from({ length: n }, pick); w[0] = w[0][0].toUpperCase() + w[0].slice(1); return `${w.join(" ")}.`; };
  const target = kb * 1024;
  let out = `---\ntags: [${pick()}, ${pick()}]\n---\n# Note ${i}: ${pick()} ${pick()}\n\n`;
  let h = 0;
  while (out.length < target) {
    if (out.length > 0 && Math.floor(out.length / 700) > h) { h = Math.floor(out.length / 700); out += `\n## ${pick()} ${pick()}\n\n`; }
    let para = Array.from({ length: 3 + Math.floor(rng() * 4) }, sentence).join(" ");
    if (rng() < 0.3) para += ` See [[note-${Math.floor(rng() * count)}]] #${pick()}`;
    out += `${para}\n\n`;
    if (rng() < 0.05) out += "```js\nconst x = " + Math.floor(rng() * 1000) + ";\nconsole.log(x);\n```\n\n";
  }
  return out;
}

/** `baseVault` cloned plus `count` notes of about `kb` KB in folders of 100 (`Notes-N/note-i.md`). Cached by arguments. */
export async function ensureNotesVault({ cacheDir, baseVault, count, kb }) {
  const name = `notes-${count}x${kb}k`;
  const vaultDir = path.join(cacheDir, `${name}-${path.basename(baseVault)}`);
  if (await exists(path.join(vaultDir, COMPLETE_MARKER + "-notes"))) return { vaultDir };
  const tmpDir = `${vaultDir}.tmp-${process.pid}`;
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.cp(baseVault, tmpDir, { recursive: true });
  const rng = mulberry32(hashSeed(20261028, name));
  for (let i = 0; i < count; i++) {
    const dir = path.join(tmpDir, `Notes-${Math.floor(i / 100)}`);
    if (i % 100 === 0) await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `note-${i}.md`), noteText(rng, i, count, kb));
  }
  await fs.writeFile(path.join(tmpDir, COMPLETE_MARKER + "-notes"), "");
  await fs.rm(vaultDir, { recursive: true, force: true });
  await fs.rename(tmpDir, vaultDir);
  return { vaultDir };
}

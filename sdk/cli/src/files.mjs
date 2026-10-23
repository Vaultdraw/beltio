/** File helpers shared by `init` and `dev`. */
import { randomBytes } from "node:crypto";
import {
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  mkdirSync,
  lstatSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";

/** Names `init` and `dev` never copy: dependencies, version control, dot-files, tests. */
export const isExcluded = (/** @type {string} */ name) =>
  name === "node_modules" || name.startsWith(".") || /\.test\./.test(name);

/**
 * Regular files below `dir` as `/`-separated relative paths, skipping excluded names
 * and anything that is not a plain file or folder (symbolic links are not followed).
 * @param {string} dir
 * @returns {string[]} sorted
 */
export function listFiles(dir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} rel */
  const walk = (rel) => {
    for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (isExcluded(e.name)) {
        continue;
      }
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(r);
      } else if (e.isFile()) {
        out.push(r);
      }
    }
  };
  walk("");
  return out.sort();
}

/**
 * Writes `bytes` to `file` through a temp file in the same folder and a rename.
 * Returns false (and writes nothing) when the file already has exactly these bytes.
 * @param {string} file
 * @param {Buffer | string} bytes
 * @returns {boolean} whether the file was written
 */
export function writeIfChanged(file, bytes) {
  const buf = typeof bytes === "string" ? Buffer.from(bytes) : bytes;
  try {
    if (lstatSync(file).isFile() && readFileSync(file).equals(buf)) {
      return false;
    }
  } catch {
    // missing: write it
  }
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${randomBytes(4).toString("hex")}.tmp`,
  );
  try {
    writeFileSync(tmp, buf);
    renameSync(tmp, file);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // nothing to clean
    }
    throw e;
  }
  return true;
}

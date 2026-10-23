/**
 * `vaultdraw-plugin package <dir> [--out <dir>] [--json]`: a checked, reproducible
 * `<id>-<version>.zip` plus a `.zip.sha256` file (`<hex>  <file name>`).
 *
 * Which folder is packaged: the one given, when its plugin.toml `main` file exists.
 * Otherwise `<dir>/dist` when that holds a plugin.toml (the output of `build`).
 * Layout and limits: see zip.mjs.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { checkPlugin, formatText } from "./check.mjs";
import { EnvError } from "./dirs.mjs";
import { listFiles } from "./files.mjs";
import { isSafeRelPath } from "./manifest.mjs";
import { parseToml } from "./toml.mjs";

const isFile = (/** @type {string} */ p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * @param {string} dir
 * @returns {string} the folder to package
 */
export function resolvePackageRoot(dir) {
  const root = path.resolve(dir);
  const dist = path.join(root, "dist");
  const manifest = path.join(root, "plugin.toml");
  if (isFile(manifest)) {
    try {
      const main = parseToml(readFileSync(manifest, "utf8")).main;
      if (
        typeof main === "string" &&
        isSafeRelPath(main) &&
        !isFile(path.join(root, ...main.split("/"))) &&
        isFile(path.join(dist, "plugin.toml"))
      ) {
        return dist;
      }
    } catch {
      // the check reports it
    }
    return root;
  }
  return isFile(path.join(dist, "plugin.toml")) ? dist : root;
}

/**
 * @param {string} dir
 * @param {{ out?: string, json?: boolean }} opts
 * @param {(s: string) => void} out
 * @param {(s: string) => void} err
 * @returns {Promise<number>} the exit code
 */
export async function runPackage(dir, opts, out, err) {
  const { writeZip, ZipError } = await import("./zip.mjs");
  if (!existsSync(dir)) {
    throw new EnvError(`Folder not found: ${dir}`);
  }
  const root = resolvePackageRoot(dir);
  const result = checkPlugin(root);
  if (!result.ok) {
    (opts.json ? out : err)(
      opts.json
        ? JSON.stringify(
            {
              schemaVersion: 1,
              ok: false,
              errors: result.errors,
              warnings: result.warnings,
            },
            null,
            2,
          )
        : formatText(result, dir),
    );
    if (!opts.json) {
      err("Not packaged: fix the errors above first.");
    }
    return 1;
  }
  const doc = parseToml(readFileSync(path.join(root, "plugin.toml"), "utf8"));
  const base = `${doc.id}-${doc.version}`;
  const outDir = path.resolve(opts.out ?? process.cwd());
  const zipName = `${base}.zip`;
  const skip = new Set(
    path.dirname(path.join(outDir, zipName)) === root
      ? [zipName, `${zipName}.sha256`]
      : [],
  );
  const files = listFiles(root).filter((f) => !skip.has(f));
  let zip;
  try {
    zip = writeZip(
      files.map((name) => ({
        name,
        data: readFileSync(path.join(root, ...name.split("/"))),
      })),
    );
  } catch (e) {
    if (e instanceof ZipError) {
      err(`Not packaged: ${e.message}`);
      return 1;
    }
    throw e;
  }
  const sha256 = createHash("sha256").update(zip).digest("hex");
  mkdirSync(outDir, { recursive: true });
  const zipFile = path.join(outDir, zipName);
  writeFileSync(zipFile, zip);
  writeFileSync(`${zipFile}.sha256`, `${sha256}  ${zipName}\n`);
  if (opts.json) {
    out(
      JSON.stringify(
        {
          schemaVersion: 1,
          ok: true,
          file: zipFile,
          sha256,
          bytes: zip.length,
          entries: files.length,
        },
        null,
        2,
      ),
    );
  } else {
    for (const f of result.warnings) {
      err(`warning: ${f.message} [${f.code}] (${f.file})`);
    }
    out(
      `Packaged ${files.length} file${
        files.length === 1 ? "" : "s"
      } into ${zipFile} (${(zip.length / 1024).toFixed(1)} KB)`,
    );
    out(`sha256 ${sha256}`);
  }
  return 0;
}

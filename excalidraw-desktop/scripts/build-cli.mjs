// Builds the `vaultdraw` CLI and copies it to src-tauri/binaries/vaultdraw-<target-triple>,
// where Tauri's bundle.externalBin expects it. Runs as part of beforeBuildCommand.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cliBinaryName, planCliBuild } from "./cli-targets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = join(root, "src-tauri");
const manifest = join(tauriDir, "Cargo.toml");
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

// Tauri sets TAURI_ENV_TARGET_TRIPLE for beforeBuildCommand (e.g. universal builds run per triple).
const hostTriple = run("rustc", ["-vV"]).match(/^host: (.+)$/m)?.[1];
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple;
if (!triple) throw new Error("cannot determine the target triple from `rustc -vV`");

// Respects CARGO_TARGET_DIR and the workspace target directory.
const targetDir = JSON.parse(run("cargo", ["metadata", "--format-version", "1", "--no-deps", "--manifest-path", manifest])).target_directory;
const plan = planCliBuild(triple);
const outDir = join(tauriDir, "binaries");
const out = join(outDir, plan.fileName);
mkdirSync(outDir, { recursive: true });

// Builds the CLI for one rustc target and returns the binary path.
const buildFor = (t) => {
  const cross = t !== hostTriple;
  execFileSync(
    "cargo",
    ["build", "--release", "-p", "vaultdraw-cli", "--manifest-path", manifest, ...(cross ? ["--target", t] : [])],
    { stdio: "inherit" },
  );
  return join(targetDir, ...(cross ? [t] : []), "release", cliBinaryName(t));
};

if (plan.kind === "universal") {
  // `tauri build --target universal-apple-darwin` expects one fat sidecar under that name.
  // build.rs also checks the per-arch sidecar while compiling each slice, so keep those copies.
  const slices = plan.slices.map((t) => {
    const built = buildFor(t);
    const sliceOut = join(outDir, `vaultdraw-${t}`);
    copyFileSync(built, sliceOut);
    chmodSync(sliceOut, 0o755);
    return built;
  });
  execFileSync("lipo", ["-create", ...slices, "-output", out], { stdio: "inherit" });
} else {
  copyFileSync(buildFor(triple), out);
}
chmodSync(out, 0o755);
console.log(`vaultdraw CLI -> ${out}`);

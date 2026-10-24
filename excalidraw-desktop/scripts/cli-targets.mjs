// Which rustc target triples the CLI sidecar is built for, and how the file is named.
// Pure, so it can be tested on any host (build-cli.mjs does the building).

export const MAC_SLICES = ["aarch64-apple-darwin", "x86_64-apple-darwin"];

/**
 * Plans the CLI build for a target triple. Only `universal-apple-darwin` needs two builds and a fat
 * binary; every other triple (macOS, Linux gnu/musl, Windows, anything rustc knows) is one plain build.
 * @returns {{ kind: "universal" | "single", triple: string, slices: string[], fileName: string }}
 */
export function planCliBuild(triple) {
  if (!triple || typeof triple !== "string") throw new Error("a target triple is required");
  const exe = triple.includes("windows") ? ".exe" : "";
  const fileName = `vaultdraw-${triple}${exe}`;
  if (triple === "universal-apple-darwin") return { kind: "universal", triple, slices: MAC_SLICES, fileName };
  return { kind: "single", triple, slices: [triple], fileName };
}

/** Built binary name inside cargo's release folder. */
export const cliBinaryName = (triple) => `vaultdraw-cli${triple.includes("windows") ? ".exe" : ""}`;

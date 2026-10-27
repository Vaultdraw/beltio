import { DRAWING_EXT } from "../vault/fileKind";
import { decodeVaultUrl } from "../links/linkUri";

const EXT = DRAWING_EXT;

const normalize = (path: string): string => {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") {
      out.pop();
    } else if (part !== "" && part !== ".") {
      out.push(part);
    }
  }
  return out.join("/");
};

/**
 * The vault-relative drawing path a CLI target points at: a vaultdraw://open
 * link, an absolute path inside the vault, or a path relative to `cwd`.
 * null when it is outside the vault or no such drawing exists.
 */
export function resolveOpenTarget(
  target: string,
  cwd: string,
  vaultPath: string,
  hasDrawing: (path: string) => boolean,
): string | null {
  let rel: string;
  const linked = decodeVaultUrl(target);
  if (linked !== null) {
    rel = normalize(linked);
  } else {
    const abs = normalize(target.startsWith("/") ? target : `${cwd}/${target}`);
    const root = normalize(vaultPath);
    if (!abs.startsWith(`${root}/`)) {
      return null;
    }
    rel = abs.slice(root.length + 1);
  }
  const withExt = rel.toLowerCase().endsWith(EXT) ? rel : `${rel}${EXT}`;
  return [rel, withExt].find((p) => p && hasDrawing(p)) ?? null;
}

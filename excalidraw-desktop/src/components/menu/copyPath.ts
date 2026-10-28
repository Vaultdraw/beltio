import { encodeVaultUrl } from "../../links/linkUri";
import { toastStore } from "../../toasts/toastStore";

import type { CopyPathKind } from "./rowMenuModel";

/** The text a "Copy path" item puts on the clipboard. */
export function pathText(
  kind: CopyPathKind,
  path: string,
  vaultPath: string,
): string {
  if (kind === "relative") {
    return path;
  }
  if (kind === "link") {
    return encodeVaultUrl(path);
  }
  return `${vaultPath.replace(/[\\/]+$/, "")}/${path}`;
}

/** Copy, then say so in a toast; a failure is reported, never silent. */
export async function copyEntryPath(
  kind: CopyPathKind,
  path: string,
  vaultPath: string,
  win: Window | null = null,
): Promise<void> {
  const text = pathText(kind, path, vaultPath);
  try {
    await (win ?? window).navigator.clipboard.writeText(text);
    toastStore.push({ message: `Copied ${text}` });
  } catch {
    toastStore.push({ message: "Could not copy the path", kind: "error" });
  }
}

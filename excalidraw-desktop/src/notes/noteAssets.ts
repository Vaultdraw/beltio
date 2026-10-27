/**
 * Images a note embeds (`![[pic.png]]`, `![alt](pics/a.png)`) live in the
 * vault. `read_note_asset` returns their bytes (images only, size capped,
 * vault-relative, no dot folders); the view shows them through a blob URL,
 * kept per vault path and revoked when the note view closes. Outside the
 * desktop app there is nothing to read and the placeholder stays.
 */
import {
  isTauriAvailable,
  loadTauriInvoke,
} from "../vault/DesktopVaultRepository";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

export const isImagePath = (path: string): boolean =>
  /\.(?:png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(path);

/** Blob URLs made for one open note; `dispose` revokes them all. */
export function createAssetUrls(handle: string | null) {
  const urls = new Map<string, Promise<string | null>>();
  return {
    url(from: string, path: string): Promise<string | null> {
      const key = `${from}\n${path}`;
      let hit = urls.get(key);
      if (!hit) {
        hit = (async () => {
          if (handle === null || !isTauriAvailable(window)) {
            return null;
          }
          const invoke = await loadTauriInvoke();
          if (!invoke) {
            return null;
          }
          try {
            const bytes = await invoke<ArrayBuffer | number[]>(
              "read_note_asset",
              { handle, from, target: path },
            );
            const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
            const data =
              bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes);
            return URL.createObjectURL(
              new Blob([data], {
                type: MIME[ext] ?? "application/octet-stream",
              }),
            );
          } catch {
            return null;
          }
        })();
        urls.set(key, hit);
      }
      return hit;
    },
    dispose(): void {
      for (const p of urls.values()) {
        void p.then((u) => u && URL.revokeObjectURL(u));
      }
      urls.clear();
    },
  };
}

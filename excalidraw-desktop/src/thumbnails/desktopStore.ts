/** Tauri thumbnail store: thumbs_* commands + the vdthumb:// scheme. */
import { resolveInvoke } from "../vault/DesktopVaultRepository";

import type { InvokeFn } from "../vault/DesktopVaultRepository";
import type { LookupResult, ThumbnailStore } from "./store";

export const createDesktopThumbnailStore = (
  opts: { invoke?: InvokeFn } = {},
): ThumbnailStore => ({
  async lookup(handle, paths, renderVersion, failVersion) {
    const invoke = await resolveInvoke(opts.invoke);
    return invoke<LookupResult>("thumbs_lookup", {
      handle,
      paths,
      renderVersion,
      failVersion: failVersion ?? renderVersion,
    });
  },
  async put(handle, path, rev, png, renderVersion) {
    const invoke = await resolveInvoke(opts.invoke);
    // The PNG is the raw request body; the other arguments travel as headers.
    const body = png
      ? new Uint8Array(await png.arrayBuffer())
      : new Uint8Array();
    const res = await invoke<{ url: string | null }>("thumbs_put", body, {
      headers: {
        "x-handle": encodeURIComponent(handle),
        "x-path": encodeURIComponent(path),
        "x-revision": rev,
        "x-kind": png ? "png" : "fail",
        "x-render-version": String(renderVersion),
      },
    });
    return res?.url ?? null;
  },
  urlFor: (vaultId, rev, renderVersion) =>
    `vdthumb://localhost/${vaultId}/${rev}.v${renderVersion}.png`,
  async clear(handle) {
    const invoke = await resolveInvoke(opts.invoke);
    await invoke<void>("thumbs_clear", { handle });
  },
});

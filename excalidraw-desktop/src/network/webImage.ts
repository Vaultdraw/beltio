/**
 * The app's own picture download (a pasted picture address, toimprove #108 follow-up): the native
 * `network_fetch_image` command, with the same checks as the import's downloads (web pictures on,
 * public http or https only, 10 MiB, picture bytes). The browser build answers from the plugin
 * stand-in's table (`fakeFetchImage`), so tests drive both through one table.
 */
import { isTauriAvailable } from "../vault/DesktopVaultRepository";

const coded = (message: string, code?: string): Error =>
  Object.assign(new Error(message), { code });

export async function fetchWebImage(
  url: string,
  win: Window | null = typeof window === "undefined" ? null : window,
): Promise<Uint8Array> {
  if (isTauriAvailable(win)) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const buf = await invoke<ArrayBuffer>("network_fetch_image", { url });
      return new Uint8Array(buf);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      throw coded(e.message ?? String(err), e.code);
    }
  }
  const net = (
    win as unknown as { __plugins?: { backend?: { network?: unknown } } }
  )?.__plugins?.backend?.network;
  if (!net) {
    throw coded("No network in this build", "NETWORK_DISABLED");
  }
  const { fakeFetchImage } = await import("../plugins/host/fakeBackend");
  return fakeFetchImage(net as never, url);
}

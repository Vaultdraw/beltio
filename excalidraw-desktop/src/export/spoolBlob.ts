/**
 * Streams a Blob to a spool file owned by the app (`export.render` with `spool: true`): raw
 * 4 MiB chunks over Tauri IPC, so the whole image is never copied into a byte array, a base64
 * string or a JSON message. Pure: `invoke` is injected.
 */
export const SPOOL_CHUNK_BYTES = 4 * 1024 * 1024;

export type SpoolInvoke = (
  cmd: string,
  args?: unknown,
  options?: { headers?: Record<string, string> },
) => Promise<unknown>;

/** Writes `blob` to a new spool file and returns its absolute path; a failure removes the file. */
export const spoolBlob = async (
  invoke: SpoolInvoke,
  blob: Blob,
): Promise<string> => {
  const { id, path } = (await invoke("control_spool_begin")) as {
    id: string;
    path: string;
  };
  try {
    for (let at = 0; at < blob.size; at += SPOOL_CHUNK_BYTES) {
      const chunk = new Uint8Array(
        await blob.slice(at, at + SPOOL_CHUNK_BYTES).arrayBuffer(),
      );
      await invoke("control_spool_append", chunk, {
        headers: { "x-spool-id": id },
      });
    }
  } catch (e) {
    await invoke("control_spool_abort", { id }).catch(() => {});
    throw e;
  }
  return path;
};

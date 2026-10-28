import {
  errorMessage,
  type DrawingFile,
  type RecoveryEntry,
  type VaultChange,
  type VaultEntry,
  type VaultInfo,
  type VaultRepository,
} from "./types";

export type InvokeFn = <T>(
  cmd: string,
  args?: Record<string, unknown> | Uint8Array,
  options?: { headers?: Record<string, string> },
) => Promise<T>;
export type EventCallback<T> = (event: { payload: T }) => void;
export type ListenFn = <T>(
  event: string,
  handler: EventCallback<T>,
) => Promise<() => void>;

export class VaultError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

export interface DesktopVaultRepositoryOptions {
  invoke?: InvokeFn;
  listen?: ListenFn;
  ownerWindow?: Window | null;
}

export function isTauriAvailable(win?: Window | null): boolean {
  if (win) {
    const tauriWin = win as unknown as {
      __TAURI_INTERNALS__?: { invoke?: unknown };
      __TAURI__?: unknown;
    };
    if (tauriWin.__TAURI_INTERNALS__?.invoke || tauriWin.__TAURI__) {
      return true;
    }
  }
  return false;
}

/** Tauri's invoke, or null outside the desktop shell. */
export async function loadTauriInvoke(): Promise<InvokeFn | null> {
  try {
    const core = await import("@tauri-apps/api/core");
    if (typeof core.invoke === "function") {
      return core.invoke as InvokeFn;
    }
  } catch {
    // module not resolved or running outside desktop shell
  }
  return null;
}

/** Resolves the Tauri `invoke` (or an injected one); shared with other desktop bridges. */
export async function resolveInvoke(custom?: InvokeFn): Promise<InvokeFn> {
  if (custom) {
    return custom;
  }
  const invoke = await loadTauriInvoke();
  if (invoke) {
    return invoke;
  }
  throw new VaultError(
    "TAURI_UNAVAILABLE",
    "Vaultdraw desktop backend is not available. Browser preview cannot persist files to disk.",
  );
}

/** Resolves the Tauri `listen` (or an injected one). */
export async function resolveListen(custom?: ListenFn): Promise<ListenFn> {
  if (custom) {
    return custom;
  }
  try {
    const event = await import("@tauri-apps/api/event");
    if (typeof event.listen === "function") {
      return event.listen as ListenFn;
    }
  } catch {
    // module not resolved or running outside desktop shell
  }
  throw new VaultError(
    "TAURI_UNAVAILABLE",
    "Event listening is not available outside the Vaultdraw desktop app.",
  );
}

export function normalizeError(cause: unknown): Error {
  if (cause instanceof VaultError) {
    return cause;
  }
  if (cause && typeof cause === "object") {
    const obj = cause as { code?: unknown; message?: unknown };
    const code = typeof obj.code === "string" ? obj.code : "VAULT_ERROR";
    const msg =
      typeof obj.message === "string" ? obj.message : errorMessage(cause);
    return new VaultError(code, msg);
  }
  return new Error(errorMessage(cause));
}

const REVISION_HEX_LENGTH = 64;
const FRAME_PREFIX_LENGTH = REVISION_HEX_LENGTH + 1;

/** Splits a `<revision>\n<json>` frame returned by `read_drawing`. */
export function decodeDrawingFrame(buffer: ArrayBuffer): DrawingFile {
  if (!buffer || buffer.byteLength < FRAME_PREFIX_LENGTH) {
    throw new VaultError("INVALID_FILE", "Malformed drawing response");
  }
  const revision = new TextDecoder().decode(
    new Uint8Array(buffer, 0, REVISION_HEX_LENGTH),
  );
  const json = new TextDecoder().decode(
    new Uint8Array(buffer, FRAME_PREFIX_LENGTH),
  );
  return { json, revision };
}

/**
 * DesktopVaultRepository bridges renderer calls to native Tauri 2 commands
 * via typed IPC with exact snake_case command names and camelCase arguments.
 */
export class DesktopVaultRepository implements VaultRepository {
  private customInvoke?: InvokeFn;
  private customListen?: ListenFn;
  private ownerWindow?: Window | null;
  private reopenPromise: Promise<VaultInfo | null> | null = null;

  constructor(options?: DesktopVaultRepositoryOptions) {
    this.customInvoke = options?.invoke;
    this.customListen = options?.listen;
    this.ownerWindow = options?.ownerWindow;

    this.chooseVault = this.chooseVault.bind(this);
    this.reopenVault = this.reopenVault.bind(this);
    this.releaseVault = this.releaseVault.bind(this);
    this.retryVault = this.retryVault.bind(this);
    this.listDirectory = this.listDirectory.bind(this);
    this.readDrawing = this.readDrawing.bind(this);
    this.readRevision = this.readRevision.bind(this);
    this.writeDrawing = this.writeDrawing.bind(this);
    this.createFolder = this.createFolder.bind(this);
    this.move = this.move.bind(this);
    this.trash = this.trash.bind(this);
    this.reveal = this.reveal.bind(this);
    this.exportFile = this.exportFile.bind(this);
    this.saveDrawingCopy = this.saveDrawingCopy.bind(this);
    this.listRecovery = this.listRecovery.bind(this);
    this.discardRecovery = this.discardRecovery.bind(this);
    this.subscribe = this.subscribe.bind(this);
  }

  private getInvoke(): Promise<InvokeFn> {
    return resolveInvoke(this.customInvoke);
  }

  private getListen(): Promise<ListenFn> {
    return resolveListen(this.customListen);
  }

  async chooseVault(create?: boolean): Promise<VaultInfo | null> {
    const invoke = await this.getInvoke();
    try {
      return await invoke<VaultInfo | null>("choose_vault", {
        create: Boolean(create),
      });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async reopenVault(): Promise<VaultInfo | null> {
    if (this.reopenPromise) {
      return this.reopenPromise;
    }
    this.reopenPromise = (async () => {
      try {
        const invoke = await this.getInvoke();
        return await invoke<VaultInfo | null>("reopen_vault");
      } catch (err) {
        throw normalizeError(err);
      } finally {
        this.reopenPromise = null;
      }
    })();
    return this.reopenPromise;
  }

  async releaseVault(handle: string): Promise<void> {
    const invoke = await this.getInvoke();
    try {
      await invoke<void>("release_vault", { handle });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async retryVault(handle: string): Promise<VaultInfo> {
    const invoke = await this.getInvoke();
    try {
      return await invoke<VaultInfo>("retry_vault", { handle });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async listDirectory(handle: string, path: string): Promise<VaultEntry[]> {
    const invoke = await this.getInvoke();
    try {
      return await invoke<VaultEntry[]>("list_directory", { handle, path });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  /**
   * The native side frames the reply as `<64 hex revision>\n<json utf-8>` in one
   * ArrayBuffer, so the content never goes through JSON string escaping.
   */
  async readDrawing(handle: string, path: string): Promise<DrawingFile> {
    const invoke = await this.getInvoke();
    try {
      const framed = await invoke<ArrayBuffer>("read_drawing", {
        handle,
        path,
      });
      return decodeDrawingFrame(framed);
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async readRevision(handle: string, path: string): Promise<string | null> {
    const invoke = await this.getInvoke();
    try {
      return await invoke<string | null>("drawing_revision", { handle, path });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  /** The scene is the raw request body; the other arguments travel as headers. */
  async writeDrawing(input: {
    handle: string;
    path: string;
    json: string;
    expectedRevision: string | null;
    operationId: string;
  }): Promise<{ revision: string }> {
    const invoke = await this.getInvoke();
    try {
      return await invoke<{ revision: string }>(
        "write_drawing",
        new TextEncoder().encode(input.json),
        {
          headers: {
            "x-handle": encodeURIComponent(input.handle),
            "x-path": encodeURIComponent(input.path),
            "x-expected-revision": encodeURIComponent(
              input.expectedRevision ?? "",
            ),
            "x-operation-id": encodeURIComponent(input.operationId),
          },
        },
      );
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async createFolder(handle: string, path: string): Promise<void> {
    const invoke = await this.getInvoke();
    try {
      await invoke<void>("create_folder", { handle, path });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async move(handle: string, from: string, to: string): Promise<void> {
    const invoke = await this.getInvoke();
    try {
      await invoke<void>("move_entry", { handle, from, to });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async downloadPlaceholder(handle: string, path: string): Promise<void> {
    const invoke = await this.getInvoke();
    try {
      await invoke<void>("sync_download_placeholder", { handle, path });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async trash(handle: string, path: string): Promise<void> {
    const invoke = await this.getInvoke();
    try {
      await invoke<void>("trash_entry", { handle, path });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async reveal(handle: string, path: string): Promise<void> {
    const invoke = await this.getInvoke();
    try {
      await invoke<void>("reveal_entry", { handle, path });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async revealRecovery(handle: string): Promise<void> {
    const invoke = await this.getInvoke();
    try {
      await invoke<void>("reveal_recovery_dir", { handle });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async exportFile(name: string, bytes: Uint8Array): Promise<boolean> {
    const invoke = await this.getInvoke();
    try {
      return await invoke<boolean>("export_file", bytes, {
        headers: { "x-file-name": encodeURIComponent(name) },
      });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async saveDrawingCopy(handle: string, path: string): Promise<boolean> {
    const invoke = await this.getInvoke();
    try {
      return await invoke<boolean>("save_drawing_copy", { handle, path });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async listRecovery(handle: string): Promise<RecoveryEntry[]> {
    const invoke = await this.getInvoke();
    try {
      return await invoke<RecoveryEntry[]>("list_recovery", { handle });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async discardRecovery(handle: string, id: string): Promise<void> {
    const invoke = await this.getInvoke();
    try {
      await invoke<void>("discard_recovery", { handle, id });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async subscribe(listener: (event: VaultChange) => void): Promise<() => void> {
    if (
      this.ownerWindow &&
      !isTauriAvailable(this.ownerWindow) &&
      !this.customListen
    ) {
      return () => {};
    }
    const listen = await this.getListen();
    try {
      const unlisten = await listen<VaultChange>("vault-change", (event) => {
        listener(event.payload);
      });
      return unlisten;
    } catch (err) {
      throw normalizeError(err);
    }
  }
}

export const desktopRepository = new DesktopVaultRepository();

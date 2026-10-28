/**
 * Test-only FakeVaultRepository.
 *
 * NEVER a production fallback. Implements the shared `VaultRepository`
 * contract from `../vault/types.ts` with an in-memory filesystem so QA tests
 * can run before the native Rust backend and UI workers land.
 */
import { conflictOriginal, numberedCopyOriginal } from "../vault/syncNames";
import { fileKind } from "../vault/fileKind";

import type {
  DrawingFile,
  RecoveryEntry,
  VaultChange,
  VaultEntry,
  VaultInfo,
  VaultRepository,
} from "../vault/types";

export type FakeErrorCode =
  | "CONFLICT"
  | "NAME_COLLISION"
  | "NOT_FOUND"
  | "INVALID_PATH"
  | "READ_ONLY"
  | "DISK_FULL";

export class FakeVaultError extends Error {
  code: FakeErrorCode;
  constructor(code: FakeErrorCode, message: string) {
    super(message);
    this.name = "FakeVaultError";
    this.code = code;
  }
  toJSON() {
    return { code: this.code, message: this.message };
  }
}

const makeError = (code: FakeErrorCode, message: string) =>
  new FakeVaultError(code, message);

/** Shared path rules mirrored from the native spec (renderer-friendly copy). */
export function assertValidRelativePath(path: string): void {
  if (path === "") {
    return; // vault root
  }
  if (path.startsWith("/") || path.startsWith("\\")) {
    throw makeError("INVALID_PATH", `absolute path rejected: ${path}`);
  }
  if (path.includes("\\")) {
    throw makeError("INVALID_PATH", `backslash separator rejected: ${path}`);
  }
  if (path === "." || path === "..") {
    throw makeError("INVALID_PATH", `reserved path rejected: ${path}`);
  }
  const segments = path.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      throw makeError(
        "INVALID_PATH",
        `traversal/empty segment rejected: ${path}`,
      );
    }
  }
  if (segments.some((s) => s === ".excalidraw-vault")) {
    // Reserved metadata dir is excluded from normal tree/search in prod;
    // fake rejects writes through the drawing API to surface misuse.
    throw makeError("INVALID_PATH", `reserved metadata path rejected: ${path}`);
  }
}

export function assertValidDrawingPath(path: string): void {
  assertValidRelativePath(path);
  if (path === "") {
    throw makeError("INVALID_PATH", "drawing path must not be vault root");
  }
  if (!path.endsWith(".excalidraw")) {
    throw makeError("INVALID_PATH", `drawing must end in .excalidraw: ${path}`);
  }
}

/** Like the native reader: `.excalidraw` drawings and read-only Obsidian `.excalidraw.md` files. */
function assertReadableDrawingPath(path: string): void {
  if (fileKind(path) === "excalidrawMd") {
    assertValidRelativePath(path);
    return;
  }
  assertValidDrawingPath(path);
}

type FileRow = { json: string; revision: string };

export interface FakeVaultOptions {
  readOnly?: boolean;
  /** Artificial latency (ms) applied to read/write for race tests. */
  latencyMs?: number;
  /** When set, writeDrawing rejects with DISK_FULL. */
  failWrites?: boolean;
  handle?: string;
  vaultPath?: string;
  vaultName?: string;
  readOnlyReason?: VaultInfo["readOnlyReason"];
  lockHolderPid?: number;
}

export class FakeVaultRepository implements VaultRepository {
  readonly vault: VaultInfo;
  private files = new Map<string, FileRow>();
  private folders = new Set<string>([""]);
  private recovery = new Map<string, RecoveryEntry>();
  private listeners = new Set<(event: VaultChange) => void>();
  private revisionCounter = 0;
  private recoveryCounter = 0;
  private released = false;
  latencyMs: number;
  failWrites: boolean;
  writeCalls: Array<{ path: string; expectedRevision: string | null }> = [];
  exported: Array<{ name: string; bytes: Uint8Array }> = [];

  constructor(options: FakeVaultOptions = {}) {
    this.vault = {
      handle: options.handle ?? "fake-handle-1",
      path: options.vaultPath ?? "/fake/My Vault",
      name: options.vaultName ?? "My Vault",
      readOnly: options.readOnly ?? false,
      readOnlyReason: options.readOnly ? options.readOnlyReason : undefined,
      lockHolderPid: options.readOnly ? options.lockHolderPid : undefined,
    };
    this.latencyMs = options.latencyMs ?? 0;
    this.failWrites = options.failWrites ?? false;
  }

  get handle(): string {
    return this.vault.handle;
  }

  private nextRevision(): string {
    this.revisionCounter += 1;
    return `rev-${this.revisionCounter}`;
  }

  private async delay(): Promise<void> {
    if (this.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.latencyMs));
    }
  }

  private ensureOpen(handle: string): void {
    if (this.released) {
      throw makeError("NOT_FOUND", "vault released");
    }
    if (handle !== this.vault.handle) {
      throw makeError("NOT_FOUND", `unknown vault handle: ${handle}`);
    }
  }

  private ensureWritable(): void {
    if (this.vault.readOnly) {
      throw makeError("READ_ONLY", "vault is read-only");
    }
  }

  /** Pin a drawing's reported modified time (listings default to now). */
  setModified(path: string, modifiedAt: number): void {
    this.mtimes.set(path, modifiedAt);
  }

  private mtimes = new Map<string, number>();

  /** Seed helper: create folder chain implicitly. */
  seedDrawing(path: string, json: string): string {
    assertReadableDrawingPath(path);
    const parent = path.includes("/")
      ? path.slice(0, path.lastIndexOf("/"))
      : "";
    this.seedFolder(parent);
    const revision = this.nextRevision();
    this.files.set(path, { json, revision });
    return revision;
  }

  /** A Markdown note (listed as `note`; it has no drawing content). */
  seedNote(path: string): void {
    assertValidRelativePath(path);
    this.seedFolder(
      path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
    );
    this.notes.add(path);
  }

  private notes = new Set<string>();

  seedFolder(path: string): void {
    if (path === "") {
      return;
    }
    assertValidRelativePath(path);
    const parts = path.split("/");
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      this.folders.add(acc);
    }
  }

  /** Simulate an out-of-band edit (e.g. another program). Bypasses revision. */
  externalWrite(path: string, json: string): string {
    assertValidDrawingPath(path);
    const revision = this.nextRevision();
    this.files.set(path, { json, revision });
    this.emit({ handle: this.vault.handle, paths: [path], rescan: false });
    return revision;
  }

  externalDelete(path: string): void {
    this.files.delete(path);
    // Remove now-empty ancestor bookkeeping is unnecessary for the fake.
    this.emit({ handle: this.vault.handle, paths: [path], rescan: false });
  }

  seedRecovery(path: string, json: string): RecoveryEntry {
    this.recoveryCounter += 1;
    const entry: RecoveryEntry = {
      id: `recovery-${this.recoveryCounter}`,
      path,
      modifiedAt: Date.now(),
      json,
    };
    this.recovery.set(entry.id, entry);
    return entry;
  }

  emit(event: VaultChange): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  // -- VaultRepository ----------------------------------------------------

  async chooseVault(): Promise<VaultInfo | null> {
    return { ...this.vault };
  }

  async reopenVault(): Promise<VaultInfo | null> {
    return this.released ? null : { ...this.vault };
  }

  /** retryVault frees the lock (true) or still finds it held (false). */
  retryFreesLock = true;
  private retired = new Set<string>();

  async retryVault(handle: string): Promise<VaultInfo> {
    this.ensureOpen(handle);
    const fresh = `${handle}+`;
    if (!this.retryFreesLock) {
      this.retired.add(fresh);
      return { ...this.vault, handle: fresh };
    }
    this.retired.add(handle);
    Object.assign(this.vault, {
      handle: fresh,
      readOnly: false,
      readOnlyReason: null,
      lockHolderPid: null,
    });
    return { ...this.vault };
  }

  async releaseVault(handle: string): Promise<void> {
    if (this.retired.delete(handle)) {
      return;
    }
    this.ensureOpen(handle);
    this.released = true;
    this.listeners.clear();
  }

  async listDirectory(handle: string, path: string): Promise<VaultEntry[]> {
    this.ensureOpen(handle);
    assertValidRelativePath(path);
    await this.delay();
    const prefix = path === "" ? "" : `${path}/`;
    if (path !== "" && !this.folders.has(path)) {
      throw makeError("NOT_FOUND", `folder not found: ${path}`);
    }
    const rows = new Map<string, VaultEntry>();
    for (const folder of this.folders) {
      if (folder === "" || folder === path) {
        continue;
      }
      if (folder.startsWith(prefix)) {
        const rest = folder.slice(prefix.length);
        // Dot-named entries (.obsidian, .trash, .git) are never listed natively.
        if (rest && !rest.includes("/") && !rest.startsWith(".")) {
          rows.set(rest, {
            path: folder,
            name: rest,
            kind: "folder",
            modifiedAt: Date.now(),
            size: 0,
          });
        }
      }
    }
    for (const [filePath, row] of this.files) {
      if (filePath.startsWith(prefix)) {
        const rest = filePath.slice(prefix.length);
        if (rest && !rest.includes("/") && !rest.startsWith(".")) {
          rows.set(rest, {
            path: filePath,
            name: rest,
            kind:
              fileKind(filePath) === "excalidrawMd"
                ? "excalidrawMd"
                : "drawing",
            modifiedAt: this.mtimes.get(filePath) ?? Date.now(),
            size: row.json.length,
          });
        }
      }
    }
    for (const notePath of this.notes) {
      if (notePath.startsWith(prefix)) {
        const rest = notePath.slice(prefix.length);
        if (rest && !rest.includes("/") && !rest.startsWith(".")) {
          rows.set(rest, {
            path: notePath,
            name: rest,
            kind: "note",
            modifiedAt: Date.now(),
            size: 0,
          });
        }
      }
    }
    // Conflict copies, as the native listing flags them.
    for (const row of rows.values()) {
      if (row.kind === "folder") {
        continue;
      }
      const original =
        conflictOriginal(row.name) ??
        ((o) => (o && rows.has(o) ? o : null))(numberedCopyOriginal(row.name));
      if (original) {
        row.sync = "conflict";
        row.conflictOf = prefix + original;
      }
    }
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async readDrawing(handle: string, path: string): Promise<DrawingFile> {
    this.ensureOpen(handle);
    assertReadableDrawingPath(path);
    await this.delay();
    const row = this.files.get(path);
    if (!row) {
      throw makeError("NOT_FOUND", `drawing not found: ${path}`);
    }
    return { json: row.json, revision: row.revision };
  }

  /**
   * Mirrors the native rules for a NEW name: a dot-named component is refused (never listed), and
   * a sibling whose name differs only in ASCII case is a collision (case-insensitive file systems).
   */
  private checkNewName(path: string): void {
    if (path.split("/").some((part) => part.startsWith("."))) {
      throw makeError(
        "INVALID_PATH",
        "Names starting with a dot are reserved and never listed or written",
      );
    }
    const slash = path.lastIndexOf("/");
    const parent = slash < 0 ? "" : path.slice(0, slash);
    const name = path.slice(slash + 1).toLowerCase();
    const siblings = [...this.files.keys(), ...this.folders, ...this.notes];
    for (const other of siblings) {
      const s = other.lastIndexOf("/");
      if (
        (s < 0 ? "" : other.slice(0, s)) === parent &&
        other.slice(s + 1).toLowerCase() === name
      ) {
        throw makeError(
          "NAME_COLLISION",
          "A case-insensitive name collision already exists",
        );
      }
    }
  }

  async writeDrawing(input: {
    handle: string;
    path: string;
    json: string;
    expectedRevision: string | null;
    operationId: string;
  }): Promise<{ revision: string }> {
    this.ensureOpen(input.handle);
    this.ensureWritable();
    assertValidDrawingPath(input.path);
    if (!input.operationId) {
      throw makeError("INVALID_PATH", "operationId is required");
    }
    await this.delay();
    this.writeCalls.push({
      path: input.path,
      expectedRevision: input.expectedRevision,
    });
    if (this.failWrites) {
      throw makeError("DISK_FULL", "simulated disk full");
    }
    const existing = this.files.get(input.path);
    if (input.expectedRevision === null) {
      // Create-only: never overwrite.
      if (existing) {
        throw makeError("NAME_COLLISION", `already exists: ${input.path}`);
      }
      this.checkNewName(input.path);
      const revision = this.nextRevision();
      const parent = input.path.includes("/")
        ? input.path.slice(0, input.path.lastIndexOf("/"))
        : "";
      this.seedFolder(parent);
      this.files.set(input.path, { json: input.json, revision });
      this.emit({
        handle: this.vault.handle,
        paths: [input.path],
        rescan: false,
      });
      return { revision };
    }
    if (!existing) {
      throw makeError("NOT_FOUND", `drawing not found: ${input.path}`);
    }
    if (existing.revision !== input.expectedRevision) {
      throw makeError("CONFLICT", `revision mismatch for ${input.path}`);
    }
    const revision = this.nextRevision();
    this.files.set(input.path, { json: input.json, revision });
    this.emit({
      handle: this.vault.handle,
      paths: [input.path],
      rescan: false,
    });
    return { revision };
  }

  async createFolder(handle: string, path: string): Promise<void> {
    this.ensureOpen(handle);
    this.ensureWritable();
    assertValidRelativePath(path);
    if (path === "") {
      throw makeError("INVALID_PATH", "cannot create vault root");
    }
    if (path.endsWith(".excalidraw")) {
      throw makeError(
        "INVALID_PATH",
        `folder must not use .excalidraw: ${path}`,
      );
    }
    await this.delay();
    if (this.files.has(path) || this.folders.has(path)) {
      throw makeError("NAME_COLLISION", `already exists: ${path}`);
    }
    this.checkNewName(path);
    this.seedFolder(path);
    this.emit({ handle: this.vault.handle, paths: [path], rescan: false });
  }

  async move(handle: string, from: string, to: string): Promise<void> {
    this.ensureOpen(handle);
    this.ensureWritable();
    assertValidRelativePath(from);
    assertValidRelativePath(to);
    if (from === "" || to === "") {
      throw makeError("INVALID_PATH", "cannot move vault root");
    }
    if (to.startsWith(from === "" ? "" : `${from}/`)) {
      throw makeError("INVALID_PATH", "cannot move a folder into itself");
    }
    await this.delay();
    const isFile = this.files.has(from);
    const isFolder = this.folders.has(from);
    if (!isFile && !isFolder) {
      throw makeError("NOT_FOUND", `source not found: ${from}`);
    }
    if (this.files.has(to) || this.folders.has(to)) {
      throw makeError("NAME_COLLISION", `destination exists: ${to}`);
    }
    if (to.toLowerCase() !== from.toLowerCase()) {
      this.checkNewName(to);
    }
    if (isFile) {
      assertValidDrawingPath(to);
      const row = this.files.get(from)!;
      const parent = to.includes("/") ? to.slice(0, to.lastIndexOf("/")) : "";
      this.seedFolder(parent);
      this.files.delete(from);
      // Keep the same revision on rename (content unchanged); native keeps
      // hash of bytes so this matches observable behavior.
      this.files.set(to, row);
      this.emit({ handle: this.vault.handle, paths: [from, to], rescan: true });
      return;
    }
    // Folder move: relocate descendant files + folders.
    const destParent = to.includes("/") ? to.slice(0, to.lastIndexOf("/")) : "";
    this.seedFolder(destParent);
    const moved: string[] = [from, to];
    for (const folder of [...this.folders]) {
      if (folder === from || folder.startsWith(`${from}/`)) {
        const rest = folder === from ? "" : folder.slice(from.length + 1);
        const next = rest ? `${to}/${rest}` : to;
        this.folders.delete(folder);
        this.folders.add(next);
        moved.push(next);
      }
    }
    for (const [filePath, row] of [...this.files]) {
      if (filePath === from || filePath.startsWith(`${from}/`)) {
        const rest = filePath === from ? "" : filePath.slice(from.length + 1);
        const next = rest ? `${to}/${rest}` : to;
        this.files.delete(filePath);
        this.files.set(next, row);
        moved.push(next);
      }
    }
    this.emit({ handle: this.vault.handle, paths: moved, rescan: true });
  }

  async trash(handle: string, path: string): Promise<void> {
    this.ensureOpen(handle);
    this.ensureWritable();
    assertValidRelativePath(path);
    if (path === "") {
      throw makeError("INVALID_PATH", "cannot trash vault root");
    }
    await this.delay();
    if (this.files.has(path)) {
      this.files.delete(path);
      this.emit({ handle: this.vault.handle, paths: [path], rescan: false });
      return;
    }
    if (this.folders.has(path)) {
      // Fake refuses non-empty folder trash like the native may; tests assert
      // this conservative behavior.
      const prefix = `${path}/`;
      const hasChildren =
        [...this.files.keys()].some((f) => f.startsWith(prefix)) ||
        [...this.folders].some((f) => f !== path && f.startsWith(prefix));
      if (hasChildren) {
        throw makeError("NAME_COLLISION", `folder not empty: ${path}`);
      }
      this.folders.delete(path);
      this.emit({ handle: this.vault.handle, paths: [path], rescan: true });
      return;
    }
    throw makeError("NOT_FOUND", `path not found: ${path}`);
  }

  async reveal(handle: string, path: string): Promise<void> {
    // No-op in tests; native reveals in the OS file manager.
    this.ensureOpen(handle);
    assertValidRelativePath(path);
  }

  async revealRecovery(handle: string): Promise<void> {
    this.ensureOpen(handle);
  }

  async exportFile(name: string, bytes: Uint8Array): Promise<boolean> {
    if (!name) {
      throw makeError("INVALID_PATH", "export name is required");
    }
    this.exported.push({ name, bytes });
    return true;
  }

  async saveDrawingCopy(handle: string, path: string): Promise<boolean> {
    this.ensureOpen(handle);
    assertValidRelativePath(path);
    const row = this.files.get(path);
    if (!row) {
      throw makeError("NOT_FOUND", `drawing not found: ${path}`);
    }
    // Native copies the file's bytes; the fake's file is its JSON text.
    return this.exportFile(
      path.split("/").pop()!,
      new TextEncoder().encode(row.json),
    );
  }

  async listRecovery(handle: string): Promise<RecoveryEntry[]> {
    this.ensureOpen(handle);
    await this.delay();
    return [...this.recovery.values()].sort(
      (a, b) => b.modifiedAt - a.modifiedAt,
    );
  }

  async discardRecovery(handle: string, id: string): Promise<void> {
    this.ensureOpen(handle);
    if (!this.recovery.delete(id)) {
      throw makeError("NOT_FOUND", `recovery not found: ${id}`);
    }
  }

  async subscribe(listener: (event: VaultChange) => void): Promise<() => void> {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

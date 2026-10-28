/**
 * Test-only FakeLibraryRepository. NEVER a production fallback.
 * In-memory files with counter revisions and CONFLICT semantics matching the
 * Rust `read_library` / `write_library` contract.
 */
import type {
  LibraryChange,
  LibraryReadResult,
  LibraryRepository,
  LibraryScope,
} from "../library/types";

type FakeFile = { json: string; revision: number };

export class FakeLibraryError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "FakeLibraryError";
  }
}

export class FakeLibraryRepository implements LibraryRepository {
  readonly files = new Map<string, FakeFile>();
  readonly readOnlyKeys = new Set<string>();
  readonly writes: { key: string; json: string }[] = [];
  readLog: { key: string; unchanged: boolean }[] = [];
  pickResult: { name: string; json: string } | null = null;
  exported: { name: string; bytes: Uint8Array }[] = [];
  private listeners = new Set<(event: LibraryChange) => void>();
  private counter = 0;

  private key(
    scope: LibraryScope,
    handle: string | null,
    name?: string | null,
  ) {
    const base = scope === "personal" ? "personal" : `${scope}:${handle}`;
    return name ? `${base}|${name}` : base;
  }

  /** Stems of the named libraries stored for a scope. */
  names(scope: LibraryScope, handle: string | null): string[] {
    const prefix = `${this.key(scope, handle)}|`;
    return [...this.files.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length))
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  async listLibraries(scope: LibraryScope, handle: string | null) {
    return this.names(scope, handle);
  }

  async createLibrary(
    scope: LibraryScope,
    handle: string | null,
    name: string,
  ) {
    const key = this.key(scope, handle, name);
    if (this.files.has(key)) {
      throw new FakeLibraryError("CONFLICT", "exists");
    }
    this.files.set(key, {
      json: '{"type":"excalidrawlib","version":2,"libraryItems":[]}',
      revision: ++this.counter,
    });
    this.emit({ scope, ...(handle ? { handle } : {}) });
  }

  async renameLibrary(
    scope: LibraryScope,
    handle: string | null,
    name: string,
    newName: string,
  ) {
    const from = this.key(scope, handle, name);
    const to = this.key(scope, handle, newName);
    const file = this.files.get(from);
    if (!file) {
      throw new FakeLibraryError("NOT_FOUND", "missing");
    }
    if (this.files.has(to)) {
      throw new FakeLibraryError("CONFLICT", "exists");
    }
    this.files.delete(from);
    this.files.set(to, { ...file, revision: ++this.counter });
    this.emit({ scope, ...(handle ? { handle } : {}) });
  }

  readonly removed: string[] = [];
  async deleteLibrary(
    scope: LibraryScope,
    handle: string | null,
    name: string,
  ) {
    const key = this.key(scope, handle, name);
    this.files.delete(key);
    this.removed.push(key);
    this.emit({ scope, ...(handle ? { handle } : {}) });
  }

  /** Simulates an external edit (another window, a sync tool, the user). */
  setFile(
    scope: LibraryScope,
    json: string | null,
    handle?: string,
    name?: string,
  ) {
    const key = this.key(scope, handle ?? null, name);
    if (json === null) {
      this.files.delete(key);
    } else {
      this.files.set(key, { json, revision: ++this.counter });
    }
    this.emit({ scope, ...(scope === "vault" ? { handle } : {}) });
  }

  getJson(scope: LibraryScope, handle?: string, name?: string): string | null {
    return this.files.get(this.key(scope, handle ?? null, name))?.json ?? null;
  }

  emit(event: LibraryChange) {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  async readLibrary(
    scope: LibraryScope,
    handle: string | null,
    knownRevision: string | null,
    name?: string | null,
  ): Promise<LibraryReadResult> {
    const key = this.key(scope, handle, name);
    const file = this.files.get(key);
    const base = { path: key, readOnly: this.readOnlyKeys.has(key) };
    if (!file) {
      this.readLog.push({ key, unchanged: false });
      return { ...base, json: null, revision: null, unchanged: false };
    }
    const revision = String(file.revision);
    const unchanged = knownRevision === revision;
    this.readLog.push({ key, unchanged });
    return { ...base, json: unchanged ? null : file.json, revision, unchanged };
  }

  async writeLibrary(
    scope: LibraryScope,
    handle: string | null,
    json: string,
    expectedRevision: string | null,
    name?: string | null,
  ) {
    const key = this.key(scope, handle, name);
    if (this.readOnlyKeys.has(key)) {
      throw new FakeLibraryError("READ_ONLY", "read only");
    }
    const file = this.files.get(key);
    const current = file ? String(file.revision) : null;
    if (current !== expectedRevision) {
      throw new FakeLibraryError("CONFLICT", "library changed on disk");
    }
    const next = { json, revision: ++this.counter };
    this.files.set(key, next);
    this.writes.push({ key, json });
    return { revision: String(next.revision) };
  }

  async pickLibraryFile() {
    return this.pickResult;
  }

  async exportFile(name: string, bytes: Uint8Array) {
    this.exported.push({ name, bytes });
    return true;
  }

  async subscribe(listener: (event: LibraryChange) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

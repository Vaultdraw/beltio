import { VaultError } from "../vault/DesktopVaultRepository";

import { NoteConflictError } from "./noteFiles";

import type { NoteFile, NoteFiles, NoteWritten } from "./noteFiles";

const MAX_COPIES = 20;
const MAX_BYTES = 16 * 1024 * 1024;

/** 64 hex characters from the text (FNV-1a, eight rounds): stable, not a cryptographic hash. */
export function fakeRevision(text: string): string {
  let out = "";
  for (let round = 0; round < 8; round++) {
    let h = (0x811c9dc5 ^ (round * 0x9e3779b1)) >>> 0;
    for (let i = 0; i < text.length; i++) {
      h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
  }
  return out;
}

/** Same path rules as the native `check_note_path`. */
function checkPath(path: string): void {
  const bad = () =>
    new VaultError("INVALID_PATH", "Only .md notes outside dot-folders");
  if (!path || path.startsWith("/") || path.includes("\\")) {
    throw bad();
  }
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === ".." || p.startsWith("."))) {
    throw bad();
  }
  const lower = path.toLowerCase();
  if (!lower.endsWith(".md") || lower.endsWith(".excalidraw.md")) {
    throw bad();
  }
}

/**
 * In-memory `NoteFiles` for tests and the browser harness: the same revision check, create-only
 * rule, no-op for unchanged text and last-20 history as the native write. Never a production fallback.
 */
export class FakeNoteFiles implements NoteFiles {
  private readonly files = new Map<string, { text: string; mtimeMs: number }>();
  private readonly history = new Map<string, string[]>();
  private clock = 1;
  readOnly = false;

  /** Test seam: put a note on "disk" as if another program wrote it. */
  setOnDisk(path: string, text: string): void {
    this.files.set(path, { text, mtimeMs: ++this.clock });
  }

  /** The text currently on "disk", or undefined. */
  textOf(path: string): string | undefined {
    return this.files.get(path)?.text;
  }

  /** Copies of earlier texts, oldest first. */
  copiesOf(path: string): string[] {
    return [...(this.history.get(path) ?? [])];
  }

  async read(_handle: string, path: string): Promise<NoteFile> {
    checkPath(path);
    const f = this.files.get(path);
    if (!f) {
      throw new VaultError("NOT_FOUND", "Note not found");
    }
    return {
      content: f.text,
      revision: fakeRevision(f.text),
      mtimeMs: f.mtimeMs,
      size: new TextEncoder().encode(f.text).length,
    };
  }

  async write(
    _handle: string,
    path: string,
    content: string,
    expectedRevision: string | null,
  ): Promise<NoteWritten> {
    if (this.readOnly) {
      throw new VaultError("READ_ONLY", "This vault is read-only");
    }
    checkPath(path);
    const bytes = new TextEncoder().encode(content).length;
    if (bytes > MAX_BYTES) {
      throw new VaultError("INVALID_FILE", "Note exceeds the 16 MiB limit");
    }
    const cur = this.files.get(path);
    const curRev = cur ? fakeRevision(cur.text) : null;
    if (curRev !== expectedRevision) {
      throw new NoteConflictError();
    }
    const revision = fakeRevision(content);
    if (cur && curRev === revision) {
      return { revision, bytes, mtimeMs: cur.mtimeMs, historyCopy: null };
    }
    let historyCopy: string | null = null;
    if (cur) {
      const list = this.history.get(path) ?? [];
      list.push(cur.text);
      while (list.length > MAX_COPIES) {
        list.shift();
      }
      this.history.set(path, list);
      historyCopy = `.excalidraw-vault/note-history/${path}/${
        this.clock
      }-${curRev?.slice(0, 12)}.md`;
    }
    const mtimeMs = ++this.clock;
    this.files.set(path, { text: content, mtimeMs });
    return { revision, bytes, mtimeMs, historyCopy };
  }
}

/**
 * An in-memory stand-in for the Rust `folders.*` gateway rows (API 0.9.0),
 * shared by the app's fake backend (vitest, e2e) and the mock host: the same
 * handles, limits and error codes as src-tauri/src/plugins/gateway.rs.
 */
import { PluginApiError } from "./rules";

/** A source folder a test seeds: files by relative path, text or bytes. */
export interface FakeFolder {
  name: string;
  files: Record<string, string | Uint8Array>;
}

/** A target handed out: a new vault's files, or a folder of the open vault. */
export interface FakeTarget {
  name: string;
  kind: "newVault" | "vaultFolder";
  /** vaultFolder: the folder in the open vault. */
  path: string | null;
  /** What was written, by path (a scene object or copied bytes); a vault folder's drawings also land in the vault. */
  files: Record<string, object | Uint8Array>;
}

export const MAX_FOLDER_ENTRIES = 100_000;

const coded = (code: string, message: string) =>
  new PluginApiError(code, message);

const asBytes = (v: string | Uint8Array): Uint8Array =>
  typeof v === "string" ? new TextEncoder().encode(v) : v;

const relative = (path: unknown): string => {
  const p = String(path ?? "");
  if (
    p === "" ||
    p.split("/").some((s) => s === "" || s.startsWith(".") || s === "..")
  ) {
    throw coded("INVALID_PATH", "Invalid path");
  }
  return p;
};

/**
 * A stand-in for `vaultdraw_core::excalidraw_md::extract_scene`: plain ```json blocks only
 * (the compressed form is the Rust decoder's job, tested there).
 */
export const fakeExtractScene = (text: string): object => {
  const m = /```json\s*\n([\s\S]*?)\n```/.exec(
    text.slice(Math.max(0, text.indexOf("## Drawing"))),
  );
  try {
    const scene = JSON.parse(m?.[1] ?? "") as { elements?: unknown };
    if (Array.isArray(scene.elements)) {
      return scene;
    }
  } catch {
    // falls through to the coded error
  }
  throw coded("INVALID_FILE", "No Excalidraw drawing data found in this note");
};

export interface FakeFolderStore {
  /** What the next `folders.pickSource` returns (null: cancelled). */
  sourcePick: FakeFolder | null;
  /** What the next `folders.pickNewVault` returns: the vault's name (null: cancelled). */
  newVaultPick: string | null;
  sources: Record<string, FakeFolder>;
  targets: Record<string, FakeTarget>;
  /** Runs one gateway row; throws the gateway's coded errors. */
  call(method: string, params: Record<string, unknown> | null): unknown;
  /** The absolute path behind a target (`import_target_root`). */
  root(handle: string): string;
  reset(): void;
}

let handleSeq = 0;

/**
 * `vault` tells the store about the open vault: whether one is open and
 * writable, and how a vault folder's drawing is stored (throws NAME_COLLISION).
 */
export function createFakeFolderStore(vault: {
  open(): boolean;
  readOnly(): boolean;
  putDrawing(path: string, scene: object): void;
  hasDrawing(path: string): boolean;
}): FakeFolderStore {
  const store: FakeFolderStore = {
    sourcePick: null,
    newVaultPick: null,
    sources: {},
    targets: {},
    root: (handle) => `/fake/vaults/${targetOf(handle).name}`,
    reset() {
      store.sourcePick = null;
      store.newVaultPick = null;
      store.sources = {};
      store.targets = {};
    },
    call(method, params) {
      switch (method) {
        case "folders.pickSource": {
          const pick = store.sourcePick;
          if (!pick) {
            return null;
          }
          const handle = `src-${++handleSeq}`;
          store.sources[handle] = pick;
          return { handle, name: pick.name };
        }
        case "folders.list": {
          const s = sourceOf(params?.handle);
          const entries = Object.entries(s.files)
            .filter(([p]) => !p.split("/").some((seg) => seg.startsWith(".")))
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(0, MAX_FOLDER_ENTRIES)
            .map(([path, v]) => ({
              path,
              size: asBytes(v).length,
              modifiedAt: 1,
            }));
          return { entries };
        }
        case "folders.readText":
        case "folders.readBytes": {
          const s = sourceOf(params?.handle);
          const rel = relative(params?.path);
          const v = s.files[rel];
          if (v === undefined) {
            throw coded("NOT_FOUND", `File not found: ${rel}`);
          }
          const bytes = asBytes(v);
          return method === "folders.readText"
            ? { text: new TextDecoder().decode(bytes) }
            : {
                base64: btoa(
                  Array.from(bytes, (b) => String.fromCharCode(b)).join(""),
                ),
              };
        }
        case "folders.pickNewVault": {
          const name = store.newVaultPick;
          if (name === null) {
            return null;
          }
          const handle = `tgt-${++handleSeq}`;
          store.targets[handle] = {
            name,
            kind: "newVault",
            path: null,
            files: {},
          };
          return { handle, name };
        }
        case "folders.vaultTarget": {
          if (!vault.open()) {
            throw coded("NO_VAULT", "No vault is open");
          }
          if (vault.readOnly()) {
            throw coded("READ_ONLY", "The vault is read-only");
          }
          const path = String(params?.path ?? "");
          const handle = `tgt-${++handleSeq}`;
          const name = path === "" ? "vault" : path.split("/").pop()!;
          store.targets[handle] = {
            name,
            kind: "vaultFolder",
            path,
            files: {},
          };
          return { handle, name };
        }
        case "folders.writeDrawing": {
          const t = targetOf(params?.handle);
          const rel = relative(params?.path);
          if (!rel.endsWith(".excalidraw")) {
            throw coded(
              "INVALID_PATH",
              "Drawing paths must end in .excalidraw",
            );
          }
          put(t, rel, params?.scene as object);
          return {};
        }
        case "folders.copy": {
          const s = sourceOf(params?.source);
          const t = targetOf(params?.target);
          const from = relative(params?.from);
          const v = s.files[from];
          if (v === undefined) {
            throw coded("NOT_FOUND", `File not found: ${from}`);
          }
          put(t, relative(params?.to), asBytes(v).slice());
          return {};
        }
        case "folders.convertDrawing": {
          const s = sourceOf(params?.source);
          const t = targetOf(params?.target);
          const from = relative(params?.from);
          const to = relative(params?.to);
          const v = s.files[from];
          if (v === undefined) {
            throw coded("NOT_FOUND", `File not found: ${from}`);
          }
          if (!to.endsWith(".excalidraw")) {
            throw coded(
              "INVALID_PATH",
              "Drawing paths must end in .excalidraw",
            );
          }
          put(t, to, fakeExtractScene(new TextDecoder().decode(asBytes(v))));
          return {};
        }
        default:
          throw coded("NOT_FOUND", `Plugins cannot call "${method}"`);
      }
    },
  };

  const sourceOf = (handle: unknown): FakeFolder => {
    const s = store.sources[String(handle)];
    if (!s) {
      throw coded("NOT_FOUND", "Unknown source folder");
    }
    return s;
  };
  const targetOf = (handle: unknown): FakeTarget => {
    const t = store.targets[String(handle)];
    if (!t) {
      throw coded("NOT_FOUND", "Unknown target folder");
    }
    return t;
  };
  /** Create-only write into a target. */
  const put = (t: FakeTarget, rel: string, value: object | Uint8Array) => {
    const key = t.kind === "vaultFolder" && t.path ? `${t.path}/${rel}` : rel;
    if (key in t.files) {
      throw coded("NAME_COLLISION", `Already exists: ${key}`);
    }
    if (t.kind === "vaultFolder" && !(value instanceof Uint8Array)) {
      if (vault.hasDrawing(key)) {
        throw coded("NAME_COLLISION", `Already exists: ${key}`);
      }
      vault.putDrawing(key, value);
    }
    t.files[key] = value;
  };

  return store;
}

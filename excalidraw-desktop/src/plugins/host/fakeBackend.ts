/** In-memory PluginsBackend for vitest and the e2e harness. */
import { createFakeFolderStore } from "../../../../sdk/api/shared/fakeFolders";
import {
  fakeParseMarkdown,
  markdownParams,
} from "../../../../sdk/api/shared/markdown";

import type { FakeFolderStore } from "../../../../sdk/api/shared/fakeFolders";

import type { PluginsBackend } from "./backend";
import type { PluginInfo, SafeModeInfo } from "./types";

export interface FakeBackend extends PluginsBackend {
  plugins: PluginInfo[];
  hostDisabledCalls: { id: string; reason: string | null }[];
  safeMode: SafeModeInfo | null;
  /** Folders `installFolder` can install, by path. */
  installable: Record<string, PluginInfo>;
  launchOkCalls: number;
  /** Plugin ids the user confirmed the permissions of. */
  consentCalls: string[];
  restarts: ("safe" | "normal")[];
  pickResult: string | null;
  opened: (string | null)[];
  /** Simulates a dev file change. */
  emitChanged(id: string): void;
  /** Saved plugin data (`storage.global`) as the JSON text Rust would hold, by id. */
  data: Record<string, string>;
  /** Drawings the vault rows (`vault.list`, `file.read`, `file.write`) serve, by path. */
  drawings: Record<
    string,
    { scene: Record<string, unknown>; revision: string }
  >;
  /** Makes `file.write` fail with READ_ONLY. */
  vaultReadOnly: boolean;
  /** False: the vault rows fail with NO_VAULT. */
  vaultOpen: boolean;
  /** Every gateway call, in order. */
  gatewayCalls: { pluginId: string; method: string; params: unknown }[];
  /** The graph bytes `vault.graph` returns, and the saved layout bytes (`vault.graphLayout.*`). */
  graphBytes: Uint8Array;
  graphLayout: Uint8Array;
  /** The plugin tables of the vault settings.toml (`vault.settings.*`), by plugin id. */
  vaultTables: Record<string, Record<string, unknown>>;
  /** Tests: where `vault.graph` gets its bytes (default: `graphBytes`). */
  graphSource?: () => Promise<Uint8Array>;
  /** Tests: told after every own-table update / layout save (to persist or mirror them). */
  onVaultTable?: (pluginId: string, table: Record<string, unknown>) => void;
  onGraphLayout?: (bytes: Uint8Array) => void;
  /**
   * The native side of the `pdf.*` rows (permission `pdf`): in-memory documents. The e2e harness and
   * the tests set it (src/tests/fakePdfBridge.ts); unset, the rows fail with PDF_UNAVAILABLE.
   */
  pdf?: FakePdfRows;
  /** The `folders.*` rows' state: what the pickers return next, the sources and targets handed out. */
  folders: FakeFolderStore;
}

/** What the fake `pdf.*` rows need from an in-memory renderer (the shape of `FakePdfBridge`). */
export interface FakePdfRows {
  pick(): Promise<unknown | null>;
  openBytes(name: string, bytes: Uint8Array): Promise<unknown>;
  renderPage(
    token: number,
    index: number,
    opts: { maxSide: number; format: "jpeg" | "png"; quality: number },
  ): Promise<Uint8Array>;
  unlock(token: number, password: string): Promise<unknown>;
  close(token: number): Promise<void>;
}

const PDF_ROWS = new Set([
  "pdf.pick",
  "pdf.open",
  "pdf.render",
  "pdf.unlock",
  "pdf.close",
]);

/** The `pdf.*` rows over `fake.pdf`, with the body formats of `pdf_import::gateway_call`. */
const pdfRow = async (
  pdf: FakePdfRows | undefined,
  method: string,
  body: Uint8Array | undefined,
): Promise<Uint8Array> => {
  if (!pdf) {
    throw coded("PDF_UNAVAILABLE", "No PDF renderer in this fake backend");
  }
  const json = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value));
  const args = () => {
    try {
      return JSON.parse(new TextDecoder().decode(body ?? new Uint8Array()));
    } catch {
      throw coded("INVALID_ARGUMENT", "Expected a JSON object");
    }
  };
  switch (method) {
    case "pdf.pick":
      return json(await pdf.pick());
    case "pdf.open": {
      const bytes = body ?? new Uint8Array();
      const len =
        bytes.byteLength >= 4
          ? new DataView(bytes.buffer, bytes.byteOffset).getUint32(0)
          : -1;
      if (len < 0 || 4 + len >= bytes.byteLength) {
        throw coded(
          "INVALID_ARGUMENT",
          "Expected a name length, the name and the PDF bytes",
        );
      }
      const name = new TextDecoder().decode(bytes.subarray(4, 4 + len));
      return json(await pdf.openBytes(name, bytes.subarray(4 + len)));
    }
    case "pdf.render": {
      const a = args();
      return pdf.renderPage(a.token, a.index, {
        maxSide: a.maxSide,
        format: a.format,
        quality: a.quality,
      });
    }
    case "pdf.unlock": {
      const a = args();
      return json(await pdf.unlock(a.token, a.password));
    }
    default: {
      await pdf.close(args().token);
      return new Uint8Array(0);
    }
  }
};

/** An error as the gateway reports it (`code` plus message). */
const coded = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

const VAULT_ROWS: Record<string, "vault.read" | "vault.write"> = {
  "vault.list": "vault.read",
  "file.read": "vault.read",
  "file.write": "vault.write",
};

const RAW_ROWS = new Set([
  "vault.graph",
  "vault.graphLayout.load",
  "vault.graphLayout.save",
]);

const FOLDER_ROWS = new Set([
  "folders.pickSource",
  "folders.list",
  "folders.readText",
  "folders.readBytes",
  "folders.pickNewVault",
  "folders.vaultTarget",
  "folders.writeDrawing",
  "folders.copy",
  "folders.convertDrawing",
]);

/** The vault rows of the Rust gateway, over `fake.drawings`. */
function vaultCall(
  fake: FakeBackend,
  method: string,
  params: Record<string, unknown> | null,
): unknown {
  const path = String(params?.path ?? "");
  if (!fake.vaultOpen) {
    throw coded("NO_VAULT", "No vault is open");
  }
  if (method === "vault.list") {
    const dir = String(params?.dir ?? "");
    const base = dir === "" ? "" : `${dir}/`;
    const folders = new Set<string>();
    const files: unknown[] = [];
    for (const p of Object.keys(fake.drawings).sort()) {
      if (!p.startsWith(base)) {
        continue;
      }
      const rest = p.slice(base.length);
      const slash = rest.indexOf("/");
      if (slash >= 0) {
        folders.add(rest.slice(0, slash));
      } else {
        files.push({
          path: p,
          name: rest,
          kind: "drawing",
          modifiedAt: 1,
          size: 10,
        });
      }
    }
    if (dir !== "" && folders.size + files.length === 0) {
      throw coded("NOT_FOUND", "Directory not found");
    }
    return {
      entries: [
        ...[...folders].map((name) => ({
          path: `${base}${name}`,
          name,
          kind: "folder",
          modifiedAt: 1,
          size: 0,
        })),
        ...files,
      ],
    };
  }
  if (method === "file.read") {
    const d = fake.drawings[path];
    if (!d) {
      throw coded("NOT_FOUND", `Drawing not found: ${path}`);
    }
    return { path, revision: d.revision, scene: d.scene };
  }
  // file.write: plugins only create
  if (fake.vaultReadOnly) {
    throw coded("READ_ONLY", "The vault is read-only");
  }
  if (fake.drawings[path]) {
    throw coded("NAME_COLLISION", "A drawing with that name already exists");
  }
  if (params?.expectedRevision !== null) {
    throw coded("PERMISSION", "Plugins can only create new drawings");
  }
  const revision = `rev-${Object.keys(fake.drawings).length + 1}`;
  fake.drawings[path] = {
    scene: params?.scene as Record<string, unknown>,
    revision,
  };
  return { path, revision };
}

export function createFakeBackend(
  plugins: PluginInfo[] = [],
  moduleUrl: (id: string, path: string) => string = (id, path) =>
    `fake://plugin/${id}/${path}`,
  /** Also told of every drawing a vault-folder import target writes (the e2e harness seeds the app's repo). */
  onPutDrawing?: (path: string, scene: object) => void,
): FakeBackend {
  const listeners = new Set<(id: string) => void>();
  const fake: FakeBackend = {
    plugins,
    hostDisabledCalls: [],
    safeMode: null,
    installable: {},
    launchOkCalls: 0,
    consentCalls: [],
    restarts: [],
    pickResult: null,
    opened: [],
    data: {},
    gatewayCalls: [],
    graphBytes: new Uint8Array(0),
    graphLayout: new Uint8Array(0),
    vaultTables: {},
    drawings: {},
    vaultReadOnly: false,
    vaultOpen: true,
    folders: createFakeFolderStore({
      open: () => fake.vaultOpen,
      readOnly: () => fake.vaultReadOnly,
      hasDrawing: (path) => path in fake.drawings,
      putDrawing(path, scene) {
        fake.drawings[path] = {
          scene: scene as Record<string, unknown>,
          revision: `rev-${Object.keys(fake.drawings).length + 1}`,
        };
        onPutDrawing?.(path, scene);
      },
    }),
    pluginCallRaw: async (pluginId, method, body) => {
      fake.gatewayCalls.push({ pluginId, method, params: body ?? null });
      const plugin = fake.plugins.find((p) => p.id === pluginId);
      if (!plugin) {
        throw coded(
          "NOT_FOUND",
          `No installed plugin has the id "${pluginId}"`,
        );
      }
      if (PDF_ROWS.has(method)) {
        if (!plugin.permissions.includes("pdf")) {
          throw coded(
            "PERMISSION",
            `${pluginId}: ${method} needs the permission "pdf", which plugin.toml does not declare`,
          );
        }
        return pdfRow(fake.pdf, method, body);
      }
      const need =
        method === "vault.graphLayout.save" ? "vault.write" : "vault.read";
      if (!RAW_ROWS.has(method)) {
        throw coded("NOT_FOUND", `Plugins cannot call "${method}"`);
      }
      if (!plugin.permissions.includes(need)) {
        throw coded(
          "PERMISSION",
          `${pluginId}: ${method} needs the permission "${need}", which plugin.toml does not declare`,
        );
      }
      if (!fake.vaultOpen) {
        throw coded("NO_VAULT", "No vault is open");
      }
      if (method === "vault.graph") {
        return fake.graphSource ? await fake.graphSource() : fake.graphBytes;
      }
      if (method === "vault.graphLayout.load") {
        return fake.graphLayout;
      }
      fake.graphLayout = new Uint8Array(body ?? []);
      fake.onGraphLayout?.(fake.graphLayout);
      return new Uint8Array(0);
    },
    // The storage, vault and markdown rows of the Rust gateway (plugins/gateway.rs).
    pluginCall: async (pluginId, method, params) => {
      fake.gatewayCalls.push({ pluginId, method, params });
      if (!fake.plugins.some((p) => p.id === pluginId)) {
        throw coded(
          "NOT_FOUND",
          `No installed plugin has the id "${pluginId}"`,
        );
      }
      const row = VAULT_ROWS[method];
      if (row) {
        const plugin = fake.plugins.find((p) => p.id === pluginId)!;
        if (!plugin.permissions.includes(row)) {
          throw coded(
            "PERMISSION",
            `${pluginId}: ${method} needs the permission "${row}", which plugin.toml does not declare`,
          );
        }
        return vaultCall(fake, method, params);
      }
      if (
        method === "vault.settings.read" ||
        method === "vault.settings.update"
      ) {
        const plugin = fake.plugins.find((p) => p.id === pluginId)!;
        const need =
          method === "vault.settings.read" ? "vault.read" : "vault.write";
        if (!plugin.permissions.includes(need)) {
          throw coded(
            "PERMISSION",
            `${pluginId}: ${method} needs the permission "${need}", which plugin.toml does not declare`,
          );
        }
        if (!fake.vaultOpen) {
          throw coded("NO_VAULT", "No vault is open");
        }
        const table = (fake.vaultTables[pluginId] ??= {});
        if (method === "vault.settings.read") {
          return structuredClone(table);
        }
        if (fake.vaultReadOnly) {
          throw coded("READ_ONLY", "The vault is read-only");
        }
        for (const c of (params?.changes ?? []) as {
          key: string;
          value: unknown;
        }[]) {
          if (c.value === null || c.value === undefined) {
            delete table[c.key];
          } else {
            table[c.key] = structuredClone(c.value);
          }
        }
        fake.onVaultTable?.(pluginId, structuredClone(table));
        return null;
      }
      if (FOLDER_ROWS.has(method)) {
        const plugin = fake.plugins.find((p) => p.id === pluginId)!;
        if (!plugin.permissions.includes("folders.import")) {
          throw coded(
            "PERMISSION",
            `${pluginId}: ${method} needs the permission "folders.import", which plugin.toml does not declare`,
          );
        }
        return fake.folders.call(method, params);
      }
      if (method === "markdown.parse") {
        // The Rust parser is not in the browser: the testing kit's stand-in.
        const p = markdownParams(params?.text, {
          softBreakNewline: params?.softBreakNewline as boolean | undefined,
        });
        return fakeParseMarkdown(p.text, p);
      }
      if (method === "storage.read") {
        const text = fake.data[pluginId];
        return {
          data: text === undefined ? null : JSON.parse(text),
          corrupt: false,
        };
      }
      if (method === "storage.write") {
        fake.data[pluginId] = String(params?.text);
        return null;
      }
      throw coded("NOT_FOUND", `Plugins cannot call "${method}"`);
    },
    importTargetRoot: async (handle) => fake.folders.root(handle),
    dataList: async () =>
      Object.entries(fake.data)
        .map(([id, text]) => ({
          id,
          bytes: new TextEncoder().encode(text).length,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    dataDelete: async (id) => {
      const had = id in fake.data;
      delete fake.data[id];
      return had;
    },
    openDir: async (id) => {
      fake.opened.push(id);
    },
    list: async () => ({
      plugins: fake.plugins,
      errors: [],
      scanMs: 0,
      safeMode: fake.safeMode,
    }),
    installFolder: async (path) => {
      const info = fake.installable[path];
      if (!info) {
        throw new Error(`cannot install ${path}`);
      }
      fake.plugins = [...fake.plugins.filter((p) => p.id !== info.id), info];
      return info;
    },
    launchOk: async () => {
      fake.launchOkCalls++;
    },
    restartSafeMode: async () => {
      fake.restarts.push("safe");
    },
    restart: async () => {
      fake.restarts.push("normal");
    },
    pickFolder: async () => fake.pickResult,
    onChanged: async (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    emitChanged: (id) => listeners.forEach((cb) => cb(id)),
    consentConfirm: async (id, _seen) => {
      fake.consentCalls.push(id);
      fake.plugins = fake.plugins.map((p) =>
        p.id === id ? { ...p, review: { state: "ok", added: [] } } : p,
      );
    },
    uninstall: async (id) => {
      fake.plugins = fake.plugins.filter((p) => p.id !== id);
    },
    setHostDisabled: async (id, reason) => {
      fake.hostDisabledCalls.push({ id, reason });
      fake.plugins = fake.plugins.map((p) =>
        p.id === id ? { ...p, hostDisabled: reason } : p,
      );
    },
    moduleUrl,
  };
  return fake;
}

/** A compatible, enabled-able PluginInfo with no contributions. */
export const makePluginInfo = (
  id: string,
  patch: Partial<PluginInfo> = {},
): PluginInfo => ({
  id,
  name: id,
  version: "0.1.0",
  api: 0,
  minApp: null,
  main: "main.js",
  description: null,
  author: null,
  source: "user",
  dir: `/plugins/${id}`,
  mainBytes: 1000,
  compatible: true,
  problem: null,
  hostDisabled: null,
  activation: [],
  permissions: [],
  review: { state: "ok", added: [] },
  contributes: { commands: [], panels: [], settings: [] },
  ...patch,
});

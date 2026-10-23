/**
 * CSS snippets state: which `.css` files are in `<config>/snippets/`, which
 * are enabled (`appearance.snippets`, in order) and their problems. Loading
 * applies the enabled ones (sheets.ts) and registers one toggle command per
 * snippet. Nothing here runs until boot.ts, Settings or a command asks.
 *
 * The source is the native `list_snippets` in the desktop app; tests and the
 * browser harness inject one with setSnippetSource.
 */
import { registerCommands } from "../commands/registry";
import { isTauriAvailable } from "../vault/DesktopVaultRepository";
import { getPreferences, updatePreferences } from "../vault/preferences";

import { applySnippetCss } from "./sheets";
import { makeSnippetToggleCommand } from "./snippetCommands";

/** One row of the native `list_snippets` result. */
export interface SnippetListing {
  id: string;
  path: string;
  /** Text of an enabled snippet; null for disabled ones or on error. */
  css: string | null;
  error: string | null;
}

export interface SnippetSource {
  /** Lists the folder, reading the CSS of `enabled` only. */
  list(enabled: readonly string[]): Promise<SnippetListing[]>;
  openDir(): Promise<void>;
}

export interface SnippetInfo {
  id: string;
  path: string;
  enabled: boolean;
  /** Read problem of an enabled snippet. */
  error: string | null;
}

export interface SnippetsState {
  /** The folder has been listed at least once. */
  loaded: boolean;
  snippets: readonly SnippetInfo[];
  /** Enabled names with no matching file. */
  missing: readonly string[];
  /** list_snippets itself failed. */
  loadError: string | null;
}

const EMPTY: SnippetsState = {
  loaded: false,
  snippets: [],
  missing: [],
  loadError: null,
};

let injected: SnippetSource | null = null;
let state: SnippetsState = EMPTY;
let unregisterToggles: (() => void) | null = null;
let registeredIds = "";
let loading: Promise<void> = Promise.resolve();
/** Enabled list (joined) of the latest reload asked for; null = never (none applied). */
let requestedKey: string | null = null;
const listeners = new Set<() => void>();

/** Tests and the browser harness: replace the native source (null = native). */
export function setSnippetSource(source: SnippetSource | null): void {
  injected = source;
}

const tauriSource: SnippetSource = {
  async list(enabled) {
    const { invoke } = await import("@tauri-apps/api/core");
    const rows = await invoke<SnippetListing[]>("list_snippets", {
      enabled: [...enabled],
    });
    return Array.isArray(rows) ? rows : [];
  },
  async openDir() {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_snippets_dir");
  },
};

/** The source in use, or null when snippets are unavailable (plain browser). */
export function getSnippetSource(
  win: Window | null | undefined,
): SnippetSource | null {
  return injected ?? (isTauriAvailable(win) ? tauriSource : null);
}

export const getSnippetsState = (): SnippetsState => state;

export function subscribeSnippets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const setState = (next: SnippetsState) => {
  state = next;
  listeners.forEach((l) => l());
};

const lower = (s: string) => s.toLowerCase();

/** Enabled names, trimmed, without blanks or case-insensitive duplicates. */
export function enabledSnippetNames(win: Window | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of getPreferences(win).snippets) {
    const name = raw.trim();
    if (name && !seen.has(lower(name))) {
      seen.add(lower(name));
      out.push(name);
    }
  }
  return out;
}

const enabledKey = (win: Window | null | undefined) =>
  enabledSnippetNames(win).map(lower).join("\n");

/**
 * True when `appearance.snippets` differs from what the last reload applied
 * (whoever triggered it: boot, Settings, a command), i.e. a reload is due.
 */
export const snippetsOutOfDate = (win: Window | null | undefined): boolean =>
  enabledKey(win) !== (requestedKey ?? "");

const syncToggleCommands = (ids: readonly string[]) => {
  const key = ids.join("\n");
  if (key === registeredIds) {
    return;
  }
  unregisterToggles?.();
  unregisterToggles =
    ids.length > 0 ? registerCommands(ids.map(makeSnippetToggleCommand)) : null;
  registeredIds = key;
};

/**
 * Builds the state from a listing and applies the enabled snippets in
 * `enabled` order. Pure apart from the document and command registry.
 */
export function applyListing(
  doc: Document,
  enabled: readonly string[],
  listing: readonly SnippetListing[],
): SnippetsState {
  const byName = new Map(listing.map((row) => [lower(row.id), row]));
  const on = new Set(enabled.map(lower));
  const items: { id: string; css: string }[] = [];
  const missing: string[] = [];
  for (const name of enabled) {
    const row = byName.get(lower(name));
    if (!row) {
      missing.push(name);
    } else if (row.css !== null) {
      items.push({ id: row.id, css: row.css });
    }
  }
  const sheetErrors = applySnippetCss(doc, items);
  syncToggleCommands(listing.map((row) => row.id));
  return {
    loaded: true,
    snippets: listing.map((row) => ({
      id: row.id,
      path: row.path,
      enabled: on.has(lower(row.id)),
      error: row.error ?? sheetErrors[row.id] ?? null,
    })),
    missing,
    loadError: null,
  };
}

/**
 * Lists the folder and applies the enabled snippets. Never throws; calls are
 * serialised so the last one wins. Without a source it does nothing.
 */
export function reloadSnippets(
  doc: Document,
  win: Window | null | undefined,
): Promise<void> {
  requestedKey = enabledKey(win);
  loading = loading.then(async () => {
    const source = getSnippetSource(win);
    if (!source) {
      return;
    }
    const enabled = enabledSnippetNames(win);
    try {
      const listing = await source.list(enabled);
      setState(applyListing(doc, enabled, listing));
    } catch (err) {
      setState({
        ...state,
        loaded: true,
        loadError: `Could not read the snippets folder: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  });
  return loading;
}

/**
 * Turns one snippet on (appended last) or off, saves config.toml, re-applies.
 * Only a snippet that exists in the folder can be turned on (no typos in
 * config.toml from a keypress); any enabled name can be turned off.
 * Throws when asked to turn on an unknown name.
 */
export async function toggleSnippet(
  doc: Document,
  win: Window | null | undefined,
  name: string,
  on?: boolean,
): Promise<void> {
  const enabled = enabledSnippetNames(win);
  const isOn = enabled.some((n) => lower(n) === lower(name));
  const want = on ?? !isOn;
  if (want === isOn) {
    return;
  }
  let next: string[];
  if (want) {
    if (!state.loaded) {
      await reloadSnippets(doc, win);
    }
    const file = state.snippets.find((s) => lower(s.id) === lower(name));
    if (!file) {
      throw new Error(`No snippet named "${name}" in the snippets folder`);
    }
    next = [...enabled, file.id];
  } else {
    next = enabled.filter((n) => lower(n) !== lower(name));
  }
  updatePreferences({ snippets: next }, win);
  await reloadSnippets(doc, win);
}

export async function openSnippetsDir(
  win: Window | null | undefined,
): Promise<void> {
  const source = getSnippetSource(win);
  if (!source) {
    throw new Error("The snippets folder is only available in the desktop app");
  }
  await source.openDir();
}

/** Tests: forget everything (does not touch the document). */
export function resetSnippetsForTests(): void {
  unregisterToggles?.();
  unregisterToggles = null;
  registeredIds = "";
  injected = null;
  state = EMPTY;
  loading = Promise.resolve();
  requestedKey = null;
  listeners.clear();
}

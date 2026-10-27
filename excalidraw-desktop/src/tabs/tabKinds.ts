/**
 * Tab kinds (a subset of plugin phase P6): a plugin or built-in extension
 * registers a kind for a file type, and a tab whose path matches shows the
 * kind's view instead of the Excalidraw editor. No React here, and nothing
 * runs until a kind is registered (the registry is two small lets).
 *
 * The view is a lazy chunk (`load`), so a kind costs nothing until a tab of
 * that kind is shown. A kind never claims `.excalidraw` files: drawings stay
 * drawings. The full P6 adds manifest-declared kinds, kind-owned toolbars and
 * view state on top of this shape.
 */
import type { ComponentType } from "react";
import type { OpenTarget } from "./types";

/** What a kind's view may ask of the open vault. */
export interface TabKindVault {
  /** Backend handle of the open vault (null in the browser preview). */
  handle: string | null;
  /** Every file path in the vault, vault-relative; cheap to call, stable between changes. */
  paths: () => readonly string[];
  /** Starts the vault-wide file walk when it has not run (paths() is partial until then). */
  ensurePaths?: () => void;
}

/** What the host gives a kind's view. */
export interface TabKindViewProps {
  /** Vault-relative path of the file in this tab. */
  path: string;
  /** Opens another vault file in the current or a new tab. */
  openPath: (path: string, opts?: { target?: OpenTarget }) => void;
  /** Opens the vault search with `query` (for example `tag:#idea`). */
  openSearch?: (query: string) => void;
  vault: TabKindVault;
}

export interface TabKind {
  /** `<pluginId>.<kind>`, unique. */
  id: string;
  pluginId: string;
  /** Says whether this kind shows the file at `path` (a cheap, pure check). */
  matches: (path: string) => boolean;
  /** Loads the view; called on the first tab of this kind that is shown. */
  load: () => Promise<{ default: ComponentType<TabKindViewProps> }>;
}

const DRAWING = /\.excalidraw$/i;

let kinds: readonly TabKind[] = [];
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

/** Registers a kind; the returned function removes it again. */
export function registerTabKind(kind: TabKind): () => void {
  if (kinds.some((k) => k.id === kind.id)) {
    throw new Error(`Tab kind "${kind.id}" is already registered`);
  }
  kinds = [...kinds, kind];
  emit();
  return () => {
    if (kinds.includes(kind)) {
      kinds = kinds.filter((k) => k !== kind);
      emit();
    }
  };
}

/** The kind that shows `path`, or undefined (the editor opens it). First registered wins. */
export function tabKindFor(path: string | null): TabKind | undefined {
  if (path === null || kinds.length === 0 || DRAWING.test(path)) {
    return undefined;
  }
  return kinds.find((k) => k.matches(path));
}

export const isKindPath = (path: string | null): boolean =>
  tabKindFor(path) !== undefined;

export const getTabKinds = (): readonly TabKind[] => kinds;

export function subscribeTabKinds(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The favourites list as plain data. Pure functions only (no plugin API), so they are unit
 * tested alone. A favourite is a drawing or note path, optionally one element of a drawing
 * (`element` is its id), with an optional label the user chose.
 */
export interface Favourite {
  path: string;
  /** The user's label; empty means "derive it from the path". */
  label?: string;
  /** An element or frame id inside the drawing. */
  element?: string;
}

export const MAX_FAVOURITES = 200;
const MAX_LABEL = 120;

const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : undefined;

/** Reads what the settings table holds (hand edits included); anything unusable is dropped. */
export function parseItems(raw: unknown): Favourite[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Favourite[] = [];
  for (const row of raw) {
    const r =
      row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const path = str(r.path, 1024);
    if (!path || out.some((f) => sameTarget(f, path, str(r.element, 256)))) {
      continue;
    }
    const label = str(r.label, MAX_LABEL);
    const element = str(r.element, 256);
    out.push({
      path,
      ...(label ? { label } : {}),
      ...(element ? { element } : {}),
    });
    if (out.length >= MAX_FAVOURITES) {
      break;
    }
  }
  return out;
}

/** The flat rows written to settings.toml (inline tables of strings). */
export const serialize = (items: readonly Favourite[]): Favourite[] =>
  items.map((f) => ({
    path: f.path,
    ...(f.label ? { label: f.label } : {}),
    ...(f.element ? { element: f.element } : {}),
  }));

const sameTarget = (f: Favourite, path: string, element?: string) =>
  f.path === path && (f.element ?? "") === (element ?? "");

export const indexOfTarget = (
  items: readonly Favourite[],
  path: string,
  element?: string,
): number => items.findIndex((f) => sameTarget(f, path, element));

/** Adds the target at the end, or removes it when listed. */
export function toggle(
  items: readonly Favourite[],
  path: string,
  element?: string,
  label?: string,
): { items: Favourite[]; added: boolean } {
  const at = indexOfTarget(items, path, element);
  if (at >= 0) {
    return { items: items.filter((_, i) => i !== at), added: false };
  }
  if (items.length >= MAX_FAVOURITES) {
    return { items: [...items], added: false };
  }
  const cleaned = str(label, MAX_LABEL);
  return {
    items: [
      ...items,
      {
        path,
        ...(cleaned ? { label: cleaned } : {}),
        ...(element ? { element } : {}),
      },
    ],
    added: true,
  };
}

/** Moves the item at `from` to the index `to` (clamped). */
export function move(
  items: readonly Favourite[],
  from: number,
  to: number,
): Favourite[] {
  if (from < 0 || from >= items.length) {
    return [...items];
  }
  const end = Math.max(0, Math.min(items.length - 1, to));
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(end, 0, item);
  return next;
}

/** Sets or clears (empty) the label of one item. */
export function relabel(
  items: readonly Favourite[],
  at: number,
  label: string,
): Favourite[] {
  const cleaned = str(label, MAX_LABEL);
  return items.map((f, i) => {
    if (i !== at) {
      return f;
    }
    const { label: _old, ...rest } = f;
    return cleaned ? { ...rest, label: cleaned } : rest;
  });
}

export const removeAt = (
  items: readonly Favourite[],
  at: number,
): Favourite[] => items.filter((_, i) => i !== at);

const under = (path: string, folder: string) =>
  path === folder || path.startsWith(`${folder}/`);

/** A rename or move of a file or folder: follow it (`from` may be a folder). */
export function renamePath(
  items: readonly Favourite[],
  from: string,
  to: string,
): Favourite[] {
  return items.map((f) =>
    under(f.path, from) ? { ...f, path: to + f.path.slice(from.length) } : f,
  );
}

/** A delete of a file or folder: drop what was inside. */
export const dropPath = (
  items: readonly Favourite[],
  path: string,
): Favourite[] => items.filter((f) => !under(f.path, path));

/** The default label: the file name without its drawing or note extension. */
export function defaultLabel(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.excalidraw\.md$|\.excalidraw$|\.md$/i, "") || name;
}

export const labelOf = (f: Favourite): string =>
  f.label ??
  (f.element ? `${defaultLabel(f.path)} (element)` : defaultLabel(f.path));

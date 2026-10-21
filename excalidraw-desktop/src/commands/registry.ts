/**
 * Mutable runtime command registry. Built-ins register first (commands.ts),
 * plugins later; registration order is the dispatcher's tie-break and the
 * default listing order. Must not import commands.ts (no cycles).
 */
import type { CommandDefinition } from "./types";

const byId = new Map<string, CommandDefinition>();
const legacyIds = new Set<string>();
let snapshot: readonly CommandDefinition[] | null = null;
let version = 0;
const listeners = new Set<() => void>();

const validShape = (def: CommandDefinition): boolean =>
  !!def &&
  typeof def.id === "string" &&
  def.id !== "" &&
  typeof def.title === "string" &&
  Array.isArray(def.keys?.default);

/**
 * Register commands in order. A bad shape or an id already taken (as an id or
 * a legacy id) is refused with a warning, first wins, the rest still
 * register. The returned function removes only what this call added.
 */
export function registerCommands(
  defs: readonly CommandDefinition[],
): () => void {
  const added: CommandDefinition[] = [];
  for (const def of defs) {
    if (!validShape(def)) {
      console.warn("Command refused: invalid definition", def);
    } else if (byId.has(def.id) || legacyIds.has(def.id)) {
      console.warn(
        `Command "${def.id}" is already registered; keeping the first`,
      );
    } else {
      byId.set(def.id, def);
      if (def.legacy) {
        legacyIds.add(def.legacy.id);
      }
      added.push(def);
    }
  }
  if (added.length > 0) {
    changed();
  }
  return () => {
    let removed = false;
    for (const def of added) {
      if (byId.get(def.id) === def) {
        byId.delete(def.id);
        if (def.legacy) {
          legacyIds.delete(def.legacy.id);
        }
        removed = true;
      }
    }
    if (removed) {
      changed();
    }
  };
}

function changed(): void {
  snapshot = null;
  version++;
  listeners.forEach((listener) => listener());
}

export const getRegisteredCommand = (
  id: string,
): CommandDefinition | undefined => byId.get(id);

/** Cached: the same array until the next change (the palette reads it often). */
export function registeredCommands(): readonly CommandDefinition[] {
  return (snapshot ??= [...byId.values()]);
}

export const isLegacyCommandId = (id: string): boolean => legacyIds.has(id);

export const commandsVersion = (): number => version;

export function subscribeCommands(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

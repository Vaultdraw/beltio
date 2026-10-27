/**
 * Context menu items plugins declared (`[[contributes.menus]]`). A menu asks
 * `getMenuItems(surface)` when it opens; with no plugin item that is one shared
 * empty array, so the menus cost nothing without plugins. Choosing an item runs
 * the plugin's command, which reads where it was chosen with `ctx.menus.target()`.
 */
import { toastStore } from "../toasts/toastStore";

import { errorText } from "./host/errors";
import { runCommandById } from "./host/runner";

import type { MenuTarget } from "./api";

export type MenuSurface = MenuTarget["surface"];

export interface MenuItemStub {
  pluginId: string;
  pluginName: string;
  surface: MenuSurface;
  /** Text shown in the menu. */
  title: string;
  /** Full command id (`<pluginId>.<command>`). */
  command: string;
  /** Tree rows it shows for; empty means all. */
  kinds: readonly string[];
}

const NONE: readonly MenuItemStub[] = [];
let items: readonly MenuItemStub[] = NONE;
const bySurface = new Map<MenuSurface, readonly MenuItemStub[]>();

const rebuild = () => {
  bySurface.clear();
};

/** Registers a plugin's items; the returned function removes them. */
export function addMenuItems(added: readonly MenuItemStub[]): () => void {
  if (added.length === 0) {
    return () => {};
  }
  items = [...items, ...added];
  rebuild();
  return () => {
    items = items.filter((i) => !added.includes(i));
    rebuild();
  };
}

/** The items for a surface, in registration order (a stable array until the registry changes). */
export function getMenuItems(surface: MenuSurface): readonly MenuItemStub[] {
  if (items === NONE) {
    return NONE;
  }
  let list = bySurface.get(surface);
  if (!list) {
    list = items.filter((i) => i.surface === surface);
    bySurface.set(surface, list);
  }
  return list;
}

const targets = new Map<string, MenuTarget>();
/** A chosen item whose command has not started yet (the plugin may still be loading). */
let pending: { command: string; target: MenuTarget; at: number } | null = null;
/** A command that never starts (not available now) must not hand its target to a later run. */
const PENDING_MS = 15_000;

/** Where the menu item that started this plugin's running command was chosen. */
export const getMenuTarget = (pluginId: string): MenuTarget | null =>
  targets.get(pluginId) ?? null;

/**
 * Called when a plugin's command starts: when a menu item started it, its target is readable
 * through `ctx.menus.target()` until the returned function is called (the command finished).
 */
export function beginMenuRun(pluginId: string, command: string): () => void {
  const hit =
    pending &&
    pending.command === command &&
    performance.now() - pending.at < PENDING_MS
      ? pending.target
      : null;
  pending = null;
  if (!hit) {
    return () => {};
  }
  targets.set(pluginId, hit);
  return () => {
    if (targets.get(pluginId) === hit) {
      targets.delete(pluginId);
    }
  };
}

/** Runs the item's command; the command reads `target` through `ctx.menus.target()`. */
export function runMenuItem(item: MenuItemStub, target: MenuTarget): void {
  pending = { command: item.command, target, at: performance.now() };
  runCommandById(item.command).catch((err) => {
    pending = null;
    toastStore.push({
      message: `${item.pluginName}: ${errorText(err)}`,
      kind: "error",
    });
  });
}

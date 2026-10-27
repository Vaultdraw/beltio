/**
 * The plugin status bar's items: a tiny store with no React. Items exist only
 * while a plugin has given them text, so nothing is held, drawn or subscribed
 * to for a plugin that never calls `ctx.statusBar`.
 */
import {
  sameStatus,
  type CleanStatus,
} from "../../../../sdk/api/shared/statusBar";

import type { StatusBarContribution } from "../api";

export interface StatusItem extends CleanStatus {
  /** `<pluginId>.<itemId>` */
  key: string;
  pluginId: string;
  /** Plugin name, for the tooltip. */
  pluginName: string;
  title: string;
  align: "left" | "right";
  priority: number;
  /** Full command id a click runs, or null. */
  command: string | null;
}

let items: readonly StatusItem[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const order = (a: StatusItem, b: StatusItem) =>
  b.priority - a.priority || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** Shows (or updates) one item; `state` null hides it. A same-looking update does nothing. */
export function setStatusItem(
  pluginId: string,
  pluginName: string,
  decl: StatusBarContribution,
  state: CleanStatus | null,
): void {
  const key = `${pluginId}.${decl.id}`;
  const prev = items.find((i) => i.key === key);
  if (state === null) {
    if (prev) {
      items = items.filter((i) => i !== prev);
      emit();
    }
    return;
  }
  if (prev && sameStatus(prev, state)) {
    return;
  }
  const next: StatusItem = {
    ...state,
    key,
    pluginId,
    pluginName,
    title: decl.title,
    align: decl.align,
    priority: decl.priority,
    command: decl.command ? `${pluginId}.${decl.command}` : null,
  };
  items = [...items.filter((i) => i !== prev), next].sort(order);
  emit();
}

/** Hides every item of a plugin (disable, reload, uninstall). */
export function clearPluginStatus(pluginId: string): void {
  if (items.some((i) => i.pluginId === pluginId)) {
    items = items.filter((i) => i.pluginId !== pluginId);
    emit();
  }
}

export const getStatusItems = (): readonly StatusItem[] => items;

export const subscribeStatusItems = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

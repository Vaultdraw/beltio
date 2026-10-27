/**
 * Canvas tools plugins declared (`[[contributes.tools]]`) and the handlers they
 * registered. Plain data and two tiny stores, so the toolbar can show tools and
 * their active state without importing the plugin host.
 */
import type { ToolContribution, ToolHandlers } from "./api";

export interface ToolStub {
  /** `<pluginId>.<toolId>`, the `customType` of Excalidraw's custom tool. */
  key: string;
  pluginId: string;
  pluginName: string;
  id: string;
  title: string;
  icon: string | null;
  cursor: NonNullable<ToolContribution["cursor"]>;
  /** The palette command that toggles the tool. */
  command: string;
}

const tools = new Map<string, ToolStub>();
const handlers = new Map<string, ToolHandlers>();

export const addToolStubs = (added: readonly ToolStub[]): (() => void) => {
  for (const t of added) {
    tools.set(t.key, t);
  }
  return () => {
    for (const t of added) {
      if (tools.get(t.key) === t) {
        tools.delete(t.key);
      }
    }
  };
};

export const getToolStub = (key: string): ToolStub | undefined =>
  tools.get(key);

export function setToolHandlers(key: string, h: ToolHandlers): () => void {
  handlers.set(key, h);
  return () => {
    if (handlers.get(key) === h) {
      handlers.delete(key);
    }
  };
}

export const getToolHandlers = (key: string): ToolHandlers | undefined =>
  handlers.get(key);

let activeKey: string | null = null;
const listeners = new Set<() => void>();

/** The plugin tool the canvas is using now, or null. */
export const getActiveToolKey = (): string | null => activeKey;

export function setActiveToolKey(key: string | null): void {
  if (key !== activeKey) {
    activeKey = key;
    listeners.forEach((l) => l());
  }
}

export const subscribeActiveTool = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

import type { SettingDecl } from "../settings/declaredSettings";
import type { Plugin } from "../api";
import type { CommandHandler } from "../../commands/types";
import type { ComponentType } from "react";

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  api: number;
  minApp: string | null;
  main: string;
  description: string | null;
  author: string | null;
  source: "user" | "bundled";
  dir: string;
  mainBytes: number;
  compatible: boolean;
  problem: string | null;
  hostDisabled: string | null;
  activation: string[];
  contributes: {
    commands: {
      id: string;
      title: string;
      keys: string[];
      when: string[];
      palette: boolean;
    }[];
    panels: {
      id: string;
      title: string;
      icon: string | null;
      group: "top" | "bottom";
    }[];
    settings: SettingDecl[];
  };
}

export interface PluginsList {
  plugins: PluginInfo[];
  errors: { dir: string; message: string }[];
  scanMs: number;
}

export type ActivationState =
  | "idle"
  | "loading"
  | "active"
  | "failed"
  | "disabled";

/** Mutable per-plugin runtime record (activation.ts owns the transitions). */
export interface PluginRuntime {
  info: PluginInfo;
  state: ActivationState;
  /** Shared activation promise; resolves true when active. Never rejects. */
  promise: Promise<boolean> | null;
  /** Bumped on disable so a late activation can tell it was cancelled. */
  gen: number;
  plugin: Plugin | null;
  /** Real handlers the plugin registered, by short command id. */
  handlers: Map<string, CommandHandler>;
  /** Panel components the plugin registered, by short panel id. */
  components: Map<string, ComponentType>;
  /** Disposes the plugin context (reverse order). */
  disposeContext: (() => void) | null;
  /** Disposes the stub registrations. */
  disposeStubs: (() => void) | null;
}

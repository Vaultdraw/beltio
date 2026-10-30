import type { SettingDecl } from "../settings/declaredSettings";
import type {
  MenuContribution,
  ToolbarContribution,
  ToolContribution,
  Json,
  MethodContribution,
  ShapeContribution,
  Plugin,
  PluginPermission,
  StatusBarContribution,
  ViewContribution,
} from "../api";
import type { CommandHandler } from "../../commands/types";
import type { ComponentType } from "react";

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  api: number;
  minApp: string | null;
  /** The oldest API revision the plugin needs (`min_api`), or null. */
  minApi: string | null;
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
  /** What the manifest declares; Rust refuses unknown names at parse time. */
  permissions: PluginPermission[];
  /**
   * Declared permissions against the consent record: `review` keeps the plugin
   * off, `notice` loads it and tells the user once, `ok` is quiet.
   */
  review: { state: "ok" | "notice" | "review"; added: string[] };
  /** `data_key` from plugin.toml (null: the default `plugins.<id>`); absent from older backends. */
  dataKey?: string | null;
  /** Dev plugins are watched and reloaded when their files change. */
  dev?: boolean;
  contributes: {
    commands: {
      id: string;
      title: string;
      keys: string[];
      when: string[];
      palette: boolean;
      /** Absent from older backends. */
      repeat?: boolean;
    }[];
    panels: {
      id: string;
      title: string;
      icon: string | null;
      group: "top" | "bottom";
    }[];
    settings: SettingDecl[];
    /** File types the plugin imports (`[[contributes.importers]]`); absent from older backends. */
    importers?: { id: string; title: string; extensions: string[] }[];
    /** Status bar items (`[[contributes.status_bar]]`); absent from older backends. */
    status_bar?: StatusBarContribution[];
    /** Note views (`[[contributes.views]]`); absent from older backends. */
    views?: ViewContribution[];
    /** Context menu items (`[[contributes.menus]]`); absent from older backends. */
    menus?: MenuContribution[];
    /** Toolbar buttons (`[[contributes.toolbar]]`); absent from older backends. */
    toolbar?: ToolbarContribution[];
    /** Canvas tools (`[[contributes.tools]]`); absent from older backends. */
    tools?: ToolContribution[];
    /** Custom shapes (`[[contributes.shapes]]`); absent from older backends. */
    shapes?: ShapeContribution[];
    /** Methods other programs can call (`[[contributes.methods]]`); absent from older backends. */
    methods?: MethodContribution[];
  };
}

export interface SafeModeInfo {
  reason: "user" | "crashes" | "modifier" | "flag" | "env";
  scope?: "plugins" | "core";
  crashedLaunches: number;
  pluginsAtCrash: string[];
}

export interface PluginsList {
  plugins: PluginInfo[];
  errors: { dir: string; message: string }[];
  scanMs: number;
  /** This launch's safe mode; null in a normal launch. */
  safeMode: SafeModeInfo | null;
  /** A damaged plugin-consent.json was moved aside (kept as .corrupt); everything asks again. */
  consentReset?: boolean;
}

export type ActivationState =
  | "idle"
  | "loading"
  | "active"
  | "failed"
  | "disabled";

/** What the management UI reads (see manage.ts). */
export interface PluginsState {
  plugins: PluginInfo[];
  errors: { dir: string; message: string }[];
  scanMs: number;
  safeMode: SafeModeInfo | null;
  runtime: Record<string, { state: ActivationState; enabled: boolean }>;
}

/** Mutable per-plugin runtime record (activation.ts owns the transitions). */
export type MethodHandler = (params: Json) => Json | Promise<Json>;

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
  /** Method handlers the plugin registered (`ctx.methods.register`), by method id. */
  methods: Map<string, MethodHandler>;
  /** Panel components the plugin registered, by short panel id. */
  components: Map<string, ComponentType>;
  /** Disposes the plugin context (reverse order). */
  disposeContext: (() => void) | null;
  /** Disposes the stub registrations. */
  disposeStubs: (() => void) | null;
}

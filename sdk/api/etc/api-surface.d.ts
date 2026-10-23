// commands.ts
import type { Disposable } from "./disposable";
export interface CommandsApi {
    register(id: string, run: () => void | Promise<void>): Disposable;
    execute(fullId: string): Promise<void>;
}

// disposable.ts
export interface Disposable {
    dispose(): void;
}

// events.ts
import type { Disposable } from "./disposable";
export type AppEventMap = {
    "vault.opened": {
        name: string;
    };
    "drawing.opened": {
        path: string;
    };
    "drawing.saved": {
        path: string;
    };
    "drawing.renamed": {
        from: string;
        to: string;
    };
    "drawing.deleted": {
        path: string;
    };
};
export interface EventsApi {
    on<K extends keyof AppEventMap>(name: K, cb: (payload: Readonly<AppEventMap[K]>) => void): Disposable;
}

// index.ts
export type { CommandsApi } from "./commands";
export type { Disposable } from "./disposable";
export type { AppEventMap, EventsApi } from "./events";
export type { CommandContribution, PanelContribution, PluginContributions, PluginManifestInfo, } from "./manifest";
export type { PanelsApi } from "./panels";
export { definePlugin } from "./plugin";
export type { LogApi, Plugin, PluginContext, UiApi } from "./plugin";
export type { NewElement, SceneContextApi, SceneElement, SceneElementType, SceneOp, SceneOpIssue, } from "./scene";
export type { SelectOption, SettingDecl, SettingScopeName, SettingsApi, SettingValue, } from "./settings";
export { SHARED_SPECIFIERS } from "./specifiers";

// manifest.ts
import type { SettingDecl } from "./settings";
export interface PluginManifestInfo {
    id: string;
    version: string;
    dir: string;
}
export interface CommandContribution {
    id: string;
    title: string;
    keys: string[];
    when: string[];
    palette: boolean;
}
export interface PanelContribution {
    id: string;
    title: string;
    icon: string | null;
    group: "top" | "bottom";
}
export interface PluginContributions {
    commands: CommandContribution[];
    panels: PanelContribution[];
    settings: SettingDecl[];
}

// panels.ts
import type { ComponentType } from "react";
import type { Disposable } from "./disposable";
export interface PanelsApi {
    register(id: string, component: ComponentType): Disposable;
    open(id: string): void;
    close(id: string): void;
}

// plugin.ts
import type { CommandsApi } from "./commands";
import type { Disposable } from "./disposable";
import type { EventsApi } from "./events";
import type { PluginManifestInfo } from "./manifest";
import type { PanelsApi } from "./panels";
import type { SceneContextApi } from "./scene";
import type { SettingsApi } from "./settings";
export interface UiApi {
    toast(message: string): void;
}
export interface LogApi {
    debug(...a: unknown[]): void;
    info(...a: unknown[]): void;
    warn(...a: unknown[]): void;
    error(...a: unknown[]): void;
}
export interface PluginContext {
    readonly manifest: PluginManifestInfo;
    readonly commands: CommandsApi;
    readonly panels: PanelsApi;
    readonly settings: SettingsApi;
    readonly ui: UiApi;
    readonly log: LogApi;
    readonly scene: SceneContextApi;
    readonly events: EventsApi;
    readonly subscriptions: Disposable[];
    setTimeout(fn: () => void, ms: number): Disposable;
    setInterval(fn: () => void, ms: number): Disposable;
}
export interface Plugin {
    activate(ctx: PluginContext): void | Promise<void>;
    deactivate?(): void | Promise<void>;
}
export declare const definePlugin: (plugin: Plugin) => Plugin;

// scene.ts
import type { Disposable } from "./disposable";
export type SceneElementType = "rectangle" | "ellipse" | "diamond" | "text" | "arrow" | "line" | "freedraw" | "image" | "frame" | "other";
export interface SceneElement {
    readonly id: string;
    readonly type: SceneElementType;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly angle: number;
    readonly text?: string;
    readonly strokeColor?: string;
    readonly backgroundColor?: string;
}
export interface NewElement {
    type: "rectangle" | "ellipse" | "diamond" | "text" | "arrow" | "line";
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    text?: string;
    fontSize?: number;
    strokeColor?: string;
    backgroundColor?: string;
    strokeWidth?: number;
    opacity?: number;
    points?: [number, number][];
}
export type SceneOp = {
    op: "add";
    element: NewElement;
} | {
    op: "update";
    id: string;
    props: Partial<Omit<NewElement, "type">>;
} | {
    op: "delete";
    id: string;
};
export interface SceneOpIssue {
    op: number;
    key?: string;
    message: string;
}
export interface SceneContextApi {
    elements(): readonly SceneElement[];
    onChange(cb: (e: {
        reason: "edit" | "switch";
        path: string | null;
    }) => void): Disposable;
    useScene<T>(select: (els: readonly SceneElement[]) => T, isEqual?: (a: T, b: T) => boolean): T;
    batch(ops: readonly SceneOp[]): Promise<{
        ids: string[];
    }>;
    viewportCenter(): {
        x: number;
        y: number;
    };
}

// settings.ts
import type { Disposable } from "./disposable";
export type SettingValue = string | number | boolean;
export type SettingScopeName = "global" | "vault";
export interface SelectOption {
    value: string;
    label: string;
}
export interface SettingDecl {
    key: string;
    type: "bool" | "int" | "number" | "string" | "select" | "color";
    title: string;
    description?: string;
    default: SettingValue;
    min?: number;
    max?: number;
    options?: readonly SelectOption[];
    scope?: readonly SettingScopeName[];
}
export interface SettingsApi {
    get<T = unknown>(key: string): T;
    set(key: string, value: unknown): Promise<void>;
    onChange(key: string, cb: (value: unknown) => void): Disposable;
}

// specifiers.ts
export declare const SHARED_SPECIFIERS: readonly string[];

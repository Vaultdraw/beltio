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
    "vault.changed": {
        paths: string[];
        rescan: boolean;
    };
};
export interface EventsApi {
    on<K extends keyof AppEventMap>(name: K, cb: (payload: Readonly<AppEventMap[K]>) => void): Disposable;
}

// folders.ts
export interface FolderEntry {
    path: string;
    size: number;
    modifiedAt: number;
}
export interface PickSourceOptions {
    title?: string;
}
export type PickTargetOptions = {
    kind: "newVault";
    title?: string;
} | {
    kind: "vaultFolder";
    path: string;
};
export interface SourceFolder {
    readonly name: string;
    list(): Promise<FolderEntry[]>;
    readText(path: string): Promise<string>;
    readBytes(path: string): Promise<Uint8Array>;
}
export interface TargetFolder {
    readonly name: string;
    readonly kind: "newVault" | "vaultFolder";
    writeDrawing(path: string, scene: object): Promise<void>;
    copyFrom(source: SourceFolder, from: string, to: string): Promise<void>;
    convertDrawing(source: SourceFolder, from: string, to: string): Promise<void>;
    open(): Promise<void>;
}
export interface FoldersApi {
    pickSource(options?: PickSourceOptions): Promise<SourceFolder | null>;
    pickTarget(options: PickTargetOptions): Promise<TargetFolder | null>;
}

// host.ts
export interface ApiVersion {
    level: 0;
    revision: string;
}
export interface HostApi {
    readonly app: string;
    readonly api: ApiVersion;
    has(feature: string): boolean;
}

// importers.ts
import type { Disposable } from "./disposable";
import type { SceneOp } from "./scene";
export interface ImportInput {
    name: string;
    size: number;
    bytes(): Promise<Uint8Array>;
    text(): Promise<string>;
}
export interface ImportOptions {
    signal: AbortSignal;
    at: {
        x: number;
        y: number;
    };
    path: string;
}
export type ImportResult = {
    ops: readonly SceneOp[];
} | void;
export interface Importer {
    import(input: ImportInput, opts: ImportOptions): Promise<ImportResult> | ImportResult;
}
export interface ImportersApi {
    register(id: string, importer: Importer): Disposable;
}

// index.ts
export type { CommandsApi } from "./commands";
export type { Disposable } from "./disposable";
export type { AppEventMap, EventsApi } from "./events";
export type { CommandContribution, ImporterContribution, MenuContribution, StatusBarContribution, ToolbarContribution, ToolContribution, ShapeContribution, ViewContribution, PanelContribution, PluginContributions, PluginManifestInfo, PluginPermission, } from "./manifest";
export type { FolderEntry, FoldersApi, PickSourceOptions, PickTargetOptions, SourceFolder, TargetFolder, } from "./folders";
export type { ApiVersion, HostApi } from "./host";
export type { ImportersApi, Importer, ImportInput, ImportOptions, ImportResult, } from "./importers";
export type { ByteRange, MarkdownApi, MarkdownParseOptions, NoteBlock, NoteBlockBase, NoteDoc, NoteFrontmatter, NoteInline, NoteLink, NoteStats, } from "./markdown";
export type { BuildSceneOptions, CreateDocumentOptions, FlowItem, FlowOptions, FlowPlacement, PageDocument, PageGeometry, PageImageItem, PageItem, PageLineItem, PageRectFill, PageRectItem, PageRequest, PageSizeName, PageTextItem, PageTextTone, PagesApi, } from "./pages";
export type { PanelsApi } from "./panels";
export { definePlugin } from "./plugin";
export type { LogApi, Plugin, PluginContext, UiApi } from "./plugin";
export type { BatchOptions, BatchResult, ElementId, ElementRef, ImageSource, FontFamilyName, NewElement, SceneContextApi, SceneElementDetail, SceneElement, SceneElementType, SceneOp, SceneOpIssue, } from "./scene";
export type { SelectOption, SettingDecl, SettingScopeName, SettingsApi, SettingValue, } from "./settings";
export type { StatusBarApi, StatusBarState } from "./statusBar";
export type { MenuTarget, MenusApi } from "./menus";
export type { ShapeDef, ShapesApi } from "./shapes";
export type { OverlayHandle, OverlayOptions, OverlayProps, OverlaysApi, } from "./overlays";
export type { ThumbnailState, ThumbnailsApi } from "./thumbnails";
export type { ToolHandlers, ToolPoint, ToolsApi } from "./tools";
export type { OpenViewOptions, ViewFile, ViewProps, ViewsApi } from "./views";
export type { Json, StorageApi, StorageScope } from "./storage";
export type { FontsApi, TextApi, TextFont } from "./text";
export type { ThemeApi, ThemeChange, ThemeMode, ThemeTokenName } from "./theme";
export type { VaultApi, VaultEntry, VaultGraphApi, VaultTableApi, VaultTableChange, } from "./vault";
export type { FolderItem, WorkspaceApi } from "./workspace";
export { SHARED_SPECIFIERS } from "./specifiers";

// manifest.ts
import type { SettingDecl } from "./settings";
export interface PluginManifestInfo {
    id: string;
    version: string;
    dir: string;
    permissions: readonly PluginPermission[];
    dataKey: string;
}
export type PluginPermission = "vault.read" | "vault.write" | "folders.import";
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
export interface ImporterContribution {
    id: string;
    title: string;
    extensions: string[];
}
export interface StatusBarContribution {
    id: string;
    title: string;
    align: "left" | "right";
    priority: number;
    command: string | null;
}
export interface ViewContribution {
    id: string;
    title: string;
    extensions: string[];
}
export interface MenuContribution {
    surface: "tree" | "tab" | "canvas";
    command: string;
    title: string | null;
    kinds: ("drawing" | "note" | "folder")[];
}
export interface ToolbarContribution {
    command: string;
    title: string | null;
    icon: string | null;
    priority: number;
}
export interface ToolContribution {
    id: string;
    title: string;
    icon: string | null;
    cursor: "crosshair" | "default" | "pointer" | "grab" | "text" | null;
}
export interface ShapeContribution {
    id: string;
    title: string;
    icon: string | null;
    width: number;
    height: number;
}
export interface PluginContributions {
    commands: CommandContribution[];
    panels: PanelContribution[];
    settings: SettingDecl[];
    importers?: ImporterContribution[];
    status_bar?: StatusBarContribution[];
    views?: ViewContribution[];
    menus?: MenuContribution[];
    toolbar?: ToolbarContribution[];
    tools?: ToolContribution[];
    shapes?: ShapeContribution[];
}

// markdown.ts
export type ByteRange = readonly [number, number];
export interface NoteFrontmatter {
    readonly range: ByteRange;
    readonly raw: string;
    readonly tags: readonly string[];
    readonly aliases: readonly string[];
    readonly properties: Readonly<Record<string, string>>;
}
export interface NoteStats {
    readonly words: number;
    readonly blocks: number;
    readonly droppedEmphasis: number;
    readonly droppedHtml: number;
}
export interface NoteInline {
    readonly kind: "wikilink" | "link" | "tag" | "math" | "footnoteRef";
    readonly start: number;
    readonly end: number;
    readonly target: string;
    readonly alias?: string;
    readonly heading?: string;
    readonly blockRef?: string;
}
export interface NoteBlockBase {
    readonly range: ByteRange;
    readonly blockId?: string;
}
export type NoteBlock = NoteBlockBase & ({
    kind: "heading";
    level: number;
    text: string;
    inline?: readonly NoteInline[];
} | {
    kind: "paragraph";
    text: string;
    inline?: readonly NoteInline[];
} | {
    kind: "listItem";
    ordered: boolean;
    marker: string;
    depth: number;
    task: "none" | "open" | "done";
    text: string;
    inline?: readonly NoteInline[];
} | {
    kind: "code";
    code: true;
    lang?: string;
    text: string;
} | {
    kind: "blockquote";
    blocks: readonly NoteBlock[];
} | {
    kind: "callout";
    calloutType: string;
    title: string;
    foldState: "none" | "open" | "closed";
    blocks: readonly NoteBlock[];
} | {
    kind: "thematicBreak";
} | {
    kind: "table";
    align: readonly ("none" | "left" | "center" | "right")[];
    header: readonly string[];
    rows: readonly (readonly string[])[];
    cols: number;
    cellCount: number;
} | {
    kind: "image";
    target: string;
    remote: boolean;
    alt?: string;
    width?: number;
    height?: number;
} | {
    kind: "embed";
    target: string;
    heading?: string;
    blockRef?: string;
    alt?: string;
    width?: number;
    height?: number;
} | {
    kind: "math";
    latex: string;
} | {
    kind: "footnoteDef";
    label: string;
    blocks: readonly NoteBlock[];
} | {
    kind: "html";
    text: string;
});
export interface NoteLink {
    readonly kind: "wikilink" | "embed" | "link";
    readonly target: string;
    readonly alias?: string;
    readonly heading?: string;
    readonly blockRef?: string;
    readonly range: ByteRange;
}
export interface NoteDoc {
    readonly schemaVersion: number;
    readonly frontmatter?: NoteFrontmatter;
    readonly blocks: readonly NoteBlock[];
    readonly links: readonly NoteLink[];
    readonly tags: readonly string[];
    readonly stats: NoteStats;
}
export interface MarkdownParseOptions {
    softBreakNewline?: boolean;
}
export interface MarkdownApi {
    parse(text: string, options?: MarkdownParseOptions): Promise<NoteDoc>;
}

// menus.ts
export interface MenuTarget {
    surface: "tree" | "tab" | "canvas";
    path: string | null;
    kind?: "drawing" | "note" | "folder" | "other";
    at?: {
        x: number;
        y: number;
    };
}
export interface MenusApi {
    target(): MenuTarget | null;
}

// overlays.ts
import type { ComponentType } from "react";
import type { Disposable } from "./disposable";
export interface OverlayProps {
    close(): void;
}
export interface OverlayOptions {
    onClose?(): void;
}
export interface OverlayHandle extends Disposable {
    close(): void;
    readonly isOpen: boolean;
}
export interface OverlaysApi {
    open(component: ComponentType<OverlayProps>, options?: OverlayOptions): OverlayHandle;
}

// pages.ts
import type { FontFamilyName } from "./scene";
export type PageSizeName = "a3" | "a4" | "a5" | "b5" | "letter" | "legal" | "tablet" | "tabletLarge" | "phone";
export interface PageRequest {
    size?: PageSizeName | {
        width: number;
        height: number;
    };
    orientation?: "portrait" | "landscape";
    layout?: "separate" | "continuous";
}
export interface PageGeometry {
    readonly width: number;
    readonly height: number;
    readonly gap: number;
    readonly pitch: number;
}
export interface FlowItem {
    height: number;
    spaceBefore?: number;
    breakBefore?: boolean;
    keepWithNext?: boolean;
}
export interface FlowOptions {
    contentHeight: number;
}
export interface FlowPlacement {
    readonly page: number;
    readonly y: number;
}
export interface PagesApi {
    geometry(request?: PageRequest): PageGeometry;
    flow(items: readonly FlowItem[], options: FlowOptions): FlowPlacement[];
    createDocument(options: CreateDocumentOptions): Promise<PageDocument>;
    buildScene(items: readonly PageItem[], options: BuildSceneOptions): Promise<object>;
}
export type PageTextTone = "normal" | "muted" | "code" | "link";
export type PageRectFill = "code" | "quote" | "callout" | "table" | "none";
export interface PageTextItem {
    type: "text";
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    fontSize: number;
    fontFamily: FontFamilyName;
    lineHeight: number;
    align?: "left" | "center" | "right";
    tone?: PageTextTone;
    link?: string;
    data?: Record<string, unknown>;
}
export interface PageRectItem {
    type: "rect";
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    fill: PageRectFill;
    stroke?: "none" | "thin";
}
export interface PageLineItem {
    type: "line";
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface PageImageItem {
    type: "image";
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    mimeType: string;
    bytes?: Uint8Array;
    alt?: string;
    target: string;
}
export type PageItem = PageTextItem | PageRectItem | PageLineItem | PageImageItem;
export interface CreateDocumentOptions {
    name: string;
    parent?: string;
    setup?: PageRequest;
    open?: boolean;
}
export interface PageDocument {
    readonly path: string;
    append(items: readonly PageItem[], pageCount: number): void;
    finish(): Promise<{
        path: string;
        revision: string;
    }>;
    abort(): Promise<void>;
}
export interface BuildSceneOptions {
    setup?: PageRequest;
    pageCount: number;
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
import type { HostApi } from "./host";
import type { ImportersApi } from "./importers";
import type { MarkdownApi } from "./markdown";
import type { MenusApi } from "./menus";
import type { PluginManifestInfo } from "./manifest";
import type { PagesApi } from "./pages";
import type { PanelsApi } from "./panels";
import type { SceneContextApi } from "./scene";
import type { SettingsApi } from "./settings";
import type { StatusBarApi } from "./statusBar";
import type { StorageApi } from "./storage";
import type { FoldersApi } from "./folders";
import type { FontsApi, TextApi } from "./text";
import type { ThemeApi } from "./theme";
import type { VaultApi } from "./vault";
import type { ShapesApi } from "./shapes";
import type { ThumbnailsApi } from "./thumbnails";
import type { ToolsApi } from "./tools";
import type { OverlaysApi } from "./overlays";
import type { ViewsApi } from "./views";
import type { WorkspaceApi } from "./workspace";
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
    readonly host: HostApi;
    readonly theme: ThemeApi;
    readonly storage: StorageApi;
    readonly vault: VaultApi;
    readonly workspace: WorkspaceApi;
    readonly importers: ImportersApi;
    readonly markdown: MarkdownApi;
    readonly text: TextApi;
    readonly fonts: FontsApi;
    readonly pages: PagesApi;
    readonly folders: FoldersApi;
    readonly statusBar: StatusBarApi;
    readonly views: ViewsApi;
    readonly menus: MenusApi;
    readonly tools: ToolsApi;
    readonly shapes: ShapesApi;
    readonly overlays: OverlaysApi;
    readonly thumbnails: ThumbnailsApi;
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
import type { Json } from "./storage";
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
    type: "rectangle" | "ellipse" | "diamond" | "text" | "arrow" | "line" | "image";
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
    angle?: number;
    strokeStyle?: "solid" | "dashed" | "dotted";
    fillStyle?: "hachure" | "cross-hatch" | "solid" | "zigzag";
    roundness?: "sharp" | "round";
    fontFamily?: FontFamilyName;
    link?: string | null;
    locked?: boolean;
    data?: Json | null;
    image?: ImageSource;
    start?: ElementRef | ElementId;
    end?: ElementRef | ElementId;
}
export interface ImageSource {
    mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml";
    bytes: Uint8Array;
}
export interface ElementRef {
    ref: string;
}
export interface ElementId {
    id: string;
}
export type FontFamilyName = "Excalifont" | "Nunito" | "Lilita One" | "Comic Shanns" | "Virgil" | "Helvetica" | "Cascadia" | "Liberation Sans";
export type SceneOp = {
    op: "add";
    element: NewElement;
    ref?: string;
} | {
    op: "update";
    id: string;
    props: Partial<Omit<NewElement, "type" | "start" | "end">>;
} | {
    op: "delete";
    id: string;
} | {
    op: "group";
    ids: readonly (string | ElementRef)[];
};
export interface BatchResult {
    ids: string[];
    refs: Record<string, string>;
}
export interface BatchOptions {
    path?: string;
}
export interface SceneElementDetail extends SceneElement {
    readonly groupIds: readonly string[];
    readonly frameId: string | null;
    readonly containerId: string | null;
    readonly locked: boolean;
    readonly link: string | null;
    readonly opacity: number;
    readonly strokeWidth: number;
    readonly strokeStyle: string;
    readonly fillStyle: string;
    readonly roundness: "sharp" | "round";
    readonly fontSize?: number;
    readonly fontFamily?: string;
    readonly fileId?: string | null;
    readonly points?: readonly (readonly [number, number])[];
    readonly data?: Json;
}
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
    batch(ops: readonly SceneOp[], options?: BatchOptions): Promise<BatchResult>;
    viewportCenter(): {
        x: number;
        y: number;
    };
    get(ids: readonly string[], options?: {
        points?: boolean;
        data?: boolean;
    }): readonly SceneElementDetail[];
    dataOf(id: string): Json | undefined;
    path(): string | null;
    scrollTo(id: string): void;
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

// shapes.ts
import type { Disposable } from "./disposable";
import type { Json } from "./storage";
export interface ShapeDef {
    render(props: Json, size: {
        width: number;
        height: number;
    }): string;
    defaults?: Json;
}
export interface ShapesApi {
    register(id: string, def: ShapeDef): Disposable;
    insert(id: string, props?: Json, at?: {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
    }): Promise<string>;
    update(elementId: string, props: Json): Promise<string>;
}

// specifiers.ts
export declare const SHARED_SPECIFIERS: readonly string[];

// statusBar.ts
import type { Disposable } from "./disposable";
export interface StatusBarState {
    text: string;
    tooltip?: string;
    tone?: "normal" | "muted" | "warn" | "error";
}
export interface StatusBarApi {
    set(id: string, state: StatusBarState): void;
    clear(id: string): void;
    show(id: string, state: StatusBarState): Disposable;
}

// storage.ts
export type Json = null | boolean | number | string | readonly Json[] | {
    readonly [key: string]: Json;
};
export interface StorageScope {
    get<T extends Json = Json>(key: string): Promise<T | undefined>;
    set(key: string, value: Json): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
}
export interface StorageApi {
    readonly global: StorageScope;
}

// text.ts
import type { FontFamilyName } from "./scene";
export interface TextFont {
    family: FontFamilyName;
    size: number;
}
export interface TextApi {
    measure(font: TextFont, strings: readonly string[]): Float64Array;
    lineHeight(family: FontFamilyName): number;
}
export interface FontsApi {
    ensure(families: readonly FontFamilyName[], text?: string): Promise<void>;
}

// theme.ts
import type { Disposable } from "./disposable";
export type ThemeTokenName = "--vault-canvas" | "--vault-bg" | "--vault-surface" | "--vault-surface-hover" | "--vault-surface-active" | "--vault-border" | "--vault-border-strong" | "--vault-menu-bg" | "--vault-text" | "--vault-text-muted" | "--vault-text-faint" | "--vault-primary" | "--vault-primary-hover" | "--vault-primary-active" | "--vault-primary-light" | "--vault-primary-border" | "--vault-on-primary" | "--vault-on-danger" | "--vault-accent-text" | "--vault-success" | "--vault-success-bg" | "--vault-success-border" | "--vault-warning" | "--vault-warning-bg" | "--vault-warning-border" | "--vault-danger" | "--vault-danger-bg" | "--vault-danger-border" | "--vault-danger-hover" | "--vault-shadow-sm" | "--vault-shadow-md" | "--vault-shadow-lg" | "--vault-shadow-island" | "--vault-shadow-pop" | "--vault-scrim" | "--vault-hover" | "--vault-chip" | "--vault-chip-strong" | "--vault-sel" | "--vault-sel-strong" | "--vault-ring";
export type ThemeMode = "light" | "dark";
export interface ThemeChange {
    mode: ThemeMode;
    themeId: string;
}
export interface ThemeApi {
    mode(): ThemeMode;
    tokens(): Readonly<Record<ThemeTokenName, string>>;
    onChange(cb: (e: ThemeChange) => void): Disposable;
}

// thumbnails.ts
export interface ThumbnailState {
    status: "loading" | "ready" | "none";
    url: string | null;
}
export interface ThumbnailsApi {
    use(path: string | null, priority?: "visible" | "near"): ThumbnailState;
    useEnabled(): boolean;
    useDarkClass(): string;
}

// tools.ts
import type { Disposable } from "./disposable";
export interface ToolPoint {
    x: number;
    y: number;
    shiftKey: boolean;
    altKey: boolean;
    modKey: boolean;
}
export interface ToolHandlers {
    pointerDown?(point: ToolPoint): void | Promise<void>;
    pointerMove?(point: ToolPoint): void;
    pointerUp?(point: ToolPoint): void | Promise<void>;
    cancel?(): void;
}
export interface ToolsApi {
    register(id: string, handlers: ToolHandlers): Disposable;
}

// vault.ts
import type { SceneElement, SceneOp } from "./scene";
export interface VaultEntry {
    path: string;
    name: string;
    kind: "drawing" | "folder";
    modifiedAt: number;
    size: number;
}
export interface VaultGraphApi {
    read(): Promise<Uint8Array>;
    readonly layout: {
        load(): Promise<Uint8Array>;
        save(bytes: Uint8Array): Promise<void>;
    };
}
export interface VaultTableChange {
    key: string;
    value: unknown;
}
export interface VaultTableApi {
    read(): Promise<Record<string, unknown>>;
    update(changes: readonly VaultTableChange[]): Promise<void>;
}
export interface VaultApi {
    info(): {
        name: string;
        readOnly: boolean;
    } | null;
    list(dir?: string): Promise<VaultEntry[]>;
    readDrawing(path: string): Promise<{
        elements: readonly SceneElement[];
        revision: string;
    }>;
    createDrawing(path: string, ops: readonly SceneOp[]): Promise<{
        path: string;
        revision: string;
        ids: string[];
        refs: Record<string, string>;
    }>;
    readonly graph: VaultGraphApi;
    readonly table: VaultTableApi;
}

// views.ts
import type { ComponentType } from "react";
import type { Disposable } from "./disposable";
export interface ViewFile {
    read(): Promise<{
        text: string;
        revision: string;
    }>;
    write(text: string, expectedRevision: string): Promise<{
        revision: string;
    }>;
}
export interface ViewProps {
    path: string;
    file: ViewFile;
    openPath(path: string, opts?: {
        target?: "current" | "new";
    }): void;
}
export interface OpenViewOptions {
    path?: string;
    newTab?: boolean;
}
export interface ViewsApi {
    register(id: string, component: ComponentType<ViewProps>): Disposable;
    open(id: string, options?: OpenViewOptions): Promise<void>;
}

// workspace.ts
export interface WorkspaceApi {
    open(path: string, opts?: {
        newTab?: boolean;
    }): Promise<void>;
    activePath(): string | null;
    useFolder(path: string): readonly FolderItem[] | undefined;
}
export interface FolderItem {
    path: string;
    name: string;
    kind: "drawing" | "folder" | "note" | "excalidrawMd";
}

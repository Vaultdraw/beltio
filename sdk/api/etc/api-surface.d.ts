// @vaultdraw/api 1.1.0
// clipboard.ts
import type { Disposable } from "./disposable";
export interface PasteEvent {
    readonly text: string;
}
export type PasteResult = "handled" | "pass" | void;
export interface ClipboardApi {
    readText(): Promise<string>;
    onPaste(cb: (event: PasteEvent) => PasteResult | Promise<PasteResult>): Disposable;
}
export interface ToastOptions {
    action?: {
        label: string;
        run: () => void;
    };
    actions?: {
        label: string;
        run: () => void;
    }[];
    detail?: string;
    progress?: {
        done: number;
        total: number;
    };
    id?: string;
    kind?: "info" | "error";
}

// commands.ts
import type { Disposable } from "./disposable";
export interface CommandsApi {
    register(id: string, run: () => void | Promise<void>): Disposable;
    execute(fullId: string): Promise<void>;
}

// diagrams.ts
import type { SceneOp } from "./scene";
export interface MermaidDrawing {
    ops: SceneOp[];
    width: number;
    height: number;
    skipped: number;
}
export interface DiagramsApi {
    mermaidToElements(text: string): Promise<MermaidDrawing>;
}

// disposable.ts
export interface Disposable {
    dispose(): void;
}

// errors.ts
export type PluginErrorCode = "CONFLICT" | "DRAWING_CHANGED" | "FONT_UNAVAILABLE" | "INVALID_ARGUMENT" | "INVALID_FILE" | "INVALID_PATH" | "IO_ERROR" | "NAME_COLLISION" | "NETWORK_ERROR" | "NETWORK_NOT_ALLOWED" | "NO_VAULT" | "NO_VERSION" | "NOT_FOUND" | "NOT_SUPPORTED" | "PERMISSION" | "QUOTA" | "READ_ONLY" | "TIMEOUT" | "TOO_LARGE";
export interface PluginApiError extends Error {
    readonly name: "PluginApiError";
    readonly code: PluginErrorCode;
    readonly issues?: readonly import("./scene").SceneOpIssue[];
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
    level: 1;
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
export type { MethodsApi } from "./methods";
export type { MathApi, MathRequest, MathResult } from "./math";
export type { Disposable } from "./disposable";
export type { PluginApiError, PluginErrorCode } from "./errors";
export type { AppEventMap, EventsApi } from "./events";
export type { CommandContribution, ImporterContribution, MenuContribution, MethodContribution, StatusBarContribution, ToolbarContribution, ToolContribution, ShapeContribution, ViewContribution, PanelContribution, PluginContributions, PluginManifestInfo, PluginPermission, } from "./manifest";
export type { FolderEntry, FoldersApi, PickSourceOptions, PickTargetOptions, SourceFolder, TargetFolder, } from "./folders";
export type { ApiVersion, HostApi } from "./host";
export type { ImportersApi, Importer, ImportInput, ImportOptions, ImportResult, } from "./importers";
export type { ByteRange, MarkdownApi, MarkdownParseOptions, NoteBlock, NoteBlockBase, NoteDoc, NoteFrontmatter, NoteInline, NoteMark, NoteLink, NoteStats, } from "./markdown";
export type { BuildSceneOptions, CreateDocumentOptions, FlowItem, FlowOptions, FlowPlacement, PageDocument, PageGeometry, PageImageItem, PageItem, PageLineItem, PageRectFill, PageRectItem, PageRequest, PageSizeName, PageTextItem, PageTextTone, PagesApi, } from "./pages";
export type { PanelsApi } from "./panels";
export { definePlugin } from "./plugin";
export type { LogApi, Plugin, PluginContext, UiApi } from "./plugin";
export type { BatchOptions, PagePlacement, PageRect, BatchResult, ElementId, ElementRef, ImageSource, FontFamilyName, NewElement, SceneContextApi, SceneElementDetail, SceneElement, SceneElementType, SceneOp, SceneOpIssue, } from "./scene";
export type { SelectOption, SettingDecl, SettingScopeName, SettingsApi, SettingValue, } from "./settings";
export type { StatusBarApi, StatusBarState } from "./statusBar";
export type { MenuTarget, MenusApi } from "./menus";
export type { ShapeDef, ShapesApi } from "./shapes";
export type { OverlayHandle, OverlayOptions, OverlayProps, OverlaysApi, } from "./overlays";
export type { PresentApi, PresentOptions, PresentSession } from "./present";
export type { DiagramsApi, MermaidDrawing } from "./diagrams";
export type { ThumbnailState, ThumbnailsApi } from "./thumbnails";
export type { PdfApi, PdfDocument, PdfImportSettings, PdfPageSize, PdfRenderOptions, } from "./pdf";
export type { ClipboardApi, PasteEvent, PasteResult, ToastOptions, } from "./clipboard";
export type { NetApi, NetRequest, NetResponse } from "./net";
export type { NetworkApi } from "./network";
export type { SecretApi } from "./secret";
export type { ToolHandlers, ToolPoint, ToolsApi } from "./tools";
export type { OpenViewOptions, ViewFile, ViewProps, ViewsApi } from "./views";
export type { Json, StorageApi, StorageScope } from "./storage";
export type { FontsApi, TextApi, TextFont } from "./text";
export type { ThemeApi, ThemeChange, ThemeMode, ThemeTokenName } from "./theme";
export type { VaultApi, VaultEntry, ExportImageOptions, VaultExportsApi, VaultGraphApi, VaultTableApi, VaultTableChange, } from "./vault";
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
export type PluginPermission = "vault.read" | "vault.write" | "folders.import" | "control" | "pdf" | "clipboard" | "network.images" | "net" | "secret";
export interface CommandContribution {
    id: string;
    title: string;
    keys: string[];
    when: string[];
    palette: boolean;
    repeat?: boolean;
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
export interface MethodContribution {
    id: string;
    title: string;
    description?: string | null;
    params?: Record<string, unknown> | null;
    mcp: boolean;
    write: boolean;
    timeout_ms?: number | null;
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
    methods?: MethodContribution[];
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
export interface NoteMark {
    readonly kind: "bold" | "italic" | "code";
    readonly start: number;
    readonly end: number;
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
    marks?: readonly NoteMark[];
} | {
    kind: "paragraph";
    text: string;
    inline?: readonly NoteInline[];
    marks?: readonly NoteMark[];
} | {
    kind: "listItem";
    ordered: boolean;
    marker: string;
    depth: number;
    task: "none" | "open" | "done";
    text: string;
    inline?: readonly NoteInline[];
    marks?: readonly NoteMark[];
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
    headerMarks?: readonly (readonly NoteMark[])[];
    rowMarks?: readonly (readonly (readonly NoteMark[])[])[];
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

// math.ts
import type { Disposable } from "./disposable";
export interface MathRequest {
    source: string;
    display: boolean;
    color: string;
}
export type MathResult = {
    ok: true;
    svg: string;
    width: number;
    height: number;
} | {
    ok: false;
    error: string;
};
export interface MathApi {
    render(request: MathRequest): Promise<MathResult | null>;
    provide(renderer: (request: MathRequest) => Promise<MathResult>): Disposable;
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

// methods.ts
import type { Disposable } from "./disposable";
import type { Json } from "./storage";
export interface MethodsApi {
    register(id: string, handler: (params: Json) => Json | Promise<Json>): Disposable;
}

// net.ts
export interface NetRequest {
    url: string;
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    auth?: {
        secret: string;
        header: string;
        prefix?: string;
    };
}
export interface NetResponse {
    readonly status: number;
    readonly ok: boolean;
    readonly body: AsyncIterable<Uint8Array>;
    text(): Promise<string>;
    close(): void;
}
export interface NetApi {
    request(request: NetRequest, options?: {
        signal?: AbortSignal;
    }): Promise<NetResponse>;
}

// network.ts
export interface NetworkApi {
    askImages(urls: readonly string[]): Promise<boolean>;
    fetchImage(url: string): Promise<Uint8Array>;
}

// overlays.ts
import type { ComponentType } from "react";
import type { Disposable } from "./disposable";
export interface OverlayProps {
    close(): void;
}
export interface OverlayOptions {
    onClose?(): void;
    modal?: boolean;
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
export type PageTextTone = "normal" | "muted" | "code" | "link" | "heading1" | "heading2" | "heading3" | "heading4" | "heading5" | "heading6";
export type PageRectFill = "code" | "quote" | "callout" | "table" | "bar" | "none";
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
    bold?: boolean;
    lineHeight: number;
    align?: "left" | "center" | "right";
    tone?: PageTextTone;
    link?: string;
    data?: Record<string, unknown>;
    group?: string;
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
    group?: string;
}
export interface PageLineItem {
    type: "line";
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    strong?: boolean;
    group?: string;
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
    group?: string;
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

// pdf.ts
export interface PdfPageSize {
    readonly widthPt: number;
    readonly heightPt: number;
}
export interface PdfRenderOptions {
    maxSide: number;
    format: "jpeg" | "png";
    quality: number;
}
export interface PdfDocument {
    readonly name: string;
    readonly pageCount: number;
    readonly pages: readonly PdfPageSize[];
    readonly byteSize: number;
    readonly locked: boolean;
    render(index: number, options: PdfRenderOptions): Promise<Uint8Array>;
    unlock(password: string): Promise<PdfDocument>;
    close(): Promise<void>;
}
export interface PdfImportSettings {
    maxSide: number;
    format: "jpeg" | "png";
    quality: number;
    lockPages: boolean;
    warnPages: number;
    pixelBudgetMp: number;
}
export interface PdfApi {
    pick(): Promise<PdfDocument | null>;
    open(name: string, bytes: Uint8Array): Promise<PdfDocument>;
    settings(): PdfImportSettings;
}

// plugin.ts
import type { CommandsApi } from "./commands";
import type { MethodsApi } from "./methods";
import type { Disposable } from "./disposable";
import type { EventsApi } from "./events";
import type { HostApi } from "./host";
import type { ImportersApi } from "./importers";
import type { MarkdownApi } from "./markdown";
import type { MathApi } from "./math";
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
import type { DiagramsApi } from "./diagrams";
import type { ClipboardApi, ToastOptions } from "./clipboard";
import type { NetApi } from "./net";
import type { NetworkApi } from "./network";
import type { SecretApi } from "./secret";
import type { PdfApi } from "./pdf";
import type { ThumbnailsApi } from "./thumbnails";
import type { ToolsApi } from "./tools";
import type { OverlaysApi } from "./overlays";
import type { PresentApi } from "./present";
import type { ViewsApi } from "./views";
import type { WorkspaceApi } from "./workspace";
export interface UiApi {
    toast(message: string, options?: ToastOptions): void;
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
    readonly methods: MethodsApi;
    readonly math: MathApi;
    readonly overlays: OverlaysApi;
    readonly thumbnails: ThumbnailsApi;
    readonly diagrams: DiagramsApi;
    readonly pdf: PdfApi;
    readonly clipboard: ClipboardApi;
    readonly network: NetworkApi;
    readonly net: NetApi;
    readonly secret: SecretApi;
    readonly present: PresentApi;
    readonly subscriptions: Disposable[];
    setTimeout(fn: () => void, ms: number): Disposable;
    setInterval(fn: () => void, ms: number): Disposable;
}
export interface Plugin {
    activate(ctx: PluginContext): void | Promise<void>;
    deactivate?(): void | Promise<void>;
}
export declare const definePlugin: (plugin: Plugin) => Plugin;

// present.ts
import type { Disposable } from "./disposable";
export interface PresentOptions {
    background?: string;
    fullscreen?: boolean;
    onEnd?(): void;
}
export interface PresentSession extends Disposable {
    end(): void;
    readonly isActive: boolean;
    setLaser(on: boolean): void;
    readonly laser: boolean;
}
export interface PresentApi {
    start(options?: PresentOptions): Promise<PresentSession>;
    readonly active: boolean;
}

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
    readonly name?: string;
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
    name?: string;
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
    pageCount?: number;
    reveal?: boolean;
}
export interface PageRect {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface PagePlacement {
    rects: PageRect[];
    pageCount: number | null;
    firstPage: number | null;
    maxPages: number | null;
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
    fitTo(id: string, options?: {
        padding?: number;
        select?: boolean;
        animate?: boolean;
    }): void;
    selection(): readonly string[];
    currentStrokeColor(): string;
    currentTextStyle(): {
        fontFamily: FontFamilyName;
        fontSize: number;
    };
    placePages(sizes: readonly {
        width: number;
        height: number;
    }[]): PagePlacement;
    sizeBytes(): number;
}

// secret.ts
export interface SecretApi {
    set(name: string, value: string): Promise<void>;
    has(name: string): Promise<boolean>;
    delete(name: string): Promise<void>;
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
    bold?: boolean;
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
export type ThemeTokenName = "--vault-canvas" | "--vault-bg" | "--vault-surface" | "--vault-surface-hover" | "--vault-surface-active" | "--vault-border" | "--vault-border-strong" | "--vault-menu-bg" | "--vault-text" | "--vault-text-muted" | "--vault-text-faint" | "--vault-primary" | "--vault-primary-hover" | "--vault-primary-active" | "--vault-primary-light" | "--vault-primary-border" | "--vault-on-primary" | "--vault-on-danger" | "--vault-accent" | "--vault-accent-text" | "--vault-success" | "--vault-success-bg" | "--vault-success-border" | "--vault-warning" | "--vault-warning-bg" | "--vault-warning-border" | "--vault-danger" | "--vault-danger-bg" | "--vault-danger-border" | "--vault-danger-hover" | "--vault-shadow-sm" | "--vault-shadow-md" | "--vault-shadow-lg" | "--vault-shadow-island" | "--vault-shadow-pop" | "--vault-scrim" | "--vault-hover" | "--vault-chip" | "--vault-chip-strong" | "--vault-sel" | "--vault-sel-strong" | "--vault-ring" | "--vault-ring-inset" | "--vault-md-h1" | "--vault-md-h2" | "--vault-md-h3" | "--vault-md-h4" | "--vault-md-h5" | "--vault-md-h6" | "--vault-md-bold" | "--vault-md-italic" | "--vault-md-link" | "--vault-md-code" | "--vault-md-code-bg" | "--vault-md-quote-bar";
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
export interface ExportImageOptions {
    format: "svg" | "png";
    scale?: number;
    background?: boolean;
    dark?: boolean;
}
export interface VaultExportsApi {
    render(path: string, to: string, options: ExportImageOptions): Promise<{
        path: string;
        size: number;
    } | null>;
    move(from: string, to: string): Promise<boolean>;
    remove(path: string): Promise<boolean>;
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
    replaceDrawing(path: string, scene: object, options: {
        versionName: string;
        onlyIfUntouched?: boolean;
    }): Promise<{
        revision: string;
        created?: boolean;
    } | {
        skipped: "changed" | "unknown";
    }>;
    trashDrawing(path: string, options: {
        versionName: string;
        onlyIfUntouched?: boolean;
    }): Promise<{
        trashed: true;
    } | {
        skipped: "changed" | "unknown";
    }>;
    readonly graph: VaultGraphApi;
    readonly exports: VaultExportsApi;
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
    openShortcut(path: string): string | null;
    useFolder(path: string): readonly FolderItem[] | undefined;
}
export interface FolderItem {
    path: string;
    name: string;
    kind: "drawing" | "folder" | "note" | "excalidrawMd";
}

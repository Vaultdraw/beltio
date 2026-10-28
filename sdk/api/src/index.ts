/**
 * `@vaultdraw/api`: the public types of the Vaultdraw plugin API.
 *
 * @packageDocumentation
 */
export type { CommandsApi } from "./commands";
export type { MethodsApi } from "./methods";
export type { MathApi, MathRequest, MathResult } from "./math";
export type { Disposable } from "./disposable";
export type { AppEventMap, EventsApi } from "./events";
export type {
  CommandContribution,
  ImporterContribution,
  MenuContribution,
  MethodContribution,
  StatusBarContribution,
  ToolbarContribution,
  ToolContribution,
  ShapeContribution,
  ViewContribution,
  PanelContribution,
  PluginContributions,
  PluginManifestInfo,
  PluginPermission,
} from "./manifest";
export type {
  FolderEntry,
  FoldersApi,
  PickSourceOptions,
  PickTargetOptions,
  SourceFolder,
  TargetFolder,
} from "./folders";
export type { ApiVersion, HostApi } from "./host";
export type {
  ImportersApi,
  Importer,
  ImportInput,
  ImportOptions,
  ImportResult,
} from "./importers";
export type {
  ByteRange,
  MarkdownApi,
  MarkdownParseOptions,
  NoteBlock,
  NoteBlockBase,
  NoteDoc,
  NoteFrontmatter,
  NoteInline,
  NoteLink,
  NoteStats,
} from "./markdown";
export type {
  BuildSceneOptions,
  CreateDocumentOptions,
  FlowItem,
  FlowOptions,
  FlowPlacement,
  PageDocument,
  PageGeometry,
  PageImageItem,
  PageItem,
  PageLineItem,
  PageRectFill,
  PageRectItem,
  PageRequest,
  PageSizeName,
  PageTextItem,
  PageTextTone,
  PagesApi,
} from "./pages";
export type { PanelsApi } from "./panels";
export { definePlugin } from "./plugin";
export type { LogApi, Plugin, PluginContext, UiApi } from "./plugin";
export type {
  BatchOptions,
  PagePlacement,
  PageRect,
  BatchResult,
  ElementId,
  ElementRef,
  ImageSource,
  FontFamilyName,
  NewElement,
  SceneContextApi,
  SceneElementDetail,
  SceneElement,
  SceneElementType,
  SceneOp,
  SceneOpIssue,
} from "./scene";
export type {
  SelectOption,
  SettingDecl,
  SettingScopeName,
  SettingsApi,
  SettingValue,
} from "./settings";
export type { StatusBarApi, StatusBarState } from "./statusBar";
export type { MenuTarget, MenusApi } from "./menus";
export type { ShapeDef, ShapesApi } from "./shapes";
export type {
  OverlayHandle,
  OverlayOptions,
  OverlayProps,
  OverlaysApi,
} from "./overlays";
export type { DiagramsApi, MermaidDrawing } from "./diagrams";
export type { ThumbnailState, ThumbnailsApi } from "./thumbnails";
export type {
  PdfApi,
  PdfDocument,
  PdfImportSettings,
  PdfPageSize,
  PdfRenderOptions,
} from "./pdf";
export type {
  ClipboardApi,
  PasteEvent,
  PasteResult,
  ToastOptions,
} from "./clipboard";
export type { ToolHandlers, ToolPoint, ToolsApi } from "./tools";
export type { OpenViewOptions, ViewFile, ViewProps, ViewsApi } from "./views";
export type { Json, StorageApi, StorageScope } from "./storage";
export type { FontsApi, TextApi, TextFont } from "./text";
export type { ThemeApi, ThemeChange, ThemeMode, ThemeTokenName } from "./theme";
export type {
  VaultApi,
  VaultEntry,
  ExportImageOptions,
  VaultExportsApi,
  VaultGraphApi,
  VaultTableApi,
  VaultTableChange,
} from "./vault";
export type { FolderItem, WorkspaceApi } from "./workspace";
export { SHARED_SPECIFIERS } from "./specifiers";

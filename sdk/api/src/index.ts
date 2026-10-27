/**
 * `@vaultdraw/api`: the public types of the Vaultdraw plugin API.
 *
 * @packageDocumentation
 */
export type { CommandsApi } from "./commands";
export type { Disposable } from "./disposable";
export type { AppEventMap, EventsApi } from "./events";
export type {
  CommandContribution,
  ImporterContribution,
  StatusBarContribution,
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
export type { Json, StorageApi, StorageScope } from "./storage";
export type { FontsApi, TextApi, TextFont } from "./text";
export type { ThemeApi, ThemeChange, ThemeMode, ThemeTokenName } from "./theme";
export type { VaultApi, VaultEntry } from "./vault";
export type { WorkspaceApi } from "./workspace";
export { SHARED_SPECIFIERS } from "./specifiers";

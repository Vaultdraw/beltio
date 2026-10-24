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
  PanelContribution,
  PluginContributions,
  PluginManifestInfo,
  PluginPermission,
} from "./manifest";
export type { ApiVersion, HostApi } from "./host";
export type { PanelsApi } from "./panels";
export { definePlugin } from "./plugin";
export type { LogApi, Plugin, PluginContext, UiApi } from "./plugin";
export type {
  NewElement,
  SceneContextApi,
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
export type { ThemeApi, ThemeChange, ThemeMode, ThemeTokenName } from "./theme";
export { SHARED_SPECIFIERS } from "./specifiers";

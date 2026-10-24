/**
 * Runtime and types of `@vaultdraw/api` (v0, experimental). Plugins import it
 * through the import map, so every plugin shares this one copy. The public
 * types live in `sdk/api` (imported type-only); `definePlugin` is the same
 * identity function as the SDK's.
 */
import type { Plugin } from "../../../../sdk/api/src/index";

export type {
  ApiVersion,
  AppEventMap,
  CommandContribution,
  CommandsApi,
  Disposable,
  EventsApi,
  HostApi,
  LogApi,
  NewElement,
  PanelContribution,
  PanelsApi,
  Plugin,
  PluginContext,
  PluginContributions,
  PluginManifestInfo,
  PluginPermission,
  SceneContextApi,
  SceneElement,
  SceneElementType,
  SceneOp,
  SceneOpIssue,
  SelectOption,
  SettingDecl,
  SettingScopeName,
  SettingsApi,
  SettingValue,
  ThemeApi,
  ThemeChange,
  ThemeMode,
  ThemeTokenName,
  UiApi,
} from "../../../../sdk/api/src/index";

export const definePlugin = (plugin: Plugin): Plugin => plugin;

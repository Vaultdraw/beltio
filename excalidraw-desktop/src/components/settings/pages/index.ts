import { pdfImportControls } from "../../../pdfImport/PdfImportSettings";

import { watchControls } from "../../../watch/watchSettingsControls";
import { speculativeControls } from "../../../speculative/speculativeSettingsControls";
import { servicesControls } from "../../../services/servicesSettingsControls";
import { tabsControls } from "../../../tabs/tabsSettingsControls";
import { layoutControls } from "../../../layout/layoutSettingsControls";
import { memoryControls } from "../../../memory/memorySettingsControls";
import { syncControls } from "../../../sync/syncSettingsControls";

import { aboutControls } from "./About";
import { appearanceControls } from "./Appearance";
import { controlControls } from "./Control";
import { drawingControls } from "./Drawing";
import { filesControls } from "./Files";
import { generalControls } from "./General";
import { hotkeysControls } from "./Hotkeys";
import { historyControls } from "./History";
import { interfaceControls } from "./Interface";
import { linksControls } from "./Links";
import { networkControls } from "./Network";
import { tagsControls } from "./TagsSettings";
import { pageControls } from "./Page";
import { pluginsControls } from "./pluginsEntry";
import { extensionsControls } from "./extensionsEntry";
import { pensControls } from "./Pens";
import { toolDefaultsControls } from "./ToolDefaults";
import { watchdogControls } from "./Watchdog";
import { windowChromeControls } from "./WindowChrome";

import type { SettingControls } from "../SettingsContext";

/** Every setting's control, keyed by schema id. */
export const SETTING_CONTROLS: SettingControls = {
  ...generalControls,
  ...networkControls,
  ...appearanceControls,
  ...pageControls,
  ...interfaceControls,
  ...watchdogControls,
  ...windowChromeControls,
  ...tabsControls,
  ...layoutControls,
  ...memoryControls,
  ...syncControls,
  ...servicesControls,
  ...speculativeControls,
  ...watchControls,
  ...drawingControls,
  ...pensControls,
  ...toolDefaultsControls,
  ...filesControls,
  ...pdfImportControls,
  ...linksControls,
  ...tagsControls,
  ...historyControls,
  ...hotkeysControls,
  ...extensionsControls,
  ...pluginsControls,
  ...controlControls,
  ...aboutControls,
};

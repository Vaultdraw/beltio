import { pdfImportControls } from "../../../pdfImport/PdfImportSettings";

import { servicesControls } from "../../../services/servicesSettingsControls";
import { tabsControls } from "../../../tabs/tabsSettingsControls";
import { memoryControls } from "../../../memory/memorySettingsControls";

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
import { tagsControls } from "./TagsSettings";
import { pageControls } from "./Page";
import { pluginsControls } from "./pluginsEntry";
import { pensControls } from "./Pens";
import { toolDefaultsControls } from "./ToolDefaults";

import type { SettingControls } from "../SettingsContext";

/** Every setting's control, keyed by schema id. */
export const SETTING_CONTROLS: SettingControls = {
  ...generalControls,
  ...appearanceControls,
  ...pageControls,
  ...interfaceControls,
  ...tabsControls,
  ...memoryControls,
  ...servicesControls,
  ...drawingControls,
  ...pensControls,
  ...toolDefaultsControls,
  ...filesControls,
  ...pdfImportControls,
  ...linksControls,
  ...tagsControls,
  ...historyControls,
  ...hotkeysControls,
  ...pluginsControls,
  ...controlControls,
  ...aboutControls,
};

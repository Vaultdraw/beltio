/**
 * Settings > Plugins entry: the page (and with it the plugin host chunk) loads
 * only when it is shown, so Settings stays free of plugin code otherwise.
 */
import { lazy, Suspense } from "react";

import { getSettingSchema } from "../schema";

import type { SettingControls } from "../SettingsContext";

const PluginsPage = lazy(() =>
  import("./Plugins").then((m) => ({ default: m.PluginsPage })),
);

const LazyPluginsPage = () => (
  <Suspense fallback={null}>
    <PluginsPage />
  </Suspense>
);

/** Search results only point at the page. */
const PluginsSearchHint = () => (
  <p className="vault-settings-empty">
    {getSettingSchema("plugins-installed").description}
  </p>
);

export const pluginsControls: SettingControls = {
  "plugins-installed": {
    Component: LazyPluginsPage,
    SearchComponent: PluginsSearchHint,
  },
};

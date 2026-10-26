/**
 * Settings → Extensions entry: the page loads only when it is shown.
 */
import { lazy, Suspense } from "react";

import { getSettingSchema } from "../schema";

import type { SettingControls } from "../SettingsContext";

const ExtensionsPage = lazy(() =>
  import("./Extensions").then((m) => ({ default: m.ExtensionsPage })),
);

const LazyExtensionsPage = () => (
  <Suspense fallback={null}>
    <ExtensionsPage />
  </Suspense>
);

/** Search results only point at the page. */
const ExtensionsSearchHint = () => (
  <p className="vault-settings-empty">
    {getSettingSchema("extensions-list").description}
  </p>
);

export const extensionsControls: SettingControls = {
  "extensions-list": {
    Component: LazyExtensionsPage,
    SearchComponent: ExtensionsSearchHint,
  },
};

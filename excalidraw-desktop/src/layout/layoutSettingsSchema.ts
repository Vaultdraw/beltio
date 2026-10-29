/**
 * Schema rows of the "Layout" section on the Interface settings page. Spread
 * into components/settings/schema.ts with one line. Pure data.
 */
import type { SettingSchema } from "../components/settings/schema";

export const LAYOUT_SETTINGS_SCHEMA: readonly SettingSchema[] = [
  {
    id: "layout-header",
    page: "interface",
    heading: "Layout",
    label: "Header",
    description:
      "Show the bar above the canvas with the drawing's name, save status, History and Graph. Focus mode ({{key:view.focusMode}}) hides it too.",
    keywords: ["layout", "header", "title", "bar", "hide", "focus", "zen"],
    configKey: "layout.header",
    perVault: false,
  },
  {
    id: "layout-footer",
    page: "interface",
    label: "Editor footer",
    description: "Show the zoom, undo and help buttons under the canvas.",
    keywords: ["layout", "footer", "zoom", "undo", "help", "hide", "focus"],
    configKey: "layout.footer",
    perVault: false,
  },
];

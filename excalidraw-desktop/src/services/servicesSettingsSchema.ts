/**
 * Schema rows of the "Startup" section on the General settings page (D8).
 * Spread into components/settings/schema.ts with one line. Pure data.
 */
import type { SettingSchema } from "../components/settings/schema";

const row = (
  s: Omit<SettingSchema, "page" | "keywords" | "perVault"> & {
    keywords?: string[];
  },
): SettingSchema => ({
  page: "general",
  perVault: false,
  ...s,
  keywords: [
    "startup",
    "start",
    "lazy",
    "idle",
    "performance",
    "speed",
    ...(s.keywords ?? []),
  ],
});

export const SERVICES_SETTINGS_SCHEMA: readonly SettingSchema[] = [
  row({
    id: "services-search-start",
    heading: "Startup",
    label: "Start search index",
    description:
      "When the vault opens, once the app is idle, or on your first search. Later starts make opening a vault cheaper; the first search then waits for the index.",
    keywords: ["search", "index", "find"],
    configKey: "search.start",
  }),
  row({
    id: "services-links-start",
    label: "Start link index",
    description:
      "When backlinks and link lookups are prepared. Starting links also starts search, which it is built from.",
    keywords: ["links", "backlinks", "graph", "index"],
    configKey: "links.start",
  }),
  row({
    id: "services-history-start",
    label: "Start file history",
    description:
      "When the vault opens (every version kept), once idle, or on your first edit or history action. Changes made before history starts are not versioned.",
    keywords: ["history", "versions"],
    configKey: "history.start",
  }),
];

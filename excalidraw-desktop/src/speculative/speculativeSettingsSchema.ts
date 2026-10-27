/** Settings row for `files.speculative_open`. Spread into components/settings/schema.ts. */
import type { SettingSchema } from "../components/settings/schema";

export const SPECULATIVE_SETTINGS_SCHEMA: readonly SettingSchema[] = [
  {
    id: "files-speculative-open",
    page: "files",
    label: "Read drawings ahead on mouse-down",
    description:
      "Pressing on a drawing in the file tree, a tab or the switcher starts reading it before you let go, so it opens sooner. Holds one drawing for a moment; nothing when you do not click.",
    keywords: [
      "speed",
      "performance",
      "open",
      "switch",
      "prefetch",
      "speculative",
    ],
    configKey: "files.speculative_open",
    perVault: false,
  },
];

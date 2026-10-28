/**
 * Schema rows of the "Memory" section on the Interface settings page. Spread
 * into components/settings/schema.ts with one line. Pure data.
 */
import type { SettingSchema } from "../components/settings/schema";

export const MEMORY_SETTINGS_SCHEMA: readonly SettingSchema[] = [
  {
    id: "memory-free-unused-images",
    page: "interface",
    heading: "Memory",
    label: "Free images you can no longer undo back",
    description:
      "Image data of deleted images is released once no undo or redo step can restore it. Saved drawings never change.",
    keywords: ["memory", "ram", "image", "undo", "free", "release"],
    configKey: "memory.free_unused_images",
    perVault: false,
  },
  {
    id: "memory-undo-steps",
    page: "interface",
    label: "Undo steps kept per drawing",
    description:
      "Older steps are dropped, and with them the images only they could restore.",
    keywords: ["memory", "undo", "history", "limit", "horizon", "steps"],
    configKey: "memory.undo_steps",
    perVault: false,
  },
  {
    id: "memory-low-memory-canvas",
    page: "interface",
    label: "Low-memory canvas (restart to apply)",
    description:
      "Uses about 100 MB less memory; panning drops to about 60 frames per second. Applies the next time Vaultdraw starts.",
    keywords: ["memory", "ram", "canvas", "gpu", "pan", "low", "frames"],
    configKey: "memory.low_memory_canvas",
    perVault: false,
  },
];

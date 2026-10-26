/**
 * Handlers of the extension commands (extensionCommandDefs.ts). They write `[extensions]` like Settings does; the change applies
 * live. The palette's fuzzy filter ("ext tog") is the picker.
 */
import { toastStore } from "../toasts/toastStore";
import { getPreferences, updatePreferences } from "../vault/preferences";

import { EXTENSION_DEFAULTS } from "./extensionSettings";
import {
  EXTENSIONS_DEFAULTS_COMMAND_ID,
  extensionToggleCommandId,
} from "./extensionCommandDefs";
import {
  BUILTIN_EXTENSIONS,
  EXTENSION_FIELDS,
  type ExtensionId,
} from "./registry";
import { isExtensionsSafeOverlay } from "./useExtensions";

import type { CommandHandlers } from "../commands/types";

const safeNote = () =>
  isExtensionsSafeOverlay() ? " (applies after Restart normally)" : "";

/** Flip one switch and say what happened. */
export function toggleExtension(id: ExtensionId, win?: Window | null): void {
  const field = EXTENSION_FIELDS[id];
  const next = !getPreferences(win)[field];
  updatePreferences({ [field]: next }, win);
  const { title } = BUILTIN_EXTENSIONS.find((e) => e.id === id)!;
  toastStore.push({
    message: `${title} turned ${next ? "on" : "off"}${safeNote()}`,
  });
}

export function restoreExtensionDefaults(win?: Window | null): void {
  updatePreferences({ ...EXTENSION_DEFAULTS }, win);
  toastStore.push({ message: `Extensions restored to defaults${safeNote()}` });
}

export const EXTENSION_COMMAND_HANDLERS: CommandHandlers = {
  ...Object.fromEntries(
    BUILTIN_EXTENSIONS.map((e) => [
      extensionToggleCommandId(e.id),
      () => toggleExtension(e.id),
    ]),
  ),
  [EXTENSIONS_DEFAULTS_COMMAND_ID]: () => restoreExtensionDefaults(),
};

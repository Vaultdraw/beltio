/**
 * Profile commands: switch, new, duplicate, delete. They open one small dialog
 * (<ProfileDialogHost> in the app shell, loaded on first use). Every command is
 * rebindable and has no default key. Like the config commands they work on files only.
 */
import { toastStore } from "../toasts/toastStore";

import type { CommandDefinition, CommandHandlers } from "./types";

export const PROFILE_COMMAND_IDS = {
  switch: "profile.switch",
  new: "profile.new",
  duplicate: "profile.duplicate",
  delete: "profile.delete",
} as const;

const I = PROFILE_COMMAND_IDS;

const command = (id: string, title: string): CommandDefinition => ({
  id,
  title,
  category: "Profile",
  keys: { default: [] },
});

export const PROFILE_COMMANDS: CommandDefinition[] = [
  command(I.switch, "Profile: Switch profile"),
  command(I.new, "Profile: New profile"),
  command(I.duplicate, "Profile: Duplicate a profile"),
  command(I.delete, "Profile: Delete a profile"),
];

export type ProfileDialogMode = "switch" | "new" | "duplicate" | "delete";
export interface ProfileDialogRequest {
  mode: ProfileDialogMode;
  /** Changes with every open so the dialog starts fresh. */
  id: number;
}

let request: ProfileDialogRequest | null = null;
let seq = 0;
const listeners = new Set<() => void>();

export const subscribeProfileDialog = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getProfileDialog = () => request;
export const closeProfileDialog = () => {
  request = null;
  listeners.forEach((l) => l());
};

/** Open the profile dialog (desktop only: profiles are files in the config folder). */
export const openProfileDialog = async (mode: ProfileDialogMode) => {
  // Imported on use: settingsSync imports the command list, so a static import would loop.
  const { isConfigFolderActive } = await import("../vault/settingsSync");
  if (!isConfigFolderActive()) {
    toastStore.push({
      message: "Profiles are only available in the desktop app",
      kind: "error",
    });
    return;
  }
  request = { mode, id: ++seq };
  listeners.forEach((l) => l());
};

export const PROFILE_COMMAND_HANDLERS: CommandHandlers = {
  [I.switch]: () => void openProfileDialog("switch"),
  [I.new]: () => void openProfileDialog("new"),
  [I.duplicate]: () => void openProfileDialog("duplicate"),
  [I.delete]: () => void openProfileDialog("delete"),
};

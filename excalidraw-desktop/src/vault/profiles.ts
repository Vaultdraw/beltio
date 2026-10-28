/**
 * Profiles: named sets of settings (a folder `profiles/<name>/` in the config folder,
 * layered over config.toml). The native side does the files; these helpers call it and
 * reload, so the new profile's values apply at once. `default` is the plain config.
 */
import { toastStore } from "../toasts/toastStore";

import {
  getSettingsStatus,
  isConfigFolderActive,
  nativeCall,
  profileCall,
} from "./settingsSync";
import { getVaultSettingsSnapshot } from "./vaultSettings";

export const DEFAULT_PROFILE = "default";
const NAME = /^[A-Za-z0-9_-]{1,48}$/;

/** Why `name` cannot be a new profile name, or null. */
export const profileNameError = (
  name: string,
  existing: readonly string[],
): string | null => {
  if (!NAME.test(name) || name.toLowerCase() === DEFAULT_PROFILE) {
    return 'Use 1 to 48 letters, digits, "_" or "-" (not "default").';
  }
  return existing.some((n) => n.toLowerCase() === name.toLowerCase())
    ? `A profile named "${name}" already exists.`
    : null;
};

/** The active profile (null = default) and every profile, from the last settings load. */
export const getProfiles = () => {
  const status = getSettingsStatus();
  return { active: status.profile ?? null, profiles: status.profiles ?? [] };
};

const useProfile = (name: string | null) =>
  profileCall("profile_use", {
    name: name === DEFAULT_PROFILE ? null : name,
  });

/**
 * The global choice to return to once the open vault no longer names a profile;
 * `undefined` while no vault profile is applied.
 */
let globalChoice: { name: string | null } | undefined;

/** Switch to a profile; `null` or `default` goes back to the plain config. A manual switch is the new global choice. */
export const switchProfile = (name: string | null) => {
  globalChoice = undefined;
  return useProfile(name);
};

/** Create a profile, empty or copied from another (`default` copies Settings changes). */
export const createProfile = (name: string, from: string | null) =>
  profileCall("profile_create", { name, from });

export const deleteProfile = (name: string) =>
  profileCall("profile_delete", { name });

/**
 * A vault can name its profile in the one-line file `.excalidraw-vault/profile`. When the
 * vault opens, that profile is active while it is open; opening a vault without one goes back
 * to the global choice (the profile that was active before). A name with no profile folder
 * on this machine is ignored with a note.
 */
export async function applyVaultProfile(handle: string): Promise<void> {
  if (!isConfigFolderActive()) {
    return;
  }
  try {
    const name = await nativeCall<string | null>("Profiles", "vault_profile", {
      handle,
    });
    if (!name) {
      if (globalChoice) {
        const back = globalChoice.name;
        globalChoice = undefined;
        await useProfile(back);
        toastStore.push({
          message: `Profile "${back ?? DEFAULT_PROFILE}" (your choice).`,
        });
      }
      return;
    }
    if (name === getProfiles().active) {
      return;
    }
    if (!getProfiles().profiles.includes(name)) {
      toastStore.push({
        message: `This vault asks for the profile "${name}", which does not exist here.`,
        kind: "error",
      });
      return;
    }
    globalChoice ??= { name: getProfiles().active };
    await useProfile(name);
    toastStore.push({ message: `Profile "${name}" (set by this vault).` });
  } catch {
    // A vault without the file, or one that is closing: nothing to apply.
  }
}

/** Make the active profile this vault's (`null` clears it). Writes `.excalidraw-vault/profile`. */
export async function setVaultProfile(name: string | null): Promise<void> {
  const handle = getVaultSettingsSnapshot().handle;
  if (!handle) {
    throw new Error("Open a vault first.");
  }
  await nativeCall("Profiles", "set_vault_profile", { handle, name });
}

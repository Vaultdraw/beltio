/**
 * Profiles: named sets of settings (a folder `profiles/<name>/` in the config folder,
 * layered over config.toml). The native side does the files; these helpers call it and
 * reload, so the new profile's values apply at once. `default` is the plain config.
 */
import { getSettingsStatus, profileCall } from "./settingsSync";

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

/** Switch to a profile; `null` or `default` goes back to the plain config. */
export const switchProfile = (name: string | null) =>
  profileCall("profile_use", {
    name: name === DEFAULT_PROFILE ? null : name,
  });

/** Create a profile, empty or copied from another (`default` copies Settings changes). */
export const createProfile = (name: string, from: string | null) =>
  profileCall("profile_create", { name, from });

export const deleteProfile = (name: string) =>
  profileCall("profile_delete", { name });

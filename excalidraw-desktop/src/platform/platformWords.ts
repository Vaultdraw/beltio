/**
 * The platform's own words in user text (toimprove 287): Cmd on a Mac and Ctrl elsewhere, Finder on
 * a Mac, "file manager" on Linux. One helper so no text names another system's key or app.
 */
import { detectPlatform } from "../commands/keys";

type Platform = ReturnType<typeof detectPlatform>;

export const modKeyWord = (platform: Platform = detectPlatform()): string =>
  platform === "mac" ? "Cmd" : "Ctrl";

export const fileManagerWord = (
  platform: Platform = detectPlatform(),
): string =>
  platform === "mac"
    ? "Finder"
    : platform === "win"
    ? "File Explorer"
    : "file manager";

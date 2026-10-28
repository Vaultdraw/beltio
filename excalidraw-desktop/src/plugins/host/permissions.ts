/**
 * Permission names and their consent text. A permission is a declaration and a
 * consent record, not a sandbox (sdk/docs/permissions.md): the host loads a
 * plugin only while the user has confirmed what it declares.
 */
import type { PluginInfo } from "./types";

/** What the user reads in the enable dialog, per permission. */
export const PERMISSION_TEXT: Readonly<Record<string, string>> = {
  "vault.read": "Read the drawings in your vault",
  "vault.write": "Create drawings and write export images in your vault",
  "folders.import":
    "Read a folder you pick and write into a destination you pick",
  clipboard: "Read the clipboard text and see the text you paste",
  pdf: "Open PDF files you pick and draw their pages",
  control:
    "Let the vaultdraw command, scripts and the AI apps you allow call its methods",
};

/** The consent line of one permission (the raw name for one this app does not know). */
export const permissionText = (name: string): string =>
  PERMISSION_TEXT[name] ?? name;

export type ReviewState = PluginInfo["review"]["state"];

/** A plugin whose update added a write permission stays off until the user confirms. */
export const needsReview = (info: Pick<PluginInfo, "review">): boolean =>
  info.review.state === "review";

/** One sentence for a toast: what an update added. */
export const addedText = (added: readonly string[]): string =>
  added.map((p) => permissionText(p).toLowerCase()).join(", ");

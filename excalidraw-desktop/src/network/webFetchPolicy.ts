/**
 * Where the webview download guard asks "is this download blocked?" (Offline mode, the per-purpose
 * switch). Kept free of imports so the guard and the backends stay light (the e2e server config
 * bundles them). `theme/install/consent.ts` registers the real answer when the download dialogs
 * load. Until then the answer is "blocked": a download can never go out before the policy is known.
 */
export type WebFetchField = "networkAllowThemes" | "networkAllowPlugins";

type Policy = (field: WebFetchField, win: Window) => string | null;

let policy: Policy | null = null;

export const setWebFetchPolicy = (next: Policy): void => {
  policy = next;
};

/** The reason a download for `field` is blocked, or null when it may go ahead. */
export const webFetchBlockReason = (
  field: WebFetchField,
  win: Window,
): string | null =>
  policy
    ? policy(field, win)
    : "Downloads are not ready yet. Open the themes or plugins dialog again.";

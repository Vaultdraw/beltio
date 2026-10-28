import { APP_VERSION } from "../appVersion";
import {
  isTauriAvailable,
  loadTauriInvoke,
} from "../vault/DesktopVaultRepository";

import { toastStore } from "../toasts/toastStore";

import { bugReportUrl, featureRequestUrl } from "./links";

import type { ReportEnv } from "./links";

/** Opens `url` in the default browser (a Rust command; never the webview). */
export async function openExternal(url: string): Promise<void> {
  const invoke = isTauriAvailable(window) ? await loadTauriInvoke() : null;
  if (invoke) {
    await invoke("open_external_url", { url });
    return;
  }
  // Browser preview and tests only.
  window.open(url, "_blank", "noopener,noreferrer");
}

/** A link the system opens outside the app: a web link (`http`, `https`) or a mail link (`mailto:`). */
export const isWebLink = (url: string): boolean =>
  /^(?:https?:\/\/|mailto:)/i.test(url.trim());

/**
 * Opens a link the user clicked and never fails silently: a refusal or a missing browser shows
 * a notice. Every click-to-open path uses this (bug hunt BH-2: note links did nothing).
 */
export function openWebLink(
  url: string,
  opts: { open?: () => Promise<void>; label?: string } = {},
): Promise<void> {
  return (opts.open ?? (() => openExternal(url)))().catch((err: unknown) => {
    toastStore.push({
      kind: "error",
      message: `Couldn't open ${opts.label ?? url}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  });
}

async function reportEnv(): Promise<ReportEnv> {
  const env: ReportEnv = { version: APP_VERSION };
  try {
    const invoke = isTauriAvailable(window) ? await loadTauriInvoke() : null;
    if (invoke) {
      const info = (await invoke("system_info")) as {
        os: string;
        version: string;
        arch: string;
      };
      env.os = info.os;
      env.osVersion = info.version;
      env.arch = info.arch;
    }
  } catch {
    // The report still opens, just without the system line.
  }
  return env;
}

export const openBugReport = async (): Promise<void> =>
  openExternal(bugReportUrl(await reportEnv()));

export const openFeatureRequest = (): Promise<void> =>
  openExternal(featureRequestUrl());

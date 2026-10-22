import { APP_VERSION } from "../appVersion";
import {
  isTauriAvailable,
  loadTauriInvoke,
} from "../vault/DesktopVaultRepository";

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

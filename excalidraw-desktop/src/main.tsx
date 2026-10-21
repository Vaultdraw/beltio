import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { installMemoryManagement } from "./memory/install";
import { installNativeContextMenuSuppression } from "./platform/nativeContextMenu";
import { getPreferences, getTheme, resolveTheme } from "./vault/preferences";
import { initSettings } from "./vault/settingsSync";

import "./desktop.css";

// Desktop-only bootstrap. No Sentry, Firebase, collaboration, service
// worker, or web analytics — the vault shell starts fully offline and the
// native side owns persistence. DOM APIs are derived from the mount node's
// ownerDocument/defaultView per repo convention (no bare `document`/`window`
// globals beyond the initial mount lookup fallback).
// Boot phase marks (read with performance.getEntriesByName("vaultdraw:boot:..."), e.g.
// from the perf harness or devtools); times are ms since navigation start.
const mark = (name: string) => performance.mark(`vaultdraw:boot:${name}`);
mark("main-start");

const mountNode = document.getElementById("root");

if (!mountNode) {
  throw new Error("Vaultdraw: #root mount node not found");
}

const ownerDocument = mountNode.ownerDocument;
const ownerWindow = ownerDocument.defaultView;
if (!ownerWindow) {
  throw new Error("Vaultdraw: mount window is unavailable");
}

ownerWindow.__EXCALIDRAW_DESKTOP__ = true;
// Custom desktop protocols may have a opaque `location.origin`; preserve the
// actual document URL rather than constructing an invalid "null/" asset base.
ownerWindow.EXCALIDRAW_ASSET_PATH = new ownerWindow.URL(
  "./",
  ownerWindow.location.href,
).href;
ownerWindow.__EXCALIDRAW_SHA__ = import.meta.env.VITE_APP_GIT_SHA;
// Release builds: no native WebView menu ("Reload" would restart the frontend).
installNativeContextMenuSuppression(ownerWindow);
// The macOS window uses an overlay title bar (see tauri.conf.json), so the
// app's own top bar leaves room for the window buttons.
if (/Mac/.test(ownerWindow.navigator.userAgent)) {
  ownerDocument.documentElement.classList.add("vault-macos");
}
if (ownerWindow.matchMedia("(prefers-color-scheme: dark)").matches) {
  ownerDocument.documentElement.classList.add("dark");
}

// Establish the local asset policy before the editor's font modules initialize.
// An external module script respects CSP without allowing inline scripts.
// Settings are hydrated from the config folder (Tauri) before the first
// render so every synchronous preferences read sees config.toml values.
// initSettings never throws; in a plain browser it keeps localStorage.
void initSettings(ownerWindow)
  .then(async () => {
    mark("settings-ready");
    ownerDocument.documentElement.classList.toggle(
      "dark",
      resolveTheme(getTheme(ownerWindow), ownerWindow) === "dark",
    );
    // Interface zoom before the first render (no native call at 100 %).
    void import("./vault/zoom").then(({ applyWebviewZoom, clampZoom }) =>
      applyWebviewZoom(clampZoom(getPreferences(ownerWindow).zoom)),
    );
    // Colour theme before the first render (no flash of the default look).
    // Never fatal: a broken theme setup falls back to the stock look.
    try {
      const [{ loadThemeRegistry }, { applyAppearance, computeAppearance }] =
        await Promise.all([
          import("./theme/registry"),
          import("./vault/appearance"),
        ]);
      const registry = await loadThemeRegistry(ownerWindow);
      applyAppearance(
        ownerDocument,
        computeAppearance(getPreferences(ownerWindow), registry, ownerWindow),
      );
    } catch {
      // VaultApp retries through useAppearance.
    }
    mark("theme-applied");
    return import("./VaultApp");
  })
  .then(({ default: VaultApp }) => {
    mark("app-module-ready");
    const root = createRoot(mountNode);
    root.render(
      <StrictMode>
        <VaultApp ownerDocument={ownerDocument} ownerWindow={ownerWindow} />
      </StrictMode>,
    );
    installMemoryManagement(ownerWindow);
    mark("render-called");
    ownerWindow.requestAnimationFrame(() => mark("first-frame"));
    // Plugin host: after the first frame, on idle (WebKit has no rIC).
    const startPlugins = () =>
      void import("./plugins/host/start")
        .then(({ startPluginHost }) => startPluginHost(ownerWindow))
        .catch((error: unknown) =>
          console.error("Plugin host failed to start", error),
        );
    // Also in perf and smoke builds, so the harness measures the host's cost.
    ownerWindow.requestAnimationFrame(() =>
      typeof ownerWindow.requestIdleCallback === "function"
        ? ownerWindow.requestIdleCallback(startPlugins)
        : ownerWindow.setTimeout(startPlugins, 200),
    );
    if (import.meta.env.VITE_APP_PERF_TEST === "true") {
      ownerWindow.setTimeout(() => {
        void import("./perf/runDesktopPerf")
          .then(({ runDesktopPerf }) => runDesktopPerf())
          .catch(async (error: unknown) => {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("smoke_finish", {
              status: 1,
              details: { startupFailure: String(error) },
            });
          });
      }, 100);
    } else if (import.meta.env.VITE_APP_SMOKE_TEST === "true") {
      ownerWindow.setTimeout(() => {
        void import("./smoke/runDesktopSmoke")
          .then(({ runDesktopSmoke }) => runDesktopSmoke())
          .catch(async (error: unknown) => {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("smoke_finish", {
              status: 1,
              details: { startupFailure: String(error) },
            });
          });
      }, 100);
    }
  })
  .catch((error: unknown) => {
    mountNode.textContent = `Could not start Vaultdraw: ${String(error)}`;
  });

declare global {
  interface Window {
    __EXCALIDRAW_DESKTOP__?: boolean;
  }
}

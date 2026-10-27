import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { installMemoryManagement } from "./memory/install";
import { installCanvasTracker } from "./perf/canvasTracker";
import { installNativeContextMenuSuppression } from "./platform/nativeContextMenu";
import { waitAtMost } from "./platform/waitAtMost";
import { bootPlugins } from "./plugins/boot";
import { getPreferences, getTheme, resolveTheme } from "./vault/preferences";
import { initSettings } from "./vault/settingsSync";

import "./desktop.css";

// Perf builds track canvases for the memory probe (VAULTDRAW_PERF_LAYER_DIR).
if (import.meta.env.VITE_APP_PERF_TEST === "true") {
  installCanvasTracker(window);
}

// Smoke builds collect CSP violations for the plugin smoke step.
if (import.meta.env.VITE_APP_SMOKE_TEST === "true") {
  const list: unknown[] = ((window as any).__cspViolations = []);
  window.addEventListener("securitypolicyviolation", (e) =>
    list.push({
      directive: e.violatedDirective,
      blockedURI: e.blockedURI,
      sample: e.sample,
    }),
  );
}

// Desktop-only bootstrap. No Sentry, Firebase, collaboration, service
// worker, or web analytics — the vault shell starts fully offline and the
// native side owns persistence. DOM APIs are derived from the mount node's
// ownerDocument/defaultView per repo convention (no bare `document`/`window`
// globals beyond the initial mount lookup fallback).
// Boot phase marks (read with performance.getEntriesByName("vaultdraw:boot:..."), e.g.
// from the perf harness or devtools); times are ms since navigation start.
/** Longest the first paint waits for enabled CSS snippets (ms). */
const SNIPPETS_WAIT_MS = 150;

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
    // Enabled CSS snippets: read in parallel with the theme registry below.
    // No snippets, no work. Never fatal: the app starts without them.
    const snippetsReady =
      getPreferences(ownerWindow).snippets.length > 0
        ? import("./snippets/store")
            .then(({ reloadSnippets }) =>
              reloadSnippets(ownerDocument, ownerWindow),
            )
            .catch(() => {})
        : null;
    // Colour theme before the first render (no flash of the default look).
    // Never fatal: a broken theme setup falls back to the stock look.
    try {
      const [
        { loadSelectedTheme, loadThemeRegistry },
        { applyAppearance, computeAppearance },
      ] = await Promise.all([
        import("./theme/registry"),
        import("./vault/appearance"),
      ]);
      const registry = await loadThemeRegistry(ownerWindow);
      // A lazy built-in's chunk lands before the first paint (no flash).
      await loadSelectedTheme(registry, getPreferences(ownerWindow).colorTheme);
      applyAppearance(
        ownerDocument,
        computeAppearance(getPreferences(ownerWindow), registry, ownerWindow),
      );
    } catch {
      // VaultApp retries through useAppearance.
    }
    mark("theme-applied");
    // Enabled CSS snippets were listed in parallel with the theme (order is
    // kept by styleOrder.ts). Wait for them only a moment: a slow or hung
    // folder read must not hold the first paint; they apply when they land.
    if (snippetsReady) {
      const inTime = await waitAtMost(snippetsReady, SNIPPETS_WAIT_MS);
      mark(inTime ? "snippets-applied" : "snippets-late");
    }
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
    // Plugin host loads only when a plugin is enabled.
    ownerWindow.requestAnimationFrame(() => bootPlugins(ownerWindow));
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

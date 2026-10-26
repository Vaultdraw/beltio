import * as react from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as reactDom from "react-dom";
import * as reactDomClient from "react-dom/client";

import * as api from "../api";

/** Static map so Vite splits each lazy module into its own chunk. */
const LAZY_LOADERS: Record<string, () => Promise<unknown>> = {
  "@codemirror/state": () => import("@codemirror/state"),
  "@codemirror/view": () => import("@codemirror/view"),
  "@codemirror/language": () => import("@codemirror/language"),
  "@codemirror/commands": () => import("@codemirror/commands"),
  "@lezer/common": () => import("@lezer/common"),
  "@lezer/highlight": () => import("@lezer/highlight"),
};

const loaded = new Map<string, Promise<unknown>>();

/** Dynamic import per lazy key, cached; used by the lazy shims. */
const load = (key: string): Promise<unknown> => {
  const loader = LAZY_LOADERS[key];
  if (!loader) {
    return Promise.reject(new Error(`unknown lazy shared module: ${key}`));
  }
  let p = loaded.get(key);
  if (!p) {
    p = loader();
    loaded.set(key, p);
  }
  return p;
};

/**
 * Publishes the app's own module instances for the generated import-map shims
 * (`window.__vaultdraw[...]`), so plugins share one React. Idempotent. Only
 * imported lazily by the plugin host, never on the startup path.
 */
export const exposeSharedModules = (win: Window): void => {
  const target = win as Window & { __vaultdraw?: Record<string, unknown> };
  if (target.__vaultdraw) {
    return;
  }
  target.__vaultdraw = {
    react,
    "react/jsx-runtime": jsxRuntime,
    "react-dom": reactDom,
    "react-dom/client": reactDomClient,
    "@vaultdraw/api": api,
    load,
  };
};

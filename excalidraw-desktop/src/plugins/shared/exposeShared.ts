import * as react from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as reactDom from "react-dom";
import * as reactDomClient from "react-dom/client";

import * as api from "../api";

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
  };
};

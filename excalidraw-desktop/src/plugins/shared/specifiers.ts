/**
 * Single list of the modules plugins may import bare. Each one is served to
 * plugins by a generated shim (import map) that re-exports the host's own
 * instance from `window.__vaultdraw[globalKey]`. Adding one is an app release.
 * Pure data: imported by the Vite plugin and by the runtime.
 */
export interface SharedModule {
  /** Bare specifier as written in plugin source. */
  specifier: string;
  /** Key on `window.__vaultdraw`. */
  globalKey: string;
  /**
   * Loaded on first import by a plugin (shim awaits `__vaultdraw.load(key)`);
   * nothing of it is fetched or run at startup.
   */
  lazy?: boolean;
}

export const SHARED_MODULES: readonly SharedModule[] = [
  { specifier: "react", globalKey: "react" },
  { specifier: "react/jsx-runtime", globalKey: "react/jsx-runtime" },
  { specifier: "react-dom", globalKey: "react-dom" },
  { specifier: "react-dom/client", globalKey: "react-dom/client" },
  { specifier: "@vaultdraw/api", globalKey: "@vaultdraw/api" },
  {
    specifier: "@codemirror/state",
    globalKey: "@codemirror/state",
    lazy: true,
  },
  { specifier: "@codemirror/view", globalKey: "@codemirror/view", lazy: true },
  {
    specifier: "@codemirror/language",
    globalKey: "@codemirror/language",
    lazy: true,
  },
  {
    specifier: "@codemirror/commands",
    globalKey: "@codemirror/commands",
    lazy: true,
  },
  { specifier: "@lezer/common", globalKey: "@lezer/common", lazy: true },
  { specifier: "@lezer/highlight", globalKey: "@lezer/highlight", lazy: true },
];

/** Folder (app-root relative, no leading slash) the shim files are served from. */
export const SHIM_DIR = "plugin-shims";

/** File name of a specifier's shim, e.g. "react/jsx-runtime" -> "react-jsx-runtime.js". */
export const shimFileName = (specifier: string): string =>
  `${specifier.replace(/^@/, "").replace(/\//g, "-")}.js`;

/**
 * Root-relative URL used in the import map. Import maps resolve against the
 * document base URL, so this is the app origin whichever origin the importing
 * plugin module was loaded from (vdplugin://localhost/...).
 */
export const shimUrl = (specifier: string): string =>
  `/${SHIM_DIR}/${shimFileName(specifier)}`;

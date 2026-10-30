// The app's search fold (`ctx.text.fold`, API 1.2): the plugin installs it at activation, so the
// graph filter matches names the way the quick switcher and the vault search do. A module of its
// own so activation does not load the filters.
let foldText: (s: string) => string = (s) => s.toLowerCase();

export const installFold = (fn: (s: string) => string) => {
  foldText = fn;
};

export const fold = (s: string) => foldText(s);

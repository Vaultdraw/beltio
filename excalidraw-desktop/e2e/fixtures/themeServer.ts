/** Serves one fixture theme from the preview server at /e2e-themes/Midnight.json. */
import type { Plugin } from "vite";

export const MIDNIGHT_THEME = JSON.stringify({
  name: "Midnight",
  author: "E2E",
  dark: {
    mPrimary: "#4aa3ff",
    mOnPrimary: "#08121f",
    mSurface: "#101820",
    mOnSurface: "#e8eef5",
  },
});

export const e2eThemeFixtures = (): Plugin => ({
  name: "e2e-theme-fixtures",
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!/^\/e2e-themes\/Midnight\.json(\?.*)?$/.test(req.url ?? "")) {
        return next();
      }
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(MIDNIGHT_THEME);
    });
  },
});

# __NAME__

A Vaultdraw plugin written in TypeScript.

| Command | What it does |
| --- | --- |
| `npm install` | Install the dev tools (esbuild, TypeScript, Vitest, and the `vaultdraw-plugin` command from the SDK folder `init` ran from) |
| `npm run dev` | Build into `dist/`, copy it into your plugins folder, rebuild on every save |
| `npm test` | Run the tests (`src/main.test.ts`) without the app |
| `npm run build` | Bundle `src/main.ts` into `dist/main.js` |
| `npm run check` | Static checks of `dist/` |
| `npm run package` | Write `__ID__-0.1.0.zip` and its `.sha256` file |

After the first `npm run dev`: in Vaultdraw press Cmd+Shift+P (Ctrl+Shift+P on Linux), run "Plugins: Reload plugin list", then enable the plugin in Settings, Plugins.

The `vaultdraw/` folder holds the API types and the test kit, copied by `vaultdraw-plugin init`. There is nothing to install for them.

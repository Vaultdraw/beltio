// No ?plugins: the app's default official plugin (the gallery) is listed by the fake backend so
// its stubs work. Kept apart from pluginHarness.ts, whose imports would load the plugin host.
// @ts-expect-error the CLI is plain .mjs
import { parseToml } from "../../sdk/cli/src/toml.mjs";
import favouritesToml from "../../plugins/official/favourites/plugin.toml?raw";
import formulaToml from "../../plugins/official/formula/plugin.toml?raw";
import autoExportToml from "../../plugins/official/auto-export/plugin.toml?raw";
import galleryToml from "../../plugins/official/gallery/plugin.toml?raw";
import pdfImportToml from "../../plugins/official/pdf-import/plugin.toml?raw";
import { setPluginsBackend } from "../src/plugins/host/backend";
import {
  createFakeBackend,
  makePluginInfo,
} from "../src/plugins/host/fakeBackend";

/**
 * No ?plugins: the app's default official plugins (the gallery, formula and the PDF import) can be listed by
 * the fake backend, so their stubs work. Nothing starts until one is used (the host loads on first use). The
 * PDF rows are served by the harness's in-memory renderer (`window.__pdfBridge`, see harnessMain.tsx).
 */
export async function installDefaultBackend(win: Window): Promise<void> {
  const { bootPlugins } = await import("../src/plugins/boot");
  // The manifests are bundled into the harness: listing them fetches nothing.
  const infoOf = (id: string, toml: string) => {
    const doc = parseToml(toml);
    return makePluginInfo(id, {
      name: doc.name,
      version: doc.version,
      source: "bundled",
      dataKey: doc.data_key ?? null,
      permissions: doc.permissions ?? [],
      activation: doc.activation ?? [],
      contributes: {
        commands: doc.contributes.commands.map((x: any) => ({
          id: x.id,
          title: x.title,
          keys: x.keys ?? [],
          when: x.when ?? [],
          palette: x.palette ?? true,
          repeat: x.repeat ?? false,
        })),
        panels: (doc.contributes.panels ?? []).map((x: any) => ({
          id: x.id,
          title: x.title,
          icon: x.icon ?? null,
          group: x.group ?? "top",
        })),
        menus: (doc.contributes.menus ?? []).map((x: any) => ({
          surface: x.surface,
          command: x.command,
          title: x.title ?? null,
          kinds: x.kinds ?? [],
        })),
        importers: (doc.contributes.importers ?? []).map((x: any) => ({
          id: x.id,
          title: x.title,
          extensions: x.extensions,
        })),
        settings: (doc.contributes.settings ?? []).map((x: any) => ({
          key: x.key,
          type: x.type,
          title: x.title,
          ...(x.description ? { description: x.description } : {}),
          default: x.default,
          ...(x.min !== undefined ? { min: x.min } : {}),
          ...(x.max !== undefined ? { max: x.max } : {}),
          ...(x.options ? { options: x.options } : {}),
          ...(x.scope ? { scope: x.scope } : {}),
        })),
      },
    });
  };
  const infos = [
    infoOf("gallery", galleryToml),
    infoOf("favourites", favouritesToml),
    infoOf("formula", formulaToml),
    infoOf("pdf-import", pdfImportToml),
    infoOf("auto-export", autoExportToml),
  ];
  const backend = createFakeBackend(
    infos,
    (id, path) => `/e2e-plugins/${id}/${path}`,
    (path, scene) =>
      (win as any).__vaultRepo?.seedDrawing(path, JSON.stringify(scene)),
  );
  backend.pdf = (win as any).__pdfBridge;
  // The plugin API reads the drawings the app holds (the in-memory vault) and writes exports into
  // `backend.exportFiles`, which specs read through `window.__exportFiles()`.
  backend.drawingSource = async (path) => {
    const repo = (win as any).__vaultRepo;
    try {
      const file = await repo.readDrawing(repo.handle, path);
      return { scene: JSON.parse(file.json), revision: file.revision };
    } catch {
      return null;
    }
  };
  (win as any).__exportFiles = () =>
    Object.fromEntries(
      Object.entries(backend.exportFiles).map(([k, v]) => [
        k,
        new TextDecoder().decode(v),
      ]),
    );
  setPluginsBackend(backend);
  bootPlugins(win); // the stubs, as main.tsx does in the app
}

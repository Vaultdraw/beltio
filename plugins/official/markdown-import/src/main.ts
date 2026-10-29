/**
 * markdown-import: Markdown to page-mode drawings, and Obsidian vaults to drawing vaults.
 * The shell only: parsing is the host's (ctx.markdown), layout is the worker's (deps.ts),
 * building the drawing is the host's (ctx.pages.createDocument).
 */
import { definePlugin } from "@vaultdraw/api";

import { registerCommands } from "./commands";
import { chooseImportFolder } from "./obsidian/freshFolder";
import {
  importObsidianVault,
  layoutNoteStream,
  type LayoutOptions,
} from "./deps";
import { createWebImages } from "./webImages";
import {
  fontFamilyOf,
  parseOptions,
  layoutFamiliesOf,
  readSettings,
  type ImportSettings,
} from "./settings";

import type {
  ImportInput,
  PageDocument,
  Plugin,
  PluginContext,
} from "@vaultdraw/api";

export interface Timings {
  name: string;
  parseMs: number;
  tableMs: number;
  firstPageMs: number | null;
  doneMs: number;
  parts: number;
  elements: number;
}

export interface Importing {
  pickAndImport(): Promise<void>;
  importClipboard(documentFont: boolean): Promise<void>;
  pickWithDocumentFont(): Promise<void>;
  jumpHeading(direction: 1 | -1): void;
  showTimings(): void;
  importObsidian(destination: "newVault" | "vaultFolder"): Promise<void>;
  cancelObsidian(): boolean;
}

/** Web pictures through `ctx.network` when this app has it (API 0.31.0), else labelled boxes. */
const webImagesOf = (ctx: PluginContext) =>
  createWebImages(ctx.host.has("network") ? ctx.network : undefined);

const stem = (fileName: string): string =>
  fileName.replace(/^.*[\\/]/, "").replace(/\.(md|markdown|txt)$/i, "") ||
  "Note";

const ms = (n: number) => `${Math.round(n)} ms`;

const abortError = () =>
  Object.assign(new Error("cancelled"), { name: "AbortError" });

/** A file picker through a detached input (the same call the app's own Import file… uses). */
function pickMarkdownFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.txt,text/markdown,text/plain";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), {
      once: true,
    });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

const plugin: Plugin = definePlugin({
  activate(base) {
    const ctx = base;
    let last: Timings | null = null;
    let obsidianAbort: AbortController | null = null;

    /** The one import path: text in, one or more page-mode drawings out. */
    async function importText(
      text: string,
      fileName: string,
      signal: AbortSignal,
      settings: ImportSettings,
    ): Promise<void> {
      const t0 = performance.now();
      const family = fontFamilyOf(settings);
      await ctx.fonts.ensure(layoutFamiliesOf(settings), text);
      const t1 = performance.now();
      const doc = await ctx.markdown.parse(text, parseOptions(settings));
      const t2 = performance.now();
      if (signal.aborted) {
        throw abortError();
      }
      const setup = { size: settings.pageSize, layout: "separate" as const };
      const opts: LayoutOptions = {
        family,
        fontSize: settings.fontSize,
        page: ctx.pages.geometry(setup),
        partElements: settings.partElements,
        headingColors: settings.headingColors ?? true,
        measure: (f, s) => ctx.text.measure(f, s),
        signal,
      };
      const web = webImagesOf(ctx);
      const base = `${stem(fileName)} (imported`;
      const cur: { doc: PageDocument | null } = { doc: null };
      let part = 0;
      let firstPage: number | null = null;
      let elements = 0;
      const open = async (n: number) => {
        cur.doc = await ctx.pages.createDocument({
          name: n === 1 ? `${base})` : `${base}, part ${n})`,
          setup,
          open: n === 1,
        });
        part = n;
      };
      try {
        for await (const batch of layoutNoteStream(doc, opts)) {
          if (signal.aborted) {
            break;
          }
          if (batch.part !== part) {
            await cur.doc?.finish();
            await open(batch.part);
          }
          await web.fill(batch.items, signal);
          cur.doc!.append(batch.items, batch.pageCount);
          elements += batch.items.length;
          firstPage ??= performance.now() - t0;
        }
      } catch (err) {
        await cur.doc?.abort();
        throw err;
      }
      if (signal.aborted) {
        await cur.doc?.abort();
        throw abortError();
      }
      await cur.doc?.finish();
      last = {
        name: fileName,
        parseMs: t2 - t1,
        tableMs: t1 - t0,
        firstPageMs: firstPage,
        doneMs: performance.now() - t0,
        parts: part,
        elements,
      };
      ctx.log.info(`markdown import ${JSON.stringify(last)}`);
    }

    // The importer: a .md file picked or dropped anywhere (no drawing needs to be open).
    ctx.subscriptions.push(
      ctx.importers.register("md", {
        async import(input: ImportInput, opts) {
          if (/\.excalidraw\.md$/i.test(input.name)) {
            ctx.ui.toast(
              "An Obsidian Excalidraw drawing is not a note. Import the whole vault with Import Obsidian vault…",
            );
            return;
          }
          await importText(
            await input.text(),
            input.name,
            opts.signal,
            readSettings(ctx),
          );
        },
      }),
    );

    const run = async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          throw err;
        }
      }
    };

    const imp: Importing = {
      pickAndImport: () =>
        run(async () => {
          const file = await pickMarkdownFile();
          if (file) {
            await importText(
              await file.text(),
              file.name,
              new AbortController().signal,
              readSettings(ctx),
            );
          }
        }),
      async importClipboard(documentFont) {
        let text = "";
        try {
          text = await navigator.clipboard.readText();
        } catch {
          ctx.ui.toast(
            "Vaultdraw can't read the clipboard here. Save the text as a .md file and use Import: Markdown…",
          );
          return;
        }
        if (!text.trim()) {
          ctx.ui.toast("The clipboard has no text to import");
          return;
        }
        const s = readSettings(ctx);
        await run(() =>
          importText(
            text,
            "Clipboard",
            new AbortController().signal,
            documentFont ? { ...s, font: "document" } : s,
          ),
        );
      },
      // "with the Document font": a picked file, in the Document font whatever the setting says.
      pickWithDocumentFont: () =>
        run(async () => {
          const file = await pickMarkdownFile();
          if (file) {
            await importText(
              await file.text(),
              file.name,
              new AbortController().signal,
              { ...readSettings(ctx), font: "document" },
            );
          }
        }),
      jumpHeading(direction) {
        const heads = ctx.scene
          .elements()
          .filter(
            (e) =>
              e.type === "text" &&
              typeof (
                ctx.scene.dataOf(e.id) as { heading?: number } | undefined
              )?.heading === "number",
          )
          .sort((a, b) => a.y - b.y);
        if (heads.length === 0) {
          ctx.ui.toast("No imported headings in this drawing");
          return;
        }
        const here = ctx.scene.viewportCenter().y;
        const eps = 4;
        const target =
          direction === 1
            ? heads.find((e) => e.y > here + eps)
            : [...heads].reverse().find((e) => e.y < here - eps);
        if (target) {
          ctx.scene.scrollTo(target.id);
        } else {
          ctx.ui.toast(
            direction === 1 ? "No next heading" : "No previous heading",
          );
        }
      },
      showTimings() {
        if (!last) {
          ctx.ui.toast("No import yet in this session");
          return;
        }
        const t = last;
        ctx.log.info(`import timings ${JSON.stringify(t)}`);
        ctx.ui.toast(
          `${t.name}: table ${ms(t.tableMs)}, parse ${ms(
            t.parseMs,
          )}, first page ${
            t.firstPageMs === null ? "none" : ms(t.firstPageMs)
          }, done ${ms(t.doneMs)} (${t.elements} elements, ${t.parts} ${
            t.parts === 1 ? "drawing" : "drawings"
          })`,
        );
      },
      async importObsidian(destination) {
        if (obsidianAbort) {
          ctx.ui.toast("A vault import is already running");
          return;
        }
        const source = await ctx.folders.pickSource({
          title: "Choose an Obsidian vault",
        });
        if (!source) {
          return;
        }
        // The folder is decided before any write: a repeated import goes to
        // "<Vault> (import N)" whenever the folder already holds something.
        const folder =
          destination === "newVault"
            ? undefined
            : await chooseImportFolder(source.name, (dir) =>
                ctx.vault.list(dir),
              );
        const target = await ctx.folders.pickTarget(
          folder === undefined
            ? { kind: "newVault", title: "Where to create the new vault" }
            : { kind: "vaultFolder", path: folder },
        );
        if (!target) {
          return;
        }
        const controller = new AbortController();
        obsidianAbort = controller;
        let shown = 0;
        try {
          const web = webImagesOf(ctx);
          const result = await importObsidianVault({
            web,
            ctx,
            source,
            target,
            settings: readSettings(ctx),
            signal: controller.signal,
            nextTarget:
              destination === "vaultFolder"
                ? (attempt) =>
                    ctx.folders.pickTarget({
                      kind: "vaultFolder",
                      path: `${source.name} (import ${attempt})`,
                    })
                : undefined,
            onProgress(done, total, current) {
              // A bar with a count, updated in place about 3 times a second.
              const now = performance.now();
              if (now - shown > 300 || done >= total) {
                shown = now;
                ctx.ui.toast("Importing notes", {
                  id: "obsidian-import",
                  detail: current,
                  progress: { done, total },
                  actions: [
                    {
                      label: "Cancel",
                      run: () => controller.abort("cancel"),
                    },
                  ],
                });
              }
            },
          });
          const written = result.target ?? target;
          if (controller.signal.aborted) {
            ctx.ui.toast(`Import cancelled after ${result.notes} notes`, {
              id: "obsidian-import",
              detail: `They stay in ${written.name}`,
            });
          } else {
            const noPicture =
              result.oversizedImages +
              result.unsupportedImages +
              result.missingImages;
            const detail = [
              written.name !== source.name
                ? `Imported before, so this copy is "${written.name}"`
                : `From ${source.name}`,
              web.downloaded ? `${web.downloaded} web pictures downloaded` : "",
              noPicture
                ? `${noPicture} images left as boxes (${result.oversizedImages} over 4 MB, ${result.unsupportedImages} unsupported, ${result.missingImages} not found)`
                : "",
            ]
              .filter(Boolean)
              .join(" · ");
            const report = result.report;
            ctx.ui.toast(
              `Imported ${result.notes} notes and ${result.drawings} drawings`,
              {
                id: "obsidian-import",
                detail,
                ...(report
                  ? {
                      actions: [
                        {
                          label: "View report",
                          run: () => void ctx.workspace.open(report),
                        },
                      ],
                    }
                  : {}),
              },
            );
          }
          await written.open();
        } catch (err) {
          if (controller.signal.aborted) {
            ctx.ui.toast("Import cancelled", { id: "obsidian-import" });
          } else {
            ctx.ui.toast("Obsidian import failed", {
              id: "obsidian-import",
              kind: "error",
              detail: (err as Error).message,
            });
            throw err;
          }
        } finally {
          obsidianAbort = null;
        }
      },
      cancelObsidian() {
        if (!obsidianAbort) {
          return false;
        }
        obsidianAbort.abort("cancel");
        return true;
      },
    };
    registerCommands(ctx, imp);
  },
});

export default plugin;

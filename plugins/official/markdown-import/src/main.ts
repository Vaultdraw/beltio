/**
 * markdown-import: Markdown to page-mode drawings, and Obsidian vaults to drawing vaults.
 * The shell only: parsing is the host's (ctx.markdown), layout is the worker's (deps.ts),
 * building the drawing is the host's (ctx.pages.createDocument).
 */
import { definePlugin } from "@vaultdraw/api";
import type { ImportInput, Plugin } from "@vaultdraw/api";

import { registerCommands } from "./commands";
import {
  importObsidianVault,
  layoutNoteStream,
  type LayoutOptions,
} from "./deps";
import { fontFamilyOf, readSettings, type ImportSettings } from "./settings";

import type { Ctx09, PageDocument } from "./api09";

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
    const ctx = base as Ctx09;
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
      await ctx.fonts.ensure([family], text);
      const t1 = performance.now();
      const doc = await ctx.markdown.parse(text);
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
        measure: (f, s) => ctx.text.measure(f, s),
        lineHeight: ctx.text.lineHeight(family),
        signal,
      };
      const base = `${stem(fileName)} (imported`;
      let current: PageDocument | null = null;
      let part = 0;
      let firstPage: number | null = null;
      let elements = 0;
      const open = async (n: number) => {
        current = await ctx.pages.createDocument({
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
            await current?.finish();
            await open(batch.part);
          }
          current!.append(batch.items, batch.pageCount);
          elements += batch.items.length;
          firstPage ??= performance.now() - t0;
        }
      } catch (err) {
        await current?.abort();
        throw err;
      }
      if (signal.aborted) {
        await current?.abort();
        throw abortError();
      }
      await current?.finish();
      last = {
        name: fileName,
        parseMs: t2 - t1,
        tableMs: t1 - t0,
        firstPageMs: firstPage,
        doneMs: performance.now() - t0,
        parts: part,
        elements,
      };
      ctx.log.info("markdown import", last);
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
        ctx.log.info("import timings", t);
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
        const target = await ctx.folders.pickTarget(
          destination === "newVault"
            ? { kind: "newVault", title: "Where to create the new vault" }
            : { kind: "vaultFolder", path: source.name },
        );
        if (!target) {
          return;
        }
        const controller = new AbortController();
        obsidianAbort = controller;
        let shown = 0;
        try {
          const result = await importObsidianVault({
            ctx,
            source,
            target,
            settings: readSettings(ctx),
            signal: controller.signal,
            onProgress(done, total, current) {
              // One toast per ~5 s at most: progress without spam.
              const now = performance.now();
              if (now - shown > 5000) {
                shown = now;
                ctx.ui.toast(
                  `Importing ${done} of ${total}: ${current} (Import: Cancel stops)`,
                );
              }
            },
          });
          if (controller.signal.aborted) {
            ctx.ui.toast(
              `Import cancelled after ${result.notes} notes (they stay in ${target.name})`,
            );
          } else {
            ctx.ui.toast(
              `Imported ${result.notes} notes and ${result.drawings} drawings from ${source.name}`,
            );
          }
          await target.open();
        } catch (err) {
          if (controller.signal.aborted) {
            ctx.ui.toast("Import cancelled");
          } else {
            ctx.ui.toast(`Obsidian import failed: ${(err as Error).message}`);
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

import { afterEach, describe, expect, it, vi } from "vitest";

import { COMMANDS, getCommand } from "../commands/commands";
import { appCommandHandlers } from "../commands/useAppCommands";

import {
  claimImporter,
  resetImporterMap,
  setImportRunner,
} from "../plugins/importerMapAdmin";

import {
  IMPORT_ACCEPT,
  importAccept,
  planImport,
  skippedMessage,
} from "./importFiles";
import { importPickedFiles } from "./useCanvasImport";
import {
  IMPORT_FILE_COMMAND_ID,
  IMPORT_FILE_MENU_ITEM,
  importFileMenuItems,
} from "./useCanvasImportMenu";

afterEach(() => resetImporterMap());

const claimTxt = (extensions = ["txt"]) =>
  claimImporter(
    { pluginId: "text-import", importerId: "txt", title: "Plain text" },
    extensions,
  );

const file = (name: string, type: string) => new File(["x"], name, { type });
const png = (name = "a.png") => file(name, "image/png");

describe("planImport", () => {
  it("routes images to insertion and unclaimed files (a PDF with the plugin off) to skipped", () => {
    const a = file("a.pdf", "application/pdf");
    const img = png();
    const jpg = file("c.jpg", "image/jpeg");
    const txt = file("notes.txt", "text/plain");
    expect(planImport([img, a, jpg, txt])).toEqual({
      plugin: [],
      images: [img, jpg],
      skipped: [a, txt],
    });
  });

  it("a PDF goes to the plugin that claims pdf, ahead of the image path", () => {
    claimImporter({ pluginId: "pdf-import", importerId: "pdf", title: "PDF" }, [
      "pdf",
    ]);
    const a = file("a.PDF", "");
    const b = file("b.pdf", "application/pdf");
    expect(planImport([a, b]).plugin.map((i) => i.file)).toEqual([a, b]);
  });

  it("orders: importer first, then images, then skipped", () => {
    claimTxt(["txt", "png"]);
    const notes = file("notes.txt", "text/plain");
    const img = png("b.png");
    const zip = file("c.zip", "application/zip");
    const plan = planImport([notes, img, zip]);
    expect(plan.plugin.map((i) => [i.file, i.match.pluginId])).toEqual([
      [notes, "text-import"],
      [img, "text-import"],
    ]);
    expect(plan.images).toEqual([]);
    expect(plan.skipped).toEqual([zip]);
  });

  it("mixed drop: importer files and images apart, unclaimed text skipped", () => {
    claimTxt();
    const notes = file("a.TXT", "");
    const img = png();
    const md = file("x.md", "");
    const plan = planImport([notes, img, md]);
    expect(plan.plugin.map((i) => i.file)).toEqual([notes]);
    expect(plan.images).toEqual([img]);
    expect(plan.skipped).toEqual([md]);
  });

  it("the picker accepts the editor's image types, and no PDF while the plugin is off", () => {
    for (const t of ["image/png", "image/svg+xml"]) {
      expect(IMPORT_ACCEPT.split(",")).toContain(t);
    }
    expect(IMPORT_ACCEPT.split(",")).not.toContain(".pdf");
  });

  it("the picker accept adds importer extensions at call time", () => {
    expect(importAccept()).toBe(IMPORT_ACCEPT);
    const off = claimTxt(["txt", "md"]);
    expect(importAccept().split(",")).toEqual(
      expect.arrayContaining([".txt", ".md"]),
    );
    off();
    expect(importAccept()).toBe(IMPORT_ACCEPT);
  });

  it("skipped message mentions importer titles when plugins handle types", () => {
    const zip = file("a.zip", "application/zip");
    expect(skippedMessage([zip])).not.toContain("Plain text");
    claimTxt();
    expect(skippedMessage([zip])).toContain("Plain text");
  });

  it("names skipped files, nothing when none", () => {
    expect(skippedMessage([])).toBeNull();
    expect(skippedMessage([file("x.txt", "text/plain")])).toContain("x.txt");
  });
});

describe("importPickedFiles", () => {
  const setup = () => {
    const api = { insertImages: vi.fn(async () => {}) };
    const notify = vi.fn();
    return {
      api,
      notify,
      options: { getApi: () => api as never, notify },
    };
  };

  it("inserts images at the point and hands a PDF to the plugin that claims it", async () => {
    claimImporter({ pluginId: "pdf-import", importerId: "pdf", title: "PDF" }, [
      "pdf",
    ]);
    const run = vi.fn(async () => {});
    setImportRunner(run);
    const s = setup();
    const img = png();
    const doc = file("a.pdf", "application/pdf");
    await importPickedFiles(
      [img, doc],
      { x: 10, y: 20 },
      {
        ...s.options,
        getPath: () => "d.excalidraw",
      },
    );
    expect(s.api.insertImages).toHaveBeenCalledWith([img], { x: 10, y: 20 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(s.notify).not.toHaveBeenCalled();
  });

  it("reports a PDF as not imported while the plugin is off", async () => {
    const s = setup();
    await importPickedFiles([file("a.pdf", "application/pdf")], undefined, {
      ...s.options,
      getPath: () => "d.excalidraw",
    });
    expect(s.notify).toHaveBeenCalledWith(
      expect.stringContaining("Not imported: a.pdf"),
    );
  });

  it("runs plugin imports at the point, or the viewport centre", async () => {
    claimTxt();
    const run = vi.fn(async () => {});
    setImportRunner(run);
    const s = setup();
    const api = {
      ...s.api,
      getAppState: () => ({
        offsetLeft: 10,
        offsetTop: 20,
        width: 200,
        height: 100,
        scrollX: 0,
        scrollY: 0,
        zoom: { value: 1 },
      }),
    };
    const options = {
      ...s.options,
      getApi: () => api as never,
      getPath: () => "a.excalidraw",
    };
    const notes = file("n.txt", "text/plain");
    await importPickedFiles([notes], { x: 5, y: 6 }, options);
    expect(run).toHaveBeenLastCalledWith(
      [expect.objectContaining({ file: notes })],
      { path: "a.excalidraw", at: { x: 5, y: 6 } },
    );
    await importPickedFiles([notes], undefined, options);
    expect(run).toHaveBeenLastCalledWith(expect.anything(), {
      path: "a.excalidraw",
      at: { x: 100, y: 50 },
    });
    expect(s.notify).not.toHaveBeenCalled();
  });

  it("reports plugin files when the host is not running", async () => {
    claimTxt();
    const s = setup();
    const api = { ...s.api, getAppState: () => ({ zoom: { value: 1 } }) };
    await importPickedFiles([file("n.txt", "")], undefined, {
      ...s.options,
      getApi: () => api as never,
      getPath: () => "a.excalidraw",
    });
    expect(s.notify).toHaveBeenCalledWith(expect.stringContaining("n.txt"));
  });

  it("asks to open a drawing when no drawing path is known", async () => {
    claimTxt();
    const s = setup();
    await importPickedFiles([file("n.txt", "")], undefined, {
      ...s.options,
      getPath: () => null,
    });
    expect(s.notify).toHaveBeenCalledTimes(1);
    expect(s.notify).toHaveBeenCalledWith("Open a drawing to import n.txt.");
  });

  it("does nothing on cancel (no files); without a drawing, images ask for one", async () => {
    const s = setup();
    await importPickedFiles([], undefined, s.options);
    expect(s.notify).not.toHaveBeenCalled();
    await importPickedFiles([png()], undefined, {
      ...s.options,
      getApi: () => undefined,
    });
    expect(s.api.insertImages).not.toHaveBeenCalled();
    expect(s.notify).toHaveBeenCalledWith("Open a drawing to import a.png.");
  });

  describe("an importer that makes its own drawing (Markdown)", () => {
    const claimMd = () =>
      claimImporter(
        { pluginId: "markdown-import", importerId: "md", title: "Markdown" },
        ["md", "markdown"],
      );

    it("runs with no drawing open, with a null path", async () => {
      claimMd();
      const run = vi.fn(async () => {});
      setImportRunner(run);
      const s = setup();
      const note = file("Note.md", "text/markdown");
      await importPickedFiles([note], undefined, {
        ...s.options,
        getApi: () => undefined,
      });
      expect(run).toHaveBeenCalledWith(
        [expect.objectContaining({ file: note })],
        {
          path: null,
          at: { x: 0, y: 0 },
        },
      );
      expect(s.notify).not.toHaveBeenCalled();
    });

    it("runs with a drawing open that has no path yet, and still asks for one for other importers", async () => {
      claimMd();
      claimTxt();
      const run = vi.fn(async () => {});
      setImportRunner(run);
      const s = setup();
      await importPickedFiles(
        [file("n.markdown", ""), file("n.txt", "")],
        undefined,
        {
          ...s.options,
          getApi: () =>
            ({
              ...s.api,
              getAppState: () => ({
                offsetLeft: 0,
                offsetTop: 0,
                width: 0,
                height: 0,
                zoom: { value: 1 },
                scrollX: 0,
                scrollY: 0,
              }),
            } as never),
          getPath: () => null,
        },
      );
      expect(run).toHaveBeenCalledTimes(1);
      expect(s.notify).toHaveBeenCalledWith("Open a drawing to import n.txt.");
    });

    it("is claimed for .md and .markdown, so the picker accepts them", () => {
      claimMd();
      expect(importAccept().split(",")).toEqual(
        expect.arrayContaining([".md", ".markdown"]),
      );
      expect(planImport([file("a.md", "")]).plugin).toHaveLength(1);
    });
  });

  it("tells the user about files it can't import", async () => {
    const s = setup();
    await importPickedFiles(
      [file("a.zip", "application/zip")],
      undefined,
      s.options,
    );
    expect(s.notify).toHaveBeenCalledWith(expect.stringContaining("a.zip"));
    expect(s.api.insertImages).not.toHaveBeenCalled();
  });
});

describe("canvas menu item and command", () => {
  it("offers Import file… with the command's shortcut, only when enabled", () => {
    const onImport = vi.fn();
    const [item] = importFileMenuItems({ x: 1, y: 2 }, onImport, true, "Cmd+I");
    expect(item).toMatchObject({
      name: IMPORT_FILE_MENU_ITEM,
      label: "Import file…",
      shortcut: "Cmd+I",
    });
    item.onSelect();
    expect(onImport).toHaveBeenCalledWith({ x: 1, y: 2 });
    expect(importFileMenuItems({ x: 0, y: 0 }, onImport, false, "")).toEqual(
      [],
    );
    expect(importFileMenuItems({ x: 0, y: 0 }, undefined, true, "")).toEqual(
      [],
    );
  });

  it("is a rebindable palette command for a writable vault (no drawing needed for Markdown)", () => {
    expect(getCommand(IMPORT_FILE_COMMAND_ID)).toMatchObject({
      title: "Import: File…",
      category: "File",
      when: ["vaultOpen", "writable"],
      keys: { default: [] },
    });
    expect(
      COMMANDS.filter((c) => c.id === IMPORT_FILE_COMMAND_ID),
    ).toHaveLength(1);
    const importFile = vi.fn();
    appCommandHandlers({ importFile } as never)[IMPORT_FILE_COMMAND_ID]!();
    expect(importFile).toHaveBeenCalledOnce();
  });
});

describe("Import: Cancel command", () => {
  it("is a palette command with no default key that calls the handler", () => {
    expect(getCommand("plugins.cancelImport")).toMatchObject({
      title: "Import: Cancel",
      keys: { default: [] },
    });
    const cancelImport = vi.fn();
    appCommandHandlers({ cancelImport } as never)["plugins.cancelImport"]!();
    expect(cancelImport).toHaveBeenCalledOnce();
  });

  // Family: every image kind the picker accepts is imported, even with an empty type (WebKit).
  it.each([
    "png",
    "jpg",
    "jpeg",
    "svg",
    "gif",
    "webp",
    "bmp",
    "ico",
    "avif",
    "jfif",
    "BMP",
  ])(
    "a .%s file with an empty type is an image, with its real type filled in",
    (ext) => {
      const plan = planImport([file(`pic.${ext}`, "")]);
      expect(plan.skipped).toHaveLength(0);
      expect(plan.images).toHaveLength(1);
      expect(plan.images[0].type).toMatch(/^image\//);
    },
  );

  it("a text file with an image-looking name is still skipped only when it has no image extension", () => {
    expect(planImport([file("notes.txt", "")]).skipped).toHaveLength(1);
    expect(planImport([file("bmp", "")]).skipped).toHaveLength(1);
  });

  it("the skip message names every image kind the picker accepts", () => {
    const msg = skippedMessage([file("x.txt", "text/plain")]) ?? "";
    for (const kind of [
      "PNG",
      "JPEG",
      "SVG",
      "GIF",
      "WebP",
      "BMP",
      "ICO",
      "AVIF",
    ]) {
      expect(msg).toContain(kind);
    }
  });
});

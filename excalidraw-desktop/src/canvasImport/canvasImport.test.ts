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
  isPdfFile,
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
const pdf = (name = "a.pdf") => file(name, "application/pdf");
const png = (name = "a.png") => file(name, "image/png");

describe("planImport", () => {
  it("routes the first PDF to the dialog and images to insertion", () => {
    const a = pdf("a.pdf");
    const b = pdf("b.pdf");
    const img = png();
    const jpg = file("c.jpg", "image/jpeg");
    const txt = file("notes.txt", "text/plain");
    expect(planImport([img, a, b, jpg, txt])).toEqual({
      pdf: a,
      plugin: [],
      images: [img, jpg],
      skipped: [b, txt],
    });
  });

  it("orders: PDF first, then importer, then images, then skipped", () => {
    claimTxt(["txt", "pdf", "png"]);
    const doc = pdf("a.pdf");
    const notes = file("notes.txt", "text/plain");
    const img = png("b.png");
    const zip = file("c.zip", "application/zip");
    const plan = planImport([doc, notes, img, zip]);
    expect(plan.pdf).toBe(doc);
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

  it("recognises a PDF by extension when the type is missing", () => {
    expect(isPdfFile(file("scan.PDF", ""))).toBe(true);
    expect(isPdfFile(png())).toBe(false);
  });

  it("the picker accepts PDFs and the editor's image types", () => {
    for (const t of ["application/pdf", ".pdf", "image/png", "image/svg+xml"]) {
      expect(IMPORT_ACCEPT.split(",")).toContain(t);
    }
  });

  it("the picker accept adds importer extensions at call time", () => {
    expect(importAccept()).toBe(IMPORT_ACCEPT);
    const off = claimTxt(["txt", "md"]);
    expect(importAccept().split(",")).toEqual(
      expect.arrayContaining([".txt", ".md", ".pdf"]),
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
    const openPdf = vi.fn();
    const notify = vi.fn();
    return {
      api,
      openPdf,
      notify,
      options: { getApi: () => api as never, openPdf, notify },
    };
  };

  it("inserts images at the point and opens the PDF dialog", async () => {
    const s = setup();
    const img = png();
    const doc = pdf();
    await importPickedFiles([img, doc], { x: 10, y: 20 }, s.options);
    expect(s.api.insertImages).toHaveBeenCalledWith([img], { x: 10, y: 20 });
    expect(s.openPdf).toHaveBeenCalledWith(doc);
    expect(s.notify).not.toHaveBeenCalled();
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

  it("does nothing on cancel (no files) or without an open drawing", async () => {
    const s = setup();
    await importPickedFiles([], undefined, s.options);
    await importPickedFiles([png()], undefined, {
      ...s.options,
      getApi: () => undefined,
    });
    expect(s.api.insertImages).not.toHaveBeenCalled();
    expect(s.openPdf).not.toHaveBeenCalled();
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

  it("is a rebindable palette command for a writable open drawing", () => {
    expect(getCommand(IMPORT_FILE_COMMAND_ID)).toMatchObject({
      title: "Import: File…",
      category: "File",
      when: ["drawingOpen", "writable"],
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
});

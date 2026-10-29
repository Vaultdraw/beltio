import { readFileSync } from "node:fs";

import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { parseManifest } from "../../../../sdk/examples/testing/readManifest";
import plugin from "../src/main";

const A4 = { widthPt: 595, heightPt: 842 };
const JPEG = (index: number) => {
  const bytes = new Uint8Array(500);
  bytes.set([0xff, 0xd8, 0xff, index]);
  return bytes;
};

let p: TestPlugin | undefined;
beforeEach(() => {
  document.head.querySelectorAll("style").forEach((s) => s.remove());
});
afterEach(async () => {
  cleanup();
  await p?.dispose();
  p = undefined;
});

/** The source plugin.toml (the build copies it to dist/, which a unit test does not need). */
const manifest = () => ({
  ...parseManifest(readFileSync(`${__dirname}/../plugin.toml`, "utf8")),
  mainBytes: 1,
  dir: __dirname,
});

const start = async (pages = 3) => {
  p = await boot(manifest(), plugin);
  p.pdf.renderBytes = JPEG;
  p.pdf.nextPick = { name: "sample.pdf", pages: Array(pages).fill(A4) };
  return p;
};

/** Runs the command and waits for the dialog to show. */
const openDialog = async () => {
  await p!.run("import");
  await waitFor(() => expect(p!.overlay()).not.toBeNull());
  p!.overlay()!.render();
};

/** Waits for the dialog to close (and the import to finish). */
const closed = () => waitFor(() => expect(p!.overlay()).toBeNull());

const dialog = () => screen.getByRole("dialog", { name: "Import PDF" });

describe("pdf-import plugin", () => {
  it("declares the permission, the importer and the command", () => {
    const info = manifest();
    expect(info.permissions).toEqual(["pdf"]);
    expect(info.contributes.importers).toEqual([
      { id: "pdf", title: "PDF", extensions: ["pdf"] },
    ]);
    expect(
      info.contributes.commands.map((c) => [c.id, c.title, c.when]),
    ).toEqual([["import", "Import: PDF…", ["drawingOpen", "writable"]]]);
  });

  it("does nothing with no drawing open or when the picker is cancelled", async () => {
    await start();
    p!.pdf.nextPick = null;
    await p!.run("import");
    await new Promise((r) => setTimeout(r, 20));
    expect(p!.overlay()).toBeNull();
    p!.scene.switchTo(null);
    p!.pdf.nextPick = { name: "a.pdf", pages: [A4] };
    await p!.run("import");
    await new Promise((r) => setTimeout(r, 20));
    expect(p!.overlay()).toBeNull();
    expect(p!.pdf.renders).toEqual([]);
  });

  it("pick, confirm, import: one undo step, a summary, the document closed", async () => {
    await start();
    await openDialog();
    expect(dialog()).toHaveTextContent("sample.pdf");
    expect(dialog()).toHaveTextContent("3 pages");
    expect(dialog()).toHaveTextContent("3 pages below the drawing");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Import" }));
    });
    await closed();
    await waitFor(() => expect(p!.scene.batches).toHaveLength(1));
    expect(p!.scene.live()).toHaveLength(3);
    await waitFor(() =>
      expect(p!.toasts().join(" ")).toContain("Imported 3 pages (locked"),
    );
    expect(p!.overlay()).toBeNull();
    expect(new Set(p!.pdf.closed).size).toBe(1);
  });

  it("a page range limits the import and a bad one blocks it", async () => {
    await start(5);
    await openDialog();
    const input = screen.getByLabelText("Pages");
    fireEvent.change(input, { target: { value: "9" } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The document has 5 pages",
    );
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "2-3" } });
    expect(dialog()).toHaveTextContent("2 pages below the drawing");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Import" }));
    });
    await closed();
    await waitFor(() => expect(p!.scene.live()).toHaveLength(2));
  });

  it("Cancel and Escape close the dialog without touching the drawing", async () => {
    await start();
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await closed();
    cleanup();
    p!.pdf.nextPick = { name: "again.pdf", pages: [A4] };
    await openDialog();
    fireEvent.keyDown(dialog(), { key: "Escape" });
    await closed();
    expect(p!.scene.batches).toHaveLength(0);
    expect(p!.pdf.closed).toHaveLength(2);
  });

  it("uses the app's dialog keys: Tab stays inside, Enter on Cancel cancels and never imports", async () => {
    await start();
    await openDialog();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const stops = Array.from(
      dialog().querySelectorAll<HTMLElement>("button, input"),
    ).filter((el) => !(el as HTMLButtonElement).disabled);
    // Tab from the last stop wraps to the first; Shift+Tab from the first wraps to the last.
    stops[stops.length - 1].focus();
    fireEvent.keyDown(stops[stops.length - 1], { key: "Tab" });
    expect(dialog().contains(document.activeElement)).toBe(true);
    stops[0].focus();
    fireEvent.keyDown(stops[0], { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(stops[stops.length - 1]);
    // Enter on the focused Cancel button is a click on Cancel (button default), not a form submit.
    cancel.focus();
    fireEvent.click(cancel);
    await closed();
    expect(p!.scene.batches).toHaveLength(0);
  });

  it("Escape goes to a dialog opened over it, not to the import dialog", async () => {
    await start();
    await openDialog();
    // What the app's Dialog/ConfirmModal does: join the shared stack on globalThis.
    const stack = (globalThis as unknown as Record<symbol, object[]>)[
      Symbol.for("vaultdraw.escapeLayers")
    ];
    const above = {};
    stack.push(above);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialog()).toBeTruthy();
    stack.splice(stack.indexOf(above), 1);
    fireEvent.keyDown(document, { key: "Escape" });
    await closed();
  });

  it("an encrypted PDF asks for its password first", async () => {
    await start();
    p!.pdf.password = "pw";
    await openDialog();
    expect(dialog()).toHaveTextContent("password-protected");
    const field = screen.getByLabelText("Password");
    fireEvent.change(field, { target: { value: "nope" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Wrong password",
    );
    fireEvent.change(field, { target: { value: "pw" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    });
    expect(await screen.findByLabelText("Pages")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await closed();
    expect(p!.pdf.closed).toHaveLength(1);
  });

  it("a dropped PDF opens the same overlay; closing it ends the import", async () => {
    await start(2);
    // The harness holds `import` inside an act scope until the dialog closes, so the dialog
    // itself is not mounted here (the picker tests mount and drive it).
    const dropped = p!.import("dropped.pdf", new Uint8Array([1, 2, 3]));
    await waitFor(() => expect(p!.overlay()).not.toBeNull());
    expect(p!.pdf.opened).toContain("dropped.pdf");
    p!.overlay()!.close();
    expect(await dropped).toBeNull();
    expect(p!.pdf.closed.length).toBeGreaterThan(0);
    expect(p!.scene.batches).toHaveLength(0);
  });

  it("a failing PDF shows a message and no dialog", async () => {
    await start();
    p!.pdf.openError = "PDF_INVALID";
    await p!.import("bad.pdf", new Uint8Array([1]));
    expect(p!.overlay()).toBeNull();
    expect(p!.toasts().join(" ")).toContain("Not a readable PDF");
  });

  it("closing the overlay from outside closes the document", async () => {
    await start();
    await openDialog();
    act(() => p!.overlay()!.close());
    await closed();
    expect(p!.pdf.closed).toHaveLength(1);
    expect(p!.scene.batches).toHaveLength(0);
  });

  it("a second import while one is open is refused", async () => {
    await start();
    await openDialog();
    await p!.run("import");
    expect(p!.toasts().join(" ")).toContain("already running");
    act(() => p!.overlay()!.close());
    await closed();
  });
});

import { afterEach, describe, expect, it } from "vitest";

import { defineContextKey, PRESENT_KEY } from "./contextKeys";
import { TOOL_COMMANDS } from "./toolCommands";
import {
  commitCanvasTextEdit,
  isTextEditingTarget,
  readContext,
  whenHolds,
} from "./context";

import type { CommandContext } from "./types";

const app = { vaultOpen: true, drawingOpen: true, writable: true };

afterEach(() => {
  document.body.innerHTML = "";
});

const add = (html: string) => {
  document.body.insertAdjacentHTML("beforeend", html);
};

describe("isTextEditingTarget", () => {
  it("recognises editable elements", () => {
    add(`<input id="t"><input id="c" type="checkbox"><input id="b" type="button">
      <textarea id="ta" class="excalidraw-wysiwyg"></textarea><select id="s"></select>
      <div id="ce" contenteditable="true"><span id="inner"></span></div>
      <div id="ce2" contenteditable=""></div><div id="no" contenteditable="false"></div><button id="btn"></button>`);
    const el = (id: string) => document.getElementById(id);
    expect(isTextEditingTarget(el("t"))).toBe(true);
    expect(isTextEditingTarget(el("ta"))).toBe(true);
    expect(isTextEditingTarget(el("s"))).toBe(true);
    expect(isTextEditingTarget(el("ce"))).toBe(true);
    expect(isTextEditingTarget(el("inner"))).toBe(true);
    expect(isTextEditingTarget(el("ce2"))).toBe(true);
    expect(isTextEditingTarget(el("c"))).toBe(false);
    expect(isTextEditingTarget(el("b"))).toBe(false);
    expect(isTextEditingTarget(el("no"))).toBe(false);
    expect(isTextEditingTarget(el("btn"))).toBe(false);
    expect(isTextEditingTarget(null)).toBe(false);
  });
});

describe("readContext", () => {
  it("reads focus and modal state", () => {
    add(
      `<div class="vault-editor"><button id="in"></button><textarea id="ta"></textarea></div><input id="out">`,
    );
    expect(readContext(document, app)).toMatchObject({
      ...app,
      textEditing: false,
      canvasFocus: false,
      editorFocus: false,
      modalOpen: false,
    });
    document.getElementById("in")?.focus();
    expect(readContext(document, app)).toMatchObject({
      canvasFocus: true,
      editorFocus: true,
      textEditing: false,
    });
    document.getElementById("ta")?.focus();
    expect(readContext(document, app)).toMatchObject({
      canvasFocus: false,
      editorFocus: false,
      textEditing: true,
    });
    document.getElementById("out")?.focus();
    expect(readContext(document, app)).toMatchObject({ textEditing: true });
    add(`<div class="vault-modal-backdrop"></div>`);
    expect(readContext(document, app).modalOpen).toBe(true);
  });

  it("a running presentation is modal: canvas tool keys stand down, presentation keys hold", () => {
    const sticky = TOOL_COMMANDS.find((c) => c.id === "tool.stickynote")!;
    const before = readContext(document, app);
    expect(before.modalOpen).toBe(false);
    const stop = defineContextKey(PRESENT_KEY, () => true);
    const during = readContext(document, app);
    expect(during.modalOpen).toBe(true);
    expect(whenHolds(["!modalOpen"], during)).toBe(false);
    expect(whenHolds(sticky.when, during)).toBe(false);
    expect(whenHolds([PRESENT_KEY as never], during)).toBe(true);
    stop();
    expect(readContext(document, app).modalOpen).toBe(false);
  });
});

describe("editorFocus (toimprove 220: Cmd+B in a search box must not touch the drawing)", () => {
  it("holds on the canvas and in its text editor, never in another field", () => {
    add(
      `<div class="vault-editor"><button id="cv"></button><textarea id="wys" class="excalidraw-wysiwyg"></textarea><input id="hex"></div><input id="search"><div contenteditable="true" id="ce"></div>`,
    );
    const focus = (id: string) => {
      document.getElementById(id)?.focus();
      return readContext(document, app).editorFocus;
    };
    expect(focus("cv")).toBe(true);
    expect(focus("wys")).toBe(true);
    expect(focus("hex")).toBe(false);
    expect(focus("search")).toBe(false);
    expect(focus("ce")).toBe(false);
  });

  it("the Markdown format keys need it; the palette ignores focus rules", async () => {
    const { EDITOR_COMMANDS } = await import("./editorCommands");
    for (const id of [
      "markdown.toggle",
      "markdown.toggleTask",
      "markdown.toggleBold",
    ]) {
      expect(EDITOR_COMMANDS.find((c) => c.id === id)?.when).toContain(
        "editorFocus",
      );
    }
  });
});

describe("whenHolds", () => {
  const ctx: CommandContext = {
    vaultOpen: true,
    drawingOpen: false,
    writable: true,
    textEditing: false,
    canvasFocus: false,
    editorFocus: false,
    modalOpen: false,
    listFocus: false,
    galleryFocus: false,
    graphFocus: false,
  };
  it("evaluates positive and negated clauses", () => {
    expect(whenHolds(undefined, ctx)).toBe(true);
    expect(whenHolds([], ctx)).toBe(true);
    expect(whenHolds(["vaultOpen", "!modalOpen"], ctx)).toBe(true);
    expect(whenHolds(["drawingOpen"], ctx)).toBe(false);
    expect(whenHolds(["vaultOpen", "!writable"], ctx)).toBe(false);
    expect(whenHolds(["!modalOpen"], { ...ctx, modalOpen: true })).toBe(false);
  });
});

describe("commitCanvasTextEdit", () => {
  it("blurs only Excalidraw's text editor, so it submits before focus moves", () => {
    add(
      `<textarea id="ta" class="excalidraw-wysiwyg"></textarea><input id="i">`,
    );
    const ta = document.getElementById("ta") as HTMLTextAreaElement;
    let blurs = 0;
    ta.addEventListener("blur", () => blurs++);
    ta.focus();
    commitCanvasTextEdit(document);
    expect(blurs).toBe(1);
    expect(document.activeElement).not.toBe(ta);

    const input = document.getElementById("i") as HTMLInputElement;
    input.focus();
    commitCanvasTextEdit(document);
    expect(document.activeElement).toBe(input);
    expect(() => commitCanvasTextEdit(null)).not.toThrow();
  });
});

describe("listFocus and buttons inside a list (toimprove 239)", () => {
  it.each([
    ["the list root", "root", true],
    ["a tree row", "row", true],
    ["a settings tab item", "tab", true],
    ["a row's More actions button", "more", false],
  ])("focus on %s: list keys %s", (_label, id, expected) => {
    add(`<div id="root" data-keylist tabindex="0">
      <div id="row" role="treeitem" tabindex="-1"><button id="more">More actions</button></div>
      <button id="tab" role="tab">Page</button></div>`);
    (document.getElementById(id) as HTMLElement).focus();
    expect(readContext(document, app).listFocus).toBe(expected);
  });
});

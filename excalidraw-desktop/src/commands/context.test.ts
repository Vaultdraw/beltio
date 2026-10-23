import { afterEach, describe, expect, it } from "vitest";

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
      modalOpen: false,
    });
    document.getElementById("in")?.focus();
    expect(readContext(document, app)).toMatchObject({
      canvasFocus: true,
      textEditing: false,
    });
    document.getElementById("ta")?.focus();
    expect(readContext(document, app)).toMatchObject({
      canvasFocus: false,
      textEditing: true,
    });
    document.getElementById("out")?.focus();
    expect(readContext(document, app)).toMatchObject({ textEditing: true });
    add(`<div class="vault-modal-backdrop"></div>`);
    expect(readContext(document, app).modalOpen).toBe(true);
  });
});

describe("whenHolds", () => {
  const ctx: CommandContext = {
    vaultOpen: true,
    drawingOpen: false,
    writable: true,
    textEditing: false,
    canvasFocus: false,
    modalOpen: false,
    listFocus: false,
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

/**
 * One VaultEditor serves many documents: switching `documentId` swaps the
 * scene in place. These tests pin the correctness rules (no write under the
 * wrong document, per-document files and history) with the real editor.
 */
import { act, render, waitFor } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CaptureUpdateAction } from "@excalidraw/excalidraw";

import { VaultEditor } from "../editor/VaultEditor";
import { getActiveEditor, getEditorApi } from "../editor/editorApi";
import { flushEditorSerialization } from "../editor/editorFlush";

import type { ComponentProps } from "react";

const base = {
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  boundElements: [],
  link: null,
  locked: false,
};

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const pageScene = (tag: string) => {
  const parsed = JSON.parse(scene(tag));
  parsed.appState.pageSetup = {
    enabled: true,
    layout: "vertical",
    size: "a4",
    orientation: "portrait",
  };
  return JSON.stringify(parsed);
};

/** A scene whose rectangles are named after the drawing, optionally with one image. */
const scene = (tag: string, count = 2, image = false) =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements: [
      ...Array.from({ length: count }, (_, i) => ({
        ...base,
        id: `${tag}-r${i}`,
        type: "rectangle",
        x: i * 100,
        y: 0,
        width: 80,
        height: 50,
      })),
      ...(image
        ? [
            {
              ...base,
              id: `${tag}-img`,
              type: "image",
              x: 0,
              y: 200,
              width: 50,
              height: 50,
              fileId: `${tag}-file`,
              status: "saved",
              scale: [1, 1],
            },
          ]
        : []),
    ],
    appState: { viewBackgroundColor: tag === "b" ? "#ffc9c9" : "#ffffff" },
    files: image
      ? {
          [`${tag}-file`]: {
            id: `${tag}-file`,
            mimeType: "image/png",
            dataURL: PNG,
            created: 1,
          },
        }
      : {},
  });

let imageDelayMs = 0;

/** jsdom never decodes images: load fires after `imageDelayMs` once `src` is set. */
const stubImage = () => {
  const Original = window.Image;
  class FakeImage {
    onload: (() => void) | null = null;
    set src(_value: string) {
      setTimeout(() => this.onload?.(), imageDelayMs);
    }
  }
  window.Image = FakeImage as unknown as typeof Image;
  return () => {
    window.Image = Original;
  };
};

type Props = ComponentProps<typeof VaultEditor>;
const idsOf = (json: string) =>
  (JSON.parse(json).elements as { id: string }[]).map((e) => e.id);

describe("VaultEditor scene swap", () => {
  let restoreImage: () => void;
  beforeEach(() => {
    restoreImage = stubImage();
  });
  afterEach(() => {
    restoreImage();
    imageDelayMs = 0;
  });

  const mount = async (
    initial: Partial<Props> & { documentId: string; json: string },
  ) => {
    const onChange = vi.fn<(json: string) => void>();
    const props = (
      p: Partial<Props> & { documentId: string; json: string },
    ): Props => ({
      onChange,
      name: "x.excalidraw",
      initialSource: { json: p.json },
      ...p,
    });
    const view = render(<VaultEditor {...props(initial)} />);
    const host = () =>
      view.container.querySelector(".vault-editor") as HTMLElement;
    const landed = (id: string) =>
      waitFor(() => expect(host().getAttribute("data-document-id")).toBe(id), {
        timeout: 4000,
      });
    await landed(initial.documentId);
    await waitFor(() => expect(getEditorApi(initial.documentId)).toBeTruthy());
    const switchTo = (
      next: Partial<Props> & { documentId: string; json: string },
    ) => act(async () => view.rerender(<VaultEditor {...props(next)} />));
    return { onChange, host, landed, switchTo };
  };

  const settle = () => act(() => new Promise((r) => setTimeout(r, 900)));

  it("active editor readOnly means the drawing cannot be written, not that the UI is covered", async () => {
    const { switchTo } = await mount({
      documentId: "a",
      json: scene("a"),
      path: "a.excalidraw",
      readOnly: true,
      documentReadOnly: false,
    });
    expect(getActiveEditor()?.path).toBe("a.excalidraw");
    expect(getActiveEditor()?.readOnly).toBe(false);
    await switchTo({
      documentId: "a",
      json: scene("a"),
      path: "a.excalidraw",
      readOnly: true,
      documentReadOnly: true,
    });
    expect(getActiveEditor()?.readOnly).toBe(true);
  });

  it("never reports A's scene after the document changed, and B's landing is not a change", async () => {
    const { onChange, landed, switchTo } = await mount({
      documentId: "A",
      json: scene("a"),
    });
    // an unsaved edit of A, then the app switches (it flushes A first)
    const apiA = getEditorApi("A")!;
    act(() =>
      apiA.updateScene({
        elements: [...apiA.getSceneElements()],
        appState: { viewBackgroundColor: "#00ff00" },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      }),
    );
    flushEditorSerialization("A", { commitText: true });
    const callsForA = onChange.mock.calls.length;
    expect(callsForA).toBe(1);
    // an edit that slips in after the barrier but before the swap: still
    // pending (debounced) when the props move to B
    act(() =>
      apiA.updateScene({
        elements: [...apiA.getSceneElements()],
        appState: { viewBackgroundColor: "#0000ff" },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      }),
    );
    imageDelayMs = 400; // keeps the swap in flight (B's image is slow to decode)
    await switchTo({ documentId: "B", json: scene("b", 2, true) });
    expect(getEditorApi("B")).toBeUndefined(); // still showing A, under B's id
    // a flush aimed at B (save chord, window close) finds nothing to write
    flushEditorSerialization("B", { commitText: true });
    expect(onChange).toHaveBeenCalledTimes(callsForA);
    await landed("B");
    await settle();
    // nothing more was written: not A (late debounce), not B (just loaded)
    expect(onChange).toHaveBeenCalledTimes(callsForA);
    expect(getEditorApi("A")).toBeUndefined();
    expect(
      getEditorApi("B")!
        .getSceneElements()
        .map((e) => e.id),
    ).toEqual(["b-r0", "b-r1", "b-img"]);
  });

  it("data-scene-ready is true only once the scene has landed, and false from the start of a swap", async () => {
    const { host, switchTo } = await mount({
      documentId: "A",
      json: scene("a"),
    });
    const ready = () => host().getAttribute("data-scene-ready");
    await waitFor(() => expect(ready()).toBe("true"));
    imageDelayMs = 400; // keeps the swap in flight
    await switchTo({ documentId: "B", json: scene("b", 2, true) });
    // A's scene is still shown under B's id: not ready, and the id says A
    expect(ready()).toBe("false");
    expect(host().getAttribute("data-document-id")).toBe("A");
    await waitFor(() => expect(ready()).toBe("true"), { timeout: 4000 });
    expect(host().getAttribute("data-document-id")).toBe("B");
    expect(getEditorApi("B")).toBeTruthy();
  });

  it("an open is one React commit: the shown document flips with the scene", async () => {
    const commits: { shown: string | null; ids: string[] }[] = [];
    let host: HTMLElement | null = null;
    const watched: { api?: ReturnType<typeof getEditorApi> } = {};
    const tree = (documentId: string, json: string) => (
      <Profiler
        id="editor"
        onRender={() =>
          commits.push({
            shown: host?.getAttribute("data-document-id") ?? null,
            ids: (watched.api?.getSceneElements() ?? []).map((e) => e.id),
          })
        }
      >
        <VaultEditor
          documentId={documentId}
          initialSource={{ json }}
          name="x.excalidraw"
          onChange={vi.fn()}
        />
      </Profiler>
    );
    const view = render(tree("A", scene("a")));
    host = view.container.querySelector(".vault-editor") as HTMLElement;
    await waitFor(() => expect(getEditorApi("A")).toBeTruthy());
    watched.api = getEditorApi("A");
    await settle();
    commits.length = 0;
    await act(async () => view.rerender(tree("B", scene("b"))));
    await waitFor(
      () => expect(host!.getAttribute("data-document-id")).toBe("B"),
      {
        timeout: 4000,
      },
    );
    await settle();
    const flip = commits.findIndex((c) => c.shown === "B");
    expect(flip).toBeGreaterThanOrEqual(0);
    // the commit that flips the id already shows B's scene ...
    expect(commits[flip].ids).toEqual(["b-r0", "b-r1"]);
    // ... and every earlier commit still showed A (id and `swapping` never
    // flip in a commit of their own after the scene)
    expect(commits.slice(0, flip).every((c) => c.shown === "A")).toBe(true);
    expect(commits.slice(0, flip).every((c) => c.ids[0] === "a-r0")).toBe(true);
  });

  it("a change right after the swap is saved with B's content", async () => {
    const { onChange, landed, switchTo } = await mount({
      documentId: "A",
      json: scene("a"),
    });
    await switchTo({ documentId: "B", json: scene("b") });
    await landed("B");
    const apiB = getEditorApi("B")!;
    act(() =>
      apiB.updateScene({
        elements: [
          ...apiB.getSceneElements(),
          {
            ...base,
            id: "b-new",
            type: "rectangle",
            x: 9,
            y: 9,
            width: 5,
            height: 5,
            version: 1,
            versionNonce: 1,
            seed: 1,
            isDeleted: false,
            updated: 1,
            index: null,
          } as never,
        ],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      }),
    );
    flushEditorSerialization("B");
    expect(onChange).toHaveBeenCalledTimes(1);
    const ids = idsOf(onChange.mock.calls[0][0]);
    expect(ids).toEqual(["b-r0", "b-r1", "b-new"]);
    expect(ids.some((id) => id.startsWith("a-"))).toBe(false);
  });

  it("A -> B -> C quickly ends on C and writes nothing for B", async () => {
    const { onChange, landed, switchTo } = await mount({
      documentId: "A",
      json: scene("a"),
    });
    await switchTo({ documentId: "B", json: scene("b", 3) });
    await switchTo({ documentId: "C", json: scene("c", 1) });
    await landed("C");
    await settle();
    expect(getEditorApi("B")).toBeUndefined();
    expect(
      getEditorApi("C")!
        .getSceneElements()
        .map((e) => e.id),
    ).toEqual(["c-r0"]);
    expect(onChange).not.toHaveBeenCalled();
    const apiC = getEditorApi("C")!;
    act(() =>
      apiC.updateScene({
        elements: [],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      }),
    );
    flushEditorSerialization("C");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(
      idsOf(onChange.mock.calls[0][0]).every((id) => !id.startsWith("b-")),
    ).toBe(true);
  });

  it("drops A's image files when B is shown", async () => {
    const { landed, switchTo } = await mount({
      documentId: "A",
      json: scene("a", 1, true),
    });
    await waitFor(() =>
      expect(Object.keys(getEditorApi("A")!.getFiles())).toEqual(["a-file"]),
    );
    await switchTo({ documentId: "B", json: scene("b", 1, true) });
    await landed("B");
    expect(Object.keys(getEditorApi("B")!.getFiles())).toEqual(["b-file"]);
    await switchTo({ documentId: "C", json: scene("c", 1) });
    await landed("C");
    expect(getEditorApi("C")!.getFiles()).toEqual({});
  });

  it("keeps undo history per document: gone for B, back for A with its snapshot", async () => {
    const { landed, switchTo } = await mount({
      documentId: "A",
      json: scene("a"),
    });
    const apiA = getEditorApi("A")!;
    act(() =>
      apiA.updateScene({
        elements: apiA.getSceneElements().slice(1),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      }),
    );
    const snapshot = apiA.history.export();
    expect(snapshot.undo.length).toBeGreaterThan(0);
    await switchTo({ documentId: "B", json: scene("b") });
    await landed("B");
    const apiB = getEditorApi("B")!;
    expect(apiB.history.export().undo).toHaveLength(0);
    expect(apiB.history.export().redo).toHaveLength(0);
    const takeUndo = vi.fn(() => snapshot);
    await switchTo({
      documentId: "A2",
      json: scene("a"),
      restore: { takeUndo },
    });
    await landed("A2");
    expect(takeUndo).toHaveBeenCalledTimes(1);
    expect(getEditorApi("A2")!.history.export().undo).toHaveLength(
      snapshot.undo.length,
    );
  });

  it("resets selection and view state per document and keeps the toolbar mounted", async () => {
    const { host, landed, switchTo } = await mount({
      documentId: "A",
      json: scene("a"),
    });
    const apiA = getEditorApi("A")!;
    act(() =>
      apiA.updateScene({ appState: { selectedElementIds: { "a-r0": true } } }),
    );
    expect(apiA.getAppState().selectedElementIds).toEqual({ "a-r0": true });
    const toolbar = host().querySelector(".App-toolbar");
    expect(toolbar).toBeTruthy();
    await switchTo({ documentId: "B", json: scene("b") });
    // the old scene and its UI stay put while B loads
    expect(host().querySelector(".App-toolbar")).toBe(toolbar);
    expect(host().querySelector(".excalidraw--view-mode")).toBeNull();
    await landed("B");
    const state = getEditorApi("B")!.getAppState();
    expect(state.selectedElementIds).toEqual({});
    expect(state.viewBackgroundColor).toBe("#ffc9c9");
    expect(state.viewModeEnabled).toBe(false);
    expect(host().querySelector(".App-toolbar")).toBe(toolbar);
    expect(host().hasAttribute("inert")).toBe(false);
  });

  it("leaves page mode behind: B opens on the plain canvas, and page mode comes back with its file", async () => {
    const { landed, switchTo } = await mount({
      documentId: "A",
      json: pageScene("a"),
    });
    await waitFor(() =>
      expect(getEditorApi("A")!.getAppState().pageSetup?.enabled).toBe(true),
    );
    await switchTo({ documentId: "B", json: scene("b") });
    await landed("B");
    await act(() => new Promise((r) => setTimeout(r, 50)));
    const plain = getEditorApi("B")!.getAppState();
    expect(plain.pageSetup).toBeNull();
    expect(plain.scrollConstraints).toBeNull();
    await switchTo({ documentId: "C", json: pageScene("c") });
    await landed("C");
    await waitFor(() =>
      expect(getEditorApi("C")!.getAppState().pageSetup?.enabled).toBe(true),
    );
  });

  it("per-drawing style overrides stay with their drawing: B shows defaults and saves none of A's, A's come back", async () => {
    const { onChange, landed, switchTo } = await mount({
      documentId: "A",
      json: scene("a"),
    });
    const apiA = getEditorApi("A")!;
    act(() => apiA.setActiveTool({ type: "rectangle" }));
    act(() =>
      apiA.updateScene({
        appState: { currentItemStrokeColor: "#e03131" },
        captureUpdate: CaptureUpdateAction.NEVER,
      }),
    );
    flushEditorSerialization("A");
    expect(onChange).toHaveBeenCalledTimes(1);
    const savedA = onChange.mock.calls[0][0];
    expect(JSON.parse(savedA).vaultdraw.styles.rectangle).toMatchObject({
      stroke_color: "#e03131",
    });

    await switchTo({ documentId: "B", json: scene("b") });
    await landed("B");
    const apiB = getEditorApi("B")!;
    expect(apiB.getAppState().currentItemStrokeColor).not.toBe("#e03131");
    act(() => apiB.setActiveTool({ type: "rectangle" }));
    expect(apiB.getAppState().currentItemStrokeColor).not.toBe("#e03131");
    act(() =>
      apiB.updateScene({
        elements: apiB.getSceneElements().slice(1),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      }),
    );
    flushEditorSerialization("B");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(JSON.parse(onChange.mock.calls[1][0]).vaultdraw).toBeUndefined();

    await switchTo({ documentId: "A2", json: savedA });
    await landed("A2");
    const apiA2 = getEditorApi("A2")!;
    act(() => apiA2.setActiveTool({ type: "rectangle" }));
    expect(apiA2.getAppState().currentItemStrokeColor).toBe("#e03131");
  });

  it("falls back to rebuilding the editor when the new source cannot be read", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, landed, switchTo } = await mount({
      documentId: "A",
      json: scene("a"),
    });
    await switchTo({ documentId: "B", json: "{ not json" });
    await waitFor(() => expect(host().textContent).toMatch(/./));
    await act(() => new Promise((r) => setTimeout(r, 100)));
    // the rebuilt editor reports the parse problem through the usual alert
    await waitFor(() =>
      expect(host().querySelector('[role="alert"]')).toBeTruthy(),
    );
    // and later documents load again
    await switchTo({ documentId: "C", json: scene("c", 1) });
    await landed("C");
    expect(
      getEditorApi("C")!
        .getSceneElements()
        .map((e) => e.id),
    ).toEqual(["c-r0"]);
    spy.mockRestore();
  });

  it("still falls back when a step after the landing commit throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { landed, switchTo } = await mount({
      documentId: "A",
      json: scene("a"),
    });
    // throws on the swap's call; the rebuilt editor's own call gets nothing
    const takeUndo = vi.fn<() => undefined>().mockImplementationOnce(() => {
      throw new Error("bad undo snapshot");
    });
    await switchTo({
      documentId: "B",
      json: scene("b"),
      restore: { takeUndo },
    });
    await waitFor(() => expect(takeUndo).toHaveBeenCalled());
    // the landing's flush already ran the swap's cleanup: the error is still
    // logged and the editor rebuilt, never swallowed
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        "[editor] scene swap failed, rebuilding the editor",
        expect.any(Error),
      ),
    );
    await landed("B");
    await waitFor(() => expect(getEditorApi("B")).toBeTruthy());
    spy.mockRestore();
  });
});

describe("VaultEditor while the app is loading", () => {
  it("stops keys aimed at the canvas, never other inputs, and lets them through again afterwards", async () => {
    const restoreImage = stubImage();
    const onChange = vi.fn();
    const props = (loading: boolean): ComponentProps<typeof VaultEditor> => ({
      documentId: "A",
      initialSource: { json: scene("a") },
      name: "x.excalidraw",
      onChange,
      loading,
    });
    const view = render(<VaultEditor {...props(false)} />);
    await waitFor(() => expect(getEditorApi("A")).toBeTruthy());
    const input = document.createElement("input");
    document.body.appendChild(input);
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    const press = (target: Element) =>
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "a",
          bubbles: true,
          cancelable: true,
        }),
      );

    view.rerender(<VaultEditor {...props(true)} />);
    press(document.body);
    press(view.container.querySelector(".excalidraw-container")!);
    expect(seen).not.toHaveBeenCalled();
    press(input);
    expect(seen).toHaveBeenCalledTimes(1);

    view.rerender(<VaultEditor {...props(false)} />);
    press(document.body);
    expect(seen).toHaveBeenCalledTimes(2);
    document.removeEventListener("keydown", seen);
    input.remove();
    restoreImage();
  });
});

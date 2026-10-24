import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import VaultEditor from "../editor/VaultEditor";
import {
  claimImporter,
  resetImporterMap,
  setImportRunner,
} from "../plugins/importerMap";

import { BLANK_SCENE } from "./fixtures";

afterEach(() => {
  cleanup();
  resetImporterMap();
});

const mount = (extra: Record<string, unknown> = {}) =>
  render(
    <VaultEditor
      documentId="doc-plugin-drop"
      path="a.excalidraw"
      initialSource={{ json: BLANK_SCENE }}
      name="a.excalidraw"
      onChange={vi.fn()}
      {...extra}
    />,
  ).container.querySelector(".vault-editor") as HTMLElement;

const drop = (el: HTMLElement, files: File[]) => {
  const event = new Event("drop", { bubbles: true, cancelable: true }) as any;
  event.dataTransfer = { files };
  event.shiftKey = false;
  fireEvent(el, event);
  return event.defaultPrevented as boolean;
};

const claim = () =>
  claimImporter(
    { pluginId: "text-import", importerId: "txt", title: "Plain text" },
    ["txt"],
  );
const txt = () => new File(["hi"], "hello.txt", { type: "text/plain" });

describe("VaultEditor: dropping a file a plugin imports", () => {
  it("leaves unclaimed drops alone", () => {
    const run = vi.fn(async () => {});
    setImportRunner(run);
    expect(drop(mount(), [txt()])).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("claims the drop and runs the import into the active drawing", async () => {
    claim();
    const run = vi.fn(async () => {});
    setImportRunner(run);
    const el = mount();
    // the editor API is set once the scene has loaded
    await waitFor(() => expect(drop(el, [txt()])).toBe(true));
    expect(run).toHaveBeenCalledOnce();
    const [items, target] = run.mock.calls[0] as any[];
    expect(items[0].file.name).toBe("hello.txt");
    expect(target.path).toBe("a.excalidraw");
    expect(target.at).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  });

  it("a read-only drawing refuses with a message and runs nothing", () => {
    claim();
    const run = vi.fn(async () => {});
    setImportRunner(run);
    expect(drop(mount({ readOnly: true }), [txt()])).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe(
      "This drawing is read-only",
    );
    expect(run).not.toHaveBeenCalled();
  });
});

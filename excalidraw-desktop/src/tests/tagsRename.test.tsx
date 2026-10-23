import { afterEach, describe, expect, it, vi } from "vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import RenameTagDialog from "../components/tags/RenameTagDialog";
import { isTagJob } from "../tags/renameJobs";
import { runTagRename, validateTagInput } from "../tags/renameFlow";

import { FakeVaultTagRename } from "./fakeVaultTagRename";

import type { RewriteDone } from "../links/types";
import type { TagRenameDeps } from "../tags/renameFlow";

afterEach(cleanup);

describe("validateTagInput", () => {
  it.each([
    ["Algo", "Algo"],
    ["#dsa/graphs", "dsa/graphs"],
    ["  x_1  ", "x_1"],
  ])("accepts %s", (input, display) => {
    expect(validateTagInput(input)).toEqual({ ok: true, display });
  });
  it.each(["", "#", "a b", "123", "a#b", "##x", "x,y"])("rejects %j", (i) => {
    expect(validateTagInput(i).ok).toBe(false);
  });
});

const tags = () => [
  { tag: "dsa", display: "DSA", count: 4 },
  { tag: "dsa/graphs", display: "DSA/Graphs", count: 2 },
  { tag: "ml", display: "ML", count: 1 },
];

function setup(api = new FakeVaultTagRename(), initial = true) {
  const onConfirm = vi.fn(async () => {});
  const onCancel = vi.fn();
  render(
    <RenameTagDialog
      api={api}
      handle="h"
      tags={tags}
      initial={initial ? { key: "dsa", display: "DSA" } : null}
      onConfirm={onConfirm}
      onCancel={onCancel}
      ownerDocument={document}
      debounceMs={0}
    />,
  );
  return { api, onConfirm, onCancel };
}

const field = () => screen.getByLabelText("New tag") as HTMLInputElement;

describe("RenameTagDialog", () => {
  it("prefills the display spelling and disables Rename until it changes", () => {
    setup();
    expect(field().value).toBe("DSA");
    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
  });

  it("validates live and shows the error", () => {
    setup();
    fireEvent.change(field(), { target: { value: "bad tag" } });
    expect(screen.getByText(/Not a valid tag/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
  });

  it("fetches and shows the plan, debounced to the last value", async () => {
    const { api } = setup();
    fireEvent.change(field(), { target: { value: "Al" } });
    fireEvent.change(field(), { target: { value: "Algo" } });
    expect(await screen.findByTestId("rename-tag-plan")).toHaveTextContent(
      "3 occurrences in 2 drawings",
    );
    expect(api.planCalls.at(-1)).toEqual({
      handle: "h",
      from: "dsa",
      to: "Algo",
    });
    expect(api.planCalls.some((c) => c.to === "Al")).toBe(false);
  });

  it("lists child keys and warns about a merge", async () => {
    const api = new FakeVaultTagRename();
    api.planResult = (from, to) => ({
      from,
      to,
      files: 1,
      occurrences: 2,
      merges: true,
      keys: [
        { from: "dsa", to: "ml" },
        { from: "dsa/graphs", to: "ml/graphs" },
      ],
    });
    setup(api);
    fireEvent.change(field(), { target: { value: "ML" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Merges with existing #ml",
    );
    expect(screen.getByText(/#dsa\/graphs . #ml\/graphs/)).toBeInTheDocument();
  });

  it("Enter confirms, Esc cancels", async () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.change(field(), { target: { value: "Algo" } });
    fireEvent.submit(field().closest("form")!);
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith(
        { key: "dsa", display: "DSA" },
        "Algo",
      ),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows a native error and stays open", async () => {
    const api = new FakeVaultTagRename();
    const onConfirm = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <RenameTagDialog
        api={api}
        handle="h"
        tags={tags}
        initial={{ key: "dsa", display: "DSA" }}
        onConfirm={onConfirm}
        onCancel={() => {}}
        ownerDocument={document}
        debounceMs={0}
      />,
    );
    fireEvent.change(field(), { target: { value: "Algo" } });
    fireEvent.submit(field().closest("form")!);
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });

  it("picks a tag first when none is given, keyboard only", async () => {
    setup(new FakeVaultTagRename(), false);
    const pick = screen.getByLabelText("Tag");
    fireEvent.change(pick, { target: { value: "gra" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(pick, { key: "Enter" });
    expect(
      ((await screen.findByLabelText("New tag")) as HTMLInputElement).value,
    ).toBe("DSA/Graphs");
  });
});

describe("runTagRename", () => {
  function flowSetup() {
    const api = new FakeVaultTagRename();
    let emit: (d: RewriteDone) => void = () => {};
    const order: string[] = [];
    const notify = vi.fn();
    const deps: TagRenameDeps = {
      api,
      links: {
        onRewriteDone: async (l) => {
          emit = l;
          return () => {};
        },
      },
      handle: "h",
      openPath: "open.excalidraw",
      flush: async () => void order.push("flush"),
      applyEdits: vi.fn((e) => {
        order.push("apply");
        return e.length;
      }),
      notify,
    };
    return { api, deps, notify, order, emit: (d: RewriteDone) => emit(d) };
  }
  const done = (over: Partial<RewriteDone> = {}): RewriteDone => ({
    handle: "h",
    jobId: 7,
    rewritten: 2,
    links: 3,
    failed: [],
    tookMs: 1,
    ...over,
  });

  it("flushes, renames with openPath, applies open edits, toasts on done", async () => {
    const { api, deps, notify, order, emit } = flowSetup();
    api.renameResult = {
      jobId: 7,
      plannedFiles: 2,
      plannedLinks: 3,
      openDrawingEdits: [{ elementId: "t", field: "text", value: "#Algo" }],
    };
    const { completed } = await runTagRename(deps, "dsa", "Algo", "DSA");
    expect(order).toEqual(["flush", "apply"]);
    expect(api.renameCalls).toEqual([
      { handle: "h", from: "dsa", to: "Algo", openPath: "open.excalidraw" },
    ]);
    expect(isTagJob("h", 7)).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    await act(async () => {
      emit(done());
      await completed;
    });
    expect(notify).toHaveBeenCalledWith(
      "Renamed #DSA to #Algo in 3 drawings",
      "info",
    );
    expect(isTagJob("h", 7)).toBe(false);
  });

  it("toasts immediately when only the open drawing changed (jobId null)", async () => {
    const { api, deps, notify } = flowSetup();
    api.renameResult = {
      jobId: null,
      plannedFiles: 0,
      plannedLinks: 0,
      openDrawingEdits: [{ elementId: "f", field: "name", value: "#Algo" }],
    };
    await runTagRename(deps, "dsa", "Algo", "DSA");
    expect(notify).toHaveBeenCalledWith(
      "Renamed #DSA to #Algo in 1 drawing",
      "info",
    );
  });

  it("reports CONFLICT skips as an error", async () => {
    const { deps, notify, emit } = flowSetup();
    const { completed } = await runTagRename(deps, "dsa", "Algo", "DSA");
    await act(async () => {
      emit(
        done({
          rewritten: 1,
          failed: [{ path: "a.excalidraw", code: "CONFLICT", message: "" }],
        }),
      );
      await completed;
    });
    expect(notify).toHaveBeenCalledWith(
      "Renamed #DSA to #Algo in 1 drawing; skipped: a.excalidraw (changed on disk)",
      "error",
    );
  });

  it("surfaces INVALID_TAG and does not apply edits", async () => {
    const { api, deps, notify } = flowSetup();
    api.renameResult = Object.assign(new Error("not a valid tag"), {
      code: "INVALID_TAG",
    });
    await expect(runTagRename(deps, "dsa", "a b")).rejects.toThrow(
      "not a valid tag",
    );
    expect(deps.applyEdits).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});

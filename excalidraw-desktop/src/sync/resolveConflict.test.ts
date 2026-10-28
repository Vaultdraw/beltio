import { describe, expect, it, vi } from "vitest";

import { findCounterpart, resolveConflict } from "./resolveConflict";

const files: Record<string, { json: string; revision: string }> = {
  "a.excalidraw": { json: "A", revision: "ra" },
  "a (conflicted copy 1).excalidraw": { json: "C", revision: "rc" },
};
const setup = () => {
  const calls: string[] = [];
  const repository = {
    readDrawing: vi.fn(async (_h: string, p: string) => files[p]),
    writeDrawing: vi.fn(
      async (i: {
        path: string;
        json: string;
        expectedRevision: string | null;
      }) => {
        calls.push(`write ${i.path} ${i.json} expects ${i.expectedRevision}`);
        return { revision: "x" };
      },
    ),
    trash: vi.fn(
      async (_h: string, p: string) => void calls.push(`trash ${p}`),
    ),
  };
  const history = {
    snapshotBytes: vi.fn(
      async (_h: string, p: string, _r: string, rev: string, json: string) => {
        calls.push(`history ${p} ${json} ${rev}`);
        return {} as never;
      },
    ),
  };
  return { calls, repository, history };
};
const input = (s: ReturnType<typeof setup>, keep: "original" | "copy") => ({
  ...s,
  handle: "h",
  original: "a.excalidraw",
  copy: "a (conflicted copy 1).excalidraw",
  keep,
});

describe("resolveConflict", () => {
  it("keep the original: the copy goes to history, then to the trash", async () => {
    const s = setup();
    await resolveConflict(input(s, "original"));
    expect(s.calls).toEqual([
      "history a.excalidraw C rc",
      "trash a (conflicted copy 1).excalidraw",
    ]);
  });
  it("keep the copy: the original goes to history first, the save checks its revision", async () => {
    const s = setup();
    await resolveConflict(input(s, "copy"));
    expect(s.calls).toEqual([
      "history a.excalidraw A ra",
      "write a.excalidraw C expects ra",
      "trash a (conflicted copy 1).excalidraw",
    ]);
  });
  it("a refused save (file changed again) leaves both files: nothing is trashed", async () => {
    const s = setup();
    s.repository.writeDrawing.mockRejectedValueOnce({ code: "CONFLICT" });
    await expect(resolveConflict(input(s, "copy"))).rejects.toBeTruthy();
    expect(s.repository.trash).not.toHaveBeenCalled();
  });
});

describe("findCounterpart", () => {
  const entries = [
    { path: "a.excalidraw", modifiedAt: 1 },
    {
      path: "a (conflicted copy 1).excalidraw",
      modifiedAt: 2,
      sync: "conflict",
      conflictOf: "a.excalidraw",
    },
    {
      path: "a 2.excalidraw",
      modifiedAt: 5,
      sync: "conflict",
      conflictOf: "a.excalidraw",
    },
  ];
  it("from the original: the newest copy; from a copy: its original", () => {
    expect(findCounterpart("a.excalidraw", entries)).toEqual({
      original: "a.excalidraw",
      copy: "a 2.excalidraw",
    });
    expect(
      findCounterpart("a (conflicted copy 1).excalidraw", entries),
    ).toEqual({
      original: "a.excalidraw",
      copy: "a (conflicted copy 1).excalidraw",
    });
    expect(findCounterpart("b.excalidraw", entries)).toBeNull();
  });
});

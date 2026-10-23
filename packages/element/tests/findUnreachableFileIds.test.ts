import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { findUnreachableFileIds } from "../src/image";

import type { FileId } from "../src/types";

const fid = (n: number) => `f${n}` as FileId;
const img = (n: number, isDeleted = false) =>
  API.createElement({ type: "image", fileId: fid(n), isDeleted });

describe("findUnreachableFileIds", () => {
  const run = (
    elements: ReturnType<typeof img>[],
    historyIds: string[],
    since: Map<FileId, number>,
    now: number,
    extra: Partial<Parameters<typeof findUnreachableFileIds>[0]> = {},
  ) =>
    findUnreachableFileIds({
      fileIds: [fid(0), fid(1), fid(2), fid(3)],
      elements,
      historyElementIds: new Set(historyIds),
      unreachableSince: since,
      now,
      ...extra,
    });

  it("keeps files of visible elements and of deleted elements an undo entry touches", () => {
    const visible = img(0);
    const inHistory = img(1, true);
    const gone = img(2, true);
    const since = new Map<FileId, number>();
    const elements = [visible, inHistory, gone];
    // f2 (deleted, untouched by history) and f3 (no element) are candidates
    expect(run(elements, [inHistory.id], since, 0)).toEqual({
      release: [],
      pending: 2,
    });
    expect(run(elements, [inHistory.id], since, 10_000)).toEqual({
      release: [fid(2), fid(3)],
      pending: 0,
    });
  });

  it("restarts the probation when a file becomes reachable again (undo)", () => {
    const e = img(0, true);
    const since = new Map<FileId, number>();
    const ids = [fid(0)];
    const call = (historyIds: string[], now: number) =>
      findUnreachableFileIds({
        fileIds: ids,
        elements: [e],
        historyElementIds: new Set(historyIds),
        unreachableSince: since,
        now,
      });
    expect(call([], 0).pending).toBe(1);
    expect(call([e.id], 5_000).pending).toBe(0);
    expect(since.size).toBe(0);
    expect(call([], 6_000).pending).toBe(1); // clock restarted at 6000
    expect(call([], 15_000).release).toEqual([]);
    expect(call([], 16_000).release).toEqual([fid(0)]);
  });

  it("never releases `keep`, releases at once with graceMs 0, forgets gone ids", () => {
    const since = new Map<FileId, number>([[fid(9), 1]]);
    const out = run([], [], since, 0, {
      keep: new Set([fid(0)]),
      graceMs: 0,
    });
    expect(out.release).toEqual([fid(1), fid(2), fid(3)]);
    expect(since.has(fid(9))).toBe(false);
  });
});

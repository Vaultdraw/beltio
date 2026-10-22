import { serializeAsJSON } from "@excalidraw/excalidraw";
import { describe, expect, it, vi } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";

import { toAsciiJson } from "../vault/asciiJson";

import {
  peekFileFragment,
  serializeSceneForSave,
} from "../editor/sceneSerializer";

const el = (over: Record<string, unknown>): ExcalidrawElement =>
  ({
    id: "e",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    isDeleted: false,
    version: 1,
    versionNonce: 1,
    ...over,
  } as unknown as ExcalidrawElement);

const image = (id: string, fileId: string, isDeleted = false) =>
  el({ id, type: "image", fileId, isDeleted });

const file = (id: string, dataURL: string, extra = {}): BinaryFileData =>
  ({
    id,
    mimeType: "image/png",
    dataURL,
    created: 1700000000000,
    ...extra,
  } as unknown as BinaryFileData);

const appState = { viewBackgroundColor: "#fff" };

/** The editor's own output in the pure-ASCII transport form (same JSON value). */
const same = (elements: ExcalidrawElement[], files: BinaryFiles) => {
  const editor = serializeAsJSON(elements, appState, files, "local");
  const expected = toAsciiJson(editor);
  const out = serializeSceneForSave(elements, appState, files);
  expect(out).toBe(expected);
  // eslint-disable-next-line no-control-regex
  expect(/^[\x00-\x7f]*$/.test(out)).toBe(true);
  expect(JSON.parse(out)).toEqual(JSON.parse(editor));
  return expected;
};

describe("serializeSceneForSave is byte-identical to serializeAsJSON", () => {
  it("no files and no elements", () => {
    same([], {});
  });

  it("referenced files", () => {
    same([image("i1", "f1"), image("i2", "f2")], {
      f1: file("f1", "data:image/png;base64,AAAA"),
      f2: file("f2", "data:image/png;base64,BBBB", { lastRetrieved: 5 }),
    });
  });

  it("files only referenced by deleted elements are dropped", () => {
    same([image("i1", "f1", true), image("i2", "f2")], {
      f1: file("f1", "data:x"),
      f2: file("f2", "data:y"),
    });
    same([image("i1", "f1", true)], { f1: file("f1", "data:x") });
  });

  it("unreferenced files and missing files are ignored", () => {
    same([image("i1", "gone"), el({ id: "r" })], {
      unused: file("unused", "data:x"),
    });
  });

  it("one file shared by two elements appears once", () => {
    same([image("i1", "f1"), image("i2", "f1")], {
      f1: file("f1", "data:x"),
    });
  });

  it("integer-like ids keep the engine's key order", () => {
    same([image("i1", "b"), image("i2", "2"), image("i3", "1")], {
      b: file("b", "data:b"),
      "2": file("2", "data:2"),
      "1": file("1", "data:1"),
    });
  });

  it("unicode, escapes, quotes and newlines in text and dataURLs", () => {
    const nasty = 'he said "hi"\n\ttab \\ back \u2028 \u{1F600} </script> é';
    same([el({ id: "t", type: "text", text: nasty }), image("i1", 'f"1\n')], {
      'f"1\n': file('f"1\n', `data:text/plain,${nasty}`, { note: nasty }),
    });
  });

  it("an element edited in place to non-ASCII text (version bump) is escaped", () => {
    const text = el({ id: "t", type: "text", text: "plain" });
    same([text], {});
    const mutable = text as unknown as Record<string, unknown>;
    mutable.text = "now \u2014 with a dash";
    mutable.version = 2;
    mutable.versionNonce = 7;
    expect(same([text], {})).toContain("\\u2014");
  });

  it("non-ASCII in the app state is escaped", () => {
    const out = serializeSceneForSave(
      [el({ id: "a" })],
      { name: "Caf\u00e9 \u2014 plan" } as never,
      {},
    );
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7f]*$/.test(out)).toBe(true);
  });

  it("element text that looks like the files block or ends like the shell", () => {
    const text = 'x",\n  "files": {}\n}';
    same([el({ id: "t", type: "text", text }), image("i1", "f1")], {
      f1: file("f1", "data:x"),
    });
    same([el({ id: "t", type: "text", text })], {});
  });

  it("undefined fields and extra fields", () => {
    same([image("i1", "f1")], {
      f1: file("f1", "data:x", { version: undefined, extra: { a: [1, 2] } }),
    });
  });

  it("a file mutated in place between calls is re-serialized", () => {
    const f1 = file("f1", "data:x", { version: 1 });
    const files = { f1 };
    const elements = [image("i1", "f1")];
    const first = same(elements, files);
    f1.version = 2;
    f1.lastRetrieved = 99;
    const second = same(elements, files);
    expect(second).not.toBe(first);
    expect(second).toContain('"version": 2');
    f1.dataURL = "data:changed" as BinaryFileData["dataURL"];
    expect(same(elements, files)).toContain("data:changed");
    delete (f1 as any).lastRetrieved;
    expect(same(elements, files)).not.toContain("lastRetrieved");
  });

  it("a file replaced by a new object is re-serialized", () => {
    const elements = [image("i1", "f1")];
    same(elements, { f1: file("f1", "data:old") });
    expect(same(elements, { f1: file("f1", "data:new") })).toContain(
      "data:new",
    );
  });
});

describe("unsafe dataURLs fall back to JSON.stringify escaping", () => {
  const cases: Record<string, string> = {
    quote: 'data:a"b',
    backslash: "data:a\\b",
    newline: "data:a\nb",
    control: "data:a\u0001b\u001fc",
    loneHigh: "data:a\ud800b",
    loneLow: "data:a\udc00",
    validPair: "data:a\u{1F600}b",
    separators: "data:a\u2028\u2029b",
    empty: "",
  };
  for (const [name, url] of Object.entries(cases)) {
    it(`byte-identical: ${name}`, () => {
      const elements = [image("i1", "f1")];
      const files = { f1: file("f1", url) };
      same(elements, files);
      same(elements, files); // cached path
    });
  }

  it("a non-string dataURL is serialized like the editor does", () => {
    same([image("i1", "f1")], {
      f1: file("f1", undefined as unknown as string),
    });
  });

  it("a file field equal to the internal marker prefix cannot confuse the split", () => {
    same([image("i1", "f1")], {
      f1: file("f1", "data:x", { note: '"data:x"' }),
    });
  });
});

describe("serializeSceneForSave cache", () => {
  it("caches only small pieces, never the dataURL", () => {
    const big = `data:image/png;base64,${"A".repeat(18_000_000)}`;
    const f = file("f1", big);
    const out = serializeSceneForSave([image("i1", "f1")], appState, {
      f1: f,
    });
    expect(out.length).toBeGreaterThan(18_000_000);
    const entry = peekFileFragment(f)!;
    expect(entry.safe).toBe(true);
    expect(entry.before.length).toBeLessThan(1024);
    expect(entry.after.length).toBeLessThan(1024);
    const strings = Object.values(entry.snapshot).filter(
      (value): value is string => typeof value === "string" && value !== big,
    );
    expect(strings.every((value) => value.length < 1024)).toBe(true);
    // The snapshot references the original string rather than a copy.
    expect(entry.snapshot.dataURL).toBe(big);
  });

  it("does not stringify an unchanged file again", () => {
    const big = `data:image/png;base64,${"A".repeat(200000)}`;
    const files = { f1: file("f1", big) };
    const elements = [image("i1", "f1")];
    const first = serializeSceneForSave(elements, appState, files);
    const spy = vi.spyOn(JSON, "stringify");
    const second = serializeSceneForSave(elements, appState, files);
    const stringified = spy.mock.calls.filter(
      ([value]) => typeof value === "object" && value && "dataURL" in value,
    );
    spy.mockRestore();
    expect(stringified).toHaveLength(0);
    expect(second).toBe(first);
  });

  it("benchmark: 18 MB of dataURLs, 5000 elements (log only)", () => {
    const files: BinaryFiles = {};
    const elements: ExcalidrawElement[] = [];
    for (let i = 0; i < 12; i++) {
      files[`f${i}`] = file(
        `f${i}`,
        `data:image/png;base64,${"Qk1".repeat(500000)}${i}`,
      );
      elements.push(image(`img${i}`, `f${i}`));
    }
    for (let i = 0; i < 5000; i++) {
      elements.push(el({ id: `r${i}`, x: i, y: i }));
    }
    const time = (fn: () => string) => {
      const start = performance.now();
      const out = fn();
      return [performance.now() - start, out] as const;
    };
    const [tOld, old] = time(() =>
      serializeAsJSON(elements, appState, files, "local"),
    );
    const [tCold, cold] = time(() =>
      serializeSceneForSave(elements, appState, files),
    );
    const [tWarm, warm] = time(() =>
      serializeSceneForSave(elements, appState, files),
    );
    expect(cold).toBe(old);
    expect(warm).toBe(old);
    // eslint-disable-next-line no-console
    console.log(
      `[bench] ${(old.length / 1e6).toFixed(
        1,
      )} MB: serializeAsJSON ${tOld.toFixed(1)} ms, cold ${tCold.toFixed(
        1,
      )} ms, cached ${tWarm.toFixed(1)} ms`,
    );
  });
});

/**
 * useVaultDocument behavior tests against the REAL production hook
 * (`../vault/useVaultDocument.ts`) with FakeVaultRepository as the backend.
 *
 * Covers:
 * - open/create/change/flush/close/reload/saveCopy/relocate signatures
 * - document.source.json is the load text until a save settles; edits live in internal currentJson
 * - flush-before-navigation: open/create/close/relocate flush first; on flush
 *   failure the current document stays intact and the call rejects
 * - rapid A -> B -> C navigation: generation IDs reject stale load results
 * - external conflict (dirty + disk change -> conflict) vs clean auto-reload
 * - external deletion -> conflict, saving to old path disabled
 * - saveCopy resolves conflicts by switching to the copy
 *
 * Lightweight: no editor mount, no root setupTests.ts.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createBackgroundPattern } from "@excalidraw/excalidraw/data/backgroundPattern";

import { useVaultDocument } from "../vault/useVaultDocument";

import { FakeVaultRepository } from "./fakeVaultRepository";
import { BLANK_SCENE, editedSampleScene, SAMPLE_SCENE } from "./fixtures";

const vaultOf = (repo: FakeVaultRepository) => ({ ...repo.vault });

async function openPath(
  hook: { current: ReturnType<typeof useVaultDocument> },
  path: string,
) {
  await act(async () => {
    await hook.current.open(path);
  });
}

describe("useVaultDocument open/create/change/flush", () => {
  it("opens a drawing; document.source.json is the load text, not live edits", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "a.excalidraw");
    expect(result.current.document?.path).toBe("a.excalidraw");
    expect(result.current.document?.source.json).toBe(SAMPLE_SCENE);
    expect(result.current.status).toBe("saved");

    act(() => result.current.change(BLANK_SCENE));
    expect(result.current.status).toBe("dirty");
    // Snapshot stays stable so the editor is not reset on every keystroke.
    expect(result.current.document?.source.json).toBe(SAMPLE_SCENE);
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.status).toBe("saved");
    const disk = await repo.readDrawing(repo.handle, "a.excalidraw");
    expect(disk.json).toBe(BLANK_SCENE);
  });

  it("a replaced document's text is released, so a stale render closure keeps nothing big", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    repo.seedDrawing("b.excalidraw", BLANK_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "a.excalidraw");
    const first = result.current.document?.source;
    expect(first?.json).toBe(SAMPLE_SCENE);
    await openPath(result, "b.excalidraw");
    expect(first?.json).toBe("");
    expect(result.current.document?.source.json).toBe(BLANK_SCENE);
  });

  it("create() uses create-only writes and activates the new document", async () => {
    const repo = new FakeVaultRepository();
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await act(async () => {
      await result.current.create("DSA", "1D DP.excalidraw");
    });
    expect(result.current.document?.path).toBe("DSA/1D DP.excalidraw");
    expect(repo.writeCalls[0]).toMatchObject({
      path: "DSA/1D DP.excalidraw",
      expectedRevision: null,
    });
    // Second create at the same path must fail (never overwrite).
    await expect(
      act(async () => {
        await result.current.create("DSA", "1D DP.excalidraw");
      }),
    ).rejects.toThrow();
  });

  it("create() saves the initial paper pattern into the new file", async () => {
    const repo = new FakeVaultRepository();
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    const pattern = createBackgroundPattern("lines");
    await act(async () => {
      await result.current.create("", "Ruled.excalidraw", {
        viewBackgroundPattern: pattern,
      });
    });
    const saved = JSON.parse(
      (await repo.readDrawing(repo.handle, "Ruled.excalidraw")).json,
    );
    expect(saved.appState.viewBackgroundPattern).toEqual(pattern);
    await act(async () => {
      await result.current.create("", "Plain.excalidraw", {
        viewBackgroundPattern: null,
      });
    });
    const plain = JSON.parse(
      (await repo.readDrawing(repo.handle, "Plain.excalidraw")).json,
    );
    expect(plain.appState.viewBackgroundPattern).toBeNull();
  });

  it("throws a readable error when no vault is chosen", async () => {
    const repo = new FakeVaultRepository();
    const { result } = renderHook(() => useVaultDocument(repo, null));
    await expect(
      act(async () => {
        await result.current.open("a.excalidraw");
      }),
    ).rejects.toThrow(/vault/i);
  });

  it("close() flushes then clears; reload() drops dirty state for the disk version", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "a.excalidraw");
    act(() => result.current.change(BLANK_SCENE));
    await act(async () => {
      await result.current.close();
    });
    expect(result.current.document).toBeNull();
    const disk = await repo.readDrawing(repo.handle, "a.excalidraw");
    expect(disk.json).toBe(BLANK_SCENE); // close flushed

    await openPath(result, "a.excalidraw");
    act(() => result.current.change(SAMPLE_SCENE));
    expect(result.current.status).toBe("dirty");
    await act(async () => {
      await result.current.reload();
    });
    // reload deliberately drops dirty edits (UI confirms first).
    expect(result.current.document?.source.json).toBe(BLANK_SCENE);
    expect(result.current.status).toBe("saved");
  });
});

describe("read-only drawing files", () => {
  it("opens flagged, never saves, and lifts when the watcher sees it become writable", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    repo.setFileReadOnly("a.excalidraw", true);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "a.excalidraw");
    expect(result.current.fileReadOnly).toBe(true);
    // A change that slips through is not written (the fake would refuse with READ_ONLY).
    const writesBefore = repo.writeCalls.length;
    act(() => result.current.change(BLANK_SCENE));
    await act(async () => {
      await result.current.flush().catch(() => undefined);
    });
    expect(repo.writeCalls.length).toBe(writesBefore);
    await act(async () => {
      repo.setFileReadOnly("a.excalidraw", false);
    });
    await waitFor(() => expect(result.current.fileReadOnly).toBe(false));
  });

  it("a writable drawing is not flagged, and a reload picks the flag up again", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "a.excalidraw");
    expect(result.current.fileReadOnly).toBe(false);
    await act(async () => {
      repo.setFileReadOnly("a.excalidraw", true);
    });
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.fileReadOnly).toBe(true);
  });
});

describe("a file locked while it is open", () => {
  it("the refused save switches the drawing to view mode and keeps the edits", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "a.excalidraw");
    expect(result.current.fileReadOnly).toBe(false);
    repo.setFileReadOnly("a.excalidraw", true);
    act(() => result.current.change(BLANK_SCENE));
    await act(async () => {
      await result.current.flush().catch(() => undefined);
    });
    await waitFor(() => expect(result.current.fileReadOnly).toBe(true));
    // Nothing was written, and the unsaved scene is still there for Save a copy.
    const disk = await repo.readDrawing(repo.handle, "a.excalidraw");
    expect(disk.json).toBe(SAMPLE_SCENE);
    await act(async () => {
      await result.current.saveCopy("copy.excalidraw");
    });
    const copy = await repo.readDrawing(repo.handle, "copy.excalidraw");
    expect(copy.json).toBe(BLANK_SCENE);
  });
});

describe("rapid navigation and dirty-switch failures", () => {
  it("rapid A -> B -> C navigation keeps only the last document (stale loads rejected)", async () => {
    const repo = new FakeVaultRepository({ latencyMs: 40 });
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    repo.seedDrawing("b.excalidraw", BLANK_SCENE);
    repo.seedDrawing("c.excalidraw", editedSampleScene());
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await act(async () => {
      const p1 = result.current.open("a.excalidraw");
      const p2 = result.current.open("b.excalidraw");
      const p3 = result.current.open("c.excalidraw");
      await Promise.allSettled([p1, p2, p3]);
    });
    // Generation IDs reject stale A/B results; C wins.
    expect(result.current.document?.path).toBe("c.excalidraw");
    expect(result.current.document?.source.json).toBe(editedSampleScene());
  });

  it("failed flush before navigation keeps the current document intact", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    repo.seedDrawing("b.excalidraw", BLANK_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "a.excalidraw");
    act(() => result.current.change(editedSampleScene()));
    repo.failWrites = true; // next flush (inside open) fails
    let openError: unknown;
    try {
      await act(async () => {
        await result.current.open("b.excalidraw");
      });
    } catch (e) {
      openError = e;
    }
    expect(openError).toBeDefined();
    expect((openError as Error).message).toMatch(/simulated disk full/);
    // Still on A with the dirty edit preserved, never silently abandoned.
    expect(result.current.document?.path).toBe("a.excalidraw");
    repo.failWrites = false;
    await act(async () => {
      await result.current.flush();
    });
    await openPath(result, "b.excalidraw");
    expect(result.current.document?.path).toBe("b.excalidraw");
  });
});

describe("external conflicts and deletion", () => {
  it("clean document auto-reloads on external change; dirty document enters conflict", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "a.excalidraw");

    // Clean: external edit is adopted after validation.
    act(() => {
      repo.externalWrite("a.excalidraw", BLANK_SCENE);
    });
    await waitFor(() =>
      expect(result.current.document?.source.json).toBe(BLANK_SCENE),
    );
    expect(result.current.status).toBe("saved");

    // Dirty: external edit becomes an explicit conflict, no autosave-over.
    act(() => result.current.change(editedSampleScene()));
    act(() => {
      repo.externalWrite("a.excalidraw", SAMPLE_SCENE);
    });
    await waitFor(() => expect(result.current.status).toBe("conflict"));
    expect(result.current.error).toMatch(/outside the editor/i);
    // Disk keeps the external version; memory keeps the user edit.
    const disk = await repo.readDrawing(repo.handle, "a.excalidraw");
    expect(disk.json).toBe(SAMPLE_SCENE);
  });

  it("external deletion stops writes to the old path and offers save-a-copy", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "a.excalidraw");
    act(() => result.current.change(BLANK_SCENE));
    act(() => {
      repo.externalDelete("a.excalidraw");
    });
    await waitFor(() => expect(result.current.status).toBe("conflict"));
    expect(result.current.error).toMatch(/deleted/i);

    // saveCopy writes the in-memory scene to a NEW path without overwrite.
    await act(async () => {
      await result.current.saveCopy("rescued.excalidraw");
    });
    expect(result.current.document?.path).toBe("rescued.excalidraw");
    const rescued = await repo.readDrawing(repo.handle, "rescued.excalidraw");
    expect(rescued.json).toBe(BLANK_SCENE);
  });

  it("ignores watcher events for unrelated paths and other vault handles", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    repo.seedDrawing("other.excalidraw", BLANK_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "a.excalidraw");
    act(() => {
      repo.externalWrite("other.excalidraw", SAMPLE_SCENE);
      repo.emit({
        handle: "different-handle",
        paths: ["a.excalidraw"],
        rescan: false,
      });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(result.current.document?.source.json).toBe(SAMPLE_SCENE);
    expect(result.current.status).toBe("saved");
  });
});

describe("saveCopy and relocate", () => {
  it("saveCopy switches to the copy; relocate follows file and folder moves", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "a.excalidraw");
    act(() => result.current.change(BLANK_SCENE));

    await act(async () => {
      await result.current.saveCopy("copy.excalidraw");
    });
    expect(result.current.document?.path).toBe("copy.excalidraw");
    expect((await repo.readDrawing(repo.handle, "copy.excalidraw")).json).toBe(
      BLANK_SCENE,
    );

    await act(async () => {
      await result.current.relocate("copy.excalidraw", "DSA/moved.excalidraw");
    });
    expect(result.current.document?.path).toBe("DSA/moved.excalidraw");
  });

  it("edits made while a move runs are saved to the new path, with no conflict", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    const { result } = renderHook(() =>
      useVaultDocument(repo, vaultOf(repo), { autosaveDelayMs: 10 }),
    );
    await openPath(result, "a.excalidraw");
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let moving: Promise<void> = Promise.resolve();
    await act(async () => {
      moving = result.current.relocate(
        "a.excalidraw",
        "b.excalidraw",
        async (from, to) => {
          // The file is renamed first; rewriting links elsewhere takes longer.
          await repo.move(repo.handle, from, to);
          await gate;
        },
      );
      await new Promise((r) => setTimeout(r, 0));
    });
    act(() => result.current.change(BLANK_SCENE));
    // Longer than the save timer: it fires while the move is still running.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(result.current.status).not.toBe("conflict");
    await act(async () => {
      release();
      await moving;
    });
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(result.current.document?.path).toBe("b.excalidraw");
    expect((await repo.readDrawing(repo.handle, "b.excalidraw")).json).toBe(
      BLANK_SCENE,
    );
  });

  it("relocate follows ancestor folder moves", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("DSA/a.excalidraw", SAMPLE_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "DSA/a.excalidraw");
    await act(async () => {
      await result.current.relocate("DSA", "Algo");
    });
    expect(result.current.document?.path).toBe("Algo/a.excalidraw");
  });
});

describe("useVaultDocument watcher revision probe", () => {
  class ProbingRepository extends FakeVaultRepository {
    reads = 0;
    probes = 0;
    async readDrawing(handle: string, path: string) {
      this.reads += 1;
      return super.readDrawing(handle, path);
    }
    async readRevision(handle: string, path: string) {
      this.probes += 1;
      try {
        return (await super.readDrawing(handle, path)).revision;
      } catch {
        return null;
      }
    }
  }

  it("skips the full read when the revision is unchanged, reads when it differs", async () => {
    const repo = new ProbingRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "a.excalidraw");
    repo.reads = 0;

    act(() => {
      repo.emit({
        handle: repo.vault.handle,
        paths: ["a.excalidraw"],
        rescan: false,
      });
    });
    await waitFor(() => expect(repo.probes).toBe(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(repo.reads).toBe(0);

    act(() => {
      repo.externalWrite("a.excalidraw", BLANK_SCENE);
    });
    await waitFor(() =>
      expect(result.current.document?.source.json).toBe(BLANK_SCENE),
    );
    expect(repo.reads).toBe(1);
  });

  // Native watcher echoes of our own saves arrive after the write is
  // acknowledged, often while the user keeps typing. A reload would remount the
  // editor (closing an open text editor) and a conflict would stop autosave.
  it("own-save echoes while typing never reload or conflict", async () => {
    const repo = new ProbingRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    const { result } = renderHook(() =>
      useVaultDocument(repo, vaultOf(repo), { autosaveDelayMs: 60_000 }),
    );
    await openPath(result, "a.excalidraw");
    const id = result.current.document?.id;
    const echo = () =>
      act(() => {
        repo.emit({
          handle: repo.vault.handle,
          paths: ["a.excalidraw"],
          rescan: false,
        });
      });
    const settle = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });

    // Save 1 (its in-write echo is handled by the in-flight barrier).
    act(() => result.current.change(editedSampleScene()));
    await act(async () => {
      await result.current.flush({ commitText: false });
    });
    // The user types on; the edit is pending, then save 1's late echo lands.
    act(() => result.current.change(BLANK_SCENE));
    repo.reads = 0;
    echo();
    await settle();
    expect(result.current.status).toBe("dirty");
    expect(result.current.document?.id).toBe(id);
    expect(repo.reads).toBe(0);

    // Late echo arriving while the next save is in flight.
    repo.latencyMs = 15;
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.flush({ commitText: false });
    });
    echo();
    await act(async () => {
      await saving;
    });
    await settle();
    expect(result.current.status).toBe("saved");
    expect(result.current.document?.id).toBe(id);
    expect((await repo.readDrawing(repo.handle, "a.excalidraw")).json).toBe(
      BLANK_SCENE,
    );
  });

  it("treats a missing file from the probe as a deletion", async () => {
    const repo = new ProbingRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "a.excalidraw");
    repo.reads = 0;
    act(() => {
      repo.externalDelete("a.excalidraw");
    });
    await waitFor(() => expect(result.current.status).toBe("conflict"));
    expect(result.current.error).toMatch(/deleted/i);
    expect(repo.reads).toBe(0);
  });
});

describe("document source handle (no retained load-time copy)", () => {
  const setup = async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    repo.seedDrawing("b.excalidraw", BLANK_SCENE);
    let renders = 0;
    const hook = renderHook(() => {
      renders += 1;
      return useVaultDocument(repo, vaultOf(repo));
    });
    await openPath(hook.result, "a.excalidraw");
    return { repo, hook, renders: () => renders };
  };

  it("a save points the handle at the saved string without touching the document", async () => {
    const { hook } = await setup();
    const { result } = hook;
    const before = result.current.document!;
    const source = before.source;
    expect(source.json).toBe(SAMPLE_SCENE);

    act(() => result.current.change(BLANK_SCENE));
    // Not saved yet: the handle still holds the load text.
    expect(source.json).toBe(SAMPLE_SCENE);
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.status).toBe("saved");
    expect(source.json).toBe(BLANK_SCENE);
    expect(result.current.document).toBe(before);
    expect(result.current.document?.source).toBe(source);
    expect(result.current.document?.id).toBe(before.id);
  });

  it("saving does not re-render the hook's document consumers", async () => {
    const { hook } = await setup();
    const { result } = hook;
    const doc = result.current.document;
    const seen: unknown[] = [];
    // Status churn (dirty/saving/saved) re-renders the hook owner by design;
    // the document object itself must never be replaced by a save.
    act(() => result.current.change(BLANK_SCENE));
    seen.push(result.current.document);
    await act(async () => {
      await result.current.flush();
    });
    seen.push(result.current.document);
    act(() => result.current.change(SAMPLE_SCENE));
    await act(async () => {
      await result.current.flush();
    });
    seen.push(result.current.document);
    expect(seen.every((entry) => entry === doc)).toBe(true);
    expect(doc?.source.json).toBe(SAMPLE_SCENE);
  });

  it("relocate keeps the same handle; path updates", async () => {
    const { hook } = await setup();
    const { result } = hook;
    const source = result.current.document!.source;
    await act(async () => {
      await result.current.relocate("a.excalidraw", "moved.excalidraw");
    });
    expect(result.current.document?.path).toBe("moved.excalidraw");
    expect(result.current.document?.source).toBe(source);
  });

  it("open, reload, saveCopy and external reload each create a fresh handle", async () => {
    const { repo, hook } = await setup();
    const { result } = hook;
    const first = result.current.document!.source;

    await openPath(result, "b.excalidraw");
    const second = result.current.document!.source;
    expect(second).not.toBe(first);
    expect(second.json).toBe(BLANK_SCENE);

    await act(async () => {
      await result.current.reload();
    });
    const third = result.current.document!.source;
    expect(third).not.toBe(second);

    act(() => result.current.change(SAMPLE_SCENE));
    await act(async () => {
      await result.current.saveCopy("copy.excalidraw");
    });
    const fourth = result.current.document!.source;
    expect(fourth).not.toBe(third);
    expect(fourth.json).toBe(SAMPLE_SCENE);

    act(() => {
      repo.externalWrite("copy.excalidraw", BLANK_SCENE);
    });
    await waitFor(() =>
      expect(result.current.document?.source.json).toBe(BLANK_SCENE),
    );
    expect(result.current.document?.source).not.toBe(fourth);
  });

  it("an external write equal to the editor text keeps the handle current", async () => {
    const { repo, hook } = await setup();
    const { result } = hook;
    const source = result.current.document!.source;
    act(() => result.current.change(BLANK_SCENE));
    await act(async () => {
      await result.current.flush();
    });
    act(() => {
      repo.externalWrite("a.excalidraw", BLANK_SCENE);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(result.current.status).toBe("saved");
    expect(result.current.document?.source.json).toBe(BLANK_SCENE);
    expect(result.current.document?.source.json).toBe(
      (await repo.readDrawing(repo.handle, "a.excalidraw")).json,
    );
    expect(source.json).toBe(BLANK_SCENE);
  });
});

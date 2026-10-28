import { describe, expect, it, vi } from "vitest";

import { ControlError } from "./errors";
import {
  createUriRunner,
  VAULT_WAIT_MS,
  type AskSpec,
  type UriDeps,
  type UriPlan,
} from "./uriRun";

type Calls = [string, unknown][];

/** A fake window: a vault "DSA" open, "Notes" recent, drawings in `drawings`. */
const make = (
  over: Partial<UriDeps> = {},
  drawings = ["Graphs/BFS.excalidraw"],
) => {
  const calls: Calls = [];
  const asks: AskSpec[] = [];
  const notes: [string, string | undefined][] = [];
  let open: { name: string; path: string } | null = {
    name: "DSA",
    path: "/v/DSA",
  };
  let clock = 0;
  const deps: UriDeps = {
    call: async (method, params) => {
      calls.push([method, params]);
      const p = params as Record<string, any>;
      if (method === "file.open") {
        if (!drawings.includes(p.path)) {
          throw new ControlError("NOT_FOUND", `No such drawing ${p.path}`);
        }
        return { path: p.path, opened: true };
      }
      if (method === "file.create") {
        drawings.push(p.path);
        return { path: p.path };
      }
      if (method === "vault.open") {
        open = { name: p.path.split("/").pop(), path: p.path };
        return open;
      }
      return { ran: true };
    },
    vault: () => open,
    recentVaults: () => ["/v/DSA", "/v/Notes", "/old/Work", "/new/Work"],
    commandTitle: (id) =>
      id === "appearance.toggleMode"
        ? "Toggle mode"
        : id === "my.plugin.run"
        ? "Plugin run"
        : id === "config.resetOverrides"
        ? "Reset"
        : null,
    isBuiltin: (id) => id !== "my.plugin.run",
    isLinkable: (id) => id === "appearance.toggleMode",
    openSearch: vi.fn(),
    readExternal: async (path, kind) => ({
      name: path.split("/").pop() as string,
      json:
        kind === "library"
          ? '{"type":"excalidrawlib","libraryItems":[{"id":"a"},{"id":"b"}]}'
          : '{"type":"excalidraw","elements":[]}',
    }),
    exists: async (p) => drawings.includes(p),
    addLibrary: async () => {},
    canAddVaultLibrary: () => true,
    ask: (s) => asks.push(s),
    notify: (m, k) => notes.push([m, k]),
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    ...over,
  };
  return {
    run: (plan: Partial<UriPlan> & { action: UriPlan["action"] }) =>
      createUriRunner(deps).run(plan as UriPlan),
    calls,
    asks,
    notes,
    deps,
    setOpen: (v: typeof open) => (open = v),
  };
};

const names = (calls: Calls) => calls.map(([m]) => m);

describe("uriRun: what runs at once", () => {
  it("opens a drawing without asking (extension added)", async () => {
    const t = make();
    expect(await t.run({ action: "open", file: "Graphs/BFS" })).toEqual({
      status: "done",
    });
    expect(t.calls).toEqual([
      ["file.open", { path: "Graphs/BFS.excalidraw", newTab: false }],
    ]);
    expect(t.asks).toEqual([]);
  });

  it("passes newTab through", async () => {
    const t = make();
    await t.run({
      action: "open",
      file: "Graphs/BFS.excalidraw",
      newTab: true,
    });
    expect(t.calls[0][1]).toEqual({
      path: "Graphs/BFS.excalidraw",
      newTab: true,
    });
  });

  it("search fills the vault search and runs nothing else", async () => {
    const t = make();
    await t.run({ action: "search", query: "dijkstra" });
    expect(t.deps.openSearch).toHaveBeenCalledWith("dijkstra");
    expect(t.calls).toEqual([]);
    expect(t.asks).toEqual([]);
  });

  it("focus and notice never ask; a notice reaches the user", async () => {
    const t = make();
    expect(await t.run({ action: "focus" })).toEqual({ status: "done" });
    await t.run({ action: "notice", message: "Links are off" });
    expect(t.notes).toEqual([["Links are off", undefined]]);
    expect(t.asks).toEqual([]);
  });

  it("a missing drawing is a NOT_FOUND error with a toast", async () => {
    const t = make();
    await expect(t.run({ action: "open", file: "Nope" })).rejects.toMatchObject(
      {
        code: "NOT_FOUND",
      },
    );
    expect(t.notes[0][1]).toBe("error");
  });
});

describe("uriRun: what asks first", () => {
  it("new asks, creates and opens only after Create", async () => {
    const t = make();
    const r = await t.run({ action: "new", path: "Idea", allowed: false });
    expect(r).toEqual({ status: "asking" });
    expect(t.asks).toHaveLength(1);
    expect(t.asks[0].confirmLabel).toBe("Create");
    expect(t.asks[0].details).toEqual(['Create the drawing "Idea.excalidraw"']);
    // The existence probe is the only call so far: nothing was written.
    expect(names(t.calls)).toEqual(["file.open"]);
    t.asks[0].onConfirm();
    await vi.waitFor(() => expect(names(t.calls)).toContain("file.create"));
    await vi.waitFor(() => expect(t.calls.at(-1)![0]).toBe("file.open"));
    expect(t.calls.find(([m]) => m === "file.create")![1]).toEqual({
      path: "Idea.excalidraw",
    });
  });

  it("security: new on an existing drawing only opens it and never creates", async () => {
    const t = make();
    expect(
      await t.run({ action: "new", path: "Graphs/BFS", allowed: false }),
    ).toEqual({ status: "done" });
    expect(names(t.calls)).toEqual(["file.open"]);
    expect(t.asks).toEqual([]);
  });

  it("security: nothing is written while the modal is unanswered or cancelled", async () => {
    const t = make();
    await t.run({ action: "new", path: "Idea", allowed: false });
    await t.run({ action: "cmd", id: "appearance.toggleMode", allowed: false });
    await t.run({
      action: "open",
      vault: "Notes",
      file: "x",
      allowSwitch: false,
    });
    expect(t.asks).toHaveLength(3);
    expect(names(t.calls).filter((m) => m !== "file.open")).toEqual([]);
  });

  it("new runs at once when allowed (control.uri_allow)", async () => {
    const t = make();
    await t.run({ action: "new", path: "Idea", allowed: true });
    expect(t.asks).toEqual([]);
    expect(names(t.calls)).toEqual(["file.open", "file.create", "file.open"]);
  });

  it("new in a read-only vault surfaces the READ_ONLY error", async () => {
    const t = make({
      call: async (m) => {
        if (m === "file.open") {
          throw new ControlError("NOT_FOUND", "no");
        }
        throw new ControlError("READ_ONLY", "The vault is read-only");
      },
    });
    await expect(
      t.run({ action: "new", path: "Idea", allowed: true }),
    ).rejects.toMatchObject({ code: "READ_ONLY" });
    expect(t.notes.at(-1)).toEqual(["The vault is read-only", "error"]);
  });

  it("cmd asks with the title and id, then runs command.run", async () => {
    const t = make();
    const r = await t.run({
      action: "cmd",
      id: "appearance.toggleMode",
      allowed: false,
    });
    expect(r.status).toBe("asking");
    expect(t.asks[0].details).toEqual([
      'Run the command "Toggle mode" (appearance.toggleMode)',
    ]);
    expect(t.calls).toEqual([]);
    t.asks[0].onConfirm();
    await vi.waitFor(() =>
      expect(t.calls).toEqual([
        ["command.run", { id: "appearance.toggleMode" }],
      ]),
    );
  });

  it("cmd runs at once when allowed; an unknown command is refused before asking", async () => {
    const t = make();
    await t.run({ action: "cmd", id: "appearance.toggleMode", allowed: true });
    expect(t.asks).toEqual([]);
    expect(names(t.calls)).toEqual(["command.run"]);
    await expect(
      t.run({ action: "cmd", id: "no.such", allowed: false }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(t.asks).toEqual([]);
  });

  it("modal text is plain text; a long value keeps its start and its end", async () => {
    const t = make();
    await t.run({
      action: "new",
      path: `<img src=x onerror=alert(1)>${"a".repeat(800)}/the-end`,
      allowed: false,
    });
    const line = t.asks[0].details[0];
    expect(line.endsWith('/the-end.excalidraw"')).toBe(true);
    expect(line.startsWith('Create the drawing "<img src=x')).toBe(true);
    expect(line.length).toBeLessThan(460);
    expect(line).toContain("…");
  });
});

describe("uriRun: commands and a changing vault", () => {
  it("security: a plugin command is refused unless its exact id is allowed", async () => {
    const t = make();
    await expect(
      t.run({ action: "cmd", id: "my.plugin.run", allowed: false }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    expect(t.asks).toEqual([]);
    expect(t.calls).toEqual([]);
    expect(t.notes[0][0]).toContain("built-in");
    // Listed in control.uri_allow: the user's own choice, so it runs unasked.
    await t.run({ action: "cmd", id: "my.plugin.run", allowed: true });
    expect(names(t.calls)).toEqual(["command.run"]);
  });

  it("security: a built-in command that did not opt in is refused unless its exact id is allowed", async () => {
    const t = make();
    await expect(
      t.run({ action: "cmd", id: "config.resetOverrides", allowed: false }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    expect(t.asks).toEqual([]);
    expect(t.calls).toEqual([]);
    expect(t.notes[0][0]).toContain("not link-callable");
    await t.run({ action: "cmd", id: "config.resetOverrides", allowed: true });
    expect(names(t.calls)).toEqual(["command.run"]);
  });

  it("security: a queued question does not run in a vault the user switched to", async () => {
    const t = make();
    await t.run({ action: "cmd", id: "appearance.toggleMode", allowed: false });
    t.setOpen({ name: "Notes", path: "/v/Notes" });
    t.asks[0].onConfirm();
    await vi.waitFor(() => expect(t.notes.at(-1)![1]).toBe("error"));
    expect(t.notes.at(-1)![0]).toContain("vault changed");
    expect(t.calls).toEqual([]);
  });

  it("a switch that already happened is not repeated at confirm time", async () => {
    const t = make({}, ["x.excalidraw"]);
    await t.run({
      action: "open",
      vault: "Notes",
      file: "x",
      allowSwitch: false,
    });
    t.setOpen({ name: "Notes", path: "/v/Notes" });
    t.asks[0].onConfirm();
    await vi.waitFor(() => expect(names(t.calls)).toEqual(["file.open"]));
  });
});

describe("uriRun: vault names", () => {
  it("the open vault by name needs no switch (case-insensitive)", async () => {
    const t = make();
    await t.run({ action: "open", vault: "dsa", file: "Graphs/BFS" });
    expect(t.asks).toEqual([]);
    expect(names(t.calls)).toEqual(["file.open"]);
  });

  it("another recent vault asks before switching, then opens the drawing", async () => {
    const t = make({}, ["Graphs/BFS.excalidraw", "x.excalidraw"]);
    const r = await t.run({
      action: "open",
      vault: "Notes",
      file: "x",
      allowSwitch: false,
    });
    expect(r.status).toBe("asking");
    expect(t.asks[0].confirmLabel).toBe("Switch");
    expect(t.asks[0].details).toEqual(['Switch to the vault "Notes"']);
    expect(t.calls).toEqual([]);
    t.asks[0].onConfirm();
    await vi.waitFor(() =>
      expect(names(t.calls)).toEqual(["vault.open", "file.open"]),
    );
    expect(t.calls[0][1]).toEqual({ path: "/v/Notes" });
  });

  it("switching is silent when allowSwitch is set", async () => {
    const t = make({}, ["x.excalidraw"]);
    expect(
      await t.run({
        action: "open",
        vault: "Notes",
        file: "x",
        allowSwitch: true,
      }),
    ).toEqual({ status: "done" });
    expect(names(t.calls)).toEqual(["vault.open", "file.open"]);
  });

  it("a vault-only link only switches", async () => {
    const t = make();
    await t.run({ action: "open", vault: "Notes", allowSwitch: true });
    expect(names(t.calls)).toEqual(["vault.open"]);
  });

  it("security: an unknown vault name does nothing, even a path-like one", async () => {
    const t = make();
    for (const vault of ["Nope", "/Users/x/Secret", "../x"]) {
      await expect(
        t.run({ action: "open", vault, file: "a", allowSwitch: true }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(t.calls).toEqual([]);
    expect(t.asks).toEqual([]);
    expect(t.notes[0][0]).toContain("among your recent vaults");
  });

  it("two vaults with the same name: refused, not guessed", async () => {
    const t = make();
    await expect(
      t.run({ action: "open", vault: "Work", file: "a", allowSwitch: true }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(t.calls).toEqual([]);
  });

  it("new in another vault asks once for both the switch and the creation", async () => {
    const t = make();
    await t.run({
      action: "new",
      vault: "Notes",
      path: "Idea",
      allowed: false,
      allowSwitch: false,
    });
    expect(t.asks).toHaveLength(1);
    expect(t.asks[0].confirmLabel).toBe("Continue");
    expect(t.asks[0].details).toHaveLength(2);
    expect(t.calls).toEqual([]);
  });

  it("new in another vault: the switch alone may be pre-approved but the creation still asks", async () => {
    const t = make();
    await t.run({
      action: "new",
      vault: "Notes",
      path: "Idea",
      allowed: false,
      allowSwitch: true,
    });
    expect(t.asks).toHaveLength(1);
    expect(t.calls).toEqual([]);
  });
});

describe("uriRun: cold start", () => {
  it("waits for the vault to load, then runs", async () => {
    const t = make();
    t.setOpen(null);
    let polls = 0;
    const deps = {
      ...t.deps,
      vault: () => (polls++ > 3 ? { name: "DSA", path: "/v/DSA" } : null),
    };
    const r = await createUriRunner(deps).run({
      action: "open",
      file: "Graphs/BFS",
    } as UriPlan);
    expect(r.status).toBe("done");
    expect(t.calls[0][0]).toBe("file.open");
  });

  it("gives up after the wait with NO_VAULT and a toast", async () => {
    const t = make();
    t.setOpen(null);
    let slept = 0;
    const deps = {
      ...t.deps,
      sleep: async (ms: number) => {
        slept += ms;
      },
    };
    // `now` follows the sleeps.
    let clock = 0;
    deps.now = () => clock;
    deps.sleep = async (ms) => {
      clock += ms;
      slept += ms;
    };
    await expect(
      createUriRunner(deps).run({ action: "open", file: "a" } as UriPlan),
    ).rejects.toMatchObject({ code: "NO_VAULT" });
    expect(slept).toBeGreaterThanOrEqual(VAULT_WAIT_MS);
    expect(slept).toBeLessThan(VAULT_WAIT_MS + 200);
    expect(t.notes[0]).toEqual(["No vault is open", "error"]);
  });

  it("an unknown action is rejected", async () => {
    const t = make();
    await expect(t.run({ action: "delete" as never })).rejects.toBeInstanceOf(
      ControlError,
    );
  });
});

describe("uriRun: files from the system", () => {
  const file = (path: string, kind: "drawing" | "library" = "drawing") => ({
    action: "file" as const,
    path,
    kind,
  });
  const click = (spec: AskSpec, label?: string) =>
    (label
      ? spec.alternatives!.find((a) => a.label === label)!.run
      : spec.onConfirm)();
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("opens a file in the open vault at once, with the path inside the vault", async () => {
    const t = make({}, ["Graphs/BFS.excalidraw"]);
    expect(await t.run(file("/v/DSA/Graphs/BFS.excalidraw"))).toEqual({
      status: "done",
    });
    expect(t.calls).toEqual([
      ["file.open", { path: "Graphs/BFS.excalidraw", newTab: false }],
    ]);
    expect(t.asks).toEqual([]);
  });

  it("resolves dot segments before deciding where a file is", async () => {
    const t = make({}, ["Graphs/BFS.excalidraw"]);
    await t.run(file("/v/DSA/x/../Graphs/./BFS.excalidraw"));
    expect(names(t.calls)).toEqual(["file.open"]);
    const out = make();
    await out.run(file("/v/DSA/../Other/a.excalidraw"));
    expect(out.asks).toHaveLength(1);
    expect(out.calls).toEqual([]);
  });

  it("a file in another recent vault asks before switching", async () => {
    const t = make({}, ["a.excalidraw"]);
    expect(await t.run(file("/v/Notes/a.excalidraw"))).toEqual({
      status: "asking",
    });
    expect(t.calls).toEqual([]);
    click(t.asks[0]);
    await settle();
    expect(t.calls).toEqual([
      ["vault.open", { path: "/v/Notes" }],
      ["file.open", { path: "a.excalidraw", newTab: false }],
    ]);
  });

  it("outside every vault: three choices, nothing happens unanswered", async () => {
    const t = make();
    expect(await t.run(file("/tmp/dl/Idea.excalidraw"))).toEqual({
      status: "asking",
    });
    expect(t.calls).toEqual([]);
    const [spec] = t.asks;
    expect(spec.confirmLabel).toBe("Copy into vault");
    expect(spec.alternatives!.map((a) => a.label)).toEqual([
      "Open its folder as a vault",
    ]);
    expect(spec.details).toEqual(["/tmp/dl/Idea.excalidraw"]);
  });

  it("Copy into vault creates a new drawing from the file and opens it", async () => {
    const t = make();
    await t.run(file("/tmp/dl/Idea.excalidraw"));
    click(t.asks[0]);
    await settle();
    expect(t.calls).toEqual([
      [
        "file.create",
        {
          path: "Idea.excalidraw",
          scene: { type: "excalidraw", elements: [] },
        },
      ],
      ["file.open", { path: "Idea.excalidraw", newTab: false }],
    ]);
  });

  it("Copy never overwrites: a taken name gets a number", async () => {
    const t = make({}, ["Idea.excalidraw", "Idea 2.excalidraw"]);
    await t.run(file("/tmp/dl/Idea.excalidraw"));
    click(t.asks[0]);
    await settle();
    expect(t.calls[0][1]).toMatchObject({ path: "Idea 3.excalidraw" });
  });

  it("Copy is cancelled when the vault changed while the question waited", async () => {
    const t = make();
    await t.run(file("/tmp/dl/Idea.excalidraw"));
    t.setOpen({ name: "Other", path: "/v/Other" });
    click(t.asks[0]);
    await settle();
    expect(t.calls).toEqual([]);
    expect(t.notes.some(([m, k]) => /changed/.test(m) && k === "error")).toBe(
      true,
    );
  });

  it("Open its folder as a vault switches to the folder, then opens the file", async () => {
    const t = make();
    await t.run(file("/tmp/dl/Idea.excalidraw"));
    click(t.asks[0], "Open its folder as a vault");
    await settle();
    expect(t.calls).toEqual([
      ["vault.open", { path: "/tmp/dl" }],
      ["file.open", { path: "Idea.excalidraw", newTab: false }],
    ]);
  });

  it("with no vault open the only choice is the folder", async () => {
    const t = make();
    t.setOpen(null);
    await t.run(file("/tmp/dl/Idea.excalidraw"));
    expect(t.asks[0].confirmLabel).toBe("Open its folder as a vault");
    expect(t.asks[0].alternatives).toBeUndefined();
  });

  it("a relative path is refused", async () => {
    const t = make();
    await expect(t.run(file("a.excalidraw"))).rejects.toMatchObject({
      code: "INVALID_PARAMS",
    });
  });

  it("a library asks with the item count, default the personal library", async () => {
    const add = vi.fn(async () => {});
    const t = make({ addLibrary: add });
    expect(await t.run(file("/tmp/x/shapes.excalidrawlib", "library"))).toEqual(
      { status: "asking" },
    );
    expect(add).not.toHaveBeenCalled();
    const [spec] = t.asks;
    expect(spec.title).toBe("Add 2 items to the library?");
    expect(spec.confirmLabel).toBe("Add to my library");
    click(spec);
    await settle();
    expect(add).toHaveBeenCalledWith(expect.any(String), "personal");
  });

  it("the vault library is a second choice, only when it can take items", async () => {
    const add = vi.fn(async () => {});
    const t = make({ addLibrary: add });
    await t.run(file("/tmp/x/shapes.excalidrawlib", "library"));
    click(t.asks[0], "Add to this vault's library");
    await settle();
    expect(add).toHaveBeenCalledWith(expect.any(String), "vault");
    const ro = make({ canAddVaultLibrary: () => false });
    await ro.run(file("/tmp/x/shapes.excalidrawlib", "library"));
    expect(ro.asks[0].alternatives).toBeUndefined();
  });

  it("an unreadable file tells the user and fails", async () => {
    const t = make({
      readExternal: async () => {
        throw new Error("The file is not valid UTF-8");
      },
    });
    await expect(
      t.run(file("/tmp/x/bad.excalidrawlib", "library")),
    ).rejects.toThrow("UTF-8");
    expect(t.notes[0]).toEqual(["The file is not valid UTF-8", "error"]);
    expect(t.asks).toEqual([]);
  });
});

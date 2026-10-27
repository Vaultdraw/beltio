import { describe, expect, it, vi } from "vitest";

import { FakeNoteFiles } from "./FakeNoteFiles";
import { NoteConflictError } from "./noteFiles";
import { NoteSaver } from "./noteSaver";

const setup = async (delay = 50) => {
  const files = new FakeNoteFiles({ "n.md": "one" });
  const first = await files.read("h", "n.md");
  const statuses: string[] = [];
  const timers: (() => void)[] = [];
  const saver = new NoteSaver(
    {
      write: (c, r) => files.write("h", "n.md", c, r),
      delayMs: () => delay,
      onStatus: (s) => statuses.push(s),
      setTimer: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      clearTimer: () => {},
    },
    { text: first.content, revision: first.revision },
  );
  return { files, saver, statuses, timers };
};

describe("NoteSaver", () => {
  it("writes after the delay, with the revision it read", async () => {
    const { files, saver, statuses, timers } = await setup();
    saver.change("two");
    expect(statuses).toEqual(["dirty"]);
    expect(files.text("n.md")).toBe("one");
    timers.at(-1)!();
    await saver.flush();
    expect(files.text("n.md")).toBe("two");
    expect(saver.state).toBe("saved");
  });

  it("only an explicit save when the delay is 0", async () => {
    const { files, saver, timers } = await setup(0);
    saver.change("two");
    expect(timers).toHaveLength(0);
    await saver.flush();
    expect(files.text("n.md")).toBe("two");
  });

  it("typing back to the saved text is saved again without a write", async () => {
    const { files, saver } = await setup();
    saver.change("two");
    saver.change("one");
    expect(saver.state).toBe("saved");
    await saver.flush();
    expect(files.writes).toHaveLength(0);
  });

  it("a change on disk stops saving and never overwrites", async () => {
    const { files, saver } = await setup();
    files.externalWrite("n.md", "theirs");
    saver.change("mine");
    await saver.flush();
    expect(saver.state).toBe("conflict");
    expect(files.text("n.md")).toBe("theirs");
    saver.change("mine 2");
    await saver.flush();
    expect(files.text("n.md")).toBe("theirs");
  });

  it("keep mine adopts the disk revision and writes", async () => {
    const { files, saver } = await setup();
    files.externalWrite("n.md", "theirs");
    saver.change("mine");
    await saver.flush();
    const disk = await files.read("h", "n.md");
    saver.adoptRevision(disk.revision);
    await saver.flush();
    expect(files.text("n.md")).toBe("mine");
    expect(saver.state).toBe("saved");
  });

  it("rebase takes the disk text as the new base", async () => {
    const { files, saver } = await setup();
    files.externalWrite("n.md", "theirs");
    saver.change("mine");
    await saver.flush();
    const disk = await files.read("h", "n.md");
    saver.rebase(disk.content, disk.revision);
    expect(saver.state).toBe("saved");
    saver.change("theirs plus");
    await saver.flush();
    expect(files.text("n.md")).toBe("theirs plus");
  });

  it("text typed while a write runs is written next", async () => {
    const { files, saver } = await setup(0);
    saver.change("a");
    const p = saver.flush();
    saver.change("ab");
    await p;
    await saver.flush();
    expect(files.text("n.md")).toBe("ab");
  });

  it("reports a failed write", async () => {
    const onStatus = vi.fn();
    const saver = new NoteSaver(
      {
        write: () => Promise.reject(new Error("disk full")),
        delayMs: () => 0,
        onStatus,
      },
      { text: "a", revision: "r" },
    );
    saver.change("b");
    await saver.flush();
    expect(onStatus).toHaveBeenLastCalledWith("error", "disk full");
    expect(NoteConflictError).toBeDefined();
  });
});

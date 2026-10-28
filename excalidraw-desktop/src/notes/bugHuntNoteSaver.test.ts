import { describe, expect, it } from "vitest";

import { FakeNoteFiles } from "./FakeNoteFiles";
import { NoteSaver } from "./noteSaver";

/**
 * Bug hunt round 2: two explicit saves (Cmd+E, blur, quit) arriving while a
 * write is in flight must not make the note conflict with itself.
 */
describe("bug hunt: concurrent flush while a write is running", () => {
  it("does not report a conflict against the user's own write", async () => {
    const files = new FakeNoteFiles();
    files.setOnDisk("n.md", "one");
    const first = await files.read("h", "n.md");
    const gates: (() => void)[] = [];
    const saver = new NoteSaver(
      {
        write: async (c, r) => {
          await new Promise<void>((res) => gates.push(res));
          return files.write("h", "n.md", c, r);
        },
        delayMs: () => 0,
        onStatus: () => {},
      },
      { text: first.content, revision: first.revision },
    );
    saver.change("two");
    const a = saver.flush(); // write 1 in flight
    saver.change("three"); // typed during the write
    const b = saver.flush(); // e.g. leaving edit mode
    const c = saver.flush(); // e.g. the window closing
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
      gates.splice(0).forEach((g) => g());
    }
    await Promise.all([a, b, c]);
    expect(saver.state).toBe("saved");
    expect(files.textOf("n.md")).toBe("three");
  });
});

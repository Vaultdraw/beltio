import { describe, expect, it } from "vitest";

import { taskLines, toggleTask } from "./noteTasks";

describe("taskLines", () => {
  it("finds tasks in order, skipping code and front matter", () => {
    const text = [
      "---",
      "a:",
      "  - [ ] not a task",
      "---",
      "- [ ] one",
      "```",
      "- [ ] in code",
      "```",
      "1. [x] two",
      "> - [X] quoted",
      "- [ ]no space",
      "text [ ] here",
    ].join("\n");
    expect(taskLines(text)).toEqual([4, 8, 9]);
  });
});

describe("toggleTask", () => {
  const text = "- [ ] a\n- [x] b\r\n* [ ] c";
  it("ticks and unticks one line only", () => {
    expect(toggleTask(text, 0)).toBe("- [x] a\n- [x] b\r\n* [ ] c");
    expect(toggleTask(text, 1)).toBe("- [ ] a\n- [ ] b\r\n* [ ] c");
  });
  it("returns null for a missing task", () => {
    expect(toggleTask(text, 3)).toBeNull();
  });
});

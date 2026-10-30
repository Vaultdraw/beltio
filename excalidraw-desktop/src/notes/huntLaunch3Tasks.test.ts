import { describe, expect, it } from "vitest";

import { taskLines, toggleTask } from "./noteTasks";

const crlf = (s: string) => s.replace(/\n/g, "\r\n");

describe("launch hunter 3: ticking a task in odd files", () => {
  const body =
    "# T\n\n- [ ] one\n- [ ] two\n\n> - [ ] quoted\n\n1. [ ] ordered\n";
  it("CRLF note without front matter", () => {
    const t = crlf(body);
    expect(taskLines(t)).toEqual(taskLines(body));
    const out = toggleTask(t, 1)!;
    expect(out).toContain("- [x] two\r\n");
    expect(out.replace(/\r\n/g, "\n")).toBe(
      body.replace("- [ ] two", "- [x] two"),
    );
  });
  it("CRLF note with front matter", () => {
    const t = crlf(`---\ntitle: a\ntags: [x]\n---\n${body}`);
    const out = toggleTask(t, 0)!;
    expect(out).toContain("- [x] one\r\n");
    expect(out).toContain("- [ ] two");
  });
  it("a byte order mark and front matter", () => {
    const t = `﻿---\ntitle: a\n---\n${body}`;
    const out = toggleTask(t, 0);
    expect(out).not.toBeNull();
    expect(out!.startsWith("﻿---")).toBe(true);
    expect(out).toContain("- [x] one");
  });
  it("the same task text twice ticks the right one", () => {
    const t = "- [ ] same\n- [ ] same\n";
    expect(toggleTask(t, 1)).toBe("- [ ] same\n- [x] same\n");
  });
  it("front matter that looks like a task list", () => {
    const t = "---\nlist:\n  - [ ] not a task\n---\n- [ ] real\n";
    expect(taskLines(t).length).toBe(1);
    expect(toggleTask(t, 0)).toBe(
      "---\nlist:\n  - [ ] not a task\n---\n- [x] real\n",
    );
  });
  it("a task inside a callout and under a nested list", () => {
    const t =
      "> [!note] Title\n> - [ ] in callout\n\n- a\n  - [ ] nested\n    - [ ] deeper\n";
    expect(taskLines(t).length).toBe(3);
    expect(toggleTask(t, 2)).toContain("    - [x] deeper");
  });
});

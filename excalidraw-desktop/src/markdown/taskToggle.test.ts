import { describe, expect, it } from "vitest";

import {
  toggleFirstTask,
  toggleTaskAt,
  toggleTaskInTextarea,
} from "./taskToggle";

describe("Markdown: Toggle task", () => {
  it("toggles the caret's line only", () => {
    const v = "☐ a\n☐ b\n☐ c";
    expect(toggleTaskAt(v, 5)).toBe("☐ a\n☑ b\n☐ c");
    expect(toggleTaskAt("• not a task", 3)).toBeNull();
  });

  it("toggles the first task line of a selected text", () => {
    expect(toggleFirstTask("Shopping\n☐ milk\n☐ eggs")).toBe(
      "Shopping\n☑ milk\n☐ eggs",
    );
    expect(toggleFirstTask("no tasks\nhere")).toBeNull();
    expect(toggleFirstTask("")).toBeNull();
  });

  it("edits a live textarea through its input event, keeping the caret", () => {
    const ta = document.createElement("textarea");
    ta.value = "☑ done";
    ta.setSelectionRange(4, 4);
    let inputs = 0;
    ta.addEventListener("input", () => inputs++);
    expect(toggleTaskInTextarea(ta)).toBe(true);
    expect(ta.value).toBe("☐ done");
    expect(ta.selectionStart).toBe(4);
    expect(inputs).toBe(1);
  });
});

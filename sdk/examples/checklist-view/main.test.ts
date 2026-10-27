import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { readExample } from "../testing/readManifest";

import plugin from "./main.js";

const PATH = "Lists/groceries.checklist.md";
const TEXT = "# Groceries\n- [ ] milk\n- [x] eggs\nnot a box\n";
let p: TestPlugin | undefined;

afterEach(async () => {
  await p?.dispose();
  p = undefined;
});

describe("checklist-view", () => {
  it("declares the view and loads no code until a note of its type opens", async () => {
    const activate = vi.spyOn(plugin, "activate");
    p = await boot(readExample("checklist-view"), plugin);
    expect(p.info.contributes.views).toEqual([
      { id: "checklist", title: "Checklist", extensions: ["checklist.md"] },
    ]);
    expect(activate).not.toHaveBeenCalled();
  });

  it("the open command asks the app to show the list in the main pane", async () => {
    p = await boot(readExample("checklist-view"), plugin);
    await p.run("open");
    expect(p.workspace.opened()).toEqual([
      { path: "Groceries.checklist.md", newTab: false },
    ]);
    await p.setSetting("list", "Lists/other.checklist.md");
    await p.run("open");
    expect(p.workspace.opened().at(-1)?.path).toBe("Lists/other.checklist.md");
    expect(p.log().filter((l) => l.level === "error")).toEqual([]);
  });

  it("open refuses a note the view does not claim, and an unknown id", async () => {
    const failures: string[] = [];
    const record = (e: { code: string }) => void failures.push(e.code);
    p = await boot(readExample("checklist-view"), {
      async activate(ctx) {
        ctx.views.register("checklist", () => null);
        ctx.commands.register("open", async () => {
          for (const args of [
            ["checklist", { path: "plain.md" }],
            ["checklist", {}],
            ["nope", {}],
          ] as const) {
            await ctx.views.open(args[0], args[1]).catch(record);
          }
        });
      },
    });
    await p.run("open");
    expect(failures).toEqual([
      "INVALID_ARGUMENT",
      "INVALID_ARGUMENT",
      "INVALID_ARGUMENT",
    ]);
  });

  it("shows the boxes and a click saves the note with the revision it read", async () => {
    p = await boot(readExample("checklist-view"), plugin);
    p.notes.seed(PATH, TEXT);
    await p.openView(PATH);
    const milk = await screen.findByLabelText("milk");
    expect(milk).not.toBeChecked();
    expect(screen.getByLabelText("eggs")).toBeChecked();
    fireEvent.click(milk);
    await p.flush();
    expect(p.notes.text(PATH)).toBe(
      "# Groceries\n- [x] milk\n- [x] eggs\nnot a box\n",
    );
    expect(screen.getByLabelText("milk")).toBeChecked();
  });

  it("a change made elsewhere is never overwritten: the view reloads instead", async () => {
    p = await boot(readExample("checklist-view"), plugin);
    p.notes.seed(PATH, TEXT);
    await p.openView(PATH);
    const milk = await screen.findByLabelText("milk");
    p.notes.seed(PATH, "- [ ] milk\n- [ ] eggs\n- [ ] new\n");
    fireEvent.click(milk);
    await p.flush();
    expect(p.notes.text(PATH)).toBe("- [ ] milk\n- [ ] eggs\n- [ ] new\n");
    expect(await screen.findByLabelText("new")).toBeInTheDocument();
  });
});

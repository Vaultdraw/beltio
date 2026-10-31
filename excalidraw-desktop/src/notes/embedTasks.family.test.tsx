// @vitest-environment jsdom
/**
 * Family "task line mapping": the Nth checkbox drawn is the Nth task line of the file that wrote
 * it. A whole-note embed (`![[Plan]]`) ticks its own file (toimprove 267, done). A SECTION embed
 * (`![[Plan#Steps]]`) or BLOCK embed (`![[Plan#^id]]`) draws only part of the file, so its boxes
 * stay greyed out (NoteView.tsx `embedOf`). Obsidian ticks them and writes the embedded file.
 * `it.fails` rows turn red when it is fixed (toimprove 319).
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { updatePreferences } from "../vault/preferences";

import { FakeNoteFiles } from "./FakeNoteFiles";
import { setNoteFiles } from "./noteBackend";
import NoteView from "./NoteView";

Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.scrollIntoView = () => {};

const PLAN =
  "# Plan\n\n- [ ] top task\n\n## Steps\n\n- [ ] step one\n- [ ] step two\n\n## Later\n\n- [ ] later task\n";
const vault = {
  handle: "h",
  paths: () => ["Host.md", "Plan.md"] as readonly string[],
};
let files: FakeNoteFiles;

beforeEach(() => {
  files = new FakeNoteFiles();
  files.setOnDisk("Plan.md", PLAN);
  setNoteFiles(files);
  updatePreferences({
    notesOpenIn: "reading",
    notesVim: false,
    notesToggleTasks: true,
  });
});
afterEach(() => {
  cleanup();
  setNoteFiles(null);
});

const open = async (host: string) => {
  files.setOnDisk("Host.md", host);
  render(<NoteView path="Host.md" openPath={() => undefined} vault={vault} />);
  const reading = await screen.findByTestId("note-reading");
  await waitFor(() =>
    expect(reading.querySelector(".note-embed-body")).not.toBeNull(),
  );
  return reading;
};

const rows: {
  name: string;
  host: string;
  label: string;
  after: string;
  broken?: boolean;
}[] = [
  {
    name: "a whole-note embed",
    host: "![[Plan]]\n",
    label: "step two",
    after: "- [x] step two",
  },
  {
    name: "a section embed",
    host: "![[Plan#Steps]]\n",
    label: "step two",
    after: "- [x] step two",
    broken: true,
  },
  {
    name: "a block embed",
    host: "- [ ] block task ^b1\n\n![[Plan#^b1]]\n",
    label: "block task",
    after: "- [x] block task",
    broken: true,
  },
];

type Row = typeof rows[number];

const tick = async (r: Row) => {
  if (r.name === "a block embed") {
    files.setOnDisk("Plan.md", "Intro\n\n- [ ] block task ^b1\n- [ ] other\n");
  }
  const reading = await open(r.host);
  const box = [
    ...reading.querySelectorAll<HTMLInputElement>(
      ".note-embed-body input[type=checkbox]",
    ),
  ].find((b) => (b.closest("li")?.textContent ?? "").includes(r.label));
  expect(box, "the embedded box is drawn").toBeDefined();
  expect(box!.disabled, "the box is enabled").toBe(false);
  fireEvent.click(box!);
  await waitFor(async () => {
    const read = await files.read("h", "Plan.md");
    expect(read.content).toContain(r.after);
  });
};

describe("a task inside an embed is ticked in the file that wrote it", () => {
  for (const r of rows) {
    (r.broken ? it.fails : it)(r.name, () => tick(r));
  }
});

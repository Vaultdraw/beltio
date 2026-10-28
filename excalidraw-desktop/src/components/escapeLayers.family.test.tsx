import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SaveTemplateModal } from "../templates/SaveTemplateModal";

import { ConfirmModal } from "./ConfirmModal";
import { Dialog } from "./Dialog";
import { escapeDepth } from "./escapeLayers";
import RenameTagDialog from "./tags/RenameTagDialog";

import type { ReactNode } from "react";

/**
 * Family sweep (bug hunt BH-14): every modal that closes on Escape. Alone, Escape closes it;
 * with a confirm opened over it, Escape closes only the confirm (VS Code, Obsidian). One row
 * per modal kind; a new modal adds a row (and the guard below makes sure it uses the stack).
 */
const members: [string, (onClose: () => void) => ReactNode][] = [
  [
    "Dialog",
    (onClose) => (
      <Dialog title="Community plugins" titleId="t" onClose={onClose}>
        body
      </Dialog>
    ),
  ],
  [
    "ConfirmModal",
    (onClose) => (
      <ConfirmModal
        title="Delete?"
        message="m"
        confirmLabel="Delete"
        onCancel={onClose}
        onConfirm={() => {}}
      />
    ),
  ],
  [
    "Save as template",
    (onClose) => (
      <SaveTemplateModal
        defaultName="Sketch"
        ownerDocument={document}
        onSave={async () => {}}
        onCancel={onClose}
        readOnlyVault={false}
      />
    ),
  ],
  [
    "Rename tag",
    (onClose) => (
      <RenameTagDialog
        api={{ plan: vi.fn(), rename: vi.fn() }}
        handle="h"
        tags={() => []}
        initial={null}
        onConfirm={async () => {}}
        onCancel={onClose}
        ownerDocument={document}
      />
    ),
  ],
];

const escape = () =>
  act(() => {
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
  });

describe.each(members)("%s and Escape", (_name, make) => {
  it("alone: Escape closes it", () => {
    const close = vi.fn();
    const r = render(<>{make(close)}</>);
    escape();
    expect(close).toHaveBeenCalledTimes(1);
    r.unmount();
    expect(escapeDepth()).toBe(0);
  });

  it("under a confirm: Escape closes only the confirm, the next one closes it", () => {
    const below = vi.fn();
    const top = vi.fn();
    const r = render(<>{make(below)}</>);
    r.rerender(
      <>
        {make(below)}
        <ConfirmModal
          title="Uninstall X?"
          message="m"
          confirmLabel="Uninstall"
          onCancel={top}
          onConfirm={() => {}}
        />
      </>,
    );
    escape();
    expect(top).toHaveBeenCalledTimes(1);
    expect(below).not.toHaveBeenCalled();
    r.rerender(<>{make(below)}</>);
    escape();
    expect(below).toHaveBeenCalledTimes(1);
    r.unmount();
    expect(escapeDepth()).toBe(0);
  });
});

/** Files with a document Escape listener that is not a modal layer, each with its reason. */
const NOT_MODAL: Record<string, string> = {
  "commands/dispatcher.ts": "the key dispatcher itself",
  "components/menu/ContextMenu.tsx":
    "menus close on outside keys; menus over dialogs are their own popup",
  "components/readonly/ReadOnlyBadge.tsx": "popover",
  "components/settings/pages/Hotkeys.tsx":
    "key capture while recording a binding",
  "components/tree/useTreeDrag.ts": "Escape cancels a drag",
  "editor/links/wikiAutocomplete.ts": "autocomplete popup inside the editor",
  "history/panel/PreviewOverlay.tsx":
    "yields to anything that handled Escape (defaultPrevented)",
  "tabs/TabContextMenu.tsx": "menu",
  "tabs/useStripDrag.ts": "Escape cancels a drag",
};

describe("Escape listeners", () => {
  it("every modal Escape listener goes through escapeLayers", () => {
    const SRC = join(__dirname, "..");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory()
          ? walk(full)
          : /\.tsx?$/.test(name) && !/\.test\./.test(name)
          ? [full]
          : [];
      });
    const offenders = walk(SRC)
      .map((f) => [f.slice(SRC.length + 1), readFileSync(f, "utf8")] as const)
      .filter(
        ([rel, text]) =>
          /addEventListener\(\s*"keydown"/.test(text) &&
          /"Escape"/.test(text) &&
          !/EscapeLayer\(/.test(text) &&
          rel !== "components/escapeLayers.ts" &&
          !(rel in NOT_MODAL),
      )
      .map(([rel]) => rel);
    expect(offenders).toEqual([]);
  });
});

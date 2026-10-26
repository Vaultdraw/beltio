/**
 * The editor's side of links: mounts `useEditorLinks`, binds the link
 * commands that act on the scene (they need the editor's API), applies the
 * open drawing's rename edits for the app, and re-measures rewritten text
 * once when a drawing opens. All of it is idle until used.
 */
import { useEffect, useRef } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { registerCommandHandlers } from "../../commands/handlerRegistry";
import { wikiLink } from "../../links/format";
import { DEFAULT_LINKS_SETTINGS } from "../../links/types";
import { DEFAULT_TAGS_SETTINGS } from "../../tags/types";

import { captureCaret, insertLinkText } from "./insertLink";
import { useEditorLinks } from "./useEditorLinks";

import type { MutableRefObject } from "react";

import type { TagsSettings } from "../../tags/types";
import type { ElementEdit, LinksSettings, VaultLinks } from "../../links/types";
import type { EditorLinksCallbacks } from "./useEditorLinks";
import type { ReadDrawing } from "./preview/previewThumbnails";

/** What the app can call on the open editor. */
export type EditorLinksBridge = {
  applyEdits(edits: readonly ElementEdit[]): number;
};

export type EditorLinksWiring = {
  settings: LinksSettings;
  /** Stable identity: changes only when the drawing list changes. */
  names: readonly string[];
  /** Asked when a link action needs `names` (starts a lazy file list). */
  onNeedNames?(): void;
  currentPath: string | null;
  callbacks: EditorLinksCallbacks;
  links: VaultLinks | null;
  handle: string | null;
  pickDrawing(label?: string): Promise<string | null>;
  bridge: MutableRefObject<EditorLinksBridge | null>;
  /** Text elements to re-measure once for this drawing. */
  remeasureIds?: readonly string[] | null;
  onRemeasured?(): void;
  getRecent?: () => readonly string[];
  /** `tags.autocomplete`. Omitted: default (on). Wire the real settings here. */
  tagsSettings?: TagsSettings;
  /** Reads a vault drawing (hover preview thumbnails). */
  readDrawing?: ReadDrawing;
};

const NO_NAMES: readonly string[] = [];
const OFF: LinksSettings = {
  ...DEFAULT_LINKS_SETTINGS,
  autocomplete: false,
  styleLinks: false,
  hoverPreview: "off",
};
const TAGS_OFF: TagsSettings = {
  ...DEFAULT_TAGS_SETTINGS,
  autocomplete: false,
};
const NOOP = () => {};
const NO_CALLBACKS: EditorLinksCallbacks = {
  openDrawing: NOOP,
  onUnresolved: NOOP,
  onCreate: NOOP,
};

/**
 * `api` is null while the editor shows another document's scene (a scene
 * swap in flight); `styleApi` is the editor itself, so link styling stays on
 * the scene that is shown, with the path it was opened under, and switches
 * to the new path once the new scene is the one on screen.
 */
export function useVaultEditorLinks(
  api: ExcalidrawImperativeAPI | null,
  containerEl: HTMLElement | null,
  wiring: EditorLinksWiring | undefined,
  styleApi: ExcalidrawImperativeAPI | null = api,
) {
  const currentPath = wiring?.currentPath ?? null;
  const shownPath = useRef(currentPath);
  if (api !== null || styleApi === null) {
    shownPath.current = currentPath;
  }
  const controller = useEditorLinks({
    api,
    containerEl,
    settings: wiring?.settings ?? OFF,
    names: wiring?.names ?? NO_NAMES,
    onNeedNames: wiring?.onNeedNames,
    currentPath,
    callbacks: wiring?.callbacks ?? NO_CALLBACKS,
    links: wiring?.links,
    handle: wiring?.handle,
    getRecent: wiring?.getRecent,
    tagsSettings: wiring ? wiring.tagsSettings : TAGS_OFF,
    readDrawing: wiring?.readDrawing,
    styleApi,
    stylePath: shownPath.current,
  });
  const live = useRef({ controller, wiring, api, containerEl });
  live.current = { controller, wiring, api, containerEl };
  const enabled = !!wiring;

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const pick = async (label: string) =>
      live.current.wiring?.pickDrawing(label) ?? null;
    const stopCommands = registerCommandHandlers({
      "links.linkSelection": async () => {
        const path = await pick("Link selection to drawing…");
        if (path) {
          live.current.controller.linkSelectionTo(path);
        }
      },
      "links.insert": async () => {
        const { api: a, containerEl: el } = live.current;
        const caret = a ? captureCaret(a, el) : null;
        const path = await pick("Insert link to drawing…");
        const { api: b, controller: c } = live.current;
        if (path && b) {
          insertLinkText(b, caret, wikiLink(c.targetFor(path)));
        }
      },
      "links.openUnderSelection": () => {
        live.current.controller.openLinkUnderSelection();
      },
      "links.openUnderSelectionNew": () => {
        live.current.controller.openLinkUnderSelection("new");
      },
      "links.hints": () => {
        live.current.controller.startLinkHints();
      },
    });
    const bridge = live.current.wiring!.bridge;
    bridge.current = {
      applyEdits: (edits) => live.current.controller.applyEdits(edits),
    };
    return () => {
      stopCommands();
      bridge.current = null;
    };
  }, [enabled]);

  // Re-measure the rewritten text of this drawing once, after fonts load.
  const remeasureIds = wiring?.remeasureIds;
  const done = useRef<readonly string[] | null>(null);
  useEffect(() => {
    if (!api || !remeasureIds || done.current === remeasureIds) {
      return;
    }
    done.current = remeasureIds;
    void live.current.controller
      .remeasure(remeasureIds)
      .catch(() => 0)
      .then(() => live.current.wiring?.onRemeasured?.());
  }, [api, remeasureIds]);

  return controller;
}

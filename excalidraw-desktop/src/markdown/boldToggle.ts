/**
 * "Markdown: Toggle bold" on selected text boxes (Obsidian's Cmd+B for a
 * one-font box): every selected text, or the text it labels, goes bold, or
 * back to regular when all of them are bold already. One undo step. While a
 * text is edited the command goes to the editor extension instead.
 */
import { isBoldFont } from "@excalidraw/common";
import { newElementWith } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { fontsReady, measureTextUpdate } from "../editor/links/remeasure";

import { toggledBoldFont } from "./inlineRules";
import { selectedTexts } from "./selectedTexts";

type AnyElement = Record<string, any> & { id: string; type: string };

const IMMEDIATELY = "IMMEDIATELY" as never;

/** Returns how many texts changed. */
export async function toggleBoldSelected(
  api: ExcalidrawImperativeAPI,
): Promise<number> {
  const state = api.getAppState();
  const all = api.getSceneElementsIncludingDeleted() as unknown as AnyElement[];
  const texts = selectedTexts(all, state.selectedElementIds);
  if (texts.length === 0) {
    return 0;
  }
  const wanted = (e: AnyElement) => toggledBoldFont(e.fontFamily);
  // A family without a bold face (Lilita One, Assistant) has nothing to
  // change and no say in "all bold already?", or Cmd+B would stick on bold.
  const toggleable = texts.filter((e) => wanted(e) !== e.fontFamily);
  const allBold = toggleable.every((e) => isBoldFont(e.fontFamily));
  const changing = toggleable.filter((e) =>
    allBold ? isBoldFont(e.fontFamily) : !isBoldFont(e.fontFamily),
  );
  if (changing.length === 0) {
    return 0;
  }
  const target = new Map(changing.map((e) => [e.id, wanted(e)]));
  await fontsReady(
    changing.map(
      (e) =>
        newElementWith(
          e as never,
          { fontFamily: target.get(e.id) } as never,
        ) as AnyElement,
    ),
  );
  // Re-read after the wait: anything drawn, typed or reloaded meanwhile stays.
  const current =
    api.getSceneElementsIncludingDeleted() as unknown as AnyElement[];
  const map = new Map(current.map((e) => [e.id, e]));
  const next = new Map<string, AnyElement>();
  for (const e of current) {
    const font = target.get(e.id);
    if (font === undefined || e.isDeleted || e.type !== "text") {
      continue;
    }
    const patched = newElementWith(
      e as never,
      { fontFamily: font } as never,
    ) as AnyElement;
    map.set(e.id, patched);
    const measured = measureTextUpdate(patched, map);
    next.set(
      e.id,
      newElementWith(patched as never, (measured ?? {}) as never) as AnyElement,
    );
  }
  if (next.size === 0) {
    return 0;
  }
  api.updateScene({
    elements: current.map((e) => next.get(e.id) ?? e) as never,
    captureUpdate: IMMEDIATELY,
  });
  return next.size;
}

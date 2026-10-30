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

type AnyElement = Record<string, any> & { id: string; type: string };

const IMMEDIATELY = "IMMEDIATELY" as never;

/** Returns how many texts changed. */
export async function toggleBoldSelected(
  api: ExcalidrawImperativeAPI,
): Promise<number> {
  const state = api.getAppState();
  const all = api.getSceneElementsIncludingDeleted() as unknown as AnyElement[];
  const texts = all.filter(
    (e) => e.type === "text" && !e.isDeleted && state.selectedElementIds[e.id],
  );
  if (texts.length === 0) {
    return 0;
  }
  const allBold = texts.every((e) => isBoldFont(e.fontFamily));
  const wanted = (e: AnyElement) => toggledBoldFont(e.fontFamily);
  // a family without a bold face (Lilita One) has nothing to change
  const changing = texts.filter(
    (e) =>
      (allBold ? isBoldFont(e.fontFamily) : !isBoldFont(e.fontFamily)) &&
      wanted(e) !== e.fontFamily,
  );
  if (changing.length === 0) {
    return 0;
  }
  const patched = changing.map(
    (e) =>
      newElementWith(
        e as never,
        { fontFamily: wanted(e) } as never,
      ) as AnyElement,
  );
  await fontsReady(patched);
  const map = new Map(all.map((e) => [e.id, e]));
  const next = new Map<string, AnyElement>();
  for (const e of patched) {
    map.set(e.id, e);
    const measured = measureTextUpdate(e, map);
    next.set(
      e.id,
      newElementWith(e as never, (measured ?? {}) as never) as AnyElement,
    );
  }
  api.updateScene({
    elements: all.map((e) => next.get(e.id) ?? e) as never,
    captureUpdate: IMMEDIATELY,
  });
  return next.size;
}

/**
 * Markdown typing: the text editor extension that turns Markdown block marks
 * into their look as they are typed (Notion, Obsidian). Loaded only once a
 * drawing turns Markdown mode on; every key handler first checks the mode
 * and returns at once for keys it doesn't own. Cost per key: a few
 * comparisons; on a space, Enter or Backspace, one look at the caret's line.
 *
 * Boxes (one text element each, a role in customData):
 * - `#`..`######` + space: heading N (size = body size x scale).
 * - `> ` + space: a quote box.
 *   On the first line the box is restyled; on a later line the box keeps
 *   the lines above and the new block starts a box below.
 * - Enter in a heading ends it; a body box starts below. Enter on the empty
 *   last line of a quote ends it the same way.
 * - Backspace at the start of a heading or quote: back to body text.
 *
 * Lines (markers in the text, as the Markdown import writes them):
 * - `- `, `* `, `+ ` -> `• `; `[ ] `, `- [ ] ` -> `☐ `; `[x] ` -> `☑ `.
 *   `1. ` stays as typed.
 * - Enter in an item starts the next one (numbers count up, tasks open);
 *   Enter on an empty item ends the list.
 * - Backspace right after a marker removes it.
 *
 * Cmd/Ctrl+Z right after any conversion brings the typed marks back.
 */
import { boldFontOf, regularFontOf } from "@excalidraw/common";

import type {
  TextEditorExtension,
  TextEditorListeners,
  TextEditorSession,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import {
  DEFAULT_BLOCK_GAP,
  DEFAULT_HEADING_SCALES,
  lineEnd,
  lineStart,
  listItemOf,
  matchLineTrigger,
  nextMarker,
} from "./lineRules";
import {
  QUOTE_ROLE,
  headingLevelOf,
  headingRole,
  isBoxRole,
  roleOf,
  withRole,
} from "./roles";

/**
 * The marker an empty nested item takes one level out: the next number after
 * the last item at that level above it, else the item's own marker.
 */
const outdentedMarker = (
  above: string,
  indent: string,
  marker: string,
): string => {
  const lines = above.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const it = listItemOf(lines[i]);
    if (!it) {
      break;
    }
    if (it.indent.length < indent.length) {
      break;
    }
    if (it.indent === indent) {
      return nextMarker(it.marker);
    }
  }
  return marker;
};

export type MarkdownTypingSettings = {
  /** Heading 1..6 sizes as multiples of the body size. */
  headingScales: readonly number[];
  /** Gap between blocks, in body lines. */
  blockGap: number;
  /** Headings in the bold variant of the text's font (`markdown.heading_bold`). */
  headingBold: boolean;
};

export const DEFAULT_MARKDOWN_TYPING_SETTINGS: MarkdownTypingSettings = {
  headingScales: DEFAULT_HEADING_SCALES,
  blockGap: DEFAULT_BLOCK_GAP,
  headingBold: true,
};

type Conversion =
  | {
      kind: "inPlace";
      elementId: string;
      /** The textarea text right after the conversion. */
      after: string;
      before: string;
      caretBefore: number;
      /** The style before, when the conversion restyled the box. */
      style?: {
        fontSize: number;
        fontFamily: number;
        customData: Record<string, unknown> | undefined;
      };
    }
  | {
      kind: "split";
      /** The new box. */
      elementId: string;
      after: string;
      /** The box the block came out of, and its text before. */
      fromId: string;
      before: string;
      caretBefore: number;
    };

type PendingSplit = Omit<
  Extract<Conversion, { kind: "split" }>,
  "kind" | "elementId"
>;

const isPlainKey = (e: KeyboardEvent) =>
  !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;

const scaleOf = (settings: MarkdownTypingSettings, level: number) => {
  const s = settings.headingScales[level - 1];
  return typeof s === "number" && s > 0 ? s : 1;
};

/** The body text size of a box, from its size and role. */
const bodySizeOf = (
  el: ExcalidrawTextElement,
  settings: MarkdownTypingSettings,
) => {
  const level = headingLevelOf(roleOf(el));
  return level ? el.fontSize / scaleOf(settings, level) : el.fontSize;
};

/** The font a box with `role` is drawn in: headings in the bold variant, everything else regular. */
const fontFor = (
  fontFamily: number,
  role: string | null,
  settings: MarkdownTypingSettings,
) =>
  headingLevelOf(role) && settings.headingBold
    ? boldFontOf(fontFamily)
    : regularFontOf(fontFamily);

/** Where a box placed right below `el` starts (top-left for its alignment). */
const belowAnchor = (
  el: ExcalidrawTextElement,
  bodySize: number,
  settings: MarkdownTypingSettings,
) => {
  const x =
    el.textAlign === "center"
      ? el.x + el.width / 2
      : el.textAlign === "right"
      ? el.x + el.width
      : el.x;
  const gap = settings.blockGap * bodySize * el.lineHeight;
  return { x, y: el.y + el.height + gap };
};

export function createMarkdownTyping(deps: {
  isOn: () => boolean;
  getSettings: () => MarkdownTypingSettings;
}): TextEditorExtension {
  // Across sessions: a conversion that split a box moves editing to a new one.
  let lastConversion: Conversion | null = null;
  // Body boxes Enter created below a block: Backspace in an empty one goes back.
  const continuedFrom = new Map<string, string>();
  let pendingSplit: PendingSplit | null = null;
  let pendingContinue: string | null = null;

  const attach = (session: TextEditorSession): TextEditorListeners => {
    const { editable } = session;
    /**
     * The editor skips undefined values (mutateElement), so "no customData" (a role removed, or
     * restored by undo to a text that had none) is written as `{}` (hunter B-1, B-2).
     */
    const restyle = (patch: Parameters<TextEditorSession["restyle"]>[0]) =>
      session.restyle(
        "customData" in patch
          ? { ...patch, customData: patch.customData ?? {} }
          : patch,
      );

    /** Replace [from, to) with `text` (caret after it) and remember the undo. */
    const replaceMarks = (
      elementId: string,
      from: number,
      to: number,
      text: string,
    ) => {
      const value = editable.value;
      const caret = editable.selectionStart;
      const before = `${value.slice(0, caret)} ${value.slice(caret)}`;
      const after = value.slice(0, from) + text + value.slice(to);
      session.setText(after, from + text.length);
      lastConversion = {
        kind: "inPlace",
        elementId,
        after,
        before,
        caretBefore: caret + 1,
      };
    };

    /** Turn the caret's line into a box with `role` (and size). */
    const convertBox = (
      el: ExcalidrawTextElement,
      role: string,
      fontSize: number,
    ): boolean => {
      const value = editable.value;
      const caret = editable.selectionStart;
      const start = lineStart(value, caret);
      const hasAbove = start > 0;
      const hasBelow = lineEnd(value, caret) < value.length;
      if (hasBelow || (hasAbove && session.isLabel)) {
        // a block is its own box: only a line with nothing below it
        return false;
      }
      const settings = deps.getSettings();
      const bodySize = bodySizeOf(el, settings);
      const before = `${value.slice(0, caret)} ${value.slice(caret)}`;
      const rest = value.slice(caret);
      if (!hasAbove) {
        // read before restyling: the scene mutates elements in place
        const style = {
          fontSize: el.fontSize,
          fontFamily: el.fontFamily,
          customData: el.customData,
        };
        session.setText(rest, 0);
        restyle({
          fontSize,
          fontFamily: fontFor(el.fontFamily, role, settings),
          customData: withRole(el.customData, role),
        });
        lastConversion = {
          kind: "inPlace",
          elementId: el.id,
          after: rest,
          before,
          caretBefore: caret + 1,
          style,
        };
        return true;
      }
      // later line: the lines above stay, the block starts a box below
      const above = value.slice(0, start - 1);
      session.setText(above, above.length);
      const at = belowAnchor(session.getElement() ?? el, bodySize, settings);
      // the next session (the new box) picks this up when it attaches
      pendingSplit = {
        fromId: el.id,
        before,
        caretBefore: caret + 1,
        after: rest,
      };
      session.continueInNewText({
        ...at,
        text: rest,
        caret: 0,
        fontSize,
        fontFamily: fontFor(el.fontFamily, role, settings),
        customData: { role },
      });
      return true;
    };

    const space = (): boolean => {
      const value = editable.value;
      const caret = editable.selectionStart;
      if (caret !== editable.selectionEnd) {
        return false;
      }
      const start = lineStart(value, caret);
      const trigger = matchLineTrigger(value.slice(start, caret));
      const el = session.getElement();
      if (!trigger || !el) {
        return false;
      }
      if (trigger.kind === "list") {
        replaceMarks(el.id, start, caret, `${trigger.marker} `);
        return true;
      }
      const settings = deps.getSettings();
      if (trigger.kind === "quote") {
        return convertBox(el, QUOTE_ROLE, bodySizeOf(el, settings));
      }
      return convertBox(
        el,
        headingRole(trigger.level),
        bodySizeOf(el, settings) * scaleOf(settings, trigger.level),
      );
    };

    /** End a heading or quote box; a body box starts below. */
    const endBox = (el: ExcalidrawTextElement, head: string, tail: string) => {
      const settings = deps.getSettings();
      if (head !== editable.value) {
        session.setText(head, head.length);
      }
      const bodySize = bodySizeOf(el, settings);
      const at = belowAnchor(session.getElement() ?? el, bodySize, settings);
      pendingContinue = el.id;
      session.continueInNewText({
        ...at,
        text: tail,
        caret: 0,
        fontSize: bodySize,
        fontFamily: regularFontOf(el.fontFamily),
      });
    };

    const toBody = (el: ExcalidrawTextElement) => {
      restyle({
        fontSize: bodySizeOf(el, deps.getSettings()),
        fontFamily: regularFontOf(el.fontFamily),
        customData: withRole(el.customData, null),
      });
    };

    const enter = (): boolean => {
      const el = session.getElement();
      if (!el) {
        return false;
      }
      const value = editable.value;
      const { selectionStart: from, selectionEnd: to } = editable;
      const role = roleOf(el);
      if (headingLevelOf(role) && session.isLabel) {
        // a label is one box and cannot split: Enter ends the heading, the
        // label goes back to body size and the Enter adds a line (hunter B-6)
        toBody(el);
        lastConversion = null;
        return false;
      }
      if (headingLevelOf(role) && !session.isLabel) {
        if (!value.trim()) {
          // an empty heading: Enter turns it back into body text
          toBody(el);
        } else {
          endBox(
            el,
            from === 0 ? value : value.slice(0, from),
            from === 0 ? "" : value.slice(to),
          );
        }
        return true;
      }
      const start = lineStart(value, from);
      const line = value.slice(start, lineEnd(value, from));
      const item = listItemOf(line);
      if (item && from === to && from >= start + item.length) {
        if (line.length === item.length && item.indent.length > 0) {
          // an empty nested item: Enter moves it out one level, as Obsidian does
          const indent = item.indent.slice(Math.min(4, item.indent.length));
          const marker = outdentedMarker(
            value.slice(0, Math.max(0, start - 1)),
            indent,
            item.marker,
          );
          const text = `${indent}${marker} `;
          session.setText(
            value.slice(0, start) + text + value.slice(start + item.length),
            start + text.length,
          );
          return true;
        }
        if (line.length === item.length) {
          // an empty item: Enter ends the list (the marker goes)
          session.setText(
            value.slice(0, start) + value.slice(start + item.length),
            start,
          );
          return true;
        }
        const next = `\n${item.indent}${nextMarker(item.marker)} `;
        session.setText(
          value.slice(0, from) + next + value.slice(to),
          from + next.length,
        );
        return true;
      }
      if (role === QUOTE_ROLE && !session.isLabel && from === to) {
        // Enter on the empty last line ends the quote
        if (line === "" && start > 0 && lineEnd(value, from) === value.length) {
          endBox(el, value.slice(0, start - 1), "");
          return true;
        }
      }
      return false;
    };

    const backspace = (): boolean => {
      const { selectionStart: caret, selectionEnd } = editable;
      const el = session.getElement();
      if (!el || caret !== selectionEnd) {
        return false;
      }
      const value = editable.value;
      if (caret === 0) {
        if (isBoxRole(roleOf(el))) {
          toBody(el);
          lastConversion = null;
          return true;
        }
        const from = continuedFrom.get(el.id);
        if (from && value === "") {
          // an empty box Enter just made: back to the end of its block
          continuedFrom.delete(el.id);
          session.editText(from, Number.MAX_SAFE_INTEGER);
          return true;
        }
        return false;
      }
      const start = lineStart(value, caret);
      const item = listItemOf(value.slice(start, lineEnd(value, caret)));
      if (item && caret === start + item.length) {
        // right after a marker: the marker goes, the text stays
        session.setText(
          value.slice(0, start) + item.indent + value.slice(caret),
          start + item.indent.length,
        );
        return true;
      }
      return false;
    };

    const undo = (): boolean => {
      const c = lastConversion;
      const el = session.getElement();
      if (!c || !el || c.elementId !== el.id || editable.value !== c.after) {
        return false;
      }
      lastConversion = null;
      if (c.kind === "inPlace") {
        session.setText(c.before, c.caretBefore);
        if (c.style) {
          restyle(c.style);
        }
      } else {
        session.setText("", 0);
        session.editText(c.fromId, c.caretBefore, c.before);
      }
      return true;
    };

    // a split or Enter from the previous session lands here
    const el = session.getElement();
    if (el && pendingSplit) {
      lastConversion = { kind: "split", elementId: el.id, ...pendingSplit };
    } else if (el && pendingContinue) {
      continuedFrom.set(el.id, pendingContinue);
    }
    pendingSplit = null;
    pendingContinue = null;

    return {
      onKeyDown: (e) => {
        if (e.isComposing || e.keyCode === 229 || !deps.isOn()) {
          return false;
        }
        const mod = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
        let handled = false;
        if (e.key === " " && isPlainKey(e)) {
          handled = space();
        } else if (e.key === "Enter" && isPlainKey(e)) {
          handled = enter();
        } else if (e.key === "Backspace" && isPlainKey(e)) {
          handled = backspace();
        } else if (mod && e.key.toLowerCase() === "z") {
          handled = undo();
        }
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }
        return handled;
      },
    };
  };

  return { attach };
}

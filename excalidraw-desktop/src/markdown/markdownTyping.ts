/**
 * Markdown typing: the text editor extension that turns `# ` into a heading
 * as it is typed (Notion, Obsidian). Loaded only once a drawing turns
 * Markdown mode on; every key handler first checks the mode and returns at
 * once for keys it doesn't own. Cost per key: a few comparisons; on a space,
 * one look at the caret's line before the caret (at most 6 characters).
 *
 * - Space after `#`..`######` at a line start: the marker goes, the text
 *   becomes heading N (role in customData, size = body size x scale). On the
 *   first line it restyles the box; on a later line the box keeps the lines
 *   above and the heading starts a new box below.
 * - Enter in a heading: the heading ends; a new body text box starts below.
 * - Backspace at the start of a heading: back to body text.
 * - Cmd/Ctrl+Z right after a conversion: the literal `# ` comes back.
 */
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
  matchLineTrigger,
} from "./lineRules";
import { headingLevelOf, headingRole, roleOf, withRole } from "./roles";

export type MarkdownTypingSettings = {
  /** Heading 1..6 sizes as multiples of the body size. */
  headingScales: readonly number[];
  /** Gap between blocks, in body lines. */
  blockGap: number;
};

export const DEFAULT_MARKDOWN_TYPING_SETTINGS: MarkdownTypingSettings = {
  headingScales: DEFAULT_HEADING_SCALES,
  blockGap: DEFAULT_BLOCK_GAP,
};

type Conversion =
  | {
      kind: "inPlace";
      elementId: string;
      /** The textarea text right after the conversion. */
      after: string;
      before: string;
      caretBefore: number;
      fontSize: number;
      customData: Record<string, unknown> | undefined;
    }
  | {
      kind: "split";
      /** The new heading box. */
      elementId: string;
      after: string;
      /** The box the heading came out of, and its text before. */
      fromId: string;
      before: string;
      caretBefore: number;
    };

const isPlainKey = (e: KeyboardEvent) =>
  !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;

const scaleOf = (settings: MarkdownTypingSettings, level: number) => {
  const s = settings.headingScales[level - 1];
  return typeof s === "number" && s > 0 ? s : 1;
};

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
  // Body boxes Enter created below a heading: Backspace in an empty one goes back.
  const continuedFrom = new Map<string, string>();

  const attach = (session: TextEditorSession): TextEditorListeners => {
    const { editable } = session;

    const convert = (e: KeyboardEvent): boolean => {
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
      const end = lineEnd(value, caret);
      const hasAbove = start > 0;
      const hasBelow = end < value.length;
      if (hasBelow || (hasAbove && session.isLabel)) {
        // a heading is its own box: only a line with nothing below it
        return false;
      }
      e.preventDefault();
      const settings = deps.getSettings();
      const role = headingRole(trigger.level);
      const currentLevel = headingLevelOf(roleOf(el));
      const bodySize = currentLevel
        ? el.fontSize / scaleOf(settings, currentLevel)
        : el.fontSize;
      const fontSize = bodySize * scaleOf(settings, trigger.level);
      const before = `${value.slice(0, caret)} ${value.slice(caret)}`;
      const rest = value.slice(caret);
      // read before restyling: the scene mutates elements in place
      const prevFontSize = el.fontSize;
      const prevCustomData = el.customData;
      if (!hasAbove) {
        session.setText(rest, 0);
        session.restyle({
          fontSize,
          customData: withRole(el.customData, role),
        });
        lastConversion = {
          kind: "inPlace",
          elementId: el.id,
          after: rest,
          before,
          caretBefore: caret + 1,
          fontSize: prevFontSize,
          customData: prevCustomData,
        };
        return true;
      }
      // later line: the lines above stay, the heading starts a box below
      const above = value.slice(0, start - 1);
      session.setText(above, above.length);
      const shrunk = session.getElement() ?? el;
      const at = belowAnchor(shrunk, bodySize, settings);
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
        customData: { role },
      });
      return true;
    };

    const enter = (e: KeyboardEvent): boolean => {
      const el = session.getElement();
      const level = headingLevelOf(roleOf(el));
      if (!el || !level || session.isLabel) {
        return false;
      }
      e.preventDefault();
      const settings = deps.getSettings();
      const bodySize = el.fontSize / scaleOf(settings, level);
      const value = editable.value;
      if (!value.trim()) {
        // an empty heading: Enter turns it back into body text
        session.restyle({
          fontSize: bodySize,
          customData: withRole(el.customData, null),
        });
        return true;
      }
      const { selectionStart: from, selectionEnd: to } = editable;
      const head = from === 0 ? value : value.slice(0, from);
      const tail = from === 0 ? "" : value.slice(to);
      if (head !== value) {
        session.setText(head, head.length);
      }
      const shrunk = session.getElement() ?? el;
      const at = belowAnchor(shrunk, bodySize, settings);
      pendingContinue = el.id;
      session.continueInNewText({
        ...at,
        text: tail,
        caret: 0,
        fontSize: bodySize,
      });
      return true;
    };

    const backspace = (e: KeyboardEvent): boolean => {
      if (editable.selectionStart !== 0 || editable.selectionEnd !== 0) {
        return false;
      }
      const el = session.getElement();
      if (!el) {
        return false;
      }
      const level = headingLevelOf(roleOf(el));
      if (level) {
        e.preventDefault();
        session.restyle({
          fontSize: el.fontSize / scaleOf(deps.getSettings(), level),
          customData: withRole(el.customData, null),
        });
        lastConversion = null;
        return true;
      }
      const from = continuedFrom.get(el.id);
      if (from && editable.value === "") {
        // an empty box Enter just made: back to the end of its heading
        e.preventDefault();
        continuedFrom.delete(el.id);
        session.editText(from, Number.MAX_SAFE_INTEGER);
        return true;
      }
      return false;
    };

    const undo = (e: KeyboardEvent): boolean => {
      const c = lastConversion;
      const el = session.getElement();
      if (!c || !el || c.elementId !== el.id || editable.value !== c.after) {
        return false;
      }
      e.preventDefault();
      lastConversion = null;
      if (c.kind === "inPlace") {
        session.setText(c.before, c.caretBefore);
        session.restyle({ fontSize: c.fontSize, customData: c.customData });
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
        let handled = false;
        if (e.key === " " && isPlainKey(e)) {
          handled = convert(e);
        } else if (e.key === "Enter" && isPlainKey(e)) {
          handled = enter(e);
        } else if (e.key === "Backspace" && isPlainKey(e)) {
          handled = backspace(e);
        } else if (
          e.key.toLowerCase() === "z" &&
          (e.metaKey || e.ctrlKey) &&
          !e.shiftKey &&
          !e.altKey
        ) {
          handled = undo(e);
        }
        if (handled) {
          e.stopPropagation();
        }
        return handled;
      },
    };
  };

  let pendingSplit: Omit<
    Extract<Conversion, { kind: "split" }>,
    "kind" | "elementId"
  > | null = null;
  let pendingContinue: string | null = null;

  return { attach };
}

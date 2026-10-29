/**
 * Markdown mode of the open drawing: its own switch (saved in the file's
 * `vaultdraw` block) or, when it has none, `markdown.typing`. Binds the
 * `markdown.toggle` command and gives the editor its text editor extension,
 * which loads only once the mode is on (zero cost for drawings with it off).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { TextEditorExtension } from "@excalidraw/excalidraw/types";

import { registerCommandHandlers } from "../commands/handlerRegistry";
import { getPreferences, subscribePreferences } from "../vault/preferences";

import { typingSettingsFrom } from "./markdownSettings";

export const MARKDOWN_TOGGLE_COMMAND = "markdown.toggle";

type TypingModule = typeof import("./markdownTyping");
let typingModule: Promise<TypingModule> | null = null;
const loadTyping = () => (typingModule ??= import("./markdownTyping"));

export function useMarkdownMode({
  getWindow,
  isWritable,
  onChange,
}: {
  getWindow: () => Window | null;
  /** False for read-only or disabled drawings: the switch can't change. */
  isWritable: () => boolean;
  /** The drawing's switch changed: save it. */
  onChange: () => void;
}) {
  const live = useRef({ getWindow, isWritable, onChange });
  live.current = { getWindow, isWritable, onChange };

  // null = the drawing has no switch of its own (follows the default)
  const [drawing, setDrawing] = useState<boolean | null>(null);
  const drawingRef = useRef<boolean | null>(null);
  const defaultOn = useSyncExternalStore(
    subscribePreferences,
    () => getPreferences(getWindow()).markdownTyping,
  );
  const on = drawing ?? defaultOn;
  const onRef = useRef(on);
  onRef.current = on;

  const extension = useRef<TextEditorExtension | null>(null);
  useEffect(() => {
    if (!on || extension.current) {
      return;
    }
    let cancelled = false;
    void loadTyping().then((m) => {
      if (!cancelled && !extension.current) {
        extension.current = m.createMarkdownTyping({
          isOn: () => onRef.current,
          getSettings: () =>
            typingSettingsFrom(getPreferences(live.current.getWindow())),
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [on]);

  const setDrawingValue = useCallback((value: boolean | null) => {
    drawingRef.current = value;
    setDrawing(value);
  }, []);

  /** A drawing was loaded: its own switch, or null. */
  const load = useCallback(
    (value: boolean | null) => setDrawingValue(value),
    [setDrawingValue],
  );

  const toggle = useCallback(() => {
    if (!live.current.isWritable()) {
      return;
    }
    setDrawingValue(!onRef.current);
    onRef.current = !onRef.current;
    live.current.onChange();
  }, [setDrawingValue]);

  useEffect(
    () => registerCommandHandlers({ [MARKDOWN_TOGGLE_COMMAND]: toggle }),
    [toggle],
  );

  /** What the editor reads when a text starts being edited. */
  const textEditorExtension = useCallback(
    () => (onRef.current ? extension.current : null),
    [],
  );

  /** For the save: the drawing's own switch (null = none to store). */
  const getForSave = useCallback(() => drawingRef.current, []);

  return { on, toggle, load, getForSave, textEditorExtension };
}

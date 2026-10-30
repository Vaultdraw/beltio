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

import type {
  ExcalidrawImperativeAPI,
  TextEditorExtension,
} from "@excalidraw/excalidraw/types";

import { registerCommandHandlers } from "../commands/handlerRegistry";
import { getPreferences, subscribePreferences } from "../vault/preferences";

import { applyEdits } from "../editor/links/applyEdits";

import { typingSettingsFrom } from "./markdownSettings";
import { selectedTexts } from "./selectedTexts";
import { toggleFirstTask, toggleTaskInTextarea } from "./taskToggle";

export const MARKDOWN_TOGGLE_COMMAND = "markdown.toggle";
export const MARKDOWN_TOGGLE_TASK_COMMAND = "markdown.toggleTask";
export const MARKDOWN_TOGGLE_BOLD_COMMAND = "markdown.toggleBold";

/**
 * ☐ <-> ☑: on the caret's line while a text is edited, else on the first task
 * line of the one selected text or selected shape's label (one undo step). Works with the mode off too:
 * it only edits task lines that are already there.
 */
const toggleTask = (
  api: ExcalidrawImperativeAPI | null,
  container: HTMLElement | null,
) => {
  const textarea = container?.querySelector<HTMLTextAreaElement>(
    "textarea.excalidraw-wysiwyg",
  );
  if (textarea?.isConnected) {
    toggleTaskInTextarea(textarea);
    return;
  }
  if (!api) {
    return;
  }
  const state = api.getAppState();
  const selected = selectedTexts(
    api.getSceneElements(),
    state.selectedElementIds,
  );
  if (selected.length !== 1) {
    return;
  }
  const el = selected[0] as unknown as { id: string; originalText: string };
  const next = toggleFirstTask(el.originalText);
  if (next !== null) {
    applyEdits(api, [{ elementId: el.id, field: "text", value: next }]);
  }
};

/** Bold <-> regular: the edited box, else every selected text. Works with the mode off too. */
const toggleBold = async (api: ExcalidrawImperativeAPI | null) => {
  if (typingModule && (await typingModule).toggleBoldInEditor()) {
    return;
  }
  if (api) {
    const { toggleBoldSelected } = await import("./boldToggle");
    await toggleBoldSelected(api);
  }
};

type TypingModule = typeof import("./markdownTyping");
let typingModule: Promise<TypingModule> | null = null;
const loadTyping = () => (typingModule ??= import("./markdownTyping"));

export function useMarkdownMode({
  getWindow,
  getApi,
  getContainer,
  isWritable,
  onChange,
}: {
  getWindow: () => Window | null;
  getApi: () => ExcalidrawImperativeAPI | null;
  getContainer: () => HTMLElement | null;
  /** False for read-only or disabled drawings: the switch can't change. */
  isWritable: () => boolean;
  /** The drawing's switch changed: save it. */
  onChange: () => void;
}) {
  const live = useRef({
    getWindow,
    getApi,
    getContainer,
    isWritable,
    onChange,
  });
  live.current = { getWindow, getApi, getContainer, isWritable, onChange };

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
    () =>
      registerCommandHandlers({
        [MARKDOWN_TOGGLE_COMMAND]: toggle,
        [MARKDOWN_TOGGLE_BOLD_COMMAND]: () => {
          if (live.current.isWritable()) {
            void toggleBold(live.current.getApi());
          }
        },
        [MARKDOWN_TOGGLE_TASK_COMMAND]: () => {
          if (live.current.isWritable()) {
            toggleTask(live.current.getApi(), live.current.getContainer());
          }
        },
      }),
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

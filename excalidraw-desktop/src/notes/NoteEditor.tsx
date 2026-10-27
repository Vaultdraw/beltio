/**
 * The note editor: CodeMirror 6 over the note's text. This whole module is a
 * lazy chunk, loaded when a note is first edited; the Vim keys are a second
 * chunk, loaded only when `notes.vim` is on. Text changes go up through
 * `onChange`; saving is the caller's business (noteSaver.ts).
 */
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef } from "react";

import { markdownSupport } from "./markdownLang";

export interface NoteEditorHandle {
  getText: () => string;
  /** Replaces the whole text (after a reload) without reporting a change. */
  setText: (text: string) => void;
  focus: () => void;
}

export interface NoteEditorProps {
  initial: string;
  vim: boolean;
  lineWrap: boolean;
  lineNumbers: boolean;
  fontSize: number;
  onChange: (text: string) => void;
  onSave: () => void;
  onReady: (handle: NoteEditorHandle | null) => void;
}

const theme = (fontSize: number) =>
  EditorView.theme({
    "&": {
      height: "100%",
      fontSize: `${fontSize}px`,
      color: "var(--vault-text)",
      backgroundColor: "transparent",
    },
    ".cm-content": {
      fontFamily: "var(--vd-font)",
      padding: "var(--vd-space-4, 16px) 0",
      caretColor: "var(--vault-text)",
    },
    ".cm-scroller": { lineHeight: "1.6", overflow: "auto" },
    "&.cm-focused": { outline: "none" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "var(--vault-text-faint)",
      border: "none",
    },
    ".cm-activeLine": { backgroundColor: "var(--vault-hover)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--vault-sel)",
    },
    ".cm-cursor": { borderLeftColor: "var(--vault-text)" },
    ".cm-fat-cursor": {
      background: "var(--vault-primary) !important",
      color: "var(--vault-bg) !important",
    },
  });

const NoteEditor = (props: NoteEditorProps) => {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const live = useRef(props);
  live.current = props;
  const wrap = useRef(new Compartment());
  const gutter = useRef(new Compartment());
  const look = useRef(new Compartment());
  const vimSlot = useRef(new Compartment());
  const silent = useRef(false);

  useEffect(() => {
    const parent = host.current;
    if (!parent) {
      return;
    }
    const p = live.current;
    const state = EditorState.create({
      doc: p.initial,
      extensions: [
        // Vim goes first so its keys win over the default keymap.
        vimSlot.current.of([]),
        history(),
        drawSelection(),
        highlightActiveLine(),
        markdownSupport(),
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              live.current.onSave();
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        wrap.current.of(p.lineWrap ? EditorView.lineWrapping : []),
        gutter.current.of(p.lineNumbers ? lineNumbers() : []),
        look.current.of(theme(p.fontSize)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !silent.current) {
            live.current.onChange(u.state.doc.toString());
          }
        }),
        EditorView.contentAttributes.of({
          "aria-label": "Note editor",
          spellcheck: "true",
        }),
      ],
    });
    const v = new EditorView({ state, parent });
    view.current = v;
    live.current.onReady({
      getText: () => v.state.doc.toString(),
      setText: (text) => {
        silent.current = true;
        try {
          v.dispatch({
            changes: { from: 0, to: v.state.doc.length, insert: text },
          });
        } finally {
          silent.current = false;
        }
      },
      focus: () => v.focus(),
    });
    return () => {
      live.current.onReady(null);
      v.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    view.current?.dispatch({
      effects: wrap.current.reconfigure(
        props.lineWrap ? EditorView.lineWrapping : [],
      ),
    });
  }, [props.lineWrap]);
  useEffect(() => {
    view.current?.dispatch({
      effects: gutter.current.reconfigure(
        props.lineNumbers ? lineNumbers() : [],
      ),
    });
  }, [props.lineNumbers]);
  useEffect(() => {
    view.current?.dispatch({
      effects: look.current.reconfigure(theme(props.fontSize)),
    });
  }, [props.fontSize]);
  // notes-vim: the Vim chunk loads only while the setting is on.
  useEffect(() => {
    let cancelled = false;
    if (!props.vim) {
      view.current?.dispatch({ effects: vimSlot.current.reconfigure([]) });
      return;
    }
    void import("./notesVim").then(({ notesVimExtension }) => {
      if (!cancelled) {
        view.current?.dispatch({
          effects: vimSlot.current.reconfigure(
            notesVimExtension(() => live.current.onSave()),
          ),
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [props.vim]);

  return <div ref={host} className="note-editor" data-testid="note-editor" />;
};

export default NoteEditor;

/**
 * A note tab: the reading view (sanitised HTML with Obsidian's syntax) and,
 * on demand, the CodeMirror editor. The tab kind's view chunk (see
 * register.ts); the editor, the Vim keys and MathJax are chunks of their own
 * that load only when used.
 *
 * Saving goes only through `writeNote` with the revision the text was read
 * at, so a change made outside the app is never overwritten without the
 * user's say (NoteSaver).
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { registerCommandHandlers } from "../commands/handlerRegistry";
import { defineContextKey } from "../commands/contextKeys";
import { openExternal } from "../help/openExternal";
import { toastStore } from "../toasts/toastStore";
import { cachedPreferences } from "../vault/useGlobalPref";
import { subscribePreferences, updatePreferences } from "../vault/preferences";

import { createAssetUrls } from "./noteAssets";
import { parseNoteDoc } from "./noteDoc";
import { NoteConflictError, readNote, writeNote } from "./noteFiles";
import { createNoteLinkIndex } from "./noteLinks";
import { NoteSaver, type SaveStatus } from "./noteSaver";
import { NOTES_ACTIVE_KEY, NOTES_COMMAND_IDS as ID } from "./notesCommands";
import { hydrateEmbeds, hydrateMath, type EmbedDeps } from "./render/hydrate";
import { renderNoteHtml, stripFrontmatter } from "./render/obsidian";
import { sanitizeNoteHtml } from "./render/sanitize";

import "./notes.css";

import type { TabKindViewProps } from "../tabs/tabKinds";
import type { NoteDoc } from "../plugins/api";
import type { NoteEditorHandle } from "./NoteEditor";

const NoteEditor = lazy(() => import("./NoteEditor"));

const baseName = (p: string) =>
  p.slice(p.lastIndexOf("/") + 1).replace(/\.(?:md|markdown)$/i, "");
const folderOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  conflict: "Changed on disk",
  error: "Not saved",
};

type Mode = "reading" | "editing";
type Loaded = { text: string; revision: string } | { error: string } | null;

const usePrefs = () =>
  useSyncExternalStore(subscribePreferences, () => cachedPreferences());

const NoteView = ({ path, openPath, vault }: TabKindViewProps) => {
  const prefs = usePrefs();
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>(prefs.notesOpenIn);
  const [status, setStatus] = useState<{ s: SaveStatus; message?: string }>({
    s: "saved",
  });
  const [doc, setDoc] = useState<NoteDoc | null>(null);
  const saver = useRef<NoteSaver | null>(null);
  const editor = useRef<NoteEditorHandle | null>(null);
  const draft = useRef("");
  const reading = useRef<HTMLElement>(null);
  const assets = useMemo(() => createAssetUrls(vault.handle), [vault.handle]);
  useEffect(() => () => assets.dispose(), [assets]);

  // ---- load --------------------------------------------------------------
  const load = useCallback(async () => {
    if (vault.handle === null) {
      setLoaded({ error: "Open a vault in the Vaultdraw app to read notes." });
      return;
    }
    try {
      const file = await readNote(vault.handle, path);
      draft.current = file.content;
      setText(file.content);
      setLoaded({ text: file.content, revision: file.revision });
      if (saver.current) {
        saver.current.rebase(file.content, file.revision);
      }
      editor.current?.setText(file.content);
    } catch (err) {
      setLoaded({ error: err instanceof Error ? err.message : String(err) });
    }
  }, [vault.handle, path]);
  useEffect(() => {
    setLoaded(null);
    void load();
  }, [load]);

  const ready = loaded !== null && "text" in loaded ? loaded : null;
  const handle = vault.handle;
  useEffect(() => {
    if (!ready || handle === null) {
      return;
    }
    const s = new NoteSaver(
      {
        write: (content, revision) =>
          writeNote(handle, path, content, revision),
        delayMs: () => cachedPreferences().notesAutosaveMs,
        onStatus: (st, message) => setStatus({ s: st, message }),
      },
      { text: ready.text, revision: ready.revision },
    );
    saver.current = s;
    return () => {
      // Leaving the tab: write what is pending (fire and forget).
      void s.flush();
      s.dispose();
      saver.current = null;
    };
    // The saver is created once per loaded file; later reads rebase it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, path, ready === null]);

  // ---- a change made outside the app, noticed when the window gets focus --
  useEffect(() => {
    const onFocus = () => {
      const s = saver.current;
      if (!s || s.state !== "saved" || handle === null) {
        return;
      }
      void readNote(handle, path).then(
        (file) => {
          if (
            saver.current === s &&
            s.state === "saved" &&
            file.content !== draft.current
          ) {
            draft.current = file.content;
            setText(file.content);
            s.rebase(file.content, file.revision);
            editor.current?.setText(file.content);
          }
        },
        () => {},
      );
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [handle, path]);

  // ---- parser facts (properties, tags, words) ----------------------------
  useEffect(() => {
    if (!ready) {
      return;
    }
    let live = true;
    void parseNoteDoc(text).then(
      (d) => live && setDoc(d),
      () => live && setDoc(null),
    );
    return () => {
      live = false;
    };
  }, [ready, text]);

  // ---- rendering ---------------------------------------------------------
  const links = useMemo(
    () => createNoteLinkIndex(vault.paths()),
    [vault, path],
  );
  const html = useMemo(() => {
    if (!ready || mode !== "reading") {
      return "";
    }
    return sanitizeNoteHtml(
      renderNoteHtml(text, {
        resolve: (t) => links.resolve(path, t),
        highlight: prefs.notesHighlightCode,
        math: prefs.notesMath,
      }),
      { remoteImages: prefs.notesRemoteImages },
    );
  }, [
    ready,
    mode,
    text,
    links,
    path,
    prefs.notesHighlightCode,
    prefs.notesMath,
    prefs.notesRemoteImages,
  ]);

  const nestedDeps = useMemo<EmbedDeps>(
    () => ({
      noteText: async (p) => {
        try {
          return stripFrontmatter((await readNote(handle ?? "", p)).content);
        } catch {
          return null;
        }
      },
      imageUrl: (p) => assets.url(p),
      renderNested: (t) =>
        sanitizeNoteHtml(
          renderNoteHtml(t, {
            resolve: (target) => links.resolve(path, target),
            highlight: prefs.notesHighlightCode,
            math: prefs.notesMath,
          }),
          { remoteImages: prefs.notesRemoteImages },
        ),
      afterNested: async (el, depth) => {
        await hydrateMath(el, prefs.notesFontSize);
        await hydrateEmbeds(el, nestedDeps, depth);
      },
    }),
    [handle, assets, links, path, prefs],
  );

  useEffect(() => {
    const root = reading.current;
    if (!root || mode !== "reading" || !html) {
      return;
    }
    void hydrateMath(root, prefs.notesFontSize);
    void hydrateEmbeds(root, nestedDeps);
    // Markdown images with vault paths (`![](pics/a.png)`).
    for (const img of root.querySelectorAll<HTMLImageElement>("img[src]")) {
      const src = img.getAttribute("src") ?? "";
      if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(src) || src.startsWith("#")) {
        continue;
      }
      const target = links.resolve(path, decodeURI(src));
      img.removeAttribute("src");
      if (target) {
        void assets
          .url(target)
          .then((u) => u && img.isConnected && (img.src = u));
      }
    }
  }, [html, mode, nestedDeps, assets, links, path, prefs.notesFontSize]);

  // ---- reading view clicks ----------------------------------------------
  const onReadingClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const a = (e.target as HTMLElement).closest("a");
      if (!a) {
        return;
      }
      if (a.dataset.external) {
        e.preventDefault();
        void openExternal(a.getAttribute("href") ?? "");
        return;
      }
      if (!a.classList.contains("wikilink")) {
        return;
      }
      e.preventDefault();
      const target = a.dataset.target ?? "";
      const heading = a.dataset.heading;
      const dest = a.dataset.path;
      const newTab = e.metaKey || e.ctrlKey;
      if (!target && heading) {
        const id = heading
          .toLowerCase()
          .trim()
          .replace(/[^\p{L}\p{N}\s-]/gu, "")
          .replace(/\s+/g, "-");
        reading.current
          ?.querySelector(`[id="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: "start" });
        return;
      }
      if (dest) {
        openPath(dest, { target: newTab ? "new" : "current" });
        return;
      }
      // An unresolved link makes the note, as Obsidian does.
      const created = `${
        folderOf(path) ? `${folderOf(path)}/` : ""
      }${target}.md`;
      if (
        handle === null ||
        /[\\:*?"<>|]/.test(target) ||
        target.includes("..")
      ) {
        toastStore.push({ message: `Cannot create a note named "${target}"` });
        return;
      }
      void writeNote(handle, created, "", null).then(
        () => openPath(created, { target: newTab ? "new" : "current" }),
        (err: unknown) =>
          toastStore.push({
            message:
              err instanceof NoteConflictError
                ? `"${target}" already exists`
                : `Could not create "${target}": ${
                    err instanceof Error ? err.message : String(err)
                  }`,
          }),
      );
    },
    [openPath, path, handle],
  );

  // ---- commands ----------------------------------------------------------
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const toggleEdit = useCallback(() => {
    if (modeRef.current === "editing") {
      const latest = editor.current?.getText() ?? draft.current;
      draft.current = latest;
      setText(latest);
      void saver.current?.flush();
      setMode("reading");
    } else {
      setMode("editing");
    }
  }, []);
  const api = useRef({ toggleEdit });
  api.current = { toggleEdit };
  useEffect(() => {
    const off = defineContextKey(NOTES_ACTIVE_KEY, () => true);
    const unbind = registerCommandHandlers({
      [ID.toggleEdit]: () => api.current.toggleEdit(),
      [ID.save]: () => void saver.current?.flush(),
      [ID.reload]: () => void load(),
      [ID.toggleVim]: () => {
        updatePreferences({ notesVim: !cachedPreferences().notesVim });
      },
      [ID.toggleLineWrap]: () => {
        updatePreferences({
          notesLineWrap: !cachedPreferences().notesLineWrap,
        });
      },
      [ID.toggleLineNumbers]: () => {
        updatePreferences({
          notesLineNumbers: !cachedPreferences().notesLineNumbers,
        });
      },
    });
    return () => {
      unbind();
      off();
    };
  }, [load]);

  // ---- conflict actions --------------------------------------------------
  const keepMine = useCallback(async () => {
    if (handle === null || !saver.current) {
      return;
    }
    try {
      const disk = await readNote(handle, path);
      saver.current.adoptRevision(disk.revision);
      await saver.current.flush();
    } catch (err) {
      toastStore.push({
        message: `Could not save: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }, [handle, path]);

  // ---- render ------------------------------------------------------------
  if (loaded === null) {
    return <div className="note-view note-loading" aria-busy="true" />;
  }
  if ("error" in loaded) {
    return (
      <div className="note-view">
        <div className="note-banner note-banner-error" role="alert">
          <span>{loaded.error}</span>
          <button type="button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  const props = doc?.frontmatter?.properties ?? {};
  const propKeys = Object.keys(props);
  const width = prefs.notesReadableWidth;
  return (
    <div
      className="note-view"
      data-testid="note-view"
      style={{ ["--note-font-size" as string]: `${prefs.notesFontSize}px` }}
    >
      <header className="note-bar">
        <span className="note-title" title={path}>
          {baseName(path)}
        </span>
        <span className="note-meta" aria-live="polite">
          {doc ? `${doc.stats.words} words · ` : ""}
          <span data-testid="note-status" data-status={status.s}>
            {STATUS_TEXT[status.s]}
          </span>
        </span>
        <button
          type="button"
          className="note-toggle"
          aria-pressed={mode === "editing"}
          aria-label={mode === "editing" ? "Show reading view" : "Edit note"}
          onClick={toggleEdit}
        >
          {mode === "editing" ? "Reading view" : "Edit"}
        </button>
      </header>
      {status.s === "conflict" && (
        <div className="note-banner" role="alert">
          <span>This note changed on disk. Your edits were not saved.</span>
          <button type="button" onClick={() => void load()}>
            Reload from disk
          </button>
          <button type="button" onClick={() => void keepMine()}>
            Keep mine
          </button>
        </div>
      )}
      {status.s === "error" && (
        <div className="note-banner note-banner-error" role="alert">
          <span>Could not save: {status.message}</span>
          <button type="button" onClick={() => void saver.current?.flush()}>
            Try again
          </button>
        </div>
      )}
      {mode === "reading" ? (
        <article
          ref={reading}
          className="note-reading"
          data-testid="note-reading"
          tabIndex={0}
          style={width > 0 ? { maxWidth: `${width}px` } : undefined}
          onClick={onReadingClick}
        >
          {propKeys.length > 0 && (
            <dl className="note-properties" data-testid="note-properties">
              {propKeys.map((k) => (
                <div key={k} className="note-property">
                  <dt>{k}</dt>
                  <dd>{props[k]}</dd>
                </div>
              ))}
            </dl>
          )}
          <div
            className="note-body"
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {doc && doc.tags.length > 0 && (
            <footer className="note-tags" aria-label="Tags">
              {doc.tags.map((t) => (
                <span key={t} className="note-tag">
                  #{t}
                </span>
              ))}
            </footer>
          )}
        </article>
      ) : (
        <Suspense fallback={<div className="note-loading" aria-busy="true" />}>
          <div
            className="note-editor-wrap"
            style={width > 0 ? { maxWidth: `${width}px` } : undefined}
          >
            <NoteEditor
              initial={draft.current}
              vim={prefs.notesVim}
              lineWrap={prefs.notesLineWrap}
              lineNumbers={prefs.notesLineNumbers}
              fontSize={prefs.notesFontSize}
              onChange={(t) => {
                draft.current = t;
                saver.current?.change(t);
              }}
              onSave={() => void saver.current?.flush()}
              onReady={(h) => {
                editor.current = h;
                h?.focus();
              }}
            />
          </div>
        </Suspense>
      )}
    </div>
  );
};

export default NoteView;

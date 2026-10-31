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
  Component,
  type ErrorInfo,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { count } from "../../../sdk/api/shared/plural";

import { userError } from "../components/userError";

import { registerCommandHandlers } from "../commands/handlerRegistry";
import { defineContextKey } from "../commands/contextKeys";
import { openWebLink } from "../help/openExternal";
import { toastStore } from "../toasts/toastStore";
import { cachedPreferences } from "../vault/useGlobalPref";
import {
  isOffline,
  subscribePreferences,
  updatePreferences,
} from "../vault/preferences";

import { fetchWebImage } from "../network/webImage";

import { createAssetUrls } from "./noteAssets";
import { parseNoteDoc } from "./noteDoc";
import { getNoteFiles } from "./noteBackend";
import { NoteConflictError } from "./noteFiles";
import {
  findAnchorElement,
  onAnchorQueued,
  queueAnchor,
  takeAnchor,
  hasAnchor,
} from "./noteAnchor";
import { createNoteLinkIndex, newNotePathForLink } from "./noteLinks";
import { taskLines, toggleTask } from "./noteTasks";
import { NoteSaver, type SaveStatus } from "./noteSaver";
import { registerOpenNote } from "./openNotes";
import { resolveRelativeHref } from "./relativeLink";
import {
  NOTES_ACTIVE_KEY,
  NOTES_COMMAND_IDS as ID,
  NOTES_EDITING_KEY,
} from "./notesCommands";
import {
  hydrateEmbeds,
  hydrateMath,
  hydrateRemoteImages,
  type EmbedDeps,
} from "./render/hydrate";
import {
  renderNoteHtml,
  renderPropertyHtml,
  stripFrontmatter,
} from "./render/obsidian";
import { locateBlock, locateSection } from "./render/sections";
import { sanitizeNoteHtml } from "./render/sanitize";

import "./notes.css";

import type { TabKindViewProps } from "../tabs/tabKinds";
import type { NoteDoc } from "../plugins/api";
import type { NoteEditorHandle } from "./NoteEditor";

const NoteEditor = lazy(() => import("./NoteEditor"));

const baseName = (p: string) =>
  p.slice(p.lastIndexOf("/") + 1).replace(/\.(?:md|markdown)$/i, "");

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  conflict: "Changed on disk",
  error: "Not saved",
};

type Mode = "reading" | "editing";
type Loaded =
  | { text: string; revision: string; path: string }
  | { error: string }
  | null;

/**
 * Markdown pictures with vault paths (`![](pics/a.png)`) in `root`, written in note `from`: each
 * goes to the asset loader, which resolves it from that note's folder. Runs for the note and for
 * every embedded note (toimprove 225).
 */
const loadVaultPictures = (
  root: HTMLElement,
  from: string,
  assets: ReturnType<typeof createAssetUrls>,
): void => {
  for (const img of root.querySelectorAll<HTMLImageElement>("img[src]")) {
    const src = img.getAttribute("src") ?? "";
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(src) || src.startsWith("#")) {
      continue;
    }
    img.removeAttribute("src");
    let target = src;
    try {
      target = decodeURI(src);
    } catch {
      // keep the text as written
    }
    void assets
      .url(from, target)
      .then((u) => u && img.isConnected && (img.src = u));
  }
};

const usePrefs = () =>
  useSyncExternalStore(subscribePreferences, () => cachedPreferences());

/** The embed (a whole note, or a heading or block part of one) a box sits in. */
const embedOf = (box: HTMLElement, hostPath: string): HTMLElement | null => {
  const embed = box.closest<HTMLElement>(".note-embed-note[data-path]");
  return embed && embed.dataset.path && embed.dataset.path !== hostPath
    ? embed
    : null;
};

/**
 * Which task of the embedded file a drawn box is. A whole note maps box N to task N; a heading or
 * block part is found in the file again, and its Nth task is the file's task on that line (a
 * `![[Plan#Steps]]` box ticks the line of `Plan.md` it was drawn from). -1 when the file no longer
 * matches what is drawn (toimprove 319).
 */
const embedTaskIndex = (
  content: string,
  part: DOMStringMap,
  box: number,
  drawn: number,
  math: boolean,
): number => {
  const fileTasks = taskLines(content, math);
  if (box < 0) {
    return -1;
  }
  if (!part.heading && !part.block) {
    return drawn === fileTasks.length ? box : -1;
  }
  const body = stripFrontmatter(content);
  const skipped = (
    content.slice(0, content.length - body.length).match(/\n/g) ?? []
  ).length;
  const found = part.block
    ? locateBlock(body, part.block)
    : locateSection(body, part.heading ?? "");
  if (!found) {
    return -1;
  }
  const inPart = taskLines(found.text, math);
  return inPart.length === drawn
    ? fileTasks.indexOf(skipped + found.line + inPart[box])
    : -1;
};

/** Makes the task boxes of a hydrated embedded note clickable (toimprove 267). */
const enableEmbeddedTasks = (root: HTMLElement, hostPath: string): void => {
  for (const box of root.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]',
  )) {
    if (embedOf(box, hostPath)) {
      box.disabled = false;
      box.classList.add("note-task");
    }
  }
};

const NoteViewInner = ({
  path,
  openPath,
  openSearch,
  vault,
  startEditing,
}: TabKindViewProps & { startEditing?: boolean }) => {
  const prefs = usePrefs();
  // Web pictures: the notes switch, Offline mode and the web-pictures switch all have to allow it.
  const remoteImages =
    prefs.notesRemoteImages &&
    !isOffline(prefs) &&
    prefs.networkAllowImages !== false;
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>(
    startEditing ? "editing" : prefs.notesOpenIn,
  );
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

  // Links resolve against the whole vault: start the file walk if it has not run.
  const ensurePaths = vault.ensurePaths;
  useEffect(() => ensurePaths?.(), [ensurePaths]);

  // ---- load --------------------------------------------------------------
  const load = useCallback(async () => {
    if (vault.handle === null) {
      setLoaded({ error: "Open a vault in the Vaultdraw app to read notes." });
      return;
    }
    try {
      const file = await getNoteFiles().read(vault.handle, path);
      draft.current = file.content;
      setText(file.content);
      setLoaded({
        text: file.content,
        revision: file.revision,
        path,
      });
      if (saver.current) {
        saver.current.rebase(file.content, file.revision);
      }
      editor.current?.setText(file.content);
    } catch (err) {
      setLoaded({ error: userError(err, "Couldn't open this note.") });
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
          getNoteFiles().write(handle, path, content, revision),
        delayMs: () => cachedPreferences().notesAutosaveMs,
        onStatus: (st, message) => setStatus({ s: st, message }),
      },
      { text: ready.text, revision: ready.revision },
    );
    saver.current = s;
    const unregister = registerOpenNote({
      path,
      state: () => s.state,
      flush: () => s.flush(),
      revision: () => s.currentRevision,
    });
    return () => {
      unregister();
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
      void getNoteFiles()
        .read(handle, path)
        .then(
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
  const links = useMemo(() => createNoteLinkIndex(vault.paths()), [vault]);
  const html = useMemo(() => {
    if (!ready || mode !== "reading") {
      return "";
    }
    return sanitizeNoteHtml(
      renderNoteHtml(text, {
        resolve: (t) => links.resolve(path, t),
        highlight: prefs.notesHighlightCode,
        math: prefs.notesMath,
        strictLineBreaks: prefs.notesStrictLineBreaks,
      }),
      { remoteImages },
    );
  }, [
    ready,
    mode,
    text,
    links,
    path,
    prefs.notesHighlightCode,
    prefs.notesMath,
    prefs.notesStrictLineBreaks,
    remoteImages,
  ]);

  // One object per html: a fresh one would make React rewrite the DOM that
  // the effects below have already changed (math, embeds, task boxes).
  const bodyHtml = useMemo(() => ({ __html: html }), [html]);

  const nestedDeps = useMemo<EmbedDeps>(
    () => ({
      noteText: async (p) => {
        try {
          return stripFrontmatter(
            (await getNoteFiles().read(handle ?? "", p)).content,
          );
        } catch {
          return null;
        }
      },
      imageUrl: (p, from) => assets.url(from ?? path, p),
      renderNested: (t, _depth, from, idScope) =>
        sanitizeNoteHtml(
          renderNoteHtml(t, {
            resolve: (target) => links.resolve(from, target),
            highlight: prefs.notesHighlightCode,
            math: prefs.notesMath,
            strictLineBreaks: prefs.notesStrictLineBreaks,
            idScope,
          }),
          { remoteImages },
        ),
      afterNested: async (el, depth, from) => {
        if (prefs.notesToggleTasks) {
          enableEmbeddedTasks(el, path);
        }
        await hydrateMath(el, prefs.notesFontSize);
        loadVaultPictures(el, from, assets);
        await hydrateEmbeds(el, nestedDeps, depth, from);
        void hydrateRemoteImages(el, (u) => fetchWebImage(u));
      },
    }),
    [handle, assets, links, path, prefs, remoteImages],
  );

  useEffect(() => {
    const root = reading.current;
    if (!root || mode !== "reading" || !html) {
      return;
    }
    void hydrateMath(root, prefs.notesFontSize);
    void hydrateEmbeds(root, nestedDeps);
    void hydrateRemoteImages(root, (u) => fetchWebImage(u));
    loadVaultPictures(root, path, assets);
  }, [html, mode, nestedDeps, assets, path, prefs.notesFontSize]);

  // ---- scroll to a [[Note#Heading]] / [[Note#^block]] target ---------------
  const [anchorTick, setAnchorTick] = useState(0);
  useEffect(() => onAnchorQueued(() => setAnchorTick((n) => n + 1)), []);
  useEffect(() => {
    const root = reading.current;
    // `ready.path`: a tab that navigates keeps this view mounted while the
    // new note loads, and the old note's page must not take the anchor.
    if (
      !root ||
      mode !== "reading" ||
      !html ||
      ready?.path !== path ||
      !hasAnchor(path)
    ) {
      return;
    }
    const anchor = takeAnchor(path);
    const el = anchor ? findAnchorElement(root, anchor) : null;
    if (!el) {
      return;
    }
    // Again after layout settles (a tab's pane may still be sizing).
    const go = () => el.isConnected && el.scrollIntoView({ block: "start" });
    go();
    const timers = [60, 250].map((ms) => window.setTimeout(go, ms));
    el.classList.add("note-anchor-flash");
    const t = window.setTimeout(
      () => el.classList.remove("note-anchor-flash"),
      1600,
    );
    return () => [t, ...timers].forEach((id) => window.clearTimeout(id));
  }, [html, mode, path, ready, anchorTick]);

  // ---- task checkboxes: clickable only when `notes.toggle_tasks` is on -----
  useEffect(() => {
    const root = reading.current;
    if (!root || mode !== "reading" || !html || !prefs.notesToggleTasks) {
      return;
    }
    for (const box of root.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    )) {
      if (!box.closest(".note-embed")) {
        box.disabled = false;
        box.classList.add("note-task");
      }
    }
  }, [html, mode, prefs.notesToggleTasks]);

  /** Ticks a task inside an embedded note: the embedded note's own file is changed, as in Obsidian (toimprove 267). */
  const tickEmbeddedTask = useCallback(
    async (box: HTMLInputElement, embed: HTMLElement) => {
      const target = embed.dataset.path ?? "";
      const own = [
        ...embed.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
      ].filter((b) => b.closest(".note-embed-note[data-path]") === embed);
      const fail = (why: string) =>
        toastStore.push({ message: `Couldn't tick that task. ${why}` });
      if (handle === null) {
        return;
      }
      try {
        const file = await getNoteFiles().read(handle, target);
        const index = embedTaskIndex(
          file.content,
          embed.dataset,
          own.indexOf(box),
          own.length,
          prefs.notesMath,
        );
        const next =
          index >= 0 ? toggleTask(file.content, index, prefs.notesMath) : null;
        if (next === null) {
          fail("Open that note and edit it there.");
          return;
        }
        await getNoteFiles().write(handle, target, next, file.revision);
        const line = next.split("\n")[taskLines(next, prefs.notesMath)[index]];
        const mark = /\[(.)\]/.exec(line ?? "")?.[1] ?? " ";
        box.checked = mark !== " ";
        const li = box.closest<HTMLElement>("li[data-task]");
        if (li) {
          li.dataset.task = mark;
        }
      } catch (err) {
        fail(
          err instanceof NoteConflictError
            ? "The note changed on disk; try again."
            : userError(err, ""),
        );
      }
    },
    [handle, prefs.notesMath],
  );

  const tickTask = useCallback(
    (box: HTMLInputElement) => {
      const root = reading.current;
      const s = saver.current;
      if (!root || !s) {
        return;
      }
      const boxes = [
        ...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
      ].filter((b) => !b.closest(".note-embed"));
      const index = boxes.indexOf(box);
      const source = draft.current;
      const next =
        index >= 0 && boxes.length === taskLines(source, prefs.notesMath).length
          ? toggleTask(source, index, prefs.notesMath)
          : null;
      if (next === null) {
        toastStore.push({
          message: "Couldn't match that checkbox to the note. Edit it instead.",
        });
        return;
      }
      // Saved like any edit: the revision is checked, a conflict shows the banner.
      draft.current = next;
      setText(next);
      s.change(next);
      void s.flush();
    },
    [prefs.notesMath],
  );

  // ---- reading view clicks ----------------------------------------------
  const onReadingClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const el = e.target as HTMLElement;
      if (
        el instanceof HTMLInputElement &&
        el.type === "checkbox" &&
        cachedPreferences().notesToggleTasks
      ) {
        e.preventDefault();
        const embed = embedOf(el, path);
        if (embed) {
          void tickEmbeddedTask(el, embed);
        } else if (!el.closest(".note-embed")) {
          tickTask(el);
        }
        return;
      }
      const chip = el.closest<HTMLElement>("[data-tag]");
      if (chip && openSearch) {
        openSearch(`tag:#${chip.dataset.tag}`);
        return;
      }
      const a = el.closest("a");
      if (!a) {
        return;
      }
      if (a.dataset.footnote) {
        // A footnote number and its back arrow scroll inside the note; the window never navigates.
        e.preventDefault();
        reading.current
          ?.querySelector(`[id="${CSS.escape(a.dataset.footnote)}"]`)
          ?.scrollIntoView({ block: "center" });
        return;
      }
      if (a.dataset.external) {
        e.preventDefault();
        void openWebLink(a.getAttribute("href") ?? "");
        return;
      }
      // A link follows the note that wrote it: inside an embedded note, its own folder and name
      // (toimprove 259; Obsidian).
      const from =
        a.closest<HTMLElement>(".note-embed-note[data-path]")?.dataset.path ??
        path;
      if (!a.classList.contains("wikilink")) {
        // An ordinary Markdown link: never let the window navigate to it. A link to a file in the
        // vault opens it (a heading after # is scrolled to); anything else does nothing.
        e.preventDefault();
        const to = resolveRelativeHref(
          from,
          a.getAttribute("href") ?? "",
          vault.paths(),
        );
        if (to) {
          if (to.heading) {
            // `#^id` names a block, as in Obsidian (toimprove 324).
            queueAnchor(
              to.path,
              to.heading.startsWith("^")
                ? { block: to.heading.slice(1) }
                : { heading: to.heading },
            );
          }
          if (to.path !== path) {
            openPath(to.path, {
              target: e.metaKey || e.ctrlKey ? "new" : "current",
            });
          }
        }
        return;
      }
      e.preventDefault();
      const target = a.dataset.target ?? "";
      const heading = a.dataset.heading;
      const dest = a.dataset.path;
      const newTab = e.metaKey || e.ctrlKey;
      const block = a.dataset.block;
      if (!target && (heading || block)) {
        // A link to a place in the note that wrote it.
        queueAnchor(from, { heading, block });
        if (from !== path) {
          openPath(from, { target: newTab ? "new" : "current" });
        }
        return;
      }
      if (dest) {
        if (heading || block) {
          queueAnchor(dest, { heading, block });
        }
        openPath(dest, { target: newTab ? "new" : "current" });
        return;
      }
      // An unresolved link makes the note (and its folders), as Obsidian does.
      const created = newNotePathForLink(from, target);
      if (handle === null || created === null) {
        toastStore.push({ message: `Cannot create a note named "${target}"` });
        return;
      }
      void getNoteFiles()
        .write(handle, created, "", null)
        .then(
          () => openPath(created, { target: newTab ? "new" : "current" }),
          (err: unknown) =>
            toastStore.push({
              message:
                err instanceof NoteConflictError
                  ? `“${target}” already exists`
                  : `Couldn't create “${target}”. ${userError(err, "")}`.trim(),
            }),
        );
    },
    [openPath, openSearch, tickTask, tickEmbeddedTask, path, handle, vault],
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
    const offEditing = defineContextKey(
      NOTES_EDITING_KEY,
      () => modeRef.current === "editing",
    );
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
      [ID.bold]: () => editor.current?.run("bold"),
      [ID.italic]: () => editor.current?.run("italic"),
      [ID.find]: () => editor.current?.run("find"),
    });
    return () => {
      unbind();
      off();
      offEditing();
    };
  }, [load]);

  // ---- conflict actions --------------------------------------------------
  const keepMine = useCallback(async () => {
    if (handle === null || !saver.current) {
      return;
    }
    try {
      const disk = await getNoteFiles().read(handle, path);
      saver.current.adoptRevision(disk.revision);
      await saver.current.flush();
    } catch (err) {
      toastStore.push({
        message: `Couldn't save. ${userError(err, "")}`.trim(),
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
          {doc ? `${count(doc.stats.words, "word")} · ` : ""}
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
          <span>
            {`Couldn't save. ${userError(status.message, "")}`.trim()}
          </span>
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
                  <dd
                    dangerouslySetInnerHTML={{
                      __html: sanitizeNoteHtml(
                        renderPropertyHtml(String(props[k]), {
                          resolve: (target) => links.resolve(path, target),
                          highlight: false,
                          math: false,
                        }),
                        { remoteImages: false },
                      ),
                    }}
                  />
                </div>
              ))}
            </dl>
          )}
          <div className="note-body" dangerouslySetInnerHTML={bodyHtml} />
          {doc && doc.tags.length > 0 && (
            <footer className="note-tags" aria-label="Tags">
              {doc.tags.map((t) => (
                <span key={t} className="note-tag" data-tag={t}>
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

/**
 * Nothing a note says may take the window down: a throw while drawing it shows a plain message
 * with "Open as text" (the editor, which draws no Markdown). Toimprove 296.
 */
class NoteBoundary extends Component<
  TabKindViewProps,
  { failed: boolean; asText: boolean }
> {
  state = { failed: false, asText: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `note "${this.props.path}" could not be displayed:`,
      error,
      info,
    );
  }

  componentDidUpdate(prev: TabKindViewProps) {
    if (prev.path !== this.props.path && this.state.failed) {
      this.setState({ failed: false, asText: false });
    }
  }

  render() {
    if (!this.state.failed) {
      return <NoteViewInner {...this.props} startEditing={this.state.asText} />;
    }
    return (
      <div className="note-error" role="alert" data-testid="note-error">
        <p>This note couldn&apos;t be displayed.</p>
        {!this.state.asText && (
          <button
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--sm"
            onClick={() => this.setState({ failed: false, asText: true })}
          >
            Open as text
          </button>
        )}
      </div>
    );
  }
}

const NoteView = (props: TabKindViewProps) => <NoteBoundary {...props} />;

export default NoteView;

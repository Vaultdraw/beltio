/**
 * The one hook the editor mounts for links. At idle it costs: one childList
 * MutationObserver (when autocomplete is on) and three tiny key/blur
 * listeners; everything else is attached on demand (see each controller).
 *
 *   const links = useEditorLinks({ api, containerEl, settings, names, currentPath, callbacks });
 *   <Excalidraw onLinkOpen={links.onLinkOpen} ... />   {links.overlays}
 */
import {
  createElement,
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { linkTargetFor, shapeLinkValue } from "../../links/format";
import { createResolver } from "../../links/resolve";
import { DEFAULT_TAGS_SETTINGS } from "../../tags/types";

import { applyEdits as applyEditsTo, setElementLinks } from "./applyEdits";
import { CmdHoverOverlay } from "./CmdHoverOverlay";
import { LinkHintsOverlay } from "./LinkHintsOverlay";
import { LinkHints } from "./linkHints";
import { createLinkOpener, createOnLinkOpen } from "./onLinkOpen";
import { remeasureElements } from "./remeasure";
import { linksOf } from "./textLinkHitTest";
import { useLinkPreview } from "./preview/useLinkPreview";
import { useLinkStyling } from "./style/useLinkStyling";
import { useModifierLinks } from "./useModifierLinks";

import type { ReactNode } from "react";

import type {
  ElementEdit,
  LinksSettings,
  Resolution,
  VaultLinks,
} from "../../links/types";
import type { TagsSettings } from "../../tags/types";
import type { OpenTarget } from "../../tabs/types";
import type { LinkOpenCallbacks } from "./onLinkOpen";
import type { ReadDrawing } from "./preview/previewThumbnails";
import type { WikiAutocomplete } from "./wikiAutocomplete";
import type { TextLike } from "./textLinkHitTest";

export type EditorLinksCallbacks = LinkOpenCallbacks & {
  /** `+ Create "x"` in the autocomplete popup: the app creates the drawing. */
  onCreate(target: string): void;
};

export type UseEditorLinksOptions = {
  api: ExcalidrawImperativeAPI | null;
  /** The editor's container element (the wrapper around `<Excalidraw>`). */
  containerEl: HTMLElement | null;
  settings: LinksSettings;
  /** Vault drawing paths (the palette's names list). */
  names: readonly string[];
  /**
   * Called when an action reads `names` (autocomplete, new links), so a
   * lazily started file list (files.list_start = "use") starts.
   */
  onNeedNames?: () => void;
  currentPath: string | null;
  callbacks: EditorLinksCallbacks;
  /** Optional: asked when the name list does not know a target. */
  links?: VaultLinks | null;
  handle?: string | null;
  /** Palette recents (`drawing:<path>` keys) to rank autocomplete rows. */
  getRecent?: () => readonly string[];
  /** `tags.autocomplete`: the `#` popup (default: on). */
  tagsSettings?: TagsSettings;
  /** Reads a vault drawing (hover preview thumbnails). */
  readDrawing?: ReadDrawing;
  /**
   * Link styling only (default: `api` / `currentPath`): the editor and the
   * path of the scene on screen. While a scene swap is in flight `api` is
   * null (links act on the new document), but the old scene is still shown
   * and stays styled; uninstalling and reinstalling the styler around the
   * swap redrew both scenes once more.
   */
  styleApi?: ExcalidrawImperativeAPI | null;
  stylePath?: string | null;
};

const LinkSuggest = lazy(() =>
  import("./LinkSuggest").then((m) => ({ default: m.LinkSuggest })),
);

type El = TextLike & { link?: string | null };

export function useEditorLinks(opts: UseEditorLinksOptions) {
  const latest = useRef(opts);
  latest.current = opts;
  const resolver = useMemo(() => createResolver(opts.names), [opts.names]);
  const resolverRef = useRef(resolver);
  resolverRef.current = resolver;

  const openRaw = useMemo(
    () =>
      createLinkOpener({
        getFromPath: () => latest.current.currentPath,
        getResolver: () => resolverRef.current,
        getCallbacks: () => latest.current.callbacks,
        fallbackResolve: (from, raw): Promise<Resolution> => {
          const { links, handle } = latest.current;
          return links && handle
            ? links.resolve(handle, from, raw)
            : Promise.reject(new Error("no link index"));
        },
      }),
    [],
  );
  const onLinkOpen = useMemo(() => createOnLinkOpen(openRaw), [openRaw]);

  const getApi = useCallback(() => latest.current.api, []);
  const modifier = useModifierLinks(opts.containerEl, {
    getApi,
    getModifier: () => latest.current.settings.openModifier,
    openRaw,
  });

  const hints = useMemo(
    () =>
      new LinkHints({
        getApi,
        getHintChars: () => latest.current.settings.hintChars,
        openRaw,
      }),
    [getApi, openRaw],
  );
  useEffect(() => () => hints.cancel(), [hints]);

  // The autocomplete engine and its popup load in their own chunk, so the
  // startup bundle pays nothing for links until an editor mounts.
  const [autocomplete, setAutocomplete] = useState<WikiAutocomplete | null>(
    null,
  );
  const { containerEl } = opts;
  useEffect(() => {
    if (!containerEl) {
      setAutocomplete(null);
      return undefined;
    }
    let cancelled = false;
    void import("./wikiAutocomplete").then(({ WikiAutocomplete: Engine }) => {
      if (!cancelled) {
        setAutocomplete(
          new Engine({
            container: containerEl,
            getNames: () => {
              latest.current.onNeedNames?.();
              return latest.current.names;
            },
            getResolver: () => resolverRef.current,
            getSettings: () => latest.current.settings,
            getCurrentPath: () => latest.current.currentPath,
            getRecent: () => latest.current.getRecent?.() ?? [],
            getTagsSettings: () =>
              latest.current.tagsSettings ?? DEFAULT_TAGS_SETTINGS,
            onCreate: (t) => latest.current.callbacks.onCreate(t),
          }),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [containerEl]);
  const autocompleteOn =
    opts.settings.autocomplete ||
    (opts.tagsSettings ?? DEFAULT_TAGS_SETTINGS).autocomplete;
  useEffect(() => {
    if (!autocomplete || !autocompleteOn) {
      return undefined;
    }
    autocomplete.start();
    return () => autocomplete.stop();
  }, [autocomplete, autocompleteOn]);

  useLinkStyling({
    api: opts.styleApi === undefined ? opts.api : opts.styleApi,
    enabled: opts.settings.styleLinks,
    linkColor: opts.settings.linkColor,
    resolver,
    currentPath:
      opts.stylePath === undefined ? opts.currentPath : opts.stylePath,
  });

  const preview = useLinkPreview({
    api: opts.api,
    containerEl: opts.containerEl,
    mode: opts.settings.hoverPreview,
    modifier: opts.settings.openModifier,
    resolver,
    currentPath: opts.currentPath,
    readDrawing: opts.readDrawing,
  });

  const startLinkHints = useCallback(() => hints.start(), [hints]);

  const openLinkUnderSelection = useCallback(
    (target: OpenTarget = "current"): boolean => {
      const api = latest.current.api;
      if (!api) {
        return false;
      }
      const selected = api.getAppState().selectedElementIds;
      const all = api.getSceneElements() as unknown as El[];
      for (const el of all) {
        if (!selected[el.id]) {
          continue;
        }
        if (el.link && openRaw(el.link, { target })) {
          return true;
        }
        const texts =
          el.type === "text"
            ? [el]
            : all.filter((t) => t.containerId === el.id);
        for (const t of texts) {
          const first = linksOf(t)[0];
          if (first && openRaw(`[[${first.target}]]`, { target })) {
            return true;
          }
        }
      }
      return false;
    },
    [openRaw],
  );

  /** "Link selection to drawing...": write the link on every selected element. */
  const linkSelectionTo = useCallback((targetPath: string): number => {
    const { api, settings, currentPath } = latest.current;
    latest.current.onNeedNames?.();
    if (!api) {
      return 0;
    }
    const target = linkTargetFor(
      targetPath,
      currentPath,
      resolverRef.current,
      settings.newLinkFormat,
    );
    const ids = Object.keys(api.getAppState().selectedElementIds);
    return setElementLinks(
      api,
      ids,
      shapeLinkValue(target, settings.shapeLinkFormat),
    );
  }, []);

  /** The text to put inside `[[...]]` for the drawing at `path`. */
  const targetFor = useCallback((path: string): string => {
    const { settings, currentPath } = latest.current;
    latest.current.onNeedNames?.();
    return linkTargetFor(
      path,
      currentPath,
      resolverRef.current,
      settings.newLinkFormat,
    );
  }, []);

  const applyEdits = useCallback((edits: readonly ElementEdit[]): number => {
    const api = latest.current.api;
    return api ? applyEditsTo(api, edits) : 0;
  }, []);

  const remeasure = useCallback((ids: readonly string[]): Promise<number> => {
    const api = latest.current.api;
    return api ? remeasureElements(api, ids) : Promise.resolve(0);
  }, []);

  const overlays: ReactNode = useMemo(
    () =>
      createElement(
        Fragment,
        null,
        modifier && createElement(CmdHoverOverlay, { links: modifier }),
        autocomplete &&
          createElement(
            Suspense,
            { fallback: null },
            createElement(LinkSuggest, { controller: autocomplete }),
          ),
        createElement(LinkHintsOverlay, { hints }),
        preview,
      ),
    [modifier, autocomplete, hints, preview],
  );

  return {
    onLinkOpen,
    startLinkHints,
    openLinkUnderSelection,
    linkSelectionTo,
    targetFor,
    applyEdits,
    remeasure,
    overlays,
  };
}

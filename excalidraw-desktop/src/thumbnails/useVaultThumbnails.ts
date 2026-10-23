/**
 * One thumbnail service per open vault. Creating it is free (no IPC until a
 * surface watches); it is disposed when the vault changes or closes. Also
 * binds the `thumbnails.toggle` / `thumbnails.clearCache` commands.
 */
import { useEffect, useRef, useState } from "react";

import { registerCommandHandlers } from "../commands/handlerRegistry";
import { THUMBNAIL_COMMAND_IDS as ID } from "../commands/thumbnailCommands";
import {
  getPreferences,
  subscribePreferences,
  updatePreferences,
} from "../vault/preferences";

import { setThumbMaxElements } from "./render";
import { createThumbnailService } from "./service";

import type { VaultRepository } from "../vault/types";
import type { ThumbnailService } from "./service";
import type { ThumbnailStore } from "./store";

export interface VaultThumbnails {
  /** null = off or unavailable: surfaces show their text UI. */
  service: ThumbnailService | null;
  /** The app theme is dark and the canvas is not theme-synced: invert images. */
  darkInvert: boolean;
}

type ThumbnailPrefs = {
  thumbnails: boolean;
  syncCanvas: boolean;
  maxElements: number;
};

const readThumbnailPrefs = (win: Window | null): ThumbnailPrefs => {
  const { thumbnails, syncCanvas, thumbnailMaxElements } = getPreferences(win);
  return { thumbnails, syncCanvas, maxElements: thumbnailMaxElements };
};

/**
 * The two preference flags, read once per preference change instead of on
 * every render: getPreferences parses and normalises localStorage, and the
 * host re-renders on every index tick while a vault opens.
 */
const useThumbnailPrefs = (win: Window | null): ThumbnailPrefs => {
  const [prefs, setPrefs] = useState(() => readThumbnailPrefs(win));
  useEffect(() => {
    const sync = () =>
      setPrefs((prev) => {
        const next = readThumbnailPrefs(win);
        return next.thumbnails === prev.thumbnails &&
          next.syncCanvas === prev.syncCanvas &&
          next.maxElements === prev.maxElements
          ? prev
          : next;
      });
    sync(); // a change between the first render and subscribing
    return subscribePreferences(sync);
  }, [win]);
  return prefs;
};

export const useVaultThumbnails = ({
  store,
  repository,
  handle,
  win,
  appTheme,
}: {
  store: ThumbnailStore | null;
  repository: VaultRepository;
  handle: string | null;
  win: Window | null;
  appTheme: string;
}): VaultThumbnails => {
  const { thumbnails: prefs, syncCanvas, maxElements } = useThumbnailPrefs(win);
  const [service, setService] = useState<ThumbnailService | null>(null);
  const repoRef = useRef(repository);
  repoRef.current = repository;

  useEffect(() => {
    if (!store || !handle) {
      setService(null);
      return;
    }
    const next = createThumbnailService({
      store,
      handle,
      readDrawing: (path) => repoRef.current.readDrawing(handle, path),
      subscribe: (listener) => repoRef.current.subscribe(listener),
    });
    setService(next);
    const unbind = registerCommandHandlers({
      [ID.toggle]: () => {
        updatePreferences({ thumbnails: !getPreferences(win).thumbnails }, win);
      },
      [ID.clearCache]: async () => {
        await store.clear(handle);
        next.invalidate([""]);
      },
    });
    return () => {
      unbind();
      next.dispose();
      setService(null);
    };
  }, [store, handle, win]);

  useEffect(() => {
    service?.setEnabled(prefs);
  }, [service, prefs]);

  // The cap is a live preference: apply it, and re-check the drawings that
  // were over (or are now over) it. The first run only applies it.
  const appliedMax = useRef<number | null>(null);
  useEffect(() => {
    setThumbMaxElements(maxElements);
    if (appliedMax.current !== null && appliedMax.current !== maxElements) {
      service?.invalidate([""]);
    }
    appliedMax.current = maxElements;
  }, [service, maxElements]);

  return {
    service: prefs ? service : null,
    darkInvert: appTheme === "dark" && !syncCanvas,
  };
};

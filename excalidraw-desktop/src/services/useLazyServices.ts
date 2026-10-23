/**
 * Applies `search.start` and `links.start` for the open vault (D8). The
 * native side registers both at vault open without starting them; "use"
 * needs nothing here because the first query starts a pending service.
 */
import { useSyncExternalStore } from "react";

import { getPreferences, subscribePreferences } from "../vault/preferences";

import { useServiceStart } from "./useServiceStart";

import type { VaultLinks } from "../links/types";
import type { VaultSearch } from "../search/types";
import type { ServicesField, StartMode } from "./servicesSettings";

/** One start mode, live from config.toml / Settings. */
export function useStartMode(
  win: Window | null | undefined,
  field: ServicesField,
): StartMode {
  return useSyncExternalStore(
    subscribePreferences,
    () => getPreferences(win)[field],
  );
}

export function useLazyServices(
  win: Window | null | undefined,
  handle: string | null,
  search: Pick<VaultSearch, "start"> | null,
  links: Pick<VaultLinks, "start"> | null,
): void {
  useServiceStart(
    win,
    handle,
    useStartMode(win, "searchStart"),
    search?.start ? (h) => search.start?.(h) : undefined,
  );
  useServiceStart(
    win,
    handle,
    useStartMode(win, "linksStart"),
    links?.start ? (h) => links.start?.(h) : undefined,
  );
}

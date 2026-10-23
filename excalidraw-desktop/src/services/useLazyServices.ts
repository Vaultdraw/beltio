/**
 * Applies `search.start` and `links.start` for the open vault (D8). The
 * native side starts "open" services itself at vault open (this hook's call
 * is then a no-op) and registers the rest; "use" needs nothing here because
 * the first query starts a pending service.
 */
import { useGlobalPref } from "../vault/useGlobalPref";

import { useServiceStart } from "./useServiceStart";

import type { VaultLinks } from "../links/types";
import type { VaultSearch } from "../search/types";
import type { ServicesField, StartMode } from "./servicesSettings";

/** One start mode, live from config.toml / Settings. */
export function useStartMode(
  win: Window | null | undefined,
  field: ServicesField,
): StartMode {
  return useGlobalPref(win, field)[0];
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

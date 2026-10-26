import { startTransition, useEffect, useRef, useState } from "react";

import { getPreferences } from "../vault/preferences";
import { errorMessage } from "../vault/types";

import { SEARCH_DEFAULTS } from "./searchSettings";

import type {
  IndexStatus,
  SearchOptions,
  SearchResponse,
  VaultSearch,
} from "./types";

/** The default wait after a keystroke; `search.debounce_ms` overrides it. */
export const SEARCH_DEBOUNCE_MS = SEARCH_DEFAULTS.searchDebounceMs;
/** While the index is building, results are refreshed at most this often. */
export const BUILDING_REFRESH_MS = 1000;

export interface UseVaultSearchResult {
  response: SearchResponse | null;
  loading: boolean;
  error: string | null;
  status: IndexStatus | null;
}

/**
 * Debounced, latest-wins search. Re-runs the current query when the index
 * starts building or becomes ready, and (throttled) while it is building so
 * results fill in.
 */
export function useVaultSearch(
  search: VaultSearch | null,
  handle: string | null,
  query: string,
  opts: SearchOptions = {},
): UseVaultSearchResult {
  const { limit, scope } = opts;
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  // Index-driven re-runs skip the typing debounce (the query is unchanged).
  const refreshPending = useRef(false);
  const lastQuery = useRef(query);
  const lastTyped = useRef(Number.NEGATIVE_INFINITY);

  // Index status: initial value + live updates, with refresh triggers.
  useEffect(() => {
    setStatus(null);
    if (!search || !handle) {
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastRefresh = Date.now();
    let previous: IndexStatus["state"] | null = null;

    const refresh = () => {
      timer = null;
      lastRefresh = Date.now();
      refreshPending.current = true;
      // Index-driven updates are transitions: React yields to keystroke
      // renders instead of painting them inside a typing frame.
      startTransition(() => setRefreshTick((t) => t + 1));
    };
    const onStatus = (next: IndexStatus, initial = false) => {
      if (cancelled || next.handle !== handle) {
        return;
      }
      const prev = previous;
      previous = next.state;
      // The first answer on mount is applied plainly (it lands in the same
      // pass as the mount's own updates); live events yield to keystrokes.
      if (initial) {
        setStatus(next);
      } else {
        startTransition(() => setStatus(next));
      }
      // Entering "building" means the crawl has made every name searchable (it
      // parses contents afterwards), so a query typed during the walk is
      // answered right away instead of after the throttle. The initial answer
      // is not a transition: the query effect that mounted alongside it
      // searches the index as it is now, so re-running would only double the
      // work of the first keystroke (tree -> search mode switch).
      const entered =
        prev !== next.state &&
        !initial &&
        (next.state === "building" ||
          (next.state === "ready" && prev !== null));
      if (entered) {
        if (timer) {
          clearTimeout(timer);
        }
        refresh();
      } else if (next.state === "building" && !timer) {
        const wait = Math.max(
          0,
          BUILDING_REFRESH_MS - (Date.now() - lastRefresh),
        );
        timer = setTimeout(refresh, wait);
      }
    };

    search
      .subscribe(onStatus)
      .then((off) => {
        if (cancelled) {
          off();
        } else {
          unsubscribe = off;
        }
      })
      .catch(() => {});
    search
      .status(handle)
      .then((s) => {
        // A live event may already have arrived; do not regress it.
        if (!cancelled && previous === null) {
          onStatus(s, true);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
      unsubscribe?.();
    };
  }, [search, handle]);

  useEffect(() => {
    const trimmed = query.trim();
    // Each run owns its flag; cleanup marks it stale so only the latest wins.
    let stale = false;
    const now = Date.now();
    if (query !== lastQuery.current) {
      lastQuery.current = query;
      lastTyped.current = now;
    }
    // An index-driven re-run keeps the typing debounce deadline: immediate
    // once the user has paused, otherwise the next keystroke cancels it (that
    // search sees the newest index), so it never lands inside typing frames.
    // In-memory read of the config value: no cost per keystroke.
    const debounceMs = getPreferences().searchDebounceMs;
    const delay = refreshPending.current
      ? Math.max(0, debounceMs - (now - lastTyped.current))
      : debounceMs;
    refreshPending.current = false;
    if (!search || !handle || !trimmed) {
      setResponse(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      search
        .search(handle, trimmed, { limit, scope })
        .then((res) => {
          if (!stale) {
            setResponse(res);
            setError(null);
            setLoading(false);
          }
        })
        .catch((cause: unknown) => {
          if (!stale) {
            setError(errorMessage(cause));
            setLoading(false);
          }
        });
    }, delay);
    return () => {
      clearTimeout(timer);
      stale = true;
    };
  }, [search, handle, query, limit, scope, refreshTick]);

  return { response, loading, error, status };
}

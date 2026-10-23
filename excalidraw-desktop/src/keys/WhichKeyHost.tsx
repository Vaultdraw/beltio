/**
 * Main-chunk host of the which-key popup. Owns the delay timer and loads the
 * popup chunk lazily. With `[keys] which_key = false` it holds no listener,
 * timer or import (the keys.whichKey command still shows the root on demand).
 */
import { Suspense, lazy, useEffect, useMemo, useState } from "react";

import { KEYS_COMMAND_IDS } from "../commands/keysCommands";
import { registerCommandHandlers } from "../commands/handlerRegistry";
import { cancelPendingSequence } from "../commands/dispatcher";
import {
  getKeyView,
  getPendingKeys,
  subscribePendingKeys,
} from "../commands/pendingKeys";
import { useKeyOptions } from "../commands/useKeyOptions";

import { resolveLabels } from "./whichKeyModel";

import type { Chord } from "../commands/types";

const loadWhichKey = () => import("./WhichKey");
const LazyWhichKey = lazy(loadWhichKey);

const NONE: readonly Chord[] = [];

export function WhichKeyHost({ win }: { win: Window | null }) {
  const settings = useKeyOptions(win);
  const { whichKey, whichKeyDelayMs, whichKeyPosition, leader } = settings;
  const [forced, setForced] = useState(false);
  const [shown, setShown] = useState(false);
  const [path, setPath] = useState<readonly Chord[]>(NONE);

  // keys.whichKey / keys.cancel handlers: one layer, no listeners.
  useEffect(
    () =>
      registerCommandHandlers({
        [KEYS_COMMAND_IDS.whichKey]: () => setForced(true),
        [KEYS_COMMAND_IDS.cancel]: () => {
          cancelPendingSequence();
          setForced(false);
        },
      }),
    [],
  );

  // Follow the pending store only while something can show.
  const watching = whichKey || forced;
  useEffect(() => {
    if (!watching) {
      setPath(NONE);
      return;
    }
    const sync = () => setPath(getPendingKeys());
    sync();
    return subscribePendingKeys(sync);
  }, [watching]);

  // Delay timer: exists only while a sequence is pending and not yet shown.
  const pending = path.length > 0;
  useEffect(() => {
    if (!pending) {
      setShown(false);
      return;
    }
    setForced(false);
    if (!whichKey || shown) {
      return;
    }
    void loadWhichKey();
    const timer = setTimeout(() => setShown(true), whichKeyDelayMs);
    return () => clearTimeout(timer);
  }, [pending, whichKey, whichKeyDelayMs, shown]);

  // Idle preload once a sequence exists, so the first popup is instant.
  useEffect(() => {
    if (!whichKey || !getKeyView()?.getSeqRoot()) {
      return;
    }
    const ric = globalThis as {
      requestIdleCallback?: (cb: () => void, o: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (!ric.requestIdleCallback) {
      return;
    }
    const id = ric.requestIdleCallback(() => void loadWhichKey(), {
      timeout: 5000,
    });
    return () => ric.cancelIdleCallback?.(id);
  }, [whichKey, settings]);

  const labels = useMemo(
    () =>
      resolveLabels(settings.labels, getKeyView()?.platform ?? "win", leader),
    [settings.labels, leader],
  );

  const view = getKeyView();
  if (!view || !((pending && shown && whichKey) || (forced && !pending))) {
    return null;
  }
  return (
    <Suspense fallback={null}>
      <LazyWhichKey
        view={view}
        path={path}
        labels={labels}
        position={whichKeyPosition}
        onClose={() => setForced(false)}
      />
    </Suspense>
  );
}

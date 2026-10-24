import { useCallback, useEffect, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { registerCommandHandlers } from "../commands/handlerRegistry";

import {
  applyFitContent,
  createPageHandlers,
  createPageNavigationHandlers,
} from "./pageCommands";
import { PageRuntime } from "./pageRuntime";

import type { RefObject } from "react";

type Options = {
  apiRef: RefObject<ExcalidrawImperativeAPI | null>;
  getWindow: () => Window | null;
  disabled: boolean;
  readOnly: boolean;
  openPageSetup: () => void;
};

/**
 * Page mode of the open editor: the runtime (view lock, enforcement,
 * auto-extend, paper display), the "Page" command handlers and the
 * "outside the page" notice. `onChange` goes into the editor's onChange.
 */
export function usePageMode(options: Options) {
  const live = useRef(options);
  live.current = options;
  const [outsideCount, setOutsideCount] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const runtime = useRef<PageRuntime | null>(null);
  const unbindNavigation = useRef<(() => void) | null>(null);

  const createRuntime = useCallback(() => {
    const api = () => live.current.apiRef.current;
    return new PageRuntime({
      // PageUp/PageDown belong to page navigation only while page mode is on;
      // otherwise they keep scrolling the infinite canvas.
      onModeChange: (on) => {
        unbindNavigation.current?.();
        unbindNavigation.current = on
          ? registerCommandHandlers(createPageNavigationHandlers(api))
          : null;
      },
      getApi: api,
      isDisabled: () => live.current.disabled,
      onOutsideCount: (count) => {
        setOutsideCount(count);
        if (count === 0) {
          setDismissed(false);
        }
      },
    });
  }, []);

  const disposeRuntime = useCallback(() => {
    unbindNavigation.current?.();
    unbindNavigation.current = null;
    runtime.current?.dispose();
    runtime.current = null;
  }, []);

  useEffect(() => {
    const api = () => live.current.apiRef.current;
    runtime.current = createRuntime();
    const unbind = registerCommandHandlers(
      createPageHandlers({
        getApi: api,
        getWindow: () => live.current.getWindow(),
        isDisabled: () => live.current.disabled,
        openPageSetup: () => live.current.openPageSetup(),
      }),
    );
    return () => {
      unbind();
      disposeRuntime();
    };
  }, [createRuntime, disposeRuntime]);

  /**
   * A different document is shown. The runtime remembers the last document's
   * setup, view lock and what it already enforced, none of which applies to
   * the next one, so it starts over (as a freshly mounted editor would).
   */
  const reset = useCallback(() => {
    disposeRuntime();
    runtime.current = createRuntime();
    setOutsideCount(0);
    setDismissed(false);
  }, [createRuntime, disposeRuntime]);

  const onChange = useCallback<PageRuntime["onChange"]>((elements, state) => {
    runtime.current?.onChange(elements, state);
  }, []);

  const fitContent = useCallback(() => {
    const api = live.current.apiRef.current;
    if (api && !live.current.disabled) {
      applyFitContent(api);
    }
  }, []);

  const dismiss = useCallback(() => setDismissed(true), []);

  const noticeShown =
    outsideCount > 0 && !dismissed && !options.readOnly && !options.disabled;
  // command audit (S8): "Page: Dismiss the page notice" is offered only while the notice shows.
  useEffect(
    () =>
      noticeShown
        ? registerCommandHandlers({ "page.dismissNotice": dismiss })
        : undefined,
    [noticeShown, dismiss],
  );

  return {
    onChange,
    reset,
    notice: noticeShown
      ? { count: outsideCount, onFit: fitContent, onDismiss: dismiss }
      : null,
  };
}

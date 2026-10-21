import type { TabStore } from "../tabs/tabStore";
import type { TabsState } from "../tabs/types";

/** Resolves once the tab model satisfies `pred` (or after `ms`, so a refused action cannot hang). */
export const waitForTabs = (
  store: TabStore,
  pred: (s: TabsState) => boolean,
  ms = 2000,
): Promise<void> =>
  new Promise((resolve) => {
    if (pred(store.getState())) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      off();
      resolve();
    };
    const off = store.subscribe(() => {
      if (pred(store.getState())) {
        finish();
      }
    });
    const timer = setTimeout(finish, ms);
  });

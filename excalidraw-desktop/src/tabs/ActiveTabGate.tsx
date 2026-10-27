/**
 * Tabs: renders the "moved or deleted outside" placeholder while the active
 * tab is marked missing, else its children (the home screen). Subscribes to
 * the tab store itself, so VaultApp does not re-render for it.
 */
import { MissingTabPlaceholder } from "./MissingTabPlaceholder";
import { tabKindFor } from "./tabKinds";
import { TabKindView } from "./TabKindView";
import { useActiveTab } from "./tabStore";

import type { ReactNode } from "react";
import type { TabStore } from "./tabStore";
import type { OpenTarget } from "./types";

export interface ActiveTabGateProps {
  /** Absent when tabs are disabled: the children are always shown. */
  store?: TabStore;
  onClose?: () => void;
  onSearch?: (path: string) => void;
  /** Opens a file from a tab kind's view (a note link). */
  onOpenPath?: (path: string, opts?: { target?: OpenTarget }) => void;
  children: ReactNode;
}

const Gate = ({
  store,
  onClose,
  onSearch,
  onOpenPath,
  children,
}: ActiveTabGateProps & { store: TabStore }) => {
  const tab = useActiveTab(store);
  if (tab.missing && tab.path) {
    const { path } = tab;
    return (
      <MissingTabPlaceholder
        path={path}
        onClose={() => onClose?.()}
        onSearch={() => onSearch?.(path)}
      />
    );
  }
  const kind = tabKindFor(tab.path);
  if (kind && tab.path) {
    return (
      <TabKindView
        key={tab.id}
        kind={kind}
        path={tab.path}
        openPath={(path, opts) => onOpenPath?.(path, opts)}
      />
    );
  }
  return <>{children}</>;
};

export const ActiveTabGate = (props: ActiveTabGateProps) =>
  props.store ? <Gate {...props} store={props.store} /> : <>{props.children}</>;

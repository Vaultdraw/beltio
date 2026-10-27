/**
 * Tabs: renders the "moved or deleted outside" placeholder while the active
 * tab is marked missing, else its children (the home screen). Subscribes to
 * the tab store itself, so VaultApp does not re-render for it.
 */
import { useSyncExternalStore } from "react";

import { MissingTabPlaceholder } from "./MissingTabPlaceholder";

import { getTabKinds, subscribeTabKinds, tabKindFor } from "./tabKinds";
import { TabKindView } from "./TabKindView";
import { useActiveTab } from "./tabStore";

import type { ReactNode } from "react";
import type { TabStore } from "./tabStore";
import type { TabKindVault } from "./tabKinds";
import type { OpenTarget } from "./types";

export interface ActiveTabGateProps {
  /** Absent when tabs are disabled: the children are always shown. */
  store?: TabStore;
  onClose?: () => void;
  onSearch?: (path: string) => void;
  /** Opens a file from a tab kind's view (a note link). */
  onOpenPath?: (path: string, opts?: { target?: OpenTarget }) => void;
  /** The open vault, for a tab kind's view. */
  kindVault?: TabKindVault;
  /** Opens the vault search with a query (a note's tag chip). */
  onOpenSearch?: (query: string) => void;
  /** Tabs off: the file a tab kind shows instead of the children. */
  plainPath?: string | null;
  children: ReactNode;
}

const NO_VAULT: TabKindVault = { handle: null, paths: () => [] };

const Gate = ({
  store,
  onClose,
  onSearch,
  onOpenPath,
  kindVault,
  onOpenSearch,
  children,
}: ActiveTabGateProps & { store: TabStore }) => {
  // A kind registered later (an extension turned on) re-renders the gate.
  useSyncExternalStore(subscribeTabKinds, getTabKinds);
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
        openSearch={onOpenSearch}
        vault={kindVault ?? NO_VAULT}
      />
    );
  }
  return <>{children}</>;
};

const PlainKind = ({
  path,
  onOpenPath,
  onOpenSearch,
  kindVault,
  children,
}: ActiveTabGateProps & { path: string }) => {
  useSyncExternalStore(subscribeTabKinds, getTabKinds);
  const kind = tabKindFor(path);
  return kind ? (
    <TabKindView
      key={path}
      kind={kind}
      path={path}
      openPath={(p, opts) => onOpenPath?.(p, opts)}
      openSearch={onOpenSearch}
      vault={kindVault ?? NO_VAULT}
    />
  ) : (
    <>{children}</>
  );
};

export const ActiveTabGate = (props: ActiveTabGateProps) =>
  props.store ? (
    <Gate {...props} store={props.store} />
  ) : props.plainPath ? (
    <PlainKind {...props} path={props.plainPath} />
  ) : (
    <>{props.children}</>
  );

/**
 * Shows the view of a tab kind. The view's chunk loads on first use; a failed
 * load shows a message instead of a blank pane.
 */
import { lazy, Suspense } from "react";

import type { ComponentType } from "react";
import type { TabKind, TabKindViewProps } from "./tabKinds";

const lazyViews = new WeakMap<
  TabKind,
  ComponentType<TabKindViewProps>
>();

const viewOf = (kind: TabKind): ComponentType<TabKindViewProps> => {
  let view = lazyViews.get(kind);
  if (!view) {
    view = lazy(() =>
      kind.load().catch((err: unknown) => ({
        default: () => (
          <div className="tab-kind-error" role="alert">
            Could not load the {kind.id} view:{" "}
            {err instanceof Error ? err.message : String(err)}
          </div>
        ),
      })),
    );
    lazyViews.set(kind, view);
  }
  return view;
};

export const TabKindView = ({
  kind,
  ...props
}: TabKindViewProps & { kind: TabKind }) => {
  const View = viewOf(kind);
  return (
    <Suspense fallback={<div className="tab-kind-loading" aria-busy="true" />}>
      <View {...props} />
    </Suspense>
  );
};

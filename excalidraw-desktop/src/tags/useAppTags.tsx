/**
 * App-level tags wiring for VaultApp: the Tags commands and the lazy
 * "Rename tag" dialog. Nothing is imported or fetched until the user renames.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { registerCommandHandlers } from "../commands/handlerRegistry";

import { focusTagsPane, toggleTagSection, toggleTagSort } from "./tagActions";
import { runTagRename } from "./renameFlow";
import { tagStore } from "./tagStore";

import type { TagRef } from "../components/tags/RenameTagDialog";
import type { EditorLinksBridge } from "../editor/links/useVaultEditorLinks";
import type { ElementEdit, VaultLinks } from "../links/types";
import type { VaultTagRename } from "./types";

const RenameTagDialog = lazy(
  () => import("../components/tags/RenameTagDialog"),
);

export type AppTagsDeps = {
  api: VaultTagRename | null;
  links: Pick<VaultLinks, "onRewriteDone"> | null;
  handle: string | null;
  activePath: string | null;
  bridge: { current: EditorLinksBridge | null };
  flushActive(): Promise<unknown>;
  notify(message: string, type: "info" | "error"): void;
  doc: Document | null;
  /** `extensions.tags`: off = no tag commands and no rename dialog. */
  enabled?: boolean;
};

export function useAppTags(deps: AppTagsDeps) {
  const live = useRef(deps);
  live.current = deps;
  const [dialog, setDialog] = useState<{ initial: TagRef | null } | null>(null);

  const open = useCallback((initial: TagRef | null) => {
    if (live.current.api && live.current.handle) {
      setDialog({ initial });
    }
  }, []);
  const close = useCallback(() => setDialog(null), []);

  const enabled = deps.enabled ?? true;
  useEffect(
    () =>
      enabled
        ? registerCommandHandlers({
            "tags.rename": () => open(null),
            "tags.focusPane": focusTagsPane,
            "tags.toggleSort": toggleTagSort,
            "tags.toggleSection": toggleTagSection,
          })
        : undefined,
    [open, enabled],
  );

  const confirm = async (from: TagRef, to: string) => {
    const d = live.current;
    await runTagRename(
      {
        api: d.api!,
        links: d.links,
        handle: d.handle!,
        openPath: d.activePath,
        flush: async () => void (await d.flushActive()),
        applyEdits: (edits: ElementEdit[]) =>
          d.bridge.current?.applyEdits(edits) ?? 0,
        notify: d.notify,
      },
      from.key,
      to,
      from.display,
    );
    close();
  };

  const element =
    enabled && dialog && deps.api && deps.handle ? (
      <Suspense fallback={null}>
        <RenameTagDialog
          api={deps.api}
          handle={deps.handle}
          tags={tagStore.get}
          initial={dialog.initial}
          onConfirm={confirm}
          onCancel={close}
          ownerDocument={deps.doc}
        />
      </Suspense>
    ) : null;

  return {
    renameTag: (key: string, display: string) => open({ key, display }),
    dialog: element,
  };
}

/**
 * Template flows for VaultApp: "New from template…" picker and "Save as
 * template". Keeps state and dialogs out of VaultApp; the app supplies the
 * few things only it can do (create a document, flush, report errors).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { stripDrawingExt } from "../vault/fileKind";

import {
  errorMessage,
  type VaultInfo,
  type VaultRepository,
} from "../vault/types";

import { registerPurge } from "../memory/purgeRegistry";
import { registerCommandHandlers } from "../commands/handlerRegistry";

import { createGlobalTemplateStore } from "./globalTemplates";
import { instantiateTemplate } from "./instantiate";
import { readTemplateJson } from "./listTemplates";
import { saveAsTemplate } from "./saveTemplate";
import { SaveTemplateModal, type TemplateScope } from "./SaveTemplateModal";
import {
  TemplatePickerHost,
  type TemplatePickerHandle,
} from "./TemplatePickerHost";
import { createThumbnailRenderer } from "./thumbnails";
import { templateKey, type TemplateEntry } from "./types";

import type { GlobalTemplateStore } from "./types";

interface Options {
  repository: VaultRepository;
  vault: VaultInfo | null;
  folder: string;
  doc: Document | null;
  theme: "light" | "dark";
  activePath: string | null;
  flushActive: () => Promise<void>;
  /** Resolves (and creates) the parent folder for a new drawing; null = abort. */
  prepareParent: () => Promise<string | null>;
  createFromJson: (parent: string, name: string, json: string) => Promise<void>;
  newBlank: () => void;
  onError: (message: string) => void;
  /** `extensions.templates`: off = no picker, no save dialog, no renderer. */
  enabled?: boolean;
}

export function useTemplates(o: Options) {
  const enabled = o.enabled ?? true;
  const globalStore = useRef<GlobalTemplateStore | null>(null);
  const renderer = useRef<ReturnType<typeof createThumbnailRenderer> | null>(
    null,
  );
  if (enabled) {
    globalStore.current ??= createGlobalTemplateStore();
    renderer.current ??= createThumbnailRenderer();
  }
  useEffect(() => {
    if (!enabled) {
      // Turned off live: drop what the picker cached.
      renderer.current?.clear();
      return undefined;
    }
    return registerPurge("templateThumbnails", () => renderer.current?.clear());
  }, [enabled]);
  // command audit (S8): "Templates: Open the global templates folder".
  useEffect(
    () =>
      enabled
        ? registerCommandHandlers({
            "templates.revealGlobal": () => void globalStore.current?.reveal(),
          })
        : undefined,
    [enabled],
  );

  const pickerRef = useRef<TemplatePickerHandle>(null);
  const [saveTarget, setSaveTarget] = useState<string | null>(null);
  const { vault, folder, repository } = o;

  const deps = useMemo(
    () =>
      vault && enabled
        ? {
            repository,
            handle: vault.handle,
            folder,
            global: globalStore.current!,
          }
        : null,
    [vault, folder, repository, enabled],
  );

  const openPicker = useCallback(() => pickerRef.current?.open(), []);

  const pick = useCallback(
    async (entry: TemplateEntry) => {
      if (!deps) {
        return;
      }
      try {
        const json = instantiateTemplate(await readTemplateJson(entry, deps), {
          theme: o.theme,
        });
        const parent = await o.prepareParent();
        if (parent === null) {
          return;
        }
        const stamp = Date.now().toString().slice(-4);
        await o.createFromJson(
          parent,
          `${entry.name}-${stamp}.excalidraw`,
          json,
        );
      } catch (err) {
        o.onError(
          `Couldn't create a drawing from the template: ${errorMessage(err)}`,
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps, o.theme, o.prepareParent, o.createFromJson, o.onError],
  );

  const requestSave = useCallback((path: string | null) => {
    if (path) {
      setSaveTarget(path);
    }
  }, []);

  const save = async (name: string, scope: TemplateScope) => {
    if (!deps || !saveTarget) {
      return;
    }
    if (saveTarget === o.activePath) {
      await o.flushActive();
    }
    const file = await repository.readDrawing(deps.handle, saveTarget);
    await saveAsTemplate({ ...deps, scope, name, json: file.json });
    setSaveTarget(null);
  };

  const dialogs: ReactNode = (
    <>
      {deps && o.doc && vault && (
        <TemplatePickerHost
          ref={pickerRef}
          deps={deps}
          ownerDocument={o.doc}
          vaultName={vault.name}
          templatesFolder={folder}
          renderThumbnail={(t) =>
            renderer.current!.request(templateKey(t), () =>
              readTemplateJson(t, deps),
            )
          }
          cancelThumbnail={(t) => renderer.current!.cancel(templateKey(t))}
          onPick={(t) => void pick(t)}
          onBlank={vault.readOnly ? undefined : o.newBlank}
          onRevealGlobal={() => void globalStore.current!.reveal()}
        />
      )}
      {enabled && saveTarget && vault && (
        <SaveTemplateModal
          defaultName={stripDrawingExt(saveTarget.split("/").pop()!)}
          ownerDocument={o.doc}
          readOnlyVault={vault.readOnly}
          onSave={save}
          onCancel={() => setSaveTarget(null)}
        />
      )}
    </>
  );

  return { openPicker, requestSave, dialogs };
}

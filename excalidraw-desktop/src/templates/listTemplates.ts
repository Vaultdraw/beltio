import { DRAWING_EXT } from "../vault/fileKind";
import { errorMessage, type VaultRepository } from "../vault/types";

import type { GlobalTemplateStore, TemplateEntry } from "./types";

const EXT = DRAWING_EXT;

const byName = (a: TemplateEntry, b: TemplateEntry) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
  a.name.localeCompare(b.name);

const stripExt = (file: string) =>
  file.toLowerCase().endsWith(EXT) ? file.slice(0, -EXT.length) : file;

export interface TemplateDeps {
  repository: VaultRepository;
  handle: string;
  folder: string;
  global: GlobalTemplateStore;
}

const listVault = async ({
  repository,
  handle,
  folder,
}: TemplateDeps): Promise<TemplateEntry[]> => {
  let entries;
  try {
    entries = await repository.listDirectory(handle, folder);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "NOT_FOUND") {
      return [];
    }
    throw err;
  }
  return entries
    .filter((e) => e.kind === "drawing")
    .map((e) => ({
      source: "vault" as const,
      path: e.path,
      name: stripExt(e.name),
      modifiedAt: e.modifiedAt,
      size: e.size,
    }))
    .sort(byName);
};

const listGlobal = async (
  global: GlobalTemplateStore,
): Promise<TemplateEntry[]> =>
  (await global.list())
    .filter((e) => e.name.toLowerCase().endsWith(EXT))
    .map((e) => ({
      source: "global" as const,
      path: e.name,
      name: stripExt(e.name),
      modifiedAt: e.modifiedAt,
      size: e.size,
    }))
    .sort(byName);

export async function listTemplates(deps: TemplateDeps): Promise<{
  vault: TemplateEntry[];
  global: TemplateEntry[];
  vaultError?: string;
}> {
  const [vault, global] = await Promise.allSettled([
    listVault(deps),
    listGlobal(deps.global),
  ]);
  if (global.status === "rejected") {
    throw global.reason;
  }
  return {
    vault: vault.status === "fulfilled" ? vault.value : [],
    global: global.value,
    ...(vault.status === "rejected"
      ? { vaultError: errorMessage(vault.reason) }
      : {}),
  };
}

export async function readTemplateJson(
  entry: TemplateEntry,
  deps: Pick<TemplateDeps, "repository" | "handle" | "global">,
): Promise<string> {
  return entry.source === "global"
    ? deps.global.read(entry.path)
    : (await deps.repository.readDrawing(deps.handle, entry.path)).json;
}

/** True when `path` is the templates folder or lies under it. */
export const isInTemplatesFolder = (path: string, folder: string): boolean =>
  folder !== "" && (path === folder || path.startsWith(`${folder}/`));

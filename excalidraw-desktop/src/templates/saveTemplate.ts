import { DRAWING_EXT } from "../vault/fileKind";
import { ensureFolder } from "../vault/newDrawing";
import { getCleanDrawingName, validateEntryName } from "../vault/treeStore";
import { joinPath } from "../vault/types";

import { listTemplates, type TemplateDeps } from "./listTemplates";

import type { TemplateEntry } from "./types";

const EXT = DRAWING_EXT;
const MAX_ATTEMPTS = 50;

export async function saveAsTemplate(
  input: TemplateDeps & {
    scope: "vault" | "global";
    name: string;
    json: string;
  },
): Promise<TemplateEntry> {
  const { repository, handle, folder, global, scope, json } = input;
  const base = getCleanDrawingName(input.name);
  const validation = validateEntryName(base, "drawing");
  if (!validation.valid) {
    throw new Error(validation.error ?? "Invalid name");
  }

  const listing = await listTemplates({ repository, handle, folder, global });
  const taken = new Set(
    (scope === "vault" ? listing.vault : listing.global).map((e) =>
      e.name.toLowerCase(),
    ),
  );
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    if (n > MAX_ATTEMPTS) {
      throw new Error("Could not find a free template name");
    }
    name = `${base} ${n}`;
  }
  const file = `${name}${EXT}`;

  if (scope === "global") {
    await global.write(file, json);
    const info = (await global.list()).find((e) => e.name === file);
    return {
      source: "global",
      path: file,
      name,
      modifiedAt: info?.modifiedAt ?? Date.now(),
      size: info?.size ?? json.length,
    };
  }
  if (folder) {
    await ensureFolder(repository, handle, folder);
  }
  const path = joinPath(folder, file);
  await repository.writeDrawing({
    handle,
    path,
    json,
    expectedRevision: null,
    operationId: `template:${path}:${Date.now()}`,
  });
  return {
    source: "vault",
    path,
    name,
    modifiedAt: Date.now(),
    size: json.length,
  };
}

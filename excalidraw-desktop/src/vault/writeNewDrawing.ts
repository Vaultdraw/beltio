import { getBaseName } from "./treeStore";

import type { VaultRepository } from "./types";

type NewDrawing = {
  handle: string;
  path: string;
  json: string;
  operationId: string;
};

/**
 * Creates a drawing that must not exist yet (new drawing, template, duplicate, copy, imported page).
 * The backend answers a taken name with the same CONFLICT it uses for a stale save, whose text
 * ("Drawing changed on disk") means nothing to someone who typed a name; this says what happened.
 */
export async function writeNewDrawing(
  repository: Pick<VaultRepository, "writeDrawing">,
  input: NewDrawing,
): Promise<{ revision: string }> {
  try {
    return await repository.writeDrawing({ ...input, expectedRevision: null });
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "CONFLICT") {
      throw Object.assign(
        new Error(
          `A file named “${getBaseName(input.path)}” already exists here.`,
        ),
        { code: "NAME_COLLISION" },
      );
    }
    throw error;
  }
}

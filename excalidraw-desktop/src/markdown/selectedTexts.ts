/**
 * The texts a selection-scoped Markdown command acts on: every selected text,
 * plus the label of every selected shape or arrow (a click on a labelled shape
 * selects the shape, not its label). Each text once, in scene order.
 */
type SceneElement = {
  id: string;
  type: string;
  isDeleted?: boolean;
  containerId?: string | null;
};

export function selectedTexts<T extends SceneElement>(
  elements: readonly T[],
  selectedIds: Readonly<Record<string, boolean | undefined>>,
): T[] {
  return elements.filter(
    (e) =>
      e.type === "text" &&
      !e.isDeleted &&
      (selectedIds[e.id] || (!!e.containerId && selectedIds[e.containerId])),
  );
}

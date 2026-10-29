/**
 * The picture boxes a Markdown import left in a drawing, read from the saved JSON. The import
 * plugin finds the same boxes in the open drawing (plugins/official/markdown-import/src/boxes.ts
 * `pairBoxes`); both are pinned by one case table, test/fixtures/placeholder-boxes.json there.
 *
 * A box is a linked rectangle with a free text inside it, the text linked to the same address
 * (every import before 2026-10-30) or not linked (newer ones). Old imports wrote the bare alt text
 * as the label, newer ones a reason first ("Web image: ..."); every style is matched (#108).
 */
type El = Record<string, unknown>;

const num = (v: unknown) => (typeof v === "number" ? v : NaN);

export const placeholderBoxes = (
  elements: readonly El[],
): { box: El; label: El; link: string }[] => {
  const live = elements.filter((e) => e.isDeleted !== true);
  const texts = live.filter((e) => e.type === "text" && !e.containerId);
  const out: { box: El; label: El; link: string }[] = [];
  for (const box of live) {
    const link = box.link;
    if (box.type !== "rectangle" || typeof link !== "string" || !link) {
      continue;
    }
    const [x, y] = [num(box.x), num(box.y)];
    const [right, bottom] = [x + num(box.width), y + num(box.height)];
    const inside = texts.filter(
      (t) =>
        num(t.x) >= x &&
        num(t.y) >= y &&
        num(t.x) < right &&
        num(t.y) < bottom &&
        (t.link === link || !t.link),
    );
    const label =
      inside.find((t) => t.link === link) ??
      (inside.length === 1 ? inside[0] : undefined);
    if (label) {
      out.push({ box, label, link });
    }
  }
  return out;
};

/** How many boxes stand for a web picture (https, http or data address). */
export const webPictureBoxes = (scene: { elements?: El[] }): number =>
  placeholderBoxes(scene.elements ?? []).filter((b) =>
    /^(?:https?:|data:)/i.test(b.link),
  ).length;

/**
 * Parts: a long note becomes several drawings of about `partElements`
 * elements each (review verdict table B: about 1,000, a `config.toml` key),
 * because opening a 4,000-element drawing is slow on a low-end Mac. The cut
 * falls on a level-1 or level-2 heading once a part is half full, or
 * wherever the budget runs out when no such heading comes. Decided as the
 * stream goes, so the first part streams before the rest is known.
 */
import type { Mapped } from "./blocks";

export class PartCutter {
  private count = 0;
  /** Nesting depth of open containers; parts never cut inside one. */
  private depth = 0;

  constructor(private readonly budget: number) {}

  /** True when a new part should start before this item. Call for every item, in order. */
  consider(item: Mapped): boolean {
    if (item.kind === "open") {
      this.depth++;
    } else if (item.kind === "close") {
      this.depth--;
      return false;
    }
    let cut = false;
    if (this.depth === 0 || (item.kind === "open" && this.depth === 1)) {
      const atHeading = item.kind === "text" && item.cut !== undefined;
      cut =
        this.count > 0 &&
        ((atHeading && this.count >= this.budget / 2) ||
          this.count >= this.budget);
    }
    if (cut) {
      this.count = 0;
    }
    this.count += estimate(item);
    return cut;
  }
}

/** Elements an item will roughly become (a text is one; a box adds one per page it spans). */
const estimate = (item: Mapped): number => {
  switch (item.kind) {
    case "text":
    case "list":
    case "image":
    case "rule":
    case "open":
      return 1;
    case "table":
      return (
        (item.rows.length + 1) * Math.max(item.header.length, 1) +
        item.rows.length +
        item.header.length +
        2
      );
    default:
      return 0;
  }
};

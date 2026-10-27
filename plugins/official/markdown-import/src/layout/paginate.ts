/**
 * Greedy pagination, streaming. The rules are those of the SDK paginator
 * (sdk/api/shared/pages.ts `flowPages`: an entry that does not fit goes to
 * the next page; a keep-with-next chain that fits on one page but not on
 * the rest of this one moves as a whole; a chain taller than a page breaks
 * inside once its first entry fits). `flowPages` needs every entry up
 * front; this one takes entries as blocks are mapped and hands back each
 * page as soon as the next entry lands on a later page, so the first page
 * leaves the worker before the rest of the note is wrapped.
 * test/layout/paginate.test.ts checks both give the same page numbers.
 *
 * Entries are lines (a text block is one entry per wrapped line, so long
 * blocks split between pages by line) or whole items (images, rules).
 */
import type { Role } from "./fonts";
import type { Fill } from "./blocks";
import type { PageItem, PageItemText } from "./types";

/** A box drawn behind the entries it contains (code, quote, callout, table). */
export interface Container {
  fill: Fill;
  parent: Container | null;
  /** Left edge from the content left, scene pixels. */
  x: number;
  width: number;
  /** Set when the container closes; an open container's box runs to its last entry on the page. */
  closed: boolean;
}

/** One wrapped text block; its lines are entries that point back here. */
export interface TextBlock {
  role: Role;
  x: number;
  width: number;
  tone?: PageItemText["tone"];
  link?: string;
  data?: Record<string, unknown>;
}

export type EntryPayload =
  | { kind: "line"; block: TextBlock; text: string }
  | {
      kind: "image";
      x: number;
      width: number;
      target: string;
      mimeType: string;
      alt?: string;
    }
  | { kind: "rule"; x: number; width: number };

export interface Entry {
  /** The slot the entry takes on the page, container padding included. */
  height: number;
  /** Where the content starts inside the slot. */
  offset: number;
  spaceBefore: number;
  keepWithNext: boolean;
  container: Container | null;
  payload: EntryPayload;
}

interface Placed {
  entry: Entry;
  y: number;
}

export interface PageMargins {
  top: number;
  left: number;
}

export interface CompletedPage {
  page: number;
  items: PageItem[];
}

export class Paginator {
  private readonly capacity: number;
  private readonly margins: PageMargins;
  private buffer: Entry[] = [];
  private page = 0;
  private y = 0;
  private empty = true;
  /** Entries up to this index of the buffer belong to a chain known to fit. */
  private keepUntil = -1;
  private current: Placed[] = [];
  private pageCount = 0;

  constructor(contentHeight: number, margins: PageMargins) {
    if (!(contentHeight > 0)) {
      throw new Error("contentHeight must be more than 0");
    }
    this.capacity = contentHeight;
    this.margins = margins;
  }

  /** Pages completed so far, the one being filled excluded. */
  get completedPages() {
    return this.pageCount;
  }

  push(entry: Entry) {
    this.buffer.push(entry);
  }

  /** The last entry pushed and not yet placed, if any (to add padding). */
  lastPending(): Entry | undefined {
    return this.buffer[this.buffer.length - 1];
  }

  /**
   * Places every buffered entry whose keep-with-next chain is resolved and
   * returns the pages completed by doing so.
   */
  flush(final = false): CompletedPage[] {
    const done: CompletedPage[] = [];
    const buf = this.buffer;
    let i = 0;
    while (i < buf.length) {
      const chain = this.chain(i, final);
      if (chain === null) {
        break;
      }
      const it = buf[i];
      if (!this.empty) {
        const room = this.capacity - this.y - it.spaceBefore;
        const moves =
          i > this.keepUntil &&
          chain.height > room &&
          (chain.height <= this.capacity || it.height > room);
        if (moves) {
          done.push(this.complete());
        }
      }
      if (
        it.keepWithNext &&
        i > this.keepUntil &&
        chain.height <= this.capacity
      ) {
        this.keepUntil = chain.last;
      }
      if (!this.empty) {
        this.y += it.spaceBefore;
      }
      this.current.push({ entry: it, y: this.y });
      this.y += it.height;
      this.empty = false;
      i++;
    }
    if (i > 0) {
      this.buffer = buf.slice(i);
      this.keepUntil -= i;
    }
    if (final && this.current.length) {
      done.push(this.complete());
    }
    return done;
  }

  /**
   * Height and last index of the chain at `i`, or null while entries it
   * depends on have not arrived (`final` treats the buffer end as the end).
   */
  private chain(
    i: number,
    final: boolean,
  ): { height: number; last: number } | null {
    const buf = this.buffer;
    let h = buf[i].height;
    let j = i;
    while (buf[j].keepWithNext && h <= this.capacity) {
      if (j + 1 >= buf.length) {
        if (final) {
          break;
        }
        return null;
      }
      h += buf[j + 1].spaceBefore + buf[j + 1].height;
      j++;
    }
    return { height: h, last: j };
  }

  private complete(): CompletedPage {
    const page = this.assemble(this.page, this.current);
    this.current = [];
    this.page++;
    this.pageCount++;
    this.y = 0;
    this.empty = true;
    return page;
  }

  /** Builds the page's items: boxes first (behind), then texts, images and rules. */
  private assemble(page: number, placed: Placed[]): CompletedPage {
    const { top, left } = this.margins;
    const items: PageItem[] = [];
    // Container boxes: the span of their entries on this page.
    const boxes = new Map<Container, { y0: number; y1: number }>();
    const order: Container[] = [];
    for (const { entry, y } of placed) {
      for (let c = entry.container; c; c = c.parent) {
        const box = boxes.get(c);
        if (box) {
          box.y1 = Math.max(box.y1, y + entry.height);
        } else {
          boxes.set(c, { y0: y, y1: y + entry.height });
          order.push(c);
        }
      }
    }
    // Outer boxes first so inner ones draw on top.
    order.sort((a, b) => depth(a) - depth(b));
    for (const c of order) {
      const box = boxes.get(c)!;
      items.push({
        type: "rect",
        page,
        x: left + c.x,
        y: top + box.y0,
        width: c.width,
        height: box.y1 - box.y0,
        fill: c.fill,
      });
    }
    let run: { block: TextBlock; y: number; lines: string[] } | null = null;
    const endRun = () => {
      if (!run) {
        return;
      }
      const { block, y, lines } = run;
      const item: PageItemText = {
        type: "text",
        page,
        x: left + block.x,
        y: top + y,
        width: block.width,
        height: lines.length * block.role.linePx,
        text: lines.join("\n"),
        fontSize: block.role.size,
        fontFamily: block.role.family,
        lineHeight: block.role.lineHeight,
      };
      if (block.tone) {
        item.tone = block.tone;
      }
      if (block.link) {
        item.link = block.link;
      }
      if (block.data) {
        item.data = block.data;
      }
      items.push(item);
      run = null;
    };
    for (const { entry, y } of placed) {
      const p = entry.payload;
      if (p.kind === "line") {
        if (run && run.block === p.block) {
          run.lines.push(p.text);
        } else {
          endRun();
          run = { block: p.block, y: y + entry.offset, lines: [p.text] };
        }
        continue;
      }
      endRun();
      if (p.kind === "image") {
        items.push({
          type: "image",
          page,
          x: left + p.x,
          y: top + y + entry.offset,
          width: p.width,
          height: entry.height - entry.offset,
          mimeType: p.mimeType,
          target: p.target,
          ...(p.alt ? { alt: p.alt } : {}),
        });
      } else {
        items.push({
          type: "line",
          page,
          x: left + p.x,
          y: top + y + entry.height / 2,
          width: p.width,
          height: 0,
        });
      }
    }
    endRun();
    return { page, items };
  }
}

const depth = (c: Container): number => (c.parent ? depth(c.parent) + 1 : 0);

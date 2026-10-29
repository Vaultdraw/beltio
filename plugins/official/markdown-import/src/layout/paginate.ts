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
import { CELL_PAD_Y } from "./tableGrid";

import type { Role } from "./fonts";
import type { Fill } from "./blocks";
import type { TableGrid } from "./tableGrid";
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
  | { kind: "rule"; x: number; width: number }
  | { kind: "tableRow"; x: number; grid: TableGrid; row: number };

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
  /** Tables drawn so far: each table part's group name. */
  private tables = 0;

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

  /** A table's rows on one page: header shade, border, grid lines, then one text per cell. */
  private tableItems(
    page: number,
    grid: TableGrid,
    tx: number,
    rows: Placed[],
  ): PageItem[] {
    const { top, left } = this.margins;
    const x0 = left + tx;
    const first = rows[0];
    const y0 = top + first.y + first.entry.offset;
    const last = rows[rows.length - 1];
    const y1 =
      top +
      last.y +
      last.entry.offset +
      grid.rowH[(last.entry.payload as { row: number }).row];
    const out: PageItem[] = [];
    const cols = grid.colX.length - 1;
    // The table's part on this page moves as one: its own group.
    const group = `table-${this.tables++}`;
    for (const { entry, y } of rows) {
      const r = (entry.payload as { row: number }).row;
      if (grid.header && r === 0) {
        out.push({
          type: "rect",
          page,
          x: x0,
          y: top + y + entry.offset,
          width: grid.width,
          height: grid.rowH[r],
          fill: "code",
          stroke: "none",
          group,
        });
      }
    }
    out.push({
      type: "rect",
      page,
      x: x0,
      y: y0,
      width: grid.width,
      height: y1 - y0,
      fill: "none",
      stroke: "thin",
      group,
    });
    for (const { entry, y } of rows.slice(1)) {
      const r = (entry.payload as { row: number }).row;
      out.push({
        type: "line",
        page,
        x: x0,
        y: top + y,
        width: grid.width,
        height: 0,
        // The rule under the header is heavier, as the table plugin draws it: no bold text.
        ...(grid.header && r === 1 ? { strong: true } : {}),
        group,
      });
    }
    for (let c = 1; c < cols; c++) {
      out.push({
        type: "line",
        page,
        x: x0 + grid.colX[c],
        y: y0,
        width: 0,
        height: y1 - y0,
        group,
      });
    }
    const role = grid.role;
    for (const { entry, y } of rows) {
      const r = (entry.payload as { row: number }).row;
      for (let c = 0; c < cols; c++) {
        const lines = grid.lines[r][c];
        if (lines.length === 0) {
          continue;
        }
        const item: PageItemText = {
          type: "text",
          page,
          x: x0 + grid.colX[c] + grid.padX,
          y: top + y + entry.offset + CELL_PAD_Y,
          width: grid.colX[c + 1] - grid.colX[c] - 2 * grid.padX,
          height: lines.length * role.linePx,
          text: lines.join("\n"),
          fontSize: role.size,
          fontFamily: role.family,
          lineHeight: role.lineHeight,
          align: grid.align[c],
          group,
        };
        out.push(item);
      }
    }
    return out;
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
      // A quote gets an accent bar down its left edge, as Obsidian draws it.
      if (c.fill === "quote") {
        items.push({
          type: "rect",
          page,
          x: left + c.x,
          y: top + box.y0,
          width: QUOTE_BAR,
          height: box.y1 - box.y0,
          fill: "bar",
        });
      }
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
    for (let k = 0; k < placed.length; k++) {
      const { entry, y } = placed[k];
      const p = entry.payload;
      if (p.kind === "tableRow") {
        endRun();
        // The rows of this table on the page, drawn together.
        const rows: Placed[] = [placed[k]];
        while (
          k + 1 < placed.length &&
          placed[k + 1].entry.payload.kind === "tableRow" &&
          (placed[k + 1].entry.payload as { grid: TableGrid }).grid === p.grid
        ) {
          rows.push(placed[++k]);
        }
        items.push(...this.tableItems(page, p.grid, p.x, rows));
        continue;
      }
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

/** Width of a quote's left bar, scene pixels. */
export const QUOTE_BAR = 3;

const depth = (c: Container): number => (c.parent ? depth(c.parent) + 1 : 0);

/**
 * Messages between the plugin's main code and its layout worker. One
 * request per worker; cancel by terminating it.
 */
import type { NoteDoc } from "@vaultdraw/api";
import type { LayoutEvent, LayoutOptions } from "../layout/types";
import type { WidthTable } from "../layout/widthTable";

export interface LayoutRequest {
  type: "layout";
  doc: NoteDoc;
  table: WidthTable;
  opts: LayoutOptions;
}

export type WorkerReply = LayoutEvent | { type: "error"; message: string };

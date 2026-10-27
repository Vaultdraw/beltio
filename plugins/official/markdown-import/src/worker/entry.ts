/**
 * The layout worker. Bundled on its own by the plugin build (see
 * esbuild.mjs) into a string the main bundle spawns as a Blob worker, so
 * the plugin stays one file. No fonts, canvas or DOM here: the width table
 * carries every measurement.
 */
import { layoutNoteStream } from "../layout/index";

import type { LayoutRequest, WorkerReply } from "./protocol";

declare const self: Worker;

const post = (reply: WorkerReply) => self.postMessage(reply);

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const req = event.data;
  if (!req || req.type !== "layout") {
    post({ type: "error", message: "Unknown request" });
    return;
  }
  try {
    for (const ev of layoutNoteStream(req.doc, req.table, req.opts)) {
      post(ev);
    }
  } catch (err) {
    post({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

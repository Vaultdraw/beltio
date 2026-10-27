/// <reference lib="webworker" />
/** Layout worker: a thin shell around LayoutHost (see layoutHost.ts for the protocol). */
import { LayoutHost, type ToLayout } from "./layoutHost";

const channel = new MessageChannel();
let timer: ReturnType<typeof setTimeout> | null = null;
const host: LayoutHost = new LayoutHost(
  (msg, transfer) => self.postMessage(msg, transfer),
  (delayMs) => {
    if (delayMs > 0) {
      timer = setTimeout(() => {
        timer = null;
        host.run();
      }, delayMs);
    } else {
      channel.port2.postMessage(0);
    }
  },
  undefined,
  undefined,
  undefined,
  () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  },
);
// Ticks run on their own channel so incoming drag/settings messages interleave between slices.
channel.port1.onmessage = () => host.run();
self.onmessage = (e: MessageEvent<ToLayout>) => host.handle(e.data);

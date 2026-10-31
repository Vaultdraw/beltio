/**
 * `ctx.clipboard` of the mock host: a text you set, paste handlers you call with `paste`, the
 * permission `clipboard` checked first. Toast buttons are kept so a test can click one.
 */
import { permissionError } from "../shared/vaultPaths";

import type { Disposable, PasteResult } from "@vaultdraw/api";

export interface FakeClipboard {
  /** What `ctx.clipboard.readText()` returns. */
  text: string;
  /**
   * Pastes text as the editor does: runs the plugin's paste handlers (multi-line text only);
   * resolves true when one returned "handled" (the editor would then skip its own paste).
   */
  paste(text: string): Promise<boolean>;
  /** The toasts that carry a button, newest last. */
  toastButtons(): { message: string; label: string }[];
  /** Clicks the button labelled `label`; false when none shows. */
  clickToast(label: string): boolean;
}

export function createClipboardModel() {
  let activate: (() => Promise<unknown>) | null = null;
  const handlers = new Set<
    (e: { text: string }) => PasteResult | Promise<PasteResult>
  >();
  let buttons: { message: string; label: string; run: () => void }[] = [];
  const fake: FakeClipboard = {
    text: "",
    async paste(text) {
      if (!text.includes("\n")) {
        return false;
      }
      // As in the app: the first multi-line paste activates a plugin that declares onPaste.
      await activate?.();
      for (const h of [...handlers]) {
        if ((await h({ text })) === "handled") {
          return true;
        }
      }
      return false;
    },
    toastButtons: () =>
      buttons.map(({ message, label }) => ({ message, label })),
    clickToast(label) {
      const b = buttons.find((x) => x.label === label);
      if (!b) {
        return false;
      }
      buttons = buttons.filter((x) => x !== b);
      b.run();
      return true;
    },
  };
  return {
    fake,
    /** Called before the handlers run (the host activates the plugin). */
    setActivator(fn: (() => Promise<unknown>) | null) {
      activate = fn;
    },
    addToastButton(message: string, label: string, run: () => void) {
      buttons = [...buttons.slice(-2), { message, label, run }];
    },
    api(id: string, permissions: readonly string[]) {
      const need = (method: string) => {
        if (!permissions.includes("clipboard")) {
          throw permissionError(id, method, "clipboard");
        }
      };
      return {
        async readText() {
          need("clipboard.readText");
          return fake.text;
        },
        onPaste(
          cb: (e: { text: string }) => PasteResult | Promise<PasteResult>,
        ): Disposable {
          need("clipboard.onPaste");
          handlers.add(cb);
          return { dispose: () => void handlers.delete(cb) };
        },
      };
    },
    reset() {
      handlers.clear();
      buttons = [];
      fake.text = "";
    },
  };
}

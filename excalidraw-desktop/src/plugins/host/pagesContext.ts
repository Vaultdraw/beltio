/**
 * `ctx.pages` (API 0.9.0): geometry and flow (shared rules) plus page
 * documents. `createDocument` writes a tiny page-mode stub through the shell
 * (`WorkspaceBridge.createDrawing`, the "New drawing" path), which opens it
 * from memory; `append` queues items and one frame applies everything queued
 * with ONE `updateScene` (`CaptureUpdateAction.NEVER`: no undo entries, no
 * history churn); the app's autosave runs as for typing; `finish` saves once
 * more. Nothing here runs until a plugin reads `ctx.pages`.
 */
import { serializeAsJSON } from "@excalidraw/excalidraw";
import { CaptureUpdateAction } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";

import {
  checkPageCount,
  checkPageItems,
  imagesToHash,
  pageSetupFor,
} from "../../../../sdk/api/shared/pageItems";
import { flowPages, pageGeometry } from "../../../../sdk/api/shared/pages";
import { PluginApiError } from "../../../../sdk/api/shared/rules";
import { checkVaultPath } from "../../../../sdk/api/shared/vaultPaths";
import { stampElements } from "../../importUpgrade/stamp";
import { buildPageItems, hashPageItemImages } from "../../sceneOps/pageText";
import { getActiveScene } from "../../sceneOps/sceneBus";
import { getWorkspaceBridge } from "../workspaceBridge";

import type { ImportDrawingLook } from "../../vault/newDrawingPaper";

import type {
  CreateDocumentOptions,
  Disposable,
  PageDocument,
  PageItem,
  PageRequest,
  PagesApi,
} from "../api";

type Track = (fn: () => void) => Disposable;

/** Names up to this many characters, so the path stays under the vault limit. */
const MAX_NAME = 200;

const bad = (message: string) =>
  new PluginApiError("INVALID_ARGUMENT", message);

const checkName = (name: unknown): string => {
  if (typeof name !== "string" || name.trim() === "") {
    throw bad("name must be a non-empty string");
  }
  if (name.length > MAX_NAME || name.includes("/") || name.startsWith(".")) {
    throw bad(
      `name must be at most ${MAX_NAME} characters, with no "/" and no leading dot`,
    );
  }
  if (name.toLowerCase().endsWith(".excalidraw")) {
    throw bad("name is given without the .excalidraw extension");
  }
  return name;
};

const checkSetup = (setup: unknown): PageRequest | undefined => {
  if (setup === undefined) {
    return undefined;
  }
  pageGeometry(setup as PageRequest); // throws INVALID_ARGUMENT
  return setup as PageRequest;
};

const filesRecord = (files: readonly { id: string }[]): BinaryFiles =>
  Object.fromEntries(files.map((f) => [f.id, f])) as unknown as BinaryFiles;

/**
 * `.excalidraw` JSON for elements and pictures, page mode on, as the app saves it.
 * `look` (the host's import look) gives the drawing the paper and tool defaults a
 * new drawing gets; without it the editor's plain defaults stay.
 */
const sceneJson = (
  elements: readonly unknown[],
  files: readonly { id: string }[],
  setup: PageRequest | undefined,
  pageCount: number,
  look?: ImportDrawingLook,
): string => {
  // Every element written by an import carries its edit stamp (importUpgrade/stamp.ts, A-2).
  stampElements(elements);
  const pageSetup = pageSetupFor(setup, pageCount);
  const { paperTheme, ...rest } = look ?? {};
  const appState = {
    ...rest,
    pageSetup: paperTheme ? { ...pageSetup, paperTheme } : pageSetup,
  };
  return serializeAsJSON(
    elements as never,
    appState as never,
    filesRecord(files),
    "local",
  );
};

/** One `append` call: items plus their image hashes once known. */
interface Chunk {
  items: readonly PageItem[];
  fileIds?: ReadonlyMap<object, string>;
}

export interface PagesOptions {
  dataKey: string;
  /** `requestAnimationFrame` of the app window. */
  frame: (cb: () => void) => void;
}

export function createPagesApi(
  track: Track,
  isLive: () => boolean,
  options: PagesOptions,
): PagesApi {
  const { dataKey, frame } = options;

  /**
   * Appends in order even when some chunks wait for hashing: a chunk without
   * pictures goes straight to the queue while nothing is being hashed.
   */
  const makeIntake = (deliver: (chunk: Chunk) => void) => {
    let hashing: Promise<void> = Promise.resolve();
    let inFlight = 0;
    let stopped = false;
    return {
      take(items: readonly PageItem[]) {
        if (imagesToHash(items).length === 0 && inFlight === 0) {
          deliver({ items });
          return;
        }
        inFlight++;
        hashing = hashing.then(async () => {
          try {
            const fileIds = await hashPageItemImages(items);
            if (!stopped) {
              deliver({ items, fileIds });
            }
          } finally {
            inFlight--;
          }
        });
      },
      /** Resolves once every chunk taken so far is delivered. */
      settled: () => hashing,
      stop() {
        stopped = true;
      },
    };
  };

  const createDocument = async (
    opts: CreateDocumentOptions,
  ): Promise<PageDocument> => {
    if (!opts || typeof opts !== "object") {
      throw bad("options must be an object");
    }
    const name = checkName(opts.name);
    const setup = checkSetup(opts.setup);
    const open = opts.open !== false;
    const bridge = getWorkspaceBridge();
    const vault = bridge?.vault();
    if (!bridge || !vault) {
      throw new PluginApiError("NO_VAULT", "No vault is open");
    }
    if (vault.readOnly) {
      throw new PluginApiError("READ_ONLY", "The vault is read-only");
    }
    let parent: string;
    if (opts.parent !== undefined) {
      parent = checkVaultPath(opts.parent, "folder");
    } else {
      const resolved = await bridge.newDrawingParent();
      if (resolved === null) {
        throw new PluginApiError("NO_VAULT", "No vault is open");
      }
      parent = resolved;
    }
    // De-duplicate: "Note (imported)", "Note (imported) 2", ...
    const fileName = async () => {
      for (let n = 1; ; n++) {
        const candidate = `${name}${n === 1 ? "" : ` ${n}`}.excalidraw`;
        const path = parent ? `${parent}/${candidate}` : candidate;
        if (!(await bridge.drawingExists(path))) {
          return { candidate, path };
        }
      }
    };
    const { candidate, path } = await fileName();
    if (!isLive()) {
      throw new PluginApiError("INVALID_ARGUMENT", "the plugin was stopped");
    }
    return open
      ? liveSession(bridge, parent, candidate, path, setup)
      : memorySession(bridge, path, setup);
  };

  /** The drawing is open in the editor: items land through `updateScene`, one frame at a time. */
  /** How long a new document waits for its editor to become the active scene. */
  const MOUNT_WAIT_MS = 10_000;

  const liveSession = async (
    bridge: NonNullable<ReturnType<typeof getWorkspaceBridge>>,
    parent: string,
    fileName: string,
    path: string,
    setup: PageRequest | undefined,
  ): Promise<PageDocument> => {
    await bridge.createDrawing(
      parent,
      fileName,
      sceneJson([], [], setup, 1, bridge.importLook?.()),
    );
    let queue: Chunk[] = [];
    let pageCount = 1;
    let appliedPages = 1;
    let frameQueued = false;
    let closed = false;
    let done = false;
    // The new tab's editor mounts a few frames after createDrawing returns: until it is the
    // active scene once, wait (up to MOUNT_WAIT_MS) instead of treating it as closed.
    let mounted = false;
    const mountDeadline = Date.now() + MOUNT_WAIT_MS;
    const idle: (() => void)[] = [];
    // One group name is one group across every append of this document.
    const groups = new Map<string, string>();
    const settle = () => {
      idle.splice(0).forEach((r) => r());
    };

    const apply = () => {
      frameQueued = false;
      const chunks = queue;
      queue = [];
      const scene = getActiveScene();
      if (!mounted && scene?.path !== path && Date.now() < mountDeadline) {
        queue = chunks.concat(queue);
        schedule();
        return;
      }
      if (scene?.path === path) {
        mounted = true;
      }
      if (!scene || scene.path !== path) {
        // Closed or switched mid-stream: what was applied was saved by the switch; the rest is dropped.
        closed = true;
        settle();
        return;
      }
      if (chunks.length === 0) {
        settle();
        return;
      }
      const api = scene.api;
      const known = new Set(Object.keys(api.getFiles()));
      const elements: ExcalidrawElement[] = [
        ...api.getSceneElementsIncludingDeleted(),
      ];
      const files: { id: string }[] = [];
      for (const chunk of chunks) {
        const built = buildPageItems(
          chunk.items,
          { setup, dataKey, fileIds: chunk.fileIds, groups },
          known,
        );
        elements.push(...built.elements);
        for (const f of built.files) {
          known.add(f.id);
          files.push(f);
        }
      }
      if (files.length) {
        void api.addFiles(files as never);
      }
      const appState =
        pageCount > appliedPages
          ? {
              pageSetup: {
                ...(api.getAppState().pageSetup ?? pageSetupFor(setup, 1)),
                pageCount,
              },
            }
          : undefined;
      appliedPages = Math.max(appliedPages, pageCount);
      api.updateScene({
        elements,
        ...(appState ? { appState: appState as never } : {}),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      settle();
    };
    const schedule = () => {
      if (!frameQueued) {
        frameQueued = true;
        frame(apply);
      }
    };
    const intake = makeIntake((chunk) => {
      if (closed) {
        return;
      }
      queue.push(chunk);
      schedule();
    });
    /** Resolves after the next frame has run (or at once when nothing is pending). */
    const drained = () =>
      new Promise<void>((resolve) => {
        if (!frameQueued) {
          resolve();
        } else {
          idle.push(resolve);
        }
      });
    const end = async (): Promise<{ path: string; revision: string }> => {
      const revision = closed
        ? await bridge.drawingRevision(path)
        : (await bridge.flushDrawing(path)) ??
          (await bridge.drawingRevision(path));
      return { path, revision: revision ?? "" };
    };
    const session: PageDocument = {
      path,
      append(items, count) {
        if (done) {
          throw bad("the document is finished");
        }
        const checked = checkPageItems(items);
        pageCount = Math.max(pageCount, checkPageCount(count));
        if (closed) {
          return;
        }
        intake.take(checked);
      },
      async finish() {
        done = true;
        await intake.settled();
        await drained();
        return end();
      },
      async abort() {
        done = true;
        intake.stop();
        queue = [];
        await drained();
        await end();
      },
    };
    track(() => {
      if (!done) {
        void session.abort();
      }
    });
    return session;
  };

  /** `open: false`: the items are collected and the file written once. */
  const memorySession = async (
    bridge: NonNullable<ReturnType<typeof getWorkspaceBridge>>,
    path: string,
    setup: PageRequest | undefined,
  ): Promise<PageDocument> => {
    const elements: unknown[] = [];
    const files: { id: string }[] = [];
    const known = new Set<string>();
    const groups = new Map<string, string>();
    let pageCount = 1;
    let done = false;
    const intake = makeIntake((chunk) => {
      const built = buildPageItems(
        chunk.items,
        { setup, dataKey, fileIds: chunk.fileIds, groups },
        known,
      );
      elements.push(...built.elements);
      for (const f of built.files) {
        known.add(f.id);
        files.push(f);
      }
    });
    const write = async () => {
      await intake.settled();
      const revision = await bridge.writeDrawing(
        path,
        sceneJson(elements, files, setup, pageCount, bridge.importLook?.()),
      );
      return { path, revision };
    };
    const session: PageDocument = {
      path,
      append(items, count) {
        if (done) {
          throw bad("the document is finished");
        }
        const checked = checkPageItems(items);
        pageCount = Math.max(pageCount, checkPageCount(count));
        intake.take(checked);
      },
      async finish() {
        done = true;
        return write();
      },
      async abort() {
        done = true;
        intake.stop();
        await write();
      },
    };
    track(() => {
      if (!done) {
        void session.abort().catch(() => {});
      }
    });
    return session;
  };

  const api: PagesApi = {
    geometry: pageGeometry,
    flow: flowPages,
    createDocument,
    async buildScene(items, opts) {
      if (!opts || typeof opts !== "object") {
        throw bad("options must be an object");
      }
      const checked = checkPageItems(items);
      const pageCount = checkPageCount(opts.pageCount);
      const setup = checkSetup(opts.setup);
      const fileIds = await hashPageItemImages(checked);
      const built = buildPageItems(checked, { setup, dataKey, fileIds });
      return JSON.parse(
        sceneJson(
          built.elements,
          built.files,
          setup,
          pageCount,
          getWorkspaceBridge()?.importLook?.(),
        ),
      ) as object;
    },
  };
  return Object.freeze(api);
}

/**
 * `ctx.pages.createDocument` and `buildScene` of the mock host: the shared
 * checks and element builder (sdk/api/shared/pageItems.ts) over the mock
 * vault and scene. A live document applies what was appended once per
 * frame (a macrotask, as the mock scene's frame), `finish` and `abort` save
 * once into the vault.
 */
import {
  buildPageElements,
  checkPageCount,
  checkPageItems,
  hashPageImages,
  imagesToHash,
  pageSetupFor,
  sha1Hex,
} from "../shared/pageItems";
import { pageGeometry } from "../shared/pages";
import { PluginApiError } from "../shared/rules";
import { checkVaultPath } from "../shared/vaultPaths";

import type {
  CreateDocumentOptions,
  Disposable,
  PageDocument,
  PageItem,
  PageRequest,
  PagesApi,
} from "@vaultdraw/api";
import type { SceneModel } from "./scene";
import type { FakeElement } from "./types";
import type { VaultModel } from "./vault";

const MAX_NAME = 200;
let seq = 0;

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
  pageGeometry(setup as PageRequest);
  return setup as PageRequest;
};

export interface PagesDeps {
  vault: VaultModel;
  scene: SceneModel;
  dataKey: string;
  track(fn: () => void): Disposable;
  /** The drawing becomes active (as `ctx.workspace.open` does in the mock). */
  activate(path: string): void;
  activePath(): string | null;
}

export function createPagesMock(deps: PagesDeps): Pick<
  PagesApi,
  "createDocument" | "buildScene"
> {
  const { vault, scene, dataKey, track } = deps;
  const build = (
    items: readonly PageItem[],
    setup: PageRequest | undefined,
    fileIds: ReadonlyMap<object, string> | undefined,
    known: Set<string>,
  ) =>
    buildPageElements(
      items,
      {
        setup,
        dataKey,
        fileIds,
        id: () => `page-${++seq}`,
        seed: () => seq,
        now: () => Date.now(),
      },
      known,
    );

  const createDocument = async (
    opts: CreateDocumentOptions,
  ): Promise<PageDocument> => {
    if (!opts || typeof opts !== "object") {
      throw bad("options must be an object");
    }
    const name = checkName(opts.name);
    const setup = checkSetup(opts.setup);
    const open = opts.open !== false;
    const info = vault.needVault();
    if (info.readOnly) {
      throw new PluginApiError("READ_ONLY", "The vault is read-only");
    }
    const parent =
      opts.parent === undefined ? "" : checkVaultPath(opts.parent, "folder");
    let path = "";
    for (let n = 1; ; n++) {
      const candidate = `${name}${n === 1 ? "" : ` ${n}`}.excalidraw`;
      path = parent ? `${parent}/${candidate}` : candidate;
      if (!vault.has(path)) {
        break;
      }
    }
    const elements: FakeElement[] = [];
    const files: { id: string }[] = [];
    const known = new Set<string>();
    let pageCount = 1;
    let done = false;
    let closed = false;
    let queue: (readonly PageItem[])[] = [];
    let frame: ReturnType<typeof setTimeout> | null = null;
    const waiting: (() => void)[] = [];
    let hashing: Promise<void> = Promise.resolve();

    if (open) {
      vault.put(path, [], { pageSetup: pageSetupFor(setup, 1) });
      scene.setAppState({ pageSetup: pageSetupFor(setup, 1) });
      deps.activate(path);
    }
    const take = (items: readonly PageItem[]) => {
      if (open) {
        queue = [...queue, items];
        schedule();
        return;
      }
      const built = build(items, setup, hashes.get(items), known);
      elements.push(...(built.elements as unknown as FakeElement[]));
      files.push(...built.files);
    };
    const apply = () => {
      frame = null;
      const chunks = queue;
      queue = [];
      if (deps.activePath() !== path) {
        closed = true;
      } else if (chunks.length) {
        const fresh: FakeElement[] = [];
        for (const items of chunks) {
          const built = build(items, setup, hashes.get(items), known);
          fresh.push(...(built.elements as unknown as FakeElement[]));
          files.push(...built.files);
        }
        const setupNow = scene.fake.appState().pageSetup as
          | Record<string, unknown>
          | undefined;
        scene.append(fresh, {
          pageSetup: { ...(setupNow ?? pageSetupFor(setup, 1)), pageCount },
        });
      }
      waiting.splice(0).forEach((r) => r());
    };
    const hashes = new Map<readonly PageItem[], Map<object, string>>();
    const schedule = () => {
      if (frame === null) {
        frame = setTimeout(apply, 0);
      }
    };
    const drained = () =>
      new Promise<void>((resolve) =>
        frame === null ? resolve() : waiting.push(resolve),
      );
    const save = (): { path: string; revision: string } => {
      if (open) {
        if (closed) {
          return { path, revision: vault.revision(path) ?? "" };
        }
        const revision = vault.put(
          path,
          scene.fake.live(),
          scene.fake.appState(),
          true,
        );
        return { path, revision };
      }
      const revision = vault.put(
        path,
        elements,
        { pageSetup: pageSetupFor(setup, pageCount) },
        true,
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
        if (closed) {
          return;
        }
        if (imagesToHash(checked).length === 0) {
          take(checked);
          return;
        }
        hashing = hashing.then(async () => {
          hashes.set(checked, await hashPageImages(checked, sha1Hex));
          take(checked);
        });
      },
      async finish() {
        done = true;
        await hashing;
        await drained();
        return save();
      },
      async abort() {
        done = true;
        queue = [];
        await drained();
        save();
      },
    };
    track(() => {
      if (!done) {
        void session.abort();
      }
    });
    return session;
  };

  return {
    createDocument,
    async buildScene(items, opts) {
      if (!opts || typeof opts !== "object") {
        throw bad("options must be an object");
      }
      const checked = checkPageItems(items);
      const pageCount = checkPageCount(opts.pageCount);
      const setup = checkSetup(opts.setup);
      const fileIds = await hashPageImages(checked, sha1Hex);
      const built = build(checked, setup, fileIds, new Set());
      return {
        type: "excalidraw",
        version: 2,
        source: "mock",
        elements: built.elements,
        appState: { pageSetup: pageSetupFor(setup, pageCount) },
        files: Object.fromEntries(built.files.map((f) => [f.id, f])),
      };
    },
  };
}

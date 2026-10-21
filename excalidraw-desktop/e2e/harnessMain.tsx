import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { flushPendingViewportInput } from "@excalidraw/excalidraw/components/App.viewport";
import { createBackgroundPattern } from "@excalidraw/excalidraw/data/backgroundPattern";
import { renderBackgroundPattern } from "@excalidraw/excalidraw/renderer/backgroundPattern";

import { installNativeContextMenuSuppression } from "../src/platform/nativeContextMenu";
import { allEditorApis } from "../src/editor/editorApi";
import { FakeHistoryRepository } from "../src/tests/fakeHistoryRepository";
import { FakeLibraryRepository } from "../src/tests/fakeLibraryRepository";
import { FakePdfBridge } from "../src/tests/fakePdfBridge";
import { toastStore } from "../src/toasts/toastStore";
import { FakeVaultRepository } from "../src/tests/fakeVaultRepository";
import {
  FakeVaultGraph,
  fakeVaultSettingsInvoke,
} from "../src/tests/fakeVaultGraph";
import { FakeVaultLinks } from "../src/tests/fakeVaultLinks";
import { FakeVaultSearch } from "../src/tests/fakeVaultSearch";
import { SAMPLE_SCENE, SEARCH_SCENE } from "../src/tests/fixtures";
import { createFakeThumbnailStore } from "../src/thumbnails/fakeStore";
import {
  setAutosaveDelayMs,
  updatePreferences,
} from "../src/vault/preferences";

import "../src/desktop.css";

import { E2E_AUTOSAVE_MS } from "./constants";
import { E2ETagRename } from "./fakeTagRename";
import {
  smallScene,
  TEMPLATE_BACKGROUNDS,
  templateScene,
} from "./templateFixtures";

// Browser-only harness for Playwright: mounts the real VaultApp backed by the
// in-memory FakeVaultRepository so the editor can be driven with real input.
const mountNode = document.getElementById("root")!;
const ownerDocument = mountNode.ownerDocument;
const ownerWindow = ownerDocument.defaultView!;
const params = new ownerWindow.URLSearchParams(ownerWindow.location.search);

ownerWindow.__EXCALIDRAW_DESKTOP__ = true;
// ?nativemenu=suppress turns on the release-build context menu suppression.
installNativeContextMenuSuppression(
  ownerWindow,
  params.get("nativemenu") === "suppress",
);
ownerWindow.EXCALIDRAW_ASSET_PATH = new ownerWindow.URL(
  "./",
  ownerWindow.location.href,
).href;
// Short autosave so specs don't sit through the 500ms production default.
setAutosaveDelayMs(
  Number(params.get("autosave")) || E2E_AUTOSAVE_MS,
  ownerWindow,
);
if (params.get("chrome") === "macos") {
  ownerDocument.documentElement.classList.add("vault-macos");
}
if (params.get("theme") === "dark") {
  ownerDocument.documentElement.classList.add("dark");
}

const thumbRect = (id: string, k: number) => ({
  id,
  type: "rectangle",
  x: (k % 20) * 30,
  y: Math.floor(k / 20) * 30,
  width: 24,
  height: 24,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  seed: k + 1,
  version: 1,
  versionNonce: k + 1,
  isDeleted: false,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
});

const repository = new FakeVaultRepository({
  vaultName: "E2E Vault",
  readOnly: params.get("readonly") === "1",
  // ?readonly=1&locked=1: held by another Vaultdraw process (pid 4242).
  readOnlyReason: params.get("locked") === "1" ? "lockedByOtherProcess" : null,
  lockHolderPid: params.get("locked") === "1" ? 4242 : undefined,
});
if (params.get("seed") !== "empty") {
  repository.seedFolder("DSA/Dynamic Programming");
  repository.seedDrawing(
    "DSA/Dynamic Programming/01 Introduction.excalidraw",
    SAMPLE_SCENE,
  );
  repository.seedDrawing("DSA/Graphs.excalidraw", SAMPLE_SCENE);
  if (params.get("seed") === "search") {
    // Opt-in (?seed=search): keeps other specs' drawing counts unchanged.
    repository.seedDrawing("DSA/Shortest Paths.excalidraw", SEARCH_SCENE);
  }
  if (params.get("seed") === "bigfolder") {
    // Opt-in (?seed=bigfolder): one folder of 500 drawings (tree windowing).
    // ?n=N overrides the count (gallery grid perf).
    for (let i = 0; i < (Number(params.get("n")) || 500); i++) {
      repository.seedDrawing(
        `Zbig/note ${String(i).padStart(3, "0")}.excalidraw`,
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          // ?el=K: K rectangles per drawing (thumbnail specs; empty renders no image).
          elements: Array.from(
            { length: Number(params.get("el")) || 0 },
            (_, k) => thumbRect(`r${i}-${k}`, k + i),
          ),
          appState: {},
          files: {},
        }),
      );
    }
  }
  if (params.get("scene") === "fit") {
    // Opt-in (?scene=fit): thumbnail fit cases (one short word, very wide, very tall).
    const scene = (elements: unknown[]) =>
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        elements,
        appState: {},
        files: {},
      });
    const word = {
      ...thumbRect("atools", 0),
      type: "text",
      x: 0,
      y: 0,
      width: 64,
      height: 25,
      text: "Atools",
      originalText: "Atools",
      fontSize: 20,
      fontFamily: 5,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      autoResize: true,
      lineHeight: 1.25,
    };
    repository.seedDrawing("Fit/Atools.excalidraw", scene([word]));
    repository.seedDrawing(
      "Fit/Wide.excalidraw",
      scene(
        Array.from({ length: 60 }, (_, k) => ({
          ...thumbRect(`w${k}`, k),
          x: k * 60,
          y: 0,
        })),
      ),
    );
    repository.seedDrawing(
      "Fit/Tall.excalidraw",
      scene(
        Array.from({ length: 60 }, (_, k) => ({
          ...thumbRect(`t${k}`, k),
          x: 0,
          y: k * 60,
        })),
      ),
    );
  }
  if (params.get("scene") === "huge") {
    // Opt-in (?scene=huge): Huge/Huge.excalidraw with 700 elements (> thumbnail cap 600).
    repository.seedDrawing(
      "Huge/Huge.excalidraw",
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        elements: Array.from({ length: 700 }, (_, k) => thumbRect(`h${k}`, k)),
        appState: {},
        files: {},
      }),
    );
  }
  if (params.get("seed") === "searchheavy") {
    // Opt-in (?seed=searchheavy): 300 drawings with 6 text elements each that
    // all contain "note", so a short query returns the full 50 drawings x 5
    // snippets (search results rendering latency).
    for (let i = 0; i < 300; i++) {
      const elements = [0, 1, 2, 3, 4, 5].map((k) => ({
        id: `t-${i}-${k}`,
        type: "text",
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        roundness: null,
        link: null,
        locked: false,
        frameId: null,
        boundElements: [],
        x: 0,
        y: k * 30,
        width: 200,
        height: 25,
        text: `Meeting note ${i} item ${k}: remember the roadmap`,
        originalText: `Meeting note ${i} item ${k}: remember the roadmap`,
        fontSize: 20,
        fontFamily: 1,
        textAlign: "left",
        verticalAlign: "top",
        containerId: null,
        lineHeight: 1.25,
        autoResize: true,
      }));
      repository.seedDrawing(
        `Notes ${i % 10}/Note ${i}.excalidraw`,
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          elements,
          appState: {},
          files: {},
        }),
      );
    }
  }
  if (params.get("seed") === "names5k") {
    // Opt-in (?seed=names5k): 5,000 small drawings in nested folders, for the
    // quick switcher's per-keystroke latency measurement.
    const words = [
      "alpha",
      "design",
      "vault",
      "roadmap",
      "notes",
      "sketch",
      "graph",
      "plan",
      "review",
      "draft",
    ];
    const empty = JSON.stringify({
      type: "excalidraw",
      version: 2,
      elements: [],
      appState: {},
      files: {},
    });
    for (let i = 0; i < 5000; i++) {
      const top = `Area ${i % 25}`;
      const sub = `${words[i % 10]} ${Math.floor(i / 250) % 8}`;
      repository.seedDrawing(
        `${top}/${sub}/${words[(i * 7) % 10]} ${
          words[(i * 3) % 10]
        } ${i}.excalidraw`,
        empty,
      );
    }
  }
}

if (params.get("seed") === "tags") {
  // Opt-in (?seed=tags): tagged drawings plus text that must NOT become tags
  // (URL fragment, hex colour).
  const textScene = (...texts: string[]) =>
    JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "e2e-tags",
      elements: texts.map((text, i) => ({
        id: `t${i}`,
        type: "text",
        x: 0,
        y: i * 40,
        width: 200,
        height: 25,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        roundness: null,
        link: null,
        locked: false,
        isDeleted: false,
        text,
        originalText: text,
        fontSize: 20,
        fontFamily: 1,
        textAlign: "left",
        verticalAlign: "top",
        containerId: null,
        lineHeight: 1.25,
      })),
      appState: {},
      files: {},
    });
  repository.seedDrawing(
    "DSA/Tagged Graphs.excalidraw",
    textScene("BFS traversal #dsa/graphs", "mock round #Interview"),
  );
  repository.seedDrawing(
    "DSA/Tagged Arrays.excalidraw",
    textScene("two pointers #dsa"),
  );
  repository.seedDrawing(
    "DSA/Not Tags.excalidraw",
    textScene("see https://example.com/page#frag", "colour #ff00aa"),
  );
}

if (params.get("seed") === "memprobe") {
  // Opt-in (?seed=memprobe, memoryProbe.spec.ts): the typical 300-element
  // drawing with 2 images, injected by the spec as window.__memprobeScene.
  repository.seedDrawing(
    "Projects/Architecture 300.excalidraw",
    (ownerWindow as any).__memprobeScene,
  );
}

if (params.get("seed") === "templates") {
  // Opt-in (?seed=templates): vault templates, plus one in a custom folder.
  for (const [name, background] of Object.entries(TEMPLATE_BACKGROUNDS)) {
    repository.seedDrawing(
      `Templates/${name}.excalidraw`,
      templateScene(name.replace(/\W/g, ""), background),
    );
  }
  repository.seedDrawing(
    "Custom Tpl/Sprint Retro.excalidraw",
    templateScene("SprintRetro", "#d3f9d8"),
  );
}
// ?templates=N (perf): N small-scene templates in Templates/.
const templateCount = Number(params.get("templates")) || 0;
for (let i = 0; i < templateCount; i++) {
  const path = `Templates/Template ${String(i).padStart(3, "0")}.excalidraw`;
  repository.seedDrawing(path, smallScene(i));
  // Stable mtime: thumbnail cache keys (path + mtime + size) survive reopen.
  repository.setModified(path, 1_700_000_000_000);
}

if (params.get("seed") === "links") {
  // Opt-in (?seed=links): text links, a shape link, an unresolved link, an
  // ambiguous basename (Folder A/Dupe, Folder B/Dupe) and a folder.
  const base = {
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    roundness: null,
    locked: false,
    frameId: null,
    isDeleted: false,
  };
  // Clear of the hamburger menu, toolbar and left properties panel.
  const OX = 180;
  const OY = 200;
  const text = (id: string, t: string, y: number, extra = {}) => ({
    ...base,
    id,
    type: "text",
    x: 20 + OX,
    y: y + OY,
    width: 360,
    height: 25,
    text: t,
    originalText: t,
    fontSize: 20,
    fontFamily: 1,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    lineHeight: 1.25,
    link: null,
    boundElements: [],
    ...extra,
  });
  const scene = (...elements: object[]) =>
    JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "e2e-links",
      elements,
      appState: {},
      files: {},
    });
  repository.seedFolder("Folder A");
  repository.seedFolder("Folder B");
  repository.seedFolder("Folder");
  repository.seedDrawing(
    "Hub.excalidraw",
    scene(
      text("hub-t1", "See [[Alpha]] now", 20),
      text("hub-t2", "Todo [[Missing Note]]", 80),
      text("hub-t3", "Which [[Dupe]]?", 140),
      {
        ...base,
        id: "hub-shape",
        type: "rectangle",
        x: 20 + OX,
        y: 220 + OY,
        width: 160,
        height: 80,
        link: "[[Alpha]]",
        boundElements: [],
      },
    ),
  );
  repository.seedDrawing(
    "Alpha.excalidraw",
    scene(text("alpha-t1", "Back to [[Hub]]", 20)),
  );
  repository.seedDrawing(
    "Folder/Inner.excalidraw",
    scene(text("inner-t1", "Points at [[Alpha]]", 20)),
  );
  repository.seedDrawing(
    "Folder A/Dupe.excalidraw",
    scene(text("dupe-a", "dupe A", 20)),
  );
  repository.seedDrawing(
    "Folder B/Dupe.excalidraw",
    scene(text("dupe-b", "dupe B", 20)),
  );
}

// ?names=N (links perf): N empty drawings with realistic names in nested
// folders, for the `[[` autocomplete at 10k names.
const nameCount = Number(params.get("names")) || 0;
if (nameCount > 0) {
  const words = [
    "alpha",
    "design",
    "vault",
    "roadmap",
    "notes",
    "sketch",
    "graph",
    "plan",
    "review",
    "draft",
  ];
  const empty = JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements: [],
    appState: {},
    files: {},
  });
  for (let i = 0; i < nameCount; i++) {
    repository.seedDrawing(
      `Gen ${i % 40}/${words[i % 10]} ${Math.floor(i / 400) % 10}/${
        words[(i * 7) % 10]
      } ${words[(i * 3) % 10]} ${i}.excalidraw`,
      empty,
    );
  }
}

// ?tagcount=N (tags QA/perf): N distinct flat tags `tNNNN` (every third one in
// three drawings, the rest in one) spread over 40 drawings, plus the nested
// group `grp/a` (1 drawing), `grp/b` (3), `grp/c` (2) for sort checks.
const tagCount = Number(params.get("tagcount")) || 0;
if (tagCount > 0) {
  const DRAWINGS = 40;
  const perDrawing: string[][] = Array.from({ length: DRAWINGS }, () => []);
  for (let i = 0; i < tagCount; i++) {
    const tag = `#t${String(i).padStart(4, "0")}`;
    perDrawing[i % DRAWINGS].push(tag);
    if (i % 3 === 0) {
      perDrawing[(i + 1) % DRAWINGS].push(tag);
      perDrawing[(i + 2) % DRAWINGS].push(tag);
    }
  }
  perDrawing[0].push("#grp/a", "#grp/b", "#grp/c");
  perDrawing[1].push("#grp/b", "#grp/c");
  perDrawing[2].push("#grp/b");
  perDrawing.forEach((tags, d) => {
    const text = tags.join(" ");
    repository.seedDrawing(
      `Tagged/Tag set ${String(d).padStart(2, "0")}.excalidraw`,
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "e2e-tagcount",
        elements: [
          {
            id: `tc-${d}`,
            type: "text",
            x: 600,
            y: 40,
            width: 200,
            height: 25,
            angle: 0,
            strokeColor: "#1e1e1e",
            backgroundColor: "transparent",
            fillStyle: "solid",
            strokeWidth: 1,
            strokeStyle: "solid",
            roughness: 1,
            opacity: 100,
            groupIds: [],
            roundness: null,
            link: null,
            locked: false,
            isDeleted: false,
            text,
            originalText: text,
            fontSize: 20,
            fontFamily: 1,
            textAlign: "left",
            verticalAlign: "top",
            containerId: null,
            lineHeight: 1.25,
          },
        ],
        appState: {},
        files: {},
      }),
    );
  });
}

const vaultSearch = new FakeVaultSearch(repository);
// The fake index only refreshes on demand: specs call __vaultSearch.setIndexState(null).
(ownerWindow as any).__vaultSearch = vaultSearch;
const libraryRepository = new FakeLibraryRepository();
const vaultLinks = new FakeVaultLinks(repository);
(ownerWindow as any).__vaultLinks = vaultLinks;

// Graph view: a graph built from the fake links, in-memory layout, and a fake settings.toml that
// survives a page reload (sessionStorage) so "persists across reopen" can be tested.
const graphSource = new FakeVaultGraph(repository, vaultLinks);
const GRAPH_STORE_KEY = "e2e-graph-settings-toml";
const graphStore = (() => {
  try {
    return JSON.parse(
      ownerWindow.sessionStorage.getItem(GRAPH_STORE_KEY) ?? "{}",
    );
  } catch {
    return {};
  }
})();
const graphInvokeBase = fakeVaultSettingsInvoke(graphStore);
const graphInvoke = (async (cmd: string, args?: any, opts?: any) => {
  const out = await graphInvokeBase(cmd, args, opts);
  if (cmd === "update_vault_settings") {
    ownerWindow.sessionStorage.setItem(
      GRAPH_STORE_KEY,
      JSON.stringify(graphStore),
    );
  }
  return out;
}) as typeof graphInvokeBase;
(ownerWindow as any).__graphSource = graphSource;
(ownerWindow as any).__graphSettingsToml = graphStore;

// File history: in-memory fake that sees the vault's committed writes (the real
// service watches the save path natively, so autosave costs no history IPC).
const historyRepository = new FakeHistoryRepository(repository.handle, {
  readOnly: repository.vault.readOnly,
  source: async (handle, path) =>
    (await repository.readDrawing(handle, path)).json,
  createCopy: (path, json) =>
    repository.writeDrawing({
      handle: repository.handle,
      path,
      json,
      expectedRevision: null,
      operationId: `history-copy-${path}`,
    }),
});
const writeDrawing = repository.writeDrawing.bind(repository);
repository.writeDrawing = async (input) => {
  const result = await writeDrawing(input);
  historyRepository.noteCommitted(input.handle, input.path, input.json);
  return result;
};
(ownerWindow as any).__historyRepo = historyRepository;

(ownerWindow as any).__vaultRepo = repository;
(ownerWindow as any).__vaultToasts = toastStore;
// Tabs specs: the live editors' APIs (there is exactly one while a drawing is open).
(ownerWindow as any).__editorApis = allEditorApis;
(ownerWindow as any).__updatePreferences = updatePreferences;
// Paper perf spec: the canvas renderer, for a micro-benchmark.
(ownerWindow as any).__paperRenderer = {
  createBackgroundPattern,
  renderBackgroundPattern,
};
// Paper zoom perf spec: commits one zoom step (React update + static canvas
// render) synchronously so its cost can be timed. Wheel/pinch input waits for
// the next frame in the editor, so it is applied here too.
(ownerWindow as any).__flushSync = <T,>(fn: () => T): T => {
  const result = flushSync(fn);
  flushPendingViewportInput();
  return result;
};
(ownerWindow as any).__libraryRepo = libraryRepository;
// PDF import: the next Import PDF pick returns a 3-page A4 doc; specs replace
// `nextPick` (bridge.makeDoc(name, pages)) or set delays / failing pages.
const pdfBridge = new FakePdfBridge();
pdfBridge.nextPick = pdfBridge.makeDoc("sample.pdf");
(ownerWindow as any).__pdfBridge = pdfBridge;

// ?thumbs=1: in-memory thumbnail store (revisions from the fake repository).
const thumbnailStore =
  params.get("thumbs") === "1"
    ? createFakeThumbnailStore({
        revisionOf: (handle, path) =>
          repository.readDrawing(handle, path).then(
            (f) => f.revision,
            () => null,
          ),
      })
    : undefined;
(ownerWindow as any).__thumbStore = thumbnailStore;

if (params.has("graph")) {
  // ?graph=N: the graph view over a fake N-node vault graph (see graphHarness.tsx).
  void import("./graphHarness").then(({ mountGraphHarness }) =>
    mountGraphHarness(mountNode, params),
  );
} else {
  void mountVaultApp();
}

function mountVaultApp() {
  return import("../src/VaultApp").then(({ default: VaultApp }) => {
    createRoot(mountNode).render(
      <StrictMode>
        <VaultApp
          ownerDocument={ownerDocument}
          ownerWindow={ownerWindow}
          repository={repository}
          search={vaultSearch}
          tagRename={
            params.get("tagrename") === "1"
              ? new E2ETagRename(repository, vaultLinks)
              : undefined
          }
          links={vaultLinks}
          libraryRepository={libraryRepository}
          history={historyRepository}
          pdf={pdfBridge}
          thumbnails={thumbnailStore ?? null}
          graph={{
            graphSource,
            invoke: graphInvoke,
            onSession: (session) => {
              (ownerWindow as any).__graphApp = session;
            },
          }}
        />
      </StrictMode>,
    );
  });
}

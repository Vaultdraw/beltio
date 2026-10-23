import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../../src/desktop.css";
import fixturesConfig from "../fixtures.config.json";

import { parseScenarioList } from "../../src/perf/scenarioFilter";

import { HttpVaultRepository } from "./httpVaultRepository";

// Perf harness for Chromium mode: the real VaultApp over an HTTP-served
// fixture vault (index.json + files under /perf-vault/), production autosave.
const mountNode = document.getElementById("root")!;
const ownerDocument = mountNode.ownerDocument;
const ownerWindow = ownerDocument.defaultView! as Window & typeof globalThis;
const w = ownerWindow as any;

w.__EXCALIDRAW_DESKTOP__ = true;
w.EXCALIDRAW_ASSET_PATH = `${ownerWindow.location.origin}/`;
w.__perfMarks = [] as Array<{ name: string; t: number }>;
// Leak mode (?leak=1): JS heap after a forced GC at every `leak:<label>` mark (read by lib/browser.mjs).
w.__leakHeap = [] as Array<{ label: string; jsHeapMB: number }>;
const pageParams = new URLSearchParams(ownerWindow.location.search);
const leakMode = pageParams.has("leak");
// ?scenarios=a,b runs only those scenarios (vault-open always runs); ?skip=a,b runs all but those.
const scenarioFilter = {
  only: parseScenarioList(pageParams.get("scenarios")),
  skip: parseScenarioList(pageParams.get("skip")),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const repository = await HttpVaultRepository.create(
    `${ownerWindow.location.origin}/perf-vault`,
  );
  w.__vaultRepo = repository;
  const { default: VaultApp } = await import("../../src/VaultApp");
  createRoot(mountNode).render(
    <StrictMode>
      <VaultApp
        ownerDocument={ownerDocument}
        ownerWindow={ownerWindow}
        repository={repository}
      />
    </StrictMode>,
  );

  const root = mountNode;
  for (let i = 0; i < 1500 && !root.querySelector(".vault-onboarding"); i++) {
    await sleep(20);
  }
  if (!root.querySelector(".vault-onboarding")) {
    throw new Error("Timed out waiting for .vault-onboarding");
  }
  const { runPerfScenarios } = await import("../../src/perf/perfScenarios");
  const result = await runPerfScenarios({
    root,
    doc: ownerDocument,
    win: ownerWindow,
    repository,
    config: fixturesConfig,
    mark: async (name) => {
      w.__perfMarks.push({ name, t: ownerWindow.performance.now() });
      if (name.startsWith("leak:")) {
        w.gc?.();
        await sleep(100);
        w.__leakHeap.push({
          label: name.slice("leak:".length),
          jsHeapMB: (w.performance.memory?.usedJSHeapSize ?? 0) / 1048576,
        });
      }
    },
    scenarioFilter,
    modes: {
      leak: leakMode,
      leakOnly: new URLSearchParams(ownerWindow.location.search).has("only"),
    },
    // eslint-disable-next-line no-console
    log: (m) => console.log(`[perf] ${m}`),
  });
  w.__perfResult = result;
}

main().catch((error) => {
  w.__perfResult = {
    samples: {},
    info: {},
    errors: [String((error && (error.stack || error.message)) || error)],
  };
});

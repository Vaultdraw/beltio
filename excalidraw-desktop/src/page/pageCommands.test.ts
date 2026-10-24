import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PAGE_SETUP,
  PAGE_SIZE_PRESET_IDS,
} from "@excalidraw/excalidraw/data/pageSetup";

import type { PageSetup } from "@excalidraw/excalidraw/data/pageSetup";

import { COMMANDS, getCommand } from "../commands/commands";
import { findConflicts } from "../commands/conflicts";

import {
  applyFitContent,
  applyPageSetup,
  createPageHandlers,
  createPageNavigationHandlers,
} from "./pageCommands";
import { isPageCommandChecked, setPageStatus } from "./pageStatus";
import { rect } from "./testElements";

const pageCommands = COMMANDS.filter((c) => c.category === "Page");

describe("Page command metadata", () => {
  it("has unique ids, all in the Page category and namespace", () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(pageCommands.every((c) => c.id.startsWith("page."))).toBe(true);
  });

  it("covers mode, layout, every size preset, orientation, setup, paper theme, fit, navigation", () => {
    const ids = new Set(pageCommands.map((c) => c.id));
    for (const id of [
      "page.on",
      "page.off",
      "page.toggle",
      "page.layout.continuous",
      "page.layout.separate",
      "page.orientation.portrait",
      "page.orientation.landscape",
      "page.setup",
      "page.paper.normal",
      "page.paper.oldSchool",
      "page.paper.match",
      "page.fitContent",
      "page.next",
      "page.previous",
      ...PAGE_SIZE_PRESET_IDS.map((s) => `page.size.${s}`),
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it("titles follow 'Family: Choice'", () => {
    expect(getCommand("page.on")!.title).toBe("Page mode: On");
    expect(getCommand("page.layout.separate")!.title).toBe(
      "Page layout: Separate pages",
    );
    expect(getCommand("page.size.a4")!.title).toBe("Page size: A4");
    expect(getCommand("page.paper.oldSchool")!.title).toBe(
      "Paper theme: Old school",
    );
    expect(getCommand("page.fitContent")!.title).toBe("Fit content to page");
  });

  it("only next / previous page have default keys (PageDown / PageUp, on the canvas)", () => {
    const keyed = pageCommands.filter((c) => c.keys.default.length);
    expect(keyed.map((c) => [c.id, c.keys.default])).toEqual([
      ["page.next", ["PageDown"]],
      ["page.previous", ["PageUp"]],
    ]);
    expect(getCommand("page.next")!.when).toContain("canvasFocus");
  });

  it("editing commands need a writable drawing", () => {
    for (const c of pageCommands) {
      expect(c.when).toContain("drawingOpen");
      if (!["page.next", "page.previous"].includes(c.id)) {
        expect(c.when).toContain("writable");
      }
    }
  });

  it("default keys do not conflict with other commands", () => {
    const conflicts = findConflicts(COMMANDS, {}, "mac");
    for (const id of ["page.next", "page.previous"]) {
      const perChord = conflicts.get(id);
      const commandConflicts = [...(perChord?.values() ?? [])]
        .flat()
        .filter((c) => c.kind === "command" || c.kind === "reserved");
      expect(commandConflicts, id).toEqual([]);
    }
  });
});

const makeApi = (pageSetup: PageSetup | null, elements: any[] = []) => {
  const api = {
    state: {
      pageSetup,
      viewModeEnabled: false,
      viewBackgroundColor: "#ffffff",
      viewBackgroundPattern: null,
      scrollY: 0,
      zoom: { value: 1 },
      scrollConstraints: null,
    } as any,
    elements,
    updates: [] as any[],
    getAppState: () => api.state,
    getSceneElementsIncludingDeleted: () => api.elements,
    updateScene: (data: any) => {
      api.updates.push(data);
      if (data.appState) {
        api.state = { ...api.state, ...data.appState };
      }
      if (data.elements) {
        api.elements = data.elements;
      }
    },
  };
  return api;
};

const handlersFor = (
  api: ReturnType<typeof makeApi>,
  extra: { disabled?: boolean } = {},
) => {
  const openPageSetup = vi.fn();
  const handlers = createPageHandlers({
    getApi: () => api as any,
    getWindow: () => window,
    isDisabled: () => !!extra.disabled,
    openPageSetup,
  });
  return { handlers, openPageSetup };
};

describe("Page command handlers", () => {
  it("every Page command except navigation has a handler", () => {
    const { handlers } = handlersFor(makeApi(null));
    for (const c of pageCommands) {
      // page.dismissNotice is bound by usePageMode while the notice shows
      if (
        !["page.next", "page.previous", "page.dismissNotice"].includes(c.id)
      ) {
        expect(handlers[c.id], c.id).toBeTypeOf("function");
      }
    }
  });

  it("Page mode: On on a drawing without a setup uses the app default and enables it (undoable)", () => {
    const api = makeApi(null);
    handlersFor(api).handlers["page.on"]!();
    expect(api.state.pageSetup.enabled).toBe(true);
    expect(api.updates[0].captureUpdate).toBeDefined();
    expect(String(api.updates[0].captureUpdate)).toBe("IMMEDIATELY");
  });

  it("Off keeps the setup; Toggle flips it", () => {
    const api = makeApi({ ...DEFAULT_PAGE_SETUP });
    const { handlers } = handlersFor(api);
    handlers["page.off"]!();
    expect(api.state.pageSetup.enabled).toBe(false);
    handlers["page.toggle"]!();
    expect(api.state.pageSetup.enabled).toBe(true);
    handlers["page.toggle"]!();
    expect(api.state.pageSetup.enabled).toBe(false);
  });

  it("layout, size and paper theme commands change only their field (paper theme stamps colours)", () => {
    const api = makeApi({ ...DEFAULT_PAGE_SETUP });
    const { handlers } = handlersFor(api);
    handlers["page.layout.continuous"]!();
    expect(api.state.pageSetup.layout).toBe("continuous");
    handlers["page.size.a5"]!();
    expect(api.state.pageSetup).toMatchObject({
      size: "a5",
      layout: "continuous",
    });
    handlers["page.paper.oldSchool"]!();
    expect(api.state.pageSetup.paperTheme).toBe("oldSchool");
    expect(api.state.viewBackgroundColor).toBe("#f8efd4");
  });

  it("orientation swaps a custom page's sides", () => {
    const api = makeApi({
      ...DEFAULT_PAGE_SETUP,
      size: "custom",
      width: 500,
      height: 900,
    });
    handlersFor(api).handlers["page.orientation.landscape"]!();
    expect(api.state.pageSetup).toMatchObject({
      orientation: "landscape",
      width: 900,
      height: 500,
    });
  });

  it("size and layout on a drawing without a setup prepare it without switching page mode on", () => {
    const api = makeApi(null);
    handlersFor(api).handlers["page.size.a3"]!();
    expect(api.state.pageSetup).toMatchObject({ size: "a3", enabled: false });
  });

  it("Page setup… calls the dialog opener", () => {
    const { handlers, openPageSetup } = handlersFor(makeApi(null));
    handlers["page.setup"]!();
    expect(openPageSetup).toHaveBeenCalledTimes(1);
  });

  it("does nothing in a read-only or disabled editor", () => {
    const api = makeApi({ ...DEFAULT_PAGE_SETUP });
    api.state.viewModeEnabled = true;
    handlersFor(api).handlers["page.size.a5"]!();
    expect(api.updates).toHaveLength(0);
    api.state.viewModeEnabled = false;
    handlersFor(api, { disabled: true }).handlers["page.size.a5"]!();
    expect(api.updates).toHaveLength(0);
  });

  it("applyPageSetup works without a window", () => {
    const api = makeApi(null);
    applyPageSetup(api as any, { size: "a5" }, null);
    expect(api.state.pageSetup.size).toBe("a5");
  });
});

describe("Fit content to page", () => {
  it("applies the fitted elements and page count undoably, only in page mode", () => {
    const api = makeApi({ ...DEFAULT_PAGE_SETUP }, [rect(5000, 5000, 100, 50)]);
    expect(applyFitContent(makeApi(null, [rect(0, 0)]) as any)).toBe(false);
    expect(applyFitContent(api as any)).toBe(true);
    expect(api.elements[0].x).toBe(32);
    expect(String(api.updates[0].captureUpdate)).toBe("IMMEDIATELY");
  });
});

describe("Page navigation handlers", () => {
  it("scrolls to the next / previous page", () => {
    const setup = { ...DEFAULT_PAGE_SETUP, pageCount: 3 };
    const api = makeApi(setup);
    api.state = { ...api.state, width: 1000, height: 800 };
    const nav = createPageNavigationHandlers(() => api as any);
    nav["page.next"]!();
    expect(api.state.scrollY).toBeCloseTo(-(setup.height + 40) + 72, 3);
    nav["page.previous"]!();
    expect(api.state.scrollY).toBeCloseTo(72, 3);
  });
});

describe("palette check marks", () => {
  it("mark the current choice of each family", () => {
    setPageStatus({
      ...DEFAULT_PAGE_SETUP,
      layout: "continuous",
      paperTheme: "oldSchool",
    });
    expect(isPageCommandChecked("page.on")).toBe(true);
    expect(isPageCommandChecked("page.off")).toBe(false);
    expect(isPageCommandChecked("page.layout.continuous")).toBe(true);
    expect(isPageCommandChecked("page.layout.separate")).toBe(false);
    expect(isPageCommandChecked("page.size.a4")).toBe(true);
    expect(isPageCommandChecked("page.orientation.portrait")).toBe(true);
    expect(isPageCommandChecked("page.paper.oldSchool")).toBe(true);
    expect(isPageCommandChecked("page.fitContent")).toBe(false);
    expect(isPageCommandChecked("paper.grid")).toBe(false);
    setPageStatus(null);
    expect(isPageCommandChecked("page.off")).toBe(true);
    expect(isPageCommandChecked("page.layout.continuous")).toBe(false);
  });
});

/**
 * Packaged-app smoke for the plugin host (P2a): import map + CSP, loading
 * through vdplugin://, commands, a React panel, error attribution, costs.
 * Fixtures (smoke-hello, smoke-panel) are only present in the second launch.
 */
import { getRegisteredHandler } from "../commands/handlerRegistry";
import { getPreferences } from "../vault/preferences";

export type PluginsSmokeContext = {
  win: Window;
  step: <T>(name: string, work: () => Promise<T>) => Promise<T>;
  mark: (label: string) => Promise<unknown>;
  waitFor: <T>(
    label: string,
    read: () => T | null | undefined,
    ms?: number,
  ) => Promise<T>;
};

type W = Window & {
  __cspViolations?: { directive: string; blockedURI: string; sample: string }[];
  __smokeHello?: string;
  __smokeBoomStack?: string;
};

const vdResources = (win: Window) =>
  win.performance
    .getEntriesByType("resource")
    .map((e) => e.name)
    .filter(
      (n) => n.startsWith("vdplugin:") || n.includes("vdplugin.localhost"),
    );

export async function runPluginsSmoke(ctx: PluginsSmokeContext): Promise<void> {
  const { win, step, mark, waitFor } = ctx;
  const w = win as W;
  const delay = (ms: number) => new Promise((r) => win.setTimeout(r, ms));
  // No plugin enabled: the host must not have loaded at all.
  if (getPreferences(win).pluginsEnabled.length === 0) {
    await step("plugins-host", async () => {
      await delay(3000);
      const started =
        win.performance.getEntriesByName("vaultdraw:plugins:started").length >
        0;
      const res = vdResources(win);
      const globalSet = "__vaultdraw" in win;
      const violations = w.__cspViolations ?? [];
      if (started || res.length || globalSet || violations.length) {
        throw new Error(
          `plugin host resident without plugins: started ${started}, resources ${res}, global ${globalSet}, csp ${JSON.stringify(
            violations,
          )}`,
        );
      }
      return { hostStarted: false, vdResources: 0 };
    });
    return;
  }
  const React = await import("react");
  const { getPluginCosts, getPluginLog, getStubRegistrationMs } = await import(
    "../plugins/host"
  );
  const { pluginErrorCount } = await import("../plugins/host/errors");
  const { openPanel } = await import("../slots/panelStore");
  await step("plugins-host", async () => {
    await waitFor(
      "plugin host started",
      () => win.performance.getEntriesByName("vaultdraw:plugins:started")[0],
      10_000,
    );
    const importMap = !!win.document.querySelector('script[type="importmap"]');
    const shared = (await import(/* @vite-ignore */ "react")) as typeof React;
    const oneReact = shared.useState === React.useState;
    const costs0 = getPluginCosts();
    const stubCount = costs0.length;
    // External RSS sample point: nothing activated yet.
    await mark("plugins-rss");
    await delay(8000);
    const details: Record<string, unknown> = {
      importMap,
      oneReact,
      pluginCount: stubCount,
      stubRegistrationMs: getStubRegistrationMs(),
      userAgent: win.navigator.userAgent.slice(0, 80),
    };
    if (!importMap || !oneReact) {
      throw new Error(`import map ${importMap}, one React ${oneReact}`);
    }
    if (stubCount === 0) {
      const res = vdResources(win);
      if (res.length) {
        throw new Error(`vdplugin requests without plugins: ${res}`);
      }
    } else {
      const inactive = costs0.filter((c) => c.loadMs === null).length;
      const before = vdResources(win).length;
      details.inactiveBeforeUse = inactive;
      details.vdRequestsBeforeUse = before;
      if (before !== 0) {
        throw new Error(`modules requested before any use: ${before}`);
      }
      const run = (id: string) => {
        const handler = getRegisteredHandler(id);
        if (!handler) {
          throw new Error(`no handler for ${id}`);
        }
        return handler();
      };
      await run("smoke-hello.say");
      await waitFor("smoke-hello ran", () =>
        w.__smokeHello === "ok" ? true : null,
      );
      const helloUrl = vdResources(win).find((n) =>
        n.endsWith("/smoke-hello/main.js"),
      );
      details.helloResource = helloUrl ?? null;
      details.helloLoadMark =
        win.performance.getEntriesByName("vaultdraw:plugin:smoke-hello:load")
          .length > 0;
      if (!helloUrl && !details.helloLoadMark) {
        throw new Error("no load evidence for smoke-hello");
      }

      openPanel("smoke-panel.counter");
      const button = await waitFor<Element>(
        "plugin panel button",
        () => win.document.querySelector("[data-smoke-counter]"),
        15_000,
      );
      (button as HTMLElement).click();
      await waitFor("counter incremented", () =>
        button.getAttribute("data-smoke-counter") === "1" ? true : null,
      );
      details.panelCounterAfterClick =
        button.getAttribute("data-smoke-counter");

      try {
        await run("smoke-hello.boom");
      } catch {
        /* the host may rethrow; attribution is what is checked */
      }
      await waitFor("boom attributed", () =>
        pluginErrorCount("smoke-hello") > 0 ? true : null,
      );
      const stack = w.__smokeBoomStack ?? "";
      details.errorCount = pluginErrorCount("smoke-hello");
      details.errorLog = getPluginLog("smoke-hello")
        .filter((l) => l.level === "error")
        .map((l) => l.text);
      details.boomStack = stack.split("\n").slice(0, 3);
      if (
        !/vdplugin:\/\/localhost\/smoke-hello\/main\.js:\d+:\d+/.test(stack)
      ) {
        throw new Error(`stack lacks vdplugin URL: ${stack}`);
      }
      details.vdRequestsAfterUse = vdResources(win);
      details.activeCosts = getPluginCosts()
        .filter((c) => c.loadMs !== null)
        .map((c) => ({
          id: c.id,
          loadMs: c.loadMs,
          activateMs: c.activateMs,
          mainBytes: c.mainBytes,
        }));
      const loadedOthers = getPluginCosts().filter(
        (c) => c.loadMs !== null && !c.id.startsWith("smoke-"),
      );
      if (loadedOthers.length) {
        throw new Error(
          `inactive plugins loaded: ${loadedOthers.map((c) => c.id)}`,
        );
      }
      await mark("plugins-rss-active");
      await delay(4000);
    }
    const violations = w.__cspViolations ?? [];
    details.cspViolations = violations;
    if (violations.length) {
      throw new Error(`CSP violations: ${JSON.stringify(violations)}`);
    }
    return details;
  });
}

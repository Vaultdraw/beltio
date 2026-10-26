import { describe, expect, it } from "vitest";

import { configToPreferences } from "../vault/settingsSync";

import { userCommandDefinitions } from "./useUserCommands";
import {
  MAX_STEPS,
  parseUserCommands,
  runSteps,
  type StepRunner,
} from "./userCommands";

describe("parseUserCommands", () => {
  it("keeps valid entries with their title", () => {
    const { commands, problems } = parseUserCommands({
      "export-reveal": {
        title: "Export and reveal",
        run: ["export.png", "file.revealInFinder"],
      },
      plain: { run: ["view.toggleNavigator"] },
    });
    expect(problems).toEqual([]);
    expect(commands).toEqual({
      "export-reveal": {
        title: "Export and reveal",
        run: ["export.png", "file.revealInFinder"],
      },
      plain: { run: ["view.toggleNavigator"] },
    });
  });

  it("leaves out bad entries with a problem each; the rest apply", () => {
    const { commands, problems } = parseUserCommands({
      ok: { run: ["a.b"] },
      empty: { run: [] },
      notList: { run: "a.b" },
      extra: { run: ["a.b"], args: 1 },
      badTitle: { run: ["a.b"], title: 3 },
      long: { run: Array(MAX_STEPS + 1).fill("a.b") },
      "bad name": { run: ["a.b"] },
      flat: "a.b",
    });
    expect(Object.keys(commands)).toEqual(["ok"]);
    expect(problems.map((p) => p.key)).toEqual([
      "commands.empty",
      "commands.notList",
      "commands.extra",
      "commands.badTitle",
      "commands.long",
      "commands.bad name",
      "commands.flat",
    ]);
  });

  it("refuses commands that run themselves, directly or through others", () => {
    const { commands, problems } = parseUserCommands({
      a: { run: ["user.b"] },
      b: { run: ["user.a"] },
      self: { run: ["user.self"] },
      fine: { run: ["user.leaf", "view.zoomIn"] },
      leaf: { run: ["view.zoomOut"] },
    });
    expect(Object.keys(commands).sort()).toEqual(["fine", "leaf"]);
    expect(problems.map((p) => p.key).sort()).toEqual([
      "commands.a",
      "commands.b",
      "commands.self",
    ]);
  });

  it("is read from config.toml's [commands] table", () => {
    const { values, problems } = configToPreferences({
      commands: { mine: { run: ["view.zoomIn"] } },
    });
    expect(problems).toEqual([]);
    expect(values.userCommands).toEqual({ mine: { run: ["view.zoomIn"] } });
  });

  it("becomes user.<name> palette commands", () => {
    expect(
      userCommandDefinitions({
        mine: { run: ["a.b"] },
        titled: { title: "My title", run: ["a.b"] },
      }).map((c) => [c.id, c.title]),
    ).toEqual([
      ["user.mine", "mine"],
      ["user.titled", "My title"],
    ]);
  });
});

describe("runSteps", () => {
  it("runs in order, waiting for each step", async () => {
    const log: string[] = [];
    const runner: StepRunner = {
      runAndWait: async (id) => {
        log.push(`start ${id}`);
        await new Promise((r) => setTimeout(r, id === "slow" ? 5 : 0));
        log.push(`end ${id}`);
        return true;
      },
    };
    expect(await runSteps(["slow", "fast"], runner)).toEqual({ ok: true });
    expect(log).toEqual(["start slow", "end slow", "start fast", "end fast"]);
  });

  it("stops at the first step that cannot run", async () => {
    const ran: string[] = [];
    const runner: StepRunner = {
      runAndWait: async (id) => {
        ran.push(id);
        return id !== "missing";
      },
    };
    expect(await runSteps(["a", "missing", "c"], runner)).toEqual({
      ok: false,
      step: 2,
      id: "missing",
    });
    expect(ran).toEqual(["a", "missing"]);
  });
});

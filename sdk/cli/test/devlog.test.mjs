import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { devLogPath, tailLog } from "../src/devlog.mjs";

const dirs = [];
afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop(), { recursive: true, force: true });
  }
});
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "vdlog-"));
  dirs.push(d);
  return d;
};
const until = async (cond) => {
  for (let i = 0; i < 100 && !cond(); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("dev log tail", () => {
  it("resolves the file under the state folder", () => {
    expect(devLogPath({ VAULTDRAW_STATE_DIR: "/s", HOME: "/h" }, "demo")).toBe(
      "/s/plugin-logs/demo.log",
    );
    expect(devLogPath({}, "demo")).toBeNull();
  });

  it("shows only new lines, even from a file that does not exist yet", async () => {
    const file = path.join(tmp(), "demo.log");
    const lines = [];
    const stop = tailLog(file, (l) => lines.push(l), 10);
    writeFileSync(file, "a\nb");
    appendFileSync(file, "\nc\n");
    await until(() => lines.length >= 3);
    stop();
    expect(lines).toEqual(["log | a", "log | b", "log | c"]);
  });

  it("skips what was there at the start and survives a trim", async () => {
    const file = path.join(tmp(), "demo.log");
    writeFileSync(file, "old\nold2\n");
    const lines = [];
    const stop = tailLog(file, (l) => lines.push(l), 10);
    appendFileSync(file, "new\n");
    await until(() => lines.length >= 1);
    writeFileSync(file, "x\n"); // shorter than before: trimmed by the app
    await until(() => lines.length >= 2);
    stop();
    expect(lines).toEqual(["log | new", "log | x"]);
  });
});

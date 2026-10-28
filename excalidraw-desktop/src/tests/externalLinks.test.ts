import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "tests" ? [] : walk(full);
    }
    return /\.tsx$/.test(full) && !/\.test\./.test(full) ? [full] : [];
  });

describe("external links", () => {
  it('no component uses target="_blank" (it does nothing in the desktop webview)', () => {
    const offenders = walk(join(__dirname, ".."))
      .filter((f) =>
        /^[^*/\n]*target=["{]_?blank/m.test(readFileSync(f, "utf8")),
      )
      .map((f) => f.replace(join(__dirname, ".."), "src"));
    expect(offenders).toEqual([]);
  });
});

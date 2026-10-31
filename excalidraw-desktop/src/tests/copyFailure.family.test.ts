/**
 * Family hunter shell (2026-10-31): "every copy action reports success AND failure, in plain
 * words, as an error notice" (toimprove 207 fixed the tab menu; this lists every writer of the
 * clipboard in the app and the official plugins). A source scan, because each writer is a
 * different component or hook: the text between the `writeText` call and the end of its
 * `catch` must show the user something (error toast, inline status or plugin toast), must not
 * print the raw error (`errorMessage(err)`: "NotAllowedError ..."), and a toast must be an
 * error toast, so it stays as long as the user's notice time says for errors.
 * A new `writeText` outside this table fails the first test: add its row.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const DESKTOP = join(__dirname, "..", "..");

type Way = "error-toast" | "inline" | "plugin-toast";
const MEMBERS: {
  file: string;
  way: Way;
  broken?: { kindOrWords: string };
}[] = [
  { file: "src/components/menu/copyPath.ts", way: "error-toast" },
  { file: "src/tabs/useTabs.ts", way: "error-toast" },
  { file: "src/components/ReportDialog.tsx", way: "inline" },
  {
    file: "src/ai/aiSwitch.ts",
    way: "error-toast",
  },
  {
    file: "src/links/useAppLinks.tsx",
    way: "error-toast",
  },
  { file: "src/vault/clipboard.ts", way: "inline" },
  {
    file: "../plugins/official/ai-assistant/src/session.ts",
    way: "plugin-toast",
  },
];

/** The part of the file from `writeText` to the end of the following catch block. */
const failurePath = (text: string): string => {
  const at = text.indexOf("writeText");
  const rest = text.slice(at);
  const c = rest.search(/catch\b/);
  return c < 0 ? "" : rest.slice(c, c + 260);
};

describe("family (shell hunter): every copy action reports its failure", () => {
  it("the table lists every clipboard writer in the app and official plugins", () => {
    const out = execFileSync(
      "git",
      [
        "grep",
        "-l",
        "-E",
        "clipboard\\.writeText",
        "--",
        "src",
        "../plugins/official",
      ],
      { cwd: DESKTOP, encoding: "utf8" },
    )
      .split("\n")
      .filter((f) => f && !/\.(test|spec)\./.test(f) && !f.includes("/test/"));
    expect(out.sort()).toEqual(MEMBERS.map((m) => m.file).sort());
  });

  for (const m of MEMBERS) {
    const text = readFileSync(join(DESKTOP, m.file), "utf8");
    // `vault/clipboard.ts` throws: its callers (the editor's export error) show the failure.
    const body = m.file.endsWith("vault/clipboard.ts") ? "" : failurePath(text);
    const ok = () => {
      if (m.file.endsWith("vault/clipboard.ts")) {
        expect(text).not.toMatch(/catch\s*\{\s*\}/);
        return;
      }
      expect(body, "a catch that tells the user").not.toBe("");
      expect(body).not.toMatch(/errorMessage\(/);
      if (m.way === "error-toast") {
        expect(body).toMatch(/kind:\s*"error"|"error"\)/);
      }
      if (m.way === "inline") {
        expect(body).toMatch(/Could not copy/);
      }
      if (m.way === "plugin-toast") {
        expect(body).toMatch(/Could not copy/);
      }
    };
    (m.broken ? it.fails : it)(
      `${m.file}: ${
        m.broken?.kindOrWords ?? "failure is shown in plain words"
      }`,
      ok,
    );
  }
});

import { describe, expect, test } from "vitest";

import { chooseImportFolder } from "../../src/obsidian/freshFolder";

const fake = (dirs: Record<string, number>) => async (dir: string) => {
  if (!(dir in dirs)) {
    throw Object.assign(new Error("missing"), { code: "NOT_FOUND" });
  }
  return new Array(dirs[dir]).fill({});
};

describe("chooseImportFolder", () => {
  test("a missing folder is used as is", async () => {
    expect(await chooseImportFolder("Vault", fake({}))).toBe("Vault");
  });
  test("an empty folder is used as is", async () => {
    expect(await chooseImportFolder("Vault", fake({ Vault: 0 }))).toBe("Vault");
  });
  test("a non-empty folder (even a partial overlap) moves to a fresh one first", async () => {
    expect(await chooseImportFolder("Vault", fake({ Vault: 3 }))).toBe(
      "Vault (import 2)",
    );
  });
  test("skips numbered folders that are taken", async () => {
    expect(
      await chooseImportFolder(
        "Vault",
        fake({ Vault: 1, "Vault (import 2)": 2, "Vault (import 3)": 0 }),
      ),
    ).toBe("Vault (import 3)");
  });
  test("other errors are not swallowed", async () => {
    await expect(
      chooseImportFolder("Vault", async () => {
        throw Object.assign(new Error("io"), { code: "IO_ERROR" });
      }),
    ).rejects.toThrow("io");
  });
});

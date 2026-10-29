import { describe, expect, it } from "vitest";

import { DesktopVaultRepository } from "../vault/DesktopVaultRepository";

import { FakeVaultRepository } from "./fakeVaultRepository";

/**
 * Guard (bug utilizer, 2026-10-30): the browser fake behind every Playwright test offers every
 * method the native repository has. A missing optional method sends the app down another branch
 * in the browser than on the Mac, so a bug in the native branch is invisible to every e2e test:
 * the fake had no readRevision, and the native one refuses notes, so note tabs never followed an
 * outside rename on the Mac while the e2e passed. Add an exception only with a reason.
 */
const NOT_NEEDED: Record<string, string> = {
  getInvoke: "private: loads the Tauri bridge",
  getListen: "private: loads the Tauri event bridge",
  downloadPlaceholder:
    "iCloud placeholders do not exist in the browser harness",
};

const methods = (proto: object) =>
  Object.getOwnPropertyNames(proto).filter((n) => {
    const d = Object.getOwnPropertyDescriptor(proto, n);
    return n !== "constructor" && typeof d?.value === "function";
  });

describe("the fake vault repository has the native one's methods", () => {
  it("no native method is missing from the fake (or it is listed with a reason)", () => {
    const fake = new Set(methods(FakeVaultRepository.prototype));
    const missing = methods(DesktopVaultRepository.prototype).filter(
      (m) => !fake.has(m) && !(m in NOT_NEEDED),
    );
    expect(missing).toEqual([]);
  });

  it("every listed exception still exists natively (no stale entries)", () => {
    const real = new Set(methods(DesktopVaultRepository.prototype));
    expect(Object.keys(NOT_NEEDED).filter((m) => !real.has(m))).toEqual([]);
  });
});

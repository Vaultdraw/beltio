import { expect, test } from "@playwright/test";

test("passes at once", () => {
  expect(1).toBe(1);
});
test("waits when asked", async () => {
  await new Promise((r) => setTimeout(r, Number(process.env.SLOW_MS) || 0));
});

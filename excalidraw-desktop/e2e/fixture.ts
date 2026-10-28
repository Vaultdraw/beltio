import { expect, test as base } from "@playwright/test";

import { trackErrors } from "./helpers";

/**
 * Shared fixture for the family sweeps: any console error or page error fails
 * the test unless the spec lists it in `allowedErrors` (one RegExp; combine several with |).
 * Always on (auto fixture): a sweep that forgets to check errors still checks.
 */
export const test = base.extend<{
  allowedErrors: RegExp | null;
  errors: string[];
}>({
  allowedErrors: [null, { option: true }],
  errors: [
    async ({ page, allowedErrors }, use) => {
      const errors = trackErrors(page);
      await use(errors);
      const unexpected = errors.filter((e) => !allowedErrors?.test(e));
      expect(unexpected, "console or page errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

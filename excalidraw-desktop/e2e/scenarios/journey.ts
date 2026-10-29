import { type Page } from "@playwright/test";

import { expect, test } from "../fixture";

import { type CheckOptions, stepProblems } from "./checks";

/**
 * A journey is one long, realistic user session: many steps through visible UI, and after each
 * step the shared checks (checks.ts) look at what the user sees. It runs in light and dark.
 * Every problem from every step is collected and reported together (the bug list), unless a
 * step cannot run (then the later steps could not run either, so the journey stops there).
 *
 * `knownBug` marks a journey that fails today because of a logged bug ("toimprove 123"): it is
 * registered with test.fail, so it stays green while the bug exists and turns red the moment
 * the bug is fixed (then delete knownBug).
 */

export type Step = {
  name: string;
  run: (page: Page, ctx: Ctx) => Promise<void>;
  /** Extra assertions on what the user sees; throw (expect) to fail the step. */
  check?: CheckOptions;
  /** Keyboard step: the focus check is on. Mouse steps skip it. */
  keyboard?: boolean;
};

export type Ctx = {
  theme: "light" | "dark";
  /** Free store for steps (paths, names, counts). */
  data: Record<string, any>;
  /** Milliseconds per step name, for the journeys that record timings. */
  timings: Record<string, number>;
  /** A step reports something wrong the user would see, without stopping the journey. */
  report: (problem: string) => void;
};

export type Journey = {
  title: string;
  setup: (page: Page, ctx: Ctx) => Promise<void>;
  steps: Step[];
  themes?: ("light" | "dark")[];
  knownBug?: string;
  /**
   * Problems that exist today because of a logged bug. A problem whose text matches is not a failure;
   * when it stops appearing the journey fails ("fixed: remove it"), so a fix is noticed.
   */
  known?: { match: RegExp; bug: string; theme?: "light" | "dark" }[];
  /** Errors the journey is allowed to produce (one RegExp), same as the fixture's option. */
  allowedErrors?: RegExp;
  timeoutMs?: number;
  /** Called with the timings at the end (for assertions on budgets). */
  onTimings?: (timings: Record<string, number>, theme: string) => void;
};

/**
 * Logged bugs that show on many screens and appear or not depending on timing (the home list
 * fills in a moment after start): they never fail a journey and are never reported stale.
 * Remove an entry when its bug is fixed.
 */
const GLOBAL_KNOWN: { match: RegExp; bug: string }[] = [];

export const journey = (j: Journey) => {
  for (const theme of j.themes ?? (["light", "dark"] as const)) {
    test.describe(j.title, () => {
      if (j.allowedErrors) {
        test.use({ allowedErrors: j.allowedErrors });
      }
      test(`${theme}`, async ({ page }) => {
        test.setTimeout(j.timeoutMs ?? 180_000);
        if (j.knownBug) {
          test.fail(true, j.knownBug);
        }
        page.setDefaultTimeout(15_000);
        await page.emulateMedia({ colorScheme: theme });
        const reported: string[] = [];
        const ctx: Ctx = {
          theme,
          data: {},
          timings: {},
          report: (p) => reported.push(p),
        };
        const problems: string[] = [];
        // A problem that stays on screen is reported at the first step that shows it, once.
        const seen = new Set<string>();
        const add = (prefix: string, found: string[]) => {
          for (const p of found) {
            if (!seen.has(p)) {
              seen.add(p);
              problems.push(`${prefix}: ${p}`);
            }
          }
        };
        await j.setup(page, ctx);
        add("setup", await stepProblems(page));
        let n = 0;
        for (const step of j.steps) {
          n++;
          const where = `step ${n} "${step.name}"`;
          const t0 = Date.now();
          try {
            await test.step(step.name, () => step.run(page, ctx));
          } catch (e) {
            problems.push(
              `${where} could not run: ${String(e)
                .replace(/\s+/g, " ")
                .slice(0, 500)}`,
            );
            await page
              .screenshot({
                path: `../.cache/scenarios/${j.title.replace(
                  /\W+/g,
                  "_",
                )}-${theme}-step${n}.png`,
              })
              .catch(() => {});
            break;
          }
          ctx.timings[step.name] = Date.now() - t0;
          add(where, reported.splice(0));
          const found = await stepProblems(page, {
            skipFocus: !step.keyboard,
            ...step.check,
          });
          add(where, found);
        }
        j.onTimings?.(ctx.timings, theme);
        const known = (j.known ?? []).filter(
          (k) => !k.theme || k.theme === theme,
        );
        const stale = known
          .filter((k) => !problems.some((p) => k.match.test(p)))
          .map(
            (k) =>
              `known problem no longer shows (${k.bug}): remove it from the journey`,
          );
        const unexpected = problems.filter(
          (p) =>
            !known.some((k) => k.match.test(p)) &&
            !GLOBAL_KNOWN.some((k) => k.match.test(p)),
        );
        expect(
          [...unexpected, ...stale],
          `${j.title} (${theme}): what the user would see wrong, step by step`,
        ).toEqual([]);
      });
    });
  }
};

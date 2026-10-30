import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { openDrawing, openVault } from "../helpers";

// Family (test-net-2): "a palette command does nothing, breaks the window or throws" fails for
// every command in the registry. The list comes from registry-snapshot.json, which a unit test
// (src/commands/registrySnapshot.test.ts) keeps equal to the real registry, so a new command is
// run here by itself. Each command runs through the visible palette in the first state where it
// can run (home, drawing with a selection, note), then: no page error, the window answers,
// Escape and undo leave it usable, and the screen changed or a notice says why not.

type Cmd = {
  id: string;
  title: string;
  category: string;
  keys: string[];
  when: string[];
  palette: boolean;
};
const snap = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "e2e/families/registry-snapshot.json"),
    "utf8",
  ),
) as { commands: Cmd[] };

/** Commands not run through the palette, each with its reason. Every entry must match a command. */
const SKIP: { match: RegExp; reason: string }[] = [
  {
    match:
      /^(vault\.switch|vault\.open|file\.revealInFinder|cli\.install|cli\.installSystem|app\.restart|window\.)/,
    reason:
      "leaves the page: native folder picker, Finder, installs into the system or restarts the app; covered by the packaged smoke",
  },
  {
    match: /^(backup\.|config\.openFolder|config\.reveal)/,
    reason: "writes outside the vault or opens a native picker or Finder",
  },
  {
    match:
      /^(history\.(previous|next|restore|restoreReplace|restoreCopy|copySelection|exportExcalidraw|exportImage|toggleHighlights|deleteCheckpoint|backToCurrent|dismissGitNotice)|themeBrowser\.|page\.dismissNotice|vault\.retryWritable|file\.resolveConflict|links\.registerHandlers|list\.(nextView|showAsGrid)|navigator\.clearSearch|thumbnails\.|snippets\.)/,
    reason:
      "only offered in a state this family does not build (history panel with a checkpoint, theme browser open, a conflict or read-only banner, an active search, list focus, snippets on); covered by the hotkeys family or their own specs",
  },
  {
    match:
      /^(memory\.freeUnusedImages|sync\.(compareWithConflictCopy|keepThis|keepOther))$/,
    reason:
      "offered only with unused images in memory or a conflict copy beside the file; not built here",
  },
  {
    match: /^vault\.(backup|restoreBackup)$/,
    reason: "writes a backup outside the vault or opens a native picker",
  },
  {
    match: /^palette\.commands$/,
    reason: "is the palette itself: every row opens it",
  },
];

/** Logged bugs: a problem for this command id is not a failure (and fails when it stops showing). */
const KNOWN: { id: RegExp; match: RegExp; bug: string }[] = [];

/** Commands that delete or reset: run last, each on a fresh throwaway vault. */
const DESTRUCTIVE =
  /delete|trash|remove|reset|clear|close(All|Vault)|uninstall|forget/i;

const palette = (p: Page) => p.getByRole("dialog", { name: "Command palette" });

const signature = (p: Page) =>
  p.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("canvas, script, style").forEach((n) => n.remove());
    return `${clone.innerText.length}|${
      document.querySelectorAll('[role="dialog"]').length
    }|${document.documentElement.getAttribute("style")}|${
      document.body.className
    }|${document.documentElement.className}|${
      clone.querySelectorAll("*").length
    }`;
  });

const hasNotice = (p: Page) =>
  p.evaluate(
    () =>
      !!document.querySelector(
        '[role="status"], [role="alert"], .toast, .Toast, .vault-notice, .vault-modal, [role="dialog"]',
      ),
  );

const answers = (p: Page, ms = 4000) =>
  Promise.race([
    p.evaluate(() => 1).then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), ms)),
  ]);

const settle = async (p: Page) => {
  for (let i = 0; i < 3; i++) {
    await p.keyboard.press("Escape");
  }
};

/** Runs one command through the palette. Returns null when it is not offered in this state. */
const run = async (
  page: Page,
  cmd: Cmd,
  errors: string[],
  onStuck: () => Promise<void>,
): Promise<{ ran: boolean; problems: string[] }> => {
  const problems: string[] = [];
  const errorsBefore = errors.length;
  const t0 = Date.now();
  const lap: string[] = [];
  const mark = (n: string) => lap.push(`${n}=${Date.now() - t0}`);
  const dlg = palette(page);
  const openPalette = async (ms: number) => {
    await settle(page);
    await page.keyboard.press("Meta+Shift+KeyP");
    return dlg.waitFor({ timeout: ms }).then(
      () => true,
      () => false,
    );
  };
  if (!(await openPalette(1500))) {
    // The previous command left a state Escape cannot leave: that is its problem. Start afresh.
    await onStuck();
    if (!(await openPalette(4000))) {
      return { ran: false, problems };
    }
  }
  await dlg.getByRole("combobox").fill(`>${cmd.title}`);
  // The palette shows at most 80 rows and fills in a moment: poll a short while for this row.
  let idx = -1;
  for (let i = 0; i < 6 && idx < 0; i++) {
    await page.waitForTimeout(i === 0 ? 60 : 120);
    const texts = await dlg.getByRole("option").allInnerTexts();
    idx = texts.findIndex((t) =>
      t.replace(/\s+/g, " ").trim().startsWith(cmd.title),
    );
  }
  if (idx < 0) {
    await settle(page);
    return { ran: false, problems };
  }
  mark("found");
  const before = await signature(page);
  mark("sig");
  await dlg.getByRole("option").nth(idx).click({ timeout: 3000 });
  mark("click");
  await page.waitForTimeout(250);
  if (!(await answers(page))) {
    problems.push("the window stopped answering after the command");
    return { ran: true, problems };
  }
  const after = await signature(page);
  if (after === before && !(await hasNotice(page))) {
    problems.push("nothing visible changed and no notice explained why");
  }
  await settle(page);
  await page.keyboard.press("Meta+KeyZ");
  await page.waitForTimeout(100);
  if (!(await answers(page))) {
    problems.push("the window stopped answering after Escape and undo");
  }
  mark("end");
  if (Date.now() - t0 > 3000) {
    // eslint-disable-next-line no-console
    console.log(`SLOW ${cmd.id} ${lap.join(" ")}`);
  }
  const fresh = errors.slice(errorsBefore);
  for (const e of fresh) {
    problems.push(`error: ${e.slice(0, 160)}`);
  }
  return { ran: true, problems };
};

const seedContext = async (page: Page, kind: "home" | "drawing" | "note") => {
  await openVault(page, "?seed=obsidian");
  if (kind === "home") {
    return;
  }
  if (kind === "drawing") {
    const graphs = page
      .locator(".vault-tree-item__name", { hasText: "Graphs" })
      .first();
    if (!(await graphs.isVisible().catch(() => false))) {
      await page
        .locator(".vault-tree-item__name", { hasText: "DSA" })
        .first()
        .click();
    }
    await openDrawing(page, "Graphs");
    await page.keyboard.press("Meta+KeyA");
    return;
  }
  await page.locator('.vault-tree-item[data-tree-path="Welcome.md"]').click();
  await expect(page.getByTestId("note-reading")).toBeVisible();
};

const needs = (c: Cmd) => ({
  drawing: c.when.includes("drawingOpen"),
  writable: c.when.includes("writable"),
});

test("every palette command, in the state where it can run", async ({
  page,
  errors,
}) => {
  test.skip(
    !process.env.TN2_FULL,
    "about 20 minutes: run with TN2_FULL=1 (once per batch of merges, by QA)",
  );
  test.setTimeout(60 * 60_000);
  page.setDefaultTimeout(4000);
  const t0 = Date.now();
  const skipped = new Map<string, string>();
  const todo: Cmd[] = [];
  for (const c of snap.commands) {
    const s = SKIP.find((x) => x.match.test(c.id));
    if (s) {
      skipped.set(c.id, s.reason);
    } else if (c.palette) {
      todo.push(c);
    } else {
      skipped.set(
        c.id,
        "not listed in the palette (hotkey-only; run by the hotkeys family)",
      );
    }
  }
  for (const s of SKIP) {
    expect(
      snap.commands.some((c) => s.match.test(c.id)),
      `skip entry matches nothing: ${s.match}`,
    ).toBe(true);
  }
  const safe = todo.filter((c) => !DESTRUCTIVE.test(c.id + c.title));
  const destructive = todo.filter((c) => DESTRUCTIVE.test(c.id + c.title));

  const results = new Map<string, string[]>();
  const ran = new Set<string>();
  const record = (c: Cmd, r: { ran: boolean; problems: string[] }) => {
    if (r.ran) {
      ran.add(c.id);
      results.set(c.id, [...(results.get(c.id) ?? []), ...r.problems]);
    }
  };

  let state: "home" | "drawing" | "note" = "home";
  const lastRan: { id: string | null } = { id: null };
  const fresh = async () => {
    await seedContext(page, state);
    errors.length = 0;
  };
  const go = async (list: Cmd[]) => {
    for (const c of list) {
      const r = await run(page, c, errors, async () => {
        if (lastRan.id) {
          results.set(lastRan.id, [
            ...(results.get(lastRan.id) ?? []),
            "left the app in a state Escape does not leave (the palette would not open next)",
          ]);
        }
        await fresh();
      });
      record(c, r);
      if (r.ran) {
        lastRan.id = c.id;
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `PHASE ${state} done ${(Date.now() - t0) / 1000}s, ran ${ran.size}`,
    );
  };
  // 1. Home: nothing open.
  if (!process.env.TN2_SKIP_HOME) {
    await fresh();
    await go(safe.filter((c) => !needs(c).drawing));
  }
  // 2. A drawing with everything selected.
  state = "drawing";
  await fresh();
  await go(safe.filter((c) => !ran.has(c.id)));
  // 3. A note.
  state = "note";
  await fresh();
  await go(safe.filter((c) => !ran.has(c.id)));
  // 4. Destructive commands: each on a fresh throwaway vault, with a drawing open.
  state = "drawing";
  for (const c of destructive) {
    await fresh();
    await go([c]);
  }

  const never = todo.filter((c) => !ran.has(c.id));
  // eslint-disable-next-line no-console
  console.log(
    `COMMANDS total ${snap.commands.length}, ran ${
      ran.size
    }, skipped with reason ${skipped.size}, never offered ${
      never.length
    }: ${never.map((c) => c.id).join(" ")}`,
  );
  const failures: string[] = [];
  const matchedKnown = new Set<number>();
  for (const [id, probs] of results) {
    for (const p of probs) {
      const k = KNOWN.findIndex((x) => x.id.test(id) && x.match.test(p));
      if (k >= 0) {
        matchedKnown.add(k);
      } else {
        failures.push(`${id}: ${p}`);
      }
    }
  }
  KNOWN.forEach((k, i) => {
    if (!matchedKnown.has(i)) {
      failures.push(`known problem no longer shows, remove it: ${k.bug}`);
    }
  });
  for (const c of never) {
    failures.push(
      `${c.id}: never offered in any state (needs a test row or a SKIP reason)`,
    );
  }
  expect(failures, failures.join("\n")).toEqual([]);
});

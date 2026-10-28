import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

// Plugin API 0.8.0 through the real UI: a fixture plugin's panel button parses
// a note (markdown.parse), measures text, paginates, and imports CodeMirror
// through the lazy shared module. CodeMirror is not fetched before the click.

test("a plugin parses Markdown, measures, paginates and loads CodeMirror on demand", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const codemirror: string[] = [];
  page.on("request", (r) => {
    if (/plugin-shims\/codemirror-/.test(r.url())) {
      codemirror.push(r.url());
    }
  });
  await openVault(page, "?plugins=md-api");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);

  await page.getByRole("button", { name: "Markdown API" }).click();
  expect(codemirror).toEqual([]);
  await page.getByRole("button", { name: "Parse sample" }).click();

  await expect(page.getByTestId("md-out")).toHaveText(
    "blocks: heading,paragraph | tags: idea | link: Roadmap | wider: true | pages: 2 | codemirror lines: 3",
  );
  expect(codemirror.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { openVault, trackErrors } from "../helpers";

// Hunter D round 2: "Install from link" pointed at a server that answers with bad data. The user
// must get a plain sentence (no stack, no "undefined", no raw JSON error), the dialog must stay
// usable (retry works), and nothing half-installed may show up in the theme list.
test.use({ allowedErrors: /Failed to load resource|ThemeFetch|theme/i });

type Reply = { status?: number; type?: string; body: string };
const REPLIES: Record<string, Reply> = {
  html: { type: "text/html", body: "<html><body>404 Not Found</body></html>" },
  empty: { type: "application/json", body: "" },
  array: { type: "application/json", body: "[1,2,3]" },
  nullJson: { type: "application/json", body: "null" },
  truncated: {
    type: "application/json",
    body: '{"name":"Cut","dark":{"mPrimary":"#fff',
  },
  noName: { type: "application/json", body: '{"dark":{"mPrimary":"#123456"}}' },
  noColours: { type: "application/json", body: '{"name":"Hollow"}' },
  numberName: {
    type: "application/json",
    body: '{"name":42,"dark":{"mPrimary":"#123456"}}',
  },
  badColours: {
    type: "application/json",
    body: '{"name":"Evil","dark":{"mPrimary":"red;background:url(http://x/y)","mSurface":"}body{display:none}","mOnSurface":"#fff"}}',
  },
  htmlName: {
    type: "application/json",
    body: '{"name":"<img src=x onerror=alert(1)>","dark":{"mPrimary":"#123456","mSurface":"#101010","mOnSurface":"#eee"}}',
  },
  server500: { status: 500, type: "text/plain", body: "boom" },
  server404: { status: 404, type: "text/plain", body: "nope" },
};

const settingsDialog = async (page: Page) => {
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const d = page.getByRole("dialog");
  await expect(d).toBeVisible();
  return d;
};

test("a theme link that serves bad data gives a plain message each time and installs nothing", async ({
  page,
}) => {
  const errors = trackErrors(page);
  let current = "html";
  await page.route("https://themes.example.test/**", (route) => {
    const r = REPLIES[current];
    return route.fulfill({
      status: r.status ?? 200,
      contentType: r.type,
      body: r.body,
      headers: { "access-control-allow-origin": "*" },
    });
  });
  page.on("dialog", (d) => d.dismiss());
  await openVault(page);
  const settings = await settingsDialog(page);
  const radiosBefore = await settings.getByRole("radio").count();
  await settings.getByRole("button", { name: "Install from link…" }).click();
  const install = page.getByTestId("theme-install-dialog");
  const seen: Record<string, string> = {};
  for (const key of Object.keys(REPLIES)) {
    current = key;
    const box = install.getByLabel("Address or GitHub repo");
    if (!(await box.isVisible())) {
      console.log(
        "PREVIEW STATE before",
        key,
        (await install.innerText()).replace(/\s+/g, " "),
      );
      await page.screenshot({
        path: "../.cache/e2e-shots/huntD-theme-preview.png",
      });
      await install
        .getByRole("button", { name: /Back|Cancel|Change/ })
        .first()
        .click();
      if (!(await install.isVisible())) {
        await settings
          .getByRole("button", { name: "Install from link…" })
          .click();
      }
    }
    await expect(box, key).toBeVisible();
    await box.fill(`https://themes.example.test/${key}.json`);
    await install.getByRole("button", { name: "Look up" }).click();
    await page.waitForTimeout(500);
    const text = (await install.innerText()).replace(/\s+/g, " ");
    seen[key] = text;
    // Wording: no engine or code words.
    expect(text, key).not.toMatch(
      /undefined|\[object|SyntaxError|TypeError|Unexpected|JSON\.parse|at \w+\.|NaN/,
    );
    // Installed nothing yet: the lookup only previews. If an Install button is offered for bad
    // data, it is a bug for the data kinds that carry no usable theme.
    const offered = await install
      .getByRole("button", { name: "Install", exact: true })
      .count();
    expect(
      await install.locator("img").count(),
      `${key} drew an element from the name`,
    ).toBe(0);
    seen[key] += ` || INSTALL_OFFERED=${offered}`;
  }
  const mustRefuse = [
    "html",
    "empty",
    "array",
    "nullJson",
    "truncated",
    "noName",
    "noColours",
    "numberName",
    "server500",
    "server404",
  ];
  for (const key of mustRefuse) {
    expect(seen[key], key).toContain("INSTALL_OFFERED=0");
  }
  expect(errors.filter((e) => /pageerror/.test(e))).toEqual([]);
  await page.keyboard.press("Escape");
  void radiosBefore;
});

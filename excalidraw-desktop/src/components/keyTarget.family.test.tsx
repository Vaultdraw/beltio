import { describe, expect, it } from "vitest";

import { keyBelongsToControl } from "./keyTarget";

/**
 * Family sweep (bug hunt BH-15, BH-17): a container's key shortcut (list Enter, dialog Enter)
 * never steals a key from the focused control inside it. Members with real components:
 * pluginBrowserKeys.test.tsx, templatePickerKeys.test.tsx. Rows: what has focus -> whose key.
 */
const rows: [focused: string, html: string, control: boolean][] = [
  ["a button", `<button id="t">Uninstall</button>`, true],
  ["an icon inside a button", `<button><svg id="t"></svg></button>`, true],
  ["a link", `<a id="t" href="https://x">Source</a>`, true],
  ["a checkbox", `<input id="t" type="checkbox">`, true],
  ["a select", `<select id="t"><option>a</option></select>`, true],
  ["a textarea", `<textarea id="t"></textarea>`, true],
  ["a role=button div", `<div id="t" role="button" tabindex="0">x</div>`, true],
  ["a menu item", `<div id="t" role="menuitem" tabindex="0">x</div>`, true],
  ["the list's search box", `<input id="t" type="search">`, false],
  ["a combobox input", `<input id="t" role="combobox">`, false],
  ["a list row (option)", `<div id="t" role="option">Foo</div>`, false],
  ["the container itself", ``, false],
];

describe("keyBelongsToControl", () => {
  it.each(rows)(
    "focus on %s -> control handles the key: %s",
    (_n, html, control) => {
      const box = document.createElement("div");
      box.tabIndex = 0;
      box.innerHTML = html;
      document.body.append(box);
      const target = box.querySelector("#t") ?? box;
      expect(keyBelongsToControl({ target, currentTarget: box })).toBe(control);
      box.remove();
    },
  );

  it("the container's own input passed as `own` is never a control", () => {
    const box = document.createElement("div");
    box.innerHTML = `<input id="t" type="text">`;
    const input = box.querySelector("#t");
    expect(
      keyBelongsToControl({ target: input, currentTarget: box }, input),
    ).toBe(false);
  });
});

import { type Page } from "@playwright/test";

/**
 * Shared checks every scenario runs after each step (test-net). They look at what a user
 * sees: nothing sticks out of the window or its container, no text is cut off, text is
 * readable against what is behind it, a focused control shows it is focused, and no dialog
 * or notice is left over. Console and page errors are checked by the shared fixture
 * (e2e/fixture.ts). Every check returns plain sentences; an empty list means the screen is fine.
 */

export type CheckOptions = {
  /** Dialogs expected to be open right now (default 0). */
  dialogs?: number;
  /** Notices (toasts, banners) expected right now (default: any, they go away on their own). */
  notices?: number;
  /** Only look inside this element (default: the whole page). */
  scope?: string;
  /** Skip the focus check (mouse steps). */
  skipFocus?: boolean;
  /** Smallest contrast ratio for text (default 3: generous, WCAG large-text level). */
  minContrast?: number;
};

type Problems = { layout: string[]; contrast: string[]; focus: string[] };

const DIALOGS = '[role="dialog"], [role="alertdialog"], .Modal, .Dialog';
const NOTICES =
  '[role="status"], [role="alert"], .toast, .Toast, .vault-notice';

/** One page.evaluate: everything is measured in the page, so a check costs a few ms. */
export const inspect = (
  page: Page,
  options: CheckOptions = {},
): Promise<
  Problems & { dialogs: number; notices: number; dialogNames: string[] }
> =>
  page.evaluate(
    ({ dialogsSel, noticesSel, scope, minContrast }) => {
      const root: Element =
        (scope && document.querySelector(scope)) || document.body;
      const layout: string[] = [];
      const contrast: string[] = [];
      const focus: string[] = [];
      const label = (e: Element) =>
        (
          (e as HTMLElement).innerText ||
          e.getAttribute("aria-label") ||
          e.getAttribute("title") ||
          e.className?.toString() ||
          e.tagName
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 40) + (e.classList[0] ? ` (.${e.classList[0]})` : "");
      const shown = (e: Element) => {
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return (
          r.width > 2 &&
          r.height > 2 &&
          s.display !== "none" &&
          s.visibility !== "hidden" &&
          Number(s.opacity) > 0.05
        );
      };
      const inCanvas = (e: Element) =>
        !!e.closest("canvas, .excalidraw__canvas, svg");

      // Contrast helpers (sRGB relative luminance).
      const parse = (c: string): [number, number, number, number] | null => {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) {
          return null;
        }
        const p = m[1]
          .split(/[ ,/]+/)
          .filter(Boolean)
          .map(Number);
        return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
      };
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const backdrop = (e: Element): [number, number, number] | null => {
        // Walk up, mixing translucent layers over the next one; null when an image or gradient is behind.
        const layers: [number, number, number, number][] = [];
        for (let n: Element | null = e; n; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.backgroundImage !== "none") {
            return null;
          }
          const c = parse(s.backgroundColor);
          if (c && c[3] > 0) {
            layers.push(c);
            if (c[3] >= 1) {
              break;
            }
          }
        }
        let base: [number, number, number] = [255, 255, 255];
        const dark = matchMedia("(prefers-color-scheme: dark)").matches;
        if (dark && !layers.some((l) => l[3] >= 1)) {
          base = [0, 0, 0];
        }
        for (const l of layers.reverse()) {
          base = [
            l[0] * l[3] + base[0] * (1 - l[3]),
            l[1] * l[3] + base[1] * (1 - l[3]),
            l[2] * l[3] + base[2] * (1 - l[3]),
          ];
        }
        return base;
      };

      const rr = root.getBoundingClientRect();
      if (rr.right > innerWidth + 1 || rr.left < -1) {
        layout.push("the page sticks out horizontally");
      }
      if (document.documentElement.scrollWidth > innerWidth + 1) {
        layout.push("the window scrolls sideways");
      }

      let contrastSeen = 0;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      for (
        let n = walker.nextNode() as HTMLElement | null;
        n;
        n = walker.nextNode() as HTMLElement | null
      ) {
        if (
          !shown(n) ||
          inCanvas(n) ||
          n.closest("[aria-hidden='true'], [inert]")
        ) {
          continue;
        }
        const st = getComputedStyle(n);
        const hasText = Array.from(n.childNodes).some(
          (c) =>
            c.nodeType === 3 &&
            c.textContent &&
            c.textContent.trim().length > 0,
        );
        const own = Array.from(n.childNodes)
          .filter((c) => c.nodeType === 3)
          .map((c) => c.textContent ?? "")
          .join("")
          .trim();
        // Lone punctuation (a "/" between breadcrumbs) and Excalidraw's own hint line are skipped.
        if (
          !hasText ||
          /^[^\p{L}\p{N}]+$/u.test(own) ||
          n.closest(".HintViewer")
        ) {
          continue;
        }
        // Cut-off text: the box clips (overflow not visible) and the text is wider/taller than the box
        // without an ellipsis. Scrollable areas (auto/scroll) are fine.
        const clipsX = st.overflowX === "hidden" || st.overflowX === "clip";
        if (
          clipsX &&
          st.textOverflow !== "ellipsis" &&
          n.scrollWidth > n.clientWidth + 2 &&
          n.clientWidth > 2
        ) {
          layout.push(`text is cut off: "${label(n)}"`);
        }
        // Leaves its window sideways or hangs out of the screen.
        const r = n.getBoundingClientRect();
        if (r.right > innerWidth + 2 || r.left < -2) {
          layout.push(`"${label(n)}" is outside the window`);
        }
        // Contrast (cap the work: 400 text elements per check).
        if (
          contrastSeen < 400 &&
          !(n as HTMLButtonElement).disabled &&
          n.getAttribute("aria-disabled") !== "true"
        ) {
          contrastSeen++;
          const fg = parse(st.color);
          const bg = backdrop(n);
          if (fg && bg && Number(st.opacity) >= 0.9 && fg[3] >= 0.5) {
            const l1 = lum(fg);
            const l2 = lum(bg);
            const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            if (ratio < minContrast) {
              contrast.push(
                `"${label(n)}" is hard to read (contrast ${ratio.toFixed(
                  1,
                )}:1)`,
              );
            }
          }
        }
      }

      // Siblings of a control that overlap each other (icon over label).
      root
        .querySelectorAll(
          "button, [role=menuitem], [role=tab], label, .vault-tree-item",
        )
        .forEach((el) => {
          if (!shown(el)) {
            return;
          }
          const kids = Array.from(el.children).filter((c) => {
            const r = c.getBoundingClientRect();
            const s = getComputedStyle(c);
            return (
              r.width > 2 &&
              r.height > 2 &&
              s.position !== "absolute" &&
              s.visibility !== "hidden"
            );
          });
          for (let i = 0; i < kids.length; i++) {
            for (let j = i + 1; j < kids.length; j++) {
              const a = kids[i].getBoundingClientRect();
              const b = kids[j].getBoundingClientRect();
              const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (ox > 3 && oy > 3) {
                layout.push(
                  `"${label(kids[i])}" overlaps "${label(
                    kids[j],
                  )}" inside "${label(el)}"`,
                );
              }
            }
          }
        });

      // Focus: a focused control must show it (outline, ring or its own highlight).
      const a = document.activeElement as HTMLElement | null;
      if (
        a &&
        a !== document.body &&
        a !== document.documentElement &&
        // The editor's own container takes focus so keys reach the canvas; no ring by design.
        !a.classList.contains("excalidraw") &&
        shown(a) &&
        root.contains(a)
      ) {
        const s = getComputedStyle(a);
        const isEditable =
          a.tagName === "INPUT" ||
          a.tagName === "TEXTAREA" ||
          a.isContentEditable;
        const outline =
          s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
        // A ring may be drawn by a wrapper that has `:focus-within` (the Settings number stepper
        // rings its whole box): look up to three levels (TN-8 was this check missing it).
        let wrapped = false;
        for (
          let p = a.parentElement, i = 0;
          p && i < 3 && !wrapped;
          p = p.parentElement, i++
        ) {
          const ps = getComputedStyle(p);
          wrapped =
            p.matches(":focus-within") &&
            (ps.boxShadow !== "none" ||
              (ps.outlineStyle !== "none" && parseFloat(ps.outlineWidth) > 0));
        }
        const ring = s.boxShadow !== "none" || wrapped;
        const marked =
          a.matches(":focus-visible") ||
          a.getAttribute("aria-selected") === "true";
        if (
          !isEditable &&
          !outline &&
          !ring &&
          !marked &&
          a.tagName !== "CANVAS"
        ) {
          focus.push(`focus is on "${label(a)}" but nothing shows it`);
        }
        if (
          a.matches(":focus-visible") &&
          !outline &&
          !ring &&
          !isEditable &&
          a.tagName !== "CANVAS"
        ) {
          focus.push(
            `"${label(a)}" has keyboard focus without an outline or ring`,
          );
        }
      }

      const visibleEls = (sel: string) =>
        Array.from(document.querySelectorAll(sel)).filter(
          (e) => shown(e) && !e.closest("[aria-hidden='true']"),
        );
      const visible = (sel: string) => visibleEls(sel).length;
      // The editor's own property pickers carry role=dialog; they are not dialogs the user opened.
      const isPicker = (e: Element) =>
        e.matches(".color-picker-container, .FontPicker__container");
      const dialogEls = visibleEls(dialogsSel).filter((e) => !isPicker(e));
      const dialogNames = dialogEls.map(label);
      return {
        layout: [...new Set(layout)],
        contrast: [...new Set(contrast)],
        focus: [...new Set(focus)],
        dialogs: dialogEls.length,
        dialogNames,
        notices: visible(noticesSel),
      };
    },
    {
      dialogsSel: DIALOGS,
      noticesSel: NOTICES,
      scope: options.scope ?? "",
      minContrast: options.minContrast ?? 3,
    },
  );

/** Runs every check; returns the sentences of what is wrong (empty = fine). */
export const stepProblems = async (
  page: Page,
  options: CheckOptions = {},
): Promise<string[]> => {
  const r = await inspect(page, options);
  const out = [...r.layout, ...r.contrast];
  if (!options.skipFocus) {
    out.push(...r.focus);
  }
  const expectedDialogs = options.dialogs ?? 0;
  if (r.dialogs !== expectedDialogs) {
    out.push(
      `${
        r.dialogs
      } dialog(s) open, expected ${expectedDialogs}: ${r.dialogNames.join(
        " | ",
      )}`,
    );
  }
  if (options.notices !== undefined && r.notices !== options.notices) {
    out.push(`${r.notices} notice(s) showing, expected ${options.notices}`);
  }
  return out;
};

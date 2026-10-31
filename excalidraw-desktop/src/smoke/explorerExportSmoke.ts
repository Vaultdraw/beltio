/**
 * Packaged-app smoke step for exporting from the navigator row menu: PNG and
 * SVG render off-screen from the file (standard colours: runs while theme
 * canvas sync is on), and "Save a copy…" goes through the native
 * byte-for-byte copy into the smoke export sandbox.
 */

import { desktopRepository } from "../vault/DesktopVaultRepository";

import { captureExport, decodePng } from "./exportSmoke";

import type { ExportSmokeContext } from "./exportSmoke";

const pickRowMenuItem = async (ctx: ExportSmokeContext, label: string) => {
  const row = await ctx.waitFor("navigator row", () =>
    ctx.root.querySelector<HTMLElement>(
      `[data-tree-path="${ctx.win.CSS.escape(ctx.drawingPath)}"]`,
    ),
  );
  const box = row.getBoundingClientRect();
  row.dispatchEvent(
    new ctx.win.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: box.left + 20,
      clientY: box.top + box.height / 2,
    }),
  );
  const findItem = (text: string) =>
    Array.from(
      ctx.doc.querySelectorAll<HTMLElement>(".vault-menu [role='menuitem']"),
    ).find((el) => el.textContent?.trim() === text);
  // The file menu groups the export items under an "Export" submenu.
  const group = await ctx.waitFor("Export row menu group", () =>
    findItem("Export"),
  );
  group.click();
  const item = await ctx.waitFor(`${label} row menu item`, () =>
    findItem(label),
  );
  item.click();
};

export const explorerExportStep = async (ctx: ExportSmokeContext) => {
  const now = () => ctx.win.performance.now();
  const leaked = (svg: string) =>
    [...ctx.themeColours].filter((c) => svg.toLowerCase().includes(c));

  let t0 = now();
  const png = await captureExport(ctx, () =>
    pickRowMenuItem(ctx, "Export as PNG…"),
  );
  const pngMs = now() - t0;
  const decoded = await decodePng(ctx, png.bytes);

  t0 = now();
  const svg = await ctx.withSvgCsp(() =>
    captureExport(ctx, () => pickRowMenuItem(ctx, "Export as SVG…")),
  );
  const svgMs = now() - t0;
  const svgText = new TextDecoder().decode(svg.bytes);
  if (!svgText.includes("<svg")) {
    throw new Error("SVG export is not an SVG document");
  }
  const themeLeaks = leaked(svgText);
  if (themeLeaks.length > 0) {
    throw new Error(`SVG export has theme colours: ${themeLeaks.join(", ")}`);
  }

  // Native copy: the renderer never sees the bytes; Rust tests cover equality.
  const original = desktopRepository.saveDrawingCopy;
  let copied: boolean | null = null;
  desktopRepository.saveDrawingCopy = async (handle, path) => {
    copied = await original.call(desktopRepository, handle, path);
    return copied;
  };
  try {
    await pickRowMenuItem(ctx, "Save a copy…");
    await ctx.waitFor("native copy written", () => copied);
  } finally {
    desktopRepository.saveDrawingCopy = original;
  }

  return {
    png: {
      name: png.name,
      bytes: png.bytes.byteLength,
      width: decoded.width,
      height: decoded.height,
    },
    svg: { name: svg.name, bytes: svg.bytes.byteLength },
    copyWritten: copied,
    ms: { png: Math.round(pngMs), svg: Math.round(svgMs) },
  };
};

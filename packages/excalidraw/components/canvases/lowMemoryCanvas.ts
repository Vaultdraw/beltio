/**
 * Optional low-memory canvases (host switch `window.EXCALIDRAW_LOW_MEMORY_CANVAS`).
 *
 * A 2D canvas created with `willReadFrequently: true` is backed by CPU memory
 * instead of a GPU surface. WebKit then keeps no display buffers for it (three
 * window-sized buffers per accelerated canvas, about 14 MB each at 2x), which
 * lowers the whole-app peak by about 100 MB, but every paint is rasterised on
 * the CPU, so panning drops to about 60 frames per second.
 *
 * The attribute only takes effect on the first `getContext("2d")` call of a
 * canvas, so this runs right after the canvas is created and before anything
 * draws. It is read once per editor: a change applies to the next editor.
 */
export const primeLowMemoryCanvas = (
  canvas: HTMLCanvasElement,
  ownerDocument: Document,
): boolean => {
  if (ownerDocument.defaultView?.EXCALIDRAW_LOW_MEMORY_CANVAS !== true) {
    return false;
  }
  return canvas.getContext("2d", { willReadFrequently: true }) !== null;
};

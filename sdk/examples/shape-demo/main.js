// shape-demo: a custom shape.
// [[contributes.shapes]] adds "Insert shape: Badge" and a toolbar button. `render` returns one
// SVG document; the app draws it as an image and stores it in the drawing together with the
// shape's props, so the drawing opens without this plugin and shows the last picture.
// Change a shape with ctx.shapes.update(elementId, newProps) (it draws again, one undo step).
import { definePlugin } from "@vaultdraw/api";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export default definePlugin({
  activate(ctx) {
    ctx.shapes.register("badge", {
      defaults: { label: "New", color: "#e8590c" },
      render({ label, color }, { width, height }) {
        const r = Math.min(width, height) / 2;
        return (
          `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
          `<circle cx="${width / 2}" cy="${height / 2}" r="${
            r - 2
          }" fill="${esc(color)}"/>` +
          `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="${
            r / 2.5
          }" fill="#fff">${esc(label)}</text>` +
          `</svg>`
        );
      },
    });
    // Draw every badge of the open drawing again with a new label (one undo step each).
    ctx.commands.register("done", async () => {
      for (const el of ctx.scene.elements()) {
        const data = el.type === "image" ? ctx.scene.dataOf(el.id) : undefined;
        if (data && data.shape === "badge") {
          await ctx.shapes.update(el.id, { ...data.props, label: "Done" });
        }
      }
    });
  },
});

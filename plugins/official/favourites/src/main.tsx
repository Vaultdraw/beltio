/**
 * favourites: bookmarks for drawings, notes and single elements, in the user's order. An
 * official, bundled plugin: a side panel, a toggle command with a key, numbered jump commands
 * and menu items. The list lives in the vault's settings.toml (`[favourites]`) through the
 * plugin's own table, and follows renames and moves while the plugin is loaded.
 */
import { definePlugin } from "@vaultdraw/api";

import css from "./favourites.css";
import FavouritesPanel from "./FavouritesPanel";
import {
  defaultLabel,
  dropPath,
  MAX_FAVOURITES,
  renamePath,
  toggle,
  type Favourite,
} from "./model";
import { createStore } from "./store";

import type { PluginContext } from "@vaultdraw/api";

const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Opens the favourite; an element favourite also selects and scrolls to it once the drawing shows. */
async function openFavourite(ctx: PluginContext, f: Favourite) {
  const already = ctx.workspace.activePath() === f.path;
  try {
    await ctx.workspace.open(f.path);
  } catch {
    ctx.ui.toast(`Could not open ${f.path}`);
    return;
  }
  const { element } = f;
  if (!element) {
    return;
  }
  // Like a bookmark to a missing target: say so, never open the drawing and do nothing.
  const reveal = () => {
    if (ctx.scene.elements().some((x) => x.id === element)) {
      ctx.scene.scrollTo(element);
    } else {
      ctx.ui.toast("That element is no longer in the drawing");
    }
  };
  if (already) {
    reveal();
    return;
  }
  let timer = 0;
  const sub = ctx.scene.onChange((e) => {
    if (e.path === f.path) {
      sub.dispose();
      clearTimeout(timer);
      reveal();
    }
  });
  timer = window.setTimeout(() => {
    sub.dispose();
    reveal();
  }, 1500);
}

export default definePlugin({
  activate(ctx) {
    const el = document.createElement("style");
    el.textContent = css;
    document.head.appendChild(el);
    ctx.subscriptions.push({ dispose: () => el.remove() });

    const store = createStore(ctx);
    ctx.panels.register("list", () => (
      <FavouritesPanel store={store} open={(f) => void openFavourite(ctx, f)} />
    ));

    void store.reload();
    ctx.subscriptions.push(
      ctx.events.on("vault.opened", () => void store.reload()),
      ctx.events.on("drawing.renamed", (e) => {
        void store.update((all) => renamePath(all, e.from, e.to));
      }),
      ctx.events.on("drawing.deleted", (e) => {
        void store.update((all) => dropPath(all, e.path));
      }),
    );

    const announce = (r: { added: boolean; full?: boolean }, what: string) =>
      ctx.ui.toast(
        r.full
          ? `Favourites are full (${MAX_FAVOURITES}). Remove one to add ${what}`
          : r.added
          ? `Added ${what} to favourites`
          : `Removed ${what} from favourites`,
      );

    ctx.commands.register("toggle", async () => {
      // From a menu the target is the row or tab; from the palette or a key, the open drawing.
      const path = ctx.menus.target()?.path ?? ctx.workspace.activePath();
      if (!path) {
        ctx.ui.toast("Open a drawing first");
        return;
      }
      await store.reload();
      const r = toggle(store.get(), path);
      await store.set(r.items);
      announce(r, defaultLabel(path));
    });

    ctx.commands.register("toggle-element", async () => {
      const path = ctx.workspace.activePath();
      const id = ctx.scene.selection()[0];
      if (!path || !id) {
        ctx.ui.toast("Select an element first");
        return;
      }
      const node = ctx.scene.elements().find((x) => x.id === id);
      const text = node?.text?.replace(/\s+/g, " ").trim();
      const label = text
        ? text.slice(0, 40)
        : `${defaultLabel(path)}: ${node?.type ?? "element"}`;
      await store.reload();
      const r = toggle(store.get(), path, id, label);
      await store.set(r.items);
      announce(r, label);
    });

    for (const n of SLOTS) {
      ctx.commands.register(`open${n}`, async () => {
        await store.reload();
        const f = store.get()[n - 1];
        if (!f) {
          ctx.ui.toast(`No favourite ${n}`);
          return;
        }
        await openFavourite(ctx, f);
      });
    }
  },
});

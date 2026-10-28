/**
 * Packaged trial, second mode (`VAULTDRAW_PERF_SUITE=inplace`): the test folder is an Obsidian vault
 * opened in place. Reports the tree, the search index start (time to ready), searches, and for
 * every note the images it references: how many the reading view's backend finds (`read_note_asset`),
 * plus a few notes opened in the real reading view with their image elements counted.
 */
import { invoke } from "@tauri-apps/api/core";

import { desktopRepository } from "../vault/DesktopVaultRepository";
import { readNote } from "../notes/noteFiles";

import type { VaultEntry } from "../vault/types";

const WIKI = /!\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;
const MD = /!\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^)\s\n]+)[^)\n]*\)/g;
const IMG = /\.(?:png|jpe?g|gif|webp|svg|bmp|avif)$/i;

export async function runObsidianInplace(
  win: Window,
  log: (name: string, details?: Record<string, unknown>) => Promise<unknown>,
  errors: string[],
): Promise<void> {
  const doc = win.document;
  const sleep = (ms: number) => new Promise<void>((r) => win.setTimeout(r, ms));
  const waitFor = async <T>(
    label: string,
    read: () => T | null | undefined,
    ms: number,
  ) => {
    const until = win.performance.now() + ms;
    while (win.performance.now() < until) {
      const v = read();
      if (v != null) {
        return v;
      }
      await sleep(50);
    }
    throw new Error(`Timed out after ${ms} ms waiting for ${label}`);
  };
  const root = await waitFor(
    "app root",
    () => doc.querySelector<HTMLElement>(".vault-app"),
    20_000,
  );
  await waitFor(
    "onboarding",
    () => root.querySelector(".vault-onboarding"),
    20_000,
  );
  await log("interactive");
  let chosen: Promise<{ handle: string; path: string } | null> | null = null;
  const original = desktopRepository.chooseVault;
  desktopRepository.chooseVault = async (create?: boolean) => {
    const p = original.call(desktopRepository, create);
    chosen = p as never;
    return p;
  };
  const open = Array.from(root.querySelectorAll("button")).find(
    (b) =>
      b.getAttribute("aria-label") === "Open vault folder" ||
      b.title === "Open vault folder" ||
      b.textContent?.trim() === "Open vault folder",
  );
  if (!open) {
    throw new Error("no Open vault folder button");
  }
  const tOpen = win.performance.now();
  open.click();
  const info = await waitFor("vault", () => chosen, 30_000).then((p) => p);
  if (!info) {
    throw new Error("no vault");
  }
  const handle = info.handle;
  await waitFor(
    "tree rows",
    () => (doc.querySelectorAll(".vault-tree-item").length ? true : null),
    60_000,
  );
  const treeMs = Math.round(win.performance.now() - tOpen);
  await log("inplace:tree-ready", { treeMs });

  // Index: time until ready.
  const tIdx = win.performance.now();
  let status = await invoke<{ state: string; indexed: number; total: number }>(
    "search_index_status",
    { handle },
  );
  const idxDeadline = tIdx + 10 * 60_000;
  while (status.state !== "ready" && win.performance.now() < idxDeadline) {
    await sleep(100);
    status = await invoke("search_index_status", { handle });
  }
  const indexMs = Math.round(win.performance.now() - tIdx);
  await log("inplace:index-ready", { indexMs, status });
  const searches: Record<string, unknown> = {};
  for (const q of ["the", "todo", "image", "http"]) {
    const r = await invoke<{ totalMatches: number; tookMs: number }>(
      "search_vault",
      { handle, query: q, limit: 50 },
    );
    searches[q] = { total: r.totalMatches, tookMs: r.tookMs };
  }
  const tags = await invoke<{ tags: unknown[] }>("vault_tags", {
    handle,
  }).catch(() => ({ tags: [] }));

  // Walk the vault listing for notes.
  const notes: string[] = [];
  const excalidrawMd: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries: VaultEntry[] = await desktopRepository.listDirectory(
      handle,
      dir,
    );
    for (const e of entries) {
      const p = dir ? `${dir}/${e.name}` : e.name;
      if (e.kind === "folder") {
        await walk(p);
      } else if (e.kind === "note") {
        notes.push(p);
      } else if (e.kind === "excalidrawMd") {
        excalidrawMd.push(p);
      }
    }
  };
  await walk("");
  // Images each note references and what the reading view's backend finds.
  const tally = {
    refs: 0,
    found: 0,
    missing: 0,
    bytes: 0,
    extFound: {} as Record<string, number>,
    notesWithImages: 0,
    readErrors: 0,
  };
  const perExt: Record<string, { refs: number; found: number }> = {};
  const t1 = win.performance.now();
  for (const p of notes) {
    let text = "";
    try {
      text = (await readNote(handle, p)).content;
    } catch {
      tally.readErrors++;
      continue;
    }
    const targets: string[] = [];
    for (const m of text.matchAll(WIKI)) {
      targets.push(m[1].trim());
    }
    for (const m of text.matchAll(MD)) {
      let t = m[1].replace(/^<|>$/g, "");
      if (/^[a-z][a-z0-9+.-]*:/i.test(t)) {
        continue;
      }
      try {
        t = decodeURI(t);
      } catch {
        /* as written */
      }
      targets.push(t.split("#")[0]);
    }
    const imgs = targets.filter((t) => IMG.test(t));
    if (imgs.length) {
      tally.notesWithImages++;
    }
    for (const t of imgs) {
      tally.refs++;
      const ext = (t.split(".").pop() ?? "").toLowerCase();
      perExt[ext] ??= { refs: 0, found: 0 };
      perExt[ext].refs++;
      try {
        const bytes = await invoke<ArrayBuffer | number[]>("read_note_asset", {
          handle,
          from: p,
          target: t,
        });
        tally.found++;
        perExt[ext].found++;
        tally.bytes +=
          bytes instanceof ArrayBuffer ? bytes.byteLength : bytes.length;
      } catch {
        tally.missing++;
      }
    }
  }
  const assetMs = Math.round(win.performance.now() - t1);
  await log("inplace:assets-checked", { assetMs });

  // The real reading view on a sample of visible notes.
  const rows = Array.from(
    doc.querySelectorAll<HTMLElement>(
      '.vault-tree-item[data-tree-kind="note"]',
    ),
  ).slice(0, 6);
  const views: {
    name: string;
    ms: number | null;
    imgs: number;
    placeholders: number;
  }[] = [];
  for (const row of rows) {
    const t2 = win.performance.now();
    row.click();
    let ms: number | null = null;
    try {
      await waitFor(
        "note view",
        () => doc.querySelector(".note-view:not(.note-loading)"),
        15_000,
      );
      await sleep(1500);
      ms = Math.round(win.performance.now() - t2);
    } catch {
      /* counted as null */
    }
    views.push({
      name: (row.dataset.treePath ?? "").replace(/[^/]*\//g, ""),
      ms,
      imgs: doc.querySelectorAll(".note-view img").length,
      placeholders: doc.querySelectorAll(".note-view .note-embed-image").length,
    });
  }
  // A read-only .excalidraw.md open: the loader answers for every file.
  const emd: { ok: number; failed: number } = { ok: 0, failed: 0 };
  for (const p of excalidrawMd) {
    try {
      await desktopRepository.readDrawing(handle, p);
      emd.ok++;
    } catch {
      emd.failed++;
    }
  }
  await log("inplace:done");
  await sleep(1500);
  await invoke("smoke_finish", {
    status: errors.length ? 1 : 0,
    details: {
      inplace: {
        treeMs,
        indexMs,
        status,
        searches,
        tagCount: tags.tags.length,
        notes: notes.length,
        excalidrawMd: excalidrawMd.length,
        emd,
        tally,
        perExt,
        assetMs,
        views,
        errors,
      },
    },
  });
}

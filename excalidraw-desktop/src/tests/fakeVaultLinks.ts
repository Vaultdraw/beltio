/**
 * Test/harness-only reference implementation of the `VaultLinks` contract
 * over a vault repository (FakeVaultRepository). Same semantics as the native
 * index (shared grammar and resolver) with a plain scan; never a production
 * fallback. `moveWithLinks` really moves through the repository and rewrites
 * the closed drawings' JSON in the background (see `settled()`).
 */
import { findLinks, parseLinkField } from "../links/grammar";
import { fileKind } from "../vault/fileKind";
import { linkTargetFor, wikiLink } from "../links/format";
import { encodeVaultUrl } from "../links/linkUri";
import { createResolver, foldKey, relativePath } from "../links/resolve";

import type {
  BackLink,
  ElementEdit,
  LinkKind,
  LinksResponse,
  LinksSettings,
  MentionsResponse,
  MovePlan,
  MoveResult,
  OutLink,
  RemeasureSet,
  Resolution,
  RePointed,
  RewriteDone,
  RewriteFailure,
  VaultLinks,
} from "../links/types";
import type { LinkResolver } from "../links/resolve";
import type { VaultRepository } from "../vault/types";

const MAX_SNIPPET = 120;
const EMPTY_SCENE = JSON.stringify({ type: "excalidraw", elements: [] });

export type FakeVaultLinksOptions = Partial<
  Pick<LinksSettings, "newLinkFormat" | "shapeLinkFormat">
>;

type Item = {
  elementId: string;
  containerId: string | null;
  kind: LinkKind;
  target: string;
  label: string | null;
  relative: boolean;
  /** The element field value it came from (text or link). */
  source: string;
  /** Text: [start, end) of the token in `source`. Shape: null. */
  span: [number, number] | null;
  snippet: string;
  highlights: [number, number][];
};

type El = Record<string, any>;

function snippetOf(
  source: string,
  start: number,
  end: number,
): { snippet: string; highlights: [number, number][] } {
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const nl = source.indexOf("\n", end);
  const lineEnd = nl < 0 ? source.length : nl;
  let line = source.slice(lineStart, lineEnd);
  let hs = start - lineStart;
  let he = end - lineStart;
  if (line.length > MAX_SNIPPET) {
    const from = Math.max(0, Math.min(hs - 30, line.length - MAX_SNIPPET));
    line = line.slice(from, from + MAX_SNIPPET);
    hs -= from;
    he = Math.min(he - from, line.length);
  }
  return { snippet: line, highlights: [[hs, he]] };
}

function scanItems(json: string): Item[] {
  let parsed: { elements?: unknown };
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const elements = (
    Array.isArray(parsed.elements) ? parsed.elements : []
  ) as El[];
  const labels = new Map<string, string>();
  for (const el of elements) {
    if (el.type === "text" && el.containerId && !el.isDeleted) {
      labels.set(el.containerId, String(el.text ?? ""));
    }
  }
  const out: Item[] = [];
  for (const el of elements) {
    if (el.isDeleted) {
      continue;
    }
    if (el.type === "text") {
      const source: string = el.originalText ?? el.text ?? "";
      for (const span of findLinks(source)) {
        out.push({
          elementId: String(el.id),
          containerId:
            typeof el.containerId === "string" ? el.containerId : null,
          kind: "text",
          target: span.target,
          label: span.label,
          relative:
            span.target.startsWith("./") || span.target.startsWith("../"),
          source,
          span: [span.start, span.end],
          ...snippetOf(source, span.start, span.end),
        });
      }
    }
    if (typeof el.link === "string") {
      const field = parseLinkField(el.link);
      if (field) {
        const own = el.type === "text" ? String(el.text ?? "") : "";
        out.push({
          elementId: String(el.id),
          containerId: null,
          kind: "shape",
          target: field.target,
          label: null,
          relative: !!field.relative,
          source: el.link,
          span: null,
          snippet: (labels.get(el.id) ?? own)
            .split("\n")[0]
            .slice(0, MAX_SNIPPET),
          highlights: [],
        });
      }
    }
  }
  return out;
}

type Edit = ElementEdit & { oldValue: string };
type Plan = {
  moved: Map<string, string>;
  /** Source drawing (old path) -> its edits. */
  edits: Map<string, Edit[]>;
  rePointed: RePointed[];
  /** Revision of each source drawing when planned (conflict detection). */
  revisions: Map<string, string>;
};

export class FakeVaultLinks implements VaultLinks {
  private listeners = new Set<(d: RewriteDone) => void>();
  private remeasureSet = new Map<string, string[]>();
  private pending = new Set<Promise<void>>();
  private jobs = 0;
  /** Number of times each query ran (tests assert laziness). */
  readonly calls = { links: 0, unlinkedMentions: 0, resolve: 0 };

  constructor(
    private readonly repository: VaultRepository,
    private readonly options: FakeVaultLinksOptions = {},
  ) {}

  /** Resolves when every background rewrite has finished and been reported. */
  async settled(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  private async drawings(handle: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await this.repository.listDirectory(handle, dir)) {
        if (e.kind === "folder") {
          await walk(e.path);
        } else {
          out.push(e.path);
        }
      }
    };
    await walk("");
    return out.sort();
  }

  private async read(handle: string, path: string) {
    if (fileKind(path) !== "drawing") {
      // A note: its link names count (they are in `drawings()`), but the fake keeps no
      // note text, so it holds no links. Never read it as a drawing (toimprove 89).
      return { json: EMPTY_SCENE, revision: "" };
    }
    return this.repository.readDrawing(handle, path);
  }

  async links(handle: string, path: string): Promise<LinksResponse> {
    this.calls.links++;
    const started = Date.now();
    const paths = await this.drawings(handle);
    const resolver = createResolver(paths);
    const outgoing: OutLink[] = [];
    const unresolved: OutLink[] = [];
    if (paths.includes(path)) {
      for (const it of scanItems((await this.read(handle, path)).json)) {
        const resolved = resolver.resolveTarget(
          path,
          it.target,
          it.relative,
        ).path;
        const link: OutLink = {
          elementId: it.elementId,
          containerId: it.containerId,
          kind: it.kind,
          target: it.target,
          label: it.label,
          resolved,
        };
        (resolved ? outgoing : unresolved).push(link);
      }
    }
    const backlinks: BackLink[] = [];
    for (const source of paths) {
      if (source === path) {
        continue;
      }
      for (const it of scanItems((await this.read(handle, source)).json)) {
        if (
          resolver.resolveTarget(source, it.target, it.relative).path === path
        ) {
          backlinks.push({
            path: source,
            elementId: it.elementId,
            containerId: it.containerId,
            kind: it.kind,
            snippet: it.snippet,
            highlights: it.highlights,
          });
        }
      }
    }
    return {
      path,
      outgoing,
      unresolved,
      backlinks,
      tookMs: Date.now() - started,
    };
  }

  async unlinkedMentions(
    handle: string,
    path: string,
    limit = 50,
  ): Promise<MentionsResponse> {
    this.calls.unlinkedMentions++;
    const started = Date.now();
    const name = foldKey(
      path.slice(path.lastIndexOf("/") + 1).replace(/\.excalidraw$/i, ""),
    );
    const paths = await this.drawings(handle);
    const resolver = createResolver(paths);
    const mentions: BackLink[] = [];
    if (name.length >= 2) {
      for (const source of paths) {
        if (source === path) {
          continue;
        }
        const json = (await this.read(handle, source)).json;
        const linked = new Set(
          scanItems(json)
            .filter(
              (i) =>
                resolver.resolveTarget(source, i.target, i.relative).path ===
                path,
            )
            .map((i) => i.elementId),
        );
        let parsed: { elements?: El[] } = {};
        try {
          parsed = JSON.parse(json);
        } catch {
          // unreadable drawing: no mentions
        }
        for (const el of parsed.elements ?? []) {
          if (el.type !== "text" || el.isDeleted || linked.has(el.id)) {
            continue;
          }
          const text: string = el.originalText ?? el.text ?? "";
          const at = foldKey(text).indexOf(name);
          if (at >= 0 && foldKey(text).length === text.length) {
            mentions.push({
              path: source,
              elementId: String(el.id),
              containerId: el.containerId ?? null,
              kind: "text",
              ...snippetOf(text, at, at + name.length),
            });
          }
        }
      }
    }
    return {
      path,
      mentions: mentions.slice(0, limit),
      tookMs: Date.now() - started,
    };
  }

  async resolve(
    handle: string,
    fromPath: string,
    raw: string,
  ): Promise<Resolution> {
    this.calls.resolve++;
    return createResolver(await this.drawings(handle)).resolve(fromPath, raw);
  }

  // -- moves --------------------------------------------------------------

  private async plan(handle: string, from: string, to: string): Promise<Plan> {
    const oldPaths = await this.drawings(handle);
    const moved = new Map<string, string>();
    for (const p of oldPaths) {
      if (p === from) {
        moved.set(p, to);
      } else if (p.startsWith(`${from}/`)) {
        moved.set(p, `${to}${p.slice(from.length)}`);
      }
    }
    const newPaths = oldPaths.map((p) => moved.get(p) ?? p);
    const before = createResolver(oldPaths);
    const after = createResolver(newPaths);
    const edits = new Map<string, Edit[]>();
    const rePointed: RePointed[] = [];
    const revisions = new Map<string, string>();
    const format = this.options.newLinkFormat ?? "shortest";
    for (const source of oldPaths) {
      const nSource = moved.get(source) ?? source;
      const bySource = new Map<string, { item: Item; value: string }[]>();
      const file = await this.read(handle, source);
      revisions.set(source, file.revision);
      for (const it of scanItems(file.json)) {
        const was = before.resolveTarget(source, it.target, it.relative).path;
        if (!was) {
          continue;
        }
        const expected = moved.get(was) ?? was;
        const now = after.resolveTarget(nSource, it.target, it.relative).path;
        if (now === expected) {
          continue;
        }
        if (!moved.has(was) && !(it.relative && moved.has(source))) {
          rePointed.push({
            path: nSource,
            target: it.target,
            from: was,
            to: now,
          });
          continue;
        }
        const target = this.writeTarget(it, expected, nSource, after, format);
        const value =
          it.kind === "text"
            ? wikiLink(target, it.label)
            : this.shapeValue(it.source, target, nSource, expected);
        const list = bySource.get(it.elementId) ?? [];
        list.push({ item: it, value });
        bySource.set(it.elementId, list);
      }
      const list: Edit[] = [];
      for (const [elementId, changes] of bySource) {
        const first = changes[0].item;
        if (first.kind === "shape") {
          list.push({
            elementId,
            field: "link",
            value: changes[0].value,
            oldValue: first.source,
          });
        } else {
          let text = first.source;
          for (const { item, value } of [...changes].sort(
            (a, b) => b.item.span![0] - a.item.span![0],
          )) {
            text =
              text.slice(0, item.span![0]) + value + text.slice(item.span![1]);
          }
          list.push({
            elementId,
            field: "text",
            value: text,
            oldValue: first.source,
          });
        }
      }
      if (list.length > 0) {
        edits.set(source, list);
      }
    }
    return { moved, edits, rePointed, revisions };
  }

  private writeTarget(
    it: Item,
    expected: string,
    nSource: string,
    resolver: LinkResolver,
    format: LinksSettings["newLinkFormat"],
  ): string {
    if (it.relative) {
      const rel = relativePath(nSource, expected).replace(/\.excalidraw$/i, "");
      return rel.startsWith("../") ? rel : `./${rel}`;
    }
    return linkTargetFor(expected, nSource, resolver, format);
  }

  private shapeValue(
    old: string,
    target: string,
    nSource: string,
    expected: string,
  ): string {
    if (old.startsWith("vaultdraw://")) {
      return encodeVaultUrl(target);
    }
    if (old.startsWith("[[")) {
      return wikiLink(target);
    }
    const rel = relativePath(nSource, expected);
    return old.startsWith("./") && !rel.startsWith("../") ? `./${rel}` : rel;
  }

  private count(plan: Plan, exclude: string | null) {
    let files = 0;
    let links = 0;
    for (const [source, list] of plan.edits) {
      links += list.length;
      if (source !== exclude) {
        files++;
      }
    }
    return { files, links };
  }

  async planMove(handle: string, from: string, to: string): Promise<MovePlan> {
    const plan = await this.plan(handle, from, to);
    return { ...this.count(plan, null), rePointed: plan.rePointed };
  }

  async moveWithLinks(
    handle: string,
    from: string,
    to: string,
    openPath: string | null,
    rewrite: boolean,
  ): Promise<MoveResult> {
    if (!rewrite) {
      await this.repository.move(handle, from, to);
      return {
        jobId: null,
        plannedFiles: 0,
        plannedLinks: 0,
        openDrawingEdits: [],
      };
    }
    const plan = await this.plan(handle, from, to);
    await this.repository.move(handle, from, to);
    const { files, links } = this.count(plan, openPath);
    const openEdits = openPath ? plan.edits.get(openPath) ?? [] : [];
    const jobId = files > 0 ? ++this.jobs : null;
    if (jobId !== null) {
      const job = this.rewriteClosed(handle, plan, openPath, jobId).finally(
        () => this.pending.delete(job),
      );
      this.pending.add(job);
    }
    return {
      jobId,
      plannedFiles: files,
      plannedLinks: links,
      openDrawingEdits: openEdits.map(({ elementId, field, value }) => ({
        elementId,
        field,
        value,
      })),
    };
  }

  private async rewriteClosed(
    handle: string,
    plan: Plan,
    openPath: string | null,
    jobId: number,
  ): Promise<void> {
    await Promise.resolve(); // asynchronous, like the native background thread
    const started = Date.now();
    let rewritten = 0;
    let links = 0;
    const failed: RewriteFailure[] = [];
    for (const [source, edits] of plan.edits) {
      if (source === openPath) {
        continue;
      }
      const path = plan.moved.get(source) ?? source;
      try {
        const file = await this.read(handle, path);
        const doc = JSON.parse(file.json) as { elements: El[] };
        const touched: string[] = [];
        for (const edit of edits) {
          const el = doc.elements.find((e) => e.id === edit.elementId);
          if (!el) {
            continue;
          }
          if (edit.field === "link") {
            el.link = edit.value;
          } else {
            el.text = edit.value;
            el.originalText = edit.value;
            touched.push(el.id);
          }
          el.version = (el.version ?? 0) + 1;
          el.versionNonce = Math.floor(Math.random() * 2 ** 31);
          el.updated = Date.now();
          links++;
        }
        await this.repository.writeDrawing({
          handle,
          path,
          json: JSON.stringify(doc),
          expectedRevision: plan.revisions.get(source) ?? file.revision,
          operationId: `links-rewrite-${jobId}-${path}`,
        });
        rewritten++;
        if (touched.length > 0) {
          this.remeasureSet.set(path, touched);
        }
      } catch (err) {
        const code = (err as { code?: string }).code;
        failed.push({
          path,
          code: code === "CONFLICT" ? "CONFLICT" : "IO",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const done: RewriteDone = {
      handle,
      jobId,
      rewritten,
      links,
      failed,
      tookMs: Date.now() - started,
    };
    for (const l of [...this.listeners]) {
      l(done);
    }
  }

  async remeasure(): Promise<RemeasureSet> {
    return { paths: Object.fromEntries(this.remeasureSet) };
  }

  async remeasureDone(_handle: string, path: string): Promise<void> {
    this.remeasureSet.delete(path);
  }

  async onRewriteDone(
    listener: (done: RewriteDone) => void,
  ): Promise<() => void> {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

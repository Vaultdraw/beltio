import {
  normalizeError,
  resolveInvoke,
  resolveListen,
} from "../vault/DesktopVaultRepository";

import type { InvokeFn, ListenFn } from "../vault/DesktopVaultRepository";

import type {
  LinksResponse,
  MentionsResponse,
  MovePlan,
  MoveResult,
  RemeasureSet,
  Resolution,
  RewriteDone,
  VaultLinks,
} from "./types";

export interface DesktopVaultLinksOptions {
  invoke?: InvokeFn;
  listen?: ListenFn;
}

/** Bridges the renderer to the native link index (`vault_links` & co). */
export class DesktopVaultLinks implements VaultLinks {
  constructor(private readonly options: DesktopVaultLinksOptions = {}) {}

  private async call<T>(
    command: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const invoke = await resolveInvoke(this.options.invoke);
    try {
      return await invoke<T>(command, args);
    } catch (err) {
      throw normalizeError(err);
    }
  }

  links(handle: string, path: string): Promise<LinksResponse> {
    return this.call("vault_links", { handle, path });
  }

  unlinkedMentions(
    handle: string,
    path: string,
    limit?: number,
  ): Promise<MentionsResponse> {
    return this.call("vault_unlinked_mentions", {
      handle,
      path,
      limit: limit ?? null,
    });
  }

  resolve(handle: string, fromPath: string, raw: string): Promise<Resolution> {
    return this.call("resolve_link", { handle, fromPath, raw });
  }

  planMove(handle: string, from: string, to: string): Promise<MovePlan> {
    return this.call("links_plan_move", { handle, from, to });
  }

  moveWithLinks(
    handle: string,
    from: string,
    to: string,
    openPath: string | null,
    rewrite: boolean,
  ): Promise<MoveResult> {
    return this.call("move_entry_with_links", {
      handle,
      from,
      to,
      openPath,
      rewrite,
    });
  }

  remeasure(handle: string): Promise<RemeasureSet> {
    return this.call("links_remeasure", { handle });
  }

  async start(handle: string): Promise<void> {
    await this.call("services_start", { handle, service: "links" });
  }

  async remeasureDone(handle: string, path: string): Promise<void> {
    await this.call("links_remeasure_done", { handle, path });
  }

  async onRewriteDone(
    listener: (done: RewriteDone) => void,
  ): Promise<() => void> {
    const listen = await resolveListen(this.options.listen);
    try {
      return await listen<RewriteDone>("links-rewrite-done", (event) =>
        listener(event.payload),
      );
    } catch (err) {
      throw normalizeError(err);
    }
  }
}

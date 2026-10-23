import {
  normalizeError,
  resolveInvoke,
  resolveListen,
} from "../vault/DesktopVaultRepository";

import type { InvokeFn, ListenFn } from "../vault/DesktopVaultRepository";

import type {
  IndexStatus,
  NamesListing,
  SearchOptions,
  SearchResponse,
  VaultSearch,
} from "./types";
import type { TagsResponse } from "../tags/types";

export interface DesktopVaultSearchOptions {
  invoke?: InvokeFn;
  listen?: ListenFn;
}

/** Bridges the renderer to the native search index (`search_vault` & co). */
export class DesktopVaultSearch implements VaultSearch {
  constructor(private readonly options: DesktopVaultSearchOptions = {}) {}

  async search(
    handle: string,
    query: string,
    opts?: SearchOptions,
  ): Promise<SearchResponse> {
    const invoke = await resolveInvoke(this.options.invoke);
    try {
      return await invoke<SearchResponse>("search_vault", {
        handle,
        query,
        limit: opts?.limit ?? null,
        scope: opts?.scope ?? null,
      });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async listNames(handle: string): Promise<NamesListing> {
    const invoke = await resolveInvoke(this.options.invoke);
    try {
      return await invoke<NamesListing>("search_list_names", { handle });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async status(handle: string): Promise<IndexStatus> {
    const invoke = await resolveInvoke(this.options.invoke);
    try {
      return await invoke<IndexStatus>("search_index_status", { handle });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async tags(handle: string): Promise<TagsResponse> {
    const invoke = await resolveInvoke(this.options.invoke);
    try {
      return await invoke<TagsResponse>("vault_tags", { handle });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async start(handle: string): Promise<void> {
    const invoke = await resolveInvoke(this.options.invoke);
    try {
      await invoke("services_start", { handle, service: "search" });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async subscribe(listener: (status: IndexStatus) => void) {
    const listen = await resolveListen(this.options.listen);
    try {
      return await listen<IndexStatus>("search-index-status", (event) =>
        listener(event.payload),
      );
    } catch (err) {
      throw normalizeError(err);
    }
  }
}

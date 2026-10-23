/**
 * In-memory CSS snippet folder for unit tests and the browser e2e harness
 * (`?snippets=1`): behaves like the native `list_snippets`.
 */
import type { SnippetListing, SnippetSource } from "../snippets/store";

/** Snippets shipped by the e2e harness. */
export const E2E_SNIPPETS: Record<string, string> = {
  "red-outline": "body { outline: 3px solid rgb(255, 0, 0) !important; }",
  "wide-sidebar": ".vault-navigator { min-width: 320px; }",
};

export class FakeSnippetSource implements SnippetSource {
  files: Record<string, string>;
  lists = 0;
  opened = 0;

  constructor(files: Record<string, string> = {}) {
    this.files = { ...files };
  }

  async list(enabled: readonly string[]): Promise<SnippetListing[]> {
    this.lists++;
    const on = new Set(enabled.map((n) => n.toLowerCase()));
    return Object.keys(this.files)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .map((id) => ({
        id,
        path: `/config/snippets/${id}.css`,
        css: on.has(id.toLowerCase()) ? this.files[id] : null,
        error: null,
      }));
  }

  async openDir(): Promise<void> {
    this.opened++;
  }
}

# The plugins registry

A registry is one `index.json` that lists plugin packages. Vaultdraw fetches it only when you open Browse, only after you allow it (`network.allow_plugins`), and caches it for `plugins.registry_ttl_hours`.

## index.json

```json
{
  "schema": 1,
  "plugins": [
    {
      "id": "word-count",
      "name": "Word count",
      "author": "ada",
      "description": "Counts the words in a note.",
      "version": "1.2.0",
      "api": 1,
      "min_app": "0.1.0",
      "permissions": ["vault.read"],
      "sha256": "<64 hex characters, the zip's SHA-256>",
      "url": "packages/word-count-1.2.0.zip",
      "size": 4821,
      "homepage": "https://example.com/word-count",
      "licence": "MIT"
    }
  ]
}
```

| Key | Required | Rule |
| --- | --- | --- |
| `schema` | yes | `1`. Any other value is refused ("update Vaultdraw") |
| `id` | yes | The manifest id: `^[a-z0-9][a-z0-9-]{1,38}$`. The first entry of an id wins |
| `name`, `version`, `api` | yes | Same as the manifest; `version` is a semantic version |
| `permissions` | yes | The manifest's `permissions`. Browse shows them before install; the package must declare exactly these |
| `sha256` | yes | SHA-256 of the zip (`<id>-<version>.zip.sha256` from `vaultdraw-plugin package`) |
| `url` | yes | An https address, or a path relative to the index (no `..`) |
| `author`, `description`, `min_app`, `size`, `homepage`, `licence` | no | Shown in the details |

Entries that break a rule are skipped; a file that is not JSON or has no `plugins` array is refused.

## What an install checks

1. The download (at most 9 MB) hashes to `sha256`. A changed file is refused with "changed after the list was made".
2. The zip is read strictly, with the rules in [packaging](packaging.md#check-a-zip): flat layout, no unsafe names, links, encryption or zip64, at most 1000 entries and 8 MB unpacked, matching sizes and checksums.
3. The manifest inside is valid, and its `id`, `version` and `permissions` equal the entry's.
4. The folder is installed like "Install from folder". The usual permission review follows: a plugin that needs a write permission stays off until you confirm it.

An update is the same install over the old folder when the list has a newer `version`. Nothing from a package runs before you enable it.

## Making a registry

Package each plugin with `vaultdraw-plugin package`, put the zip beside `index.json` (or anywhere on https), and fill `sha256` from the `.sha256` file. Point `plugins.registry_url` at the index.

/**
 * `ctx.pdf` (API 0.23.0): the gateway rows `pdf.*` with the permission `pdf` checked here first,
 * as Rust checks it. The native side keeps each open document; a document here is a thin handle
 * on its token. Bodies are raw bytes (`plugin_call_raw`): see `pdf_import::gateway_call`.
 */
import { requirePermission } from "../../../../sdk/api/shared/vaultPaths";
import { PluginApiError } from "../../../../sdk/api/shared/rules";
import { getPdfImportSettings, getPreferences } from "../../vault/preferences";

import { createRawGateway } from "./gateway";

import type { PdfApi, PdfDocument, PdfPageSize } from "../api";
import type { PluginRuntime } from "./types";

type Info = {
  token: number;
  name: string;
  pageCount: number;
  pages: PdfPageSize[];
  byteSize: number;
  locked: boolean;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const json = (value: unknown): Uint8Array =>
  encoder.encode(JSON.stringify(value));

const parse = <T>(bytes: Uint8Array): T => JSON.parse(decoder.decode(bytes));

export function createPdfApi(rt: PluginRuntime): PdfApi {
  const id = rt.info.id;
  const raw = createRawGateway(id);
  // Read at call time: an update can change the declared permissions.
  const need = (method: string) =>
    requirePermission(id, rt.info.permissions, method, "pdf");

  const document = (info: Info): PdfDocument => ({
    name: info.name,
    pageCount: info.pageCount,
    pages: Object.freeze([...info.pages]),
    byteSize: info.byteSize,
    locked: info.locked === true,
    async render(index, options) {
      need("pdf.render");
      return raw(
        "pdf.render",
        json({
          token: info.token,
          index,
          maxSide: options.maxSide,
          format: options.format,
          quality: options.quality,
        }),
      );
    },
    async unlock(password) {
      need("pdf.unlock");
      if (typeof password !== "string") {
        throw new PluginApiError("INVALID_ARGUMENT", "password must be text");
      }
      return document(
        parse<Info>(
          await raw("pdf.unlock", json({ token: info.token, password })),
        ),
      );
    },
    async close() {
      need("pdf.close");
      await raw("pdf.close", json({ token: info.token }));
    },
  });

  return {
    async pick() {
      need("pdf.pick");
      const info = parse<Info | null>(await raw("pdf.pick"));
      return info ? document(info) : null;
    },
    async open(name, bytes) {
      need("pdf.open");
      if (typeof name !== "string" || name === "" || name.length > 255) {
        throw new PluginApiError(
          "INVALID_ARGUMENT",
          "name must be a file name of 1 to 255 characters",
        );
      }
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
        throw new PluginApiError(
          "INVALID_ARGUMENT",
          "bytes must be a non-empty Uint8Array",
        );
      }
      const nameBytes = encoder.encode(name);
      const body = new Uint8Array(4 + nameBytes.length + bytes.byteLength);
      new DataView(body.buffer).setUint32(0, nameBytes.length);
      body.set(nameBytes, 4);
      body.set(bytes, 4 + nameBytes.length);
      return document(parse<Info>(await raw("pdf.open", body)));
    },
    settings: () => getPdfImportSettings(getPreferences()),
  };
}

/**
 * The browser build's stand-in for the native `net.*` and `secret.*` rows (permissions `net` and
 * `secret`): the tests and the e2e harness script the provider (`respond`), so nothing goes on the
 * wire. It mirrors the native rules that matter to a plugin: Offline mode blocks every host except
 * this computer, a missing stored key is `SECRET_MISSING`, ids belong to one plugin.
 */
export interface FakeNetReply {
  status?: number;
  /** The body, one entry per chunk. */
  chunks?: string[];
  /** Fail the stream after the chunks with this error. */
  error?: { code: string; message: string };
  /** Wait before each chunk, to let a test cancel mid-stream. */
  chunkDelayMs?: number;
}

export interface FakeNetRequest {
  pluginId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  /** The header the stored secret would have been put into by the app: name and the value that WOULD be sent. */
  authHeader?: { name: string; value: string };
}

export interface FakeNet {
  /** The provider: what to answer. Unset: a connection error. Throw `{code, message}` to fail the open. */
  respond?: (request: FakeNetRequest) => FakeNetReply | Promise<FakeNetReply>;
  /** Every request opened, in order. */
  requests: FakeNetRequest[];
  /** Stored secrets by plugin id and name (the native side keeps them in a 0600 file). */
  secrets: Record<string, Record<string, string>>;
  /** Offline mode now. */
  offline?: () => boolean;
  /** Streams closed by the plugin (cancel). */
  closed: number[];
}

const coded = (code: string, message: string) =>
  Object.assign(new Error(message), { code, message });

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)$/i;

interface Stream {
  pluginId: string;
  reply: FakeNetReply;
  next: number;
  closed: boolean;
}

export const createFakeNet = (): FakeNet => ({
  requests: [],
  secrets: {},
  closed: [],
});

const enc = new TextEncoder();
const dec = new TextDecoder();
const tagged = (tag: number, rest?: Uint8Array) => {
  const out = new Uint8Array(1 + (rest?.length ?? 0));
  out[0] = tag;
  if (rest) {
    out.set(rest, 1);
  }
  return out;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const NET_ROWS = new Set(["net.open", "net.read", "net.close"]);
export const SECRET_ROWS = new Set([
  "secret.set",
  "secret.has",
  "secret.delete",
]);

const streams = new Map<number, Stream>();
let nextId = 1;

export async function fakeNetRow(
  fake: FakeNet,
  pluginId: string,
  method: string,
  body: Uint8Array,
): Promise<Uint8Array> {
  const arg = JSON.parse(dec.decode(body)) as Record<string, unknown>;
  if (method === "net.open") {
    const url = new URL(String(arg.url));
    const local = LOOPBACK.test(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
      throw coded(
        "INVALID_URL",
        "Only https addresses are allowed, or http to this computer",
      );
    }
    if (!local && fake.offline?.()) {
      throw coded(
        "NETWORK_DISABLED",
        "Offline mode is on. Turn it off in Settings to use the internet.",
      );
    }
    const headers = { ...((arg.headers as Record<string, string>) ?? {}) };
    const auth = arg.auth as
      | { secret: string; header: string; prefix?: string }
      | undefined;
    let authHeader: FakeNetRequest["authHeader"];
    if (auth) {
      const stored = fake.secrets[pluginId]?.[auth.secret];
      if (stored === undefined) {
        throw coded("SECRET_MISSING", "No API key is saved");
      }
      authHeader = { name: auth.header, value: (auth.prefix ?? "") + stored };
    }
    const request: FakeNetRequest = {
      pluginId,
      url: url.toString(),
      method: String(arg.method ?? (arg.body !== undefined ? "POST" : "GET")),
      headers,
      body: arg.body as string | undefined,
      authHeader,
    };
    fake.requests.push(request);
    if (!fake.respond) {
      throw coded("NETWORK_ERROR", "Request failed");
    }
    let reply: FakeNetReply;
    try {
      reply = await fake.respond(request);
    } catch (e) {
      const c = e as { code?: string; message?: string };
      throw coded(c.code ?? "NETWORK_ERROR", c.message ?? "Request failed");
    }
    const id = nextId++;
    streams.set(id, { pluginId, reply, next: 0, closed: false });
    return enc.encode(JSON.stringify({ id, status: reply.status ?? 200 }));
  }
  if (method === "net.read" || method === "net.close") {
    const id = Number(arg.id);
    const stream = streams.get(id);
    if (method === "net.close") {
      if (stream && stream.pluginId === pluginId) {
        stream.closed = true;
        streams.delete(id);
        fake.closed.push(id);
      }
      return new Uint8Array(0);
    }
    if (!stream || stream.pluginId !== pluginId) {
      throw coded("NOT_FOUND", "No such request");
    }
    if (stream.reply.chunkDelayMs) {
      await sleep(stream.reply.chunkDelayMs);
    }
    const chunks = stream.reply.chunks ?? [];
    if (stream.next < chunks.length) {
      return tagged(0, enc.encode(chunks[stream.next++]));
    }
    streams.delete(id);
    if (stream.reply.error) {
      return tagged(3, enc.encode(JSON.stringify(stream.reply.error)));
    }
    return tagged(1);
  }
  const store = (fake.secrets[pluginId] ??= {});
  const name = String(arg.name);
  if (method === "secret.set") {
    store[name] = String(arg.value);
    return new Uint8Array(0);
  }
  if (method === "secret.has") {
    return new Uint8Array([name in store ? 1 : 0]);
  }
  delete store[name];
  return new Uint8Array(0);
}

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

const v4Blocked = ([a, b, c]: number[]): boolean =>
  a === 0 ||
  a === 10 ||
  a === 127 ||
  (a === 100 && b >= 64 && b <= 127) ||
  (a === 169 && b === 254) ||
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 168) ||
  (a === 192 && b === 0 && c === 0) ||
  (a === 198 && (b === 18 || b === 19)) ||
  a >= 224;

const parseV4 = (h: string): number[] | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  return m ? m.slice(1).map(Number) : null;
};

/** The 8 groups of an IPv6 literal (as a URL's hostname writes it, without brackets), or null. */
const parseV6 = (h: string): number[] | null => {
  const halves = h.split("::");
  if (halves.length > 2) {
    return null;
  }
  const part = (t: string) => (t === "" ? [] : t.split(":"));
  const [head, tail] = [part(halves[0]), part(halves[1] ?? "")];
  const fill = 8 - head.length - tail.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) {
    return null;
  }
  const groups = [...head, ...Array(fill).fill("0"), ...tail];
  return groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))
    ? groups.map((g) => parseInt(g, 16))
    : null;
};

const embeddedV4 = (hi: number, lo: number) => [
  hi >> 8,
  hi & 255,
  lo >> 8,
  lo & 255,
];

/**
 * An IP literal the app never contacts (private, local, link-local, reserved, multicast, and
 * IPv6 forms that carry such an IPv4 address), as `network.rs is_blocked_address`; pinned by the
 * shared table `contract/private_host_cases.json` (toimprove 274). Host names are not resolved.
 */
export const isBlockedIpLiteral = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  const v4 = parseV4(host);
  if (v4) {
    return v4Blocked(v4);
  }
  if (!host.startsWith("[")) {
    return false;
  }
  const g = parseV6(host.slice(1, -1));
  if (!g) {
    return false;
  }
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeros(6) && g[6] === 0 && g[7] <= 1) {
    return true; // :: and ::1
  }
  if (zeros(5) && g[5] === 0xffff) {
    return v4Blocked(embeddedV4(g[6], g[7])); // ::ffff:a.b.c.d
  }
  if (zeros(6)) {
    return v4Blocked(embeddedV4(g[6], g[7])); // ::a.b.c.d (IPv4-compatible)
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    // NAT64: the well-known prefix carries an IPv4 address; the local-use one is private
    return g[2] === 1 || v4Blocked(embeddedV4(g[6], g[7]));
  }
  if (g[0] === 0x2002) {
    return v4Blocked(embeddedV4(g[1], g[2])); // 6to4
  }
  return (
    (g[0] & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (g[0] & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (g[0] & 0xffc0) === 0xfec0 || // site-local fec0::/10
    (g[0] & 0xff00) === 0xff00 // multicast
  );
};

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
    // The same checks, in the same order, as the app's net.rs check_url (toimprove 274).
    let url: URL;
    try {
      url = new URL(String(arg.url));
    } catch {
      throw coded("INVALID_URL", "That is not a valid address");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw coded(
        "INVALID_URL",
        "Only https addresses are allowed, or http to this computer",
      );
    }
    if (url.username || url.password) {
      throw coded(
        "INVALID_URL",
        "Addresses with a user name or password are not allowed",
      );
    }
    const local = LOOPBACK.test(url.hostname);
    if (!local && url.protocol !== "https:") {
      throw coded(
        "INVALID_URL",
        "Only https addresses are allowed, or http to this computer",
      );
    }
    if (!local && isBlockedIpLiteral(url.hostname)) {
      throw coded(
        "PRIVATE_ADDRESS",
        "That address is private or local, so it was not contacted",
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

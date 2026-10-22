// The AgentDrives public API, as the CLI reads it: the directory index (/api/tools.json), one product's record
// (/api/tools/<slug>.json), the MCP server's directory edition (/api/mcp, no key) and the free check (POST /api/orders
// with the user's key). Plain fetch: Node 18+ and Bun. The open data files are fetched with via=cli, so lookups from
// the CLI can be counted; never on an endpoint (/api/mcp, /api/orders).
import { VERSION } from "./version.mjs";

export const DEFAULT_BASE = "https://agentdrives.com";
const UA = `agentdrives-cli/${VERSION}`;
const TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  constructor(message, { status = 0, code = "", fix = "" } = {}) { super(message); this.status = status; this.code = code; this.fix = fix; }
}

export function client({ base = DEFAULT_BASE, key = "" } = {}) {
  base = base.replace(/\/+$/, "");
  async function call(method, path, body, { auth = false } = {}) {
    const headers = { accept: "application/json", "user-agent": UA };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (auth && key) headers["x-api-key"] = key;
    let r;
    try {
      r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new ApiError(`Couldn't reach ${base}${path}: ${e?.cause?.code ?? e?.name ?? e?.message ?? e}`);
    }
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON: an HTML error page, say */ }
    return { status: r.status, ok: r.ok, data };
  }
  const fail = (path, r) => new ApiError(r.data?.fix ? `${r.data.error ?? `HTTP ${r.status}`}: ${r.data.fix}` : `${base}${path} answered HTTP ${r.status}`,
    { status: r.status, code: r.data?.error ?? "", fix: r.data?.fix ?? "" });

  let indexP = null;
  return {
    base,
    hasKey: !!key,
    /** The directory: every driven product, the level names, the methodology. Fetched once per run. */
    index() {
      indexP ??= call("GET", "/api/tools.json?via=cli").then((r) => {
        if (!r.ok || !Array.isArray(r.data?.tools)) throw fail("/api/tools.json", r);
        return r.data;
      });
      return indexP;
    },
    /** One product's full public record, or null when the slug isn't in the directory. */
    async product(slug) {
      const path = `/api/tools/${encodeURIComponent(slug)}.json`;
      const r = await call("GET", `${path}?via=cli`);
      if (r.status === 404) return null;
      if (!r.ok || !r.data) throw fail(path, r);
      return r.data;
    },
    /** The MCP directory edition's tools (tools/list), or null when it can't be reached. */
    async mcpTools() {
      const r = await call("POST", "/api/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }).catch(() => null);
      return Array.isArray(r?.data?.result?.tools) ? r.data.result.tools : null;
    },
    /** One MCP tool call on the directory edition: its result as data, or an ApiError with the tool's message. */
    async mcpCall(name, args) {
      const r = await call("POST", "/api/mcp", { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
      const res = r.data?.result;
      if (!r.ok || !res) throw new ApiError(r.data?.error?.message ?? `/api/mcp answered HTTP ${r.status}`, { status: r.status });
      const text = res.content?.find((c) => c.type === "text")?.text ?? "";
      if (res.isError) throw new ApiError(text || `${name} failed`);
      if (res.structuredContent && "result" in res.structuredContent) return res.structuredContent.result;
      try { return JSON.parse(text); } catch { return text; }
    },
    /** Start a free check of a URL with the user's key: the API's answer as it is (an order, or the domain's latest check). */
    async freeCheck(url) {
      const r = await call("POST", "/api/orders", { product: "free", url }, { auth: true });
      if (!r.ok) throw fail("/api/orders", r);
      return r.data;
    },
    /** A finished order's report (a free check's with `next`), or null while it isn't ready. */
    async report(orderId) {
      const path = `/api/orders/${encodeURIComponent(orderId)}/report`;
      const r = await call("GET", path, undefined, { auth: true });
      if (r.status === 409) return null;
      if (!r.ok) throw fail(path, r);
      return r.data;
    },
  };
}

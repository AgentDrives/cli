#!/usr/bin/env node
// agentdrives: look up how far an AI agent gets with a software product, from AgentDrives' test drives.
//   agentdrives level <domain|slug>                         one product: its level, where it stops, what an agent can do
//   agentdrives find "<task>" [--category C] [--self-serve]  products for a task, best first
//   agentdrives check <domain> [--open]                      start a free check (with AGENTDRIVES_API_KEY), else its link
//   agentdrives categories                                   the categories and the best level in each
// --json on every command. Exit codes: 0 ok, 1 an error, 2 a usage error, 3 not in the directory (level).
import { spawn } from "node:child_process";
import { client, ApiError, DEFAULT_BASE } from "../lib/api.mjs";
import { domainOf, resolve, lookAlikes, categoryOf, categories, selfServe, rankForTask } from "../lib/match.mjs";
import { summary, levelText, rowsText, link, day } from "../lib/format.mjs";
import { VERSION } from "../lib/version.mjs";

const HELP = `agentdrives ${VERSION}: how far an AI agent gets with a software product, from AgentDrives' test drives.

Usage
  agentdrives level <domain|slug>          A product's level (0-5), where the agent stops and what it can do
  agentdrives find "<task>"                Products for a task, best level first
      --category <id|name>                 Only this category (see: agentdrives categories)
      --self-serve                         Only products an agent gets into on its own
      --limit <n>                          At most n products (default 10)
  agentdrives check <domain>               Start a free check of a product (needs an API key), or get its link
      --open                               Open the link in your browser
  agentdrives categories                   Every category, with its best level

Options
  --json                                   Print JSON (for scripts and agents)
  --key <key>                              Your API key (better: set AGENTDRIVES_API_KEY)
  --base <url>                             Another AgentDrives address (default ${DEFAULT_BASE}; or AGENTDRIVES_URL)
  -h, --help                               This help
  -v, --version                            The version

Examples
  agentdrives level stripe.com
  agentdrives find "send transactional email" --self-serve
  agentdrives check acme.com --json

Get an API key at ${DEFAULT_BASE}/app/keys`;

const FLAGS = { json: "bool", "self-serve": "bool", open: "bool", help: "bool", version: "bool", category: "value", limit: "value", key: "value", base: "value" };
const SHORT = { h: "help", v: "version" };

class Usage extends Error {}

function parse(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { pos.push(...argv.slice(i + 1)); break; }
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a) ?? (/^-([a-z])$/.test(a) ? [a, SHORT[a[1]] ?? a[1]] : null);
    if (!m) { pos.push(a); continue; }
    const name = m[1], kind = FLAGS[name];
    if (!kind) throw new Usage(`unknown option ${a}`);
    if (kind === "bool") { if (m[2] !== undefined) throw new Usage(`--${name} takes no value`); opt[name] = true; continue; }
    const v = m[2] ?? argv[++i];
    if (v === undefined || v === "") throw new Usage(`--${name} needs a value`);
    opt[name] = v;
  }
  return { pos, opt };
}

/** The free check's start in a browser: sign in (or up), then the product is added and checked (the site's own form). */
const startLink = (base, dom) => link(base, "/signin", { mode: "signup", add: dom, next: `/app/products?add=${encodeURIComponent(dom)}` });
const out = (s) => process.stdout.write(s.endsWith("\n") ? s : s + "\n");
const emit = (opt, data, text) => out(opt.json ? JSON.stringify(data, null, 2) : text);

async function cmdLevel(api, opt, args) {
  if (args.length !== 1) throw new Usage("level takes one domain or slug, e.g. agentdrives level stripe.com");
  const idx = await api.index();
  const t = resolve(idx.tools, args[0]);
  if (!t) {
    const dom = domainOf(args[0]);
    const next = dom ? `agentdrives check ${dom}` : null;
    const alike = lookAlikes(idx.tools, args[0]).slice(0, 3);
    emit(opt, { found: false, query: args[0], ...(dom ? { domain: dom, check: startLink(api.base, dom) } : {}),
      did_you_mean: alike.map((t) => ({ slug: t.slug, name: t.name, domain: t.domain ?? null })) },
      `${args[0]} isn't in the AgentDrives directory yet.` +
      (alike.length ? `\nDid you mean ${alike.map((t) => `${t.name} (${t.domain}): agentdrives level ${t.slug}`).join(", or ")}?` : "") +
      (next ? `\nSee what an agent would meet there: ${next}` : ""));
    return 3;
  }
  const full = await api.product(t.slug);
  const s = summary(api.base, t, full ?? {}, idx.levels ?? []);
  emit(opt, { found: true, product: s }, levelText(s, idx.levels ?? []));
  return 0;
}

/** The MCP server's own task search, when it has one: its results as directory entries, or null to search here. */
async function findOnServer(api, task, opt, tools) {
  const list = await api.mcpTools();
  const tool = list?.find((t) => t.name === "find_tools_for_task");
  if (!tool) return null;
  const props = tool.inputSchema?.properties ?? {};
  const taskKey = ["task", "query", "description"].find((k) => k in props);
  if (!taskKey) return null;
  const args = { [taskKey]: task };
  if (opt.category && "category" in props) args.category = opt.category;
  if ("limit" in props) args.limit = Math.min(100, Number(opt.limit ?? 10) * (opt["self-serve"] ? 3 : 1));
  let res;
  try { res = await api.mcpCall("find_tools_for_task", args); } catch { return null; }
  const items = Array.isArray(res) ? res : Array.isArray(res?.results) ? res.results : Array.isArray(res?.tools) ? res.tools : null;
  if (!items) return null;
  const bySlug = new Map(tools.map((t) => [t.slug, t]));
  return items.map((x) => bySlug.get(typeof x === "string" ? x : x?.slug)).filter(Boolean);
}

async function cmdFind(api, opt, args) {
  const task = args.join(" ").trim();
  if (!task) throw new Usage('find takes a task in plain words, e.g. agentdrives find "send invoices"');
  const limit = opt.limit === undefined ? 10 : Number(opt.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Usage("--limit takes a whole number from 1 to 100");
  const idx = await api.index();
  const cat = opt.category ? categoryOf(idx.tools, opt.category) : null;
  if (opt.category && !cat) {
    const ids = categories(idx.tools).map((c) => c.category).join(", ");
    throw new ApiError(`no category '${opt.category}'. Categories: ${ids}`);
  }
  let source = "mcp:find_tools_for_task";
  let found = await findOnServer(api, task, opt, idx.tools);
  if (!found) { source = "index"; found = rankForTask(idx.tools, task); }
  if (cat) found = found.filter((t) => t.category === cat.id);
  if (opt["self-serve"]) found = found.filter(selfServe);
  const results = found.slice(0, limit).map((t) => summary(api.base, t, null, idx.levels ?? []));
  const filters = [cat && `in ${cat.name}`, opt["self-serve"] && "that an agent gets into alone"].filter(Boolean).join(", ");
  const head = results.length
    ? `${results.length} product${results.length === 1 ? "" : "s"} for "${task}"${filters ? ` ${filters}` : ""}, best first:`
    : `No product in the directory matches "${task}"${filters ? ` ${filters}` : ""}. Try fewer or other words, or: agentdrives categories`;
  const tail = results.length ? `\nOne product in full: agentdrives level ${results[0].slug}\nAll of them: ${link(api.base, "/tools")}` : "";
  emit(opt, { task, ...(cat ? { category: cat.id } : {}), self_serve: !!opt["self-serve"], source, results },
    `${head}${results.length ? `\n${rowsText(results)}` : ""}${tail}`);
  return 0;
}

function openInBrowser(url) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try { spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch { /* the link is printed anyway */ }
}

async function cmdCheck(api, opt, args) {
  if (args.length !== 1) throw new Usage("check takes one domain, e.g. agentdrives check acme.com");
  const dom = domainOf(args[0]);
  if (!dom) throw new Usage(`'${args[0]}' isn't a domain, e.g. acme.com`);
  const idx = await api.index().catch(() => null);
  const t = idx ? resolve(idx.tools, dom) : null;
  const listed = t ? summary(api.base, t, null, idx.levels ?? []) : null;
  const listedLine = listed ? `${listed.name} is in the directory: level ${listed.level}, ${listed.level_name} (driven ${day(listed.tested_at)}). ${listed.page}\n` : "";
  const dashboard = link(api.base, "/app/products");

  if (!api.hasKey) {
    const start = startLink(api.base, dom);
    if (opt.open) openInBrowser(start);
    emit(opt, { domain: dom, started: false, link: start, ...(listed ? { listed } : {}) },
      `${listedLine}Start a free check of ${dom}${opt.open ? " (opening your browser)" : ""}:\n  ${start}\n` +
      `Or set AGENTDRIVES_API_KEY (from ${link(api.base, "/app/keys")}) and run this again to start it from here.`);
    return 0;
  }

  const r = await api.freeCheck(`https://${dom}`);
  if (r.order) {
    if (opt.open) openInBrowser(dashboard);
    emit(opt, { domain: dom, started: true, order_id: r.order.id, status: r.order.status, note: r.note ?? null, dashboard, ...(listed ? { listed } : {}) },
      `${listedLine}Free check of ${dom} started (order ${r.order.id}).\n${r.note ?? ""}\nResults: ${dashboard}`);
    return 0;
  }
  // The domain was checked lately: its latest check instead of a new one; its result when it is this account's.
  const c = r.check ?? {};
  const rep = c.yours && c.order_id ? await api.report(c.order_id).catch(() => null) : null;
  const stop = rep?.next?.stop ?? null;
  // The dashboard's words (next.door; the fallback for an older server): where it would likely stop, a sign-up the
  // check couldn't see, or nothing closed at the door.
  const cap = (x) => `${String(x).charAt(0).toUpperCase()}${String(x).slice(1)}`;
  const result = rep?.next?.door ? `${rep.next.door.head} ${rep.next.door.line}` : rep?.next ? (stop ? `An agent would likely stop at ${stop.step ?? String(stop.label).toLowerCase()}. ${cap(stop.why)}.`
    : rep.next.signup_seen === false ? "The check couldn't see your sign-up." : "Nothing at the door looks closed.") : null;
  if (opt.open) openInBrowser(dashboard);
  emit(opt, { domain: dom, started: false, checked_at: c.checked_at ?? null, yours: !!c.yours, ...(c.order_id ? { order_id: c.order_id } : {}),
    next_free_at: r.next_free_at ?? null, note: r.note ?? null, ...(rep?.next ? { next: rep.next } : {}), dashboard, ...(listed ? { listed } : {}) },
    `${listedLine}${r.note ?? `${dom} was checked lately.`}${result ? `\n${result}` : ""}${c.yours ? `\nYour result: ${dashboard}` : ""}`);
  return 0;
}

async function cmdCategories(api, opt) {
  const idx = await api.index();
  const cats = categories(idx.tools);
  const w = Math.max(...cats.map((c) => c.category.length), 8);
  emit(opt, { categories: cats },
    `${"category".padEnd(w)}  products  best level\n${cats.map((c) => `${c.category.padEnd(w)}  ${String(c.products).padStart(8)}  L${c.best_level}`).join("\n")}`);
  return 0;
}

export async function main(argv, env = process.env) {
  let opt = {};
  try {
    const p = parse(argv);
    opt = p.opt;
    if (opt.version) { out(VERSION); return 0; }
    const [cmd, ...args] = p.pos;
    if (opt.help || !cmd || cmd === "help") { out(HELP); return cmd || opt.help ? 0 : 2; }
    const api = client({ base: opt.base ?? env.AGENTDRIVES_URL ?? DEFAULT_BASE, key: opt.key ?? env.AGENTDRIVES_API_KEY ?? "" });
    if (cmd === "level") return await cmdLevel(api, opt, args);
    if (cmd === "find") return await cmdFind(api, opt, args);
    if (cmd === "check") return await cmdCheck(api, opt, args);
    if (cmd === "categories") return await cmdCategories(api, opt, args);
    throw new Usage(`unknown command '${cmd}'. Commands: level, find, check, categories`);
  } catch (e) {
    const usage = e instanceof Usage;
    if (opt.json) out(JSON.stringify({ error: usage ? "usage" : e.code || "error", message: e.message, ...(e.fix ? { fix: e.fix } : {}) }, null, 2));
    else process.stderr.write(`agentdrives: ${e.message}${usage ? "\nSee: agentdrives --help" : ""}\n`);
    return usage ? 2 : 1;
  }
}

process.exitCode = await main(process.argv.slice(2));

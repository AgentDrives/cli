#!/usr/bin/env node
// agentdrives: look up how far an AI agent gets with a software product, from AgentDrives' test drives.
//   agentdrives level <domain|slug>                         one product: its level, where it stops, what an agent can do
//   agentdrives status <domain|slug> [--min-level N]        one line for CI: exit 1 when the live level is below N
//   agentdrives find "<task>" [--category C] [--self-serve]  products for a task, best first
//   agentdrives check <domain> [--open]                      start a free check (with AGENTDRIVES_API_KEY), else its link
//   agentdrives categories                                   the categories and the best level in each
//   agentdrives signup [--name N] [--email E]                an agent's own account and its API key, no person needed
//   agentdrives whoami                                       the key's account: who, its limits, domains and orders
//   agentdrives report <order>                               an order's result (a free check's), or that it still runs
// --json on every command. Exit codes: 0 ok (also a check that still runs), 1 an error or (status) a level below
// --min-level, 2 a usage error, 3 not in the directory (level, status).
import { spawn } from "node:child_process";
import { client, ApiError, DEFAULT_BASE } from "../lib/api.mjs";
import { domainOf, isSlug, resolve, byName, lookAlikes, categoryOf, categories, selfServe, rankForTask } from "../lib/match.mjs";
import { summary, levelText, rowsText, link, day } from "../lib/format.mjs";
import { VERSION } from "../lib/version.mjs";

const HELP = `agentdrives ${VERSION}: how far an AI agent gets with a software product, from AgentDrives' test drives.

Usage
  agentdrives level <domain|slug>          A product's level (0-5), where the agent stops and what it can do
  agentdrives status <domain|slug>         One line for CI: the product's live level
      --min-level <0-5>                    Exit with code 1 when the level is below this
  agentdrives find "<task>"                Products for a task, best level first
      --category <id|name>                 Only this category (see: agentdrives categories)
      --self-serve                         Only products an agent gets into on its own
      --limit <n>                          At most n products (default 10)
  agentdrives check <domain>               Start a free check of a product (needs an API key), or get its link
      --open                               Open the link in your browser
  agentdrives categories                   Every category, with its best level
  agentdrives signup                       An account for your agent and its API key, at once (no address needed)
      --name <name>                        Your agent's name, shown to the person who claims the account
      --email <address>                    Mail the claim link to this person too
  agentdrives whoami                       Your key's account: its limits, domains and orders
  agentdrives report <order>               A check's result, or how long it still takes

Options
  --json                                   Print JSON (for scripts and agents)
  --key <key>                              Your API key (better: set AGENTDRIVES_API_KEY)
  --base <url>                             Another AgentDrives address (default ${DEFAULT_BASE}; or AGENTDRIVES_URL)
  -h, --help                               This help
  -v, --version                            The version

Examples
  agentdrives level stripe.com
  agentdrives status stripe.com --min-level 4
  agentdrives find "send transactional email" --self-serve
  agentdrives check acme.com --json
  agentdrives signup --name my-agent

Get an API key at ${DEFAULT_BASE}/app/keys, or: agentdrives signup`;

const FLAGS = { json: "bool", "self-serve": "bool", open: "bool", help: "bool", version: "bool", category: "value", limit: "value", "min-level": "value", key: "value", base: "value", name: "value", email: "value" };
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

/** Whether a record is the one asked for: a domain must be its own or a subdomain of it; a slug or name is taken as is. */
const sameProduct = (rec, input) => {
  const dom = domainOf(input), own = String(rec?.domain ?? "").toLowerCase().replace(/^www\./, "");
  return !dom || !own || dom === own || dom.endsWith(`.${own}`);
};

/** One driven product by domain, slug or name: { t, full }, or null when we haven't driven it. The index lists only the
 *  directory (Audited and In Audit) once it opens; every other driven product still answers at /api/tools/<slug>.json,
 *  found by its slug's likely form, then by the MCP server's get_tool. Last, part of a name ("fathom") when only one
 *  product in the index holds it. */
async function lookup(api, idx, input) {
  const t = resolve(idx.tools, input);
  if (t) return { t, full: await api.product(t.slug) };
  const dom = domainOf(input), raw = String(input).trim().toLowerCase();
  const guesses = [...new Set([dom ? dom.split(".").at(-2) : null, !dom && isSlug(raw) ? raw : null].filter(Boolean))];
  for (const g of guesses) {
    const rec = await api.product(g);
    if (rec && sameProduct(rec, input)) return { t: rec, full: rec };
  }
  const slug = await api.slugOf(input);
  if (slug && !guesses.includes(slug)) {
    const rec = await api.product(slug);
    if (rec && sameProduct(rec, input)) return { t: rec, full: rec };
  }
  const named = byName(idx.tools, input);
  return named.length === 1 ? { t: named[0], full: await api.product(named[0].slug) } : null;
}

async function cmdLevel(api, opt, args) {
  if (args.length !== 1) throw new Usage("level takes one domain or slug, e.g. agentdrives level stripe.com");
  const idx = await api.index();
  const hit = await lookup(api, idx, args[0]);
  if (!hit) {
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
  const s = summary(api.base, hit.t, hit.full ?? {}, idx.levels ?? []);
  emit(opt, { found: true, product: s }, levelText(s, idx.levels ?? []));
  return 0;
}

/** status: one line for a CI step. With --min-level, exit 1 when the product's live level is below it (the reason says
 *  where our agent stopped), else 0; without, the line and 0. A product we haven't driven exits 3, as level does. */
async function cmdStatus(api, opt, args) {
  if (args.length !== 1) throw new Usage("status takes one domain or slug, e.g. agentdrives status stripe.com --min-level 4");
  let min = null;
  if (opt["min-level"] !== undefined) {
    min = Number(opt["min-level"]);
    if (!/^[0-5]$/.test(String(opt["min-level"]))) throw new Usage("--min-level takes a level from 0 to 5");
  }
  const idx = await api.index();
  const hit = await lookup(api, idx, args[0]);
  if (!hit) {
    const dom = domainOf(args[0]);
    emit(opt, { found: false, query: args[0], min_level: min, pass: false, reason: `${args[0]} isn't in the AgentDrives directory yet` },
      `${args[0]} isn't in the AgentDrives directory yet, so it has no level.${dom ? ` See what an agent would meet there: agentdrives check ${dom}` : ""}`);
    return 3;
  }
  const s = summary(api.base, hit.t, null, idx.levels ?? []);
  const name = s.domain ?? s.name, lv = `L${s.level}${s.level_name ? ` ${s.level_name}` : ""}`;
  const pass = min === null || s.level >= min;
  const where = s.stop ? ` Our agent stopped at ${s.stop.step.toLowerCase()}${s.stop.why ? `: ${s.stop.why.replace(/\.$/, "")}` : ""}.` : "";
  const when = s.tested_at ? ` Driven ${day(s.tested_at)}.` : "";
  const reason = min === null ? `${name} is at ${lv}.${when}`
    : pass ? `${name} is at ${lv}, at or above level ${min}.${when}` : `${name} is at ${lv}, below level ${min}.${where}${when}`;
  emit(opt, { found: true, slug: s.slug, name: s.name, domain: s.domain, level: s.level, level_name: s.level_name, min_level: min, pass, reason,
    tested_at: s.tested_at, page: s.page }, `${pass ? "OK" : "FAIL"} ${reason} ${s.page}`);
  return pass ? 0 : 1;
}

/** The MCP server's own task search, when it has one: its results as directory entries, or null to search here. The
 *  server filters by category and self-sign-up itself; an error it answers is the user's to see, never a quiet fallback. */
async function findOnServer(api, task, opt, tools, limit) {
  const list = await api.mcpTools();
  const tool = list?.find((t) => t.name === "find_tools_for_task");
  if (!tool) return null;
  const props = tool.inputSchema?.properties ?? {};
  const taskKey = ["task", "query", "description"].find((k) => k in props);
  if (!taskKey) return null;
  const args = { [taskKey]: task };
  const sent = { category: false, self_serve: false };
  if (opt.category && "category" in props) { args.category = opt.category; sent.category = true; }
  if (opt["self-serve"] && "self_signup" in props) { args.self_signup = true; sent.self_serve = true; }
  if ("limit" in props) args.limit = Math.min(limit, Number.isInteger(props.limit.maximum) ? props.limit.maximum : 25);
  const res = await api.mcpCall("find_tools_for_task", args);
  const items = Array.isArray(res) ? res : Array.isArray(res?.results) ? res.results : Array.isArray(res?.tools) ? res.tools : null;
  if (!items) return null;
  const bySlug = new Map(tools.map((t) => [t.slug, t]));
  return { sent, found: items.map((x) => bySlug.get(typeof x === "string" ? x : x?.slug)).filter(Boolean) };
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
  const server = await findOnServer(api, task, opt, idx.tools, limit);
  let found = server?.found;
  if (!server) { source = "index"; found = rankForTask(idx.tools, task); }
  if (cat && !server?.sent.category) found = found.filter((t) => t.category === cat.id);
  if (opt["self-serve"] && !server?.sent.self_serve) found = found.filter(selfServe);
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
  const hit = idx ? await lookup(api, idx, dom).catch(() => null) : null;
  const listed = hit ? summary(api.base, hit.t, null, idx.levels ?? []) : null;
  // "In the directory" only for a product the directory lists (Audited, In Audit, or every driven one before it opens).
  const inDir = listed && (!listed.directory || ["audited", "in_audit"].includes(listed.directory.state));
  const listedLine = listed ? `${listed.name} ${inDir ? "is in the directory" : "was driven"}: level ${listed.level}, ${listed.level_name} (driven ${day(listed.tested_at)}). ${listed.page}\n` : "";
  const dashboard = link(api.base, "/app/products");

  if (!api.hasKey) {
    const start = startLink(api.base, dom);
    if (opt.open) openInBrowser(start);
    emit(opt, { domain: dom, started: false, link: start, ...(listed ? { listed } : {}) },
      `${listedLine}Start a free check of ${dom}${opt.open ? " (opening your browser)" : ""}:\n  ${start}\n` +
      `Or set AGENTDRIVES_API_KEY (from ${link(api.base, "/app/keys")}) and run this again to start it from here.`);
    return 0;
  }

  let r;
  try { r = await api.freeCheck(`https://${dom}`); }
  catch (e) { if (e.code === "check_running") return stillRunning(api, opt, dom, e, listed, listedLine, dashboard); throw e; }
  if (r.order) {
    if (opt.open) openInBrowser(dashboard);
    emit(opt, { domain: dom, started: true, order_id: r.order.id, status: r.order.status, note: r.note ?? null, dashboard, ...(listed ? { listed } : {}) },
      `${listedLine}Free check of ${dom} started (order ${r.order.id}).\n${r.note ? `${r.note}\n` : ""}Its result, in a few minutes: agentdrives report ${r.order.id}\nOr: ${dashboard}`);
    return 0;
  }
  // The domain was checked lately: its latest check instead of a new one; its result when it is this account's.
  const c = r.check ?? {};
  const rep = c.yours && c.order_id ? await api.report(c.order_id).catch(() => null) : null;
  const result = rep?.ready === false ? rep.fix ?? null : resultLine(rep?.next);
  if (opt.open) openInBrowser(dashboard);
  emit(opt, { domain: dom, started: false, checked_at: c.checked_at ?? null, yours: !!c.yours, ...(c.order_id ? { order_id: c.order_id } : {}),
    next_free_at: r.next_free_at ?? null, note: r.note ?? null, ...(rep?.next ? { next: rep.next } : {}), dashboard, ...(listed ? { listed } : {}) },
    `${listedLine}${r.note ?? `${dom} was checked lately.`}${result ? `\n${result}` : ""}${c.yours ? `\nYour result: ${dashboard}` : ""}`);
  return 0;
}

/** A free check's result in the dashboard's words (next.door; the fallback for an older server): where an agent would
 *  likely stop, a sign-up the check couldn't see, or nothing closed at the door. null without a result. */
function resultLine(next) {
  if (!next) return null;
  if (next.door) return `${next.door.head} ${next.door.line}`;
  const stop = next.stop, cap = (x) => `${String(x).charAt(0).toUpperCase()}${String(x).slice(1)}`;
  if (stop) return `An agent would likely stop at ${stop.step ?? String(stop.label).toLowerCase()}. ${cap(stop.why)}.`;
  return next.signup_seen === false ? "The check couldn't see your sign-up." : "Nothing at the door looks closed.";
}

const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };

/** A check of the domain runs already: not an error. This account's own check, with its state and when to ask again,
 *  when it is one; else the API's words (someone else's check runs). */
async function stillRunning(api, opt, dom, err, listed, listedLine, dashboard) {
  const orders = await api.orders().catch(() => []);
  const mine = orders.find((o) => o.product === "free" && o.status !== "done" && o.check_state !== "failed" && (hostOf(o.url) === dom || hostOf(o.url).endsWith(`.${dom}`)));
  const rep = mine ? await api.report(mine.id).catch(() => null) : null;
  const note = (rep?.ready === false ? rep.fix : null) ?? err.fix ?? null;
  emit(opt, { domain: dom, started: false, running: true, yours: !!mine, ...(mine ? { order_id: mine.id } : {}),
    state: rep?.state ?? mine?.check_state ?? null, check_eta: rep?.check_eta ?? mine?.check_eta ?? null, note, dashboard, ...(listed ? { listed } : {}) },
    `${listedLine}A check of ${dom} is still running.${note ? `\n${note}` : ""}${mine ? `\nIts result, once it's in: agentdrives report ${mine.id}` : ""}`);
  return 0;
}

/** A command that needs the user's key, without one: where to get it. */
function needKey(api, what) {
  if (!api.hasKey) throw new ApiError(`${what} needs your API key: set AGENTDRIVES_API_KEY (from ${link(api.base, "/app/keys")}), or make an account for your agent with: agentdrives signup`, { code: "no_key" });
}

async function cmdReport(api, opt, args) {
  if (args.length !== 1) throw new Usage("report takes one order id, e.g. agentdrives report o-1a2b (agentdrives whoami lists yours)");
  needKey(api, "report");
  const id = args[0], rep = await api.report(id);
  if (!rep.ready) {
    const head = rep.state === "failed" ? `The check of order ${id} didn't finish.` : ["queued", "running", "late", "retrying"].includes(rep.state) ? `Order ${id} is still running.` : `Order ${id} isn't ready yet.`;
    emit(opt, { order_id: id, ready: false, state: rep.state ?? null, check_eta: rep.check_eta ?? null, note: rep.fix ?? null }, `${head}${rep.fix ? `\n${rep.fix}` : ""}`);
    return 0;
  }
  const result = resultLine(rep.next);
  emit(opt, { order_id: id, ready: true, mode: rep.mode ?? null, report: rep.report ?? "", ...(rep.next ? { next: rep.next } : {}), ...(rep.payment_map ? { payment_map: rep.payment_map } : {}) },
    `${result ? `${result}\n\n` : ""}${String(rep.report ?? "").trim()}`);
  return 0;
}

/** What an order is, in the words the dashboard uses. */
const ORDER_NAMES = { free: "Free check", drive: "Audit Drive", audit: "Audit Drive", renewal: "Audit renewal", stack: "Tool comparison", stack3: "Tool comparison",
  builder: "Builder plan", team: "Team plan", proof: "Payment proof" };

async function cmdWhoami(api, opt, args) {
  if (args.length) throw new Usage("whoami takes no arguments");
  needKey(api, "whoami");
  const me = await api.me(), u = me.user, ag = me.agent ?? null;
  const orders = (me.orders ?? []).map((o) => ({ id: o.id, product: o.product === "drive" ? "audit" : o.product, domain: hostOf(o.url) || null, status: o.status,
    check_state: o.check_state ?? null, check_eta: o.check_eta ?? null, created_at: o.created_at ?? null }));
  const claims = (me.claims ?? []).map((c) => ({ domain: c.domain, verified: c.status === "verified" }));
  const account = { id: u.id, type: ag ? "agent" : "person", claimed: !ag, email: u.email ?? null, name: u.name ?? null, created_at: u.created_at ?? null };
  const dashboard = link(api.base, "/app");
  const L = [];
  L.push(ag ? `An agent's own account${ag.name ? ` (${ag.name})` : ""}, not claimed by a person yet. Made ${day(account.created_at)}.`
    : `${account.email ?? account.name ?? account.id}. Account since ${day(account.created_at)}.`);
  if (ag?.limits) L.push(`Until a person claims it: ${ag.limits.free_checks_per_day} free check${ag.limits.free_checks_per_day === 1 ? "" : "s"} a day, ${ag.limits.key_requests_per_hour} requests an hour.${ag.claim_link_expires_at ? ` Its claim link works until ${day(ag.claim_link_expires_at)}.` : ""}`);
  if (me.data_plan && me.data_plan !== "free") L.push(`Data plan: ${ORDER_NAMES[me.data_plan] ?? me.data_plan}`);
  if (claims.length) L.push(`Domains: ${claims.map((c) => `${c.domain}${c.verified ? " (proved)" : " (not proved yet)"}`).join(", ")}`);
  if (orders.length) {
    L.push(`Orders (${orders.length}${orders.length > 5 ? ", the newest 5" : ""}):`);
    for (const o of orders.slice(0, 5)) L.push(`  ${o.id}  ${ORDER_NAMES[o.product] ?? o.product}${o.domain ? ` of ${o.domain}` : ""}, ${o.check_state ?? o.status}, ${day(o.created_at)}`);
    const open = orders.find((o) => o.product === "free" && o.status === "done") ?? orders.find((o) => o.product === "free");
    if (open) L.push(`A check's result: agentdrives report ${open.id}`);
  } else L.push("No orders yet. Start a free check: agentdrives check <domain>");
  L.push(dashboard);
  emit(opt, { account, ...(ag ? { agent: { name: ag.name ?? null, paid: !!ag.paid, limits: ag.limits ?? null, claim_link_expires_at: ag.claim_link_expires_at ?? null } } : {}),
    data_plan: me.data_plan ?? null, claims, orders, dashboard }, L.join("\n"));
  return 0;
}

async function cmdSignup(api, opt, args) {
  if (args.length) throw new Usage("signup takes no arguments: agentdrives signup [--name <name>] [--email <address>]");
  const r = await api.signup({ agent: opt.name ?? null, email: opt.email ?? null });
  const lim = r.limits ?? {}, cl = r.claim ?? {};
  const mailed = cl.mailed_to ? (cl.mailed ? `We mailed it to ${cl.mailed_to} too.` : `We couldn't mail it to ${cl.mailed_to}: give them the link yourself.`) : "";
  emit(opt, r, [
    "Your agent's account is ready. Its API key, shown only now (keep it somewhere safe):",
    `  ${r.api_key}`,
    `Use it here: export AGENTDRIVES_API_KEY=${r.api_key}`,
    ...(lim.free_checks_per_day != null ? [`Until a person claims the account: ${lim.free_checks_per_day} free check${lim.free_checks_per_day === 1 ? "" : "s"} a day, ${lim.key_requests_per_hour} requests an hour.`] : []),
    ...(cl.url ? [`The claim link for your person${cl.expires_at ? ` (works until ${day(cl.expires_at)})` : ""}:`, `  ${cl.url}`, ...(mailed ? [mailed] : [])] : []),
    "Next: agentdrives check <domain>",
  ].join("\n"));
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
    if (cmd === "status") return await cmdStatus(api, opt, args);
    if (cmd === "find") return await cmdFind(api, opt, args);
    if (cmd === "check") return await cmdCheck(api, opt, args);
    if (cmd === "categories") return await cmdCategories(api, opt, args);
    if (cmd === "signup") return await cmdSignup(api, opt, args);
    if (cmd === "whoami") return await cmdWhoami(api, opt, args);
    if (cmd === "report") return await cmdReport(api, opt, args);
    throw new Usage(`unknown command '${cmd}'. Commands: level, status, find, check, categories, signup, whoami, report`);
  } catch (e) {
    const usage = e instanceof Usage;
    if (opt.json) out(JSON.stringify({ error: usage ? "usage" : e.code || "error", message: e.message, ...(e.fix ? { fix: e.fix } : {}) }, null, 2));
    else process.stderr.write(`agentdrives: ${e.message}${usage ? "\nSee: agentdrives --help" : ""}\n`);
    return usage ? 2 : 1;
  }
}

process.exitCode = await main(process.argv.slice(2));

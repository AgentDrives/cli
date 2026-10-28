// What the CLI prints: one shape for --json (the same fields for every command) and plain text for people.

/** The nine checkpoints of a drive, by their API key. */
export const CHECKPOINTS = { docs: "Docs", signup: "Sign up", verify: "Verify", credentials: "Get a key", first_call: "First call",
  first_action: "Do the work", pay: "Pay", cancel: "Cancel", delete: "Delete the account" };

/** A link to agentdrives.com. Pages, open data files and the sign-up carry via=cli, so we can count visits from the
 *  CLI; the dashboard (/app) doesn't. */
export function link(base, path, params = {}) {
  const u = new URL(path, base + "/");
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  if (!/^\/app(\/|$)/.test(u.pathname)) u.searchParams.set("via", "cli");
  return u.toString();
}

/** Where the agent stopped, in words: the checkpoint and what stopped it. null when it went all the way. */
function stopOf(t) {
  if (!t.stop) return null;
  const step = CHECKPOINTS[t.stop] ?? String(t.stop).replace(/^The /, "the ");
  return { at: t.stop, step, why: t.first_blocker || null };
}

/** The bot check our agent met on a way in, at the step where it met it, and whether it got in another way. The full
 *  record says the step (rung) and other_way; the index names only the vendor: a bot check sits on a way in, so it was
 *  met at the stop when the agent stopped at sign-up or verify and didn't get in, else at sign-up. */
function botCheck(t, full, gotIn) {
  const c = full?.agent_check;
  const at = c?.vendor ? c.rung ?? null : !gotIn && ["signup", "verify"].includes(t.stop) ? t.stop : "signup";
  const vendor = c?.vendor ?? t.blocks_agent;
  if (!vendor) return null;
  return { vendor, at, step: CHECKPOINTS[at] ?? at, type: (c?.vendor ? c.type : t.wall_type) ?? null, other_way: typeof c?.other_way === "boolean" ? c.other_way : gotIn };
}

/** One product as the CLI gives it. `t`: its entry in /api/tools.json; `full`: its record (/api/tools/<slug>.json), for
 *  the detail only `level` shows. */
export function summary(base, t, full = null, levels = []) {
  const lv = levels.find((l) => l.n === t.level);
  const gotIn = t.entry === "self-start" || (t.stages ?? []).some((s) => s.key === "in" && s.state === "yes");
  const out = {
    slug: t.slug, name: t.name, domain: t.domain ?? null, category: t.category ?? null, category_name: t.category_name ?? null,
    level: t.level, level_name: t.level_name ?? lv?.name ?? null, level_text: lv?.short ?? null,
    gets_in_alone: gotIn,
    stages: (t.stages ?? []).map((s) => ({ key: s.key, label: s.label, state: s.state, text: s.text })),
    stop: stopOf(t), bot_check: botCheck(t, full, gotIn),
    pays_with: t.pays_with ?? [], paid: !!t.paid,
    tested_at: t.tested_at ?? null, origin: t.origin ?? "editorial", ...(t.disclosure ? { disclosure: t.disclosure } : {}),
    page: link(base, `/tools/${t.slug}`),
    json: link(base, `/api/tools/${t.slug}.json`),
  };
  if (full) Object.assign(out, {
    can_do: full.can_do ?? [],
    cannot_do: (full.cannot_do ?? []).map((c) => typeof c === "string" ? { what: c, why: null } : { what: c.what, why: c.why ?? null }),
    tips_for_agents: full.tips_for_agents ?? [],
    product_url: full.url ?? null,
  });
  return out;
}

const MARK = { yes: "✓", no: "✗", part: "~", unreached: "·", na: "·" };
const day = (iso) => { const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`); return isNaN(d) ? String(iso) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); };
const maxLevel = (levels) => levels.length ? Math.max(...levels.map((l) => l.n)) : 5;

/** `agentdrives level`: one product in full. */
export function levelText(s, levels) {
  const L = [];
  L.push([s.name, s.domain, s.category_name].filter(Boolean).join(" · "));
  L.push(`Level ${s.level} of ${maxLevel(levels)}: ${s.level_name}.${s.level_text ? ` ${s.level_text}` : ""}`);
  if (s.stages.length) {
    L.push("");
    const w = Math.max(...s.stages.map((x) => x.label.length));
    for (const x of s.stages) L.push(`  ${MARK[x.state] ?? "·"} ${x.label.padEnd(w)}  ${x.text ?? ""}`.trimEnd());
  }
  L.push("");
  if (s.stop) L.push(`Stops at: ${s.stop.step}${s.stop.why ? `. ${s.stop.why}` : ""}`);
  if (s.bot_check) L.push(`Bot check: ${s.bot_check.vendor}${s.bot_check.step ? ` at ${s.bot_check.step}` : ""}${s.bot_check.other_way ? ". The agent got in another way." : ""}`);
  if (s.can_do?.length) { L.push("An agent can:"); for (const c of s.can_do) L.push(`  - ${c}`); }
  if (s.cannot_do?.length) { L.push("An agent can't:"); for (const c of s.cannot_do) L.push(`  - ${c.what}${c.why ? ` (${c.why})` : ""}`); }
  if (s.tips_for_agents?.length) { L.push("Tips for agents:"); for (const tip of s.tips_for_agents) L.push(`  - ${tip}`); }
  if (s.pays_with.length) L.push(`Pays with: ${s.pays_with.join(", ")}${s.paid ? " (payment proven)" : ""}`);
  L.push(`Driven ${day(s.tested_at)}${s.disclosure ? ` · ${s.disclosure}` : ""}`);
  L.push(s.page);
  return L.join("\n");
}

/** One line per product: level, name, domain, whether it gets in alone and where it stops. */
export function rowsText(list) {
  if (!list.length) return "";
  const nw = Math.max(...list.map((s) => s.name.length)), dw = Math.max(...list.map((s) => (s.domain ?? "").length));
  return list.map((s) => {
    const b = s.bot_check, vendor = b ? b.vendor.replace(/\s*\(.*$/, "") : "";   // "hCaptcha (passive, …)" → "hCaptcha"
    // The bot check at its own step: next to the stop only when it is what stopped the agent there.
    const stoppedBy = b && !b.other_way && s.stop && b.at === s.stop.at;
    const how = (s.stop ? `, stops at ${s.stop.step}${stoppedBy ? ` (${vendor})` : ""}` : "")
      + (b && !stoppedBy ? `, bot check at ${b.step} (${vendor})${b.other_way ? ", got in another way" : ""}` : "");
    const tag = s.disclosure ? ` · ${s.disclosure}` : "";
    return `  L${s.level} ${String(s.level_name ?? "").padEnd(11)} ${s.name.padEnd(nw)}  ${(s.domain ?? "").padEnd(dw)}  ${s.gets_in_alone ? "gets in alone" : "needs a person to get in"}${how}${tag}`;
  }).join("\n");
}

/** The agent surfaces, in the API's order (agent_surfaces in /api/tools/<slug>.json). */
export const SURFACES = { api: "API", mcp: "MCP", cli: "CLI", sdk: "SDK", docs: "Docs", payment: "Payment" };
const STATE = { tested: "tested", documented: "documented, not tested", none_found: "none found", unknown: "unknown" };

/** Where a surface's facts come from: the product's own line for it, the payment options the drive found, and the day
 *  that part of the drive checked it (the docs pass and the payment check keep their own date). */
function sourceOf(key, full) {
  const notes = full.surface_notes ?? {};
  if (key === "payment") {
    const names = (full.pay_options?.options ?? []).map((o) => o.name).filter(Boolean);
    return { source: names.length ? names.join(", ") : null, date: full.pay_options?.checked ?? full.tested_at ?? null };
  }
  const source = key === "api" ? notes.api ?? notes.openapi : key === "docs" ? notes.llms_txt : notes[key];
  return { source: source ?? null, date: (key === "docs" ? full.docs?.at : null) ?? full.tested_at ?? null };
}

/** `agentdrives surfaces`: the record's agent_surfaces and issues_found as the API gives them, and each surface as a
 *  row with its source and date. A record from before the surface map has no agent_surfaces: every row is unknown. */
export function surfacesOf(base, full) {
  const as = full.agent_surfaces ?? null;
  return {
    slug: full.slug, name: full.name, domain: full.domain ?? null,
    level: full.level, level_name: full.level_name ?? null, issues_found: full.issues_found ?? null,
    tested_at: full.tested_at ?? null, agent_surfaces: as,
    surfaces: Object.keys(SURFACES).map((key) => {
      const s = as?.[key] ?? { state: "unknown", documented: null, tested: null };
      return { surface: key, state: s.state, documented: s.documented ?? null, tested: s.tested ?? null, ...sourceOf(key, full) };
    }),
    page: link(base, `/tools/${full.slug}`),
    json: link(base, `/api/tools/${full.slug}.json`),
  };
}

const num = (n) => n.toLocaleString("en-US");

export function surfacesText(s, levels) {
  const counts = (r) => r.tested != null && r.documented != null ? `${num(r.tested)} of ${num(r.documented)} ${r.surface === "docs" ? "pages read" : "tried"}`
    : r.documented != null ? `${num(r.documented)} listed` : "";
  // The source last: it is free text of any length, so it never pushes the columns before it.
  const rows = s.surfaces.map((r) => [SURFACES[r.surface], STATE[r.state] ?? r.state, counts(r), r.date ? day(r.date) : "", r.source ?? ""]);
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const L = [[s.name, s.domain].filter(Boolean).join(" · ")];
  L.push(`Level ${s.level} of ${maxLevel(levels)}: ${s.level_name}.${s.issues_found != null ? ` ${s.issues_found} ${s.issues_found === 1 ? "issue" : "issues"} found.` : ""}`);
  L.push("");
  for (const r of rows) L.push(`  ${r.map((c, i) => i === r.length - 1 ? c : c.padEnd(w[i])).join("  ")}`.trimEnd());
  L.push("");
  L.push(`Driven ${day(s.tested_at)}`);
  L.push(s.page);
  return L.join("\n");
}

export { day };

// Finding products in the directory index: a domain or slug to one product, a task in plain words to a ranked list.

/** "https://www.Acme.com/pricing" → "acme.com"; null when it isn't a host name. */
export function domainOf(input) {
  let s = String(input ?? "").trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null;
}

/** A slug as the directory writes them (lower case, digits, hyphens). */
export const isSlug = (s) => /^[a-z0-9][a-z0-9-]*$/.test(String(s ?? ""));

const bare = (d) => String(d ?? "").toLowerCase().replace(/^www\./, "");

/** The directory entry for a domain, slug or name: its own domain first, then a parent domain (app.acme.com → acme.com),
 *  then the slug, then the name. null when the product isn't in the directory. */
export function resolve(tools, input) {
  const raw = String(input ?? "").trim().toLowerCase();
  const dom = domainOf(raw);
  if (dom) {
    const exact = tools.find((t) => bare(t.domain) === dom);
    if (exact) return exact;
    const parts = dom.split(".");
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join(".");
      const hit = tools.find((t) => bare(t.domain) === parent);
      if (hit) return hit;
    }
  }
  return tools.find((t) => t.slug === raw) ?? tools.find((t) => String(t.name ?? "").toLowerCase() === raw) ?? null;
}

const words = (s) => String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/** The words a product answers to: its name's, its slug and its domain's own label (usefathom.com → "usefathom"). */
const ownWords = (t) => new Set([...words(t.name), t.slug, bare(t.domain).split(".").at(-2)].filter(Boolean));

/** Products whose name holds every word asked for, as whole words: "fathom" → Fathom Analytics, "b2" → Backblaze B2.
 *  At least one of the words must be more than what products do ("search" alone names a kind, not Brave Search API).
 *  Never for a domain (a domain is its own product or none). */
export function byName(tools, input) {
  if (domainOf(input)) return [];
  const q = words(input);
  const kinds = new Set(tools.flatMap((t) => words(`${t.category} ${t.category_name}`)));
  if (!q.some((x) => !kinds.has(x) && !STOP.has(x))) return [];
  return tools.filter((t) => { const w = ownWords(t); return q.every((x) => w.has(x)); });
}

/** Edit distance, stopped early once it is over `max`. */
function near(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...cur) > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/** Products that may be the one meant when `lookup` found none, best first: the same name on another domain (notion.so
 *  → Notion on notion.com), every product whose name holds the words, then names that start with them or are one typo
 *  off ("fath", "fathon" → Fathom Analytics). Only ever a suggestion. */
export function lookAlikes(tools, input) {
  const dom = domainOf(input);
  const label = dom ? dom.split(".").at(-2) : String(input ?? "").trim().toLowerCase();
  if (!label) return [];
  const q = dom ? [label] : words(label);
  const fits = (t, ok) => { const w = [...ownWords(t)]; return q.every((x) => w.some((y) => ok(x, y))); };
  const tiers = [
    (t) => t.slug === label || bare(t.domain).split(".")[0] === label || String(t.name ?? "").toLowerCase() === label,
    (t) => fits(t, (x, y) => x === y),
    (t) => fits(t, (x, y) => x.length >= 2 && y.startsWith(x)),
    (t) => fits(t, (x, y) => x.length >= 4 && near(x, y, x.length >= 7 ? 2 : 1)),
  ];
  const seen = new Set(), list = [];
  for (const tier of tiers) {
    const hits = tools.filter((t) => !seen.has(t.slug) && tier(t)).sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
    for (const t of hits) { seen.add(t.slug); list.push(t); }
  }
  return list;
}

/** A category id or name to its entry in the index's category list; null when there is none. */
export function categoryOf(tools, input) {
  const q = String(input ?? "").trim().toLowerCase();
  const t = tools.find((x) => x.category === q || String(x.category_name ?? "").toLowerCase() === q);
  return t ? { id: t.category, name: t.category_name } : null;
}

/** Every category in the directory: id, name, how many products, the best level in it. */
export function categories(tools) {
  const m = new Map();
  for (const t of tools) {
    const c = m.get(t.category) ?? { category: t.category, name: t.category_name, products: 0, best_level: 0 };
    c.products++; c.best_level = Math.max(c.best_level, t.level ?? 0); m.set(t.category, c);
  }
  return [...m.values()].sort((a, b) => b.products - a.products || a.name.localeCompare(b.name));
}

/** Gets in on its own: signs up, verifies and gets its key without a person (the level's first stage). */
export const selfServe = (t) => t.entry === "self-start" || (t.stages ?? []).some((s) => s.key === "in" && s.state === "yes");

// Words that say nothing about what a product does.
const STOP = new Set(("a an and any are as at be by can do does for from get i in into is it its me my need of on or our that the " +
  "this to tool tools use using want we what which with without you your agent agents ai api app apps service software saas " +
  "help lets let make makes my our some something thing things way best good customer customers client clients user users " +
  "team teams people person").split(" "));
/** A word cut to its stem, so "invoices", "invoicing" and "invoice" meet. */
const stem = (w) => w.length > 5 ? w.replace(/(ings|ing|ers|er|es|ed|e|s)$/, "")
  : w.length === 5 && w.endsWith("e") ? w.slice(0, -1)   // "store" meets "storage"
  : w.length > 3 ? w.replace(/s$/, "") : w;
export const taskWords = (task) => [...new Set(String(task ?? "").toLowerCase().split(/[^a-z0-9.+-]+/).map((w) => w.replace(/^[.+-]+|[.+-]+$/g, "")).filter((w) => w.length > 1 && !STOP.has(w)).map(stem))];

/** Products for a task in plain words: ranked by the task's words their name, domain, category and summary hold (a hit
 *  in the name or category counts double; a word that fits fewer products weighs more), then by level. Only products
 *  that match at least one word. */
export function rankForTask(tools, task) {
  const words = taskWords(task);
  if (!words.length) return [];
  const docs = tools.map((t) => ({ t, strong: [t.name, t.domain, t.category, t.category_name].filter(Boolean).join(" ").toLowerCase(),
    weak: String(t.summary ?? "").toLowerCase() }));
  const weight = Object.fromEntries(words.map((w) => [w, Math.log(1 + docs.length / Math.max(1, docs.filter((d) => d.strong.includes(w) || d.weak.includes(w)).length))]));
  return docs.map(({ t, strong, weak }) => {
    let score = 0;
    for (const w of words) score += strong.includes(w) ? 2 * weight[w] : weak.includes(w) ? weight[w] : 0;
    return { t, score };
  }).filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.t.level ?? 0) - (a.t.level ?? 0) || (b.t.coverage_core ?? -1) - (a.t.coverage_core ?? -1) || a.t.name.localeCompare(b.t.name))
    .map((x) => x.t);
}

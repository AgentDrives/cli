# AgentDrives CLI

Check whether an AI agent can sign up, get an API key and do the work in a software product, before you pick it.

The answers come from [AgentDrives](https://agentdrives.com), where an AI agent test-drives each product end to end
and records where it stops.

## Install

```sh
npm install -g @agentdrives/cli
```

Or run it without installing: `npx @agentdrives/cli level stripe.com`. Needs Node 18 or newer, or Bun.

## Example

<!-- example -->
```console
$ agentdrives level stripe.com
Stripe · stripe.com · Payments
Level 3 of 5: Does the work. An agent gets in on its own and does half the core work or more.

  ✓ Access  Gets in on its own: try first, claim later
  ~ Use     Work done: 56% of the core
  · Pay     Not tried yet: our agent worked without an account, so it had none to buy in
  ✓ Leave   Leaves on its own: nothing to cancel, what it made goes after 7 days

Stops at: Delete the account. `stripe sandboxes delete` needs a logged-in live account ('sandbox management requires an active live account; run `stripe login`').
Bot check: hCaptcha at Sign up
…
Driven 17 Oct 2026
https://agentdrives.com/tools/stripe?via=cli
```
<!-- /example -->

The full answer also lists what an agent can and can't do there, and tips for agents.

## Commands

### `agentdrives level <domain|slug>`

One product: its level (0 to 5), where the agent stopped and why, what it can and can't do there, and tips for
agents. Takes a domain, a URL, a subdomain (`api.acme.com` finds `acme.com`), a directory slug or a name.

```sh
agentdrives level stripe.com
agentdrives level https://www.notion.com/pricing
agentdrives level attio --json
```

A product we haven't driven yet exits with code 3 and the link to check it.

### `agentdrives find "<task>"`

Products for a job, best level first, each with whether an agent gets in alone and where it stops.

```sh
agentdrives find "send transactional email"
agentdrives find "crm" --self-serve              # only products an agent gets into on its own
agentdrives find "invoices" --category invoicing --limit 3
```

`agentdrives categories` lists the category ids and the best level in each.

### `agentdrives check <domain>`

A free check: where an agent would likely get stuck on a product, private to you, in a few minutes. With an API key
it starts here; without one you get the link to start it in your browser (`--open` opens it).

```sh
export AGENTDRIVES_API_KEY=...                   # from https://agentdrives.com/app/keys
agentdrives check acme.com
```

Run it again once the check is done to see where an agent would likely stop. One free check per domain every 90
days; within them you get the latest one.

## For scripts and agents

Every command takes `--json` and prints one JSON object. Errors in `--json` mode are JSON too:
`{"error": "...", "message": "...", "fix": "..."}`.

| Exit code | Meaning |
|---|---|
| 0 | Done |
| 1 | The API answered with an error, or couldn't be reached |
| 2 | Wrong command or option |
| 3 | `level`: the product isn't in the directory yet |

`level --json` gives `product` with `level`, `level_name`, `gets_in_alone`, `stages`, `stop` (`at`, `step`, `why`),
`bot_check`, `can_do`, `cannot_do`, `tips_for_agents`, `pays_with`, `paid`, `tested_at`, `page` and `json` (the full
record). `find --json` gives `results`, a list of the same fields without the last four.

Options: `--key <key>` (or `AGENTDRIVES_API_KEY`), `--base <url>` (or `AGENTDRIVES_URL`, default
`https://agentdrives.com`).

## Other ways in

- MCP: `https://agentdrives.com/api/mcp` (no key) or `https://agentdrives.com/mcp` (with your key).
- JSON: `https://agentdrives.com/api/tools.json` and `https://agentdrives.com/api/tools/<slug>.json`.
- The data is CC BY 4.0: say it comes from AgentDrives and link the product's page.

## Agent Skill

The GitHub repo also holds `skills/agentdrives/`, an Agent Skill that tells an agent to look a product up here before
it picks one or starts a sign-up. Add the folder to your agent's skills.

## Licence

MIT.

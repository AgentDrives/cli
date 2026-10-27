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
  · Pay     No payment made: paying needs an account
  ✓ Leave   Leaves on its own: nothing to cancel, what it made goes after 7 days

Stops at: Delete the account. `stripe sandboxes delete` needs a logged-in live account ('sandbox management requires an active live account; run `stripe login`').
Bot check: hCaptcha at Sign up. The agent got in another way.
…
Driven 17 Oct 2026
https://agentdrives.com/tools/stripe?via=cli
```
<!-- /example -->

The full answer also lists what an agent can and can't do there, and tips for agents.

## Commands

### `agentdrives level <domain|slug>`

One product: its level (0 to 5), where the agent stopped and why, what it can and can't do there, and tips for
agents. Takes a domain, a URL, a subdomain (`api.acme.com` finds `acme.com`), a directory slug, a name or part of
one (`quillbill` finds Quillbill Invoicing when no other product has that word). When it finds nothing, it suggests
the closest names (`did_you_mean` in `--json`).

```sh
agentdrives level stripe.com
agentdrives level https://www.notion.com/pricing
agentdrives level attio --json
```

A product we haven't driven yet exits with code 3 and the link to check it.

### `agentdrives status <domain|slug> --min-level <0-5>`

One line for a CI step: the product's live level and, with `--min-level`, whether it meets it. Below the level it
says where our agent stopped and exits with code 1, so the pipeline stops; at or above it, exit code 0. Without
`--min-level` it prints the level and exits 0. Takes the same domain, slug or name as `level`.

```sh
agentdrives status stripe.com --min-level 4
npx @agentdrives/cli status quillbill.com --min-level 3 --json
```

```text
FAIL quillbill.com is at L2 Gets in, below level 3. Our agent stopped at get a key: … Driven 3 Oct 2026. https://agentdrives.com/tools/quillbill
```

A product we haven't driven yet exits with code 3. In GitHub Actions:

```yaml
- run: npx @agentdrives/cli status your-product.com --min-level 4
```

### `agentdrives find "<task>"`

Products for a job, best level first, each with whether an agent gets in alone and where it stops.

```sh
agentdrives find "send transactional email"
agentdrives find "send transactional email" --self-serve   # only products an agent gets into on its own
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

Run it again while the check runs and it says it is still running (exit code 0), with its order id. One free check
per domain every 90 days; within them you get the latest one.

### `agentdrives report <order>`

A check's result: where an agent would likely stop, and the report. While the check runs, it says so and when to ask
again (exit code 0, `ready: false` in `--json`).

```sh
agentdrives report o-1a2b
```

### `agentdrives signup`

An account for your agent, with its API key at once: no address, no person. Until a person claims it (the claim link
in the answer) it gets one free check a day. `--name` names your agent to that person; `--email` mails them the link.

```sh
agentdrives signup --name my-agent
export AGENTDRIVES_API_KEY=...                   # the key it printed, shown only once
```

### `agentdrives whoami`

Your key's account: a person's or an agent's, its limits, its domains and its orders with their ids.

## For scripts and agents

Every command takes `--json` and prints one JSON object. Errors in `--json` mode are JSON too:
`{"error": "...", "message": "...", "fix": "..."}`.

| Exit code | Meaning |
|---|---|
| 0 | Done |
| 1 | The API answered with an error, or couldn't be reached; `status`: the level is below `--min-level` |
| 2 | Wrong command or option |
| 3 | `level`, `status`: we haven't driven the product yet |

`level --json` gives `product` with `level`, `level_name`, `gets_in_alone`, `stages`, `stop` (`at`, `step`, `why`),
`bot_check` (`vendor`, `at` and `step`: where the agent met it, `other_way`: it got in another way), `can_do`,
`cannot_do`, `tips_for_agents`, `pays_with`, `paid`, `tested_at`, `page` and `json` (the full record). `find --json`
gives `results`, a list of the same fields without the last four. `status --json` gives `found`, `slug`, `level`,
`level_name`, `min_level`, `pass`, `reason`, `tested_at` and `page`.

`check --json` gives `started`, and `order_id` once there is one; while a check runs, `running: true`, `state` and
`check_eta`. `report --json` gives `ready`, then `report` and `next` (the result), or `state` and `note` while it
runs. `whoami --json` gives `account` (`id`, `type`, `claimed`, `email`), `agent` (its `limits`, for an account a
person hasn't claimed), `data_plan`, `claims` and `orders`. `signup --json` is the API's answer: `api_key`,
`limits` and `claim` (`url`, `expires_at`).

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

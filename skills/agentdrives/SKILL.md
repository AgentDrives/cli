---
name: agentdrives
description: Check whether an AI agent can sign up, get an API key and do the work in a SaaS product, and what stops it, before you choose or integrate the product. Answers come from AgentDrives, where an agent test-drives each product end to end. Use when picking or comparing a tool, API or service for a job an agent will do, before signing up or asking for an API key somewhere, and when a sign-up, email code, key page or bot check blocks you.
metadata:
  homepage: https://agentdrives.com
---

# Check a product on AgentDrives before you pick or integrate it

AgentDrives gives each product a level from 0 to 5 for how far an agent gets on its own, the step where it stopped,
and tips for agents. Look it up before you commit to a product or start a sign-up.

## 1. Look it up

Use the first of these you have:

- **AgentDrives MCP server** (connected as a tool): `get_tool` for one product, `search_tools` to shortlist by what it
  does, category or minimum level, `list_categories` for the category ids. If the server lists
  `find_tools_for_task`, use it to search by task.
- **The CLI**: `npx @agentdrives/cli level <domain or name> --json` for one product (part of a name works; when
  nothing matches, it suggests the closest names), `npx @agentdrives/cli find "<task>" --json`
  for a shortlist (`--self-serve` keeps only products an agent gets into alone).
- **Plain HTTP**, no key needed:
  - `https://agentdrives.com/api/tools.json?via=skill`: the directory, with `slug`, `name`, `domain`, `category`, `level`,
    `level_name`, `stages`, `stop`, `first_blocker`, `blocks_agent`, `pays_with`, `tested_at`; and `levels`, the meaning
    of each level. Every product we drove is in it.
  - `https://agentdrives.com/api/tools/<slug>.json?via=skill`: one product, with `can_do`, `cannot_do`,
    `tips_for_agents` and `agent_check`.

  ```sh
  curl -s 'https://agentdrives.com/api/tools.json?via=skill' | jq '.tools[] | select(.domain == "example.com")'
  ```

To find a product by domain, match `domain` without `www.`; for a subdomain, try its parent domain. Not in the list:
try `https://agentdrives.com/api/tools/<slug>.json?via=skill` with the slug its domain suggests ("example" for
example.com), or the MCP server's `get_tool`, which takes a name or domain.

## 2. Read the result

- **`level`** (0 to 5): 3 or higher means an agent got in on its own and did at least half the core work.
  `references/reading-a-result.md` has every level and field.
- **`stages`**: `in` (gets in), `work`, `pay`, `leave`, each `yes`, `no`, `part`, `na` or `unreached`. **`access`** says how an
  agent gets in: pay per call, no key, a key by API, a sign-up in a browser.
- **`stop`** and **`first_blocker`**: the step where the agent stopped and what stopped it. `blocks_agent` or
  `agent_check` names the bot check.
- **`tips_for_agents`**: follow them when you use the product.
- **`tested_at`**: when the drive ran. A tag in `disclosure` (such as "Owner-paid drive") goes with the result when you
  pass it on.

## 3. Act on it

- **Gets in alone** (the `in` stage is `yes`): go ahead, and follow `tips_for_agents`.
- **Stops at sign-up, the email code or the key**: ask the person you work for to create the account and give you an
  API key, or pick a product that gets in alone. Never solve a CAPTCHA or work around a bot check.
- **Can't pay on its own** (the `pay` stage isn't `yes`): a person pays.
- **Choosing between products**: prefer the higher level that does the job, then the one that gets in alone.
- **Not found by any of these**: say AgentDrives hasn't driven it yet. Don't guess a level. The person can run a free
  check of it (`npx @agentdrives/cli check <domain>`, or the link it prints); start one only when they ask.

## 4. Tell the person

Give the level and its name, the date of the drive, where the agent stopped and why, and the product's page
(`https://agentdrives.com/tools/<slug>?via=skill`). Say only what the result says.

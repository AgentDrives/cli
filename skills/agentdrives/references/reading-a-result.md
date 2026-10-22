# Reading an AgentDrives result

## Levels

The live names and meanings are in `levels` in `https://agentdrives.com/api/tools.json?via=skill`. In short:

| Level | Name | What an agent did |
|---|---|---|
| 0 | Read-only | No API, CLI or MCP server to work with; it can only read about the product. |
| 1 | Needs a person | Sign-up, the email code or the key needed a person, or the product's terms allow only accounts a person makes. A step a person did counts as where it stopped. |
| 2 | Gets in | Got in alone, by any way the product offers (its own sign-up, a key by API, pay per call, no key at all), but did less than half the core work. |
| 3 | Does the work | Got in alone and did at least half the core work, checked by reading the results back. |
| 4 | Runs on its own | Did at least 80% of the core work and can stop paying on its own (it cancelled any plan it started, or there was nothing to cancel). |
| 5 | Autonomous | All of level 4, and paid on its own for the work: credits or a plan for its account, or per call for at least 80% of the core. |

## The steps of a drive

`stop`, `agent_check.rung` and the keys in `ladder` name a checkpoint:

| Key | Step |
|---|---|
| `docs` | Read the docs |
| `signup` | Sign up |
| `verify` | Verify the account (email code) |
| `credentials` | Get an API key |
| `first_call` | First API, CLI or MCP call |
| `first_action` | Do the work: create something real and read it back |
| `pay` | Pay |
| `cancel` | Cancel a plan |
| `delete` | Delete the account |

`stop` is where the agent stopped; `null` when nothing stopped it at the door.

## Fields

In `api/tools.json` (every product) and `api/tools/<slug>.json` (one product):

| Field | Meaning |
|---|---|
| `level`, `level_name` | The level, 0 to 5, and its name |
| `entry` | `self-start`: the agent signed up, verified and got its key alone |
| `stages` | `in`, `work`, `pay`, `leave`, each with `state` (`yes`, `no`, `part`, `na`, `unreached`) and `text` |
| `outcomes` | The five outcomes: `find`, `access`, `use`, `pay`, `leave`, each with `state` and `text` (the last four are the stages; `find`, shown as Learn, is whether our agent read the product's docs on its own and can act on them, and decides no level) |
| `access` | How an agent gets in: one entry per way that worked on its own (`key`: pay_per_call, keyless, key_by_api, browser_signup and more; `label`; `minutes` to the first call), or the key person when none did |
| `coverage_core` | Share of the core work done, in percent (`null`: not measured) |
| `stop`, `first_blocker` | The step where the agent stopped, and what stopped it |
| `blocks_agent`, `wall_type` | The bot check that stopped the agent on a way in, and its kind: `network` (it judged the agent's connection and browser; how an agent in a person's own browser fares is not measured yet) or `challenge` (every visitor must prove they are human; a person does this step) |
| `pays_with`, `paid` | Agent-native ways to pay the product offers, and whether a payment through one was proven |
| `parts` | Part scores from 0 to 100: `setup`, `holds_up`, `docs_match` (`null`: not measured) |
| `tested_at` | The date of the drive |
| `origin`, `disclosure` | Who paid for the drive; pass the `disclosure` tag on with the result |

Only in `api/tools/<slug>.json`:

| Field | Meaning |
|---|---|
| `can_do`, `cannot_do` | What an agent can and can't do there (`cannot_do` items have `what` and `why`) |
| `tips_for_agents` | How to get furthest with the product |
| `agent_check` | The bot check: `vendor`, `rung` (the step), `type` |
| `ladder` | Each step's result, with a note |
| `pay_options` | The ways to pay it offers an agent, and the payment proven |
| `url` | The product's own address |

## Example: one product, by domain

```sh
slug=$(curl -s 'https://agentdrives.com/api/tools.json?via=skill' | jq -r '.tools[] | select(.domain == "example.com") | .slug')
curl -s "https://agentdrives.com/api/tools/$slug.json?via=skill" | jq '{level, level_name, stop, first_blocker, tips_for_agents, tested_at}'
```

## MCP

- `https://agentdrives.com/api/mcp`: `search_tools`, `get_tool`, `list_categories`; no key.
- `https://agentdrives.com/mcp`: the same, plus account tools with an API key (`x-api-key`), such as `order` with
  `product: "free"` for a free check.

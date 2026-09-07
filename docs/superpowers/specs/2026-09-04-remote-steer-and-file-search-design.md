# Remote steer and file autocomplete on the DJL path

## Problem

The phone sends two Codex-shaped requests that the Electron adapter rejected
with "DJL Electron does not support remote method":

- `turn/steer` — mid-turn guidance while a turn is running. Only the legacy
  Codex desktop follower handled it.
- `fuzzyFileSearch` — @-file autocomplete in the composer.

## Design

Both map onto capabilities the Electron backend already has.

**Steer.** `thread.turn.start` accepts `dispatchMode: "steer"` ("an urgent
redirect", per the contracts). The adapter's turn start is refactored into
`dispatchTurn(params, mutation, dispatchMode)`; `turn/start` uses `"queue"`,
`turn/steer` uses `"steer"`. Steer is refused with "No active turn available
to steer." when the thread snapshot has no active turn, before any command is
dispatched. `turn/steer` joins `MUTATION_METHODS` so it carries a stable
command id and delivery receipt like other mutations. The response is the
same shape as turn start (`{ turn: { id, status: "inProgress" }, runtimeMode }`),
which the phone already parses.

**File search.** `projects.searchEntries { cwd, query, limit, kind: "file" }`
returns ranked `{ entries: [{ path, kind, parentPath? }], truncated }`. The
adapter queries it once per root (at most 4 roots, 50 results each) and maps
entries to the phone's `{ root, path, fileName, score, indices: null }` shape,
scoring by rank so the backend's order is preserved across roots. A root whose
search fails is skipped and logged; the others still return.

## Skills, plugins, and usage (follow-up, 2026-09-05)

Three more phone requests fell through the adapter. Each maps to an existing
backend method:

| Phone method | Backend | Mapping |
| --- | --- | --- |
| `skills/list {cwds?|cwd?, forceReload?}` | `provider.listSkillsCatalog {cwd?}` once per cwd (max 4; none → global) | `{skills: [{name, description, path, scope, enabled}]}`, duplicates collapsed by path |
| `plugin/list {cwds?, forceReload?}` | `provider.listPlugins {provider: "codex", cwd?, forceReload?}` | `{marketplaces}` passed through; the backend descriptor is a superset of the Codex shape the phone decodes |
| `account/rateLimits/read` | `server.listProviderUsage {}` | `{rateLimitsByLimitId: {"<provider>:<window>": {limitName, primary: {usedPercent, windowDurationMins?, resetsAt?}}}}`; providers whose status is not `ok` are omitted |

Plugins use the Codex provider because marketplaces are a Codex concept. The
usage mapping produces one row per provider window, labelled "Codex · 5h" and
so on, which the phone's status sheet sorts by window length.

## Testing

Adapter tests: skills merge across cwds and collapse shared paths; plugin list
sends the Codex provider and passes marketplaces through; usage snapshots map
to keyed buckets and skip providers that need auth. Steer dispatches `thread.turn.start` with `dispatchMode: "steer"`
and answers with the running turn id; steer without a running turn is refused
without dispatching; fuzzy search maps entries per root and skips a failing
root.

## Verified

- Adapter tests 26/26 (three new); full gateway suite `node --test ./test/*.test.js` 713 pass, 0 fail.
- No phone changes were needed: the phone already sends both requests and parses these response shapes.
- Not measured on hardware: steering a live DJL desktop turn and autocomplete results against a real workspace.
- Follow-up (skills, plugins, usage): adapter tests 29/29 (three new). Full gateway run showed 3 failures in the load-sensitive bridge and live-mirror files; those two files pass 138/138 when run alone.

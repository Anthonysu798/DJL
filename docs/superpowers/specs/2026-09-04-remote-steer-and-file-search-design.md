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

## Testing

Adapter tests: steer dispatches `thread.turn.start` with `dispatchMode: "steer"`
and answers with the running turn id; steer without a running turn is refused
without dispatching; fuzzy search maps entries per root and skips a failing
root.

## Verified

- Adapter tests 26/26 (three new); full gateway suite `node --test ./test/*.test.js` 713 pass, 0 fail.
- No phone changes were needed: the phone already sends both requests and parses these response shapes.
- Not measured on hardware: steering a live DJL desktop turn and autocomplete results against a real workspace.

# DJL iOS remote-path audit

Sub-project 5 of the DJL iOS remote-access work. Scope: the phone's streaming,
sync, and terminal hot paths after sub-projects 1–4 landed.

## Findings and changes

### Fixed

1. **Assistant delta overlap heuristic corrupted streamed text.**
   `mergeAssistantDelta` stripped any suffix/prefix overlap between consecutive
   deltas, so `"Hel" + "lo"` rendered as `"Helo"`. The overlap dedupe exists for
   replayed chunks, which overlap by many characters. Change: partial-overlap
   dedupe now requires at least 16 overlapping characters
   (`CodexService.minimumReplayOverlapCharacters`); exact-duplicate and
   prefix/suffix-containment rules are unchanged.
   File: `Services/CodexService+Messages.swift`.

2. **Running-thread poll re-read the thread every 3 s while deltas streamed.**
   The foreground sync loop issued `thread/read` for the active thread every
   3 s (1 s for mirrored runs) whenever a turn was running. Through the gateway
   that is a full orchestration snapshot per poll. Change: while a live
   (non-replay) assistant delta arrived within the last 5 s the poll returns
   early; polling remains the fallback for silence.
   Files: `Services/CodexService+Sync.swift`, `Services/CodexService+Messages.swift`,
   `Services/CodexService.swift`.

3. **Terminal buffer trim walked the whole string on every append.**
   `trimmedBuffer` used `String.count` (O(n) grapheme walk over up to 200 k
   characters) for every output chunk. Change: check the O(1) UTF-8 length first
   and only count graphemes when the byte length already exceeds the cap.
   File: `Services/Terminal/DJLTerminalModels.swift`.

### Verified as already sound

- Incoming frames are pre-decoded off the main actor in the transport paths
  (`WireMessagePreDecoder`, `handleDecodedRPCResult`), including batch arrays.
- Assistant deltas are coalesced per stream before touching the message array,
  and message persistence is debounced 250 ms and written on a detached task.
- Relay reconnect after a 4008 rate-limit close is immediate; the presence
  heartbeat and host-presence frames keep the badge honest without polling.

### Deferred (not changed)

- `GhosttyTerminalView.applyRemoteBuffer` compares the full applied prefix on
  every update (memcmp of up to 200 kB). Cheap in practice; a monotonic
  appended-byte counter on the snapshot would make it O(chunk) if terminal
  throughput ever becomes a problem.
- Gateway `thread/read` still fetches a full orchestration snapshot per call.
  With change 2 the phone stops issuing those during healthy streams; serving
  reads from the projection cache remains a gateway-side follow-up.
- Foreground list sync (10 s) and running-badge watch (2 s) intervals are
  unchanged; both are lightweight list calls.

## Verified

- New tests: short natural overlaps are kept; recent streamed activity suppresses the running catch-up poll (`CodexServiceIncomingRunIndicatorTests`, 96/96).
- Full iOS unit suite: 856 tests, one order-dependent failure unrelated to this change (passes alone).

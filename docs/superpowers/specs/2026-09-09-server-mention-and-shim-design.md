# `@server` mention and the `djl-ssh` shim — design

Date: 2026-09-09. Builds on the server registry (docs/superpowers/specs/2026-09-08-server-registry-design.md).

## Goal

A user attaches a registered server to a turn with `@name`. The agent then runs commands on it
through a helper on its PATH, `djl-ssh`, and DJL enforces the server's permission tier: read-only
commands only, approval per command, or unattended. Every command is recorded.

## Pieces

1. **Mention.** The `@` picker lists registered servers as a "Servers" group. Selecting one inserts
   the usual mention token and a reference `{ name, path: "ssh://<serverId>" }`. Chips for
   `ssh://` references show a server glyph and never open a file. Server mentions survive a provider
   switch (file and plugin mentions still reset).
2. **Prompt injection.** In the orchestration reactor, before any adapter sees the turn, `ssh://`
   references are resolved against the registry and removed from `mentions`. A
   `<selected_servers>` block is appended to the message text with, per server: name, address,
   user, tier and what it means, tags, OS and last stats, and the exact `djl-ssh "<name>" <cmd>`
   syntax. This reaches every harness identically; Codex never receives a non-path native mention.
3. **Shim.** At server boot DJL writes `<stateDir>/bin/djl-ssh` (POSIX sh, 0755) and `djl-ssh.cmd`,
   mints a random bearer token for this process lifetime, and sets `DJL_SSH_SHIM_URL`,
   `DJL_SSH_SHIM_TOKEN`, `DJL_SSH_SHIM_BIN` in `process.env` plus prepends the bin dir to PATH.
   Every harness env builder copies `process.env`; the Codex builder re-prepends the bin dir after
   it replaces PATH from the login shell. Per-thread `DJL_THREAD_ID` is set at the Codex, Claude,
   ACP (Cursor/Droid/Grok) and Gemini spawn sites. The script POSTs the command to
   `/api/servers/shim/exec` with curl, prints the combined output, and exits with the remote exit
   code taken from the `X-DJL-Exit-Code` response header.
4. **Policy.** `ServerCommandService` receives `{ serverName, threadId?, command }`:
   - unknown server, or host key not yet trusted: refused with an explanation (exit 125);
   - `read-only`: each pipeline segment's first word must be on the read-only allowlist and the
     command may not contain `>`/`>>`, `sudo`, `$(`/backticks, or `rm`/`mv`/`chmod`-class verbs;
     otherwise refused (exit 126) with the tier named;
   - `approve-each`: a pending record is published; the shim call blocks until the user approves
     or denies in the app, or 15 minutes pass (denied);
   - `full`: runs immediately.
   Execution uses `SshRunner.run` with a 5-minute timeout. Records live in `server_commands`
   (migration 060) and are exposed via `servers.commands.list` (audit) and the `servers.event`
   stream (pending approvals).
5. **Approval UI.** A global bottom-right surface lists pending commands: server name, thread name
   when known, the command in monospace, Approve and Deny. It subscribes to `servers.event` at app
   start and also raises a desktop notification. The expanded server row shows the last five agent
   commands with status and time.

## Not in scope

Open-terminal button, tag fan-out, iOS approval, recipes.

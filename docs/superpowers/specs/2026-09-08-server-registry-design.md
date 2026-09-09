# Server Registry — design

Date: 2026-09-08
Status: approved design, awaiting implementation plan
Scope: step 1 of the "servers as agent targets" feature. Registry, connection test, on-demand stats.
Not in this step: `@server` composer mention, agent SSH shim, per-command approvals, audit log.

## 1. Goal

Let a DJL user register the VPS and SSH hosts they own in one place inside Settings, verify
DJL can reach each one, and see a small set of live numbers per host. The registry is the
foundation the later agent features build on, so its data model must already carry the
fields those features need (stable id, permission tier, tags).

Success criteria for this step:

- A user with an existing `~/.ssh/config` can import their hosts in one click and test one
  of them in under a minute.
- A user with only a `.pem` file or a password can still register a host and get a green
  connection test without touching a terminal.
- No secret ever appears on a command line, in a log line, in an RPC response, or in the
  SQLite database.
- The panel reads, in all seven locales, as simply as the Accounts panel.

## 2. Decisions already made

| Decision | Choice |
| --- | --- |
| Placement | Settings section `servers`, in the `synara` nav group after `local-models`. |
| Connection layer | The system OpenSSH client, spawned by the server process. No `ssh2`. |
| Auth methods | ssh-agent / config default, key file path, imported key, password. |
| Stats refresh | On panel open (if stale) and on explicit refresh. No background polling. |
| Permission tier | Stored now (`read-only` default), enforced by the later agent shim. |
| Secrets | DJL's existing `ServerSecretStore` (0700 dir, 0600 files). No OS keychain. |

## 3. Data model (`packages/contracts/src/servers.ts`)

All schemas are Effect Schema, following `automation.ts` and `harnessAccounts.ts`.

```ts
ServerId            = branded TrimmedNonEmptyString ("ServerId")
ServerPermissionTier = Literals("read-only" | "approve-each" | "full")
ServerTag           = String matching /^[\p{L}\p{N}_-]{1,32}$/u   (unicode letters allowed)

ServerAuthMethod = Union(
  { type: "agent" },                                   // whatever ssh-agent and ~/.ssh/config provide
  { type: "keyPath", path: TrimmedNonEmptyString, hasPassphrase: Boolean },
  { type: "importedKey", hasPassphrase: Boolean },     // key bytes live in the secret store
  { type: "password" },                                // password lives in the secret store
)

ServerRecord = {
  id: ServerId,
  name:  TrimmedNonEmptyString (max 64),
  host:  TrimmedNonEmptyString (max 253),              // hostname or IP; validated, not resolved
  port:  PositiveInt (max 65535), default 22,
  username: TrimmedNonEmptyString (max 64),
  auth: ServerAuthMethod,
  tags: Array(ServerTag) (max 16, deduplicated, sorted),
  permissionTier: ServerPermissionTier,
  notes: String (max 2000),
  source: Literals("manual" | "ssh-config"),
  sshConfigAlias: optional String,                     // Host alias when imported
  lastTest: optional ServerConnectionTest,
  lastStats: optional ServerStats,
  createdAt: Number, updatedAt: Number,               // epoch ms
}

ServerConnectionTest = {
  at: Number, latencyMs: optional Number,
  outcome: Literals("ok" | "host-key-unknown" | "host-key-changed" | "auth-failed"
                    | "unreachable" | "timeout" | "askpass-unsupported" | "error"),
  message: optional String,                            // sanitized stderr, never secrets
  hostKey: optional { type: String, fingerprint: String },   // present for the two host-key outcomes
}

ServerStats = {
  collectedAt: Number,
  hostname: optional String,
  os: optional String,               // pretty name from /etc/os-release, or uname -sr
  kernel: optional String,
  uptimeSeconds: optional Number,
  load: optional { one: Number, five: Number, fifteen: Number },
  memory: optional { totalBytes: Number, usedBytes: Number },
  disk: optional { totalBytes: Number, usedBytes: Number, mountPoint: String },
}
```

Write inputs carry secrets in a separate, write-only field so they never round-trip:

```ts
ServerSecretInput = { privateKey?: String, passphrase?: String, password?: String }
ServerCreateInput = ServerRecord minus id/lastTest/lastStats/createdAt/updatedAt + { secret?: ServerSecretInput }
ServerUpdateInput = { id, patch: Partial<same fields>, secret?: ServerSecretInput, clearSecrets?: Array("privateKey"|"passphrase"|"password") }
```

Every server has a stable reference `ssh://<serverId>` for the future mention projection,
alongside the existing `plugin://` convention. It is derived, not stored.

## 4. Persistence

Migration `059_Servers.ts`, registered in `Migrations.ts` as `[59, "Servers", ...]`.

```sql
CREATE TABLE IF NOT EXISTS servers (
  server_id        TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  host             TEXT NOT NULL,
  port             INTEGER NOT NULL,
  username         TEXT NOT NULL,
  auth_json        TEXT NOT NULL,
  tags_json        TEXT NOT NULL,
  permission_tier  TEXT NOT NULL,
  notes            TEXT NOT NULL DEFAULT '',
  source           TEXT NOT NULL,
  ssh_config_alias TEXT,
  last_test_json   TEXT,
  last_stats_json  TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_servers_name ON servers (name);
```

`ServerRepository` (Service tag + Live layer, mirroring `AutomationRepository`) exposes
`list`, `getById`, `create`, `update`, `remove`, `recordTest`, `recordStats`. Plain CRUD,
not event-sourced.

Secrets live in `ServerSecretStore` under fixed names:

| Name | Content |
| --- | --- |
| `server.<id>.key` | private key bytes (imported key only) |
| `server.<id>.passphrase` | key passphrase |
| `server.<id>.password` | password |

`ServerSecretStore` gains one method, `pathOf(name)`, returning the on-disk path so the
SSH runner can pass an imported key with `-i`. Removing a server removes all three names.

## 5. SSH runner (`apps/server/src/servers/SshRunner.ts`)

One function, `runSsh(server, command, options)`, used by both the connection test and stats.
It spawns the OpenSSH client through the existing `processRunner` with:

```
ssh -T
    -o BatchMode=<yes unless password or stored passphrase>
    -o NumberOfPasswordPrompts=1
    -o ConnectTimeout=10
    -o StrictHostKeyChecking=yes
    -o UserKnownHostsFile="<stateDir>/ssh/known_hosts ~/.ssh/known_hosts"
    -o LogLevel=ERROR
    -p <port>
    [-i <keyPath | pathOf(server.<id>.key)>]
    [-o IdentitiesOnly=yes  when a key is specified]
    <username>@<host>  -- <command>
```

Imported-host entries also pass the alias instead of `user@host` when the user chose to keep
config-driven settings; otherwise DJL passes explicit values so the record is the truth.

Secrets never touch argv. For `password` and stored passphrases DJL uses the askpass
mechanism: it writes the secret to a fresh 0600 file under `<stateDir>/ssh/askpass/`,
sets `SSH_ASKPASS=<stateDir>/ssh/djl-askpass` (a 0700 helper script that prints the file's
contents), `SSH_ASKPASS_REQUIRE=force`, `DISPLAY=djl`, and `DJL_SSH_SECRET_FILE=<file>`,
then deletes the file when the process exits, on success or failure. A hard 20 s wall clock
kills the process and yields `timeout`.

Outcome mapping: exit 0 → `ok`; stderr contains `Permission denied` → `auth-failed`;
`REMOTE HOST IDENTIFICATION HAS CHANGED` → `host-key-changed`; `No such file`/`Could not
resolve`/`Connection refused`/`Network is unreachable` → `unreachable`; our kill → `timeout`.
Stderr is sanitized (secret file path and any line containing the username's password
prompt are stripped) before being stored as `message`.

### Host key trust

Because `StrictHostKeyChecking=yes` is always on, an unknown host is never silently trusted.
The connection test first runs `ssh-keyscan -p <port> -T 5 <host>`; if the host is absent from
both known-hosts files it returns `host-key-unknown` with the `ssh-keygen -lf` fingerprint and
does not attempt login. The UI shows the fingerprint; on confirm, `servers.trustHostKey`
appends the scanned line to `<stateDir>/ssh/known_hosts` and re-runs the test. A changed key
is reported as `host-key-changed` and is never auto-replaced; the user must remove the stale
line from their own known_hosts, which the message explains.

### Platform notes

- macOS ships OpenSSH 9+; all paths work.
- Windows uses `ssh.exe` from PATH or `%SystemRoot%\System32\OpenSSH\`. The askpass helper is
  a `.cmd`. If `ssh -V` reports a version below 8.4, password and stored-passphrase auth return
  `askpass-unsupported` with a message pointing to key auth. Key-path, imported-key without
  passphrase, and agent auth work on every supported version.
- `~/.ssh/config` and `known_hosts` resolve under `%USERPROFILE%` on Windows.

## 6. Stats collection (`apps/server/src/servers/stats.ts`)

One remote command, POSIX shell, Linux-first with graceful degradation. Every field is
optional; a missing tool yields a missing field, never a failed refresh:

```sh
hostname; uname -sr;
cat /etc/os-release 2>/dev/null | grep ^PRETTY_NAME= ;
cat /proc/uptime 2>/dev/null; cat /proc/loadavg 2>/dev/null;
grep -E '^(MemTotal|MemAvailable):' /proc/meminfo 2>/dev/null;
df -Pk / 2>/dev/null | tail -1
```

Output is parsed line-anchored with sentinel separators, so a missing section cannot shift
later fields. macOS/BSD hosts get hostname, kernel, uptime and disk only; the UI shows a dash
for the rest. Stats are stored on the row with `collectedAt`; the panel refreshes a server
automatically when its stats are older than 10 minutes and the panel is open.

## 7. SSH config import (`apps/server/src/servers/sshConfigImport.ts`)

Parses `~/.ssh/config` (and files it `Include`s, one level deep) for `Host` blocks. Skips
wildcard or negated patterns. For each alias reads `HostName`, `Port`, `User`,
`IdentityFile`. Returns candidates; nothing is written until the user confirms in the UI.
Aliases already present (matched on `sshConfigAlias`) are marked as existing and unchecked
by default. Imported records get `auth: {type:"keyPath"}` when `IdentityFile` is set,
otherwise `{type:"agent"}`, and `source: "ssh-config"`.

## 8. RPC surface

`WS_METHODS` additions and their `NativeApi.servers` names:

| Method | Payload | Success |
| --- | --- | --- |
| `servers.list` | `{}` | `{ servers: ServerRecord[] }` |
| `servers.create` | `ServerCreateInput` | `ServerRecord` |
| `servers.update` | `ServerUpdateInput` | `ServerRecord` |
| `servers.delete` | `{ id }` | `void` |
| `servers.testConnection` | `{ id }` | `ServerConnectionTest` (also persisted) |
| `servers.trustHostKey` | `{ id, fingerprint }` | `ServerConnectionTest` (re-test after trust) |
| `servers.refreshStats` | `{ id }` | `{ stats: ServerStats } \| { error: ServerConnectionTest }` |
| `servers.importSshConfig.preview` | `{}` | `{ candidates: SshConfigCandidate[] }` |
| `servers.importSshConfig.apply` | `{ aliases: string[] }` | `{ servers: ServerRecord[] }` |
| `servers.checkCapabilities` | `{}` | `{ sshVersion, sshPath, askpassSupported }` |

Handlers live in `wsRpc.ts` as `rpcEffect(serverService.x(input), "...")`. A `ServerService`
layer composes repository, secret store, runner, stats and import, and is wired in
`serverLayers.ts`. Test and refresh calls use a 30 s transport timeout.

## 9. UI (`apps/web/src/components/settings/ServersSettingsPanel.tsx`)

### Placement and chrome

Section id `servers`, icon a terminal-prompt glyph from the central icon set, label
"Servers", description "Your VPS and SSH hosts, ready for agents". Uses `SettingsSection`,
`SettingsCard`, `SettingsListRow`, `SettingsLoadError`, existing `button`, `dialog`,
`alert-dialog`, `badge`, `field`, `input`, `menu`, `collapsible` primitives, and the toast
manager. Fonts, colours and radii are DJL's own; no new tokens, no new dependency.
Micro-interactions are CSS transitions and keyframes in `index.css`, and all of them
collapse under `prefers-reduced-motion`.

### Layout

One section, one card. Card header row: title on the left, on the right a secondary
"Import from SSH config" button and a primary "Add server" button. Below, the server list.

**Empty state.** A left-aligned composition inside the card: a 48 px inline SVG of a prompt
line and blinking cursor whose stroke draws itself on mount (`stroke-dashoffset` animation,
600 ms, once), the heading "No servers yet", one sentence, and the same two buttons. The
cursor blink is the only perpetual motion on the panel.

**Server row.** A `SettingsListRow` per server. Left: a 8 px status dot, then the name, then
under it a monospace `user@host:port` line and the tag chips. Right, from left to right: a
stats strip of four monospace figures (load, memory %, disk %, uptime) that fade and rise in
with a 40 ms stagger the first time they arrive; a tier badge (`Read-only` / `Approve each`
/ `Full`); a kebab menu (Test connection, Refresh stats, Edit, Remove).

Status dot colours: neutral when never tested, breathing scale pulse while a test or refresh
is running, success when the last test was ok, warning for host-key-unknown, danger for every
other failure. Hovering the dot shows a tooltip with the last test time and outcome.

**Expanded row.** Clicking the row body toggles a `collapsible` region (height animates via
the existing `DisclosureRegion`). It shows: two thin bars for memory and disk whose fill
width transitions from 0 on open, OS and kernel, hostname, uptime in words, last stats time,
and last test result with its message. A "Test connection" button and a "Refresh" button
sit at the bottom right. Buttons press with `scale-[0.98]` and show an inline spinner
replacing their label while pending, then a 900 ms check-mark morph on success.

**Host key confirmation.** When a test returns `host-key-unknown`, the expanded row opens
automatically and shows an inline warning block: key type, fingerprint in monospace with a
copy button that flips to "Copied" for 1.2 s, the sentence "Confirm this matches the
fingerprint your provider shows before trusting it", and Trust / Not now buttons. Trust runs
`trustHostKey` and re-tests in place. `host-key-changed` shows a danger block with the
explanation and no trust button.

**Add / Edit dialog.** A `dialog` sized `max-w-2xl`. Desktop layout is a two-column grid,
`grid-cols-[1fr_minmax(0,18rem)]`, collapsing to one column under `md`. Left column, labels
above inputs, `gap-2` per field: Name, Host, Port, Username on one two-column line, then an
Authentication segmented control with four options (Agent / Key file / Import key /
Password). The option's fields slide in below it (opacity + 4 px translate, 180 ms):

- Key file: path input with a "Choose file" button that opens the native file picker,
  defaulting to `~/.ssh`; optional passphrase input with a "remember" note.
- Import key: a drop zone that accepts a file or pasted PEM text; shows the key type and
  comment once parsed locally; optional passphrase.
- Password: a masked input with a reveal toggle.

Then Tags (chip input, enter or comma to add, backspace to remove, chips animate in with a
scale from 0.9), Permission tier (three-option segmented control with one-line explanation
under the selected option), Notes (textarea).

Right column is a sticky preview pane titled "What DJL will run": the exact ssh command for
the current form values, rendered in monospace, secrets replaced by `••••••`, updating live
with a 120 ms cross-fade on each change. Under it a "Test before saving" button that runs
the test against the unsaved values through a transient in-memory record, showing the same
outcome states as the row. This pane is the panel's one deliberately creative element: it
turns the form into a teaching surface and removes the fear of a hidden command.

Footer: Cancel and Save. Save disables until the form validates; validation errors render
under the offending field. On save the dialog closes and the new row enters with the list's
enter animation and a short highlight sweep on its background.

**Import dialog.** Lists candidates with checkboxes, alias in bold, `user@hostname:port` in
monospace, a subdued "already added" tag where applicable. "Import selected" adds rows in a
stagger. Nothing is tested on import.

**Remove.** `alert-dialog` with the server name in the sentence, "Remove" as the destructive
action. The row collapses (height + opacity, 160 ms) and a toast confirms.

### Micro-interaction inventory

| Trigger | Response |
| --- | --- |
| Any button press | `scale-[0.98]` on `:active`, 80 ms |
| Test / Refresh pending | label replaced by inline spinner, status dot breathes |
| Test / Refresh success | check-mark morph 900 ms, stats strip stagger-in |
| Row expand | height transition via `DisclosureRegion`, bars fill from 0 |
| Tag add / remove | chip scale in 0.9 → 1 / scale out, 140 ms |
| Auth method switch | fields slide in, 180 ms |
| Preview command change | 120 ms cross-fade |
| Copy fingerprint | button text flips to "Copied", 1.2 s |
| New row after save | list enter animation + one highlight sweep |
| Row removal | collapse 160 ms |
| Empty-state illustration | stroke draws once, cursor blinks |

### Localization

All strings under `settings.servers.*` plus `settings.navigation.items.servers.*` and
`settings.search.entries.servers.*`, added to all seven catalogs (en, es-419, fr, ja, ko,
zh-Hans, zh-Hant) with real translations, since `catalogEquality.test.ts` rejects English
copies. Numbers, bytes, durations and relative times go through the existing i18n
formatters. Fingerprints, hostnames and commands are never translated.

## 10. Security constraints

- Secrets: write-only inputs, stored only in `ServerSecretStore`, never in SQLite, never in
  RPC responses, never in logs, never on argv. Askpass temp files are 0600 and deleted in a
  `finally`.
- Host keys: strict checking always; trust is an explicit user action with the fingerprint
  shown; a changed key is never auto-accepted.
- Commands: this step runs exactly two fixed commands (an `echo` probe and the stats script).
  No user or agent supplied command reaches the runner yet. The runner's signature keeps the
  command a parameter so the later shim can add approvals in front of it.
- Input validation: host and username are length- and charset-checked so they cannot be
  parsed as ssh options (a leading `-` is rejected).
- Deleting a server deletes its secrets and its lines in the DJL known_hosts file.

## 11. Testing

- `ServerRepository.test.ts`: CRUD, secrets absent from rows, test/stats persistence.
- `SshRunner.test.ts`: argv construction per auth method (no secret on argv, askpass env
  present only when needed), outcome mapping from fixture stderr, timeout kill, temp file
  cleanup on every exit path. The ssh binary is replaced by a fixture script.
- `stats.test.ts`: parser against Linux, minimal-busybox, and macOS fixture outputs.
- `sshConfigImport.test.ts`: aliases, wildcards skipped, Include, existing-alias marking.
- `ServersSettingsPanel.browser.tsx`: empty state, list with stats, add dialog validation,
  auth method switching, host-key confirmation flow, remove flow, screenshot baselines.
- `ServersSettingsPanel.test.ts`: pure helpers (command preview, byte/uptime formatting).
- Existing `catalogEquality.test.ts` and `bun run i18n:check` cover locale parity.

## 12. Out of scope, next steps

1. `@server` composer mention projecting `{ name, path: "ssh://<id>" }` into the harness prompt.
2. The `ssh` shim the harness calls, routing through the approval prompt per permission tier.
3. Per-server audit log of every command, approval, exit code.
4. Provider snapshot nudge before the first write command.
5. Promotion of Servers from a settings section to a top-level page if usage justifies it.

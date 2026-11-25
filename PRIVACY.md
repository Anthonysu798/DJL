# DJL Privacy

This page lists every connection the DJL desktop app makes to a server, what it sends, and how to
turn it off. It describes the code in this repository. If the app does something that is not listed
here, that is a bug: please report it through
[private vulnerability reporting](https://github.com/Anthonysu798/DJL/security/advisories/new).

DJL Cloud accounts, hosted chat, and billing are covered by the DJL Cloud privacy policy at
<https://slcor.com/privacy>.

## What stays on your computer

Projects, files, task history, terminal output, settings, and provider credentials are stored
locally. DJL has no analytics or usage tracking and no crash reporter. It does not record which
features you use, which models you pick, or how many projects or threads you have.

## Usage telemetry: removed

Releases up to and including 0.5.13 contained usage telemetry inherited from the upstream project
DJL was forked from. It was switched on by default and sent events to a PostHog project that DJL
does not control.

- **What it sent:** event names such as "session started" and "turn sent", the provider and model
  name, thread and project counts, operating system, CPU architecture, and app version.
- **How it identified an install:** a SHA-256 hash of your Codex account ID or Claude user ID, or
  of a random ID when neither existed.
- **What it did not send:** prompts, responses, code, file names, paths, or credentials.

That code has been deleted. Later releases contain no telemetry client, no PostHog key, and no
telemetry settings. If you run 0.5.13 or earlier, update, or set `DJL_TELEMETRY_ENABLED=false` in
the environment before starting DJL.

## Connections DJL makes on its own

| Connection                                             | Sent                                                                                                                                                                                                                 | Destination                                               | How to turn it off               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------- |
| Install count, once per install (release builds only)  | A random install ID, app version, operating system, CPU architecture, update channel. Cloudflare records the country of the request and uses its IP address briefly to limit how often one address can post.         | A counter we run on Cloudflare                            | Cannot be turned off in the app  |
| App update check, at start and every four hours        | Your IP address and the app's user agent. Updates download only when you ask.                                                                                                                                        | Our release storage on Alibaba Cloud OSS, then GitHub     | Cannot be turned off in the app  |
| Remote relay, while Remote is switched on (default on) | Your computer's host name, a device ID, the computer's public key, a lookup code derived from the pairing code, the pairing expiry, and your IP address. This happens at every start, even before a phone is paired. | `api.slcor.com` (our relay)                               | Settings → Remote                |
| DJL Cloud reachability and account status              | Signed out: an empty health request, so your IP address only. Signed in: your account token, to read credits and usage.                                                                                              | `api.slcor.com` and `api-asia.slcor.com`                  | Cannot be turned off in the app  |
| Provider update checks (default on)                    | The package names of the coding tools you have installed, and your IP address.                                                                                                                                       | `registry.npmjs.org`, `formulae.brew.sh`                  | Settings, provider update checks |
| Link icons                                             | The host name of each link shown in a chat, including internal host names.                                                                                                                                           | Google and DuckDuckGo icon services, then the site itself | Cannot be turned off in the app  |

## Connections that happen only when you use a feature

- **AI providers.** Prompts, attached files, and tool results go to the provider you chose (for
  example Claude, Codex, or a local model), under that provider's terms.
- **DJL Cloud models.** When you pick a DJL Cloud model, the conversation goes to `api.slcor.com`
  and on to the model provider that serves it.
- **Voice dictation.** Recorded audio goes to ChatGPT's transcription service using your own Codex
  sign-in.
- **Usage ring.** DJL reads your own quota from Claude, Codex, Cursor, and Gemini with the
  credentials already on your computer.
- **MultiPost and marketing tools.** Posts go to the social platforms you signed in to. Marketing
  drafts and images you generate go to DJL Cloud.
- **Plugins.** A plugin connects to its own server only after you add and connect it.
- **Downloads.** Local models and the AI writing check download from Hugging Face. Tool installers
  download from their vendors.
- **In-app browser.** Pages you open load from their own sites, like any browser.

## Remote access from your phone

Messages between your phone and your computer are end-to-end encrypted with keys that only the two
devices hold. The relay passes the encrypted messages along and cannot read prompts, responses,
files, terminal output, or approvals.

When it connects, the computer signs its registration and the phone signs its connection with the
device keys created at pairing. The relay uses those signatures to stop anyone else from registering
as your computer or taking your phone's place on the connection.

Pairing is protected against the relay as well. The QR code and the typed pairing code carry a
secret that is never sent to the relay, and the phone and the computer each prove they hold it
before either trusts the other. Someone who controls the relay cannot pair a device of their own
with your computer and cannot swap in their own key. The relay still sees the routing details in
the table above, plus message sizes and timing. See the
[remote architecture](docs/remote/architecture.md) and the
[threat model](docs/security/threat-model.md).

Pairing a new phone requires a DJL desktop and a DJL phone app that both include this protection.
An older phone app is asked to update. A phone that is already paired keeps working.

## Running the server yourself

`djl` and `bun run start` run the local server without the desktop app. It listens on this computer
only (`127.0.0.1`). If you bind it to another address with `--host`, a connection from
any other machine has to authenticate before the server accepts it.

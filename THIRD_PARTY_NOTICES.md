# Third-party notices

DJL is distributed under the root [MIT License](LICENSE), with copyright notices retained for
Emanuele Di Pietro and Anthony Su.

- **Synara** — DJL is derived from the Synara codebase by Emanuele Di Pietro. The retained upstream
  attribution is covered by the root MIT license and the original copyright notice.
- **Remodex** — portions of the iOS app and local remote gateway began as a source import from
  [Remodex](https://github.com/Emanuele-web04/remodex). Provenance and the retained Apache License
  2.0 are in [apps/ios/UPSTREAM.md](apps/ios/UPSTREAM.md),
  [apps/ios/UPSTREAM_LICENSE](apps/ios/UPSTREAM_LICENSE),
  [apps/remote-gateway/UPSTREAM.md](apps/remote-gateway/UPSTREAM.md), and
  [apps/remote-gateway/UPSTREAM_LICENSE](apps/remote-gateway/UPSTREAM_LICENSE).
- **OpenCode** — DJL connects to a separately installed OpenCode CLI using the official
  `@opencode-ai/sdk` dependency. DJL does not distribute the CLI executable or its source fork.
  The retained MIT license is [docs/licenses/OPENCODE_LICENSE](docs/licenses/OPENCODE_LICENSE).
- **Ghostty** — the iOS terminal framework contains Ghostty-derived headers and static libraries.
  Ghostty is copyright Mitchell Hashimoto and Ghostty contributors and is licensed under the MIT
  license retained at
  [apps/ios/DJL/Terminal/Vendor/GHOSTTY_LICENSE](apps/ios/DJL/Terminal/Vendor/GHOSTTY_LICENSE).

Package-level licenses retained inside vendored source trees continue to apply to those packages.

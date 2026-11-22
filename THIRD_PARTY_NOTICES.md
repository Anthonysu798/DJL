# Third-party notices

DJL is distributed under the root [MIT License](LICENSE), with copyright notices retained for
Emanuele Di Pietro and Anthony Su.

- **Upstream codebase** — DJL is derived from an MIT-licensed codebase by Emanuele Di Pietro. The
  retained attribution is covered by the root MIT license and the original copyright notice; the
  computer-use portions also retain [docs/licenses/COMPUTER_USE_LICENSE](docs/licenses/COMPUTER_USE_LICENSE).
- **Remodex** — portions of the iOS app and local remote gateway began as a source import from
  Remodex by Emanuele Di Pietro. Provenance and the retained Apache License
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

## MultiPost

DJL embeds the Apache-2.0 public components of leaperone/MultiPost-Extension, commit `5522ca01100a58572de3a652aebd7851f5fa648a`. Original sources and hashes are retained in `packages/multipost/vendor`; DJL adds a separate browser host and submission gating. Proprietary MultiPost Agent components are not included. See `docs/licenses/MULTIPOST_LICENSE`. The Aliyun adapter uses Turndown 7.2.0 (MIT); its license is retained in `packages/multipost/vendor/TURNDOWN_LICENSE`.

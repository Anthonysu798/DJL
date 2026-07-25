# Contributing to DJL

DJL is early-stage software. Focused bug fixes, reliability improvements, performance work, tests,
and documentation corrections are welcome.

## Before opening a pull request

Open an issue before starting a large feature, architectural change, or new provider integration.
Keep each pull request limited to one problem and avoid unrelated formatting or refactoring.

Never commit credentials, provider histories, signing material, databases, logs, or local `.djl`
state. Report security problems through the private process in [SECURITY.md](SECURITY.md).

## Development

```sh
bun install --frozen-lockfile
bun run dev:desktop
```

Before requesting review, run the checks that match your change. For desktop runtime changes, the
full local set is:

```sh
bun run ci:desktop:format
bun run ci:desktop:lint
bun run ci:desktop:typecheck
bun run ci:desktop:test
bun run ci:desktop:release-tests
bun run build:desktop
bun run ci:desktop:preload
bun run test:desktop-smoke
```

Chromium renderer tests require a host that permits localhost browser servers:

```sh
bun run --cwd apps/web test:browser:install
bun run ci:desktop:browser
```

## Pull requests

- Explain the problem, the chosen solution, and how you verified it.
- Include before/after images for visual changes and a short recording for motion changes.
- Preserve compatibility identifiers such as the existing `@synara/*` package scope unless the
  change explicitly migrates them.
- Do not update vendored OpenCode or Ghostty artifacts without updating provenance, licenses, and
  the relevant integrity checks.
- Do not alter release workflows, updater metadata, entitlements, or signing scripts without an
  explicit release-security review.

The required `Desktop checks` status must pass. Maintainers may ask for a smaller change or close
work that does not fit the project's direction.

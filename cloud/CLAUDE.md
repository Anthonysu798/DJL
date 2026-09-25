# DJL-Backend working rules

Read `docs/specs/2026-09-12-phase-0-cloud-control-plane.md` before changing anything. Decisions
listed there are final for Phase 0.

- Effect services live in `Services/`, implementations in `Layers/`, same as the open-source DJL repo.
- Pure rules go in `packages/domain` with unit tests; IO goes in apps.
- Ledger is append-only. Balances are folded from entries. Never write a balance directly.
- Every request carries a `trace_id`; never log tokens, secrets, emails, phones, or response bodies.
- Every admin mutation writes an `audit_events` row in the same transaction.
- Tests for security invariants (IDOR, negative balance, replay, reuse) are required with each feature.
- `bun run ci` must pass before a commit is pushed.

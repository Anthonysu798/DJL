# CI quality gates

- `.github/workflows/desktop-ci.yml` runs the five desktop test lanes on pull requests and pushes to
  `main`, then requires the aggregate `desktop-ci` check.
- Pushes to `main` additionally build native macOS ARM64, macOS Intel, and Windows x64 package
  smokes. The Windows smoke signs through Microsoft Artifact Signing and verifies Authenticode plus
  its RFC 3161 timestamp.
- `.github/workflows/desktop-release.yml` builds the same three production targets from an annotated
  `v*.*.*` tag. Missing Apple or Azure signing configuration fails preflight; there is no unsigned
  Windows fallback.
- See `docs/release.md` for the complete release and signing setup.

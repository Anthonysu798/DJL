# Security policy

## Reporting a vulnerability

Do not open a public issue or discussion for a suspected vulnerability. Use
[GitHub private vulnerability reporting](https://github.com/Anthonysu798/DJL/security/advisories/new)
and include:

- the affected DJL version or commit;
- a minimal reproduction;
- the expected security boundary and observed behavior;
- impact, prerequisites, and any known workaround.

Do not include live credentials or private user data. Use synthetic test material and state when
details need to be exchanged through a safer channel.

## Supported versions

Security fixes target the latest published stable desktop release and `main`. Older prereleases and
legacy VPS bridge builds receive fixes only when required to move installed clients safely to a
current release.

## Release security

macOS production artifacts must be Developer ID signed, notarized, stapled, and verified before a
release leaves draft state. Windows is intentionally unsigned until a Windows signing service is
configured; releases and the README must continue to disclose that limitation.

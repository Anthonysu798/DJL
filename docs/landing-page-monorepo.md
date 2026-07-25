# DJL landing page in the monorepo

The public DJL landing page lives in `apps/landing`. It is deployed separately
from the desktop application; configure Vercel's **Root Directory** as
`apps/landing`.

## Git remotes

The DJL repository keeps the original landing-site repository as a secondary
remote named `landing`:

```bash
git remote -v
```

`origin` remains the main DJL repository. `landing` points to
`Anthonysu798/DJL_landing_website` and is retained only for an intentional
two-repository transition or standalone landing-site delivery.

## Normal workflow

Make landing changes under `apps/landing` and commit them with the DJL code.
Do not initialise a nested `.git` directory there.

If a change must also be delivered to the old landing-site repository, publish
the subtree explicitly after reviewing the generated commit:

```bash
git subtree push --prefix=apps/landing landing main
```

To bring intentional standalone landing-site changes back into this monorepo:

```bash
git fetch landing main
git subtree pull --prefix=apps/landing landing main --squash
```

Avoid changing the same landing files independently in both repositories. The
monorepo is the source of truth once this migration branch is merged.

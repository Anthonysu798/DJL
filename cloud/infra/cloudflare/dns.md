# slcor.com DNS (Cloudflare)

Everything runs on the VPS (`cloud/infra/vps`). Records are **DNS only** so Caddy can
obtain Let's Encrypt certificates and streaming responses are not buffered. Never add a
Caddy site before its record points at the VPS: failed HTTP-01 checks count against
Let's Encrypt's 5 failures per hour limit.

| Name            | Type         | Target                         | Proxy    | Serves                        |
| --------------- | ------------ | ------------------------------ | -------- | ----------------------------- |
| `@`             | A            | VPS IPv4                       | DNS only | Landing site                  |
| `www`           | CNAME        | `slcor.com`                    | DNS only | Redirect to apex              |
| `api`           | A            | VPS IPv4                       | DNS only | Cloud API and remote relay    |
| `app`           | A            | VPS IPv4                       | DNS only | Web app (production)          |
| `admin`         | A            | VPS IPv4                       | DNS only | Admin console (production)    |
| `files`         | A            | VPS IPv4                       | DNS only | Storage presigned URLs (prod) |
| `api-staging`   | A            | VPS IPv4                       | DNS only | Staging API                   |
| `staging`       | A            | VPS IPv4                       | DNS only | Staging web app               |
| `admin-staging` | A            | VPS IPv4                       | DNS only | Staging admin                 |
| `files-staging` | A            | VPS IPv4                       | DNS only | Staging storage               |
| Resend          | TXT/MX/CNAME | per Resend domain verification | DNS only | Email                         |

## slcor.site (user sites, separate zone)

| Name | Type | Target   | Proxy   |
| ---- | ---- | -------- | ------- |
| `*`  | A    | VPS IPv4 | Proxied |
| `@`  | A    | VPS IPv4 | Proxied |

SSL/TLS mode Full (strict) with a Cloudflare Origin CA certificate on the VPS; see
`cloud/infra/vps/README.md`, "User sites on slcor.site". The apex redirects to slcor.com.
Keep sites on this separate registrable domain: a subdomain of slcor.com would let
published pages set cookies for slcor.com.

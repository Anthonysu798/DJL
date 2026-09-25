# slcor.com DNS (Cloudflare)

| Name     | Type         | Target                              | Proxy                                |
| -------- | ------------ | ----------------------------------- | ------------------------------------ |
| api      | CNAME        | djl-api.fly.dev                     | Proxied                              |
| api-asia | CNAME        | djl-api.fly.dev (Singapore anycast) | **DNS only** (mainland reachability) |
| admin    | CNAME        | cname.vercel-dns.com                | Proxied                              |
| app      | CNAME        | cname.vercel-dns.com                | Proxied                              |
| Resend   | TXT/MX/CNAME | per Resend domain verification      | DNS only                             |

Never proxy `api-asia`. Cloudflare's edge is unreliable from mainland China; the point of
that hostname is a direct path to Fly Singapore.

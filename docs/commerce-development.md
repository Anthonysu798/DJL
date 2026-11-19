# DJL commerce development

DJL Shop opens in a separate desktop window. Its Electron session does not share local AI permissions or storage. The bundled offline storefront is a labeled prototype; hosted `/shop` uses DJL Cloud accounts and commerce APIs. Both are separate from AI credits and chat data.

## Run locally

- `bun run dev:shop` opens the offline prototype on loopback. `bun run test:shop` runs its regression suite.
- The hosted test storefront, supplier tools, and commerce administration use PostgreSQL and Redis. See [DJL Cloud](../cloud/README.md) for development commands and `cloud/.env.example` for configuration names.
- Set `DJL_COMMERCE_MODE=test` only in a `local` or `test` API environment. Checkout and withdrawals are disabled outside TEST. An explicitly enabled Stripe adapter only accepts Stripe test credentials and test events. Never supply real customer data or payment credentials to a test environment.
- An ordinary hosted desktop storefront needs `DJL_COMMERCE_WEB_URL` (HTTPS `/shop`), `DJL_COMMERCE_API_URL` (API origin), and optionally `DJL_COMMERCE_STORAGE_URL` (separate approved origin). Set `DJL_COMMERCE_REQUIRE_HOSTED=true` in a launcher that must never fall back to the bundled prototype. This flag checks the destination; it does not certify that live payment is available.
- Hosted image lookup remains disabled until the catalog and images are approved, provider prices and budget are configured, storage lifecycle is verified, and the evaluation meets the agreed targets. See `bun run cloud:commerce:images:evaluate -- --help`.
- [Canadian address autocomplete](commerce-address-lookup.md) is separate from checkout and uses a server-only credential. It does not validate carrier deliverability or save an address.

## Business boundaries

The hosted foundation covers catalog, stock, shopping cart, orders, refunds and support, supplier fulfillment, direct referrals, a CAD test commission ledger, and reviewed test withdrawals. One referrer can be confirmed before first payment; later valid orders credit that direct referrer only. No self-referrals, multilayer commission, real payouts, or conversion of AI credits or demo funds are supported.

Before exposing a real paid pilot, independently verify the operating entity, merchant integration, price/stock, Canadian shipping and tax calculation, returns, reconciliation, and payout approval. Do not infer deployment or a live business capability from passing test scenarios.

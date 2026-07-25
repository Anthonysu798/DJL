# DJL Remote Deployment Runbook

This runbook provisions the blind relay, APNs completion notifications, desktop release embedding, and the iOS release lane. Use separate Cloudflare and Apple credentials for staging and production.

## Prerequisites

- A Cloudflare account with Workers and Durable Objects enabled.
- Wrangler authenticated for the target account.
- An Apple Developer team, an APNs `.p8` key, and the DJL app identifier `app.djl.ios` with Push Notifications enabled.
- GitHub repository access to configure Actions variables and release-signing secrets.
- A publicly reachable relay hostname with TLS. Production clients require `wss://`.

## 1. Verify the relay locally

From the repository root:

```sh
bun install
bun run --cwd apps/remote-relay test
bun run --cwd apps/remote-relay build
```

The build is a Wrangler dry run. It must include both `DJLRelaySession` and `DJLRelayRegistry` Durable Objects.

For local Worker development:

```sh
bun run --cwd apps/remote-relay dev
```

Use only test credentials and local clients with `ws://`. Never put production APNs keys in a checked-in `.dev.vars` file.

## 2. Create environment-specific Worker configuration

The checked-in `apps/remote-relay/wrangler.jsonc` defines the production-neutral bindings. Before deploying, set an environment-specific Worker name and routes through Cloudflare configuration or a reviewed environment block. Staging and production must not share:

- Worker names or hostnames;
- Durable Object namespaces/state;
- `RELAY_ADMIN_TOKEN`;
- APNs signing keys when separate Apple environments are available.

Durable Object schema changes require a reviewed Wrangler migration before deployment. The initial classes use SQLite-backed Durable Object storage.

## 3. Configure relay secrets

From `apps/remote-relay`, configure these as Wrangler secrets:

```sh
bunx wrangler secret put APNS_TEAM_ID
bunx wrangler secret put APNS_KEY_ID
bunx wrangler secret put APNS_BUNDLE_ID
bunx wrangler secret put APNS_PRIVATE_KEY
bunx wrangler secret put RELAY_ADMIN_TOKEN
```

Values:

- `APNS_TEAM_ID`: Apple Developer team ID.
- `APNS_KEY_ID`: identifier for the APNs token key.
- `APNS_BUNDLE_ID`: `app.djl.ios` for the production DJL iOS target.
- `APNS_PRIVATE_KEY`: complete PKCS#8 `.p8` contents, including header and footer.
- `RELAY_ADMIN_TOKEN`: at least 32 random bytes, encoded without whitespace. Store it only in the deployment secret manager.

The computer's per-session host and notification secrets are generated locally. Do not configure or store those as deployment secrets.

## 4. Deploy and validate the relay

```sh
bun run --cwd apps/remote-relay deploy
```

Map the production hostname, then verify:

```sh
curl --fail --silent --show-error https://remote.example.com/health
```

Expected response:

```json
{ "ok": true, "service": "djl-remote-relay" }
```

Also verify that `wss://remote.example.com/relay` completes a WebSocket upgrade only with a valid route and that security headers include `cache-control: no-store`. Do not use real task content for deployment smoke tests.

## 5. Configure desktop releases

Create the GitHub Actions repository variable:

```text
DJL_REMOTE_RELAY_URL=wss://remote.example.com/relay
```

The desktop release preflight rejects a missing URL, credentials, query parameters, fragments, non-TLS WebSockets, or a path other than `/relay`. The artifact builder embeds the validated endpoint as package metadata; users do not enter a server URL.

Keep the existing platform-signing secrets configured for public releases. A build can be unsigned when optional signing credentials are absent, but public production distribution should use notarized macOS artifacts and signed Windows artifacts.

## 6. Configure and ship the iOS app

1. Enable Push Notifications for `app.djl.ios` in the Apple Developer portal.
2. Create matching development and distribution provisioning profiles.
3. Confirm the DJL target's Push Notifications entitlement and Face ID usage description.
4. Run the focused remote tests and a Release build:

```sh
xcodebuild \
  -project apps/ios/DJL.xcodeproj \
  -scheme DJL \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:DJLTests/DJLAppLockPolicyTests \
  -only-testing:DJLTests/CodexPushNotificationRegistrationTests \
  -only-testing:DJLTests/CodexSecurePairingStateTests \
  -only-testing:DJLTests/CodexTrustedMacSelectionTests \
  -only-testing:DJLTests/ContentViewModelReconnectTests \
  test
```

5. Archive with the distribution team, validate in App Store Connect, and test through TestFlight against staging before promoting the production build.
6. Verify both APNs sandbox delivery for development builds and production APNs delivery for TestFlight/App Store builds.

The CI simulator lane does not replace an archive/signing check because hosted CI has no production signing identity by default.

## 7. End-to-end acceptance check

Use a fresh desktop user-data directory and a test iPhone:

1. Install a release artifact and confirm Remote reaches **Ready** without entering configuration.
2. Scan the QR, approve device-owner authentication, and verify the computer fingerprint on the phone.
3. Start a harmless task, background the phone, and confirm a generic completion notification arrives without response text.
4. Switch the phone between Wi-Fi and cellular and verify trusted reconnect without rescanning.
5. Restart DJL and verify trusted session resolution.
6. Reset the trusted phone on the desktop and confirm the old phone cannot reconnect.
7. Pair a second phone and confirm it replaces the first trusted identity.
8. Confirm the relay logs contain no prompt, response, file, terminal, image, or voice plaintext.

## Operations

### Health and alerting

Monitor `/health`, Worker exceptions, Durable Object errors, WebSocket close-code rates, APNs rejection reasons, and unusual rate-limit volume. Log session IDs only in a truncated or one-way-hashed form. Never log authorization headers, full QR payloads, device tokens, or encrypted frames.

### Revoke one active session

```sh
curl --fail --request POST \
  --header "Authorization: Bearer $RELAY_ADMIN_TOKEN" \
  "https://remote.example.com/v1/sessions/SESSION_ID/revoke"
```

Resolve and validate the exact session ID before running this command. Revocation is intentionally destructive: it closes both sockets and the user must pair again.

### Rotate APNs credentials

Upload the new `APNS_KEY_ID` and `APNS_PRIVATE_KEY`, deploy, verify sandbox and production pushes, then revoke the old Apple key. The relay creates short-lived provider tokens, so no client update is required.

### Rotate the relay administrator token

Generate and upload the replacement, deploy, update the operations secret manager, verify an authorized revoke against staging, and delete the old credential from every operator environment.

### Rollback

Use Cloudflare version rollback for Worker code. Do not roll Durable Object storage backward across an incompatible schema migration. If a cryptographic or authentication defect is suspected, disable the relay route or Remote release distribution first, revoke affected sessions, then ship a fixed protocol version and require re-pairing where identity or key integrity could be affected.

using Workerd = import "/workerd/workerd.capnp";

const relay :Workerd.Config = (
  services = [
    (name = "relay", worker = (
      modules = [(name = "relay.js", esModule = embed "../dist/index.js")],
      compatibilityDate = "2026-07-14",
      compatibilityFlags = ["nodejs_compat"],
      durableObjectNamespaces = [
        (className = "DJLRelaySession", uniqueKey = "djl-vps-relay-sessions-v1", enableSql = true),
        (className = "DJLRelayRegistry", uniqueKey = "djl-vps-relay-registry-v1", enableSql = true)
      ],
      durableObjectStorage = (localDisk = "state"),
      bindings = [
        (name = "SESSIONS", durableObjectNamespace = (className = "DJLRelaySession")),
        (name = "REGISTRY", durableObjectNamespace = (className = "DJLRelayRegistry")),
        (name = "RELAY_ADMIN_TOKEN", fromEnvironment = "RELAY_ADMIN_TOKEN"),
        (name = "APNS_TEAM_ID", fromEnvironment = "APNS_TEAM_ID"),
        (name = "APNS_KEY_ID", fromEnvironment = "APNS_KEY_ID"),
        (name = "APNS_BUNDLE_ID", fromEnvironment = "APNS_BUNDLE_ID"),
        (name = "APNS_PRIVATE_KEY", fromEnvironment = "APNS_PRIVATE_KEY")
      ]
    )),
    (name = "state", disk = (path = "/data", writable = true))
  ],
  sockets = [(name = "http", address = "127.0.0.1:8789", http = (), service = "relay")]
);

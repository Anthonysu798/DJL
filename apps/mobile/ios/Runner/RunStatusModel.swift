import Foundation
import CoreFoundation

// Local protocol v1. Raw channel dictionaries are never retained or persisted.
enum RunStatusError: Error { case invalid }

struct RunStatusIdentity: Equatable {
    let instance: String
    let epoch: Int64
    static func decode(_ raw: [String: Any]) throws -> Self {
        guard RunStatusDecode.integer(raw["schemaVersion"]) == 1,
              let epoch = RunStatusDecode.integer(raw["epoch"]), epoch >= 0,
              let instance = raw["instance"] as? String,
              UUID(uuidString: instance) != nil, instance.count == 36 else { throw RunStatusError.invalid }
        return Self(instance: instance.lowercased(), epoch: epoch)
    }
}

// An end is the only operation allowed to adopt a new instance. Retired instance
// IDs are random, nonsemantic and memory-only. Epochs are per instance, never global.
struct RunStatusGate {
    private var active: RunStatusIdentity?
    private var retired = Set<String>()
    private var revision: UInt64 = 0
    mutating func end(_ identity: RunStatusIdentity) -> UInt64? {
        guard !retired.contains(identity.instance) else { return nil }
        if let active {
            if active.instance == identity.instance {
                guard identity.epoch >= active.epoch else { return nil }
            } else { retired.insert(active.instance) }
        }
        active = identity; revision &+= 1
        return revision
    }
    mutating func update(_ identity: RunStatusIdentity) -> UInt64? {
        guard let active, active.instance == identity.instance, identity.epoch >= active.epoch else { return nil }
        self.active = identity; revision &+= 1
        return revision
    }
    mutating func invalidate() { revision &+= 1 }
    func current(_ token: UInt64) -> Bool { token == revision }
}

struct RunStatusRow: Codable, Hashable {
    var state: String
    let startedAt: Int64
    let staleAt: Int64
    let expiresAt: Int64
    let threadId: String?
    let title: String?
    let detail: String?
    let url: String?
}

struct RunStatusSnapshot {
    let identity: RunStatusIdentity
    let detailed: Bool
    let running: [RunStatusRow]
    let failed: [RunStatusRow]
    let ready: [RunStatusRow]
    var rows: [RunStatusRow] { Array((running + failed + ready).prefix(3)) }
    var deadline: Int64? { (running + failed + ready).flatMap { [$0.staleAt, $0.expiresAt] }.min() }

    func projected(at now: Int64) -> Self {
        func live(_ rows: [RunStatusRow]) -> [RunStatusRow] {
            rows.filter { $0.expiresAt > now }.map { row in
                var row = row
                if ["running", "finishing"].contains(row.state), row.staleAt <= now { row.state = "paused" }
                return row
            }
        }
        // Past stale dates are no longer future deadlines. Paused entries still
        // expire at their hard cap; consumers use nextDeadline(after:).
        return Self(identity: identity, detailed: detailed, running: live(running), failed: live(failed), ready: live(ready))
    }
    func nextDeadline(after now: Int64) -> Int64? {
        (running + failed + ready).flatMap { [$0.staleAt, $0.expiresAt] }.filter { $0 > now }.min()
    }
    static func decode(_ raw: [String: Any], now: Int64) throws -> Self {
        try RunStatusDecode.keys(raw, required: ["schemaVersion", "epoch", "instance", "detailed", "counts", "buckets", "action"], optional: ["nextDeadline"])
        let identity = try RunStatusIdentity.decode(raw)
        guard let detailed = RunStatusDecode.boolean(raw["detailed"]), raw["action"] as? String == "openApp",
              let counts = raw["counts"] as? [String: Any], let buckets = raw["buckets"] as? [String: Any] else { throw RunStatusError.invalid }
        try RunStatusDecode.keys(counts, required: ["running", "failed", "ready"])
        try RunStatusDecode.keys(buckets, required: ["running", "failed", "ready"])
        var decoded: [String: [RunStatusRow]] = [:]
        for bucket in ["running", "failed", "ready"] {
            guard let source = buckets[bucket] as? [[String: Any]], source.count <= 3,
                  RunStatusDecode.integer(counts[bucket]) == Int64(source.count) else { throw RunStatusError.invalid }
            decoded[bucket] = try source.map { try RunStatusDecode.row($0, bucket: bucket, detailed: detailed, now: now) }
        }
        if raw["nextDeadline"] != nil {
            guard let deadline = RunStatusDecode.integer(raw["nextDeadline"]), deadline > 0, deadline <= now + 14_400_000 else { throw RunStatusError.invalid }
        }
        let snapshot = Self(identity: identity, detailed: detailed, running: decoded["running"]!, failed: decoded["failed"]!, ready: decoded["ready"]!)
        return snapshot.projected(at: now)
    }
}

private enum RunStatusDecode {
    static func keys(_ raw: [String: Any], required: Set<String>, optional: Set<String> = []) throws {
        let actual = Set(raw.keys)
        guard required.isSubset(of: actual), actual.isSubset(of: required.union(optional)) else { throw RunStatusError.invalid }
    }
    static func integer(_ raw: Any?) -> Int64? {
        guard let n = raw as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(),
              ["q", "i", "s", "l", "Q", "I", "S", "L"].contains(String(cString: n.objCType)),
              n.doubleValue >= 0, n.doubleValue <= 9_007_199_254_740_991 else { return nil }
        return n.int64Value
    }
    static func boolean(_ raw: Any?) -> Bool? {
        guard let n = raw as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return nil }
        return n.boolValue
    }
    static func text(_ raw: Any?, max: Int, id: Bool = false, basename: Bool = false) -> String? {
        guard let text = raw as? String, text.unicodeScalars.count <= max,
              !text.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }),
              text == text.trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
        if (id || basename) && text.contains(where: { "/\\".contains($0) }) { return nil }
        if id && (text.isEmpty || text.contains(where: { "?#".contains($0) })) { return nil }
        return text
    }
    private static func encoded(_ value: String, path: Bool) -> String {
        let safe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~" + (path ? "!$&'()*+,;=:@" : "")
        return value.utf8.map { byte in
            if safe.utf8.contains(byte) { return String(UnicodeScalar(byte)) }
            if !path && byte == 32 { return "+" }
            return String(format: "%%%02X", byte)
        }.joined()
    }
    static func qualifiedURL(_ raw: Any?, thread: String) -> String? {
        guard let value = raw as? String, value.utf8.count <= 2048,
              let c = URLComponents(string: value), c.string == value,
              c.scheme == "djl", c.host == "thread", c.user == nil, c.password == nil, c.port == nil, c.fragment == nil,
              c.percentEncodedPath.hasPrefix("/"),
              let path = String(c.percentEncodedPath.dropFirst()).removingPercentEncoding, path == thread,
              let query = c.percentEncodedQuery else { return nil }
        let fields = query.split(separator: "&", omittingEmptySubsequences: false)
        guard fields.count == 2 else { return nil }
        let mac = fields[0].split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
        let key = fields[1].split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
        guard mac.count == 2, mac[0] == "macId", key.count == 2, key[0] == "macKeySha256",
              let macID = String(mac[1]).replacingOccurrences(of: "+", with: " ").removingPercentEncoding,
              text(macID, max: 256, id: true) != nil,
              key[1].count == 64, key[1].allSatisfy({ "0123456789abcdef".contains($0) }) else { return nil }
        let canonical = "djl://thread/" + encoded(thread, path: true) + "?macId=" + encoded(macID, path: false) + "&macKeySha256=" + String(key[1])
        return canonical == value ? value : nil
    }
    static func row(_ raw: [String: Any], bucket: String, detailed: Bool, now: Int64) throws -> RunStatusRow {
        let privateKeys: Set<String> = ["threadId", "title", "detail", "url"]
        let hasDetail = !privateKeys.isDisjoint(with: raw.keys)
        try keys(raw, required: ["state", "startedAt", "staleAt", "expiresAt"], optional: detailed ? privateKeys : [])
        guard let state = raw["state"] as? String,
              (bucket == "running" ? ["running", "finishing", "paused"].contains(state) : state == bucket),
              let start = integer(raw["startedAt"]), let stale = integer(raw["staleAt"]), let expiry = integer(raw["expiresAt"]),
              start > 0, start <= now, stale >= start, expiry > start, expiry <= start + (bucket == "running" ? 14_400_000 : bucket == "failed" ? 900_000 : 300_000),
              stale <= now + 14_400_000 else { throw RunStatusError.invalid }
        var thread: String?, title: String?, detail: String?, url: String?
        if hasDetail {
            guard let t = text(raw["threadId"], max: 256, id: true), let ti = text(raw["title"], max: 120),
                  let d = text(raw["detail"], max: 80, basename: true), let u = qualifiedURL(raw["url"], thread: t) else { throw RunStatusError.invalid }
            thread = t; title = ti; detail = d; url = u
        }
        return RunStatusRow(state: state, startedAt: start, staleAt: stale, expiresAt: expiry, threadId: thread, title: title, detail: detail, url: url)
    }
}

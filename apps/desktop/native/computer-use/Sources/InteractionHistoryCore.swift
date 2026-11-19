import Foundation
import CoreFoundation

struct HistoryInvalid: Error {}
struct HistorySettings {
    let enabled: Bool, paused: Bool, interaction: Bool
    let includedApps: [String], excludedApps: [String], includedDomains: [String], excludedDomains: [String]
    var observing: Bool { enabled && !paused && interaction }
    init(_ value: [String: Any]) throws {
        let allowed = Set(["enabled", "paused", "interactionCaptureEnabled", "semanticSummariesEnabled", "retentionDays", "intervalSeconds", "includedBundleIds", "excludedBundleIds", "includedDomains", "excludedDomains"])
        guard Set(value.keys).isSubset(of: allowed) else { throw HistoryInvalid() }
        func boolean(_ name: String, optional: Bool = false) throws -> Bool {
            if optional && value[name] == nil { return false }
            guard let number = value[name] as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { throw HistoryInvalid() }
            return number.boolValue
        }
        func integer(_ name: String, _ low: Double, _ high: Double) throws {
            guard let number = value[name] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                  number.doubleValue.isFinite, number.doubleValue.rounded() == number.doubleValue,
                  number.doubleValue >= low, number.doubleValue <= high else { throw HistoryInvalid() }
        }
        func list(_ name: String, optional: Bool = false) throws -> [String] {
            if optional && value[name] == nil { return [] }
            guard let strings = value[name] as? [String], strings.count <= 100 else { throw HistoryInvalid() }
            let domain = name.contains("Domains")
            let normalized = strings.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            guard normalized.allSatisfy({ !$0.isEmpty && $0.utf16.count <= (domain ? 253 : 256) }) else { throw HistoryInvalid() }
            if domain {
                let pattern = "^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.?$"
                guard normalized.allSatisfy({ $0.range(of: pattern, options: .regularExpression) != nil }) else { throw HistoryInvalid() }
            }
            return normalized
        }
        enabled = try boolean("enabled"); paused = try boolean("paused")
        interaction = try boolean("interactionCaptureEnabled", optional: true)
        _ = try boolean("semanticSummariesEnabled", optional: true)
        try integer("retentionDays", 1, 365); try integer("intervalSeconds", 5, 3600)
        includedApps = try list("includedBundleIds", optional: true); excludedApps = try list("excludedBundleIds")
        includedDomains = try list("includedDomains", optional: true); excludedDomains = try list("excludedDomains")
    }
    func permitsBundle(_ id: String, ownBundle: String?, parentBundle: String?) -> Bool {
        let bundle = id.lowercased()
        let sensitive = ["com.apple.loginwindow", "com.apple.securityagent", "com.apple.keychainaccess", "com.apple.systempreferences", "com.apple.passwords", "com.djl.computer-use"]
        return !bundle.isEmpty && bundle.utf16.count <= 256 && !sensitive.contains(bundle) &&
            !["1password", "onepassword", "bitwarden", "lastpass", "dashlane", "keepass"].contains(where: bundle.contains) &&
            bundle != ownBundle?.lowercased() && bundle != parentBundle?.lowercased() &&
            !excludedApps.contains(bundle) && (includedApps.isEmpty || includedApps.contains(bundle))
    }
    static func domainMatches(_ domain: String, _ rule: String) -> Bool {
        let normalized = rule.hasSuffix(".") ? String(rule.dropLast()) : rule
        return domain == normalized || domain.hasSuffix("." + normalized)
    }
    func permitsWeb(web: Bool, privateState: Bool?, domains: [String], complete: Bool) -> Bool {
        guard complete, privateState != true, !web || privateState == false else { return false }
        if domains.contains(where: { host in excludedDomains.contains { Self.domainMatches(host, $0) } }) { return false }
        if !includedDomains.isEmpty && (domains.isEmpty || domains.contains(where: { host in !includedDomains.contains { Self.domainMatches(host, $0) } })) { return false }
        return !(web && domains.isEmpty && !excludedDomains.isEmpty)
    }
}
final class HistoryLease {
    let epoch: String, settings: HistorySettings
    private let lock = NSLock()
    private var active = true
    init(epoch: String, settings: HistorySettings) { self.epoch = epoch; self.settings = settings }
    var valid: Bool { lock.withLock { active && settings.observing } }
    func revoke() { lock.withLock { active = false } }
}
enum HistorySecurity {
    static func permitsWindowTitle(_ title: String?) -> Bool {
        guard let title = title, title.utf16.count <= 4096 else { return false }
        return !["incognito", "inprivate", "private browsing", "private window", "隐私浏览", "无痕"].contains(where: title.lowercased().contains)
    }
    static let ordinaryRoles: Set<String> = ["AXApplication", "AXWindow", "AXGroup", "AXScrollArea", "AXSplitGroup", "AXTabGroup", "AXWebArea",
        "AXTextField", "AXTextArea", "AXComboBox", "AXSearchField", "AXStaticText", "AXButton", "AXCheckBox", "AXRadioButton",
        "AXRadioGroup", "AXPopUpButton", "AXMenuButton", "AXMenu", "AXMenuItem", "AXMenuBar", "AXMenuBarItem", "AXToolbar",
        "AXList", "AXTable", "AXRow", "AXColumn", "AXCell", "AXOutline", "AXImage", "AXLink", "AXSlider", "AXScrollBar",
        "AXSplitter", "AXProgressIndicator", "AXValueIndicator", "AXDisclosureTriangle", "AXIncrementor", "AXTab", "AXHeading"]
    static let textRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"]
    static func permitsLabels(role: String, labels: [String], descriptionFailed: Bool, associationKnown: Bool) -> Bool {
        guard ordinaryRoles.contains(role), associationKnown, !credentialLabel(labels) else { return false }
        return !descriptionFailed || (textRoles.contains(role) && labels.contains { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
    }
    static func safe(role: String?, subrole: String?, protected: Bool?) -> Bool {
        guard let role = role, ordinaryRoles.contains(role), let subrole = subrole, let protected = protected else { return false }
        return !protected && !role.localizedCaseInsensitiveContains("secure") && !subrole.localizedCaseInsensitiveContains("secure") &&
            !role.localizedCaseInsensitiveContains("password") && !subrole.localizedCaseInsensitiveContains("password")
    }
    static func credentialLabel(_ labels: [String]) -> Bool {
        let pattern = #"(?i)password|passwd|passcode|api[ _.-]*key|access[ _.-]*token|refresh[ _.-]*token|secret|token|authorization|private[ _.-]*key|recovery[ _.-]*phrase|seed[ _.-]*phrase|user[ _.-]*name|login[ _.-]*name"#
        return labels.contains { $0.utf16.count > 4096 || $0.range(of: pattern, options: .regularExpression) != nil }
    }
    static func read<T>(lease: HistoryLease, systemSecure: Bool?, owned: Bool, safePath: Bool, labels: [String] = [], privacyAuthorized: Bool = true, body: () -> T?) -> T? {
        guard lease.valid, systemSecure == false, owned, safePath, privacyAuthorized, !credentialLabel(labels) else { return nil }
        let result = body()
        return lease.valid ? result : nil
    }
}
enum HistoryText {
    private static let patterns = [
        (#"\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b"#, "[redacted]"),
        (#"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"#, "[redacted]"),
        (#"(?i)\bBearer\s+[A-Za-z0-9._~+/\-]{12,}=*"#, "Bearer [redacted]"),
        (#"(?i)\b(password|passwd|api[_-]?key|secret|(?:access|refresh)[_-]?token)\s*[:=]\s*[\"']?[^\s\"',;]+[\"']?"#, "$1=[redacted]")
    ]
    static func clean(_ value: String, limit: Int) -> String? {
        guard value.utf16.count <= limit else { return nil }
        var text = value
        for (pattern, replacement) in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
            text = regex.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: replacement)
        }
        let regex = try! NSRegularExpression(pattern: #"\b(?:\d[ -]?){12,18}\d\b"#)
        for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).reversed() {
            guard let range = Range(match.range, in: text) else { continue }
            let digits = text[range].compactMap(\.wholeNumberValue)
            let sum = digits.reversed().enumerated().reduce(0) { sum, item in
                let value = item.offset % 2 == 1 ? item.element * 2 : item.element
                return sum + (value > 9 ? value - 9 : value)
            }
            if sum % 10 == 0 { text.replaceSubrange(range, with: "[redacted]") }
        }
        while text.utf16.count > limit { text.removeLast() }
        return text
    }
    static func range(location: Int, length: Int) -> [String: Int]? {
        guard location >= 0, length >= 0, location <= 1_000_000, length <= 1_000_000 - location else { return nil }
        return ["location": location, "length": length]
    }
}
// Capture-lane only. A pending write can never restore a baseline invalidated by later loss.
final class HistoryContinuity {
    struct Frame {
        let id = UUID()
        let revision: UInt64, lines: [String], mode: String, text: String
    }
    private var baseline: [String]?, pending: UUID?
    private var revision: UInt64 = 0
    func lost() { revision &+= 1; baseline = nil }
    func prepare(_ lines: [String]) -> Frame? {
        guard pending == nil else { return nil }
        let mode: String, text: String
        if let previous = baseline {
            let old = Set(previous), new = Set(lines)
            let changes = previous.filter { !new.contains($0) }.map { "- " + $0 } + lines.filter { !old.contains($0) }.map { "+ " + $0 }
            guard !changes.isEmpty else { return nil }
            let diff = changes.joined(separator: "\n")
            if diff.utf16.count <= 16_384 { mode = "diff"; text = diff }
            else { mode = "full"; text = lines.joined(separator: "\n") }
        } else { mode = "full"; text = lines.joined(separator: "\n") }
        guard text.utf16.count <= 16_384 else { lost(); return nil }
        let frame = Frame(revision: revision, lines: lines, mode: mode, text: text)
        pending = frame.id; return frame
    }
    func written(_ frame: Frame) {
        guard pending == frame.id else { return }
        pending = nil
        if revision == frame.revision { baseline = frame.lines }
    }
    func rejected(_ frame: Frame) { if pending == frame.id { pending = nil }; lost() }
}

// Event destination is independent of mouse-under-pointer fields, which are zero on real key/scroll packets.
enum HistoryInputIdentity {
    static func freshSample(age: TimeInterval) -> Bool { age >= 0 && age < 1 }
    static func window(target: Int64, underPointer: Int64, handling: Int64) -> UInt32? {
        let values = [target, underPointer, handling].filter { $0 != 0 }
        guard let first = values.first, first > 0, first <= Int64(UInt32.max), values.allSatisfy({ $0 == first }) else { return nil }
        return UInt32(first)
    }
    static func keyInInterval(key: TimeInterval?, previousRead: TimeInterval?, currentRead: TimeInterval) -> Bool {
        guard let key = key, let previous = previousRead else { return false }
        return key > previous && key <= currentRead && currentRead - key <= 1
    }
}

// Previous observation is used only to name a factual transition, never to authorize a read.
final class HistoryTransitions {
    private var previous: (String, UInt32)?
    func observed(process: String, window: UInt32) -> String? {
        defer { previous = (process, window) }
        guard let previous = previous else { return "session-start" }
        if previous.0 != process { return "app-changed" }
        return previous.1 != window ? "window-changed" : nil
    }
}

// A single trailing flush publishes the last count even when a burst has ended.
// Caller serializes this state; time is monotonic and supplied for deterministic tests.
struct HistoryLossFlush {
    private var lastPublished: TimeInterval
    private var pending: TimeInterval?
    private var active = true
    init(lastPublished: TimeInterval) { self.lastPublished = lastPublished }
    mutating func request(now: TimeInterval) -> TimeInterval? {
        guard active, pending == nil else { return nil }
        let deadline = max(now, lastPublished + 1)
        pending = deadline; return deadline
    }
    mutating func take(now: TimeInterval, authorized: Bool) -> Bool {
        guard active, let deadline = pending else { return false }
        guard authorized else { pending = nil; return false }
        guard now >= deadline else { return false }
        pending = nil; lastPublished = now; return true
    }
    mutating func cancel() { active = false; pending = nil }
}

// Exclusion is not trust: structural/privacy validation still runs for every nonsecure descendant.
enum HistoryLabelAssessment {
    case trusted([String], title: String? = nil)
    case excludedAssociation
    case denied
}
enum HistoryProjectionScope { case included, excluded, denied }
enum HistoryProjectionPolicy {
    static func scope(role: String, labels: HistoryLabelAssessment, ancestorExcluded: Bool) -> HistoryProjectionScope {
        guard HistorySecurity.ordinaryRoles.contains(role) else { return .denied }
        if ancestorExcluded { return .excluded }
        switch labels {
        case .trusted: return .included
        case .excludedAssociation: return HistorySecurity.textRoles.contains(role) ? .excluded : .denied
        case .denied: return .denied
        }
    }
}

enum HistoryAncestry {
    // This gate authorizes only classification of a verified static security label, never recorded content.
    static func permitsSecurityLabelAncestors<Node: Equatable>(_ nodes: [Node], origin: Node, ownMetadataAllowed: Bool, assessOther: (Node) throws -> Bool) rethrows -> Bool {
        for node in nodes {
            if node == origin { if !ownMetadataAllowed { return false } }
            else if try !assessOther(node) { return false }
        }
        return true
    }
    static func permitsRootToLeaf<Node>(_ nodes: [Node], assess: (Node) throws -> Bool) rethrows -> Bool {
        for node in nodes { if try !assess(node) { return false } }
        return true
    }
}
struct HistoryProofBudget<Key: Equatable> {
    private var remaining: Int
    private var active: [Key] = []
    init(limit: Int) { remaining = limit }
    mutating func enter(_ key: Key) -> Bool {
        guard remaining > 0, !active.contains(key) else { return false }
        remaining -= 1; active.append(key); return true
    }
    mutating func leave(_ key: Key) { if active.last == key { active.removeLast() } }
}

struct HistoryGestureState<Sample> {
    private var pending: (origin: Sample, button: Int64, dragged: Bool)?
    var isEmpty: Bool { pending == nil }
    mutating func begin(_ sample: Sample, button: Int64) { pending = (sample, button, false) }
    mutating func drag(button: Int64) { if pending?.button == button { pending?.dragged = true } }
    mutating func discard() { pending = nil }
    mutating func finish(button: Int64) -> (origin: Sample, dragged: Bool)? {
        guard let pending = pending, pending.button == button else { return nil }
        discard(); return (pending.origin, pending.dragged)
    }
}

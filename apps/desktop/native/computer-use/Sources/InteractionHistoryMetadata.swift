import Foundation
import ApplicationServices

// Fresh metadata only. Groups cannot request content or bypass ordered credential-label checks.
enum HistoryMetadata {
    enum Group {
        case structural, privacy
        var names: [String] {
            switch self {
            case .structural: return [kAXRoleAttribute, kAXSubroleAttribute, "AXProtectedContent"]
            case .privacy: return ["AXPrivateBrowsing", "AXIncognito", "AXIsPrivate", "AXInPrivate"]
            }
        }
    }
    typealias Result = (AXError, CFTypeRef?)
    private static func accepted(_ result: Result, group: Group, index: Int) -> Bool {
        if result.0 == .attributeUnsupported || result.0 == .noValue { return result.1 == nil && (group != .structural || index != 0) }
        guard result.0 == .success, let value = result.1 else { return false }
        if group == .structural && index < 2 { return CFGetTypeID(value) == CFStringGetTypeID() }
        return CFGetTypeID(value) == CFBooleanGetTypeID()
    }
    static func read(_ group: Group, current: () -> Bool,
                     bulk: ([String]) -> (AXError, CFArray?), scalar: (String) -> Result) -> [Result]? {
        let names = group.names
        guard current() else { return nil }
        let (error, raw) = bulk(names)
        guard current() else { return nil }
        func fallback(_ index: Int) -> Result? {
            guard current() else { return nil }
            let result = scalar(names[index])
            guard current(), accepted(result, group: group, index: index) else { return nil }
            return result
        }
        var results: [Result] = []
        if error == .notImplemented {
            for index in names.indices {
                guard let result = fallback(index) else { return nil }
                results.append(result)
            }
            return results
        }
        guard error == .success, let raw = raw, CFGetTypeID(raw) == CFArrayGetTypeID(), CFArrayGetCount(raw) == names.count else { return nil }
        for (index, value) in (raw as [AnyObject]).enumerated() {
            let result: Result
            if CFGetTypeID(value) == CFNullGetTypeID() {
                guard let resolved = fallback(index) else { return nil }
                result = resolved
            } else if CFGetTypeID(value) == AXValueGetTypeID() {
                let wrapped = unsafeBitCast(value, to: AXValue.self)
                var slotError = AXError.failure
                guard AXValueGetType(wrapped) == .axError, AXValueGetValue(wrapped, .axError, &slotError), slotError != .success else { return nil }
                result = (slotError, nil)
            } else { result = (.success, value) }
            guard accepted(result, group: group, index: index) else { return nil }
            results.append(result)
        }
        return results
    }
}

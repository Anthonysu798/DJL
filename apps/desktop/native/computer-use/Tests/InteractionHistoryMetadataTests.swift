import Foundation
import ApplicationServices

@main struct InteractionHistoryMetadataTests {
    static var count = 0
    static func check(_ condition: Bool, _ name: String) { guard condition else { fatalError("FAIL: \(name)") }; count += 1 }
    static func error(_ error: AXError) -> AXValue { var value = error; return AXValueCreate(.axError, &value)! }
    static func main() {
        let unsupported = error(.attributeUnsupported), absent = error(.noValue)
        let ordinary: [AnyObject] = ["AXTextField" as NSString, unsupported, kCFBooleanFalse!]
        let native: [AnyObject] = [unsupported, absent, unsupported, absent]
        var bulkCalls = 0, scalarCalls = 0
        func run(_ group: HistoryMetadata.Group, _ values: [AnyObject], overall: AXError = .success,
                 current: () -> Bool = { true }, scalar: (String) -> HistoryMetadata.Result = { _ in (.attributeUnsupported, nil) }) -> [HistoryMetadata.Result]? {
            HistoryMetadata.read(group, current: current, bulk: { names in
                bulkCalls += 1
                check(names == (group == .structural ? ["AXRole", "AXSubrole", "AXProtectedContent"] : ["AXPrivateBrowsing", "AXIncognito", "AXIsPrivate", "AXInPrivate"]), "fixed metadata group")
                check(Set(names).isDisjoint(with: ["AXValue", "AXSelectedText", "AXSelectedTextRange", "AXDescription", "AXHelp"]), "no content or ordered credential labels prefetched")
                return (overall, values as CFArray)
            }, scalar: { name in scalarCalls += 1; return scalar(name) })
        }
        let good = run(.structural, ordinary)
        check(good?.count == 3 && good?[0].1 as? String == "AXTextField" && good?[1].0 == .attributeUnsupported, "ordinary tuple retains per-slot error")
        check(bulkCalls == 1 && scalarCalls == 0, "ordinary tuple is one batch and no scalar reads")
        let privateUnknown = run(.privacy, native)
        check(privateUnknown?.map { $0.0 } == [.attributeUnsupported, .noValue, .attributeUnsupported, .noValue], "unsupported does not become explicit false")
        let protected = run(.structural, ["AXTextField" as NSString, unsupported, kCFBooleanTrue!])
        check((protected?[2].1 as? NSNumber)?.boolValue == true, "protected true retained for denial")
        let privateTrue = run(.privacy, [kCFBooleanTrue!, kCFBooleanFalse!, unsupported, absent])
        check((privateTrue?[0].1 as? NSNumber)?.boolValue == true, "private true retained for denial")
        for values in [[AnyObject](), Array(ordinary.prefix(2)), ordinary + [unsupported]] {
            check(run(.structural, values) == nil, "exact cardinality rejects short or extra arrays")
        }
        for values in [
            [unsupported, unsupported, kCFBooleanFalse!],
            [NSNumber(value: 1), unsupported, kCFBooleanFalse!],
            ["AXTextField" as NSString, NSNumber(value: 1), kCFBooleanFalse!],
            ["AXTextField" as NSString, unsupported, NSNumber(value: 1)],
            ["AXTextField" as NSString, error(.failure), kCFBooleanFalse!],
            ["AXTextField" as NSString, error(.success), kCFBooleanFalse!]
        ] as [[AnyObject]] { check(run(.structural, values) == nil, "required role/types/error payload fail closed") }
        var point = CGPoint.zero
        check(run(.privacy, [AXValueCreate(.cgPoint, &point)!, unsupported, unsupported, unsupported]) == nil, "non-error AXValue rejected")
        check(run(.privacy, [NSNumber(value: 0), unsupported, unsupported, unsupported]) == nil, "numeric zero not a private false boolean")
        check(run(.privacy, [error(.cannotComplete), unsupported, unsupported, unsupported]) == nil, "unknown private state rejected")
        let beforeNull = scalarCalls
        let resolved = run(.structural, ["AXTextField" as NSString, kCFNull!, kCFBooleanFalse!], scalar: { name in
            check(name == "AXSubrole", "only unknown slot reread"); return (.noValue, nil)
        })
        check(resolved?[1].0 == .noValue && scalarCalls == beforeNull + 1, "CFNull resolved once with explicit fresh error")
        check(run(.privacy, [kCFNull!, unsupported, unsupported, unsupported], scalar: { _ in (.success, nil) }) == nil, "missing scalar result not false")
        check(run(.privacy, [kCFNull!, unsupported, unsupported, unsupported], scalar: { _ in (.success, kCFNull!) }) == nil, "scalar CFNull remains unknown without recursive fallback")
        check(run(.privacy, [kCFNull!, unsupported, unsupported, unsupported], scalar: { _ in (.cannotComplete, nil) }) == nil, "unknown scalar fallback fails closed")
        check(run(.privacy, [kCFNull!, unsupported, unsupported, unsupported], scalar: { _ in (.attributeUnsupported, kCFBooleanTrue!) }) == nil, "error with conflicting scalar value is malformed, not false")
        let beforeFallback = scalarCalls
        let fallback = run(.structural, [], overall: .notImplemented, scalar: { name in
            name == "AXRole" ? (.success, "AXTextArea" as CFString) : (.attributeUnsupported, nil)
        })
        check(fallback?.count == 3 && scalarCalls == beforeFallback + 3, "only notImplemented falls back to fixed scalar group once")
        for code in [AXError.failure, .cannotComplete, .invalidUIElement, .attributeUnsupported] {
            let before = scalarCalls
            check(run(.structural, ordinary, overall: code) == nil && scalarCalls == before, "other overall failures never fall back")
        }
        var allowed = false
        let beforeDenied = bulkCalls
        check(run(.structural, ordinary, current: { allowed }) == nil && bulkCalls == beforeDenied, "revoked authority performs no batch")
        allowed = true
        let changed = HistoryMetadata.read(.structural, current: { allowed }, bulk: { _ in allowed = false; return (.success, ordinary as CFArray) }, scalar: { _ in fatalError("no fallback after revocation") })
        check(changed == nil, "post-batch authority change discards all metadata")
        var scalarAuthority = true, scalarReads = 0
        let changedScalar = HistoryMetadata.read(.privacy, current: { scalarAuthority }, bulk: { _ in (.success, [kCFNull!, unsupported, unsupported, unsupported] as CFArray) }, scalar: { _ in scalarReads += 1; scalarAuthority = false; return (.attributeUnsupported, nil) })
        check(changedScalar == nil && scalarReads == 1, "post-fallback authority change discards metadata")
        var guards = 0, fallbackReads = 0
        let deniedFallback = HistoryMetadata.read(.structural, current: { guards += 1; return guards < 3 }, bulk: { _ in (.notImplemented, nil) }, scalar: { _ in fallbackReads += 1; return (.success, "AXTextField" as CFString) })
        check(deniedFallback == nil && fallbackReads == 0, "fresh guard before fallback denies without scalar read")
        var deadline = 10
        let expired = HistoryMetadata.read(.structural, current: { deadline > 0 }, bulk: { _ in deadline = 0; return (.success, ordinary as CFArray) }, scalar: { _ in fatalError("expired batch") })
        check(expired == nil, "deadline expiry after bulk cannot authorize content")
        let nilArray = HistoryMetadata.read(.privacy, current: { true }, bulk: { _ in (.success, nil) }, scalar: { _ in fatalError("nil array") })
        check(nilArray == nil, "overall success without array denied")
        let wrongArray = unsafeBitCast("not an array" as CFString, to: CFArray.self)
        let wrongContainer = HistoryMetadata.read(.privacy, current: { true }, bulk: { _ in (.success, wrongArray) }, scalar: { _ in fatalError("wrong container") })
        check(wrongContainer == nil, "wrong CF container rejected before array access")
        var groupAuthority = true, groupScalars = 0
        let interruptedGroup = HistoryMetadata.read(.structural, current: { groupAuthority }, bulk: { _ in (.notImplemented, nil) }, scalar: { _ in groupScalars += 1; groupAuthority = false; return (.success, "AXTextField" as CFString) })
        check(interruptedGroup == nil && groupScalars == 1, "whole fallback stops before another scalar when authority changes")
        check(run(.privacy, [error(.notImplemented), unsupported, unsupported, unsupported]) == nil, "per-slot notImplemented never enables group fallback")
        print("InteractionHistoryMetadata: \(count) assertions passed")
    }
}

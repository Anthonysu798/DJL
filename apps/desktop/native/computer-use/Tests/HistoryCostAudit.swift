// Fixed temporary measurement data only: no AX objects, content or authority retained.
import Foundation
import ApplicationServices

enum HistoryCostLeaf: Int, CaseIterable {
    case guardWindow, structuralBatch, privacyBatch, childrenCount, childrenArray, pid, appReference, timeout
    case foreground, identity, secure, trust, session
    case role, subrole, protected, privateBrowsing, incognito, isPrivate, inPrivate
    case identifier, title, description, help, titleElement, parent, url, document, focusedWindow, focusedElement
    case position, size, windowNumber, value, selectedText, selectedRange, other
    static let names = ["guard-window", "batch-structural", "batch-privacy", "children-count", "children-array", "pid", "app-reference", "timeout", "foreground", "identity", "secure", "trust", "session", "AXRole", "AXSubrole", "AXProtectedContent", "AXPrivateBrowsing", "AXIncognito", "AXIsPrivate", "AXInPrivate", "AXIdentifier", "AXTitle", "AXDescription", "AXHelp", "AXTitleUIElement", "AXParent", "AXURL", "AXDocument", "AXFocusedWindow", "AXFocusedUIElement", "AXPosition", "AXSize", "AXWindowNumber", "AXValue", "AXSelectedText", "AXSelectedTextRange", "other"]
    static func attribute(_ name: String) -> Self {
        switch name {
        case "AXRole": return .role; case "AXSubrole": return .subrole; case "AXProtectedContent": return .protected
        case "AXPrivateBrowsing": return .privateBrowsing; case "AXIncognito": return .incognito; case "AXIsPrivate": return .isPrivate; case "AXInPrivate": return .inPrivate
        case "AXIdentifier": return .identifier; case "AXTitle": return .title; case "AXDescription": return .description; case "AXHelp": return .help; case "AXTitleUIElement": return .titleElement
        case "AXParent": return .parent; case "AXURL": return .url; case "AXDocument": return .document; case "AXFocusedWindow": return .focusedWindow; case "AXFocusedUIElement": return .focusedElement
        case "AXPosition": return .position; case "AXSize": return .size; case "AXWindowNumber": return .windowNumber; case "AXValue": return .value; case "AXSelectedText": return .selectedText; case "AXSelectedTextRange": return .selectedRange
        default: return .other
        }
    }
}
enum HistoryCostPhase: Int, CaseIterable {
    case discovery, binding, scan, initialProofs, classification, postPreflightOwned, titlePrivacy, drain, ordinary, projection, final, navigation
    static let names = ["discovery", "binding", "scan", "initial-proofs", "classification", "post-preflight-owned", "title-privacy", "drain", "ordinary", "projection", "final", "navigation"]
}
enum HistoryCostMethod: Int, CaseIterable {
    case valid, owned, policy, ancestry, labels
    static let names = ["valid", "owned", "currentPolicy", "structuralAncestry", "collectLabels"]
}
enum HistoryCostPurpose: String { case ownership, attach, capture }
enum HistoryCostResult: String { case returned, preflightDenied, ownedDenied, genericError, recovery, titlePrivacyDenied, finalCompositeNoFrame, submitted, navigation }
struct HistoryCostStat {
    var count: UInt64 = 0, sum: UInt64 = 0, max: UInt64 = 0
    var success: UInt64 = 0, failure: UInt64 = 0, unsupported: UInt64 = 0, noValue: UInt64 = 0, cannotComplete: UInt64 = 0, invalid: UInt64 = 0, notImplemented: UInt64 = 0, other: UInt64 = 0
    mutating func add(_ ns: UInt64, error: AXError? = nil) {
        count += 1; sum += ns; max = Swift.max(max, ns)
        guard let error = error else { return }
        switch error {
        case .success: success += 1; case .failure: failure += 1; case .attributeUnsupported: unsupported += 1; case .noValue: noValue += 1
        case .cannotComplete: cannotComplete += 1; case .invalidUIElement: invalid += 1; case .notImplemented: notImplemented += 1; default: other += 1
        }
    }
    var object: [String: Any] { ["count": count, "sumNs": sum, "maxNs": max, "errors": [success,failure,unsupported,noValue,cannotComplete,invalid,notImplemented,other]] }
}
final class HistoryCostReader {
    let id = HistoryCostOutput.created()
    var start: UInt64 = 0, deadline: UInt64 = 0
    var purpose = HistoryCostPurpose.capture, result = HistoryCostResult.returned
    private var leaves = [HistoryCostStat](repeating: HistoryCostStat(), count: HistoryCostLeaf.allCases.count)
    private var methods = [HistoryCostStat](repeating: HistoryCostStat(), count: HistoryCostMethod.allCases.count)
    private var phases = [UInt64](repeating: 0, count: HistoryCostPhase.allCases.count)
    private var fallbacks = [UInt64](repeating: 0, count: 14) // structural3/private4 x CFNull/notImplemented
    private var slotErrors = [HistoryCostStat](repeating: HistoryCostStat(), count: 7)
    private var phaseValue = HistoryCostPhase.discovery, phaseStart: UInt64 = 0
    private var lastLeaf = HistoryCostLeaf.other, lastEntry: UInt64 = 0, lastExit: UInt64 = 0
    var preflightStart: UInt64 = 0, preflightEnd: UInt64 = 0, preflightReturned = false, drained = false, descriptionNativePaths: UInt64 = 0
    func bind(_ deadline: UInt64) { self.deadline = deadline; start = deadline - 750_000_000; phaseStart = start }
    func phase(_ value: HistoryCostPhase) {
        let now = DispatchTime.now().uptimeNanoseconds
        phases[phaseValue.rawValue] += now - phaseStart; phaseValue = value; phaseStart = now
    }
    private func record(_ leaf: HistoryCostLeaf, start: UInt64, error: AXError? = nil) {
        let end = DispatchTime.now().uptimeNanoseconds
        leaves[leaf.rawValue].add(end - start, error: error); lastLeaf = leaf; lastEntry = start; lastExit = end
    }
    @discardableResult @inline(__always) func ax(_ leaf: HistoryCostLeaf, _ operation: () -> AXError) -> AXError {
        let start = DispatchTime.now().uptimeNanoseconds
        let value = operation(); record(leaf, start: start, error: value); return value
    }
    @inline(__always) func measure<T>(_ leaf: HistoryCostLeaf, _ operation: () throws -> T) rethrows -> T {
        let start = DispatchTime.now().uptimeNanoseconds
        defer { record(leaf, start: start) }
        return try operation()
    }
    func inclusive(_ method: HistoryCostMethod, from start: UInt64) { methods[method.rawValue].add(DispatchTime.now().uptimeNanoseconds - start) }
    func fallback(_ group: HistoryMetadata.Group, name: String, notImplemented: Bool) {
        let slot: Int
        switch (group, HistoryCostLeaf.attribute(name)) {
        case (.structural, .role): slot = 0; case (.structural, .subrole): slot = 1; case (.structural, .protected): slot = 2
        case (.privacy, .privateBrowsing): slot = 3; case (.privacy, .incognito): slot = 4; case (.privacy, .isPrivate): slot = 5; case (.privacy, .inPrivate): slot = 6
        default: return
        }
        fallbacks[slot * 2 + (notImplemented ? 1 : 0)] += 1
    }
    func decoded(_ group: HistoryMetadata.Group, index: Int, error: AXError) {
        slotErrors[(group == .structural ? 0 : 3) + index].add(0, error: error)
    }
    func finish(visits: Int) {
        let end = DispatchTime.now().uptimeNanoseconds
        phases[phaseValue.rawValue] += end - phaseStart
        // Cap/arm synchronization occurs only after this reader's work has unwound.
        guard let arm = HistoryCostOutput.finishedReader(end: end) else { return }
        let leafSum = leaves.reduce(UInt64(0)) { $0 + $1.sum }
        var leafRows: [String: Any] = [:], methodRows: [String: Any] = [:], phaseRows: [String: UInt64] = [:]
        for leaf in HistoryCostLeaf.allCases where leaves[leaf.rawValue].count > 0 { leafRows[HistoryCostLeaf.names[leaf.rawValue]] = leaves[leaf.rawValue].object }
        for method in HistoryCostMethod.allCases where methods[method.rawValue].count > 0 { methodRows[HistoryCostMethod.names[method.rawValue]] = methods[method.rawValue].object }
        for phase in HistoryCostPhase.allCases where phases[phase.rawValue] > 0 { phaseRows[HistoryCostPhase.names[phase.rawValue]] = phases[phase.rawValue] }
        let row: [String: Any] = ["type":"reader", "id":id, "purpose":purpose.rawValue, "startNs":start, "deadlineNs":deadline, "armNs":arm, "endNs":end,
            "wallNs":end-start, "leafNs":leafSum, "residualNs":end-start >= leafSum ? end-start-leafSum : 0, "result":result.rawValue, "terminalPhase":HistoryCostPhase.names[phaseValue.rawValue],
            "visits":visits, "preflightStartNs":preflightStart, "preflightEndNs":preflightEnd, "preflightReturned":preflightReturned, "drained":drained, "descriptionNativePaths":descriptionNativePaths,
            "phases":phaseRows, "leaves":leafRows, "inclusiveMethods":methodRows, "fallbacks":fallbacks, "decodedSlots":slotErrors.map(\.object),
            "lastLeaf":HistoryCostLeaf.names[lastLeaf.rawValue], "lastEntryNs":lastEntry, "lastExitNs":lastExit,
            "lastEntryRemainingNs":lastEntry < deadline ? deadline-lastEntry : 0, "lastExitRemainingNs":lastExit < deadline ? deadline-lastExit : 0]
        HistoryCostOutput.emit(row)
    }
}
enum HistoryCostOutput {
    private static let lock = NSLock()
    private static var nextID: UInt64 = 0, active: UInt64 = 0, armNs: UInt64 = 0
    private static var summaries = 0, skipped = 0, records = 0, bytes = 0, byteSuppressed = 0, footerWritten = false
    static func created() -> UInt64 { lock.withLock { nextID += 1; active += 1; return nextID } }
    static func arm(key: Int64, window: UInt32, attachmentWindow: UInt32, sequence: UInt64, queue: Int, lost: Bool, flags: UInt64) {
        let now = DispatchTime.now().uptimeNanoseconds
        let first = lock.withLock { () -> Bool in guard armNs == 0 else { return false }; armNs = now; return true }
        if first { emit(["type":"arm", "ns":now, "key":key, "window":window, "attachmentWindow":attachmentWindow, "sequence":sequence, "queue":queue, "lost":lost, "flags":flags]) }
    }
    static func finishedReader(end: UInt64) -> UInt64? {
        lock.withLock {
            active -= 1
            guard armNs > 0, end >= armNs else { return nil }
            guard summaries < 8 else { skipped += 1; return nil }
            summaries += 1; return armNs
        }
    }
    static func emit(_ row: [String: Any], footer: Bool = false) {
        // Formatting and output are outside the cross-lane cap lock, never in a measured call.
        guard let encoded = try? JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]) else { return }
        var data = Data("history-cost ".utf8); data.append(encoded); data.append(10)
        let admitted = lock.withLock { () -> Bool in
            guard records < 200, bytes + data.count <= (footer ? 65_536 : 65_024) else { byteSuppressed += 1; return false }
            records += 1; bytes += data.count; return true
        }
        if admitted { FileHandle.standardError.write(data) }
    }
    static func footer() {
        let snapshot: (Int, Int, Int, Int, Int, UInt64)? = lock.withLock {
            guard armNs > 0, !footerWritten else { return nil }; footerWritten = true
            return (summaries, skipped, byteSuppressed, records, bytes, active)
        }
        if let state = snapshot { emit(["type":"footer", "summaries":state.0, "skippedSummaries":state.1, "byteSuppressed":state.2, "recordsBeforeFooter":state.3, "bytesBeforeFooter":state.4, "activeReadersAtFooter":state.5], footer: true) }
    }
}

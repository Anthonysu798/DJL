import Foundation
import Darwin

@main struct InteractionHistoryCoreTests {
    static var count = 0
    static func check(_ condition: Bool, _ name: String) {
        guard condition else { fatalError("FAIL: \(name)") }; count += 1
    }
    static func main() throws {
        let base: [String: Any] = ["enabled": true, "paused": false, "retentionDays": 7, "intervalSeconds": 30,
            "includedBundleIds": ["com.djl.history-fixture"], "excludedBundleIds": [], "includedDomains": [], "excludedDomains": []]
        check(!(try HistorySettings(base)).observing, "old consent must remain label-only")
        var settings = base; settings["interactionCaptureEnabled"] = true
        let policy = try HistorySettings(settings)
        check(policy.observing, "explicit interaction consent")
        check(policy.permitsBundle("com.djl.history-fixture", ownBundle: "com.djl.computer-use", parentBundle: "com.djl.desktop"), "exact fixture include")
        check(!policy.permitsBundle("com.djl.desktop", ownBundle: "com.djl.computer-use", parentBundle: "com.djl.desktop"), "host excluded")
        check(!policy.permitsBundle("com.other", ownBundle: nil, parentBundle: nil), "unknown app denied by include")
        var invalid = settings; invalid["enabled"] = 1
        check((try? HistorySettings(invalid)) == nil, "number is not bool")
        invalid = settings; invalid["oops"] = true
        check((try? HistorySettings(invalid)) == nil, "unknown settings denied")
        invalid = settings; invalid["includedDomains"] = ["https://example.com"]
        check((try? HistorySettings(invalid)) == nil, "URL rule denied")
        invalid = settings; invalid["paused"] = true
        check(!(try HistorySettings(invalid)).observing, "pause revokes")
        check(HistorySettings.domainMatches("sub.example.com", "example.com"), "subdomain")
        check(!HistorySettings.domainMatches("badexample.com", "example.com"), "suffix confusion")
        check(!policy.permitsWeb(web: true, privateState: nil, domains: [], complete: true), "unknown private denies")
        check(!policy.permitsWeb(web: true, privateState: true, domains: ["example.com"], complete: true), "private denies")
        check(!policy.permitsWeb(web: false, privateState: false, domains: [], complete: false), "truncated preflight denies")
        check(policy.permitsWeb(web: false, privateState: nil, domains: [], complete: true), "known native")
        var restricted = settings; restricted["excludedDomains"] = ["example.com"]
        let restrictedPolicy = try HistorySettings(restricted)
        check(!restrictedPolicy.permitsWeb(web: true, privateState: false, domains: [], complete: true), "unknown embedded domain denies")
        check(!restrictedPolicy.permitsWeb(web: true, privateState: false, domains: ["a.example.com"], complete: true), "excluded embedded domain denies")
        check(HistorySecurity.safe(role: "AXTextField", subrole: "", protected: false), "ordinary field")
        check(!HistorySecurity.safe(role: "AXTextField", subrole: "AXSecureTextField", protected: false), "secure field")
        check(!HistorySecurity.safe(role: "AXMysteryCustomInput", subrole: "", protected: false), "unrecognized role denied")
        check(!HistorySecurity.safe(role: nil, subrole: "", protected: false), "unknown role")
        check(!HistorySecurity.safe(role: "AXTextField", subrole: nil, protected: nil), "unknown security")
        let lease = HistoryLease(epoch: "test-epoch", settings: policy)
        var reads = 0
        func content(_ systemSecure: Bool?) -> String? {
            HistorySecurity.read(lease: lease, systemSecure: systemSecure, owned: true, safePath: true) { reads += 1; return "fixture" }
        }
        check(content(nil) == nil && reads == 0, "unknown system secure makes zero reads")
        check(content(true) == nil && reads == 0, "secure system makes zero reads")
        check(content(false) == "fixture" && reads == 1, "safe read")
        lease.revoke()
        check(content(false) == nil && reads == 1, "revoked callback makes zero new reads")
        let safeLease = HistoryLease(epoch: "credential-test", settings: policy)
        for label in ["Password", "API key", "accessToken", "client_secret", "refresh-token", "private key", "Recovery phrase", "token", "Secret"] {
            let before = reads
            let value: String? = HistorySecurity.read(lease: safeLease, systemSecure: false, owned: true, safePath: true, labels: [label]) { reads += 1; return "never-read" }
            check(value == nil && reads == before, "credential label denied before value: " + label)
        }
        check(!HistorySecurity.credentialLabel(["Document title", "fixture-editor"]), "ordinary metadata allowed")
        let alternateLease = HistoryLease(epoch: "alternative", settings: policy)
        func alternative(_ role: String, _ labels: [String], _ associationKnown: Bool, _ requiredSafe: Bool) -> String? {
            let safe = HistorySecurity.permitsLabels(role: role, labels: labels, descriptionFailed: true, associationKnown: associationKnown)
            return HistorySecurity.read(lease: alternateLease, systemSecure: false, owned: true, safePath: requiredSafe && safe, labels: labels) { reads += 1; return "ordinary" }
        }
        let beforeAlternative = reads
        check(alternative("AXTextArea", ["document-editor"], true, true) == "ordinary", "description failure with affirmative native metadata")
        check(reads == beforeAlternative + 1, "affirmative alternative reads once")
        for item in [("AXTextArea", [String](), true, true), ("AXTextArea", ["document-editor"], false, true),
                     ("AXTextArea", ["Password"], true, true), ("AXMysteryCustomInput", ["document-editor"], true, true),
                     ("AXTextArea", ["document-editor"], true, false)] {
            let before = reads
            check(alternative(item.0, item.1, item.2, item.3) == nil && reads == before, "unknown/credential/role/association/required-security denies before value")
        }
        check(!HistorySecurity.permitsLabels(role: "AXTextArea", labels: ["editor"], descriptionFailed: true, associationKnown: false), "cyclic association cannot establish evidence")
        let syntheticAccessKey = ["AKIA", "ABCDEFGHIJKLMNOP"].joined()
        let text = "password=hunter2 api_key='abc' Bearer abcdefghijklmnop sk-1234567890abcdefghijkl \(syntheticAccessKey) 4111 1111 1111 1111"
        let redacted = HistoryText.clean(text, limit: 4096)
        check(redacted != nil && !redacted!.contains("hunter2") && !redacted!.contains("abcdefghijkl") && !redacted!.contains("4111"), "secret redaction")
        check(HistoryText.clean(String(repeating: "x", count: 4097), limit: 4096) == nil, "oversized entire value rejected")
        check(HistoryText.range(location: 999_999, length: 2) == nil, "range sum bounded")
        check(HistoryText.range(location: 0, length: 7) != nil, "valid range")
        check(HistorySecurity.permitsWindowTitle("Ordinary document"), "ordinary native title permits content admission")
        for title in ["Private Window", "INCOGNITO", "InPrivate", "Private Browsing", "隐私浏览", "无痕", String(repeating: "x", count: 600) + " Private Window"] {
            check(!HistorySecurity.permitsWindowTitle(title), "raw private title rejects before output clipping")
        }
        check(!HistorySecurity.permitsWindowTitle(nil), "unknown native title denies content admission")
        check(!HistorySecurity.permitsWindowTitle(String(repeating: "x", count: 4097)), "oversized native title denies whole before classification")
        var gesture = HistoryGestureState<String>()
        gesture.begin("obsolete", button: 0); gesture.drag(button: 0); gesture.discard()
        check(gesture.finish(button: 0) == nil, "expired gesture cannot pair with later up")
        gesture.begin("fresh", button: 0)
        let freshClick = gesture.finish(button: 0)
        check(freshClick?.origin == "fresh" && freshClick?.dragged == false, "fresh down after expiry is independent")
        gesture.begin("left", button: 0); gesture.drag(button: 1)
        check(gesture.finish(button: 1) == nil, "wrong button cannot finish a gesture")
        check(gesture.finish(button: 0)?.dragged == false, "unrelated drag does not alter pending button")
        gesture.begin("drag", button: 0); gesture.drag(button: 0)
        check(gesture.finish(button: 0)?.dragged == true && gesture.finish(button: 0) == nil, "completed drag consumes its down once")
        check(HistoryInputIdentity.freshSample(age: 0.99), "sample admitted within unchanged one-second cap")
        check(!HistoryInputIdentity.freshSample(age: 1) && !HistoryInputIdentity.freshSample(age: -1), "expired or future sample denied")
        check(HistoryInputIdentity.window(target: 42, underPointer: 0, handling: 0) == 42, "scroll/key target window survives absent mouse fields")
        check(HistoryInputIdentity.window(target: 42, underPointer: 43, handling: 42) == nil, "contradictory window IDs deny")
        check(HistoryInputIdentity.window(target: 0, underPointer: 0, handling: 0) == nil, "no window identity denies")
        check(HistoryInputIdentity.keyInInterval(key: 12, previousRead: 10, currentRead: 13), "key arriving during capture correlates")
        check(!HistoryInputIdentity.keyInInterval(key: 9, previousRead: 10, currentRead: 13), "old key cannot label later programmatic change")
        check(!HistoryInputIdentity.keyInInterval(key: 14, previousRead: 10, currentRead: 13), "future key cannot label earlier observed value")
        var proofOrder: [String] = [], indirectValues = 0
        let ancestryAllowed = HistoryAncestry.permitsRootToLeaf(["root", "excluded-parent", "child"]) { node in
            proofOrder.append(node)
            if node == "child" { indirectValues += 1 }
            return node != "excluded-parent"
        }
        check(!ancestryAllowed && proofOrder == ["root", "excluded-parent"] && indirectValues == 0, "ancestor denial precedes descendant label values")
        let privateBefore = reads
        let privateRead: String? = HistorySecurity.read(lease: alternateLease, systemSecure: false, owned: true, safePath: true, privacyAuthorized: false) { reads += 1; return "forbidden" }
        check(privateRead == nil && reads == privateBefore, "label/content read requires completed private proof")
        var proofBudget = HistoryProofBudget<Int>(limit: 2)
        check(proofBudget.enter(1), "proof first entry")
        check(!proofBudget.enter(1), "association recursion cycle denies")
        check(proofBudget.enter(2), "proof second distinct entry")
        proofBudget.leave(2)
        check(!proofBudget.enter(3), "proof total budget remains bounded after unwind")
        var naturalProof = HistoryProofBudget<Int>(limit: 8)
        check(naturalProof.enter(1), "root classification starts")
        check(HistoryAncestry.permitsSecurityLabelAncestors([1], origin: 1, ownMetadataAllowed: true, assessOther: { _ in false }), "natural root-title parent back-reference permits only security label read")
        check(!naturalProof.enter(1), "metadata-only verdict never completes in-progress content proof")
        check(!HistoryAncestry.permitsSecurityLabelAncestors([1], origin: 1, ownMetadataAllowed: false, assessOther: { _ in true }), "explicit root credential metadata denies label read")
        check(!HistoryAncestry.permitsSecurityLabelAncestors([1, 2], origin: 2, ownMetadataAllowed: true, assessOther: { _ in false }), "other credential/excluded ancestor still denies label value")
        check(!HistoryAncestry.permitsSecurityLabelAncestors([1], origin: 2, ownMetadataAllowed: true, assessOther: { naturalProof.enter($0) }), "cross-association reentry remains denied")
        let excluded = HistoryProjectionPolicy.scope(role: "AXTextField", labels: .excludedAssociation, ancestorExcluded: false)
        check(excluded == .excluded, "unfocused unresolved association excludes field content")
        var deniedReads = 0
        for role in ["AXTextArea", "AXStaticText", "AXGroup"] {
            let scope = HistoryProjectionPolicy.scope(role: role, labels: .denied, ancestorExcluded: excluded == .excluded)
            check(scope == .excluded, "excluded association descendants remain unreadable")
            if scope == .included { deniedReads += 1 }
        }
        check(deniedReads == 0, "excluded subtree makes no content reads")
        check(HistoryProjectionPolicy.scope(role: "AXMystery", labels: .denied, ancestorExcluded: true) == .denied, "unknown structural role still denies event")
        check(HistoryProjectionPolicy.scope(role: "AXWindow", labels: .excludedAssociation, ancestorExcluded: false) == .denied, "root association cannot become subtree exception")
        check(HistoryProjectionPolicy.scope(role: "AXTextArea", labels: .trusted(["editor"]), ancestorExcluded: false) == .included, "unrelated affirmative editor remains eligible")
        check(HistoryProjectionPolicy.scope(role: "AXTextArea", labels: .denied, ancestorExcluded: false) == .denied, "other unknown label failures still deny")
        var flush = HistoryLossFlush(lastPublished: 0)
        check(flush.request(now: 0.1) == 1, "loss schedules a trailing flush")
        check(flush.request(now: 0.2) == nil && flush.request(now: 0.9) == nil, "one pending flush coalesces burst")
        check(!flush.take(now: 0.99, authorized: true), "flush respects throttle")
        check(flush.take(now: 1, authorized: true), "final count flushes without another loss")
        check(!flush.take(now: 1.5, authorized: true), "no repeated flush without change")
        check(flush.request(now: 1.1) == 2, "next burst bounded from last publication")
        flush.cancel()
        check(!flush.take(now: 2, authorized: true) && flush.request(now: 3) == nil, "stop cancels pending flush permanently")
        var revokedFlush = HistoryLossFlush(lastPublished: 10)
        _ = revokedFlush.request(now: 10.1)
        check(!revokedFlush.take(now: 11, authorized: false), "old epoch cannot publish")
        var newFlush = HistoryLossFlush(lastPublished: 11)
        check(newFlush.request(now: 11.1) == 12, "new lease has independent timing")
        let transitions = HistoryTransitions()
        check(transitions.observed(process: "A/start1", window: 4) == "session-start", "first attested target starts session")
        check(transitions.observed(process: "A/start1", window: 4) == nil, "reattachment cannot invent app change")
        check(transitions.observed(process: "A/start1", window: 5) == "window-changed", "observed window identity change")
        check(transitions.observed(process: "B/start2", window: 6) == "app-changed", "observed process change survives attachment gap")
        check(transitions.observed(process: "B/start3", window: 6) == "app-changed", "reused PID start identity differs")
        let continuity = HistoryContinuity()
        let first = continuity.prepare(["0 AXWindow fixture", "0.0 AXTextField alpha"])!
        check(first.mode == "full", "initial full")
        check(continuity.prepare(["new"]) == nil, "single flight")
        continuity.written(first)
        let second = continuity.prepare(["0 AXWindow fixture", "0.0 AXTextField beta"])!
        check(second.mode == "diff" && second.text.contains("- 0.0 AXTextField alpha") && second.text.contains("+ 0.0 AXTextField beta"), "actual diff")
        continuity.lost(); continuity.written(second)
        let third = continuity.prepare(["0 AXWindow fixture"])!
        check(third.mode == "full", "loss prevents pending completion restoring baseline")
        print("InteractionHistoryCore: \(count) assertions passed")
    }
}

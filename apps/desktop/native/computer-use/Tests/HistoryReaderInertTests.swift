// Appended to a fresh source copy so private production decisions remain intact.
private extension HistoryAttachment {
    func injectKey(_ key: Int64 = 48, flags: CGEventFlags = [], at: Date = Date()) {
        inputSequence += 1
        let input = HistoryInput(type: .keyDown, at: at, window: windowID, point: .zero, button: 0, count: 0, dx: 0, dy: 0, key: key, flags: flags, sequence: inputSequence)
        inputs.append(input); latestKey = input.at.timeIntervalSince1970; changed = true
    }
    func notifyFocus(_ id: String) {
        Self.axCallback(InertAX.world.nodes["observer"]!, InertAX.world.nodes[id]!, kAXFocusedUIElementChangedNotification as CFString, Unmanaged.passUnretained(self).toOpaque())
    }
    func inertOverflow() { overflowGeneration += 1; lost = true; inputs.removeAll() }
    func notifyWindow() { Self.axCallback(InertAX.world.nodes["observer"]!, root, kAXFocusedWindowChangedNotification as CFString, Unmanaged.passUnretained(self).toOpaque()) }
    func replaceNotice(previous: Bool) {
        let existing = previous ? previousFocusNotice! : latestFocusNotice!
        let changed = HistoryFocusNotice(generation: existing.generation, sequence: existing.sequence, subject: HistoryElementKey(element: InertAX.world.nodes["sibling"]!))
        if previous { previousFocusNotice = changed } else { latestFocusNotice = changed }
    }
    var inertFirstInput: HistoryInput { inputs.first! }
    var queuedCount: Int { inputs.count }
    var latestKeyTime: TimeInterval? { latestKey }
    var noticesPreserved: Bool { changed && valueChanged && selectionChanged }
    func markNotices() { changed = true; valueChanged = true; selectionChanged = true }
    var clearedInput: Bool { inputs.isEmpty && latestKey == nil }
}
private extension InteractionHistory {
    func install(_ value: HistoryAttachment, writer: HistoryPipe) { lease = value.lease; attachment = value; pipe = writer }
    func runTick(_ value: HistoryLease) { captureLane.sync { tick(value) } }
    var retainedAttachment: Bool { attachment != nil }
    var inertDropped: Int { dropped }
    func nextTransition(_ a: HistoryAttachment) -> String? { transitions.observed(process: "\(a.pid)/\(a.identity.startSeconds)/\(a.identity.startMicroseconds)", window: a.windowID) }
}
private extension HistoryReader {
    func inertProofSetup(_ c: InertCase) { inertBind(c); privacyAuthorized = true }
    func inertProof(_ body: () throws -> Bool) rethrows -> Bool { try metadataProof(denied: false, body) }
    func inertMetadata(_ element: AXUIElement, _ name: String) -> AXError { readMetadata(element, name).0 }
    var inertProofDepth: Int { metadataProofDepth }
    var inertVisits: Int { structuralVisits }
    func inertBind(_ c: InertCase) { boundRoot = c.a.root; boundFocused = c.w.nodes["A"]! }
    var inertFatal: Bool { navigationFatal }
    func inertFence(_ c: InertCase, recovery: Bool) {
        let start = c.a.focusStamp()
        c.a.injectKey(recovery ? 48 : 124)
        if recovery {
            let end = c.a.focusStamp()
            activeRecovery = HistoryTabRecovery(old: HistoryElementKey(element: c.w.nodes["A"]!), new: HistoryElementKey(element: c.w.nodes["B"]!), root: HistoryElementKey(element: c.a.root), start: start, before: end, end: end, deadline: deadline, now: c.w.clock, visits: 4, completedScan: true, titleAdmitted: true)!
            recoveryAttachment = c.a
        } else {
            navigationGraph = true; navigationAttachment = c.a; navigationBinding = start; navigationInput = c.a.inertFirstInput
        }
    }
}
private final class InertCase {
    static var rootPair = false, nativeNavigation = false, nativeDomainFilter = false
    let w: InertWorld, a: HistoryAttachment, controller: InteractionHistory, writer: HistoryPipe, readFD: Int32
    init() throws {
        w = InertWorld(); InertAX.world = w
        if Self.nativeNavigation { w.error("root", "AXURL", .attributeUnsupported) }
        let settings = try HistorySettings(["enabled": true, "paused": false, "interactionCaptureEnabled": true, "retentionDays": 7, "intervalSeconds": 5, "includedBundleIds": ["com.djl.history-fixture"], "excludedBundleIds": [String](), "includedDomains": Self.nativeNavigation && !Self.nativeDomainFilter ? [String]() : ["allowed.test"], "excludedDomains": [String]()])
        let lease = HistoryLease(epoch: UUID().uuidString, settings: settings)
        a = HistoryAttachment(lease: lease, app: NSRunningApplication(processIdentifier: w.pid)!, identity: try ProcessIdentity(w.pid), root: w.nodes["root"]!, windowID: w.window, failure: { fatalError("unexpected capture startup") })
        var fds = [Int32](repeating: 0, count: 2); precondition(Darwin.pipe(&fds) == 0)
        readFD = fds[0]; _ = fcntl(readFD, F_SETFL, O_NONBLOCK)
        writer = try HistoryPipe(descriptor: fds[1], failure: { fatalError("unexpected pipe failure") })
        controller = InteractionHistory(); controller.install(a, writer: writer)
    }
    func arm(_ change: (() -> Void)? = nil, key: Int64 = 48, flags: CGEventFlags = [], notification: String? = "B", after: ((String, String) -> Void)? = nil) {
        w.onRead = { [self] id, attr in
            if id == "root", attr == "AXTitle", w.counts["root.AXTitle"] == 2, !w.triggered {
                w.triggered = true; w.focus = "B"; a.injectKey(key, flags: flags); if let notification = notification { if Self.rootPair { a.notifyFocus("root") }; a.notifyFocus(notification) }; change?()
            }
            after?(id, attr)
        }
    }
    func armNavigation(phase: String = "scan", key: Int64 = 124, flags: CGEventFlags = [], at: Date = Date(), after: ((String, String) -> Void)? = nil) {
        w.onRead = { [self] id, attr in
            let point = phase == "binding" ? (id == "A" && attr == "AXParent" && w.counts["A.AXParent"] == 1) :
                phase == "classification" ? (id == "root" && attr == "AXHelp" && w.counts["root.AXHelp"] == 3) :
                (id == "root" && attr == "AXPrivateBrowsing" && w.counts["root.AXPrivateBrowsing"] == 1)
            if point && !w.triggered { w.triggered = true; a.injectKey(key, flags: flags, at: at) }
            after?(id, attr)
        }
    }
    func armPattern(beforeKey: [String] = [], afterKey: [String]) {
        w.onRead = { [self] id, attr in
            if id == "root", attr == "AXTitle", w.counts["root.AXTitle"] == 2, !w.triggered {
                w.triggered = true; w.focus = "B"
                beforeKey.forEach { a.notifyFocus($0) }; a.injectKey(); afterKey.forEach { a.notifyFocus($0) }
            }
        }
    }
    func records() -> [Object] {
        // Actual pipe writer runs asynchronously; no UI or platform observation occurs.
        Thread.sleep(forTimeInterval: 0.04); controller.captureLane.sync {}
        var data = Data(), buffer = [UInt8](repeating: 0, count: 65536)
        while true { let n = Darwin.read(readFD, &buffer, buffer.count); if n <= 0 { break }; data.append(contentsOf: buffer.prefix(n)) }
        return data.split(separator: 10).compactMap { try? JSONSerialization.jsonObject(with: Data($0)) as? Object }.compactMap { ($0["event"] as? Object)?["record"] as? Object }
    }
    func close() { w.onRead = nil; w.onBundle = nil; controller.stop(); writer.close(); Thread.sleep(forTimeInterval: 0.03); Darwin.close(readFD) }
}
@main private enum HistoryReaderInertTests {
    static var assertions = 0, cases = 0
    static var evidence: [Object] = []
    static func expect(_ condition: @autoclosure () -> Bool, _ label: String) { assertions += 1; guard condition() else { print("FAIL: " + label); exit(1) } }
    static func run(_ name: String, _ body: (InertCase) throws -> Void) throws {
        let c = try InertCase(); defer { c.close() }; try body(c); cases += 1
        evidence.append(["name": (InertCase.rootPair ? "root-pair: " : "single: ") + name, "reads": c.w.reads, "editableAttempts": c.w.contentAttempts(["A", "B", "B2"]), "clock": c.w.clock, "retainedAttachment": c.controller.retainedAttachment, "leaseValid": c.a.lease.valid, "observations": c.w.observations, "exchanges": c.w.exchanges, "guardTrace": c.w.guardTrace, "comparisons": c.w.comparisons])
        print("PASS " + (InertCase.rootPair ? "root-pair: " : "single: ") + name)
    }
    static func denied(_ c: InertCase, _ name: String) {
        c.controller.runTick(c.a.lease)
        expect(c.records().isEmpty, name + ": no partial output or ordinary fallthrough")
        expect(!c.a.valid && !c.controller.retainedAttachment, name + ": terminal retirement")
        expect(c.w.contentAttempts(["A", "B", "B2"]).isEmpty, name + ": no editable or selection attempt")
    }
    static func suite(pair: Bool) throws {
        InertCase.rootPair = pair
        // Catches missing reset, fallthrough, AX preparation, transition advancement and old-baseline reuse.
        try run("one numeric Tab, no content, all old state reset") { c in
            c.a.previousValue = "alpha"; c.a.previousValueRead = Date().timeIntervalSince1970 - 0.1
            c.a.previousSelection = "old selection"; c.a.previousFocusedElement = HistoryElementKey(element: c.w.nodes["A"]!)
            let sample = HistoryInput(type: .leftMouseDown, at: Date(), window: c.w.window, point: .zero, button: 0, count: 1, dx: 0, dy: 0, key: 0, flags: [])
            c.a.gesture.begin(sample, button: 0)
            let seed = c.a.baseline.prepare(["seed"])!; c.a.baseline.written(seed)
            c.arm(); c.controller.runTick(c.a.lease)
            let records = c.records()
            expect(records.count == 1, "only one recovered record")
            expect(records[0]["kind"] as? String == "shortcut" && records[0]["keyEquivalent"] as? String == "Tab", "numeric Tab")
            expect(records[0]["appName"] as? String == "" && records[0]["windowTitle"] as? String == "", "recovery branch only")
            expect(records[0]["ax"] == nil && records[0]["text"] == nil && records[0]["selection"] == nil, "no recovered content")
            expect(c.w.contentAttempts(["A", "B", "sibling"]).isEmpty, "no projection/selection content read")
            expect(c.controller.retainedAttachment && c.a.valid, "same live attachment")
            expect(c.a.clearedInput && c.a.previousValue == nil && c.a.previousValueRead == nil && c.a.previousSelection == nil && c.a.previousFocusedElement == nil, "queue/latestKey and all baseline fields clear")
            expect(c.a.gesture.finish(button: 0) == nil, "gesture cleared")
            let frame = c.a.baseline.prepare(["changed"])
            expect(frame?.mode == "diff" && frame?.text == "- seed\n+ changed", "AX baseline neither advanced nor invalidated/prepared")
            expect(c.controller.nextTransition(c.a) == "session-start", "transition state untouched")
        }
        try run("next B baseline then genuine B edit") { c in
            c.a.previousValue = "alpha"; c.a.previousValueRead = Date().timeIntervalSince1970 - 0.1
            c.a.previousFocusedElement = HistoryElementKey(element: c.w.nodes["A"]!)
            c.arm(); c.controller.runTick(c.a.lease); _ = c.records()
            c.w.onRead = nil; c.controller.runTick(c.a.lease)
            let initial = c.records()
            expect(!initial.contains { $0["kind"] as? String == "text-input" }, "unchanged beta never typing")
            expect(c.a.previousValue == "beta" && c.a.previousValueRead != nil && c.a.previousFocusedElement == HistoryElementKey(element: c.w.nodes["B"]!), "fresh B baseline")
            expect(initial.contains { ($0["ax"] as? Object)?["mode"] as? String == "full" }, "ordinary next tick establishes first AX baseline")
            c.w.set("B", "AXValue", "beta edited" as CFString); c.a.injectKey(6)
            c.controller.runTick(c.a.lease)
            expect(c.records().contains { $0["kind"] as? String == "text-input" && $0["text"] as? String == "beta edited" }, "genuine subsequent B edit is typing")
        }
        try run("zero notification still proves live exact B") { c in
            c.arm(notification: nil); c.controller.runTick(c.a.lease)
            let records = c.records()
            expect(records.count == 1 && records[0]["appName"] as? String == "", "zero callback factual Tab uses recovery")
            expect(c.w.reads.contains("A.AXParent") && c.w.reads.contains("B.AXParent") && c.w.reads.contains("sibling.AXHelp"), "zero callback still verifies actual paths and every node")
        }
        for packet in ["Shift-Tab", "Return", "mixed", "wrong subject"] {
            try run("actual controller rejects " + packet) { c in
                c.arm({ if packet == "mixed" { c.a.injectKey(6) } }, key: packet == "Return" ? 36 : 48, flags: packet == "Shift-Tab" ? .maskShift : [], notification: packet == "wrong subject" ? "A" : "B")
                denied(c, packet)
            }
        }
        // The scan has completed before these changes; tests require fresh endpoint/all-node decisions.
        for endpoint in ["A", "B"] {
            try run("credential " + endpoint + " denied before values") { c in
                c.arm { c.w.set(endpoint, "AXIdentifier", "password" as CFString) }
                denied(c, endpoint)
                expect(!c.w.reads.contains(endpoint + ".AXDescription"), "credential short-circuits optional label reads")
                if endpoint == "A" { expect(!c.w.reads.contains("B.AXIdentifier"), "old path assessed before new label path") }
            }
            try run("protected " + endpoint + " denied") { c in c.arm { c.w.set(endpoint, "AXProtectedContent", kCFBooleanTrue) }; denied(c, endpoint) }
            try run("unknown required " + endpoint + " denied") { c in c.arm { c.w.error(endpoint, "AXSubrole", .cannotComplete) }; denied(c, endpoint) }
            try run("changed AXParent " + endpoint + " denied") { c in
                c.arm { c.w.parents[endpoint] = "ancestor" }; denied(c, endpoint)
                expect(c.w.reads.contains(endpoint + ".AXParent"), "actual parent proof was queried")
            }
        }
        try run("unrelated unknown sibling denies after endpoints pass") { c in
            c.arm { c.w.error("sibling", "AXHelp", .cannotComplete) }; denied(c, "unknown sibling")
            expect(c.w.reads.contains("A.AXTitleUIElement") && c.w.reads.contains("B.AXTitleUIElement") && c.w.reads.contains("sibling.AXHelp"), "real all-node label classification")
        }
        try run("replacement B object with same identifier denied") { c in
            c.arm { c.w.focus = "B2" }; denied(c, "replaced endpoint")
            expect(!c.w.reads.contains("B2.AXIdentifier"), "identity mismatch precedes textual identity")
        }
        try run("credential ancestor forbids descendant associated label value") { c in
            c.w.children["root"] = ["ancestor", "B", "sibling", "label"]; c.w.children["ancestor"] = ["A"]
            c.w.parents["A"] = "ancestor"; c.w.parents["label"] = "ancestor"
            c.w.set("A", "AXTitleUIElement", c.w.nodes["label"]!)
            c.arm { c.w.set("ancestor", "AXIdentifier", "API token" as CFString) }; denied(c, "credential ancestor")
            expect(c.w.contentAttempts(["label"]).isEmpty && !c.w.reads.contains("A.AXIdentifier"), "unsafe ancestor stops descendant and linked value")
        }
        try run("natural static root title association succeeds") { c in
            c.w.children["root"]!.append("label"); c.w.set("root", "AXTitleUIElement", c.w.nodes["label"]!)
            c.arm(); c.controller.runTick(c.a.lease)
            expect(c.records().count == 1 && c.controller.retainedAttachment, "verified natural title back-reference")
            expect(c.w.reads.contains("label.AXValue") && c.w.contentAttempts(["A", "B"]).isEmpty, "only authorized static security label content")
        }
        for association in ["credential", "cycle", "editable"] {
            try run("associated label " + association + " denied pre-read") { c in
                c.w.children["root"]!.append("label"); c.w.set("A", "AXTitleUIElement", c.w.nodes["label"]!)
                c.arm {
                    if association == "credential" { c.w.set("label", "AXIdentifier", "secret" as CFString) }
                    if association == "cycle" { c.w.set("label", "AXTitleUIElement", c.w.nodes["A"]!) }
                    if association == "editable" { c.w.set("label", "AXRole", "AXTextField" as CFString) }
                }
                denied(c, association); expect(c.w.contentAttempts(["label"]).isEmpty, "unsafe association never AXValue")
            }
        }
        for condition in ["private", "domain", "title", "secure", "permission", "owner", "identity", "deadline", "stop", "second focus"] {
            try run("fresh continuation " + condition + " denies") { c in
                c.arm(after: { id, attr in
                    guard id == "root", attr == "AXTitle", c.w.counts["root.AXTitle"] == 3 else { return }
                    switch condition {
                    case "private": c.w.set("root", "AXPrivateBrowsing", kCFBooleanTrue)
                    case "domain": c.w.set("root", "AXURL", "https://excluded.test/" as CFString)
                    case "title": c.w.set("root", "AXTitle", "Private Browsing" as CFString)
                    case "secure": c.w.secure = true
                    case "permission": c.w.permission = false
                    case "owner": c.w.owners["root"] = 999
                    case "identity": c.w.processStart += 1
                    case "deadline": c.w.clock += 750_000_000
                    case "stop": c.controller.stop()
                    default: c.w.focus = "A"; c.a.notifyFocus("A")
                    }
                }); denied(c, condition)
            }
        }
        for condition in ["notification", "stop", "input", "overflow", "deadline"] {
            try run("final queue fence " + condition + " denies") { c in
                c.arm(); c.w.onBundle = {
                    guard c.w.bundleReads == 2 else { return }
                    switch condition {
                    case "notification": c.a.notifyFocus("B")
                    case "stop": c.controller.stop()
                    case "input": c.a.injectKey(48)
                    case "overflow": c.a.lock.withLock { c.a.inertOverflow() }
                    default: c.w.clock += 750_000_000
                    }
                }; denied(c, condition)
                expect(c.w.bundleReads == 2, "reached record construction after complete proof")
            }
        }
        try run("milestone absent: early focus change is not typed") { c in
            c.w.onRead = { id, attr in
                if id == "app", attr == "AXFocusedUIElement", c.w.counts["app.AXFocusedUIElement"] == 2 { c.w.focus = "B"; c.a.injectKey(); c.a.notifyFocus("B") }
            }; denied(c, "before title milestone")
            expect(!c.w.reads.contains("root.AXTitle"), "no title milestone reached")
        }
        try run("private title denies before association reads and typed focus") { c in
            c.w.set("root", "AXTitle", "Private Browsing" as CFString)
            c.w.set("root", "AXTitleUIElement", c.w.nodes["label"]!)
            c.arm(); denied(c, "private title")
            expect(!c.w.triggered && c.w.contentAttempts(["label"]).isEmpty, "title admission precedes label AXValue and typed arm")
        }
        try run("generic label failure cannot become typed recovery") { c in
            c.w.error("A", "AXHelp", .cannotComplete)
            c.w.onRead = { id, attr in if id == "A", attr == "AXHelp" { c.w.focus = "B"; c.a.injectKey(); c.a.notifyFocus("B") } }
            denied(c, "generic label failure"); expect(c.w.reads.contains("A.AXHelp"), "generic failing query executed")
        }
        try run("callback racing B query denies inconsistent bracket") { c in
            c.w.onRead = { id, attr in if id == "app", attr == "AXFocusedUIElement", c.w.counts["app.AXFocusedUIElement"] == 3 { c.w.focus = "B"; c.a.injectKey(); c.a.notifyFocus("B") } }
            denied(c, "B query bracket")
        }
        try run("first label proof discarded after later typed change") { c in
            c.w.onRead = { id, attr in
                if id == "A", attr == "AXHelp", !c.w.triggered {
                    c.w.triggered = true; c.w.set("root", "AXIdentifier", "password" as CFString)
                    c.w.focus = "B"; c.a.injectKey(); c.a.notifyFocus("B")
                }
            }; denied(c, "stale root labels")
            expect((c.w.counts["root.AXIdentifier"] ?? 0) >= 2, "root classification repeated after old proof")
        }
        for change in ["label", "protection", "privacy"] {
            try run("fresh final " + change + " after all-node classification") { c in
                var classified = false, changed = false
                c.arm(after: { id, attr in
                    if id == "sibling", attr == "AXTitleUIElement" { classified = true }
                    guard classified, !changed else { return }
                    if change == "privacy", id == "root", attr == "AXPrivateBrowsing" {
                        changed = true; c.w.set("root", "AXPrivateBrowsing", kCFBooleanTrue)
                    } else if change == "label", id == "A", attr == "AXIdentifier" {
                        changed = true; c.w.set("A", "AXIdentifier", "password" as CFString)
                    } else if change == "protection", id == "A", attr == "AXProtectedContent" {
                        changed = true; c.w.set("A", "AXProtectedContent", kCFBooleanTrue)
                    }
                }); denied(c, "final " + change)
                expect(classified && changed, "late mutation really occurred after all-node labels")
            }
        }
        for change in ["foreground", "window", "epoch", "unknown secure"] {
            try run("fresh " + change + " before continuation") { c in
                c.arm(after: { id, attr in
                    guard id == "root", attr == "AXTitle", c.w.counts["root.AXTitle"] == 3 else { return }
                    switch change {
                    case "foreground": c.w.foreground = nil
                    case "window": c.w.focusedWindow = "ancestor"
                    case "epoch": c.a.lease.revoke()
                    default: c.w.secure = nil
                    }
                }); denied(c, change)
            }
        }
        try run("excluded old label association denies recovery") { c in
            c.w.children["root"]!.append("label")
            c.w.set("A", "AXTitleUIElement", c.w.nodes["label"]!)
            c.w.set("label", "AXRole", "AXGroup" as CFString)
            c.arm(); denied(c, "excluded old association")
            expect(c.w.contentAttempts(["label"]).isEmpty, "unknown associated control not read")
        }
        try run("private witness failure denies before associated static value") { c in
            c.w.children["root"]!.append("label"); c.w.set("root", "AXTitleUIElement", c.w.nodes["label"]!)
            c.arm { c.w.error("root", "AXPrivateBrowsing", .cannotComplete) }; denied(c, "unknown private witness")
            expect(c.w.contentAttempts(["label"]).isEmpty, "global privacy admission before static label")
        }
        try run("second focus during linked-label AX read denies without endpoint content") { c in
            c.w.children["root"]!.append("label"); c.w.set("root", "AXTitleUIElement", c.w.nodes["label"]!)
            c.arm(after: { id, attr in
                if id == "label", attr == "AXValue", c.w.counts["label.AXValue"] == 1 { c.w.focus = "A"; c.a.notifyFocus("A") }
            }); denied(c, "focus races static label")
            expect(c.w.counts["label.AXValue"] == 1, "one previously authorized label read discarded after race")
        }
        try run("real reader typed cause consumes only once without resetting budget") { c in
            c.arm()
            let reader = HistoryReader(lease: c.a.lease, pid: c.a.pid, identity: c.a.identity)
            do { _ = try reader.preflight(c.a, allowFocusRecovery: true); expect(false, "expected exact typed change") }
            catch let change as HistoryFocusChange {
                expect(change.recovery.old == HistoryElementKey(element: c.w.nodes["A"]!) && change.recovery.new == HistoryElementKey(element: c.w.nodes["B"]!), "actual exact A to B")
                expect(change.recovery.visits == 4 && change.recovery.deadline == 1_750_000_000, "completed four-node scan and original absolute deadline")
                c.w.clock = 1_700_000_000
                expect(reader.continueTab(change.recovery, attachment: c.a) != nil, "continuation uses remaining 50ms")
                expect(reader.deadline == 1_750_000_000 && reader.inertVisits == 4, "no deadline or structural budget renewal")
                expect(reader.continueTab(change.recovery, attachment: c.a) == nil, "second consumption denied")
            }
        }
    }
    static func pairFacts() throws {
        InertCase.rootPair = true
        for pattern in [[], ["B"], ["root", "B"]] {
            try run("nonzero watermark preserves zero/one/pair with stale pre-A subjects \(pattern)") { c in
                c.a.notifyFocus("sibling"); c.a.notifyFocus("A")
                c.armPattern(afterKey: pattern); c.controller.runTick(c.a.lease)
                let records = c.records()
                expect(records.count == 1 && records[0]["keyEquivalent"] as? String == "Tab" && records[0]["appName"] as? String == "", "pre-A history is irrelevant to accepted interval")
                expect(c.a.focusStamp().generation == UInt64(2 + pattern.count), "every actual callback increments generation")
            }
        }
        for pattern in [["root"], ["B", "root"], ["B", "B"], ["A", "B"], ["sibling", "B"], ["app", "B"], ["ancestor", "B"], ["root", "sibling"], ["A", "root", "B"], ["root", "B", "root", "B"]] {
            try run("actual incompatible callback pattern \(pattern)") { c in
                c.armPattern(afterKey: pattern); denied(c, "callback pattern")
                expect(c.a.focusStamp().generation == UInt64(pattern.count), "no callback coalescing or normalization")
            }
        }
        try run("actual root callback before Tab receipt cannot qualify") { c in
            c.armPattern(beforeKey: ["root"], afterKey: ["B"]); denied(c, "pre-Tab root")
            let stamp = c.a.focusStamp()
            expect(stamp.previousNotice?.sequence == 0 && stamp.latestNotice?.sequence == 1, "real callback receipt sequence retained")
        }
        try run("same textual root identifier on a different opaque object denied") { c in
            c.w.set("ancestor", "AXIdentifier", "root" as CFString)
            c.armPattern(afterKey: ["ancestor", "B"]); denied(c, "wrong opaque root")
        }
        for subject in ["root", "B"] {
            try run("actual \(subject) callback during B binding denies") { c in
                c.arm(after: { id, attr in if id == "app", attr == "AXFocusedUIElement", c.w.counts["app.AXFocusedUIElement"] == 3 { c.a.notifyFocus(subject) } })
                denied(c, "B query callback")
            }
            try run("actual late \(subject) after final proof denies") { c in
                c.arm(); c.w.onBundle = { if c.w.bundleReads == 2 { c.a.notifyFocus(subject) } }; denied(c, "late callback")
                expect(c.w.bundleReads == 2, "completed actual live proof before late event")
            }
            try run("actual \(subject) during static label query denies") { c in
                c.w.children["root"]!.append("label"); c.w.set("root", "AXTitleUIElement", c.w.nodes["label"]!)
                c.arm(after: { id, attr in if id == "label", attr == "AXValue", c.w.counts["label.AXValue"] == 1 { c.a.notifyFocus(subject) } })
                denied(c, "label query callback")
                expect(c.w.counts["label.AXValue"] == 1, "only previously authorized static label read occurred")
            }
        }
        for previous in [true, false] {
            try run("exact final fence includes \(previous ? "previous" : "latest") immutable notice") { c in
                c.arm(); c.w.onBundle = {
                    if c.w.bundleReads == 2 {
                        let old = c.a.focusStamp(); c.a.replaceNotice(previous: previous)
                        expect(old != c.a.focusStamp(), "retained end stamp is immutable and compares both facts")
                    }
                }; denied(c, "changed notice without generation alteration")
            }
        }
        try run("actual window notification invalidates pair") { c in
            c.arm(after: { id, attr in if id == "root", attr == "AXTitle", c.w.counts["root.AXTitle"] == 3 { c.a.notifyWindow() } }); denied(c, "window generation")
        }
        try run("callback after writer acceptance preserves one accepted record") { c in
            c.arm(); c.controller.runTick(c.a.lease)
            c.a.notifyFocus("root") // After actual enqueue, before waiting for the pipe to finish.
            let first = c.records()
            expect(first.count == 1 && first[0]["keyEquivalent"] as? String == "Tab", "accepted record is not retroactively revoked")
            c.w.onRead = nil; c.controller.runTick(c.a.lease)
            expect(!c.records().contains { $0["keyEquivalent"] as? String == "Tab" }, "post-admission callback creates no second recovery")
        }
    }
    static func zeroCallbackFailures() throws {
        InertCase.rootPair = false
        for condition in ["unsafe A", "unsafe B", "private", "Stop"] {
            try run("zero callback still requires actual live proof: " + condition) { c in
                c.armPattern(afterKey: [])
                let original = c.w.onRead
                var changed = false
                c.w.onRead = { id, attr in
                    original?(id, attr)
                    guard id == "root", attr == "AXTitle", c.w.counts["root.AXTitle"] == 3 else { return }
                    changed = true
                    switch condition {
                    case "unsafe A": c.w.set("A", "AXIdentifier", "password" as CFString)
                    case "unsafe B": c.w.set("B", "AXIdentifier", "api-key" as CFString)
                    case "private": c.w.set("root", "AXPrivateBrowsing", kCFBooleanTrue)
                    default: c.controller.stop()
                    }
                }
                denied(c, "zero callback " + condition)
                expect(changed && c.a.focusStamp().generation == 0, "live proof was attempted without fabricated callbacks")
            }
        }
    }
    static func navigationSuite() throws {
        InertCase.rootPair = false; InertCase.nativeNavigation = true
        defer { InertCase.nativeNavigation = false }
        try run("navigation: full context truly denied unrelated label baseline") { c in
            c.w.error("sibling", "AXHelp", .cannotComplete)
            denied(c, "ordinary full context retains unrelated label veto")
            expect(c.w.reads.contains("sibling.AXHelp"), "actual classifier reached denied sibling")
        }
        try run("navigation: mid-scan sole ArrowRight skips unperformed unrelated label denial") { c in
            c.w.error("sibling", "AXHelp", .cannotComplete)
            c.w.onRead = { id, attr in
                if id == "root", attr == "AXPrivateBrowsing", !c.w.triggered {
                    c.w.triggered = true; c.a.injectKey(124)
                }
            }
            c.controller.runTick(c.a.lease)
            let records = c.records()
            expect(c.w.triggered, "actual post-binding numeric arrival")
            expect(records.count == 1, "sole navigation emits exactly one record instead of retiring at unrelated classification")
            expect(Set(records[0].keys) == Set(["id", "capturedAt", "target", "appName", "windowTitle", "kind", "keyEquivalent", "modifiers"]), "content-free exact output fields")
            expect(records[0]["keyEquivalent"] as? String == "ArrowRight" && records[0]["appName"] as? String == "" && records[0]["windowTitle"] as? String == "", "fixed numeric output")
            expect(!c.w.reads.contains("sibling.AXHelp") && c.w.contentAttempts(["A", "B", "sibling"]).isEmpty, "unrelated label not performed; no editable/selection/projection")
            expect(c.a.valid && c.controller.retainedAttachment && c.a.clearedInput, "same attachment consumes only admitted navigation")
        }
    }
    static func navigationFailures() throws {
        InertCase.rootPair = false; InertCase.nativeNavigation = true
        defer { InertCase.nativeNavigation = false }
        for (key, name) in [(123, "ArrowLeft"), (124, "ArrowRight"), (125, "ArrowDown"), (126, "ArrowUp"), (115, "Home"), (119, "End"), (116, "PageUp"), (121, "PageDown")] {
            try run("navigation: fixed raw numeric mapping " + name) { c in
                c.armNavigation(key: Int64(key)); c.controller.runTick(c.a.lease)
                let records = c.records()
                expect(records.count == 1 && records[0]["keyEquivalent"] as? String == name && records[0]["modifiers"] as? [String] == [], "one literal fixed shortcut")
                expect(c.w.contentAttempts(["A", "B", "sibling"]).isEmpty, "numeric proof has no projection")
            }
        }
        try run("navigation: arrival in completed successful classifier unit") { c in
            c.w.error("sibling", "AXHelp", .cannotComplete); c.armNavigation(phase: "classification")
            c.controller.runTick(c.a.lease)
            expect(c.w.triggered && c.records().count == 1, "classification checkpoint selects before unrelated denied sibling")
            expect(!c.w.reads.contains("sibling.AXHelp"), "unperformed classifier work omitted")
        }
        for phase in ["binding", "prequeued", "gesture", "mixed", "modified", "caps", "function", "letter", "Tab"] {
            try run("navigation: ineligible " + phase + " keeps full label veto") { c in
                c.w.error("sibling", "AXHelp", .cannotComplete)
                if phase == "prequeued" { c.a.injectKey(124) }
                if phase == "gesture" { c.a.gesture.begin(HistoryInput(type: .leftMouseDown, at: Date(), window: c.a.windowID, point: .zero, button: 0, count: 1, dx: 0, dy: 0, key: 0, flags: []), button: 0) }
                let flags: CGEventFlags = phase == "modified" ? .maskShift : phase == "caps" ? .maskAlphaShift : phase == "function" ? .maskSecondaryFn : []
                c.armNavigation(phase: phase == "binding" ? "binding" : "scan", key: phase == "letter" ? 6 : phase == "Tab" ? 48 : 124, flags: flags, after: { id, attr in
                    if phase == "mixed", id == "root", attr == "AXPrivateBrowsing", c.w.counts["root.AXPrivateBrowsing"] == 1 { c.a.injectKey(6) }
                })
                denied(c, phase)
                expect(c.w.reads.contains("sibling.AXHelp"), "ordinary full classifier is unchanged")
            }
        }
        for condition in ["browser", "web", "domain"] {
            try run("navigation: native-only scope " + condition) { c in
                c.w.error("sibling", "AXHelp", .cannotComplete)
                if condition == "browser" { c.w.bundle = "com.example.browser" }
                if condition == "web" { c.w.set("B", "AXRole", "AXWebArea" as CFString); c.w.set("B", "AXPrivateBrowsing", kCFBooleanFalse) }
                if condition == "domain" { c.w.set("root", "AXURL", "https://allowed.test/" as CFString) }
                c.armNavigation(); denied(c, condition)
            }
        }
        InertCase.nativeDomainFilter = true
        try run("navigation: included-domain rules still deny native empty domain") { c in
            c.armNavigation(); denied(c, "included-domain empty-domain")
            expect(!c.w.reads.contains("A.AXIdentifier"), "global domain policy precedes label proof")
        }
        InertCase.nativeDomainFilter = false
        try run("navigation: known callback invalidation stops static value reads") { c in
            c.w.children["root"]!.append("label"); c.w.set("A", "AXTitleUIElement", c.w.nodes["label"]!)
            c.armNavigation(after: { id, attr in
                if id == "label", attr == "AXHelp", c.w.counts["label.AXHelp"] == 1 { c.a.notifyFocus("A") }
            })
            denied(c, "callback before linked value")
            expect(c.w.contentAttempts(["label"]).isEmpty, "known invalidation prevents security-label value attempt")
        }
        for condition in ["private", "private-malformed", "title", "unknown role", "credential A", "protected A", "dependency", "unscanned label", "moved label", "changed label role", "cycle", "secure", "unknown secure", "lock", "permission", "identity", "foreground", "owner", "focus", "same focus callback", "window", "Stop", "overflow", "deadline"] {
            try run("navigation: actual proof denies " + condition) { c in
                if ["dependency", "unscanned label", "moved label", "changed label role", "cycle"].contains(condition) {
                    if condition != "unscanned label" { c.w.children["root"]!.append("label") }
                    c.w.set("A", "AXTitleUIElement", c.w.nodes["label"]!)
                }
                if condition == "dependency" { c.w.error("label", "AXHelp", .cannotComplete) }
                if condition == "cycle" { c.w.set("label", "AXTitleUIElement", c.w.nodes["A"]!) }
                c.armNavigation(after: { id, attr in
                    guard id == "root", attr == "AXTitle", c.w.counts["root.AXTitle"] == 1 else { return }
                    switch condition {
                    case "private": c.w.set("root", "AXPrivateBrowsing", kCFBooleanTrue)
                    case "private-malformed": c.w.set("root", "AXPrivateBrowsing", "false" as CFString)
                    case "title": c.w.set("root", "AXTitle", "Private Browsing" as CFString)
                    case "unknown role": c.w.set("A", "AXRole", "UnknownRole" as CFString)
                    case "credential A": c.w.set("A", "AXIdentifier", "API token" as CFString)
                    case "protected A": c.w.set("A", "AXProtectedContent", kCFBooleanTrue)
                    case "moved label": c.w.parents["label"] = "A"
                    case "changed label role": c.w.set("label", "AXRole", "AXGroup" as CFString)
                    case "secure": c.w.secure = true
                    case "unknown secure": c.w.secure = nil
                    case "lock": c.w.locked = true
                    case "permission": c.w.permission = false
                    case "identity": c.w.processStart += 1
                    case "foreground": c.w.foreground = nil
                    case "owner": c.w.owners["A"] = 999
                    case "focus": c.w.focus = "B"
                    case "same focus callback": c.a.notifyFocus("A")
                    case "window": c.a.notifyWindow()
                    case "Stop": c.controller.stop()
                    case "overflow": c.a.inertOverflow()
                    case "deadline": c.w.clock += 750_000_000
                    default: break
                    }
                })
                denied(c, condition)
                if ["dependency", "unscanned label", "moved label", "changed label role", "cycle", "title"].contains(condition) { expect(c.w.contentAttempts(["label"]).isEmpty, "denied dependency never reads label value") }
            }
        }
        for when in [1, 3] {
            try run("navigation: swallowed live guard URL fallback at query \(when)") { c in
                c.w.error("sibling", "AXHelp", .cannotComplete)
                c.armNavigation(after: { id, attr in
                    if id == "root", attr == "AXURL", c.w.counts["root.AXURL"] == when {
                        c.w.secure = true; c.w.onSecure = { c.w.secure = false; c.w.onSecure = nil }
                    }
                })
                denied(c, "swallowed guard failure")
                expect(c.w.reads.contains("root.AXDocument"), "optional fallback actually ran after guard recovered")
            }
        }
        try run("navigation: supported optional description fallback remains compatible") { c in
            c.w.error("A", "AXDescription", .failure); c.armNavigation(); c.controller.runTick(c.a.lease)
            expect(c.records().count == 1, "affirmative ordinary metadata permits completed native fallback")
        }
        try run("navigation: graph-bound natural static title label") { c in
            c.w.children["root"]!.append("label"); c.w.set("root", "AXTitleUIElement", c.w.nodes["label"]!)
            c.armNavigation(); c.controller.runTick(c.a.lease)
            expect(c.records().count == 1 && c.w.reads.contains("label.AXValue"), "existing narrow natural title association preserved")
            expect(c.w.contentAttempts(["A", "B", "sibling"]).isEmpty, "only security-label value allowed")
        }
        for extra in [124, 6, 48] {
            try run("navigation: queue-only \(extra) exits without output or state loss") { c in
                c.a.previousValue = "alpha"; c.a.previousValueRead = Date().timeIntervalSince1970 - 0.2
                c.a.previousFocusedElement = HistoryElementKey(element: c.w.nodes["A"]!); c.a.previousSelection = "known"
                c.armNavigation(after: { id, attr in
                    if id == "root", attr == "AXTitle", c.w.counts["root.AXTitle"] == 2 { c.a.injectKey(Int64(extra)); c.a.markNotices() }
                })
                c.controller.runTick(c.a.lease)
                expect(c.records().isEmpty && c.a.valid && c.a.queuedCount == 2, "queue-only no-output preserves exact raw queue")
                expect(c.a.previousValue == "alpha" && c.a.previousSelection == "known" && c.a.noticesPreserved, "comparison/notice state retained")
                c.w.onRead = nil; c.w.error("sibling", "AXHelp", .cannotComplete)
                c.controller.runTick(c.a.lease)
                expect(c.records().isEmpty && !c.a.valid && c.w.reads.contains("sibling.AXHelp"), "next tick uses only full path; no navigation retry")
            }
        }
        try run("navigation: unchanged A comparisons preserve later genuine edit") { c in
            let previous = Date().timeIntervalSince1970 - 0.2
            c.a.previousValue = "alpha"; c.a.previousValueRead = previous; c.a.previousFocusedElement = HistoryElementKey(element: c.w.nodes["A"]!)
            c.a.previousSelection = "{\"length\":5,\"location\":0,\"text\":\"alpha\"}"
            let selection = c.a.previousSelection
            let baseline = c.a.baseline.prepare(["seed"])!; c.a.baseline.written(baseline)
            c.a.markNotices(); c.armNavigation(); c.controller.runTick(c.a.lease)
            expect(c.records().count == 1 && c.a.clearedInput, "one consumed numeric record")
            expect(c.a.previousValue == "alpha" && c.a.previousValueRead == previous && c.a.previousSelection == selection && c.a.noticesPreserved, "past observations preserved without invented timestamp")
            expect(c.controller.nextTransition(c.a) == "session-start", "navigation never advances transitions")
            c.w.onRead = nil; c.w.set("A", "AXValue", "alpha edited" as CFString); c.a.injectKey(6)
            expect(c.a.latestKeyTime != nil, "postcommit new key retains attribution")
            c.controller.runTick(c.a.lease)
            let records = c.records()
            expect(records.contains { $0["kind"] as? String == "text-input" && $0["text"] as? String == "alpha edited" }, "later genuine edit survives navigation")
            expect(!records.contains { $0["kind"] as? String == "selection-changed" }, "unchanged selection not spuriously reannounced")
            expect(records.contains { ($0["ax"] as? Object)?["mode"] as? String == "diff" }, "written baseline survives navigation")
        }
        for age in [-1.0, 1.1] {
            try run("navigation: original sample age \(age) denies") { c in c.armNavigation(at: Date().addingTimeInterval(-age)); denied(c, "sample age") }
        }
        for failure in ["deadline", "lease"] {
            try run("navigation: actual post-encode writer fence " + failure) { c in
                c.armNavigation(); c.w.onEncode = { if failure == "deadline" { c.w.clock += 750_000_000 } else { c.a.lease.revoke() } }
                denied(c, "post-encode " + failure)
            }
        }
        try run("navigation: final current privacy after record construction") { c in
            c.armNavigation(); c.w.onBundle = { if c.w.bundleReads == 2 { c.w.set("root", "AXPrivateBrowsing", kCFBooleanTrue) } }
            denied(c, "final private flip")
        }
    }
    static func navigationBoundaries() throws {
        InertCase.rootPair = false; InertCase.nativeNavigation = true
        defer { InertCase.nativeNavigation = false }
        for condition in ["true private", "malformed private", "unknown sibling", "failed class unit", "scope exclusion"] {
            try run("navigation: successful unit precedence " + condition) { c in
                if condition == "true private" { c.w.set("root", "AXPrivateBrowsing", kCFBooleanTrue) }
                if condition == "malformed private" { c.w.set("root", "AXPrivateBrowsing", "unknown" as CFString) }
                if condition == "unknown sibling" { c.w.set("sibling", "AXRole", "AXUnknown" as CFString) }
                if condition == "failed class unit" {
                    c.armNavigation(phase: "classification", after: { id, attr in
                        if id == "root", attr == "AXHelp", c.w.counts["root.AXHelp"] == 3 { c.w.error("root", "AXHelp", .cannotComplete) }
                    })
                } else { c.armNavigation() }
                if condition == "scope exclusion" { c.w.set("root", "AXURL", "https://allowed.test/" as CFString); c.w.error("sibling", "AXHelp", .cannotComplete) }
                denied(c, condition)
            }
        }
        for condition in ["node bound", "depth bound"] {
            try run("navigation: original complete scan " + condition) { c in
                let count = condition == "node bound" ? 193 : 26
                for i in 0..<count {
                    let id = "g\(i)"; c.w.nodes[id] = Data(id.utf8) as CFData; c.w.owners[id] = c.w.pid
                    c.w.add(id, role: "AXGroup", title: "Group")
                    c.w.parents[id] = condition == "node bound" || i == 0 ? "root" : "g\(i - 1)"
                    if condition == "depth bound" && i > 0 { c.w.children["g\(i - 1)"] = [id] }
                }
                c.w.children["root"] = condition == "node bound" ? ["A"] + (0..<count).map { "g\($0)" } : ["A", "g0"]
                c.armNavigation(); denied(c, condition)
                expect(!c.w.reads.contains("A.AXIdentifier"), "incomplete global scan never enters label proof")
            }
        }
        try run("navigation: one scan and no accidental attachment-mode admission") { c in
            c.armNavigation()
            let reader = HistoryReader(lease: c.a.lease, pid: c.a.pid, identity: c.a.identity)
            let result = try reader.preflight(c.a, allowFocusRecovery: true, allowNavigation: true)
            if case .navigation? = result {} else { expect(false, "explicit navigation result") }
            expect(reader.inertVisits == 4 && c.w.reads.filter { $0.hasSuffix(".children-count") }.count == 4, "one four-node scan, no renewed budget")
        }
        try run("navigation: attachment/default preflight retains full classifier") { c in
            c.w.error("sibling", "AXHelp", .cannotComplete); c.armNavigation()
            let reader = HistoryReader(lease: c.a.lease, pid: c.a.pid, identity: c.a.identity)
            let result = try reader.preflight(c.a)
            expect(result == nil, "default preflight cannot select navigation")
            expect(c.w.reads.contains("sibling.AXHelp"), "actual full classification unchanged")
        }
        for condition in ["excludedAssociation", "credential"] {
            try run("navigation: full-context intentional exclusion " + condition) { c in
                c.w.set("sibling", "AXRole", "AXTextField" as CFString)
                if condition == "excludedAssociation" { c.w.set("sibling", "AXTitleUIElement", c.w.nodes["B"]!) }
                else { c.w.set("sibling", "AXIdentifier", "password" as CFString) }
                c.controller.runTick(c.a.lease)
                expect(c.records().contains { $0["ax"] != nil }, "existing exclusion does not falsely count as global denial")
                expect(c.w.contentAttempts(["sibling"]).isEmpty, "excluded sibling contents remain unread")
            }
        }
        try run("navigation: pending baseline completion remains valid") { c in
            let pending = c.a.baseline.prepare(["pending"])!
            c.armNavigation(); c.controller.runTick(c.a.lease); expect(c.records().count == 1, "navigation accepted with pending context frame")
            expect(c.a.baseline.prepare(["next"]) == nil, "navigation does not clear outstanding frame")
            c.a.baseline.written(pending)
            let next = c.a.baseline.prepare(["next"])
            expect(next?.mode == "diff" && next?.text == "- pending\n+ next", "existing completion accepts original frame")
        }
        for fatal in ["private", "deadline", "focus", "overflow", "Stop"] {
            try run("navigation: extra queue never masks " + fatal) { c in
                c.armNavigation(after: { id, attr in
                    guard id == "root", attr == "AXTitle", c.w.counts["root.AXTitle"] == 2 else { return }
                    c.a.injectKey(6)
                    switch fatal {
                    case "private": c.w.set("root", "AXPrivateBrowsing", kCFBooleanTrue)
                    case "deadline": c.w.clock += 750_000_000
                    case "focus": c.a.notifyFocus("A")
                    case "overflow": c.a.inertOverflow()
                    default: c.controller.stop()
                    }
                })
                denied(c, "mixed " + fatal)
                expect(c.a.queuedCount == 0, "fatal clear dominates queue-only preservation")
            }
        }
        try run("navigation: age expires during actual JSON encoding boundary") { c in
            c.armNavigation(); c.w.onEncode = { Thread.sleep(forTimeInterval: 1.05) }
            denied(c, "age crossed after encode")
        }
        try run("navigation: closed pipe denies without consuming success") { c in
            c.writer.close(); Thread.sleep(forTimeInterval: 0.04)
            c.armNavigation(); denied(c, "writer closed")
        }
    }
    static func navigationLateRoles() throws {
        InertCase.rootPair = false; InertCase.nativeNavigation = true
        defer { InertCase.nativeNavigation = false }
        for role in ["AXTextField", "AXWebArea", "AXGroup"] {
            try run("navigation: late collectLabels role observation " + role) { c in
                var observed = false, priorAncestry = false
                c.armNavigation(after: { id, attr in
                    // Binding and scan are reads 1/2, navigation ancestry is 3.
                    // Read 4 is collectLabels' subsequent fresh observation.
                    if id == "A", attr == "AXRole", c.w.counts["A.AXRole"] == 4 {
                        observed = true
                        priorAncestry = c.w.counts["A.AXParent"] == 2 && c.w.counts["A.AXIdentifier"] == nil
                        c.w.set("A", "AXRole", role as CFString)
                    }
                })
                c.controller.runTick(c.a.lease)
                let records = c.records(), forbidden = c.w.contentAttempts(["A", "B", "sibling"])
                if CommandLine.arguments.count == 2 {
                    let path = URL(fileURLWithPath: CommandLine.arguments[1]).deletingLastPathComponent().appendingPathComponent("late-role-" + role + ".json")
                    let trace: Object = ["role": role, "changedAtCollectLabels": observed, "priorAncestryCompleted": priorAncestry,
                        "reads": c.w.reads, "records": records, "forbiddenAttempts": forbidden, "retainedAttachment": c.controller.retainedAttachment]
                    try JSONSerialization.data(withJSONObject: trace, options: [.prettyPrinted, .sortedKeys]).write(to: path)
                }
                expect(observed && priorAncestry, "late role supplied precisely after actual navigation ancestry and before own labels")
                if role == "AXTextField" {
                    expect(records.count == 1 && records[0]["keyEquivalent"] as? String == "ArrowRight" && c.a.valid, "unchanged later role remains admissible")
                } else {
                    expect(records.isEmpty, "observed later graph role mismatch must deny without output")
                    expect(!c.a.valid && !c.controller.retainedAttachment, "late mismatch retires attachment")
                    expect(!c.w.reads.contains("A.AXIdentifier") && !c.w.reads.contains("A.AXTitleUIElement"), "role mismatch precedes own-label and association work")
                }
                expect(forbidden.isEmpty, "late proof never attempts editable value or selection")
            }
        }
    }
    static func ownershipCases() throws {
        let baseline = CommandLine.arguments.contains("--baseline-contract")
        try run("ownership pair mechanical actual Reader") { c in
            let reader = HistoryReader(lease: c.a.lease, pid: c.w.pid, identity: c.a.identity)
            reader.inertBind(c)
            expect(reader.owned(c.a), "ordinary bound ownership succeeds")
            print("OWNERSHIP observations=\(c.w.observations) exchanges=\(c.w.exchanges) guards=\(c.w.guardTrace)")
            expect(c.w.observations == (baseline ? 5 : 3), "bound ownership requires three validity observations (baseline five)")
            expect(c.w.exchanges == (baseline ? ["scalar:AXFocusedWindow", "scalar:AXFocusedUIElement"] : ["bulk:AXFocusedWindow,AXFocusedUIElement"]), "one reference-only exchange replaces two requested scalars")
            expect(c.w.contentAttempts(["A", "B", "label", "root"]).isEmpty, "ownership never attempts protected content")
        }
        try run("ownership unbound original scalar window only") { c in
            let reader = HistoryReader(lease: c.a.lease, pid: c.w.pid, identity: c.a.identity)
            expect(reader.owned(c.a), "unbound admitted")
            expect(c.w.observations == 3 && c.w.exchanges == ["scalar:AXFocusedWindow"], "unbound schedule unchanged; no focus request")
        }
        try run("removed-boundary ABA changed sampled contract") { c in
            let reader = HistoryReader(lease: c.a.lease, pid: c.w.pid, identity: c.a.identity); reader.inertBind(c)
            // Explicit getter stimulus: lock exists only at the fourth session observation.
            // Old scalar-focus pre-proof reaches it; new pair has only three samples.
            c.w.onSession = { c.w.locked = c.w.observations == 4 }
            let admitted = reader.owned(c.a)
            expect(admitted == !baseline && reader.inertFatal == baseline, "old sticky denial versus possible new admission is an accepted contract difference")
            print("ABA baseline=\(baseline) admitted=\(admitted) observed=\(c.w.observations)")
            c.w.onSession = nil; c.w.locked = false; c.w.secure = true
            expect(reader.text(c.w.nodes["A"]!, kAXValueAttribute, attachment: c.a) == nil, "later unsafe protected-content gate still denies")
            expect(c.w.contentAttempts(["A", "B", "label", "root"]).isEmpty, "no protected content attempted after unsafe proof")
        }
        for sessionCase in ["empty", "missingLock", "missingConsole", "stringFlags", "numberFlags", "nullFlags", "locked", "offConsole", "nil", "wholeCast"] {
            try run("ownership exact original session predicate " + sessionCase) { c in
                let reader = HistoryReader(lease: c.a.lease, pid: c.w.pid, identity: c.a.identity); reader.inertBind(c)
                switch sessionCase {
                case "empty": c.w.session = [:] as CFDictionary
                case "missingLock": c.w.session = ["kCGSessionOnConsoleKey": true] as CFDictionary
                case "missingConsole": c.w.session = ["CGSSessionScreenIsLocked": false] as CFDictionary
                case "stringFlags": c.w.session = ["CGSSessionScreenIsLocked": "yes", "kCGSessionOnConsoleKey": "no"] as CFDictionary
                case "numberFlags": c.w.session = ["CGSSessionScreenIsLocked": 0, "kCGSessionOnConsoleKey": 1] as CFDictionary
                case "nullFlags": c.w.session = ["CGSSessionScreenIsLocked": NSNull(), "kCGSessionOnConsoleKey": NSNull()] as CFDictionary
                case "locked": c.w.session = ["CGSSessionScreenIsLocked": true] as CFDictionary
                case "offConsole": c.w.session = ["kCGSessionOnConsoleKey": false] as CFDictionary
                case "nil": c.w.session = nil
                default: c.w.session = [NSNumber(value: 23): false] as CFDictionary
                }
                let original: Bool
                if let session = c.w.session as? Object { original = session["CGSSessionScreenIsLocked"] as? Bool != true && session["kCGSessionOnConsoleKey"] as? Bool != false } else { original = false }
                expect(reader.owned(c.a) == original, "actual Reader retains whole Object cast and original Bool bridging predicates")
                expect(c.w.contentAttempts(["A", "B", "root", "label"]).isEmpty, "session predicate probes are reference-only")
            }
        }
        if baseline { return }
        for recovery in [false, true] {
            for boundary in ["before", "after"] {
                for fence in ["none", "focusGeneration", "windowGeneration", "overflow", "Stop"] {
                    try run("ownership retained " + (recovery ? "recovery " : "navigation ") + boundary + " " + fence) { c in
                        let reader = HistoryReader(lease: c.a.lease, pid: c.w.pid, identity: c.a.identity); reader.inertBind(c); reader.inertFence(c, recovery: recovery)
                        let mutate = {
                            switch fence {
                            case "focusGeneration": c.a.notifyFocus("A")
                            case "windowGeneration": c.a.notifyWindow()
                            case "overflow": c.a.inertOverflow()
                            case "Stop": c.a.stop()
                            default: break
                            }
                        }
                        if boundary == "before" { c.w.onRead = { id, name in if id == "app", name == kAXFocusedWindowAttribute, !c.w.triggered { c.w.triggered = true; mutate() } } }
                        else { c.w.onPair = mutate }
                        expect(reader.owned(c.a) == (fence == "none"), "complete original recorded-fence proof remains at both pair boundaries")
                        expect(c.w.contentAttempts(["A", "B", "root", "label"]).isEmpty, "fences checked before protected content")
                        if fence != "none" { expect(reader.inertFatal && !c.w.exchanges.contains { $0.hasPrefix("scalar:") }, "invalid retained fence latches without fallback") }
                    }
                }
            }
        }
        for packet in ["complete", "notImplemented", "nullWindow", "nullFocus", "bothNull", "nullWindowStaleFocus", "nullFocusWrongWindow", "nullWindowWrongFocus", "wrongWindow", "wrongFocus", "empty", "short", "long", "nil", "stringWindow", "stringFocus", "wrappedWindow", "wrappedFocus", "overallFailure", "overallUnsupported", "scalarWindowFails"] {
            try run("ownership packet " + packet) { c in
                let reader = HistoryReader(lease: c.a.lease, pid: c.w.pid, identity: c.a.identity); reader.inertBind(c)
                let root = c.a.root, focus = c.w.nodes["A"]!, other = c.w.nodes["B"]!, null = kCFNull!
                var wrapped = AXError.attributeUnsupported
                let error = AXValueCreate(.axError, &wrapped)!
                let packets: [String: [AnyObject]] = ["complete": [root, focus], "nullWindow": [null, focus], "nullFocus": [root, null], "bothNull": [null, null], "nullWindowStaleFocus": [null, focus], "nullFocusWrongWindow": [other, null], "nullWindowWrongFocus": [null, other], "wrongWindow": [other, focus], "wrongFocus": [root, other], "empty": [], "short": [root], "long": [root, focus, focus], "stringWindow": ["bad" as CFString, focus], "stringFocus": [root, "bad" as CFString], "wrappedWindow": [error, focus], "wrappedFocus": [root, error]]
                if let values = packets[packet] { c.w.pairResponse = (.success, values as CFArray) }
                if packet == "nil" { c.w.pairResponse = (.success, nil) }
                if ["notImplemented", "scalarWindowFails"].contains(packet) { c.w.pairResponse = (.notImplemented, nil) }
                if packet == "overallFailure" { c.w.pairResponse = (.cannotComplete, nil) }
                if packet == "overallUnsupported" { c.w.pairResponse = (.attributeUnsupported, nil) }
                if packet == "nullWindowStaleFocus" { c.w.onPair = { c.w.focus = "B" } }
                if packet == "scalarWindowFails" { c.w.requestedResponses[kAXFocusedWindowAttribute] = (.cannotComplete, nil) }
                let admitted = reader.owned(c.a)
                let allowed = ["complete", "notImplemented", "nullWindow", "nullFocus", "bothNull"].contains(packet)
                expect(admitted == allowed, "only complete matching or fresh compatible scalar pair admitted")
                let fallback = ["notImplemented", "nullWindow", "nullFocus", "bothNull", "nullWindowStaleFocus", "scalarWindowFails"].contains(packet)
                let expected = ["bulk:AXFocusedWindow,AXFocusedUIElement"] + (fallback ? ["scalar:AXFocusedWindow"] + (packet == "scalarWindowFails" ? [] : ["scalar:AXFocusedUIElement"]) : [])
                expect(c.w.exchanges == expected, "full packet discarded once; window before focus; no focus after failed window")
                if packet == "complete" { expect(c.w.comparisons == ["root=root", "A=A"], "reference comparison window then focus") }
                if packet == "wrongWindow" { expect(c.w.comparisons == ["B=root"], "window mismatch precedes focus comparison") }
                expect(c.w.contentAttempts(["A", "B", "root", "label"]).isEmpty, "reference packet never authorizes content")
            }
        }
        for boundary in ["before", "after"] {
            for fault in ["foreground", "pid", "owner", "identity", "secureUnknown", "secure", "trust", "lock", "console", "sessionNil", "wholeCast", "Stop", "lease", "deadline", "window", "focus"] {
                try run("ownership retained " + boundary + " " + fault) { c in
                    let reader = HistoryReader(lease: c.a.lease, pid: c.w.pid, identity: c.a.identity); reader.inertBind(c)
                    let mutate = {
                        switch fault {
                        case "foreground": c.w.foreground = nil
                        case "pid": c.w.foreground = 7
                        case "owner": c.w.owners["app"] = 7
                        case "identity": c.w.processStart += 1
                        case "secureUnknown": c.w.secure = nil
                        case "secure": c.w.secure = true
                        case "trust": c.w.permission = false
                        case "lock": c.w.locked = true
                        case "console": c.w.session = ["kCGSessionOnConsoleKey": false] as CFDictionary
                        case "sessionNil": c.w.session = nil
                        case "wholeCast": c.w.session = [NSNumber(value: 17): false] as CFDictionary
                        case "Stop": c.controller.stop()
                        case "lease": c.a.lease.revoke()
                        case "deadline": c.w.clock = reader.deadline
                        case "window": c.w.focusedWindow = "B"
                        default: c.w.focus = "B"
                        }
                    }
                    if boundary == "before" {
                        c.w.onRead = { id, name in if id == "app", name == kAXFocusedWindowAttribute, !c.w.triggered { c.w.triggered = true; mutate() } }
                    } else { c.w.onPair = mutate }
                    expect(!reader.owned(c.a) && reader.inertFatal, "retained invalid proof or reference denies and latches")
                    expect(reader.text(c.w.nodes["A"]!, kAXValueAttribute, attachment: c.a) == nil, "unsafe content gate denies")
                    expect(c.w.contentAttempts(["A", "B", "root", "label"]).isEmpty, "no value/selection/range attempts")
                    expect(!c.w.exchanges.contains { $0.hasPrefix("scalar:") }, "invalid proof never falls back")
                }
            }
        }
    }
    static func ownershipServiceInterval() throws {
        let baseline = CommandLine.arguments.contains("--baseline-contract")
        try run("requested-reference service interval changed contract") { c in
            let reader = HistoryReader(lease: c.a.lease, pid: c.w.pid, identity: c.a.identity); reader.inertBind(c)
            var servicing = "", services: [String] = []
            c.w.onRequested = { name in if name == kAXFocusedWindowAttribute { servicing = "scalar" } }
            c.w.onPair = { servicing = "pair" }
            c.w.onRead = { id, name in
                guard id == "app", !servicing.isEmpty else { return }
                if name == kAXFocusedWindowAttribute {
                    c.w.secure = true; services.append("requested-window:unsafe")
                    if servicing == "scalar" { servicing = "" }
                } else if name == kAXFocusedUIElementAttribute {
                    c.w.secure = false; services.append("requested-focus:safe"); servicing = ""
                }
            }
            let admitted = reader.owned(c.a)
            expect(admitted == !baseline && reader.inertFatal == baseline, "old window post-proof latches; new pair post-proof can admit after interval ends")
            expect(services == (baseline ? ["requested-window:unsafe"] : ["requested-window:unsafe", "requested-focus:safe"]), "stimulus tracks requested services, excluding direct validity-window reads")
            print("SERVICE-INTERVAL baseline=\(baseline) admitted=\(admitted) services=\(services) guards=\(c.w.guardTrace)")
            // Request-service model, not a shared wall-time trajectory or atomic native exchange.
            c.w.onRead = nil; c.w.onRequested = nil; c.w.onPair = nil; c.w.secure = true
            expect(reader.text(c.w.nodes["A"]!, kAXValueAttribute, attachment: c.a) == nil, "subsequent unsafe protected-content proof denies")
            expect(c.w.contentAttempts(["A", "B", "root", "label"]).isEmpty, "request-service interval permits no protected content attempt")
        }
    }
    static func metadataProofCases() throws {
        try run("metadata proof nested session boundaries") { c in
            let r = HistoryReader(lease: c.a.lease, pid: c.w.pid, identity: c.a.identity); r.inertProofSetup(c)
            let accepted = r.inertProof { r.inertProof { r.inertMetadata(c.w.nodes["A"]!, kAXIdentifierAttribute) == .success } }
            expect(accepted && c.w.observations == 2, "nested metadata samples session only at outer boundaries")
            expect(r.inertProofDepth == 0, "scope always closes")
            expect(r.valid() && c.w.observations == 3, "public valid remains a fresh full guard outside proof")
        }
        for boundary in ["entry", "inside"] {
            for fault in ["foreground", "identity", "secure", "secureUnknown", "trust", "lock", "console", "sessionNil", "wholeCast", "owner", "window", "focus", "Stop", "deadline"] {
                try run("metadata proof " + boundary + " " + fault) { c in
                    let r = HistoryReader(lease: c.a.lease, pid: c.w.pid, identity: c.a.identity); r.inertProofSetup(c)
                    let mutate = {
                        switch fault {
                        case "foreground": c.w.foreground = nil
                        case "identity": c.w.processStart += 1
                        case "secure": c.w.secure = true
                        case "secureUnknown": c.w.secure = nil
                        case "trust": c.w.permission = false
                        case "lock": c.w.locked = true
                        case "console": c.w.session = ["kCGSessionOnConsoleKey": false] as CFDictionary
                        case "sessionNil": c.w.session = nil
                        case "wholeCast": c.w.session = [NSNumber(value: 17): false] as CFDictionary
                        case "owner": c.w.owners["A"] = 7
                        case "window": c.w.focusedWindow = "B"
                        case "focus": c.w.focus = "B"
                        case "Stop": c.controller.stop()
                        default: c.w.clock = r.deadline
                        }
                    }
                    if boundary == "entry" { mutate() }
                    else { c.w.onRead = { id, name in if id == "A", name == kAXIdentifierAttribute { mutate() } } }
                    let accepted = r.inertProof { r.inertMetadata(c.w.nodes["A"]!, kAXIdentifierAttribute) == .success && r.contentPermitted() }
                    expect(!accepted && r.inertProofDepth == 0, "persistent unsafe state denies without leaking scope")
                    expect(c.w.contentAttempts(["A", "B", "root", "label"]).isEmpty, "metadata proof performs no protected query")
                }
            }
        }
        try run("metadata proof protected read is full and failure is sticky") { c in
            let r = HistoryReader(lease: c.a.lease, pid: c.w.pid, identity: c.a.identity); r.inertProofSetup(c)
            let accepted = r.inertProof {
                c.w.locked = true
                let denied = r.read(c.w.nodes["A"]!, kAXValueAttribute).0 != .success
                c.w.locked = false
                return denied
            }
            expect(!accepted, "a later safe session cannot rescue an observed failure")
            expect(c.w.observations == 2, "protected read checks session inside active metadata proof")
            expect(c.w.contentAttempts(["A"]).isEmpty && r.inertProofDepth == 0, "no protected query or leaked scope")
        }
        enum SyntheticFailure: Error { case expected }
        for unsafeExit in [false, true] {
            try run("metadata proof throw exit unsafe=" + String(unsafeExit)) { c in
                let r = HistoryReader(lease: c.a.lease, pid: c.w.pid, identity: c.a.identity); r.inertProofSetup(c)
                var propagated = false, admitted = true
                do { admitted = try r.inertProof { c.w.locked = unsafeExit; throw SyntheticFailure.expected } }
                catch SyntheticFailure.expected { propagated = true }
                expect(propagated == !unsafeExit && (propagated || !admitted), "throw cannot bypass denied exit admission")
                expect(r.inertProofDepth == 0, "throw releases all metadata scope state")
            }
        }
        try run("metadata session ABA is explicitly sampled at boundaries") { c in
            let r = HistoryReader(lease: c.a.lease, pid: c.w.pid, identity: c.a.identity); r.inertProofSetup(c)
            var providerGetterEffects = 0
            c.w.onRead = { id, name in
                if id == "A", name == kAXIdentifierAttribute { c.w.locked = true }
                if id == "A", name == kAXTitleAttribute { if c.w.locked { providerGetterEffects += 1 }; c.w.locked = false }
            }
            let admitted = r.inertProof {
                r.inertMetadata(c.w.nodes["A"]!, kAXIdentifierAttribute) == .success && r.inertMetadata(c.w.nodes["A"]!, kAXTitleAttribute) == .success
            }
            expect(admitted && c.w.observations == 2, "internal session interval can be missed; no old sampling equivalence")
            expect(providerGetterEffects == 1 && c.w.contentAttempts(["A"]).isEmpty, "modeled provider side effect differs from explicit protected queries")
            c.w.locked = true
            expect(r.read(c.w.nodes["A"]!, kAXValueAttribute).0 != .success, "subsequent protected read remains full and denies")
        }
        try run("denied metadata exit cannot undo modeled provider getter") { c in
            let r = HistoryReader(lease: c.a.lease, pid: c.w.pid, identity: c.a.identity); r.inertProofSetup(c)
            var effects = 0
            c.w.onRead = { id, name in
                if id == "A", name == kAXIdentifierAttribute { c.w.locked = true }
                if id == "A", name == kAXTitleAttribute, c.w.locked { effects += 1 }
            }
            let accepted = r.inertProof { r.inertMetadata(c.w.nodes["A"]!, kAXIdentifierAttribute) == .success && r.inertMetadata(c.w.nodes["A"]!, kAXTitleAttribute) == .success }
            expect(!accepted && effects == 1, "exit denies but cannot erase provider-internal side effects")
            expect(c.w.contentAttempts(["A"]).isEmpty && r.inertProofDepth == 0, "explicit protected queries remain absent")
        }
        try JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
        print("PASS metadata proof \(cases) cases / \(assertions) assertions")
    }
    static func writeProofModel(_ object: Object) throws {
        try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
    }
    static func pollModel() throws {
        InertCase.nativeNavigation = true
        let c = try InertCase(); defer { c.close(); InertCase.nativeNavigation = false }
        let w = c.w
        w.model = true
        for (id, role, title) in [("group", "AXGroup", "Ordinary group"), ("static", "AXStaticText", "Ordinary label"), ("credential", "AXTextField", "Credential"), ("secure", "AXSecureTextField", "Secure"), ("pointer", "AXGroup", "Pointer area")] {
            w.nodes[id] = Data(id.utf8) as CFData; w.owners[id] = w.pid; w.add(id, role: role, title: title)
        }
        w.add("A", role: "AXTextArea", title: "Editor")
        w.children = ["root": ["group"], "group": ["static", "A", "credential", "secure", "pointer"]]
        w.parents = ["root": "app", "group": "root", "static": "group", "A": "group", "credential": "group", "secure": "group", "pointer": "group"]
        w.error("root", "AXPrivateBrowsing", .attributeUnsupported)
        w.error("root", "AXURL", .attributeUnsupported)
        w.set("credential", "AXIdentifier", "api-key" as CFString)
        w.set("static", "AXValue", "Ordinary label" as CFString)
        w.set("A", "AXValue", "baseline" as CFString); w.set("A", "AXSelectedText", "base" as CFString)
        var range = CFRange(location: 0, length: 4); w.set("A", "AXSelectedTextRange", AXValueCreate(.cfRange, &range)!)
        var stages: [Object] = [], allRecords: [Object] = []
        for (index, phase) in ["baseline", "programmatic-edit", "selection", "Z", "ArrowRight"].enumerated() {
            if !c.controller.retainedAttachment { stages.append(["phase": phase, "skipped": "attachment retired"]); continue }
            if index == 1 { w.set("A", "AXValue", "programmatic edit" as CFString) }
            if index == 2 { w.set("A", "AXSelectedText", "edit" as CFString); var next = CFRange(location: 13, length: 4); w.set("A", "AXSelectedTextRange", AXValueCreate(.cfRange, &next)!) }
            if index == 3 { w.set("A", "AXValue", "programmatic editZ" as CFString) }
            let captureReader = w.readerIndex + 2
            var delivered = false
            w.onSession = {
                if index >= 3 && w.readerIndex == captureReader && w.clock >= w.readerStart + 50_000_000 && !delivered {
                    delivered = true; c.a.injectKey(index == 3 ? 6 : 124, at: Date(timeIntervalSince1970: 1_700_000_000 + Double(w.readerStart - 1_000_000_000 + 50_000_000) / 1_000_000_000))
                }
            }
            let phaseStart = w.clock, phaseDeadline = phaseStart + 2_500_000_000
            let before = w.observations
            var records: [Object] = [], polls = 0
            func hasOutput() -> Bool {
                switch index {
                case 0: return records.contains { ($0["ax"] as? Object)?["mode"] as? String == "full" }
                case 1: return records.contains { $0["kind"] as? String == "accessibility" && $0["text"] as? String == "programmatic edit" } && records.contains { ($0["ax"] as? Object)?["mode"] as? String == "diff" }
                case 2: return records.contains { let value = $0["selection"] as? Object; return value?["text"] as? String == "edit" && value?["location"] as? Int == 13 && value?["length"] as? Int == 4 }
                case 3: return records.contains { $0["kind"] as? String == "text-input" && $0["text"] as? String == "programmatic editZ" } && records.contains { ($0["ax"] as? Object)?["mode"] as? String == "diff" }
                default: return records.contains { $0["kind"] as? String == "shortcut" && $0["keyEquivalent"] as? String == "ArrowRight" && ($0["modifiers"] as? [String])?.isEmpty == true }
                }
            }
            repeat {
                c.controller.runTick(c.a.lease); polls += 1
                records += c.records()
                if !c.controller.retainedAttachment || (hasOutput() && c.a.queuedCount == 0) { break }
                w.clock += 150_000_000
            } while w.clock < phaseDeadline
            allRecords += records
            let complete = hasOutput() && c.a.queuedCount == 0 && c.controller.inertDropped == 0 && w.clock <= phaseDeadline
            stages.append(["phase": phase, "records": records, "sessions": w.observations - before,
                           "clock": w.clock, "readerIndex": w.readerIndex, "keyDelivered": delivered,
                           "retainedAttachment": c.controller.retainedAttachment, "queuedInputs": c.a.queuedCount,
                           "dropped": c.controller.inertDropped, "polls": polls, "durationNs": w.clock - phaseStart,
                           "complete": complete])
            w.onSession = nil
            if !complete { break }
            w.clock += 1_000_000_000

        }
        let full = allRecords.contains { ($0["ax"] as? Object)?["mode"] as? String == "full" }
        let programmatic = allRecords.contains { $0["kind"] as? String == "accessibility" && $0["text"] as? String == "programmatic edit" }
        let text = allRecords.contains { $0["kind"] as? String == "text-input" && $0["text"] as? String == "programmatic editZ" }
        let selection = allRecords.contains { ($0["selection"] as? Object)?["text"] as? String == "edit" }
        let arrow = allRecords.contains { $0["keyEquivalent"] as? String == "ArrowRight" }
        let forbidden = w.contentAttempts(["credential", "secure", "pointer"])
        let green = stages.count == 5 && stages.allSatisfy { $0["complete"] as? Bool == true } && full && programmatic && text && selection && arrow && forbidden.isEmpty && allRecords.filter { ($0["ax"] as? Object)?["mode"] as? String == "full" }.count == 1
        try writeProofModel(["completeCapture": green, "fullAX": full, "programmaticEdit": programmatic, "textInput": text,
                        "selection": selection, "arrow": arrow, "stages": stages, "reads": w.reads,
                        "exchanges": w.exchanges, "guardTrace": w.guardTrace, "protectedAttempts": forbidden])
        expect(green, "polling full-capture model requires complete baseline/edit/selection/Z/ArrowRight/full AX")
        print("PASS polling full-capture model")
    }
    static func main() throws {
        if CommandLine.arguments.contains("--metadata-only") { try metadataProofCases(); return }
        if CommandLine.arguments.contains("--poll-model") { try pollModel(); return }
        if CommandLine.arguments.contains("--service-only") {
            try ownershipServiceInterval()
            try JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: CommandLine.arguments[1])); return
        }
        if !CommandLine.arguments.contains("--original-only") { try ownershipCases(); try ownershipServiceInterval() }
        if CommandLine.arguments.contains("--ownership-only") {
            try JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: CommandLine.arguments[1])); return
        }
        try navigationLateRoles()
        try navigationSuite()
        try navigationFailures()
        try navigationBoundaries()
        try suite(pair: false)
        try suite(pair: true)
        try pairFacts()
        try zeroCallbackFailures()
        if CommandLine.arguments.count >= 2 { try JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: CommandLine.arguments[1])) }
        print("PASS HistoryReaderInertTests \(cases) cases / \(assertions) assertions")
    }
}

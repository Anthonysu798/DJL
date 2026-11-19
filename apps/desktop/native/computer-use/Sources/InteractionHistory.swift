import AppKit
import ApplicationServices
import CoreGraphics
import Darwin

// All secure-input queries run on InteractionHistory.captureLane; no input callback calls Carbon.
private enum HistorySecureInput {
    private typealias Query = @convention(c) () -> UInt8
    private static let library = dlopen("/System/Library/Frameworks/Carbon.framework/Frameworks/HIToolbox.framework/HIToolbox", RTLD_NOW | RTLD_LOCAL)
    private static let query = library.flatMap { dlsym($0, "IsSecureEventInputEnabled") }.map { unsafeBitCast($0, to: Query.self) }
    static var available: Bool { query != nil }
    static func enabled() -> Bool? { query.map { $0() != 0 } }
}
private struct HistoryInput {
    let type: CGEventType, at: Date, window: CGWindowID, point: CGPoint, button: Int64, count: Int64
    let dx: Double, dy: Double, key: Int64, flags: CGEventFlags
    var sequence: UInt64 = 0
    var navigationName: String? {
        guard type == .keyDown, flags.rawValue == 0 else { return nil }
        return [123: "ArrowLeft", 124: "ArrowRight", 125: "ArrowDown", 126: "ArrowUp", 115: "Home", 119: "End", 116: "PageUp", 121: "PageDown"][key]
    }
    var tabPacket: HistoryTabPacket { HistoryTabPacket(sequence: sequence, window: window, key: key, keyDown: type == .keyDown, modified: !flags.intersection([.maskCommand, .maskControl, .maskAlternate, .maskShift]).isEmpty, at: at.timeIntervalSince1970) }
}
private final class HistoryAttachment {
    let lease: HistoryLease, pid: pid_t, identity: ProcessIdentity, app: NSRunningApplication
    let axApp: AXUIElement, root: AXUIElement, windowID: CGWindowID
    let failure: () -> Void
    let lock = NSLock()
    private var alive = true, inputs: [HistoryInput] = [], changed = true, valueChanged = false, selectionChanged = false, lost = false
    private var inputSequence: UInt64 = 0, focusGeneration: UInt64 = 0, overflowGeneration: UInt64 = 0, windowGeneration: UInt64 = 0
    private var focusSubject: HistoryElementKey?
    private var previousFocusNotice: HistoryFocusNotice<HistoryElementKey>?, latestFocusNotice: HistoryFocusNotice<HistoryElementKey>?
    private var loop: CFRunLoop?, tap: CFMachPort?, observer: AXObserver?, latestKey: TimeInterval?
    var baseline = HistoryContinuity(), previousValue: String?, previousSelection: String?
    var previousValueRead: TimeInterval?
    var previousFocusedElement: HistoryElementKey?
    func keyObserved(before: TimeInterval) -> Bool { lock.withLock { HistoryInputIdentity.keyInInterval(key: latestKey, previousRead: previousValueRead, currentRead: before) } }
    var gesture = HistoryGestureState<HistoryInput>()
    init(lease: HistoryLease, app: NSRunningApplication, identity: ProcessIdentity, root: AXUIElement, windowID: CGWindowID, failure: @escaping () -> Void) {
        self.lease = lease; self.app = app; pid = app.processIdentifier; self.identity = identity; self.failure = failure
        axApp = AXUIElementCreateApplication(pid); self.root = root; self.windowID = windowID
    }
    var valid: Bool { lease.valid && lock.withLock { alive } }
    func stop() {
        let resources = lock.withLock { () -> (CFRunLoop?, CFMachPort?) in
            alive = false; inputs.removeAll(); return (loop, tap)
        }
        if let tap = resources.1 { CFMachPortInvalidate(tap) }
        if let loop = resources.0 { CFRunLoopWakeUp(loop) }
    }
    private func stampLocked() -> HistoryFocusStamp<HistoryElementKey> {
        HistoryFocusStamp(sequence: inputSequence, generation: focusGeneration, subject: focusSubject, overflow: overflowGeneration, lost: lost, windowGeneration: windowGeneration, previousNotice: previousFocusNotice, latestNotice: latestFocusNotice)
    }
    func focusStamp() -> HistoryFocusStamp<HistoryElementKey> { lock.withLock { stampLocked() } }
    func recoveryPacket(_ recovery: HistoryTabRecovery<HistoryElementKey>, clock: UInt64) -> HistoryTabPacket? {
        lock.withLock { recovery.packet(inputs.map(\.tabPacket), stamp: stampLocked(), window: windowID, now: Date().timeIntervalSince1970, clock: clock, authorized: alive && lease.valid) }
    }
    func commitTab(_ recovery: HistoryTabRecovery<HistoryElementKey>, writer: HistoryPipe, record: Object) -> (accepted: Bool, attempted: Bool) {
        lock.withLock {
            var attempted = false
            let accepted = recovery.commit(packets: inputs.map(\.tabPacket), stamp: stampLocked(), window: windowID, now: Date().timeIntervalSince1970,
                clock: DispatchTime.now().uptimeNanoseconds, authorized: alive && lease.valid) { _ in
                attempted = true
                return writer.enqueue(["event": ["type": "activity-record", "epoch": lease.epoch, "record": record]], lease: lease, completion: { _ in })
            }
            if accepted { inputs.removeAll(keepingCapacity: true); latestKey = nil; changed = false; valueChanged = false; selectionChanged = false; lost = false }
            return (accepted, attempted)
        }
    }
    // Queue and callback observations only. The Reader supplies all live AX proof.
    func navigationBinding() -> HistoryFocusStamp<HistoryElementKey>? {
        lock.withLock { alive && lease.valid && inputs.isEmpty && !lost && gesture.isEmpty ? stampLocked() : nil }
    }
    private func navigationFences(_ binding: HistoryFocusStamp<HistoryElementKey>) -> Bool {
        let now = stampLocked()
        return alive && lease.valid && !lost && !binding.lost && now.generation == binding.generation && now.subject == binding.subject &&
            now.windowGeneration == binding.windowGeneration && now.overflow == binding.overflow &&
            now.previousNotice == binding.previousNotice && now.latestNotice == binding.latestNotice
    }
    func navigationCandidate(_ binding: HistoryFocusStamp<HistoryElementKey>) -> HistoryInput? {
        lock.withLock {
            guard navigationFences(binding), gesture.isEmpty, inputs.count == 1, let input = inputs.first,
                  binding.sequence < UInt64.max, inputSequence == binding.sequence + 1, input.sequence == inputSequence,
                  input.window == windowID, input.navigationName != nil else { return nil }
            return input
        }
    }
    enum NavigationState { case ready, queueChanged, invalid }
    private func navigationStateLocked(_ input: HistoryInput, binding: HistoryFocusStamp<HistoryElementKey>, time: HistoryAdmissionTime) -> NavigationState {
        guard navigationFences(binding), gesture.isEmpty, time.valid, let first = inputs.first,
              first.sequence == input.sequence, first.at == input.at, first.key == input.key, first.flags == input.flags, first.window == input.window else { return .invalid }
        if inputs.count > 1 && inputSequence > input.sequence { return .queueChanged }
        return inputs.count == 1 && inputSequence == input.sequence ? .ready : .invalid
    }
    func navigationState(_ input: HistoryInput, binding: HistoryFocusStamp<HistoryElementKey>, time: HistoryAdmissionTime) -> NavigationState {
        lock.withLock { navigationStateLocked(input, binding: binding, time: time) }
    }
    func commitNavigation(_ input: HistoryInput, binding: HistoryFocusStamp<HistoryElementKey>, time: HistoryAdmissionTime, writer: HistoryPipe, record: Object) -> (state: NavigationState, attempted: Bool, accepted: Bool) {
        lock.withLock {
            let state = navigationStateLocked(input, binding: binding, time: time)
            guard state == .ready else { return (state, false, false) }
            let accepted = writer.enqueue(["event": ["type": "activity-record", "epoch": lease.epoch, "record": record]], lease: lease, time: time, completion: { _ in })
            if accepted {
                inputs.removeFirst()
                if latestKey == input.at.timeIntervalSince1970 { latestKey = nil }
            }
            return (state, true, accepted)
        }
    }
    func take() -> ([HistoryInput], Bool, Bool, Bool, Bool) {
        lock.withLock {
            let result = (inputs, changed, valueChanged, selectionChanged, lost)
            inputs.removeAll(keepingCapacity: true); changed = false; valueChanged = false; selectionChanged = false; lost = false
            return result
        }
    }
    private static let axCallback: AXObserverCallback = { _, element, notification, context in
        guard let context = context else { return }
        let owner = Unmanaged<HistoryAttachment>.fromOpaque(context).takeUnretainedValue()
        guard owner.valid, LiveForeground.pid() == owner.pid else { return }
        owner.lock.withLock {
            guard owner.alive else { return }
            if notification as String == kAXFocusedUIElementChangedNotification {
                owner.focusGeneration += 1; owner.focusSubject = HistoryElementKey(element: element)
                owner.previousFocusNotice = owner.latestFocusNotice
                owner.latestFocusNotice = HistoryFocusNotice(generation: owner.focusGeneration, sequence: owner.inputSequence, subject: HistoryElementKey(element: element))
            }
            if notification as String == kAXFocusedWindowChangedNotification { owner.windowGeneration += 1 }
            owner.changed = true
            if notification as String == kAXValueChangedNotification { owner.valueChanged = true }
            if notification as String == kAXSelectedTextChangedNotification { owner.selectionChanged = true }
        }
    }
    private static let tapCallback: CGEventTapCallBack = { _, type, event, context in
        guard let context = context else { return Unmanaged.passUnretained(event) }
        let owner = Unmanaged<HistoryAttachment>.fromOpaque(context).takeUnretainedValue()
        guard owner.valid, LiveForeground.pid() == owner.pid else { return Unmanaged.passUnretained(event) }
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            owner.stop(); owner.failure(); return Unmanaged.passUnretained(event)
        }
        guard event.getIntegerValueField(.eventTargetUnixProcessID) == Int64(owner.pid) else { return Unmanaged.passUnretained(event) }
        // No event characters or Unicode extraction. Numeric metadata only, never a global key stream.
        let point = event.location
        guard point.x.isFinite, point.y.isFinite, abs(point.x) <= 100000, abs(point.y) <= 100000 else { return Unmanaged.passUnretained(event) }
        let rawWindow = event.getIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent)
        let fallback = event.getIntegerValueField(.mouseEventWindowUnderMousePointer)
        let window = HistoryInputIdentity.window(target: event.getIntegerValueField(CGEventField(rawValue: 51)!), underPointer: fallback, handling: rawWindow) ?? 0
        var sample = HistoryInput(type: type, at: Date(), window: window,
            point: point, button: event.getIntegerValueField(.mouseEventButtonNumber), count: event.getIntegerValueField(.mouseEventClickState),
            dx: event.getDoubleValueField(.scrollWheelEventPointDeltaAxis2), dy: event.getDoubleValueField(.scrollWheelEventPointDeltaAxis1),
            key: event.getIntegerValueField(.keyboardEventKeycode), flags: event.flags)
        owner.lock.withLock {
            guard owner.alive else { return }
            owner.inputSequence += 1; sample.sequence = owner.inputSequence
            if type == .keyDown, sample.window == owner.windowID { owner.latestKey = sample.at.timeIntervalSince1970 }
            if owner.inputs.count >= 32 { owner.inputs.removeAll(keepingCapacity: true); owner.lost = true; owner.overflowGeneration += 1 }
            else { owner.inputs.append(sample) }
            owner.changed = true
        }
        return Unmanaged.passUnretained(event)
    }
    func start() {
        Thread { [self] in
            guard valid else { return }
            let context = Unmanaged.passUnretained(self).toOpaque()
            var ax: AXObserver?
            guard AXObserverCreate(pid, Self.axCallback, &ax) == .success, let ax = ax else { stop(); failure(); return }
            let notifications = [kAXFocusedWindowChangedNotification, kAXFocusedUIElementChangedNotification,
                kAXValueChangedNotification, kAXSelectedTextChangedNotification, kAXLayoutChangedNotification, kAXWindowMovedNotification, kAXWindowResizedNotification]
            for name in notifications { AXObserverAddNotification(ax, axApp, name as CFString, context) }
            for name in [kAXValueChangedNotification, kAXSelectedTextChangedNotification, kAXLayoutChangedNotification] {
                AXObserverAddNotification(ax, root, name as CFString, context)
            }
            let types: [CGEventType] = [.leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp,
                .leftMouseDragged, .rightMouseDragged, .otherMouseDragged, .scrollWheel, .keyDown]
            let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
            let input = CGEvent.tapCreateForPid(pid: pid, place: .tailAppendEventTap, options: .listenOnly,
                eventsOfInterest: mask, callback: Self.tapCallback, userInfo: context)
            guard let input = input, let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, input, 0) else { stop(); failure(); return }
            let runLoop = CFRunLoopGetCurrent(), axSource = AXObserverGetRunLoopSource(ax)
            CFRunLoopAddSource(runLoop, source, .commonModes); CFRunLoopAddSource(runLoop, axSource, .commonModes)
            lock.withLock { loop = runLoop; tap = input; observer = ax }
            CGEvent.tapEnable(tap: input, enable: true)
            while valid { CFRunLoopRunInMode(.defaultMode, 0.05, false) }
            CFMachPortInvalidate(input)
            CFRunLoopRemoveSource(runLoop, source, .commonModes); CFRunLoopRemoveSource(runLoop, axSource, .commonModes)
            lock.withLock { observer = nil; tap = nil; loop = nil }
        }.start()
    }
}
private struct HistoryElementKey: Equatable {
    let element: AXUIElement
    static func == (left: Self, right: Self) -> Bool { CFEqual(left.element, right.element) }
}
private final class HistoryLabelProof {
    var budget = HistoryProofBudget<HistoryElementKey>(limit: 64)
    var cache: [(HistoryElementKey, HistoryLabelAssessment)] = []
}
private struct HistoryFocusChange: Error { let recovery: HistoryTabRecovery<HistoryElementKey> }
private final class HistoryReader {
    let lease: HistoryLease, pid: pid_t, identity: ProcessIdentity
    private var boundRoot: AXUIElement?, boundFocused: AXUIElement?
    private var privacyAuthorized = false
    private var navigationFatal = false, navigationGraph = false
    private weak var navigationAttachment: HistoryAttachment?
    private var navigationBinding: HistoryFocusStamp<HistoryElementKey>?, navigationInput: HistoryInput?
    private weak var recoveryAttachment: HistoryAttachment?
    private var recoveryBinding: HistoryFocusStamp<HistoryElementKey>?
    private var recoveryArmed = false, continuationUsed = false
    private var activeRecovery: HistoryTabRecovery<HistoryElementKey>?
    private var structuralVisits = 0, candidateNodes: [Node] = []
    private var candidateWeb = false, candidateDomain: String?
    private var privacyWitnesses: [(AXUIElement, Bool, String?)] = []
    private var metadataProofDepth = 0, metadataProofFailed = false
    let deadline = DispatchTime.now().uptimeNanoseconds + 750_000_000
    init(lease: HistoryLease, pid: pid_t, identity: ProcessIdentity) { self.lease = lease; self.pid = pid; self.identity = identity }
    func valid() -> Bool {
        admitted(checkSession: true)
    }
    private func metadataValid() -> Bool {
        admitted(checkSession: metadataProofDepth == 0)
    }
    private func admitted(checkSession: Bool) -> Bool {
        var passed = false
        defer { if !passed { navigationFatal = true; if metadataProofDepth > 0 { metadataProofFailed = true } } }
        if navigationGraph {
            guard !navigationFatal, let input = navigationInput, let binding = navigationBinding, let attachment = navigationAttachment,
                  attachment.navigationState(input, binding: binding, time: HistoryAdmissionTime(deadline: deadline, capturedAt: input.at.timeIntervalSince1970)) != .invalid else { return false }
        }
        if let recovery = activeRecovery {
            guard let attachment = recoveryAttachment, attachment.valid, attachment.focusStamp() == recovery.end else { return false }
        }
        guard lease.valid, DispatchTime.now().uptimeNanoseconds < deadline, LiveForeground.pid() == pid,
              (try? ProcessIdentity(pid)) == identity, HistorySecureInput.enabled() == false, AXIsProcessTrusted() else { return false }
        if checkSession {
            guard let session = CGSessionCopyCurrentDictionary() as? Object,
                  session["CGSSessionScreenIsLocked"] as? Bool != true, session["kCGSessionOnConsoleKey"] as? Bool != false else { return false }
        }
        if let boundRoot = boundRoot {
            let application = AXUIElementCreateApplication(pid)
            AXUIElementSetMessagingTimeout(application, 0.05)
            var focused: CFTypeRef?
            guard AXUIElementCopyAttributeValue(application, kAXFocusedWindowAttribute as CFString, &focused) == .success,
                  let focused = focused, CFEqual(focused, boundRoot) else { return false }
        }
        passed = true; return true
    }
    // Only synchronous metadata proofs share session boundaries. Content reads always use valid().
    private func metadataProof<T>(denied: T, _ body: () throws -> T) rethrows -> T {
        let outer = metadataProofDepth == 0
        if outer {
            metadataProofFailed = false
            guard valid() else { return denied }
        }
        guard !metadataProofFailed else { return denied }
        metadataProofDepth += 1
        defer { metadataProofDepth -= 1; if outer { metadataProofFailed = false } }
        do {
            let result = try body()
            guard !metadataProofFailed, !outer || valid() else { return denied }
            return result
        } catch {
            guard !metadataProofFailed, !outer || valid() else { return denied }
            throw error
        }
    }
    func read(_ element: AXUIElement, _ name: String) -> (AXError, CFTypeRef?) {
        guard valid() else { return (.cannotComplete, nil) }
        var owner: pid_t = 0
        guard AXUIElementGetPid(element, &owner) == .success, owner == pid else { navigationFatal = true; return (.invalidUIElement, nil) }
        AXUIElementSetMessagingTimeout(element, 0.05)
        var value: CFTypeRef?
        guard lease.valid, LiveForeground.pid() == pid, HistorySecureInput.enabled() == false else { navigationFatal = true; return (.cannotComplete, nil) }
        let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
        return valid() ? (error, value) : (.cannotComplete, nil)
    }
    private func readMetadata(_ element: AXUIElement, _ name: String) -> (AXError, CFTypeRef?) {
        guard metadataCurrent(element) else { return (.cannotComplete, nil) }
        AXUIElementSetMessagingTimeout(element, 0.05)
        guard lease.valid, LiveForeground.pid() == pid, HistorySecureInput.enabled() == false else {
            navigationFatal = true; if metadataProofDepth > 0 { metadataProofFailed = true }
            return (.cannotComplete, nil)
        }
        var value: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(element, name as CFString, &value)
        return metadataCurrent(element) ? (status, value) : (.cannotComplete, nil)
    }
    func element(_ value: CFTypeRef?) -> AXUIElement? {
        guard let value = value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return unsafeBitCast(value, to: AXUIElement.self)
    }
    private func metadataCurrent(_ element: AXUIElement) -> Bool {
        var passed = false
        defer { if !passed { self.navigationFatal = true; if metadataProofDepth > 0 { metadataProofFailed = true } } }
        guard self.metadataValid() else { return false }
        var owner: pid_t = 0
        guard AXUIElementGetPid(element, &owner) == .success, owner == self.pid else { return false }
        passed = self.lease.valid && LiveForeground.pid() == self.pid && HistorySecureInput.enabled() == false && DispatchTime.now().uptimeNanoseconds < self.deadline
        return passed
    }
    private func metadataGroup(_ element: AXUIElement, _ group: HistoryMetadata.Group) -> [HistoryMetadata.Result]? {
        HistoryMetadata.read(group, current: { self.metadataCurrent(element)
        }, bulk: { names in
            AXUIElementSetMessagingTimeout(element, 0.05)
            var values: CFArray?
            let error = AXUIElementCopyMultipleAttributeValues(element, names as CFArray, [], &values)
            return (error, values)
        }, scalar: { self.readMetadata(element, $0) })
    }
    func metadata(_ element: AXUIElement) -> (String, String, Bool)? {
        guard let fields = metadataGroup(element, .structural) else { return nil }
        let role = fields[0], subrole = fields[1], protected = fields[2]
        guard role.0 == .success, let roleName = role.1 as? String,
              [.success, .attributeUnsupported, .noValue].contains(subrole.0), [.success, .attributeUnsupported, .noValue].contains(protected.0) else { return nil }
        if subrole.0 == .success && !(subrole.1 is String) { return nil }
        if protected.0 == .success, let value = protected.1, CFGetTypeID(value) != CFBooleanGetTypeID() { return nil }
        if navigationGraph {
            let matches = candidateNodes.filter { CFEqual($0.element, element) }
            guard matches.count == 1, matches[0].role == roleName else { navigationFatal = true; return nil }
        }
        return (roleName, subrole.1 as? String ?? "", (protected.1 as? NSNumber)?.boolValue ?? false)
    }
    private func structuralAncestry(_ element: AXUIElement, to root: AXUIElement, nativeOnly: Bool = false) -> [AXUIElement]? {
        var current = element, seen: [AXUIElement] = []
        for _ in 0..<32 {
            guard let info = metadata(current), HistorySecurity.safe(role: info.0, subrole: info.1, protected: info.2),
                  !nativeOnly || info.0 != "AXWebArea", !seen.contains(where: { CFEqual($0, current) }) else { return nil }
            seen.append(current)
            let covered = activeRecovery != nil || navigationGraph
            let matches = covered ? candidateNodes.filter { CFEqual($0.element, current) } : []
            let candidate = matches.first
            if covered { guard let candidate = candidate, candidate.role == info.0, !navigationGraph || matches.count == 1 else { return nil } }
            if CFEqual(current, root) { return Array(seen.reversed()) }
            guard let parent = self.element(readMetadata(current, kAXParentAttribute).1) else { return nil }
            if let candidate = candidate {
                guard let separator = candidate.path.lastIndex(of: "."), let expected = candidateNodes.first(where: { $0.path == String(candidate.path[..<separator]) }), CFEqual(parent, expected.element) else { return nil }
            }
            current = parent
        }
        return nil
    }
    private func structuralPath(_ element: AXUIElement, to root: AXUIElement, nativeOnly: Bool = false) -> Bool {
        structuralAncestry(element, to: root, nativeOnly: nativeOnly) != nil
    }
    private func safeLabels(_ element: AXUIElement, proof: HistoryLabelProof) throws -> Bool {
        if case .trusted(let labels, _) = try assessLabels(element, proof: proof) { return !HistorySecurity.credentialLabel(labels) }
        return false
    }
    func labelAssessment(_ element: AXUIElement) throws -> HistoryLabelAssessment {
        guard privacyAuthorized, let root = boundRoot, let ancestors = structuralAncestry(element, to: root) else { return .denied }
        let proof = HistoryLabelProof()
        guard try HistoryAncestry.permitsRootToLeaf(Array(ancestors.dropLast()), assess: { try safeLabels($0, proof: proof) }) else { return .denied }
        return try assessLabels(element, proof: proof)
    }
    private func assessLabels(_ element: AXUIElement, proof: HistoryLabelProof) throws -> HistoryLabelAssessment {
        let key = HistoryElementKey(element: element)
        if let previous = proof.cache.first(where: { $0.0 == key }) { return previous.1 }
        guard proof.budget.enter(key) else { return .denied }
        defer { proof.budget.leave(key) }
        let result = try collectLabels(element, proof: proof)
        proof.cache.append((key, result)); return result
    }
    private struct OwnLabelMetadata {
        var labels: [String] = [], affirmative: [String] = []
        var descriptionFailed = false
        var title: String?
    }
    private func ownLabelMetadata(_ element: AXUIElement, role: String) -> OwnLabelMetadata? {
        var result = OwnLabelMetadata()
        for name in [kAXIdentifierAttribute, kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute] {
            let value = readMetadata(element, name)
            if name == kAXDescriptionAttribute, value.0 == .failure {
                guard HistorySecurity.textRoles.contains(role) else { return nil }
                result.descriptionFailed = true; continue
            }
            guard [.success, .attributeUnsupported, .noValue].contains(value.0) else { return nil }
            if value.0 == .success {
                guard let label = value.1 as? String, label.utf16.count <= 4096 else { return nil }
                result.labels.append(label)
                if name == kAXTitleAttribute { result.title = HistoryText.clean(label, limit: 512) }
                if name == kAXIdentifierAttribute || name == kAXTitleAttribute { result.affirmative.append(label) }
                if HistorySecurity.credentialLabel(result.labels) { return result }
            }
        }
        return result
    }
    private func collectLabels(_ element: AXUIElement, proof: HistoryLabelProof) throws -> HistoryLabelAssessment {
        guard privacyAuthorized, let info = metadata(element), HistorySecurity.safe(role: info.0, subrole: info.1, protected: info.2),
              let own = ownLabelMetadata(element, role: info.0), let root = boundRoot else { return .denied }
        var labels = own.labels, affirmative = own.affirmative
        if HistorySecurity.credentialLabel(labels) { return .trusted(labels, title: own.title) }
        if own.descriptionFailed && !structuralPath(element, to: root, nativeOnly: true) { return .denied }
        let association = readMetadata(element, kAXTitleUIElementAttribute)
        guard [.success, .attributeUnsupported, .noValue].contains(association.0) else { return .denied }
        if association.0 == .success {
            guard let linked = self.element(association.1), !CFEqual(linked, element), let linkedInfo = metadata(linked) else { return .denied }
            if linkedInfo.0 != "AXStaticText" {
                // An unresolved label never authorizes this field. A complete structural scan can still establish unrelated safe content.
                guard HistorySecurity.textRoles.contains(info.0), structuralPath(element, to: root, nativeOnly: true) else { return .denied }
                return .excludedAssociation
            }
            guard HistorySecurity.safe(role: linkedInfo.0, subrole: linkedInfo.1, protected: linkedInfo.2),
                  let linkedAncestors = structuralAncestry(linked, to: root) else { return .denied }
            let next = readMetadata(linked, kAXTitleUIElementAttribute)
            guard next.0 == .attributeUnsupported || next.0 == .noValue else { return .denied }
            // A normal window's static title points naturally back to that window through AXParent.
            // Its own completed metadata permits this security-label read only; no in-progress full verdict is cached.
            let origin = HistoryElementKey(element: element)
            guard try HistoryAncestry.permitsSecurityLabelAncestors(linkedAncestors.dropLast().map { HistoryElementKey(element: $0) },
                origin: origin, ownMetadataAllowed: true, assessOther: { try safeLabels($0.element, proof: proof) }) else { return .denied }
            guard let linkedOwn = ownLabelMetadata(linked, role: linkedInfo.0) else { return .denied }
            if HistorySecurity.credentialLabel(linkedOwn.labels) { return .trusted(labels + linkedOwn.labels, title: own.title) }
            var supplied = false
            for name in [kAXTitleAttribute, kAXValueAttribute] {
                guard try currentPrivacy() else { return .denied }
                let result = read(linked, name)
                guard [.success, .attributeUnsupported, .noValue].contains(result.0) else { return .denied }
                if result.0 == .success {
                    guard let label = result.1 as? String, label.utf16.count <= 512 else { return .denied }
                    labels.append(label); affirmative.append(label); supplied = supplied || !label.isEmpty
                    if HistorySecurity.credentialLabel(labels) { return .trusted(labels, title: own.title) }
                }
            }
            guard supplied else { return .denied }
        }
        guard HistorySecurity.permitsLabels(role: info.0, labels: affirmative, descriptionFailed: own.descriptionFailed, associationKnown: true) else { return .denied }
        return .trusted(labels, title: own.title)
    }
    func path(_ element: AXUIElement, to root: AXUIElement) -> Bool { (try? proofPath(element, to: root)) == true }
    private func proofPath(_ element: AXUIElement, to root: AXUIElement) throws -> Bool {
        guard privacyAuthorized else { return false }
        return try metadataProof(denied: false) {
            guard let ancestors = structuralAncestry(element, to: root) else { return false }
            let proof = HistoryLabelProof()
            return try HistoryAncestry.permitsRootToLeaf(ancestors, assess: { try safeLabels($0, proof: proof) })
        }
    }
    func contentPermitted() -> Bool { (try? currentPrivacy()) == true }
    private func permitsRootTitle() -> Bool {
        guard let root = boundRoot else { return false }
        let title = readMetadata(root, kAXTitleAttribute)
        return title.0 == .success && HistorySecurity.permitsWindowTitle(title.1 as? String)
    }
    private func currentPrivacy() throws -> Bool {
        guard privacyAuthorized else { return false }
        return try currentPolicy()
    }
    private func currentPolicy() throws -> Bool {
        try metadataProof(denied: false) { try currentPolicyMetadata() }
    }
    private func currentPolicyMetadata() throws -> Bool {
        guard metadataValid(), permitsRootTitle() else { return false }
        if let boundFocused = boundFocused {
            let before = recoveryAttachment?.focusStamp()
            guard let current = element(readMetadata(AXUIElementCreateApplication(pid), kAXFocusedUIElementAttribute).1) else { return false }
            if !CFEqual(current, boundFocused) {
                guard recoveryArmed, let attachment = recoveryAttachment, attachment.valid, let start = recoveryBinding, let before = before,
                      candidateNodes.contains(where: { CFEqual($0.element, boundFocused) }),
                      candidateNodes.contains(where: { CFEqual($0.element, current) }) else { return false }
                var oldPID: pid_t = 0, newPID: pid_t = 0
                guard AXUIElementGetPid(boundFocused, &oldPID) == .success, oldPID == pid,
                      AXUIElementGetPid(current, &newPID) == .success, newPID == pid, metadataValid() else { return false }
                let end = attachment.focusStamp()
                guard let recovery = HistoryTabRecovery(old: HistoryElementKey(element: boundFocused), new: HistoryElementKey(element: current), root: HistoryElementKey(element: attachment.root), start: start, before: before, end: end,
                    deadline: deadline, now: DispatchTime.now().uptimeNanoseconds, visits: structuralVisits, completedScan: !candidateNodes.isEmpty, titleAdmitted: true) else { return false }
                throw HistoryFocusChange(recovery: recovery)
            }
        }
        for (element, requiredFalse, expectedHost) in privacyWitnesses {
            var sawFalse = false
            guard let flags = metadataGroup(element, .privacy) else { return false }
            for result in flags {
                guard [.success, .attributeUnsupported, .noValue].contains(result.0) else { return false }
                if result.0 == .success {
                    guard let value = result.1, CFGetTypeID(value) == CFBooleanGetTypeID(), (value as? NSNumber)?.boolValue == false else { return false }
                    sawFalse = true
                }
            }
            guard !requiredFalse || sawFalse, host(element) == expectedHost else { return false }
        }
        return metadataValid()
    }
    // nil discards the entire packet and selects the original freshly guarded scalar path.
    private func ownershipPair(_ attachment: HistoryAttachment, focused: AXUIElement) -> Bool? {
        let application = attachment.axApp
        guard metadataCurrent(application) else { return false }
        AXUIElementSetMessagingTimeout(application, 0.05)
        var values: CFArray?
        let error = AXUIElementCopyMultipleAttributeValues(application, [kAXFocusedWindowAttribute, kAXFocusedUIElementAttribute] as CFArray, [], &values)
        guard metadataCurrent(application) else { return false }
        if error == .notImplemented { return nil }
        guard error == .success, let values = values, CFGetTypeID(values) == CFArrayGetTypeID(), CFArrayGetCount(values) == 2 else { return false }
        let fields = values as [AnyObject]
        var unresolved = false
        for (value, expected) in zip(fields, [attachment.root, focused]) {
            if CFGetTypeID(value) == CFNullGetTypeID() { unresolved = true; continue }
            guard let reference = element(value), CFEqual(reference, expected) else { return false }
        }
        return unresolved ? nil : true
    }
    func owned(_ attachment: HistoryAttachment) -> Bool {
        var passed = false
        defer { if !passed { navigationFatal = true } }
        guard attachment.valid, metadataValid() else { return false }
        if let boundFocused = boundFocused, let matched = ownershipPair(attachment, focused: boundFocused) {
            guard matched else { return false }
        } else {
            guard let current = element(readMetadata(attachment.axApp, kAXFocusedWindowAttribute).1), CFEqual(current, attachment.root) else { return false }
            if let boundFocused = boundFocused {
                guard let current = element(readMetadata(attachment.axApp, kAXFocusedUIElementAttribute).1), CFEqual(current, boundFocused) else { return false }
            }
        }
        passed = true; return true
    }
    func text(_ element: AXUIElement, _ name: String, attachment: HistoryAttachment, limit: Int = 4096) -> String? {
        HistorySecurity.read(lease: lease, systemSecure: HistorySecureInput.enabled(), owned: owned(attachment), safePath: path(element, to: attachment.root), privacyAuthorized: contentPermitted()) {
            let result = self.read(element, name)
            guard result.0 == .success, let value = result.1 as? String else { return nil }
            return HistoryText.clean(value, limit: limit)
        }
    }
    func rect(_ element: AXUIElement) -> CGRect? {
        guard let position = read(element, kAXPositionAttribute).1, CFGetTypeID(position) == AXValueGetTypeID(),
              let size = read(element, kAXSizeAttribute).1, CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero, dimensions = CGSize.zero
        guard AXValueGetValue(unsafeBitCast(position, to: AXValue.self), .cgPoint, &point),
              AXValueGetValue(unsafeBitCast(size, to: AXValue.self), .cgSize, &dimensions),
              point.x.isFinite, point.y.isFinite, dimensions.width.isFinite, dimensions.height.isFinite,
              abs(point.x) <= 100000, abs(point.y) <= 100000, dimensions.width > 0, dimensions.height > 0,
              dimensions.width <= 100000, dimensions.height <= 100000 else { return nil }
        return CGRect(origin: point, size: dimensions)
    }
    func host(_ element: AXUIElement) -> String? {
        let value = readMetadata(element, "AXURL").1 ?? readMetadata(element, kAXDocumentAttribute).1
        let string = (value as? URL)?.absoluteString ?? value as? String
        guard let string = string, string.utf16.count <= 8192, let url = URL(string: string),
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""), let rawHost = url.host?.lowercased() else { return nil }
        let host = rawHost.hasSuffix(".") ? String(rawHost.dropLast()) : rawHost
        guard host.utf16.count <= 253, host.range(of: #"^(?:[a-z0-9-]+\.)*[a-z0-9-]+$"#, options: .regularExpression) != nil else { return nil }
        return host
    }
    struct Node { let element: AXUIElement, role: String, path: String; var title: String? = nil }
    enum Admission { case context([Node], Bool, String?), navigation(HistoryInput) }
    private func selectNavigation() {
        guard navigationInput == nil, !navigationFatal, let binding = navigationBinding, let attachment = navigationAttachment else { return }
        navigationInput = attachment.navigationCandidate(binding)
    }
    func preflight(_ attachment: HistoryAttachment, allowFocusRecovery: Bool = false, allowNavigation: Bool = false) throws -> Admission? {
        defer { recoveryArmed = false }
        recoveryAttachment = allowFocusRecovery ? attachment : nil; recoveryBinding = nil; candidateNodes.removeAll(); structuralVisits = 0
        boundRoot = attachment.root; boundFocused = nil; privacyAuthorized = false; privacyWitnesses.removeAll()
        return try metadataProof(denied: nil) {
            try preflightMetadata(attachment, allowFocusRecovery: allowFocusRecovery, allowNavigation: allowNavigation)
        }
    }
    private func preflightMetadata(_ attachment: HistoryAttachment, allowFocusRecovery: Bool, allowNavigation: Bool) throws -> Admission? {
        guard owned(attachment), structuralPath(attachment.root, to: attachment.root) else { return nil }
        let navigationBefore = allowNavigation ? attachment.navigationBinding() : nil
        let beforeBinding = attachment.focusStamp()
        guard let focused = element(readMetadata(attachment.axApp, kAXFocusedUIElementAttribute).1), structuralPath(focused, to: attachment.root) else { return nil }
        boundFocused = focused
        recoveryBinding = HistoryFocusStamp.binding(before: beforeBinding, after: attachment.focusStamp())
        if let before = navigationBefore, attachment.navigationBinding() == before {
            navigationBinding = before; navigationAttachment = attachment
        }
        let bundle = attachment.app.bundleIdentifier?.lowercased() ?? ""
        var web = ["safari", "chrome", "chromium", "firefox", "brave", "edge", "vivaldi", "opera", "browser", "kagi.kagimac"].contains(where: bundle.contains)
        var domains = Set<String>(), structuralNodes: [Node] = []
        var queue: [(AXUIElement, Int, String, Bool?)] = [(attachment.root, 0, "0", nil)], index = 0
        var browserPrivate: Bool? = nil
        while index < queue.count {
            guard index < 192, metadataValid() else { return nil }
            let (node, depth, nodePath, inherited) = queue[index]; index += 1; structuralVisits += 1
            guard let metadata = metadata(node) else { return nil }
            if metadata.2 || metadata.0.localizedCaseInsensitiveContains("secure") || metadata.1.localizedCaseInsensitiveContains("secure") ||
                metadata.0.localizedCaseInsensitiveContains("password") || metadata.1.localizedCaseInsensitiveContains("password") { continue }
            guard HistorySecurity.ordinaryRoles.contains(metadata.0) else { return nil }
            var privacy = inherited, explicitFalse = false
            guard let flags = metadataGroup(node, .privacy) else { return nil }
            for result in flags {
                guard [.success, .attributeUnsupported, .noValue].contains(result.0) else { return nil }
                if result.0 == .success {
                    guard let value = result.1, CFGetTypeID(value) == CFBooleanGetTypeID() else { return nil }
                    if (value as? NSNumber)?.boolValue == true { return nil }
                    privacy = false; explicitFalse = true
                }
            }
            if nodePath == "0" { browserPrivate = privacy; if let host = host(node) { domains.insert(host) } }
            if metadata.0 == "AXWebArea" {
                web = true
                guard privacy == false else { return nil }
                if let host = host(node) { domains.insert(host) }
                else if !lease.settings.includedDomains.isEmpty || !lease.settings.excludedDomains.isEmpty { return nil }
            }
            if nodePath == "0" || metadata.0 == "AXWebArea" || explicitFalse {
                privacyWitnesses.append((node, explicitFalse, host(node)))
            }
            structuralNodes.append(Node(element: node, role: metadata.0, path: nodePath))
            guard metadataValid() else { return nil }
            var count: CFIndex = 0
            let countResult = AXUIElementGetAttributeValueCount(node, kAXChildrenAttribute as CFString, &count)
            if countResult == .attributeUnsupported || countResult == .noValue { selectNavigation(); continue }
            guard countResult == .success, count >= 0, count <= 192 - queue.count else { return nil }
            if count > 0 {
                guard depth < 24, metadataValid() else { return nil }
                var children: CFArray?
                guard AXUIElementCopyAttributeValues(node, kAXChildrenAttribute as CFString, 0, count, &children) == .success,
                      let values = children as? [AXUIElement], values.count == count else { return nil }
                queue += values.enumerated().map { ($0.element, depth + 1, nodePath + "." + String($0.offset), privacy) }
            }
            selectNavigation()
        }
        // An embedded web area's own explicit false can authorize that area; a sibling false cannot authorize a browser window.
        let privateState = web && !["safari", "chrome", "chromium", "firefox", "brave", "edge", "vivaldi", "opera", "browser", "kagi.kagimac"].contains(where: bundle.contains) ? false : browserPrivate
        guard lease.settings.permitsWeb(web: web, privateState: privateState, domains: Array(domains), complete: true), owned(attachment), permitsRootTitle() else { return nil }
        candidateNodes = structuralNodes; candidateWeb = web; candidateDomain = domains.sorted().first
        if web || !domains.isEmpty { navigationInput = nil; navigationBinding = nil; navigationAttachment = nil }
        recoveryArmed = allowFocusRecovery && recoveryBinding != nil
        privacyAuthorized = true
        if let input = navigationInput { recoveryArmed = false; return .navigation(input) }
        guard try currentPrivacy(), try proofPath(attachment.root, to: attachment.root), try proofPath(focused, to: attachment.root) else { return nil }
        selectNavigation()
        if let input = navigationInput { recoveryArmed = false; return .navigation(input) }
        guard let nodes = try classify(structuralNodes) else { return nil }
        if let input = navigationInput { recoveryArmed = false; return .navigation(input) }
        return .context(nodes, web, domains.sorted().first)
    }
    private func classify(_ structuralNodes: [Node]) throws -> [Node]? {
        var nodes: [Node] = [], excludedPaths = Set<String>()
        for node in structuralNodes {
            guard try currentPrivacy() else { return nil }
            let parentPath = node.path.lastIndex(of: ".").map { String(node.path[..<$0]) }
            let ancestorExcluded = parentPath.map { excludedPaths.contains($0) } ?? false
            let assessment = try ancestorExcluded ? HistoryLabelAssessment.denied : labelAssessment(node.element)
            let scope = HistoryProjectionPolicy.scope(role: node.role, labels: assessment, ancestorExcluded: ancestorExcluded)
            guard scope != .denied else { return nil }
            var excluded = scope == .excluded
            if case .trusted(let labels, _) = assessment, HistorySecurity.credentialLabel(labels) { excluded = true }
            if excluded { excludedPaths.insert(node.path) }
            else {
                var projected = node
                if case .trusted(_, let title) = assessment { projected.title = title }
                nodes.append(projected)
            }
            selectNavigation()
            if navigationInput != nil { break }
        }
        return nodes
    }
    func navigation(_ attachment: HistoryAttachment) throws -> (HistoryInput, HistoryFocusStamp<HistoryElementKey>, HistoryAdmissionTime)? {
        recoveryArmed = false; navigationGraph = true
        guard !navigationFatal, let input = navigationInput, let binding = navigationBinding, let focused = boundFocused else { return nil }
        let time = HistoryAdmissionTime(deadline: deadline, capturedAt: input.at.timeIntervalSince1970)
        guard attachment.navigationState(input, binding: binding, time: time) != .invalid,
              try currentPrivacy(), try proofPath(attachment.root, to: attachment.root), try proofPath(focused, to: attachment.root),
              owned(attachment), try currentPrivacy(), !navigationFatal,
              attachment.navigationState(input, binding: binding, time: time) != .invalid else { return nil }
        return (input, binding, time)
    }
    private func consistentCandidates(_ attachment: HistoryAttachment) -> Bool {
        guard candidateNodes.contains(where: { CFEqual($0.element, attachment.root) }) else { return false }
        for node in candidateNodes {
            guard let info = metadata(node.element), info.0 == node.role, HistorySecurity.safe(role: info.0, subrole: info.1, protected: info.2) else { return false }
            if node.path == "0" { guard CFEqual(node.element, attachment.root) else { return false }; continue }
            guard let separator = node.path.lastIndex(of: "."), let parent = candidateNodes.first(where: { $0.path == String(node.path[..<separator]) }),
                  let actual = element(read(node.element, kAXParentAttribute).1), CFEqual(actual, parent.element) else { return false }
        }
        return true
    }
    func continueTab(_ recovery: HistoryTabRecovery<HistoryElementKey>, attachment: HistoryAttachment) -> HistoryTabPacket? {
        guard !continuationUsed else { return nil }; continuationUsed = true; recoveryArmed = false
        guard recovery.begin(now: DispatchTime.now().uptimeNanoseconds, visits: structuralVisits),
              recoveryAttachment === attachment, attachment.valid,
              candidateNodes.contains(where: { CFEqual($0.element, recovery.old.element) }),
              candidateNodes.contains(where: { CFEqual($0.element, recovery.new.element) }) else { return nil }
        guard attachment.recoveryPacket(recovery, clock: DispatchTime.now().uptimeNanoseconds) != nil else { return nil }
        activeRecovery = recovery
        boundFocused = recovery.new.element; privacyAuthorized = false
        guard owned(attachment), (try? currentPolicy()) == true, consistentCandidates(attachment) else { return nil }
        privacyAuthorized = true
        let proved = HistoryTabProof.authorize(policy: { self.owned(attachment) && self.contentPermitted() },
            oldPath: { self.path(recovery.old.element, to: attachment.root) }, newPath: { self.path(recovery.new.element, to: attachment.root) },
            classifyAll: {
                guard let nodes = try? self.classify(self.candidateNodes) else { return false }
                return nodes.contains(where: { CFEqual($0.element, recovery.old.element) }) && nodes.contains(where: { CFEqual($0.element, recovery.new.element) })
            }, final: { self.owned(attachment) && self.contentPermitted() })
        guard proved else { return nil }
        return attachment.recoveryPacket(recovery, clock: DispatchTime.now().uptimeNanoseconds)
    }
    var tabContext: (Bool, String?) { (candidateWeb, candidateDomain) }
}

final class InteractionHistory {
    static let shared = InteractionHistory()
    private let lock = NSLock()
    fileprivate let captureLane = DispatchQueue(label: "com.djl.history.capture")
    private var lease: HistoryLease?, pipe: HistoryPipe?, timer: DispatchSourceTimer?, attachment: HistoryAttachment?
    private var configuration: Data?, controlEpoch: String?, terminated = false, transportFailed = false
    private var transitionLease: HistoryLease?, transitions = HistoryTransitions() // Capture lane only.
    private var dropped = 0, lossFlush: HistoryLossFlush?, pendingStatus: DispatchWorkItem? // Controller lock.
    private let parentBundle: String? = {
        let pid = getppid()
        guard let identity = try? ProcessIdentity(pid), let app = NSRunningApplication(processIdentifier: pid),
              app.executableURL?.resolvingSymlinksInPath().standardizedFileURL == identity.executable else { return nil }
        return app.bundleIdentifier
    }()
    private func status(_ epoch: String, state: String, reason: String? = nil, expected: HistoryLease? = nil) {
        // Queue insertion is ordered with control transitions. The writer invokes authority outside its own lock.
        lock.withLock {
            guard controlEpoch == epoch, !terminated else { return }
            let statusLease = lease
            if state == "observing" {
                guard let statusLease = statusLease, statusLease.valid, expected == nil || statusLease === expected else { return }
            }
            var event: Object = ["type": "activity-observer-status", "epoch": epoch, "state": state, "droppedRecords": dropped]
            if let reason = reason { event["reason"] = reason }
            pipe?.setStatus(["event": event], current: { [weak self, weak statusLease] in
                guard let self = self else { return false }
                return self.lock.withLock {
                    self.controlEpoch == epoch && !self.terminated &&
                        (state != "observing" || (statusLease != nil && self.lease === statusLease && statusLease?.valid == true))
                }
            })
        }
    }
    func configure(epoch: String, settings: Object) throws -> Object {
        guard !epoch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, epoch.utf16.count <= 128 else { throw HistoryInvalid() }
        let policy = try HistorySettings(settings), encoded = try JSONSerialization.data(withJSONObject: settings, options: [.sortedKeys])
        let existing = lock.withLock { () -> Bool? in
            if terminated { return false }
            if controlEpoch == epoch, configuration == encoded { return lease?.valid == true && pipe?.available == true }
            return nil
        }
        if let existing = existing { return ["epoch": epoch, "observing": existing] }
        stop()
        lock.withLock { controlEpoch = epoch; configuration = encoded; dropped = 0 }
        guard policy.observing else { status(epoch, state: "inactive"); return ["epoch": epoch, "observing": false] }
        if lock.withLock({ pipe == nil && !transportFailed }), ProcessInfo.processInfo.environment["DJL_CUA_ACTIVITY_FD"] == "3" {
            let candidate = try? HistoryPipe(descriptor: 3, failure: { [weak self] in self?.failedTransport() })
            lock.withLock { pipe = candidate }
        }
        guard lock.withLock({ pipe?.available == true && !transportFailed }) else {
            status(epoch, state: "unavailable", reason: "transport-unavailable"); return ["epoch": epoch, "observing": false]
        }
        guard AXIsProcessTrusted() else { status(epoch, state: "unavailable", reason: "permission-denied"); return ["epoch": epoch, "observing": false] }
        guard HistorySecureInput.available else { status(epoch, state: "unavailable", reason: "secure-state-unavailable"); return ["epoch": epoch, "observing": false] }
        let next = HistoryLease(epoch: epoch, settings: policy)
        let source = DispatchSource.makeTimerSource(queue: captureLane)
        source.schedule(deadline: .now(), repeating: .milliseconds(150))
        source.setEventHandler { [weak self, weak next] in if let next = next { self?.tick(next) } }
        let installed = lock.withLock { () -> Bool in
            guard !terminated, !transportFailed, controlEpoch == epoch, configuration == encoded, pipe?.available == true else { return false }
            lease = next; timer = source; lossFlush = HistoryLossFlush(lastPublished: ProcessInfo.processInfo.systemUptime); return true
        }
        source.resume()
        guard installed else { next.revoke(); source.cancel(); return ["epoch": epoch, "observing": false] }
        status(epoch, state: "observing", expected: next)
        return ["epoch": epoch, "observing": true]
    }
    @discardableResult func stop(expected: HistoryLease? = nil) -> Bool {
        let previous = lock.withLock { () -> (HistoryLease?, DispatchSourceTimer?, HistoryAttachment?, HistoryPipe?, String?)? in
            if let expected = expected, lease !== expected { return nil }
            let previous = (lease, timer, attachment, pipe, controlEpoch)
            lease?.revoke(); lease = nil; timer = nil; attachment = nil
            pendingStatus?.cancel(); pendingStatus = nil; lossFlush?.cancel(); lossFlush = nil
            return previous
        }
        guard let previous = previous else { return false }
        previous.1?.cancel(); previous.2?.stop(); previous.3?.discardRevoked()
        if let epoch = previous.4 { status(epoch, state: "inactive") }
        return true
    }
    func shutdown() {
        stop()
        let writer = lock.withLock { () -> HistoryPipe? in terminated = true; return pipe }
        writer?.close()
    }
    private func failedTransport() {
        lock.withLock { transportFailed = true }
        stop()
    }
    private func failedCapture(_ failed: HistoryLease) {
        guard stop(expected: failed) else { return }
        status(failed.epoch, state: "unavailable", reason: "capture-failed")
    }
    private func lose(_ attachment: HistoryAttachment, recordDropped: Bool = true) {
        attachment.baseline.lost()
        // Missing numeric samples cannot be translated into an invented count of lost serialized records.
        guard recordDropped else { return }
        let expected = attachment.lease
        lock.withLock {
            guard lease === expected, expected.valid else { return }
            dropped = min(1_000_000_000, dropped + 1)
            let now = ProcessInfo.processInfo.systemUptime
            guard let deadline = lossFlush?.request(now: now) else { return }
            let item = DispatchWorkItem { [weak self, weak expected] in
                guard let self = self, let expected = expected else { return }
                let publish = self.lock.withLock { () -> Bool in
                    guard self.lease === expected, expected.valid else { return false }
                    self.pendingStatus = nil
                    return self.lossFlush?.take(now: ProcessInfo.processInfo.systemUptime, authorized: true) == true
                }
                if publish { self.status(expected.epoch, state: "observing", expected: expected) }
            }
            pendingStatus = item
            captureLane.asyncAfter(deadline: .now() + max(0, deadline - now), execute: item)
        }
    }
    private func clearAttachment(_ current: HistoryAttachment?) {
        current?.stop()
        lock.withLock { if attachment === current { attachment = nil } }
    }
    private func attach(_ lease: HistoryLease) -> HistoryAttachment? {
        guard lease.valid, let pid = LiveForeground.pid(), pid != getpid(), pid != getppid(),
              let app = NSRunningApplication(processIdentifier: pid), app.activationPolicy == .regular, !app.isTerminated,
              let bundle = app.bundleIdentifier, lease.settings.permitsBundle(bundle, ownBundle: Bundle.main.bundleIdentifier, parentBundle: parentBundle),
              let identity = try? ProcessIdentity(pid) else { return nil }
        let reader = HistoryReader(lease: lease, pid: pid, identity: identity)
        let axApp = AXUIElementCreateApplication(pid)
        guard let root = reader.element(reader.read(axApp, kAXFocusedWindowAttribute).1), let rootInfo = reader.metadata(root), HistorySecurity.safe(role: rootInfo.0, subrole: rootInfo.1, protected: rootInfo.2), let rect = reader.rect(root) else { return nil }
        let number = (reader.read(root, "AXWindowNumber").1 as? NSNumber)?.uint32Value
        // Filter ownership before examining any window metadata. Never use unrelated window titles.
        let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [Object] ?? []
        let matches = rows.compactMap { row -> UInt32? in
            guard row[kCGWindowOwnerPID as String] as? Int32 == pid, row[kCGWindowLayer as String] as? Int == 0,
                  let id = row[kCGWindowNumber as String] as? UInt32, id > 0,
                  let dictionary = row[kCGWindowBounds as String] as? NSDictionary, let bounds = CGRect(dictionaryRepresentation: dictionary) else { return nil }
            if let number = number { return number == id ? id : nil }
            return abs(rect.minX - bounds.minX) < 2 && abs(rect.minY - bounds.minY) < 2 && abs(rect.width - bounds.width) < 2 && abs(rect.height - bounds.height) < 2 ? id : nil
        }
        guard matches.count == 1, let id = matches.first, reader.valid() else { return nil }
        let candidate = HistoryAttachment(lease: lease, app: app, identity: identity, root: root, windowID: id, failure: { [weak self, weak lease] in
            guard let self = self, let lease = lease else { return }
            self.captureLane.async { self.failedCapture(lease) }
        })
        guard (try? reader.preflight(candidate)) != nil else { candidate.stop(); return nil }
        guard lock.withLock({ () -> Bool in
            guard self.lease === lease, lease.valid else { return false }
            attachment = candidate; return true
        }) else { candidate.stop(); return nil }
        candidate.start(); return candidate
    }
    private func emit(_ record: Object, attachment: HistoryAttachment, frame: HistoryContinuity.Frame? = nil) {
        guard attachment.valid, let writer = lock.withLock({ pipe }), writer.available else { if let frame = frame { attachment.baseline.rejected(frame) }; return }
        let accepted = writer.enqueue(["event": ["type": "activity-record", "epoch": attachment.lease.epoch, "record": record]], lease: attachment.lease) { [weak self, weak attachment] success in
            guard let self = self, let attachment = attachment else { return }
            self.captureLane.async {
                if let frame = frame {
                    if success && attachment.valid { attachment.baseline.written(frame) } else { attachment.baseline.rejected(frame) }
                }
            }
        }
        if !accepted { if let frame = frame { attachment.baseline.rejected(frame) }; lose(attachment) }
    }
    private func recoverTab(_ recovery: HistoryTabRecovery<HistoryElementKey>, reader: HistoryReader, attachment: HistoryAttachment) {
        guard let packet = reader.continueTab(recovery, attachment: attachment), let writer = lock.withLock({ pipe }), writer.available else { clearAttachment(attachment); return }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var record: Object = ["id": UUID().uuidString, "capturedAt": formatter.string(from: Date(timeIntervalSince1970: packet.at)),
            "target": ["bundleId": attachment.app.bundleIdentifier!, "pid": attachment.pid, "windowId": attachment.windowID],
            "appName": "", "windowTitle": "", "kind": "shortcut", "keyEquivalent": "Tab", "modifiers": [String](), "webContext": reader.tabContext.0]
        if let domain = reader.tabContext.1 { record["domain"] = domain }
        let outcome = attachment.commitTab(recovery, writer: writer, record: record)
        guard outcome.accepted else { if outcome.attempted { lose(attachment) }; clearAttachment(attachment); return }
        attachment.gesture.discard(); attachment.previousFocusedElement = nil; attachment.previousValue = nil
        attachment.previousValueRead = nil; attachment.previousSelection = nil
    }
    private func recordNavigation(_ input: HistoryInput, reader: HistoryReader, attachment: HistoryAttachment) {
        guard let name = input.navigationName, let writer = lock.withLock({ pipe }), writer.available else { clearAttachment(attachment); return }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let record: Object = ["id": UUID().uuidString, "capturedAt": formatter.string(from: input.at),
            "target": ["bundleId": attachment.app.bundleIdentifier!, "pid": attachment.pid, "windowId": attachment.windowID],
            "appName": "", "windowTitle": "", "kind": "shortcut", "keyEquivalent": name, "modifiers": [String]()]
        guard let proof = try? reader.navigation(attachment) else { clearAttachment(attachment); return }
        let result = attachment.commitNavigation(proof.0, binding: proof.1, time: proof.2, writer: writer, record: record)
        if result.state == .queueChanged { return }
        if !result.accepted { if result.attempted { lose(attachment) }; clearAttachment(attachment) }
    }
    private func tick(_ lease: HistoryLease) {
        guard lease.valid else { return }
        var current = lock.withLock { attachment }
        if let value = current {
            let reader = HistoryReader(lease: lease, pid: value.pid, identity: value.identity)
            if !reader.owned(value) { clearAttachment(value); current = nil }
        }
        if current == nil { current = attach(lease) }
        guard let current = current, current.valid else { return }
        // Poll focused content as a bounded fallback for apps omitting AX notification delivery.
        let reader = HistoryReader(lease: lease, pid: current.pid, identity: current.identity)
        let snapshot: ([HistoryReader.Node], Bool, String?)
        do {
            guard let result = try reader.preflight(current, allowFocusRecovery: true, allowNavigation: true) else { clearAttachment(current); return }
            switch result {
            case .navigation(let input): recordNavigation(input, reader: reader, attachment: current); return
            case .context(let nodes, let web, let domain):
                guard reader.owned(current) else { clearAttachment(current); return }
                snapshot = (nodes, web, domain)
            }
        } catch let change as HistoryFocusChange {
            recoverTab(change.recovery, reader: reader, attachment: current); return
        } catch { clearAttachment(current); return }
        let (nodes, web, domain) = snapshot
        guard let title = nodes.first(where: { $0.path == "0" })?.title, reader.owned(current), reader.contentPermitted() else { return }
        // Drain only after admission: input arriving during the bounded preflight belongs to this pass, not the next one.
        let (inputs, changed, valueChanged, selectionChanged, lost) = current.take()
        if lost { current.gesture.discard(); lose(current, recordDropped: false) }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        func record(_ kind: String, at: Date = Date()) -> Object {
            var value: Object = ["id": UUID().uuidString, "capturedAt": formatter.string(from: at),
                "target": ["bundleId": current.app.bundleIdentifier!, "pid": current.pid, "windowId": current.windowID],
                "appName": HistoryText.clean(current.app.localizedName ?? "", limit: 512) ?? "", "windowTitle": title, "webContext": web, "kind": kind]
            if let domain = domain { value["domain"] = domain }
            return value
        }
        func submit(_ record: Object) { if reader.owned(current), reader.contentPermitted() { emit(record, attachment: current) } }
        if transitionLease !== lease { transitionLease = lease; transitions = HistoryTransitions() }
        let processKey = "\(current.pid)/\(current.identity.startSeconds)/\(current.identity.startMicroseconds)"
        if let kind = transitions.observed(process: processKey, window: current.windowID) { submit(record(kind)) }
        for input in inputs {
            guard HistoryInputIdentity.freshSample(age: Date().timeIntervalSince(input.at)) else {
                current.gesture.discard(); lose(current, recordDropped: false); continue
            }
            guard reader.owned(current) else { break }
            let modifiers = [(CGEventFlags.maskCommand, "command"), (.maskControl, "control"), (.maskAlternate, "option"), (.maskShift, "shift")].compactMap { input.flags.contains($0.0) ? $0.1 : nil }
            if input.type == .keyDown {
                guard input.window == current.windowID else { continue }
                let named: [Int64: String] = [36: "Return", 48: "Tab", 53: "Escape", 123: "ArrowLeft", 124: "ArrowRight", 125: "ArrowDown", 126: "ArrowUp", 51: "Backspace", 117: "Delete", 115: "Home", 119: "End", 116: "PageUp", 121: "PageDown"]
                if let name = named[input.key] { var event = record("shortcut", at: input.at); event["keyEquivalent"] = name; event["modifiers"] = modifiers; submit(event) }
                continue
            }
            guard input.window == current.windowID else { current.gesture.discard(); continue }
            if [.leftMouseDown, .rightMouseDown, .otherMouseDown].contains(input.type) { current.gesture.begin(input, button: input.button) }
            else if [.leftMouseDragged, .rightMouseDragged, .otherMouseDragged].contains(input.type) { current.gesture.drag(button: input.button) }
            else if [.leftMouseUp, .rightMouseUp, .otherMouseUp].contains(input.type), let completed = current.gesture.finish(button: input.button) {
                let down = completed.origin
                guard (1...16).contains(input.count) else { continue }
                var event = record(completed.dragged ? "drag" : input.button == 1 ? "context-menu" : "click", at: input.at)
                event["mouse"] = ["button": input.button == 0 ? "left" : input.button == 1 ? "right" : input.button == 2 ? "middle" : "other",
                    "clickCount": input.count, "origin": ["x": down.point.x, "y": down.point.y], "destination": ["x": input.point.x, "y": input.point.y]]
                event["modifiers"] = modifiers; submit(event)
            } else if input.type == .scrollWheel, input.dx.isFinite, input.dy.isFinite, abs(input.dx) <= 100000, abs(input.dy) <= 100000 {
                var event = record("scroll", at: input.at); event["mouse"] = ["deltaX": input.dx, "deltaY": input.dy]; event["modifiers"] = modifiers; submit(event)
            }
        }
        let focused = reader.element(reader.read(current.axApp, kAXFocusedUIElementAttribute).1)
        let focusedKey = focused.map { HistoryElementKey(element: $0) }
        if current.previousFocusedElement != focusedKey {
            current.previousFocusedElement = focusedKey
            current.previousValue = nil; current.previousValueRead = nil; current.previousSelection = nil
        }
        if let focused = focused, let metadata = reader.metadata(focused),
           ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"].contains(metadata.0), reader.path(focused, to: current.root) {
            if let value = reader.text(focused, kAXValueAttribute, attachment: current) {
                let observedAt = Date().timeIntervalSince1970
                if let previous = current.previousValue, value != previous {
                    var event = record(current.keyObserved(before: observedAt) ? "text-input" : "accessibility"); event["text"] = value; submit(event)
                }
                current.previousValue = value; current.previousValueRead = observedAt
            }
            if reader.owned(current), reader.path(focused, to: current.root), reader.contentPermitted() {
                let selected = reader.text(focused, kAXSelectedTextAttribute, attachment: current)
                var selection: Object = [:]
                if let selected = selected { selection["text"] = selected }
                if reader.contentPermitted(), let raw = reader.read(focused, kAXSelectedTextRangeAttribute).1, CFGetTypeID(raw) == AXValueGetTypeID() {
                    var range = CFRange()
                    if AXValueGetValue(unsafeBitCast(raw, to: AXValue.self), .cfRange, &range), let valid = HistoryText.range(location: range.location, length: range.length) {
                        selection["location"] = valid["location"]; selection["length"] = valid["length"]
                    }
                }
                if !selection.isEmpty, let data = try? JSONSerialization.data(withJSONObject: selection, options: [.sortedKeys]), let encoded = String(data: data, encoding: .utf8) {
                    if current.previousSelection != encoded { var event = record("selection-changed"); event["selection"] = selection; submit(event) }
                    current.previousSelection = encoded
                }
            }
        }
        var lines: [String] = [], size = 0
        for node in nodes.prefix(64) {
            guard reader.owned(current) else { return }
            let label = node.title ?? ""
            let value = ["AXStaticText", "AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"].contains(node.role) ? reader.text(node.element, kAXValueAttribute, attachment: current) ?? "" : ""
            let line = node.path + " " + node.role + (label.isEmpty ? "" : " title=" + label) + (value.isEmpty ? "" : " value=" + value)
            guard size + line.utf16.count + 1 <= 16_384 else { current.baseline.lost(); return }
            lines.append(line); size += line.utf16.count + 1
        }
        guard reader.owned(current), reader.contentPermitted(), let frame = current.baseline.prepare(lines) else { return }
        var event = record("accessibility"); event["ax"] = ["mode": frame.mode, "text": frame.text]
        emit(event, attachment: current, frame: frame)
        _ = changed; _ = valueChanged; _ = selectionChanged
    }
}

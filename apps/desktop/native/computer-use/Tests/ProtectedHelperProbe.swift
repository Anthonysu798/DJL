import AppKit
import ApplicationServices
import CoreGraphics
import Darwin

typealias Object = [String: Any]
typealias ReadFocus = @convention(c) (UnsafeMutablePointer<ProcessSerialNumber>, UnsafeMutablePointer<UInt8>) -> Int32
typealias ResolvePid = @convention(c) (UnsafePointer<ProcessSerialNumber>, UnsafeMutablePointer<pid_t>) -> Int32
typealias ReleaseFocus = @convention(c) (UInt32) -> Int32
func emit(_ value: Object) { let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]); print(String(decoding: data, as: UTF8.self)); fflush(stdout) }
func pumpMainRunLoop(for interval: TimeInterval) {
    let deadline = Date().addingTimeInterval(interval)
    while Date() < deadline { _ = RunLoop.current.run(mode: .default, before: min(deadline, Date().addingTimeInterval(0.01))) }
}
func failure(_ name: String) -> NSError { NSError(domain: name, code: 1) }
final class FocusAPI {
    let read: ReadFocus
    let resolve: ResolvePid
    let release: ReleaseFocus
    init() throws {
        guard let core = dlopen("/System/Library/Frameworks/CoreGraphics.framework/Versions/A/CoreGraphics", RTLD_NOW | RTLD_LOCAL),
              let get = dlsym(core, "CPSGetKeyFocusProcess"), let release = dlsym(core, "CPSReleaseKeyFocusWithID"),
              let services = dlopen("/System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/HIServices", RTLD_NOW | RTLD_LOCAL),
              let pid = dlsym(services, "GetProcessPID") else { throw failure("apple-focus-api-unavailable") }
        self.read = unsafeBitCast(get, to: ReadFocus.self); self.release = unsafeBitCast(release, to: ReleaseFocus.self)
        self.resolve = unsafeBitCast(pid, to: ResolvePid.self)
    }
    func focus() -> Object {
        var psn = ProcessSerialNumber(highLongOfPSN: 0, lowLongOfPSN: 0), flag: UInt8 = 0, pid: pid_t = 0
        let status = read(&psn, &flag)
        let pidStatus = status == 0 ? resolve(&psn, &pid) : Int32(-1)
        return ["cpsStatus": status, "pidStatus": pidStatus, "pid": pid, "rawFlag": flag,
                "psnHigh": psn.highLongOfPSN, "psnLow": psn.lowLongOfPSN]
    }
}
func valid(_ focus: Object, pid: pid_t) -> Bool { focus["cpsStatus"] as? Int32 == 0 && focus["pidStatus"] as? Int32 == 0 && focus["pid"] as? Int32 == pid }
func hardwareCount() -> UInt64 {
    let types: [CGEventType] = [.mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged, .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp, .keyDown, .keyUp, .flagsChanged, .scrollWheel]
    return types.reduce(0) { $0 + UInt64(CGEventSource.counterForEventType(.hidSystemState, eventType: $1)) }
}
func notification(_ subtype: Int16, _ pid: pid_t) throws {
    guard let event = NSEvent.otherEvent(with: .appKitDefined, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil, subtype: subtype, data1: 0, data2: 0)?.cgEvent else { throw failure("appkit-notification-unavailable") }
    event.postToPid(pid)
}

// Independent listen-only metadata witness, installed before the helper's taps.
final class ProtectionWitness {
    let target: pid_t, victim: pid_t, api: FocusAPI
    let lock = NSLock(), ready = DispatchSemaphore(value: 0), ended = DispatchSemaphore(value: 0)
    let initialHIDFlags = CGEventSource.flagsState(.hidSystemState).rawValue
    let initialCombinedFlags = CGEventSource.flagsState(.combinedSessionState).rawValue
    var helper: pid_t = 0, healthy = false, stopping = false
    var stopOnRightDown: (() -> Void)?
    var takenAt: Date?, ownSeedAt: Date?, transientAt: Date?
    var observations: [Object] = [], inputChecks: [Object] = []
    var loop: CFRunLoop?
    init(target: pid_t, victim: pid_t, api: FocusAPI) { self.target = target; self.victim = victim; self.api = api }
    func start() -> Bool {
        Thread { [self] in
            let context = Unmanaged.passUnretained(self).toOpaque()
            let metadata = CGEvent.tapCreate(tap: .cgAnnotatedSessionEventTap, place: .tailAppendEventTap, options: .listenOnly,
                eventsOfInterest: CGEventMask(1) << 21, callback: Self.metadataCallback, userInfo: context)
            let input = CGEvent.tapCreateForPid(pid: target, place: .tailAppendEventTap, options: .listenOnly,
                eventsOfInterest: [1, 2, 3, 4, 10, 11, 12, 13, 22, 25, 26].reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1) },
                callback: Self.inputCallback, userInfo: context)
            guard let metadata = metadata, let input = input,
                  let first = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, metadata, 0),
                  let second = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, input, 0) else { ready.signal(); ended.signal(); return }
            let current = CFRunLoopGetCurrent()
            CFRunLoopAddSource(current, first, .commonModes); CFRunLoopAddSource(current, second, .commonModes)
            CGEvent.tapEnable(tap: metadata, enable: true); CGEvent.tapEnable(tap: input, enable: true)
            lock.withLock { loop = current; healthy = CGEvent.tapIsEnabled(tap: metadata) && CGEvent.tapIsEnabled(tap: input) }
            ready.signal()
            while !lock.withLock({ stopping }) { CFRunLoopRunInMode(.defaultMode, 0.02, false) }
            CFMachPortInvalidate(metadata); CFMachPortInvalidate(input); ended.signal()
        }.start()
        return ready.wait(timeout: .now() + 2) == .success && lock.withLock { healthy }
    }
    func observeFocus(_ focus: Object) -> Bool {
        lock.withLock {
            guard healthy else { return false }
            if valid(focus, pid: target) {
                guard let started = ownSeedAt ?? takenAt, Date().timeIntervalSince(started) < 0.5 else { return false }
                if transientAt == nil { transientAt = Date(); observations.append(["phase": "observed-transient-target-cps", "ownHelperSeedWitnessed": ownSeedAt != nil, "naturalTakenWitnessed": takenAt != nil]) }
                return true
            }
            guard valid(focus, pid: victim) else { return false }
            if let start = transientAt {
                observations.append(["phase": "observed-victim-cps-restored", "sampledTransitionMs": Date().timeIntervalSince(start) * 1000])
                transientAt = nil
            }
            return true
        }
    }
    func stop() { lock.withLock { stopping = true; if let loop = loop { CFRunLoopWakeUp(loop) } }; _ = ended.wait(timeout: .now() + 1) }
    func snapshot() -> Object { lock.withLock { ["observations": observations, "inputChecks": inputChecks, "healthy": healthy] } }
    static let metadataCallback: CGEventTapCallBack = { _, type, event, context in
        guard let context = context else { return Unmanaged.passUnretained(event) }
        let witness = Unmanaged<ProtectionWitness>.fromOpaque(context).takeUnretainedValue()
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput { witness.lock.withLock { witness.healthy = false }; return Unmanaged.passUnretained(event) }
        let subtype = UInt16(truncatingIfNeeded: event.getIntegerValueField(CGEventField(rawValue: 64)!))
        let target = event.getIntegerValueField(.eventTargetUnixProcessID), affected = event.getIntegerValueField(CGEventField(rawValue: 73)!)
        if target == Int64(witness.target) || target == Int64(witness.victim) || affected == Int64(witness.target) || affected == Int64(witness.victim) {
            witness.lock.withLock {
                if subtype == 0x4000 && target == Int64(witness.victim) && affected == Int64(witness.target) { witness.takenAt = Date() }
                if subtype == 2 && affected == Int64(witness.target) { witness.takenAt = nil }
                if witness.observations.count < 100 { witness.observations.append(["phase": "notification", "subtype": subtype, "targetPid": target, "affectedPid": affected]) }
            }
        }
        return Unmanaged.passUnretained(event)
    }
    static let inputCallback: CGEventTapCallBack = { _, type, event, context in
        guard let context = context else { return Unmanaged.passUnretained(event) }
        let witness = Unmanaged<ProtectionWitness>.fromOpaque(context).takeUnretainedValue()
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput { witness.lock.withLock { witness.healthy = false }; return Unmanaged.passUnretained(event) }
        let source = event.getIntegerValueField(.eventSourceUnixProcessID)
        let helper = witness.lock.withLock { witness.helper }
        if helper > 0 && source == Int64(helper) {
            if type.rawValue == 13 {
                if NSEvent(cgEvent: event)?.subtype.rawValue == 1 {
                    witness.lock.withLock {
                        witness.ownSeedAt = Date(); witness.takenAt = nil
                        witness.observations.append(["phase": "observed-own-helper-seed", "sourcePid": source,
                                                     "observedNs": DispatchTime.now().uptimeNanoseconds])
                    }
                }
                return Unmanaged.passUnretained(event) // Seed metadata is not ordinary agent input.
            }
            let focus = witness.api.focus()
            let hid = CGEventSource.flagsState(.hidSystemState).rawValue, combined = CGEventSource.flagsState(.combinedSessionState).rawValue
            let modifiersPreserved = hid == witness.initialHIDFlags && combined == witness.initialCombinedFlags
            witness.lock.withLock {
                var check: Object = ["type": type.rawValue, "sourcePid": source, "eventFlags": event.flags.rawValue, "keyFocus": focus,
                    "victimOwnershipVerified": valid(focus, pid: witness.victim), "hidFlags": hid, "combinedFlags": combined, "modifierStatePreserved": modifiersPreserved]
                if [10, 11, 12].contains(type.rawValue) { check["keyCode"] = event.getIntegerValueField(.keyboardEventKeycode) }
                else { check["button"] = event.getIntegerValueField(.mouseEventButtonNumber); check["clickCount"] = event.getIntegerValueField(.mouseEventClickState) }
                witness.inputChecks.append(check)
                if !valid(focus, pid: witness.victim) || !modifiersPreserved { witness.healthy = false }
            }
            let stop = witness.lock.withLock { () -> (() -> Void)? in
                guard type == .rightMouseDown else { return nil }
                let action = witness.stopOnRightDown; witness.stopOnRightDown = nil; return action
            }
            stop?()
        }
        return Unmanaged.passUnretained(event)
    }
}

final class NativeClient {
    let process = Process()
    let input = Pipe(), output = Pipe()
    var stderrHandle: FileHandle?
    let lock = NSLock()
    let sendLock = NSLock()
    var replies: [String: Object] = [:]
    var protectionEvents: [String] = []
    var next = 0
    init(_ executable: String) throws {
        process.executableURL = URL(fileURLWithPath: executable)
        process.standardInput = input; process.standardOutput = output
        let stderrURL = URL(fileURLWithPath: "/private/tmp/djl-cua-keyboard-protection").appendingPathComponent("helper-\(UUID().uuidString).stderr")
        _ = FileManager.default.createFile(atPath: stderrURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
        stderrHandle = try FileHandle(forWritingTo: stderrURL); process.standardError = stderrHandle
        var environment = ProcessInfo.processInfo.environment
        environment["DJL_COMPUTER_USE_EXPERIMENTAL_INPUT"] = "1"
        process.environment = environment
        try process.run()
        emit(["phase": "owned-native-child", "pid": process.processIdentifier, "stderrPath": stderrURL.path])
        DispatchQueue.global().async { [self] in
            var buffer = Data()
            while true {
                let chunk = output.fileHandleForReading.availableData
                if chunk.isEmpty { break }
                buffer.append(chunk)
                while let end = buffer.firstIndex(of: 10) {
                    let line = buffer.prefix(upTo: end); buffer.removeSubrange(...end)
                    if let frame = (try? JSONSerialization.jsonObject(with: line)) as? Object,
                       let event = frame["event"] as? Object, event["type"] as? String == "input-protection", let state = event["state"] as? String {
                        lock.withLock { protectionEvents.append(state) }
                    }
                    if let frame = (try? JSONSerialization.jsonObject(with: line)) as? Object,
                       let id = frame["id"] as? String, let response = frame["response"] as? Object {
                        lock.withLock { replies[id] = response }
                    }
                }
            }
        }
    }
    func send(_ request: Object) throws -> String {
        sendLock.lock(); defer { sendLock.unlock() }
        next += 1; let id = "protected-\(next)"
        var data = try JSONSerialization.data(withJSONObject: ["id": id, "threadId": "owned-protected-helper", "request": request])
        data.append(10); try input.fileHandleForWriting.write(contentsOf: data); return id
    }
    func receive(_ id: String, timeout: TimeInterval = 5, invariant: () throws -> Void = {}) throws -> Object {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            try invariant()
            if let response = lock.withLock({ replies.removeValue(forKey: id) }) { return response }
            guard process.isRunning else { throw failure("native-helper-exited") }
            pumpMainRunLoop(for: 0.005)
        }
        throw failure("native-helper-reply-timeout")
    }
    func request(_ request: Object, invariant: () throws -> Void = {}) throws -> Object { try receive(send(request), invariant: invariant) }
    func result(_ response: Object) throws -> Object {
        guard let result = response["result"] as? Object, response["error"] == nil else {
            emit(["phase": "native-error", "response": response]); throw failure("native-operation-error")
        }
        return result
    }
    func close() {
        try? input.fileHandleForWriting.close()
        let deadline = Date().addingTimeInterval(2)
        while process.isRunning && Date() < deadline { pumpMainRunLoop(for: 0.01) }
        if process.isRunning { process.terminate() }
        try? stderrHandle?.close()
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let directory = URL(fileURLWithPath: "/private/tmp/djl-cua-keyboard-protection")
let fixtureURL = URL(fileURLWithPath: "/private/tmp/djl-cua-background-probe/DJLBackgroundFixture.app/Contents/MacOS/DJLBackgroundFixture")
let victimState = directory.appendingPathComponent("victim-state.json"), targetState = directory.appendingPathComponent("target-state.json")
let foreignTag: Int64 = 960002
let victim = Process(), target = Process()
var client: NativeClient?
var witness: ProtectionWitness?
func state(_ path: URL, _ pid: pid_t) throws -> Object {
    let value = try JSONSerialization.jsonObject(with: Data(contentsOf: path)) as! Object
    guard value["pid"] as? Int32 == pid, value["bundleId"] as? String == "com.djl.computer-use.background-fixture" else { throw failure("fixture-identity") }
    return value
}
func cleanup() {
    client?.close(); client = nil
    witness?.stop(); witness = nil
    if target.isRunning { target.terminate() }; if victim.isRunning { victim.terminate() }
}
atexit { cleanup() }
do {
    guard CommandLine.arguments.count == 2 else { throw failure("expected-owned-helper-executable") }
    let helperURL = URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath()
    guard helperURL.path.hasSuffix("/apps/desktop/native/computer-use/.build/DJL Computer Use.app/Contents/MacOS/DJLComputerUse") else { throw failure("only-owned-helper-path") }
    let validationMode = ProcessInfo.processInfo.environment["DJL_TEST_MATRIX_VALIDATION"]
    let matrixMode = ProcessInfo.processInfo.environment["DJL_TEST_INPUT_MATRIX"] == "1" || validationMode != nil
    let earlyNative = matrixMode ? try NativeClient(helperURL.path) : nil
    client = earlyNative
    let api = try FocusAPI()
    let mouse = CGEvent(source: nil)?.location ?? .zero, hid = hardwareCount()
    let initialHIDFlags = CGEventSource.flagsState(.hidSystemState).rawValue, initialCombinedFlags = CGEventSource.flagsState(.combinedSessionState).rawValue
    let baselineFocus = api.focus()
    let baselineFront = LiveForeground.pid()
    let foregroundBundle = baselineFront.flatMap { NSRunningApplication(processIdentifier: $0)?.bundleIdentifier } ?? "unknown"
    let focusBundle = (baselineFocus["pid"] as? Int32).flatMap { NSRunningApplication(processIdentifier: $0)?.bundleIdentifier } ?? "unknown"
    let systemDialogs: Set<String> = ["com.apple.UserNotificationCenter", "com.apple.SecurityAgent", "com.apple.loginwindow"]
    guard baselineFront != nil, baselineFocus["cpsStatus"] as? Int32 == 0, baselineFocus["pidStatus"] as? Int32 == 0,
          (baselineFocus["pid"] as? Int32 ?? 0) > 0, foregroundBundle != "unknown", focusBundle != "unknown" else {
        emit(["phase": "guarded-abort", "reason": "valid-read-only-foreground-and-keyboard-baseline-unavailable"]); cleanup(); exit(20)
    }
    if systemDialogs.contains(foregroundBundle) || systemDialogs.contains(focusBundle) {
        emit(["phase": "guarded-abort", "reason": "system-dialog-owns-foreground-or-keyboard", "foregroundBundle": foregroundBundle, "focusBundle": focusBundle])
        cleanup(); exit(20)
    }
    emit(["phase": "before-owned-setup", "keyFocus": baselineFocus, "foregroundPid": baselineFront ?? -1])
    for (process, path, foreground) in [(target, targetState, false), (victim, victimState, true)] {
        process.executableURL = fixtureURL
        var arguments = ["--metadata-only-state", "--state-file", path.path, "--test-key-tags", "0,\(foreignTag)", "--test-foreign-marker", "DJL_FOREIGN_960002"]
        if foreground { arguments += ["--regular-app", "--standard-window", "--history-foreground", "--history-foreground-seconds", matrixMode ? "90" : "12"] }
        else {
            arguments += ["--self-deactivate"]
            if matrixMode { arguments += ["--input-matrix", "--test-source-pid", String(earlyNative!.process.processIdentifier)] }
            if validationMode == "readonly" { arguments.append("--matrix-readonly") }
            if validationMode == "button" { arguments.append("--matrix-focus-button") }
            if validationMode == "disabled" { arguments.append("--matrix-disabled-button") }
        }
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
        try process.run()
        for _ in 0..<30 { if (try? state(path, process.processIdentifier)) != nil { break }; pumpMainRunLoop(for: 0.05) }
    }
    pumpMainRunLoop(for: 0.8)
    let victimPid = victim.processIdentifier, targetPid = target.processIdentifier
    _ = NSRunningApplication(processIdentifier: victimPid)?.activate(options: [])
    pumpMainRunLoop(for: 0.25)
    func invariant() throws {
        let focus = api.focus()
        let focusAccepted = witness?.observeFocus(focus) ?? valid(focus, pid: victimPid)
        guard focusAccepted, LiveForeground.pid() == victimPid,
              CGEvent(source: nil)?.location == mouse, hardwareCount() == hid,
              CGEventSource.flagsState(.hidSystemState).rawValue == initialHIDFlags,
              CGEventSource.flagsState(.combinedSessionState).rawValue == initialCombinedFlags else {
            emit(["phase": "isolation-failed", "keyFocus": api.focus(), "foregroundPid": LiveForeground.pid() ?? -1])
            throw failure("foreground-cps-cursor-hid-isolation")
        }
    }
    try invariant()
    guard try state(targetState, targetPid)["isActive"] as? Bool == false else { throw failure("target-not-inactive") }
    if ProcessInfo.processInfo.environment["DJL_TEST_OBSERVER_LIFECYCLE"] == "1" {
        let native = try NativeClient(helperURL.path); client = native
        let attestedTarget: Object = ["bundleId": "com.djl.computer-use.background-fixture", "pid": targetPid, "windowId": try state(targetState, targetPid)["windowId"]!]
        let attestedSession = try native.result(native.request(["method": "session.open", "target": attestedTarget]))["sessionId"] as! String
        for iteration in 0..<5 {
            let beforeApp = NSRunningApplication(processIdentifier: targetPid)
            let child = Process(); child.executableURL = helperURL.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("HumanStateObserver")
            let pipe = Pipe(); child.standardOutput = pipe; child.standardError = FileHandle.nullDevice
            try child.run()
            while child.isRunning { pumpMainRunLoop(for: 0.005) }
            let childResult = try JSONSerialization.jsonObject(with: pipe.fileHandleForReading.readDataToEndOfFile())
            let afterApp = NSRunningApplication(processIdentifier: targetPid)
            let rows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [Object] ?? []
            let lifecycleWindow = try state(targetState, targetPid)["windowId"] as! UInt32
            _ = try native.result(native.request(["method": "session.observe", "sessionId": attestedSession, "maxElements": 10]))
            emit(["phase": "read-only-observer-lifecycle", "attestedSessionObservationPassed": true, "iteration": iteration,
                  "beforeAppAvailable": beforeApp != nil, "beforeBundle": beforeApp?.bundleIdentifier ?? "nil",
                  "afterAppAvailable": afterApp != nil, "afterBundle": afterApp?.bundleIdentifier ?? "nil",
                  "fixtureRunning": target.isRunning, "exactWindowPresent": rows.contains { ($0[kCGWindowOwnerPID as String] as? Int32) == targetPid && ($0[kCGWindowNumber as String] as? UInt32) == lifecycleWindow },
                  "childObserver": childResult, "targetState": try state(targetState, targetPid)])
        }
        target.terminate()
        let exitDeadline = Date().addingTimeInterval(2)
        while target.isRunning && Date() < exitDeadline { pumpMainRunLoop(for: 0.01) }
        let expired = try native.request(["method": "session.observe", "sessionId": attestedSession])
        guard (expired["error"] as? Object)?["code"] as? String == "target-unavailable" else { throw failure("dead-target-session-was-not-rejected") }
        let replacement = Process(); replacement.executableURL = fixtureURL
        replacement.arguments = ["--self-deactivate", "--metadata-only-state", "--state-file", targetState.path]
        replacement.standardOutput = FileHandle.nullDevice; replacement.standardError = FileHandle.nullDevice
        try replacement.run(); pumpMainRunLoop(for: 0.2)
        let replaced = try native.request(["method": "session.observe", "sessionId": attestedSession])
        guard replaced["error"] != nil, replacement.processIdentifier != targetPid else { replacement.terminate(); throw failure("replacement-resurrected-old-session") }
        replacement.terminate()
        emit(["phase": "attested-session-lifecycle-summary", "passed": true, "exitRejected": true, "sameBundleReplacementRejected": true])
        cleanup(); exit(0)
    }
    let observer = ProtectionWitness(target: targetPid, victim: victimPid, api: api)
    guard observer.start() else { throw failure("read-only-protection-witness-unavailable") }
    witness = observer
    let native = try earlyNative ?? NativeClient(helperURL.path); client = native
    observer.lock.withLock { observer.helper = native.process.processIdentifier }
    let targetObject = ["bundleId": "com.djl.computer-use.background-fixture", "pid": targetPid, "windowId": try state(targetState, targetPid)["windowId"]!] as Object
    let session = try native.result(native.request(["method": "session.open", "target": targetObject], invariant: invariant))["sessionId"] as! String
    func observe() throws -> Object { try native.result(native.request(["method": "session.observe", "sessionId": session, "maxElements": 500], invariant: invariant)) }
    var snapshot = try observe()
    let bounds = snapshot["bounds"] as! [String: Double]
    func point(_ name: String) throws -> Object {
        let points = try state(targetState, targetPid)["points"] as! [String: [String: Double]], value = points[name]!
        return ["kind": "point", "x": value["x"]! - bounds["x"]!, "y": value["y"]! - bounds["y"]!]
    }
    func reference(_ role: String) throws -> Object {
        let rows = (snapshot["elements"] as! [Object]).filter { $0["role"] as? String == role && (role != "AXButton" || $0["label"] as? String == "Increment fixture counter") }
        guard rows.count == 1 else { throw failure("ambiguous-controlled-reference") }
        return ["kind": "element", "snapshotId": snapshot["snapshotId"]!, "elementId": rows[0]["elementId"]!]
    }
    func perform(_ action: Object) throws -> Object { try native.result(native.request(["method": "session.perform", "sessionId": session, "action": action], invariant: invariant)) }
    func inactive() throws {
        let value = try state(targetState, targetPid)
        guard value["isActive"] as? Bool == false, value["isKey"] as? Bool == false else { throw failure("target-local-cleanup-failed") }
        try invariant()
        guard valid(api.focus(), pid: victimPid) else { throw failure("steady-cps-not-victim-after-operation") }
    }
    if matrixMode {
        func matrix() throws -> Object { try state(targetState, targetPid)["matrix"] as! Object }
        func matrixPoint(_ key: String) throws -> Object {
            let value = try matrix()[key] as! [String: Double]
            return ["kind": "point", "x": value["x"]! - bounds["x"]!, "y": value["y"]! - bounds["y"]!]
        }
        // A fixture-only AX setup sets a literal selection; every helper action
        // still receives a new observation/reference after that setup mutation.
        let axApp = AXUIElementCreateApplication(targetPid)
        AXUIElementSetMessagingTimeout(axApp, 0.2)
        func axRead(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
            var value: CFTypeRef?
            return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
        }
        var queue = [axApp], editor: AXUIElement?
        for _ in 0..<300 {
            guard !queue.isEmpty else { break }; let current = queue.removeFirst()
            AXUIElementSetMessagingTimeout(current, 0.2)
            if axRead(current, kAXIdentifierAttribute) as? String == "fixture-matrix-editor" { editor = current; break }
            queue += (axRead(current, kAXChildrenAttribute) as? [AXUIElement] ?? []).prefix(300 - queue.count)
        }
        guard let editor = editor else { throw failure("own-matrix-editor-unavailable") }
        func textValue() throws -> String {
            guard let value = axRead(editor, kAXValueAttribute) as? String else { throw failure("own-matrix-text-unavailable") }; return value
        }
        func prepare(_ value: String, location: Int, length: Int = 0) throws {
            // Literal fixture setup is independent of the helper action under
            // test, including when a long document's AX center is offscreen.
            guard AXUIElementSetAttributeValue(editor, kAXValueAttribute as CFString, value as CFString) == .success else { throw failure("own-literal-editor-setup-failed") }
            var range = CFRange(location: location, length: length)
            guard let raw = AXValueCreate(.cfRange, &range), AXUIElementSetAttributeValue(editor, kAXSelectedTextRangeAttribute as CFString, raw) == .success else { throw failure("own-selection-setup-failed") }
            snapshot = try observe()
            guard try textValue() == value else { throw failure("literal-editor-setup-mismatch") }
            try invariant()
        }
        func keyboardMetadata() -> Object {
            var settable = DarwinBoolean(false)
            let settableStatus = AXUIElementIsAttributeSettable(editor, kAXValueAttribute as CFString, &settable)
            let focused = axRead(axApp, kAXFocusedUIElementAttribute), owningWindow = axRead(editor, kAXWindowAttribute)
            let appWindows = axRead(axApp, kAXWindowsAttribute) as? [AXUIElement] ?? []
            var ancestry: [String] = [], ancestor = editor
            for _ in 0..<30 {
                ancestry.append(axRead(ancestor, kAXRoleAttribute) as? String ?? "nil")
                if appWindows.contains(where: { CFEqual($0, ancestor) }) { break }
                guard let parent = axRead(ancestor, kAXParentAttribute), CFGetTypeID(parent) == AXUIElementGetTypeID() else { break }
                ancestor = unsafeBitCast(parent, to: AXUIElement.self)
            }
            var attributeNames: CFArray?
            AXUIElementCopyAttributeNames(editor, &attributeNames)
            var position = CGPoint.zero, size = CGSize.zero
            if let raw = axRead(editor, kAXPositionAttribute), CFGetTypeID(raw) == AXValueGetTypeID() { _ = AXValueGetValue(unsafeBitCast(raw, to: AXValue.self), .cgPoint, &position) }
            if let raw = axRead(editor, kAXSizeAttribute), CFGetTypeID(raw) == AXValueGetTypeID() { _ = AXValueGetValue(unsafeBitCast(raw, to: AXValue.self), .cgSize, &size) }
            let windowRect = CGRect(x: bounds["x"]!, y: bounds["y"]!, width: bounds["width"]!, height: bounds["height"]!)
            return ["attributeNames": attributeNames as? [String] ?? [],
                "ownedEditorAXRect": ["x": position.x, "y": position.y, "width": size.width, "height": size.height],
                "boundWindowRect": bounds, "editorCenterInsideWindow": windowRect.contains(CGPoint(x: position.x + size.width / 2, y: position.y + size.height / 2)),
                "AXEditable": (axRead(editor, "AXEditable") as? Bool).map { $0 as Any } ?? NSNull(), "AXReadOnly": (axRead(editor, "AXReadOnly") as? Bool).map { $0 as Any } ?? NSNull(), "ancestry": ancestry, "enabledPresent": axRead(editor, kAXEnabledAttribute) != nil,
                "owningWindowMatches": owningWindow.map { owner in appWindows.contains { CFEqual($0, owner) } } ?? false, "role": axRead(editor, kAXRoleAttribute) as? String ?? "nil", "enabled": axRead(editor, kAXEnabledAttribute) as? Bool ?? false,
                "focused": axRead(editor, kAXFocusedAttribute) as? Bool ?? false, "focusedIdentityMatches": focused.map { CFEqual($0, editor) } ?? false,
                "valueSettable": settable.boolValue, "settableStatus": settableStatus.rawValue, "owningWindowPresent": owningWindow != nil]
        }
        func press(_ key: String, modifiers: [String] = [], boundPoint: Bool = false) throws -> Object {
            let metadata = keyboardMetadata()
            let target = try boundPoint ? matrixPoint("editorPoint") : reference("AXTextArea")
            if boundPoint { emit(["phase": "matrix-bound-point-key-context", "key": key, "metadata": metadata]) }
            let response = try native.request(["method": "session.perform", "sessionId": session, "action": ["type": "pressKey", "target": target, "key": key, "modifiers": modifiers]], invariant: invariant)
            if response["error"] != nil { emit(["phase": "matrix-key-target-diagnostics", "key": key, "metadata": metadata]) }
            return response
        }
        if let mode = validationMode {
            let before = try state(targetState, targetPid)
            if mode == "readonly" {
                let originalText = try textValue()
                let rejected = try native.request(["method": "session.perform", "sessionId": session,
                    "action": ["type": "type", "target": reference("AXTextArea"), "text": "MUST-NOT-INSERT"]], invariant: invariant)
                guard (rejected["error"] as? Object)?["code"] as? String == "unsupported", try textValue() == originalText else { throw failure("readonly-typing-was-not-rejected") }
                let afterReject = try state(targetState, targetPid)
                guard afterReject["activationCount"] as? Int == (before["activationCount"] as? Int), afterReject["deactivationCount"] as? Int == (before["deactivationCount"] as? Int) else { throw failure("readonly-rejection-seeded-focus") }
                emit(["phase": "readonly-type-rejected-before-seed", "passed": true, "metadata": keyboardMetadata()])
                var range = CFRange(location: 2, length: 0)
                guard let raw = AXValueCreate(.cfRange, &range), AXUIElementSetAttributeValue(editor, kAXSelectedTextRangeAttribute as CFString, raw) == .success else { throw failure("readonly-selection-setup") }
                snapshot = try observe(); _ = try native.result(press("ArrowRight")); try inactive()
                guard try matrix()["selectionLocation"] as? Int == 3, try textValue() == originalText else { throw failure("readonly-navigation-effect") }
                emit(["phase": "readonly-navigation-effect", "passed": true])
            } else if mode == "disabled" {
                let rejected = try native.request(["method": "session.perform", "sessionId": session,
                    "action": ["type": "pressKey", "target": reference("AXButton"), "key": "Space"]], invariant: invariant)
                guard (rejected["error"] as? Object)?["code"] as? String == "unsupported" else { throw failure("disabled-control-accepted-input") }
                let after = try state(targetState, targetPid)
                guard after["buttonCount"] as? Int == (before["buttonCount"] as? Int), after["activationCount"] as? Int == (before["activationCount"] as? Int), after["deactivationCount"] as? Int == (before["deactivationCount"] as? Int) else { throw failure("disabled-rejection-caused-effect") }
                emit(["phase": "disabled-control-rejected-before-seed", "passed": true])
            } else if mode == "button" {
                let count = before["buttonCount"] as! Int
                _ = try perform(["type": "pressKey", "target": reference("AXButton"), "key": "Space"]); try inactive()
                guard try state(targetState, targetPid)["buttonCount"] as? Int == count + 1 else { throw failure("focused-button-space-effect") }
                _ = try perform(["type": "pressKey", "target": matrixPoint("pointerPoint"), "key": "Enter"]); try inactive()
                guard try state(targetState, targetPid)["buttonCount"] as? Int == count + 2 else { throw failure("bound-point-focused-button-enter-effect") }
                emit(["phase": "focused-button-and-bound-point-key-effects", "passed": true])
            } else { throw failure("unknown-validation-mode") }
            try invariant(); emit(["phase": "keyboard-validation-summary", "mode": mode, "passed": true])
            cleanup(); exit(0)
        }
        emit(["phase": "matrix-editor-before-input", "metadata": keyboardMetadata()])
        _ = try perform(["type": "click", "target": matrixPoint("editorPoint")]); try inactive()
        emit(["phase": "matrix-editor-after-click", "metadata": keyboardMetadata()])
        let keyCodes: [String: Int64] = ["Enter": 36, "Return": 36, "Tab": 48, "Space": 49, "Backspace": 51, "Escape": 53, "Delete": 117,
            "ArrowLeft": 123, "ArrowRight": 124, "ArrowUp": 126, "ArrowDown": 125, "Home": 115, "End": 119, "PageUp": 116, "PageDown": 121, "A": 0, "a": 0, "1": 18]
        func inputCount() -> Int { (observer.snapshot()["inputChecks"] as? [Object] ?? []).count }
        func assertKeyPackets(_ key: String, modifiers: [String] = [], after index: Int) throws {
            let relevant: UInt64 = (1 << 17) | (1 << 18) | (1 << 19) | (1 << 20)
            let flagValues: [String: UInt64] = ["shift": 1 << 17, "control": 1 << 18, "option": 1 << 19, "command": 1 << 20]
            let expectedFlags = modifiers.reduce(UInt64(0)) { $0 | flagValues[$1]! }
            let checks = Array((observer.snapshot()["inputChecks"] as? [Object] ?? []).dropFirst(index))
            for type: UInt32 in [10, 11] {
                let matching = checks.filter { ($0["type"] as? NSNumber)?.uint32Value == type }
                guard matching.count == 1, matching[0]["sourcePid"] as? Int64 == Int64(native.process.processIdentifier),
                      matching[0]["keyCode"] as? Int64 == keyCodes[key], ((matching[0]["eventFlags"] as? NSNumber)?.uint64Value ?? UInt64.max) & relevant == expectedFlags else { throw failure("known-source-keycode-flags-or-pair-mismatch") }
            }
        }
        let capabilitiesOnly = ProcessInfo.processInfo.environment["DJL_TEST_MATRIX_CAPABILITIES_ONLY"] == "1"
        if !capabilitiesOnly {
        let keyCases: [(String, String, Int, String, Int)] = [
            ("Enter", "abc", 1, "a\nbc", 2), ("Return", "abc", 1, "a\nbc", 2),
            ("Tab", "abc", 1, "a\tbc", 2), ("Space", "abc", 1, "a bc", 2),
            ("Backspace", "abc", 2, "ac", 1), ("Delete", "abc", 1, "ac", 1),
            ("ArrowLeft", "alpha beta", 5, "alpha beta", 4), ("ArrowRight", "alpha beta", 5, "alpha beta", 6),
            ("ArrowUp", "alpha\nbravo\ncharlie", 8, "alpha\nbravo\ncharlie", 2),
            ("ArrowDown", "alpha\nbravo\ncharlie", 2, "alpha\nbravo\ncharlie", 8)]
        for (key, initial, location, expectedText, expectedLocation) in keyCases {
            try prepare(initial, location: location); let packetIndex = inputCount()
            _ = try native.result(press(key)); try inactive(); try assertKeyPackets(key, after: packetIndex)
            let after = try matrix()
            guard try textValue() == expectedText, after["selectionLocation"] as? Int == expectedLocation, after["selectionLength"] as? Int == 0 else {
                emit(["phase": "named-key-effect-mismatch", "key": key, "matrix": after]); throw failure("named-key-effect")
            }
            emit(["phase": "matrix-named-key", "key": key, "textAndSelectionEffect": true, "passed": true])
        }
        try prepare("abc", location: 1); let cancelledBefore = try matrix()["cancelCount"] as! Int
        let escapePacketIndex = inputCount()
        _ = try native.result(press("Escape")); try inactive(); try assertKeyPackets("Escape", after: escapePacketIndex)
        guard try matrix()["cancelCount"] as! Int == cancelledBefore + 1, try textValue() == "abc" else { throw failure("escape-cancel-effect") }
        emit(["phase": "matrix-named-key", "key": "Escape", "cancelEffect": true, "passed": true])
        let longText = (0..<80).map { "known matrix line \($0) alpha beta gamma" }.joined(separator: "\n")
        for key in ["Home", "End", "PageUp", "PageDown"] {
            try prepare(longText, location: 400)
            _ = try perform(["type": "scroll", "target": matrixPoint("editorPoint"), "deltaX": 0, "deltaY": key == "End" || key == "PageDown" ? 10000 : -350]); try inactive()
            snapshot = try observe(); let before = try matrix(), packetIndex = inputCount()
            _ = try native.result(press(key, boundPoint: true)); try inactive(); try assertKeyPackets(key, after: packetIndex); let after = try matrix()
            let oldY = before["viewportY"] as! Double, newY = after["viewportY"] as! Double
            let movesUp = key == "Home" || key == "PageUp"
            guard movesUp ? newY < oldY : newY > oldY else { emit(["phase": "page-effect-mismatch", "key": key, "beforeY": oldY, "afterY": newY]); throw failure("viewport-key-effect") }
            emit(["phase": "matrix-named-key", "key": key, "beforeY": oldY, "afterY": newY, "passed": true])
        }
        try prepare(String(repeating: "W", count: 180) + "\n" + longText, location: 0)
        _ = try perform(["type": "scroll", "target": matrixPoint("editorPoint"), "deltaX": 10000, "deltaY": 0]); try inactive()
        let horizontalBefore = try matrix()["viewportX"] as! Double
        _ = try perform(["type": "scroll", "target": matrixPoint("editorPoint"), "deltaX": -160, "deltaY": 0]); try inactive()
        let horizontalAfter = try matrix()["viewportX"] as! Double
        _ = try perform(["type": "scroll", "target": matrixPoint("editorPoint"), "deltaX": 80, "deltaY": 0]); try inactive()
        let horizontalReturn = try matrix()["viewportX"] as! Double
        guard horizontalAfter > horizontalBefore, horizontalReturn < horizontalAfter else {
            emit(["phase": "horizontal-effect-mismatch", "beforeX": horizontalBefore, "afterNegative160X": horizontalAfter, "afterPositive80X": horizontalReturn, "ownedMatrixMetadata": try matrix()]); throw failure("horizontal-scroll-effect")
        }
        emit(["phase": "matrix-horizontal-scroll", "beforeX": horizontalBefore, "afterNegative160X": horizontalAfter, "afterPositive80X": horizontalReturn, "passed": true])
        if ProcessInfo.processInfo.environment["DJL_TEST_MATRIX_AXES_ONLY"] == "1" {
            let result = observer.snapshot(), checks = result["inputChecks"] as? [Object] ?? []
            guard !checks.isEmpty, checks.allSatisfy({ $0["victimOwnershipVerified"] as? Bool == true && $0["modifierStatePreserved"] as? Bool == true }) else { throw failure("key-axis-input-ownership-or-global-modifiers") }
            emit(["phase": "matrix-key-axis-summary", "passed": true, "namedKeyCases": 15, "fullArgumentMatrixComplete": false, "independentWitness": result])
            cleanup(); exit(0)
        }
        try prepare("matrix", location: 6)
        _ = try perform(["type": "type", "target": reference("AXTextArea"), "text": " Unicode输入🧪"]); try inactive()
        guard try textValue() == "matrix Unicode输入🧪" else { throw failure("normal-textarea-unicode-effect") }
        emit(["phase": "matrix-normal-textarea-type", "actualTextEffect": true, "passed": true])
        }
        var missing: [Object] = []
        for button in ["left", "right", "middle"] {
            for count in 1...3 {
                let before = try matrix(), priorDown = (before["pointerDowns"] as! [String: Int])[button]!, priorUp = (before["pointerUps"] as! [String: Int])[button]!
                let response = try native.request(["method": "session.perform", "sessionId": session, "action": ["type": "click", "target": matrixPoint("pointerPoint"), "button": button, "count": count]], invariant: invariant)
                if response["error"] != nil { missing.append(["button": button, "count": count, "response": response]); continue }
                try inactive(); let after = try matrix()
                let downs = (after["pointerDowns"] as! [String: Int])[button]!, ups = (after["pointerUps"] as! [String: Int])[button]!
                let clicks = (after["clickCounts"] as! [String: [Int]])[button]!
                guard downs == priorDown + count, ups == priorUp + count, Array(clicks.suffix(count)) == Array(1...count) else { throw failure("pointer-button-count-or-release-effect") }
                emit(["phase": "matrix-pointer", "button": button, "count": count, "matchedDownUpEffects": true, "passed": true])
            }
        }
        let modifierCases: [(String, [String], Int, Int)] = [
            ("ArrowRight", ["shift"], 8, 1), ("ArrowLeft", ["option"], 6, 0),
            ("ArrowLeft", ["command"], 0, 0), ("A", ["control"], 0, 0),
            ("a", ["command"], 0, 16), ("ArrowLeft", ["command", "shift"], 0, 8)]
        for (key, modifiers, expectedLocation, expectedLength) in modifierCases {
            try prepare("alpha beta gamma", location: 8)
            let packetIndex = inputCount()
            let response = try press(key, modifiers: modifiers)
            if response["error"] != nil { missing.append(["key": key, "modifiers": modifiers, "response": response]); continue }
            try inactive(); try assertKeyPackets(key, modifiers: modifiers, after: packetIndex); let after = try matrix()
            guard after["selectionLocation"] as? Int == expectedLocation, after["selectionLength"] as? Int == expectedLength, try textValue() == "alpha beta gamma" else { emit(["phase": "modifier-effect-mismatch", "key": key, "modifiers": modifiers, "matrix": after]); throw failure("modifier-selection-effect") }
            emit(["phase": "matrix-modifiers", "key": key, "modifiers": modifiers, "selectionEffect": true, "passed": true])
        }
        for (key, expected) in [("A", "a"), ("a", "a"), ("1", "1")] {
            try prepare("", location: 0); let packetIndex = inputCount()
            let response = try press(key)
            if response["error"] != nil { missing.append(["key": key, "response": response]); continue }
            try inactive(); try assertKeyPackets(key, after: packetIndex)
            guard try textValue() == expected else { throw failure("physical-ansi-key-effect") }
            emit(["phase": "matrix-physical-ansi-key", "key": key, "textEffectOnTestLayout": true, "passed": true])
        }
        try prepare("known clipboard guard text", location: 3)
        for key in ["C", "v", "X"] {
            snapshot = try observe() // Every perform, including rejection, revokes references.
            let before = try state(targetState, targetPid), packetIndex = inputCount(), textBefore = try textValue()
            let response = try press(key, modifiers: ["command"]), after = try state(targetState, targetPid)
            guard (response["error"] as? Object)?["code"] as? String == "unsupported", inputCount() == packetIndex,
                  before["activationCount"] as? Int == after["activationCount"] as? Int,
                  before["deactivationCount"] as? Int == after["deactivationCount"] as? Int,
                  try textValue() == textBefore else {
                emit(["phase": "raw-clipboard-rejection-mismatch", "key": key, "response": response, "newInputPackets": inputCount() - packetIndex,
                      "activationBefore": before["activationCount"] ?? -1, "activationAfter": after["activationCount"] ?? -1,
                      "deactivationBefore": before["deactivationCount"] ?? -1, "deactivationAfter": after["deactivationCount"] ?? -1])
                throw failure("raw-clipboard-shortcut-not-rejected-before-seed")
            }
        }
        emit(["phase": "matrix-raw-clipboard-shortcuts-rejected-before-seed", "passed": true, "temporaryPendingGuardedClipboard": true, "clipboardAccessed": false])
        guard missing.isEmpty else { emit(["phase": "matrix-missing-capabilities", "missing": missing]); throw failure("matrix-capabilities-not-implemented") }
        let beforeStop = try matrix(), stopLock = NSLock()
        var stopID: String?, stopSendFailed = false
        observer.lock.withLock {
            observer.stopOnRightDown = {
                do { let id = try native.send(["method": "stop", "sessionId": session]); stopLock.withLock { stopID = id } }
                catch { stopLock.withLock { stopSendFailed = true } }
            }
        }
        let clickID = try native.send(["method": "session.perform", "sessionId": session,
            "action": ["type": "click", "target": matrixPoint("pointerPoint"), "button": "right", "count": 3]])
        let interrupted = try native.receive(clickID, invariant: invariant)
        guard let requestedStop = stopLock.withLock({ stopID }), !stopLock.withLock({ stopSendFailed }) else { throw failure("known-right-down-did-not-trigger-owned-stop") }
        _ = try native.result(native.receive(requestedStop, invariant: invariant)); try inactive()
        let afterStop = try matrix()
        let rightDowns = (afterStop["pointerDowns"] as! [String: Int])["right"]! - (beforeStop["pointerDowns"] as! [String: Int])["right"]!
        let rightUps = (afterStop["pointerUps"] as! [String: Int])["right"]! - (beforeStop["pointerUps"] as! [String: Int])["right"]!
        guard (interrupted["error"] as? Object)?["code"] as? String == "cancelled", rightDowns > 0, rightDowns <= 3, rightUps == rightDowns else {
            emit(["phase": "right-multiclick-stop-not-proven", "response": interrupted, "newDowns": rightDowns, "newUps": rightUps]); throw failure("right-multiclick-stop-or-pairing")
        }
        emit(["phase": "matrix-stop-right-multiclick", "newDowns": rightDowns, "newUps": rightUps, "passed": true])
        let result = observer.snapshot(), checks = result["inputChecks"] as? [Object] ?? []
        guard !checks.isEmpty, checks.allSatisfy({ $0["victimOwnershipVerified"] as? Bool == true && $0["modifierStatePreserved"] as? Bool == true }) else { throw failure("matrix-input-ownership-or-global-modifiers") }
        emit(["phase": capabilitiesOnly ? "matrix-capabilities-summary" : "matrix-summary", "passed": true, "fullArgumentMatrixComplete": !capabilitiesOnly, "knownHelperInputMetadata": try matrix()["inputMetadata"] ?? [], "independentWitness": result])
        cleanup(); exit(0)
    }
    let buttonBefore = try state(targetState, targetPid)["buttonCount"] as! Int
    _ = try perform(["type": "click", "target": reference("AXButton")]); try inactive()
    guard try state(targetState, targetPid)["buttonCount"] as! Int == buttonBefore + 1 else { throw failure("protected-axpress-effect") }
    snapshot = try observe()
    _ = try perform(["type": "setValue", "target": reference("AXTextField"), "value": "protected-fixture"]); try inactive()
    snapshot = try observe()
    guard (snapshot["elements"] as! [Object]).contains(where: { $0["role"] as? String == "AXTextField" && $0["value"] as? String == "protected-fixture" }) else { throw failure("protected-ax-setvalue-effect") }
    emit(["phase": "protected-default-ax", "passed": true, "keyFocus": api.focus()])
    let pointerBefore = try state(targetState, targetPid)
    _ = try perform(["type": "click", "target": point("button")]); try inactive()
    guard try state(targetState, targetPid)["buttonCount"] as! Int == (pointerBefore["buttonCount"] as! Int) + 1 else { throw failure("protected-coordinate-click-effect") }
    let scrollBefore = try state(targetState, targetPid)
    _ = try perform(["type": "scroll", "target": point("scroll"), "deltaX": 0, "deltaY": 160]); try inactive()
    let scrollAfter = try state(targetState, targetPid)
    guard (scrollAfter["scrollCount"] as! Int) > (scrollBefore["scrollCount"] as! Int), (scrollAfter["scrollOffset"] as! Double) != (scrollBefore["scrollOffset"] as! Double) else { throw failure("protected-scroll-effect") }
    emit(["phase": "protected-single-left-click-vertical-scroll", "passed": true, "keyFocus": api.focus()])
    let dragBefore = try state(targetState, targetPid)
    let drag = try native.send(["method": "session.perform", "sessionId": session, "action": ["type": "drag", "from": point("dragStart"), "to": point("dragEnd"), "durationMs": 900]])
    let startDeadline = Date().addingTimeInterval(2)
    var started = false
    while Date() < startDeadline {
        try invariant()
        let value = try state(targetState, targetPid)
        if value["leftMouseHeld"] as? Bool == true, (value["leftDownCount"] as! Int) == (dragBefore["leftDownCount"] as! Int) + 1 { started = true; break }
        pumpMainRunLoop(for: 0.005)
    }
    guard started else { throw failure("protected-drag-not-started") }
    let fake = Process(); fake.executableURL = directory.appendingPathComponent("FakeFixtureKeyController")
    fake.arguments = [String(targetPid), String(targetObject["windowId"] as! UInt32), String(foreignTag)]
    fake.standardOutput = FileHandle.nullDevice; fake.standardError = FileHandle.nullDevice
    try fake.run()
    let fakeDeadline = Date().addingTimeInterval(1)
    while fake.isRunning && Date() < fakeDeadline { try invariant(); pumpMainRunLoop(for: 0.005) }
    guard !fake.isRunning, fake.terminationStatus == 0 else { if fake.isRunning { fake.terminate() }; throw failure("fake-controller-failed") }
    _ = try native.result(native.receive(drag, invariant: invariant)); try inactive()
    let targetAfter = try state(targetState, targetPid), victimAfter = try state(victimState, victimPid)
    let victimTags = victimAfter["taggedKeyEvents"] as? [[String: Int64]] ?? []
    let targetTags = targetAfter["taggedKeyEvents"] as? [[String: Int64]] ?? []
    guard victimTags.map({ $0["tag"]! }) == [foreignTag], targetTags.isEmpty,
          victimAfter["knownForeignMarkerInserted"] as? Bool == true,
          targetAfter["knownForeignMarkerInserted"] as? Bool == false,
          (targetAfter["dragCount"] as! Int) == (dragBefore["dragCount"] as! Int) + 1,
          (targetAfter["leftUpCount"] as! Int) == (dragBefore["leftUpCount"] as! Int) + 1 else { throw failure("actual-helper-foreign-routing-or-drag-effect") }
    emit(["phase": "actual-helper-protected-drag-routing", "passed": true, "victimTagMetadata": victimTags, "targetTagMetadata": targetTags, "victimEditorMarkerInserted": true, "targetEditorMarkerAbsent": true, "keyFocus": api.focus()])
    _ = try perform(["type": "click", "target": point("text")]); try inactive()
    snapshot = try observe()
    _ = try perform(["type": "type", "target": reference("AXTextField"), "text": " agent输入🧪"]); try inactive()
    let typed = try state(targetState, targetPid)
    let ownTags = typed["taggedKeyEvents"] as? [[String: Int64]] ?? []
    guard ownTags.contains(where: { $0["tag"] == 0 && $0["sourcePid"] == Int64(native.process.processIdentifier) }),
          !(ownTags.contains { $0["tag"] == foreignTag }) else { throw failure("helper-own-unicode-source-not-delivered") }
    snapshot = try observe()
    guard (snapshot["elements"] as! [Object]).contains(where: { ($0["role"] as? String == "AXTextField") && ($0["value"] as? String ?? "").contains(" agent输入🧪") }) else { throw failure("actual-protected-unicode-text-effect") }
    emit(["phase": "actual-helper-protected-unicode", "passed": true, "targetTagMetadata": ownTags, "keyFocus": api.focus()])
    let textBeforeBackspace = (snapshot["elements"] as! [Object]).first { $0["role"] as? String == "AXTextField" }?["value"] as? String
    let keyCountBefore = try state(targetState, targetPid)["keyCount"] as! Int
    _ = try perform(["type": "pressKey", "target": reference("AXTextField"), "key": "Backspace", "modifiers": []]); try inactive()
    snapshot = try observe()
    let textAfterBackspace = (snapshot["elements"] as! [Object]).first { $0["role"] as? String == "AXTextField" }?["value"] as? String
    guard textBeforeBackspace != nil, textAfterBackspace != nil, textBeforeBackspace != textAfterBackspace,
          try state(targetState, targetPid)["keyCount"] as! Int == keyCountBefore + 1 else { throw failure("protected-backspace-effect") }
    emit(["phase": "protected-backspace", "passed": true, "keyFocus": api.focus()])
    let stopBefore = try state(targetState, targetPid)
    let stoppedDrag = try native.send(["method": "session.perform", "sessionId": session, "action": ["type": "drag", "from": point("dragStart"), "to": point("dragEnd"), "durationMs": 3000]])
    let stopStartDeadline = Date().addingTimeInterval(2)
    var stopStarted = false
    while Date() < stopStartDeadline {
        try invariant(); let value = try state(targetState, targetPid)
        if value["leftMouseHeld"] as? Bool == true, (value["leftDownCount"] as! Int) == (stopBefore["leftDownCount"] as! Int) + 1 { stopStarted = true; break }
        pumpMainRunLoop(for: 0.005)
    }
    guard stopStarted else { throw failure("stop-drag-not-started") }
    _ = try native.result(native.request(["method": "stop", "sessionId": session], invariant: invariant))
    let cancelled = try native.receive(stoppedDrag, invariant: invariant)
    guard (cancelled["error"] as? Object)?["code"] as? String == "cancelled" else { emit(["phase": "stop-response", "response": cancelled]); throw failure("drag-stop-not-cancelled") }
    pumpMainRunLoop(for: 0.05); try inactive()
    let stopAfter = try state(targetState, targetPid)
    guard (stopAfter["leftUpCount"] as! Int) == (stopBefore["leftUpCount"] as! Int) + 1, stopAfter["leftMouseHeld"] as? Bool == false else { throw failure("stop-drag-release-not-paired") }
    let cycles = native.lock.withLock { native.protectionEvents }
    guard cycles.count == 18, stride(from: 0, to: cycles.count, by: 2).allSatisfy({ cycles[$0] == "active" && cycles[$0 + 1] == "safe" }) else { emit(["phase": "protection-event-cycles", "events": cycles]); throw failure("protection-active-safe-event-order") }
    let witnessResult = observer.snapshot()
    let inputChecks = witnessResult["inputChecks"] as? [Object] ?? []
    let inputTypes = Set(inputChecks.compactMap { ($0["type"] as? NSNumber)?.uint32Value })
    guard [UInt32(1), UInt32(10), UInt32(22)].allSatisfy(inputTypes.contains),
          inputChecks.allSatisfy({ $0["victimOwnershipVerified"] as? Bool == true }),
          witnessResult["healthy"] as? Bool == true, valid(api.focus(), pid: victimPid) else {
        throw failure("missing-helper-source-input-witness-or-unsafe-delivery")
    }
    emit(["phase": "protected-helper-summary", "protectionEvents": cycles, "independentMetadataWitness": witnessResult, "passed": true, "keyFocus": api.focus(), "stopPairedRelease": true, "targetInactive": true, "foregroundCursorHidPreserved": true])
    cleanup()
} catch {
    emit(["phase": "failed", "error": String(describing: error), "witness": witness?.snapshot() ?? [:]])
    cleanup(); exit(10)
}

import AppKit
import ApplicationServices
import CoreGraphics
import Darwin

typealias Object = [String: Any]
typealias ReadFocus = @convention(c) (UnsafeMutablePointer<ProcessSerialNumber>, UnsafeMutablePointer<UInt8>) -> Int32
typealias ResolvePid = @convention(c) (UnsafePointer<ProcessSerialNumber>, UnsafeMutablePointer<pid_t>) -> Int32
typealias ReleaseFocus = @convention(c) (UInt32) -> Int32
// Processes.h declares OSErr (SInt16), unlike GetProcessPID's OSStatus (SInt32).
typealias ReadFrontProcess = @convention(c) (UnsafeMutablePointer<ProcessSerialNumber>) -> Int16
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
    let readFront: ReadFrontProcess
    init() throws {
        guard let core = dlopen("/System/Library/Frameworks/CoreGraphics.framework/Versions/A/CoreGraphics", RTLD_NOW | RTLD_LOCAL),
              let get = dlsym(core, "CPSGetKeyFocusProcess"), let release = dlsym(core, "CPSReleaseKeyFocusWithID"),
              let services = dlopen("/System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/HIServices", RTLD_NOW | RTLD_LOCAL),
              let pid = dlsym(services, "GetProcessPID"), let front = dlsym(services, "GetFrontProcess") else { throw failure("apple-focus-api-unavailable") }
        self.read = unsafeBitCast(get, to: ReadFocus.self); self.release = unsafeBitCast(release, to: ReleaseFocus.self)
        self.resolve = unsafeBitCast(pid, to: ResolvePid.self)
        self.readFront = unsafeBitCast(front, to: ReadFrontProcess.self)
    }
    func focus() -> Object {
        var psn = ProcessSerialNumber(highLongOfPSN: 0, lowLongOfPSN: 0), flag: UInt8 = 0, pid: pid_t = 0
        let status = read(&psn, &flag)
        let pidStatus = status == 0 ? resolve(&psn, &pid) : Int32(-1)
        return ["cpsStatus": status, "pidStatus": pidStatus, "pid": pid, "rawFlag": flag,
                "psnHigh": psn.highLongOfPSN, "psnLow": psn.lowLongOfPSN]
    }
    func foreground() -> Object {
        var psn = ProcessSerialNumber(highLongOfPSN: 0, lowLongOfPSN: 0), pid: pid_t = 0
        let status = readFront(&psn), pidStatus = status == 0 ? resolve(&psn, &pid) : Int32(-1)
        return ["frontStatus": status, "pidStatus": pidStatus, "pid": pid,
                "psnHigh": psn.highLongOfPSN, "psnLow": psn.lowLongOfPSN,
                "observedNs": DispatchTime.now().uptimeNanoseconds]
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
func ownedProcessIdentity(_ pid: pid_t) -> String? {
    var info = proc_bsdinfo(); let size = MemoryLayout<proc_bsdinfo>.size
    guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(size)) == size, info.pbi_start_tvsec > 0 else { return nil }
    var path = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
    guard proc_pidpath(pid, &path, UInt32(path.count)) > 0 else { return nil }
    return "\(info.pbi_start_tvsec):\(info.pbi_start_tvusec):" + URL(fileURLWithPath: String(cString: path)).resolvingSymlinksInPath().standardizedFileURL.path
}
struct Suppression {
    let thief: pid_t
    let victim: pid_t
    var released = false
    var returned = false
}
final class OwnedFocusProtection {
    let target: pid_t
    let victim: pid_t
    let api: FocusAPI
    let targetIdentity: String?
    let victimIdentity: String?
    let ownSeedOnly: Bool
    var ownSeed: FocusRoutingState
    let lock = NSLock()
    let ready = DispatchSemaphore(value: 0)
    let ended = DispatchSemaphore(value: 0)
    var healthy = false
    var record: Suppression?
    var logs: [Object] = []
    var notificationTap: CFMachPort?
    var keyboardTap: CFMachPort?
    var loop: CFRunLoop?
    init(target: pid_t, victim: pid_t, api: FocusAPI, ownSeedOnly: Bool = false) {
        self.target = target; self.victim = victim; self.api = api
        self.ownSeedOnly = ownSeedOnly; ownSeed = FocusRoutingState(target: target, victim: victim)
        targetIdentity = ownedProcessIdentity(target); victimIdentity = ownedProcessIdentity(victim)
    }
    func log(_ value: Object) { lock.withLock { if logs.count < 200 { logs.append(value) } } }
    func start() -> Bool {
        Thread { [self] in
            let context = Unmanaged.passUnretained(self).toOpaque()
            notificationTap = CGEvent.tapCreate(tap: .cgAnnotatedSessionEventTap, place: .tailAppendEventTap, options: .defaultTap,
                eventsOfInterest: CGEventMask(1) << 21, callback: Self.notificationCallback, userInfo: context)
            keyboardTap = CGEvent.tapCreateForPid(pid: target, place: .tailAppendEventTap, options: .defaultTap,
                eventsOfInterest: (CGEventMask(1) << 10) | (CGEventMask(1) << 11) | (CGEventMask(1) << 12),
                callback: Self.keyboardCallback, userInfo: context)
            guard let metadata = notificationTap, let keyboard = keyboardTap,
                  let metadataSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, metadata, 0),
                  let keyboardSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, keyboard, 0) else {
                if let tap = notificationTap { CFMachPortInvalidate(tap) }; if let tap = keyboardTap { CFMachPortInvalidate(tap) }
                log(["phase": "tap-install-failed", "metadata": notificationTap != nil, "keyboard": keyboardTap != nil])
                ready.signal(); ended.signal(); return
            }
            loop = CFRunLoopGetCurrent()
            CFRunLoopAddSource(loop, metadataSource, .commonModes); CFRunLoopAddSource(loop, keyboardSource, .commonModes)
            CGEvent.tapEnable(tap: metadata, enable: true); CGEvent.tapEnable(tap: keyboard, enable: true)
            lock.withLock { healthy = CGEvent.tapIsEnabled(tap: metadata) && CGEvent.tapIsEnabled(tap: keyboard) }
            log(["phase": "taps-installed", "healthy": isHealthy()]); ready.signal()
            CFRunLoopRun()
            CFMachPortInvalidate(metadata); CFMachPortInvalidate(keyboard)
            ended.signal()
        }.start()
        guard ready.wait(timeout: .now() + 2) == .success else { return false }
        return isHealthy()
    }
    func isHealthy() -> Bool { lock.withLock { healthy } }
    func snapshot() -> Object {
        lock.withLock { ["healthy": healthy, "recordPresent": record != nil, "released": record?.released ?? false,
                         "returned": record?.returned ?? false, "ownSeedIssued": ownSeed.ownSeedIssued, "events": logs] }
    }
    func stop() {
        lock.withLock { healthy = false; record = nil }
        if let loop = loop { CFRunLoopStop(loop); CFRunLoopWakeUp(loop); _ = ended.wait(timeout: .now() + 1) }
    }
    static let notificationCallback: CGEventTapCallBack = { _, type, event, context in
        guard let context = context else { return Unmanaged.passUnretained(event) }
        let owner = Unmanaged<OwnedFocusProtection>.fromOpaque(context).takeUnretainedValue()
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            owner.lock.withLock { owner.healthy = false }
            owner.log(["phase": "tap-disabled", "kind": "notification", "type": type.rawValue])
            return Unmanaged.passUnretained(event) // Never re-enable a user-disabled tap.
        }
        guard type.rawValue == 21 else { return Unmanaged.passUnretained(event) }
        let entryNs = DispatchTime.now().uptimeNanoseconds
        let rawSubtype = event.getIntegerValueField(CGEventField(rawValue: 64)!)
        let subtype = UInt16(truncatingIfNeeded: rawSubtype)
        let target = event.getIntegerValueField(.eventTargetUnixProcessID)
        let affected = event.getIntegerValueField(CGEventField(rawValue: 73)!)
        let token = event.getIntegerValueField(CGEventField(rawValue: 71)!)
        let touchesOwned = [Int64(owner.target), Int64(owner.victim)].contains(target) || [Int64(owner.target), Int64(owner.victim)].contains(affected)
        if !touchesOwned {
            if (subtype == 0xf102 && affected > 0) || subtype == 0x4000 { owner.lock.withLock { owner.record = nil } }
            return Unmanaged.passUnretained(event)
        }
        owner.log(["phase": "notification", "entryNs": entryNs, "subtype": subtype, "rawSubtype": rawSubtype,
                   "targetPid": target, "affectedPid": affected, "focusToken": token])
        // Isolate the independent fallback in this test only: real notifications
        // remain untouched, and cannot fabricate a record or release a token.
        if owner.ownSeedOnly { return Unmanaged.passUnretained(event) }
        if subtype == 0x4000 && target == Int64(owner.victim) && affected == Int64(owner.target) {
            // Match the product's real identity-validation work, without adding
            // synthetic Taken state or an artificial callback delay.
            guard let targetIdentity = owner.targetIdentity, let victimIdentity = owner.victimIdentity,
                  ownedProcessIdentity(owner.target) == targetIdentity, ownedProcessIdentity(owner.victim) == victimIdentity else {
                owner.lock.withLock { owner.healthy = false }; owner.log(["phase": "identity-validation-failed"])
                return Unmanaged.passUnretained(event)
            }
            owner.lock.withLock { owner.record = Suppression(thief: owner.target, victim: owner.victim) }
            owner.log(["phase": "taken-suppressed", "recordCreatedNs": DispatchTime.now().uptimeNanoseconds, "entryNs": entryNs])
            return nil
        }
        if subtype == 0x4000 {
            owner.lock.withLock { owner.record = nil }
            owner.log(["phase": "record-retired-nonqualifying-taken"])
        }
        if subtype == 0x8000 {
            let suppress = owner.lock.withLock { () -> Bool in
                guard var record = owner.record, !record.returned, target == Int64(record.victim) else { return false }
                record.returned = true; owner.record = record; return true
            }
            if suppress { owner.log(["phase": "return-suppressed"]); return nil }
        }
        if subtype == 0xf102 {
            let release = owner.lock.withLock { () -> Bool in
                guard var record = owner.record else { return false }
                if affected != Int64(record.thief) && affected != Int64(record.victim) { owner.record = nil; return false }
                guard affected == Int64(record.thief), !record.released else { return false }
                record.released = true; owner.record = record; return true
            }
            if release {
                guard token >= 0 && token <= Int64(UInt32.max) else {
                    owner.lock.withLock { owner.healthy = false }; owner.log(["phase": "invalid-focus-token"])
                    return Unmanaged.passUnretained(event)
                }
                let status = owner.api.release(UInt32(token))
                owner.log(["phase": "release-owned-focus-token", "status": status, "token": token])
                if status != 0 { owner.lock.withLock { owner.healthy = false } }
            }
        }
        if subtype == 2 && affected == Int64(owner.target) {
            owner.lock.withLock { owner.record = nil }
            owner.log(["phase": "record-retired-new-front"])
        }
        return Unmanaged.passUnretained(event)
    }
    static let keyboardCallback: CGEventTapCallBack = { _, type, event, context in
        guard let context = context else { return Unmanaged.passUnretained(event) }
        let owner = Unmanaged<OwnedFocusProtection>.fromOpaque(context).takeUnretainedValue()
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            owner.lock.withLock { owner.healthy = false }
            owner.log(["phase": "tap-disabled", "kind": "keyboard", "type": type.rawValue])
            return Unmanaged.passUnretained(event)
        }
        let entryNs = DispatchTime.now().uptimeNanoseconds
        let source = event.getIntegerValueField(.eventSourceUnixProcessID)
        let target = event.getIntegerValueField(.eventTargetUnixProcessID)
        let tag = event.getIntegerValueField(.eventSourceUserData)
        if source == Int64(getpid()) {
            owner.log(["phase": "own-source-passed", "entryNs": entryNs, "decisionNs": DispatchTime.now().uptimeNanoseconds, "sourcePid": source, "targetPid": target, "tag": tag])
            return Unmanaged.passUnretained(event)
        }
        if owner.ownSeedOnly {
            let identities = ownedProcessIdentity(owner.target) == owner.targetIdentity && ownedProcessIdentity(owner.victim) == owner.victimIdentity
            let front = owner.api.foreground(), focus = owner.api.focus()
            let foreground = front["frontStatus"] as? Int16 == 0 && front["pidStatus"] as? Int32 == 0 ? front["pid"] as? Int32 : nil
            let focusPid = focus["cpsStatus"] as? Int32 == 0 && focus["pidStatus"] as? Int32 == 0 ? focus["pid"] as? Int32 : nil
            let decision = owner.lock.withLock {
                owner.ownSeed.keyboardDisposition(sourcePid: source, targetPid: target, helperPid: getpid(),
                    foregroundPid: foreground, focusPid: focusPid, healthy: owner.healthy, identitiesVerified: identities)
            }
            if decision == .forward { event.postToPid(owner.victim) }
            owner.log(["phase": "own-seed-foreign-disposition", "entryNs": entryNs, "decision": String(describing: decision),
                       "sourcePid": source, "tag": tag, "focusPid": focusPid ?? -1, "foregroundPid": foreground ?? -1,
                       "naturalRecordPresent": false])
            return decision == .forward || decision == .consume ? nil : Unmanaged.passUnretained(event)
        }
        let route = owner.lock.withLock { owner.healthy && owner.record?.thief == owner.target && owner.record?.victim == owner.victim && target == Int64(owner.target) }
        if route {
            // Forward the existing packet unchanged; never inspect characters/keycodes.
            event.postToPid(owner.victim)
            owner.log(["phase": "foreign-source-forwarded", "entryNs": entryNs, "decisionNs": DispatchTime.now().uptimeNanoseconds, "sourcePid": source, "targetPid": target, "victimPid": owner.victim, "tag": tag])
            return nil
        }
        owner.log(["phase": "foreign-source-passed-without-record", "entryNs": entryNs, "decisionNs": DispatchTime.now().uptimeNanoseconds, "sourcePid": source, "targetPid": target, "tag": tag])
        return Unmanaged.passUnretained(event)
    }
}

let probeApplication = NSApplication.shared
probeApplication.setActivationPolicy(.prohibited)
let directory = URL(fileURLWithPath: "/private/tmp/djl-cua-keyboard-protection")
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
let fixtureURL = URL(fileURLWithPath: "/private/tmp/djl-cua-background-probe/DJLBackgroundFixture.app/Contents/MacOS/DJLBackgroundFixture")
let victimState = directory.appendingPathComponent("victim-state.json"), targetState = directory.appendingPathComponent("target-state.json")
let agentTag: Int64 = 960001, foreignTag: Int64 = 960002
let panelTarget = CommandLine.arguments.contains("--panel-target")
let criticalMode = CommandLine.arguments.contains("--critical-window")
let foregroundABIOnly = CommandLine.arguments.contains("--foreground-abi-only")
let ownSeedOnly = CommandLine.arguments.contains("--own-seed-only")
let victim = Process(), target = Process()
var protection: OwnedFocusProtection?
var seedOwned = false
var criticalController: Process?
var criticalInput: Pipe?
func state(_ path: URL, _ pid: pid_t) throws -> Object {
    let value = try JSONSerialization.jsonObject(with: Data(contentsOf: path)) as! Object
    guard value["pid"] as? Int32 == pid, value["bundleId"] as? String == "com.djl.computer-use.background-fixture" else { throw failure("fixture-state-identity-\(path.lastPathComponent)-expected-\(pid)-actual-\(value["pid"] ?? "missing")") }
    return value
}
func cleanup() {
    if seedOwned && target.isRunning {
        if NSWorkspace.shared.frontmostApplication?.processIdentifier != target.processIdentifier { try? notification(2, target.processIdentifier) }
        pumpMainRunLoop(for: 0.1); seedOwned = false
    }
    if criticalMode && protection != nil, let focus = try? FocusAPI().focus() {
        let stillTarget = focus["pid"] as? Int32 == target.processIdentifier
        if stillTarget && NSWorkspace.shared.frontmostApplication?.processIdentifier != target.processIdentifier {
            if target.isRunning { target.terminate() }; pumpMainRunLoop(for: 0.1)
        }
        emit(["phase": "critical-cleanup-before-tap-retirement", "keyFocus": (try? FocusAPI().focus()) ?? [:], "targetRunning": target.isRunning,
              "targetState": (try? state(targetState, target.processIdentifier)) ?? [:]])
    }
    protection?.stop(); protection = nil
    try? criticalInput?.fileHandleForWriting.close(); criticalInput = nil
    if criticalController?.isRunning == true { criticalController?.terminate() }; criticalController = nil
    if target.isRunning { target.terminate() }; if victim.isRunning { victim.terminate() }
}
atexit { cleanup() }
do {
    guard AXIsProcessTrusted() else { throw failure("accessibility-permission-not-granted-no-prompt") }
    let api = try FocusAPI(), beforeSetup = api.focus(), beforeFront = api.foreground()
    let systemDialogs: Set<String> = ["com.apple.UserNotificationCenter", "com.apple.SecurityAgent", "com.apple.loginwindow"]
    let foregroundBundle = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "unknown"
    let focusBundle = (beforeSetup["pid"] as? Int32).flatMap { NSRunningApplication(processIdentifier: $0)?.bundleIdentifier } ?? "unknown"
    let frontBundle = (beforeFront["pid"] as? Int32).flatMap { NSRunningApplication(processIdentifier: $0)?.bundleIdentifier } ?? "unknown"
    guard beforeSetup["cpsStatus"] as? Int32 == 0, beforeSetup["pidStatus"] as? Int32 == 0,
          (beforeSetup["pid"] as? Int32 ?? 0) > 0, foregroundBundle != "unknown", focusBundle != "unknown",
          beforeFront["frontStatus"] as? Int16 == 0, beforeFront["pidStatus"] as? Int32 == 0,
          (beforeFront["pid"] as? Int32 ?? 0) > 0, frontBundle != "unknown" else {
        emit(["phase": "guarded-abort", "reason": "valid-read-only-foreground-and-keyboard-baseline-unavailable"]); cleanup(); exit(20)
    }
    if systemDialogs.contains(foregroundBundle) || systemDialogs.contains(focusBundle) || systemDialogs.contains(frontBundle) {
        emit(["phase": "guarded-abort", "reason": "system-dialog-owns-foreground-or-keyboard"]); cleanup(); exit(20)
    }
    let mouse = CGEvent(source: nil)?.location ?? .zero, hid = hardwareCount()
    emit(["phase": "before-owned-foreground-setup", "keyFocus": beforeSetup, "frontProcess": beforeFront,
          "foregroundPid": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1])
    for (process, path, title, foreground) in [(target, targetState, "DJL Keyboard Target", false), (victim, victimState, "DJL Keyboard Victim", true)] {
        process.executableURL = fixtureURL
        process.arguments = ["--metadata-only-state", "--state-file", path.path, "--title", title,
                             "--test-key-tags", "\(agentTag),\(foreignTag)", "--test-foreign-marker", "DJL_FOREIGN_960002"]
            + ((foreground || !panelTarget) ? ["--regular-app", "--standard-window"] : [])
            + (foreground ? ["--history-foreground"] : ["--self-deactivate"])
        process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
        let workspaceBeforeLaunch = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1
        try process.run()
        if foregroundABIOnly && foreground {
            // The victim's existing setup activates only itself. Withhold this
            // observer's runloop to distinguish live queries from cached state.
            let transitionDeadline = Date().addingTimeInterval(0.8)
            var transition: Object = [:]
            while Date() < transitionDeadline {
                let front = api.foreground()
                if front["pid"] as? Int32 == process.processIdentifier {
                    transition = ["front": front, "workspaceBeforeLaunch": workspaceBeforeLaunch,
                                  "workspaceWithoutPumping": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1,
                                  "ownedVictimPid": process.processIdentifier, "observerMainRunLoopPumped": false]
                    break
                }
                Thread.sleep(forTimeInterval: 0.005)
            }
            emit(["phase": "foreground-abi-owned-setup-transition", "observed": !transition.isEmpty, "transition": transition])
        }
        for _ in 0..<30 { if (try? state(path, process.processIdentifier)) != nil { break }; pumpMainRunLoop(for: 0.05) }
    }
    pumpMainRunLoop(for: 0.8)
    let victimPid = victim.processIdentifier, targetPid = target.processIdentifier
    let victimApp = NSRunningApplication(processIdentifier: victimPid)
    let activationAccepted = victimApp?.activate(options: []) ?? false
    pumpMainRunLoop(for: 0.3)
    emit(["phase": "owned-setup-diagnostics", "controllerActivationAccepted": activationAccepted,
          "victimActivationPolicy": victimApp?.activationPolicy.rawValue ?? -1, "victimPid": victimPid, "targetPid": targetPid,
          "keyFocus": api.focus(), "foregroundPid": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1,
          "victimState": try state(victimState, victimPid), "targetState": try state(targetState, targetPid)])
    guard valid(api.focus(), pid: victimPid), NSWorkspace.shared.frontmostApplication?.processIdentifier == victimPid,
          CGEvent(source: nil)?.location == mouse, hardwareCount() == hid,
          let app = NSRunningApplication(processIdentifier: targetPid), app.bundleIdentifier == "com.djl.computer-use.background-fixture",
          app.executableURL?.resolvingSymlinksInPath() == fixtureURL.resolvingSymlinksInPath(),
          (try state(targetState, targetPid))["isActive"] as? Bool == false else { throw failure("owned-foreground-key-focus-setup-failed") }
    emit(["phase": "owned-setup", "victimPid": victimPid, "targetPid": targetPid, "keyFocus": api.focus(), "setupIntentionallyActivatedOnlyOwnedVictim": true])
    if foregroundABIOnly {
        var samples: [Object] = []
        for index in 0..<12 {
            let front = api.foreground(), focus = api.focus()
            let matches = front["frontStatus"] as? Int16 == 0 && front["pidStatus"] as? Int32 == 0 &&
                front["pid"] as? Int32 == victimPid && valid(focus, pid: victimPid) &&
                NSWorkspace.shared.frontmostApplication?.processIdentifier == victimPid
            samples.append(["index": index, "front": front, "keyFocus": focus, "ownedVictimMatches": matches])
            guard matches, hardwareCount() == hid, CGEvent(source: nil)?.location == mouse else {
                emit(["phase": "foreground-abi-result", "passed": false, "samples": samples]); throw failure("foreground-abi-owned-victim-mismatch")
            }
            pumpMainRunLoop(for: 0.02)
        }
        emit(["phase": "foreground-abi-result", "passed": true, "samples": samples,
              "noTapsSeedOrKeyboardPosts": true, "targetStillInactive": try state(targetState, targetPid)["isActive"] as? Bool == false])
        cleanup(); exit(0)
    }
    if criticalMode {
        let controller = Process(), input = Pipe()
        controller.executableURL = directory.appendingPathComponent("FakeFixtureKeyController")
        controller.arguments = [String(targetPid), String(try state(targetState, targetPid)["windowId"] as! UInt32), String(foreignTag), "--critical-window"]
        controller.standardInput = input; controller.standardOutput = FileHandle.nullDevice; controller.standardError = FileHandle.nullDevice
        criticalController = controller; criticalInput = input; try controller.run()
        let armedURL = directory.appendingPathComponent("controller-\(controller.processIdentifier)-armed.json")
        let armedDeadline = Date().addingTimeInterval(1)
        while !FileManager.default.fileExists(atPath: armedURL.path) && controller.isRunning && Date() < armedDeadline { pumpMainRunLoop(for: 0.001) }
        guard FileManager.default.fileExists(atPath: armedURL.path), controller.isRunning else { throw failure("critical-controller-not-armed") }
        pumpMainRunLoop(for: 0.02)
    }
    let lease = OwnedFocusProtection(target: targetPid, victim: victimPid, api: api, ownSeedOnly: ownSeedOnly)
    protection = lease
    guard lease.start() else { emit(["phase": "tap-unavailable", "protection": lease.snapshot()]); throw failure("required-taps-unavailable") }
    guard valid(api.focus(), pid: victimPid) else { throw failure("keyboard-focus-changed-before-seed") }
    if ownSeedOnly {
        let front = api.foreground(), focus = api.focus()
        guard ownedProcessIdentity(targetPid) == lease.targetIdentity, ownedProcessIdentity(victimPid) == lease.victimIdentity,
              front["frontStatus"] as? Int16 == 0, front["pidStatus"] as? Int32 == 0,
              lease.lock.withLock({ lease.ownSeed.armOwnSeed(foregroundPid: front["pid"] as? Int32,
                  focusPid: valid(focus, pid: victimPid) ? victimPid : nil, nowNs: DispatchTime.now().uptimeNanoseconds, cancelled: false) }) else { throw failure("own-seed-test-arm-failed") }
    }
    try notification(1, targetPid); seedOwned = true
    if ownSeedOnly {
        func postForeign() throws {
            let controller = Process(); controller.executableURL = directory.appendingPathComponent("FakeFixtureKeyController")
            controller.arguments = [String(targetPid), String(try state(targetState, targetPid)["windowId"] as! UInt32), String(foreignTag)]
            controller.standardOutput = FileHandle.nullDevice; controller.standardError = FileHandle.nullDevice
            try controller.run()
            let deadline = Date().addingTimeInterval(1)
            while controller.isRunning && Date() < deadline { pumpMainRunLoop(for: 0.005) }
            guard !controller.isRunning, controller.terminationStatus == 0 else {
                if controller.isRunning { controller.terminate() }; throw failure("own-seed-test-controller-failed")
            }
            pumpMainRunLoop(for: 0.12)
        }
        pumpMainRunLoop(for: 0.05)
        guard valid(api.focus(), pid: targetPid), lease.snapshot()["recordPresent"] as? Bool == false else { throw failure("own-seed-no-record-thief-setup") }
        try postForeign()
        guard try state(victimState, victimPid)["knownForeignMarkerCount"] as? Int == 1,
              try state(targetState, targetPid)["knownForeignMarkerInserted"] as? Bool == false else { throw failure("own-seed-cps-thief-editor-routing") }
        emit(["phase": "own-seed-no-taken-cps-target", "passed": true, "protection": lease.snapshot()])
        try notification(2, targetPid); seedOwned = false; pumpMainRunLoop(for: 0.1)
        guard valid(api.focus(), pid: victimPid), try state(targetState, targetPid)["isActive"] as? Bool == false else { throw failure("own-seed-cleanup-before-victim-case") }
        try postForeign()
        let events = lease.snapshot()["events"] as? [Object] ?? []
        guard try state(victimState, victimPid)["knownForeignMarkerCount"] as? Int == 2,
              try state(targetState, targetPid)["knownForeignMarkerInserted"] as? Bool == false,
              events.filter({ $0["phase"] as? String == "own-seed-foreign-disposition" && $0["decision"] as? String == "forward" }).count == 4,
              valid(api.focus(), pid: victimPid), (api.foreground()["pid"] as? Int32) == victimPid,
              hardwareCount() == hid, CGEvent(source: nil)?.location == mouse else { throw failure("own-seed-cps-victim-editor-routing") }
        emit(["phase": "own-seed-no-taken-cps-victim-after-cleanup", "passed": true, "leaseRetainedPastWaitDeadline": !lease.lock.withLock({ lease.ownSeed.seedWaitEligible(nowNs: DispatchTime.now().uptimeNanoseconds) }), "protection": lease.snapshot()])
        cleanup(); exit(0)
    }
    if criticalMode {
        let controller = criticalController!, input = criticalInput!
        let resultBase = "controller-\(controller.processIdentifier)-"
        let postedURL = directory.appendingPathComponent(resultBase + "posted.json"), missedURL = directory.appendingPathComponent(resultBase + "missed.json")
        let deadline = Date().addingTimeInterval(0.35)
        var triggered: Object?
        while Date() < deadline {
            guard lease.isHealthy(), hardwareCount() == hid, CGEvent(source: nil)?.location == mouse,
                  NSWorkspace.shared.frontmostApplication?.processIdentifier == victimPid else { throw failure("critical-trial-human-or-tap-state-changed") }
            let current = api.focus(), trace = lease.snapshot()
            if valid(current, pid: targetPid), trace["recordPresent"] as? Bool == false {
                triggered = ["triggerNs": DispatchTime.now().uptimeNanoseconds, "keyFocus": current, "protection": trace]
                try input.fileHandleForWriting.write(contentsOf: Data("post\n".utf8)); break
            }
            pumpMainRunLoop(for: 0.0005)
        }
        var controllerResult: Object?
        if triggered != nil {
            let resultDeadline = Date().addingTimeInterval(0.15)
            while Date() < resultDeadline {
                for url in [postedURL, missedURL] {
                    if let data = try? Data(contentsOf: url), let value = (try? JSONSerialization.jsonObject(with: data)) as? Object { controllerResult = value; break }
                }
                if controllerResult != nil { break }; pumpMainRunLoop(for: 0.0005)
            }
        }
        guard let trigger = triggered, let result = controllerResult, result["phase"] as? String == "posted" else {
            emit(["phase": "critical-window-missed", "trigger": triggered ?? [:], "controller": controllerResult ?? [:], "protection": lease.snapshot(), "proof": false])
            cleanup(); exit(0)
        }
        pumpMainRunLoop(for: 0.15)
        let targetAfter = try state(targetState, targetPid), victimAfter = try state(victimState, victimPid), trace = lease.snapshot()
        let events = trace["events"] as? [Object] ?? []
        let taken = events.first { $0["phase"] as? String == "taken-suppressed" }
        let routed = events.first { $0["phase"] as? String == "foreign-source-forwarded" && $0["tag"] as? Int64 == foreignTag }
        let ordering = (taken?["entryNs"] as? UInt64 ?? UInt64.max) <= (taken?["recordCreatedNs"] as? UInt64 ?? 0) &&
            (taken?["recordCreatedNs"] as? UInt64 ?? UInt64.max) <= (routed?["entryNs"] as? UInt64 ?? 0)
        let postBeforeTaken = (result["beforePostNs"] as? UInt64 ?? UInt64.max) <= (result["firstPostCallNs"] as? UInt64 ?? 0) &&
            (result["firstPostCallNs"] as? UInt64 ?? UInt64.max) <= (result["firstPostReturnedNs"] as? UInt64 ?? 0) &&
            (result["firstPostReturnedNs"] as? UInt64 ?? UInt64.max) < (taken?["entryNs"] as? UInt64 ?? 0)
        let invocationBeforeTaken = (result["beforePostNs"] as? UInt64 ?? UInt64.max) <= (result["firstPostCallNs"] as? UInt64 ?? 0) &&
            (result["firstPostCallNs"] as? UInt64 ?? UInt64.max) < (taken?["entryNs"] as? UInt64 ?? 0)
        let passed = ordering && victimAfter["knownForeignMarkerInserted"] as? Bool == true && targetAfter["knownForeignMarkerInserted"] as? Bool == false &&
            valid(api.focus(), pid: victimPid) && hardwareCount() == hid && CGEvent(source: nil)?.location == mouse && NSWorkspace.shared.frontmostApplication?.processIdentifier == victimPid
        emit(["phase": "critical-window-result", "passed": passed, "proof": invocationBeforeTaken && passed,
              "proofScope": "pre-Taken-call-entry-and-post-record-delivery-only",
              "postCallEntryBeforeNaturalTakenEntry": invocationBeforeTaken,
              "postReturnedBeforeNaturalTakenEntry": postBeforeTaken, "trigger": trigger, "controller": result,
              "naturalTakenBeforeKeyCallback": ordering, "victimEditorMarkerInserted": victimAfter["knownForeignMarkerInserted"] ?? false,
              "targetEditorMarkerInserted": targetAfter["knownForeignMarkerInserted"] ?? false, "keyFocusAfter": api.focus(), "protection": trace])
        cleanup(); exit(passed ? 0 : 10)
    }
    let deadline = Date().addingTimeInterval(0.35)
    while Date() < deadline {
        guard lease.isHealthy(), hardwareCount() == hid, CGEvent(source: nil)?.location == mouse,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == victimPid,
              valid(api.focus(), pid: victimPid) else {
            emit(["phase": "seed-protection-failed", "keyFocus": api.focus(), "targetState": try state(targetState, targetPid), "protection": lease.snapshot()]); throw failure("seed-did-not-preserve-owned-key-focus")
        }
        pumpMainRunLoop(for: 0.005)
    }
    emit(["phase": "protected-seed", "keyFocus": api.focus(), "targetState": try state(targetState, targetPid), "protection": lease.snapshot()])
    // Agent packet is generated by this helper process; foreign fake packet by a distinct owned controller.
    let window = try state(targetState, targetPid)["windowId"] as! UInt32
    let units = Array("g".utf16)
    for down in [true, false] {
        let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)!
        event.flags = []; event.setIntegerValueField(.eventSourceUserData, value: agentTag)
        event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(targetPid))
        event.setIntegerValueField(CGEventField(rawValue: 51)!, value: Int64(window))
        units.withUnsafeBufferPointer { event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: $0.baseAddress) }
        lease.log(["phase": "own-packet-created", "sourcePid": event.getIntegerValueField(.eventSourceUnixProcessID), "tag": agentTag])
        event.postToPid(targetPid)
    }
    let controller = Process(); controller.executableURL = directory.appendingPathComponent("FakeFixtureKeyController")
    controller.arguments = [String(targetPid), String(window), String(foreignTag)]
    let pipe = Pipe(); controller.standardOutput = pipe; controller.standardError = FileHandle.nullDevice
    try controller.run()
    let controllerDeadline = Date().addingTimeInterval(2)
    while controller.isRunning && Date() < controllerDeadline { pumpMainRunLoop(for: 0.01) }
    guard !controller.isRunning, controller.terminationStatus == 0 else {
        if controller.isRunning { controller.terminate() }
        throw failure("owned-fake-controller-timeout-or-failure")
    }
    pumpMainRunLoop(for: 0.15)
    let afterTarget = try state(targetState, targetPid), afterVictim = try state(victimState, victimPid)
    let targetTags = (afterTarget["taggedKeyEvents"] as? [[String: Int64]] ?? []).map { $0["tag"]! }
    let victimTags = (afterVictim["taggedKeyEvents"] as? [[String: Int64]] ?? []).map { $0["tag"]! }
    let trace = lease.snapshot()
    let forwarded = (trace["events"] as? [Object] ?? []).contains { $0["phase"] as? String == "foreign-source-forwarded" }
    let routing = forwarded && targetTags == [agentTag] && victimTags == [foreignTag]
    let correctUnexercisedPassThrough = !forwarded && targetTags == [agentTag, foreignTag] && victimTags.isEmpty
    let focusKept = valid(api.focus(), pid: victimPid)
    emit(["phase": "routing-result", "targetTagMetadata": afterTarget["taggedKeyEvents"] ?? [], "victimTagMetadata": afterVictim["taggedKeyEvents"] ?? [],
          "keyFocus": api.focus(), "exactOwnedFakeRouting": routing, "routingStatus": routing ? "verified" : "unexercised",
          "correctPassThroughWithoutSuppression": correctUnexercisedPassThrough, "protection": trace, "passed": (routing || correctUnexercisedPassThrough) && focusKept])
    guard routing || correctUnexercisedPassThrough, focusKept, lease.isHealthy(), hardwareCount() == hid, CGEvent(source: nil)?.location == mouse else { throw failure("routing-or-isolation-assertion") }
    try notification(2, targetPid); seedOwned = false
    pumpMainRunLoop(for: 0.15)
    let cleanedTarget = try state(targetState, targetPid)
    guard valid(api.focus(), pid: victimPid), NSWorkspace.shared.frontmostApplication?.processIdentifier == victimPid,
          hardwareCount() == hid, CGEvent(source: nil)?.location == mouse,
          cleanedTarget["isActive"] as? Bool == false, cleanedTarget["isKey"] as? Bool == false else {
        throw failure("isolation-or-inactive-state-not-preserved-after-cleanup")
    }
    emit(["phase": "summary", "passed": true, "keyFocus": api.focus(), "targetStateAfterCleanup": cleanedTarget,
          "foregroundPreserved": true, "physicalCursorPreserved": true, "hidCountersPreserved": true,
          "protection": lease.snapshot(), "noPersonalAppInput": true])
    cleanup()
} catch {
    emit(["phase": "failed", "error": String(describing: error), "protection": protection?.snapshot() ?? [:]])
    cleanup(); exit(10)
}

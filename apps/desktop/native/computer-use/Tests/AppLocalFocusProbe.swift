import AppKit
import ApplicationServices
import CoreGraphics
import Darwin

// Original, fixture-only test of app-local AppKit notifications. No global posting,
// OS foreground activation, copied binary code, or hardware cursor changes.
// Focus SPI is read-only metadata; app-local notifications are the experiment.
typealias SetWindowLocation = @convention(c) (CGEvent, CGPoint) -> Void
let root = URL(fileURLWithPath: "/private/tmp/djl-cua-background-probe")
let executable = root.appendingPathComponent("DJLBackgroundFixture.app/Contents/MacOS/DJLBackgroundFixture")
let stateURL = root.appendingPathComponent("fixture-state.json")
func emit(_ object: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self)); fflush(stdout)
}
func pumpMainRunLoop(for interval: TimeInterval) {
    let deadline = Date().addingTimeInterval(interval)
    while Date() < deadline { _ = RunLoop.current.run(mode: .default, before: min(deadline, Date().addingTimeInterval(0.005))) }
}
let probeApplication = NSApplication.shared
probeApplication.setActivationPolicy(.prohibited)
func hardwareInputCount() -> UInt64 {
    let types: [CGEventType] = [.mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged,
        .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp,
        .keyDown, .keyUp, .flagsChanged, .scrollWheel]
    return types.reduce(0) { $0 + UInt64(CGEventSource.counterForEventType(.hidSystemState, eventType: $1)) }
}
struct Human: Equatable {
    let hardwareCount = hardwareInputCount()
    let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1
    let cursor = CGEvent(source: nil)?.location ?? .zero
    var json: [String: Any] { ["foregroundPid": pid, "mouseX": cursor.x, "mouseY": cursor.y, "hardwareInputCount": hardwareCount] }
}
func state(_ pid: pid_t) throws -> [String: Any] {
    let value = try JSONSerialization.jsonObject(with: Data(contentsOf: stateURL)) as! [String: Any]
    guard value["pid"] as? Int32 == pid, value["bundleId"] as? String == "com.djl.computer-use.background-fixture" else {
        throw NSError(domain: "fixture-identity", code: 1)
    }
    return value
}
typealias ReadProcessPid = @convention(c) (UnsafePointer<ProcessSerialNumber>, UnsafeMutablePointer<pid_t>) -> Int32
typealias ReadKeyFocus = @convention(c) (UnsafeMutablePointer<ProcessSerialNumber>, UnsafeMutablePointer<UInt8>) -> Int32
func keyFocus() -> [String: Any] {
    guard let library = dlopen("/System/Library/Frameworks/CoreGraphics.framework/Versions/A/CoreGraphics", RTLD_NOW | RTLD_LOCAL),
          let address = dlsym(library, "CPSGetKeyFocusProcess") else { return ["available": false] }
    let read = unsafeBitCast(address, to: ReadKeyFocus.self)
    var psn = ProcessSerialNumber(highLongOfPSN: 0, lowLongOfPSN: 0)
    var flag: UInt8 = 0
    let status = read(&psn, &flag)
    var result: [String: Any] = ["available": true, "cpsStatus": status,
        "psnHigh": psn.highLongOfPSN, "psnLow": psn.lowLongOfPSN, "rawFlag": flag]
    if status == 0 {
        guard let services = dlopen("/System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/HIServices", RTLD_NOW | RTLD_LOCAL),
              let pidAddress = dlsym(services, "GetProcessPID") else { result["pidResolverAvailable"] = false; return result }
        let resolvePid = unsafeBitCast(pidAddress, to: ReadProcessPid.self)
        var pid: pid_t = 0
        let pidStatus = resolvePid(&psn, &pid)
        result["getProcessPidStatus"] = pidStatus; result["pid"] = pid
    }
    return result
}
func validKeyFocus(_ value: [String: Any]) -> Bool {
    value["cpsStatus"] as? Int32 == 0 && value["getProcessPidStatus"] as? Int32 == 0 && (value["pid"] as? Int32 ?? 0) > 0
}
func axFrontmost(_ pid: pid_t) -> Any {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.3)
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app, kAXFrontmostAttribute as CFString, &value) == .success,
          let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return NSNull() }
    return number.boolValue
}
func inactive(_ value: [String: Any]) -> Bool { value["isActive"] as? Bool == false && value["isKey"] as? Bool == false }
func appKitNotification(_ subtype: Int16, pid: pid_t) throws {
    guard let event = NSEvent.otherEvent(with: .appKitDefined, location: .zero, modifierFlags: [], timestamp: 0,
                                        windowNumber: 0, context: nil, subtype: subtype, data1: 0, data2: 0)?.cgEvent else {
        throw NSError(domain: "appkit-notification-unavailable", code: 1)
    }
    event.postToPid(pid)
}
guard AXIsProcessTrusted(), CGPreflightScreenCaptureAccess() else { emit(["phase": "blocked", "reason": "permissions"]); exit(3) }
guard let library = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_NOW | RTLD_LOCAL),
      let symbol = dlsym(library, "CGEventSetWindowLocation") else { emit(["phase": "blocked", "reason": "apple-symbol-unavailable"]); exit(4) }
let setLocal = unsafeBitCast(symbol, to: SetWindowLocation.self)
let process = Process()
process.executableURL = executable
process.arguments = ["--self-deactivate", "--metadata-only-state"] + (CommandLine.arguments.contains("--standard-window") ? ["--standard-window"] : [])
process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
atexit { if process.isRunning { process.terminate() } }
let original = Human()
var localFocusSeeded = false
var cleanupAttempted = false
func cleanup() {
    guard localFocusSeeded && !cleanupAttempted else { return }
    cleanupAttempted = true
    try? appKitNotification(2, pid: process.processIdentifier)
}
atexit { cleanup() }
do {
    try process.run()
    let pid = process.processIdentifier
    for _ in 0..<50 {
        if (try? state(pid)) != nil { break }
        pumpMainRunLoop(for: 0.1)
    }
    pumpMainRunLoop(for: 0.8)
    let before = try state(pid)
    guard inactive(before), Human() == original, original.pid != pid,
          let app = NSRunningApplication(processIdentifier: pid), app.bundleIdentifier == "com.djl.computer-use.background-fixture",
          app.executableURL?.resolvingSymlinksInPath() == executable.resolvingSymlinksInPath(),
          let window = before["windowId"] as? UInt32,
          let row = (CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]])?.first(where: { $0[kCGWindowNumber as String] as? UInt32 == window && $0[kCGWindowOwnerPID as String] as? Int32 == pid }),
          let rawBounds = row[kCGWindowBounds as String] as? NSDictionary, let frame = CGRect(dictionaryRepresentation: rawBounds) else {
        emit(["phase": "blocked", "reason": "initial-inactive-identity-or-human-state", "state": before, "humanBefore": original.json, "humanAfter": Human().json]); exit(5)
    }
    let keyBefore = keyFocus()
    guard validKeyFocus(keyBefore) else { emit(["phase": "blocked", "reason": "key-focus-metadata-unavailable", "keyFocus": keyBefore]); exit(12) }
    emit(["keyFocus": keyBefore, "phase": "before-seed", "state": before, "axFrontmost": axFrontmost(pid), "human": original.json, "fixturePid": pid, "windowId": window])
    if CommandLine.arguments.contains("--ax-only") {
        let axApp = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(axApp, 0.2)
        func read(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
            var value: CFTypeRef?
            return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
        }
        var queue = [axApp], elements: [String: AXUIElement] = [:], count = 0
        while !queue.isEmpty && count < 300 {
            let current = queue.removeFirst(); count += 1
            AXUIElementSetMessagingTimeout(current, 0.2)
            if let identifier = read(current, kAXIdentifierAttribute) as? String,
               ["fixture-button", "fixture-text"].contains(identifier) { elements[identifier] = current }
            queue += (read(current, kAXChildrenAttribute) as? [AXUIElement] ?? []).prefix(300 - count)
        }
        guard let button = elements["fixture-button"], let text = elements["fixture-text"] else {
            throw NSError(domain: "controlled-ax-elements-unavailable", code: 1)
        }
        for method in ["AXPress", "AXSetValue"] {
            let keyBeforeMethod = keyFocus(), beforeMethod = try state(pid)
            guard Human() == original, validKeyFocus(keyBeforeMethod), keyBeforeMethod["pid"] as? Int32 == keyBefore["pid"] as? Int32 else {
                throw NSError(domain: "ax-audit-initial-isolation-changed", code: 1)
            }
            let error: AXError = method == "AXPress" ? AXUIElementPerformAction(button, kAXPressAction as CFString) :
                AXUIElementSetAttributeValue(text, kAXValueAttribute as CFString, "DJL-AX-METADATA-AUDIT-测试" as CFString)
            let deadline = Date().addingTimeInterval(0.25)
            while Date() < deadline {
                let current = keyFocus()
                guard Human() == original, validKeyFocus(current), current["pid"] as? Int32 == keyBefore["pid"] as? Int32 else {
                    emit(["phase": "ax-isolation-failed", "method": method, "keyFocusBefore": keyBeforeMethod,
                          "keyFocusDuring": current, "humanBefore": original.json, "humanAfter": Human().json,
                          "passed": false])
                    exit(10)
                }
                pumpMainRunLoop(for: 0.005)
            }
            let afterMethod = try state(pid), keyAfterMethod = keyFocus()
            let effect = method == "AXPress" ? (afterMethod["buttonCount"] as! Int) == (beforeMethod["buttonCount"] as! Int) + 1 : error == .success
            guard error == .success, effect else { throw NSError(domain: "controlled-ax-dispatch-failed", code: Int(error.rawValue)) }
            emit(["phase": "ax-audit", "method": method, "axStatus": error.rawValue,
                  "keyFocusBefore": keyBeforeMethod, "keyFocusAfter": keyAfterMethod,
                  "human": Human().json, "axFrontmost": axFrontmost(pid), "state": afterMethod,
                  "editableContentRedacted": true, "passed": true])
        }
        emit(["phase": "ax-summary", "passed": true, "keyFocusBefore": keyBefore,
              "keyFocusAfter": keyFocus(), "humanBefore": original.json, "humanAfter": Human().json])
        exit(0)
    }
    try appKitNotification(1, pid: pid); localFocusSeeded = true
    let seedDeadline = Date().addingTimeInterval(0.25)
    while Date() < seedDeadline {
        let currentKey = keyFocus()
        if !validKeyFocus(currentKey) || currentKey["pid"] as? Int32 != keyBefore["pid"] as? Int32 || Human() != original {
            cleanup(); pumpMainRunLoop(for: 0.1)
            emit(["phase": "seed-isolation-failed", "keyFocusBefore": keyBefore, "keyFocusDuringSeed": currentKey,
                  "keyFocusAfterCleanup": keyFocus(), "humanBefore": original.json, "humanAfter": Human().json,
                  "inputAbortedBeforeDrag": true, "passed": false])
            exit(10)
        }
        pumpMainRunLoop(for: 0.005)
    }
    let seeded = try state(pid), humanSeeded = Human(), keySeeded = keyFocus()
    emit(["keyFocus": keySeeded, "phase": "after-seed", "state": seeded, "axFrontmost": axFrontmost(pid), "human": humanSeeded.json, "humanStatePreserved": humanSeeded == original])
    guard humanSeeded == original else { cleanup(); throw NSError(domain: "seed-changed-human-state", code: 1) }
    if !validKeyFocus(keySeeded) || keySeeded["pid"] as? Int32 != keyBefore["pid"] as? Int32 {
        cleanup(); pumpMainRunLoop(for: 0.3)
        emit(["phase": "key-focus-changed-after-seed", "before": keyBefore, "afterSeed": keySeeded, "afterCleanup": keyFocus(), "state": try state(pid), "passed": false])
        exit(10)
    }
    let points = seeded["points"] as! [String: [String: Double]]
    let start = CGPoint(x: points["dragStart"]!["x"]!, y: points["dragStart"]!["y"]!)
    let end = CGPoint(x: points["dragEnd"]!["x"]!, y: points["dragEnd"]!["y"]!)
    func mouse(_ type: CGEventType, _ point: CGPoint) throws {
        guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else {
            throw NSError(domain: "mouse-event-create", code: 1)
        }
        event.flags = []
        event.setIntegerValueField(.mouseEventClickState, value: 1)
        event.setIntegerValueField(CGEventField(rawValue: 51)!, value: Int64(window))
        event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(window))
        event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(window))
        event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
        event.location = point
        setLocal(event, CGPoint(x: point.x - frame.minX, y: point.y - frame.minY))
        event.postToPid(pid)
    }
    func drag() throws {
        try mouse(.leftMouseDown, start)
        var last = start
        defer { try? mouse(.leftMouseUp, last) }
        for index in 1...8 {
            guard Human() == original else { throw NSError(domain: "human-state-changed-during-drag", code: 1) }
            let currentKey = keyFocus()
            guard validKeyFocus(currentKey), currentKey["pid"] as? Int32 == keyBefore["pid"] as? Int32 else {
                emit(["phase": "key-focus-changed-during-drag", "before": keyBefore, "current": currentKey])
                throw NSError(domain: "key-focus-changed-during-drag", code: 1)
            }
            last = CGPoint(x: start.x + (end.x - start.x) * Double(index) / 8, y: start.y)
            try mouse(.leftMouseDragged, last)
            pumpMainRunLoop(for: 0.02)
        }
    }
    try drag()
    pumpMainRunLoop(for: 0.25)
    let dragged = try state(pid), humanDragged = Human(), keyDragged = keyFocus()
    let effect = (dragged["dragCount"] as! Int) == (before["dragCount"] as! Int) + 1
    emit(["keyFocus": keyDragged, "phase": "after-drag", "state": dragged, "verifiedTargetEffect": effect,
          "human": humanDragged.json, "humanStatePreserved": humanDragged == original])
    cleanup()
    pumpMainRunLoop(for: 0.3)
    let final = try state(pid), humanFinal = Human(), keyFinal = keyFocus()
    let keys = [keyBefore, keySeeded, keyDragged, keyFinal]
    let keysValid = keys.allSatisfy(validKeyFocus)
    let keyUnchanged = keysValid && keys.allSatisfy { $0["pid"] as? Int32 == keyBefore["pid"] as? Int32 && $0["psnHigh"] as? UInt32 == keyBefore["psnHigh"] as? UInt32 && $0["psnLow"] as? UInt32 == keyBefore["psnLow"] as? UInt32 }
    let passed = keyUnchanged && effect && inactive(final) && humanSeeded == original && humanDragged == original && humanFinal == original
    emit(["phase": "summary", "keyFocusAfterCleanup": keyFinal, "keyFocusSamplesValid": keysValid, "keyFocusPreserved": keyUnchanged, "before": before, "seeded": seeded, "dragged": dragged, "afterCleanup": final,
          "humanBefore": original.json, "humanAfter": humanFinal.json, "humanStatePreserved": humanFinal == original,
          "targetInactiveAfterCleanup": inactive(final), "axFrontmostAfterCleanup": axFrontmost(pid), "verifiedDrag": effect, "passed": passed,
          "productionGateChanged": false])
    exit(passed ? 0 : 10)
} catch {
    cleanup()
    pumpMainRunLoop(for: 0.3)
    emit(["phase": "failed", "error": String(describing: error), "state": (try? state(process.processIdentifier)) ?? [:],
          "humanBefore": original.json, "humanAfter": Human().json]); exit(11)
}

import AppKit
import ApplicationServices
import CoreGraphics
import Darwin

// Original controlled experiment. Only Apple's system framework is dynamically loaded.
// No focus/activation APIs, global event posting, or physical cursor APIs are used.
typealias SetWindowLocation = @convention(c) (CGEvent, CGPoint) -> Void
let root = URL(fileURLWithPath: "/private/tmp/djl-cua-background-probe")
let fixtureURL = root.appendingPathComponent("DJLBackgroundFixture.app/Contents/MacOS/DJLBackgroundFixture")
let stateURL = root.appendingPathComponent("fixture-state.json")
func emit(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self)); fflush(stdout)
}
struct Human: Equatable {
    let foreground = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1
    let cursor = CGEvent(source: nil)?.location ?? .zero
    var json: [String: Any] { ["foregroundPid": foreground, "mouseX": cursor.x, "mouseY": cursor.y] }
}
func state(_ pid: pid_t) throws -> [String: Any] {
    let value = try JSONSerialization.jsonObject(with: Data(contentsOf: stateURL)) as! [String: Any]
    guard value["pid"] as? Int32 == pid, value["bundleId"] as? String == "com.djl.computer-use.background-fixture" else { throw NSError(domain: "fixture-identity", code: 1) }
    return value
}
let requireInactive = CommandLine.arguments.contains("--require-inactive")
guard AXIsProcessTrusted(), CGPreflightScreenCaptureAccess() else { emit(["phase": "blocked", "reason": "permissions"]); exit(3) }
guard let library = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_NOW | RTLD_LOCAL),
      let address = dlsym(library, "CGEventSetWindowLocation") else { emit(["phase": "blocked", "reason": "symbol-unavailable"]); exit(4) }
let setLocal = unsafeBitCast(address, to: SetWindowLocation.self)
let process = Process()
process.executableURL = fixtureURL
process.arguments = requireInactive ? ["--self-deactivate"] : []
process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
atexit { if process.isRunning { process.terminate() } }
let initialHuman = Human()
do {
    try process.run()
    let pid = process.processIdentifier
    var first: [String: Any]?
    for _ in 0..<50 {
        if let value = try? state(pid), !requireInactive || (value["isActive"] as? Bool == false && value["isKey"] as? Bool == false) { first = value; break }
        Thread.sleep(forTimeInterval: 0.1)
    }
    // Allow the fixture's initial launch notifications and self-deactivation to settle.
    Thread.sleep(forTimeInterval: requireInactive ? 0.7 : 0.3)
    guard first != nil, let app = NSRunningApplication(processIdentifier: pid), app.bundleIdentifier == "com.djl.computer-use.background-fixture",
          app.executableURL?.resolvingSymlinksInPath() == fixtureURL.resolvingSymlinksInPath() else { throw NSError(domain: "fixture-start", code: 1) }
    let startState = try state(pid)
    if requireInactive && (startState["isActive"] as? Bool != false || startState["isKey"] as? Bool != false) {
        emit(["phase": "blocked", "reason": "fixture-not-genuinely-inactive", "state": startState]); exit(5)
    }
    guard Human() == initialHuman, initialHuman.foreground != pid else { emit(["phase": "aborted", "reason": "launch-human-state-changed"]); exit(6) }
    guard let windowID = startState["windowId"] as? UInt32,
          let row = (CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]])?.first(where: { $0[kCGWindowNumber as String] as? UInt32 == windowID && $0[kCGWindowOwnerPID as String] as? Int32 == pid }),
          let bounds = row[kCGWindowBounds as String] as? NSDictionary, let frame = CGRect(dictionaryRepresentation: bounds) else { throw NSError(domain: "fixture-window", code: 1) }
    emit(["phase": "setup", "fixturePid": pid, "windowId": windowID, "requireInactive": requireInactive,
          "human": initialHuman.json, "state": startState, "appleSymbol": "CGEventSetWindowLocation"])
    func point(_ name: String) throws -> CGPoint {
        let points = try state(pid)["points"] as! [String: [String: Double]]
        return CGPoint(x: points[name]!["x"]!, y: points[name]!["y"]!)
    }
    func decorate(_ event: CGEvent, point: CGPoint, bottom: Bool, subtype: Bool, compatibility: Bool, local: Bool) {
        event.location = point
        event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(windowID))
        event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(windowID))
        event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
        if subtype { event.setIntegerValueField(CGEventField(rawValue: 7)!, value: 3) }
        if compatibility { event.setIntegerValueField(CGEventField(rawValue: 51)!, value: Int64(windowID)) }
        if local {
            let localY = point.y - frame.minY
            setLocal(event, CGPoint(x: point.x - frame.minX, y: bottom ? frame.height - localY : localY))
        }
    }
    func mouse(_ type: CGEventType, point: CGPoint, native: Bool, bottom: Bool, subtype: Bool, compatibility: Bool, local: Bool) throws {
        let event: CGEvent?
        if native {
            let kind: NSEvent.EventType = type == .leftMouseDown ? .leftMouseDown : type == .leftMouseUp ? .leftMouseUp : .leftMouseDragged
            let y = point.y - frame.minY
            event = NSEvent.mouseEvent(with: kind, location: NSPoint(x: point.x - frame.minX, y: bottom ? frame.height - y : y), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: Int(windowID), context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseUp ? 0 : 1)?.cgEvent
        } else { event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) }
        guard let event = event else { throw NSError(domain: "event-create", code: 1) }
        event.setIntegerValueField(.mouseEventClickState, value: 1)
        decorate(event, point: point, bottom: bottom, subtype: subtype, compatibility: compatibility, local: local)
        event.postToPid(pid)
    }
    var passing: [String] = []
    let variants: [(Bool, Bool, Bool, Bool, Bool)] = [false, true].flatMap { native in
        [false, true].flatMap { bottom in
            [false, true].flatMap { subtype in
                [false, true].map { compatibility in (native, bottom, subtype, compatibility, true) }
            }
        }
    } + [(true, false, false, false, false), (true, true, false, false, false)]
    for (native, bottom, subtype, compatibility, local) in variants {
        let variant = "\(native ? "NSEvent" : "CGEvent")-\(bottom ? "bottom" : "top")-subtype\(subtype ? "3" : "default")-field51\(compatibility ? "set" : "none")-local\(local ? "SPI" : "none")"
        var outcomes: [Bool] = []
        var intermediate: [[String: Any]] = []
        func trial(_ action: String, effect: ([String: Any], [String: Any]) -> Bool, operation: () throws -> Void) throws {
            if requireInactive {
                kill(pid, SIGUSR1)
                for _ in 0..<20 {
                    let value = try state(pid)
                    if value["isActive"] as? Bool == false && value["isKey"] as? Bool == false { break }
                    Thread.sleep(forTimeInterval: 0.05)
                }
            }
            let humanBefore = Human(), before = try state(pid)
            guard humanBefore == initialHuman else { emit(["phase": "aborted", "reason": "human-changed-before", "variant": variant]); exit(7) }
            if requireInactive && (before["isActive"] as? Bool != false || before["isKey"] as? Bool != false) {
                emit(["phase": "blocked", "reason": "fixture-lost-inactive-state", "variant": variant, "before": before]); exit(8)
            }
            intermediate = []
            try operation(); Thread.sleep(forTimeInterval: 0.25)
            let after = try state(pid), humanAfter = Human(), changed = effect(before, after)
            emit(["phase": "trial", "variant": variant, "action": action, "before": before, "after": after,
                  "intermediateStates": intermediate, "humanBefore": humanBefore.json, "humanAfter": humanAfter.json,
                  "humanStatePreserved": humanBefore == humanAfter, "verifiedTargetEffect": changed,
                  "passed": humanBefore == humanAfter && changed])
            guard humanBefore == humanAfter else { exit(9) }
            outcomes.append(changed)
        }
        try trial("click", effect: { ($1["buttonCount"] as! Int) == ($0["buttonCount"] as! Int) + 1 }) {
            let p = try point("button")
            try mouse(.leftMouseDown, point: p, native: native, bottom: bottom, subtype: subtype, compatibility: compatibility, local: local)
            try mouse(.leftMouseUp, point: p, native: native, bottom: bottom, subtype: subtype, compatibility: compatibility, local: local)
        }
        try trial("scroll", effect: { before, after in
            ([after] + intermediate).contains { ($0["scrollCount"] as! Int) > (before["scrollCount"] as! Int) && ($0["scrollOffset"] as! Double) != (before["scrollOffset"] as! Double) }
        }) {
            for delta: Int32 in [160, -320] {
                let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: delta, wheel2: 0, wheel3: 0)!
                decorate(event, point: try point("scroll"), bottom: bottom, subtype: false, compatibility: compatibility, local: local); event.postToPid(pid)
                Thread.sleep(forTimeInterval: 0.15); intermediate.append(try state(pid))
            }
        }
        try trial("drag", effect: { ($1["dragCount"] as! Int) == ($0["dragCount"] as! Int) + 1 }) {
            let start = try point("dragStart"), end = try point("dragEnd")
            try mouse(.leftMouseDown, point: start, native: native, bottom: bottom, subtype: subtype, compatibility: compatibility, local: local)
            var current = start
            defer { try? mouse(.leftMouseUp, point: current, native: native, bottom: bottom, subtype: subtype, compatibility: compatibility, local: local) }
            for index in 1...8 {
                guard Human() == initialHuman else { throw NSError(domain: "human-changed-during-drag", code: 1) }
                current = CGPoint(x: start.x + (end.x - start.x) * Double(index) / 8, y: start.y)
                try mouse(.leftMouseDragged, point: current, native: native, bottom: bottom, subtype: subtype, compatibility: compatibility, local: local)
                Thread.sleep(forTimeInterval: 0.015)
            }
        }
        if outcomes.allSatisfy({ $0 }) { passing.append(variant) }
    }
    emit(["phase": "summary", "fullyPassingVariants": passing, "requireInactive": requireInactive,
          "humanBefore": initialHuman.json, "humanAfter": Human().json, "productionGateChanged": false])
    exit(passing.isEmpty ? 10 : 0)
} catch {
    emit(["phase": "failed", "error": String(describing: error), "humanBefore": initialHuman.json, "humanAfter": Human().json]); exit(11)
}

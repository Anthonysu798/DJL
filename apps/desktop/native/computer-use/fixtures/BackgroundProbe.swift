import AppKit
import ApplicationServices
import CoreGraphics

let root = URL(fileURLWithPath: "/private/tmp/djl-cua-background-probe")
let fixtureBundle = "com.djl.computer-use.background-fixture"
let trusted = AXIsProcessTrusted()
let screenCapture = CGPreflightScreenCaptureAccess()

func emit(_ object: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
    fflush(stdout)
}

struct HumanState: Equatable {
    let pid: pid_t
    let bundle: String
    let mouse: CGPoint
    init() {
        let front = NSWorkspace.shared.frontmostApplication
        pid = front?.processIdentifier ?? -1
        bundle = front?.bundleIdentifier ?? "unknown"
        mouse = CGEvent(source: nil)?.location ?? .zero
    }
    var json: [String: Any] { ["foregroundPid": pid, "foregroundBundle": bundle, "mouseX": mouse.x, "mouseY": mouse.y] }
}

func readState() throws -> [String: Any] {
    let data = try Data(contentsOf: root.appendingPathComponent("fixture-state.json"))
    return try JSONSerialization.jsonObject(with: data) as! [String: Any]
}

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}

func descendants(_ element: AXUIElement, depth: Int = 0) -> [AXUIElement] {
    guard depth < 12 else { return [] }
    let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
    return [element] + children.prefix(200).flatMap { descendants($0, depth: depth + 1) }
}

emit(["phase": "permissions", "accessibilityTrusted": trusted, "screenCaptureGranted": screenCapture,
      "prompted": false, "probePid": ProcessInfo.processInfo.processIdentifier])
let launchFixture = CommandLine.arguments.contains("--launch")
if !CommandLine.arguments.contains("--run") && !launchFixture { exit(0) }
guard trusted else {
    emit(["phase": "blocked", "reason": "accessibility_not_granted", "unverified": ["AXPress", "AXUnicodeValue", "CGEventPostToPidClick", "CGEventPostToPidUnicode", "CGEventPostToPidScroll", "CGEventPostToPidDrag"]])
    exit(3)
}
var fixtureProcess: Process?
atexit { if let process = fixtureProcess, process.isRunning { process.terminate() } }
do {
    var requestedPid = CommandLine.arguments.count == 3 ? Int32(CommandLine.arguments[2]) : nil
    if launchFixture {
        let before = HumanState()
        let process = Process()
        process.executableURL = root.appendingPathComponent("DJLBackgroundFixture.app/Contents/MacOS/DJLBackgroundFixture")
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        fixtureProcess = process
        requestedPid = process.processIdentifier
        for _ in 0..<40 {
            if let state = try? readState(), state["pid"] as? Int32 == process.processIdentifier { break }
            Thread.sleep(forTimeInterval: 0.1)
        }
        let after = HumanState()
        emit(["phase": "fixtureLaunch", "humanBefore": before.json, "humanAfter": after.json,
              "humanStatePreserved": before == after, "fixturePid": process.processIdentifier])
        if before != after { process.terminate(); exit(9) }
    }
    guard let pid = requestedPid, pid > 1,
          let app = NSRunningApplication(processIdentifier: pid), app.bundleIdentifier == fixtureBundle,
          app.executableURL?.resolvingSymlinksInPath().path == root.appendingPathComponent("DJLBackgroundFixture.app/Contents/MacOS/DJLBackgroundFixture").resolvingSymlinksInPath().path else {
        emit(["phase": "blocked", "reason": "explicit_fixture_pid_identity_required", "requestedPid": requestedPid ?? -1, "bundle": requestedPid.flatMap { NSRunningApplication(processIdentifier: $0)?.bundleIdentifier } ?? "unregistered", "executable": requestedPid.flatMap { NSRunningApplication(processIdentifier: $0)?.executableURL?.resolvingSymlinksInPath().path } ?? "unregistered"])
        exit(4)
    }
    let original = HumanState()
    guard original.pid != pid else { emit(["phase": "blocked", "reason": "fixture_must_be_background"]); exit(5) }
    let axApp = AXUIElementCreateApplication(pid)
    let all = descendants(axApp)
    func element(_ identifier: String) -> AXUIElement? {
        all.first { attribute($0, kAXIdentifierAttribute) as? String == identifier }
    }
    guard let button = element("fixture-button"), let textField = element("fixture-text") else {
        emit(["phase": "blocked", "reason": "fixture_ax_elements_unavailable", "elementCount": all.count]); exit(6)
    }
    let initial = try readState()
    guard initial["pid"] as? Int32 == pid, let windowId = initial["windowId"] as? Int, windowId > 0 else { exit(7) }

    func point(_ name: String) throws -> CGPoint {
        let state = try readState()
        let coordinates = (state["points"] as! [String: [String: Double]])[name]!
        return CGPoint(x: coordinates["x"]!, y: coordinates["y"]!)
    }

    // No CGEvent.post(tap:), cursor warps, AX activation, focus-setting, or global keyboard events.
    func post(_ event: CGEvent) {
        event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(windowId))
        event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(windowId))
        event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
        event.postToPid(pid)
    }

    func mouse(_ type: CGEventType, at point: CGPoint) {
        guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else { return }
        event.setIntegerValueField(.mouseEventClickState, value: 1)
        post(event)
    }

    var failed = false
    func trial(_ name: String, effect: ([String: Any], [String: Any]) -> Bool, action: () throws -> [String: Any]) throws {
        let humanBefore = HumanState()
        guard humanBefore == original else {
            emit(["phase": "aborted", "reason": "human_state_changed_before_action", "action": name,
                  "original": original.json, "before": humanBefore.json]); exit(8)
        }
        let before = try readState()
        let dispatch = try action()
        Thread.sleep(forTimeInterval: 0.35)
        let after = try readState()
        let humanAfter = HumanState()
        let preserved = humanBefore == humanAfter
        let changed = effect(before, after)
        emit(["phase": "trial", "action": name, "dispatch": dispatch, "before": before, "after": after,
              "humanBefore": humanBefore.json, "humanAfter": humanAfter.json,
              "humanStatePreserved": preserved, "verifiedTargetEffect": changed, "passed": preserved && changed])
        if !preserved { emit(["phase": "aborted", "reason": "human_state_changed_after_action"]); exit(9) }
        if !changed { failed = true }
    }

    try trial("AXPress", effect: { ($1["buttonCount"] as! Int) == ($0["buttonCount"] as! Int) + 1 }) {
        ["axError": AXUIElementPerformAction(button, kAXPressAction as CFString).rawValue]
    }
    let unicode = "DJL 测试 café 🧪"
    try trial("AXUnicodeValue", effect: { _, after in after["text"] as? String == unicode }) {
        ["axError": AXUIElementSetAttributeValue(textField, kAXValueAttribute as CFString, unicode as CFString).rawValue]
    }
    try trial("CGEventPostToPidClick", effect: { ($1["buttonCount"] as! Int) == ($0["buttonCount"] as! Int) + 1 }) {
        let p = try point("button")
        mouse(.leftMouseDown, at: p)
        mouse(.leftMouseUp, at: p)
        return ["posted": true, "windowId": windowId]
    }
    let suffix = "键盘✓"
    try trial("CGEventPostToPidUnicode", effect: { before, after in
        (after["text"] as? String != before["text"] as? String) && (after["text"] as? String ?? "").contains(suffix)
    }) {
        let units = Array(suffix.utf16)
        for down in [true, false] {
            let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)!
            units.withUnsafeBufferPointer { event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: $0.baseAddress) }
            post(event)
        }
        return ["posted": true, "unicode": suffix]
    }
    try trial("CGEventPostToPidScroll", effect: { before, after in
        (after["scrollCount"] as! Int) > (before["scrollCount"] as! Int) && (after["scrollOffset"] as! Double) != (before["scrollOffset"] as! Double)
    }) {
        let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: 160, wheel2: 0, wheel3: 0)!
        event.location = try point("scroll")
        post(event)
        return ["posted": true, "windowId": windowId]
    }
    try trial("CGEventPostToPidDrag", effect: { ($1["dragCount"] as! Int) == ($0["dragCount"] as! Int) + 1 }) {
        let start = try point("dragStart"), end = try point("dragEnd")
        mouse(.leftMouseDown, at: start)
        for step in 1...6 {
            mouse(.leftMouseDragged, at: CGPoint(x: start.x + (end.x - start.x) * Double(step) / 6, y: start.y))
            Thread.sleep(forTimeInterval: 0.02)
        }
        mouse(.leftMouseUp, at: end)
        return ["posted": true, "windowId": windowId]
    }
    emit(["phase": "summary", "allTrialsPassed": !failed, "screenCaptureTested": false,
          "limitations": ["controlled AppKit fixture only", "no minimized window coverage", "no screenshot experiment"]])
    exit(failed ? 10 : 0)
} catch {
    emit(["phase": "blocked", "reason": "fixture_probe_error", "error": String(describing: error)])
    exit(11)
}
